"""Safe reindex of the face pipeline.

CLI (primary interface):
  docker compose exec ai-worker python reindex.py --album <album-id>
  docker compose exec ai-worker python reindex.py --photo <photo-id>
  docker compose exec ai-worker python reindex.py --failed
  docker compose exec ai-worker python reindex.py --all

Marks targets PENDING, deletes their old embeddings (any model version),
clears stuck jobs, and enqueues fresh jobs. Idempotent; the worker's
per-photo DELETE-then-INSERT prevents duplicate embeddings on retries.
"""

import argparse

from dotenv import load_dotenv

load_dotenv()

from ai_face import db  # noqa: E402


def _target_photos(cur, album_id=None, photo_id=None, failed_only=False):
    if photo_id:
        cur.execute("SELECT id, storage_url FROM photos WHERE id = %s", (photo_id,))
    elif failed_only:
        if album_id:
            cur.execute(
                "SELECT id, storage_url FROM photos WHERE album_id = %s AND processing_state = 'FAILED'",
                (album_id,),
            )
        else:
            cur.execute("SELECT id, storage_url FROM photos WHERE processing_state = 'FAILED'")
    elif album_id:
        cur.execute("SELECT id, storage_url FROM photos WHERE album_id = %s", (album_id,))
    else:
        cur.execute("SELECT id, storage_url FROM photos")
    return cur.fetchall()


def reindex(album_id=None, photo_id=None, failed_only=False) -> dict:
    with db.connection() as conn:
        cur = conn.cursor()
        targets = _target_photos(cur, album_id, photo_id, failed_only)
        if not targets:
            cur.close()
            return {"queued": 0, "message": "no matching photos"}

        ids = [t[0] for t in targets]
        cur.execute("DELETE FROM photo_embeddings WHERE photo_id = ANY(%s)", (ids,))
        deleted_embeddings = cur.rowcount
        cur.execute(
            """
            UPDATE photos SET processing_state = 'PENDING', processed = false,
                   processing_error = NULL, face_count = NULL, processing_attempts = 0
            WHERE id = ANY(%s)
            """,
            (ids,),
        )
        cur.execute(
            "DELETE FROM processing_jobs WHERE photo_id = ANY(%s) AND status <> 'COMPLETED'", (ids,)
        )
        for pid, storage_url in targets:
            cur.execute(
                "INSERT INTO processing_jobs (photo_id, storage_key) VALUES (%s, %s)",
                (pid, storage_url),
            )
        conn.commit()
        cur.close()
    return {"queued": len(targets), "deleted_embeddings": deleted_embeddings}


def status(album_id=None) -> dict:
    with db.connection() as conn:
        cur = conn.cursor()
        where = "WHERE album_id = %s" if album_id else ""
        cur.execute(f"SELECT processing_state, count(*) FROM photos {where} GROUP BY 1",
                    (album_id,) if album_id else ())
        states = dict(cur.fetchall())
        cur.execute("SELECT status, count(*) FROM processing_jobs GROUP BY 1")
        jobs = dict(cur.fetchall())
        cur.close()
    return {"photo_states": states, "job_states": jobs}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Reindex faces with the current pipeline")
    parser.add_argument("--album", help="album id")
    parser.add_argument("--photo", help="single photo id")
    parser.add_argument("--failed", action="store_true", help="only FAILED photos")
    parser.add_argument("--all", action="store_true", help="every photo")
    parser.add_argument("--status", action="store_true", help="just show progress")
    args = parser.parse_args()

    if args.status:
        print(status(args.album))
    elif args.photo or args.failed or args.album or args.all:
        print(reindex(album_id=args.album, photo_id=args.photo, failed_only=args.failed))
        print("queued; watch progress with: python reindex.py --status")
    else:
        parser.print_help()
