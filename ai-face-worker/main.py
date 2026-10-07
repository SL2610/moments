"""GrabPic AI worker v2: PostgreSQL job queue -> derivatives -> face pipeline.

Face engine: SCRFD-10G detection (full + tiled) -> 5-point alignment ->
AdaFace IR101 -> normalized 512-d embeddings + quality metadata.

Processing-state contract (photos.processing_state):
  PENDING -> PROCESSING -> READY      (faces found)
                        -> NO_FACES   (valid image, genuinely no faces)
                        -> FAILED     (any error/timeout, after retries)
A failed photo is NEVER marked processed. The legacy `photos.processed`
boolean is kept in sync (true only for READY/NO_FACES) for the product UI.
"""

import json
import os
import signal
import time
import traceback

from PIL import Image, ImageOps
from dotenv import load_dotenv

load_dotenv()

from ai_face import config, db, engine, pipeline  # noqa: E402

STORAGE_PATH = config.STORAGE_PATH
JOB_MAX_ATTEMPTS = int(os.getenv("JOB_MAX_ATTEMPTS", "3"))
POLL_INTERVAL_SECS = 3
STALE_PROCESSING_MINUTES = 15

PREVIEW_MAX_EDGE = 2000
THUMBNAIL_MAX_EDGE = 480


class ProcessTimeout(Exception):
    pass


def _timeout_handler(signum, frame):
    raise ProcessTimeout(f"processing timed out after {config.PHOTO_PROCESS_TIMEOUT_SECS}s")


def _derivative_path(storage_key: str, variant_dir: str) -> str:
    directory, filename = storage_key.rsplit("/", 1)
    stem = filename.rsplit(".", 1)[0]
    return os.path.join(STORAGE_PATH, directory, variant_dir, f"{stem}.webp")


def generate_derivatives(storage_key: str) -> tuple[int, int]:
    """Preview + thumbnail WebPs (EXIF orientation applied).

    Returns the preview (width, height): the coordinate space the UI draws
    face boxes in.
    """
    original_path = os.path.join(STORAGE_PATH, storage_key)
    preview_path = _derivative_path(storage_key, "previews")
    thumb_path = _derivative_path(storage_key, "thumbnails")

    with Image.open(original_path) as img:
        img = ImageOps.exif_transpose(img)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")

        os.makedirs(os.path.dirname(preview_path), exist_ok=True)
        os.makedirs(os.path.dirname(thumb_path), exist_ok=True)

        preview = img.copy()
        preview.thumbnail((PREVIEW_MAX_EDGE, PREVIEW_MAX_EDGE))
        preview.save(preview_path, "WEBP", quality=85)
        preview_size = preview.size

        thumb = img.copy()
        thumb.thumbnail((THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_EDGE))
        thumb.save(thumb_path, "WEBP", quality=80)

    return preview_size


def claim_job(conn):
    cur = conn.cursor()
    cur.execute(
        """
        UPDATE processing_jobs
        SET status = 'PROCESSING', attempts = attempts + 1, updated_at = now()
        WHERE id = (
            SELECT id FROM processing_jobs
            WHERE status = 'PENDING'
               OR (status = 'PROCESSING' AND updated_at < now() - interval '%s minutes')
            ORDER BY created_at
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        )
        RETURNING id, photo_id, storage_key, attempts
        """
        % STALE_PROCESSING_MINUTES
    )
    job = cur.fetchone()
    conn.commit()
    cur.close()
    return job


def finish_job(conn, job_id, status, error=None):
    cur = conn.cursor()
    cur.execute(
        "UPDATE processing_jobs SET status = %s, last_error = %s, updated_at = now() WHERE id = %s",
        (status, error, job_id),
    )
    conn.commit()
    cur.close()


def set_photo_state(conn, photo_id, state, error=None, face_count=None):
    """Single point of truth for state transitions; keeps `processed` in sync."""
    processed = state in ("READY", "NO_FACES")
    cur = conn.cursor()
    cur.execute(
        """
        UPDATE photos SET
            processing_state = %s,
            processing_error = %s,
            face_count = %s,
            processed = %s,
            processed_at = CASE WHEN %s THEN now() ELSE processed_at END,
            processing_attempts = processing_attempts + CASE WHEN %s = 'PROCESSING' THEN 1 ELSE 0 END,
            detector_version = %s,
            recognizer_version = %s
        WHERE id = %s
        """,
        (
            state, error, face_count, processed, processed, state,
            config.DETECTOR_VERSION, config.RECOGNIZER_VERSION, photo_id,
        ),
    )
    conn.commit()
    cur.close()


def process_photo(conn, photo_id, storage_key):
    cur = conn.cursor()
    cur.execute("SELECT id FROM photos WHERE id = %s", (photo_id,))
    exists = cur.fetchone() is not None
    cur.close()
    if not exists:
        print(f"    -> Skipping: photo {photo_id} no longer exists")
        return

    original_path = os.path.join(STORAGE_PATH, storage_key)
    if not os.path.isfile(original_path):
        raise FileNotFoundError(f"photo file missing: {storage_key}")

    set_photo_state(conn, photo_id, "PROCESSING")

    preview_size = generate_derivatives(storage_key)
    original_bgr = pipeline.load_image_bgr(original_path)
    h, w = original_bgr.shape[:2]
    print(f"    -> {w}x{h}, preview {preview_size[0]}x{preview_size[1]}")

    records = pipeline.process_image(
        original_bgr,
        preview_size=preview_size,
        keep_crops=config.STORE_DEBUG_FACE_CROPS,
    )
    print(f"    -> {len(records)} usable faces "
          f"(qualities: {[r.quality_score for r in records][:10]})")

    cur = conn.cursor()
    try:
        # Idempotent on retry/reindex: replace any embeddings for this photo.
        cur.execute("DELETE FROM photo_embeddings WHERE photo_id = %s", (photo_id,))
        for record in records:
            x, y, bw, bh = record.bbox_preview
            box_json = json.dumps({
                "x": x, "y": y, "w": bw, "h": bh,
                "confidence": record.confidence,
                "quality": record.quality_score,
                "blur": record.blur_score,
            })
            cur.execute(
                """
                INSERT INTO photo_embeddings
                    (photo_id, embedding, box_area, detector_confidence,
                     face_width, face_height, quality_score,
                     detector_version, recognizer_version)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    photo_id,
                    db.vector_literal(record.embedding),
                    box_json,
                    record.confidence,
                    record.face_width,
                    record.face_height,
                    record.quality_score,
                    config.DETECTOR_VERSION,
                    config.RECOGNIZER_VERSION,
                ),
            )
            face_id = cur.fetchone()[0]
            if config.STORE_DEBUG_FACE_CROPS and record.aligned_crop is not None:
                try:
                    pipeline.save_debug_crop(str(face_id), record.aligned_crop)
                except Exception as crop_err:
                    print(f"    -> debug crop failed (non-fatal): {crop_err}")
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()

    state = "READY" if records else "NO_FACES"
    set_photo_state(conn, photo_id, state, face_count=len(records))
    print(f"    -> {state} ({len(records)} faces)")


def main():
    print(f"GrabPic AI worker v2 | pipeline v{config.FACE_PIPELINE_VERSION} | "
          f"{config.DETECTOR_VERSION} + {config.RECOGNIZER_VERSION} | device={config.FACE_DEVICE}")
    engine.get_detector()
    engine.get_recognizer()
    print("[+] models warmed up")

    while True:
        try:
            with db.connection() as conn:
                job = claim_job(conn)
                if job is None:
                    time.sleep(POLL_INTERVAL_SECS)
                    continue

                job_id, photo_id, storage_key, attempts = job
                print(f"\n[+] Processing photo {photo_id} (attempt {attempts})")
                try:
                    signal.signal(signal.SIGALRM, _timeout_handler)
                    signal.alarm(config.PHOTO_PROCESS_TIMEOUT_SECS)
                    process_photo(conn, photo_id, storage_key)
                    signal.alarm(0)
                    finish_job(conn, job_id, "COMPLETED")
                except Exception as e:
                    signal.alarm(0)
                    conn.rollback()
                    error = f"{type(e).__name__}: {e}"[:500]
                    traceback.print_exc()
                    if attempts >= JOB_MAX_ATTEMPTS:
                        finish_job(conn, job_id, "FAILED", error)
                        set_photo_state(conn, photo_id, "FAILED", error=error)
                        print(f"    -> FAILED after {attempts} attempts: {error}")
                    else:
                        finish_job(conn, job_id, "PENDING", error)
                        set_photo_state(conn, photo_id, "PENDING", error=error)
                        print(f"    -> errored, will retry: {error}")
                finally:
                    signal.alarm(0)
        except Exception as loop_err:
            print(f"Worker loop error: {loop_err}")
            time.sleep(POLL_INTERVAL_SECS)


if __name__ == "__main__":
    main()
