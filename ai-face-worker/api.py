"""GrabPic face-search API v2.

Endpoints:
  POST /search           guest selfie -> two-stage identity search
  GET  /healthz
  /admin/*               debug + reindex; mounted ONLY when ADMIN_DEBUG_TOKEN
                         is set, guarded by X-Admin-Token (constant-time).

Guest privacy: the selfie is written to a temp file for decoding only and
deleted in a finally block. Only embeddings are kept, in memory, for at most
SESSION_TTL seconds (to support the optional second selfie).
"""

import asyncio
import functools
import os
import re
import secrets
import tempfile
import time
import uuid as uuid_module

import numpy as np
import requests as http_requests
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, File, Form, Header, Request, UploadFile  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from slowapi import Limiter  # noqa: E402
from slowapi.errors import RateLimitExceeded  # noqa: E402
from slowapi.util import get_remote_address  # noqa: E402

from ai_face import config, db, engine, pipeline  # noqa: E402
from ai_face.index import ReindexRequiredError, index_cache  # noqa: E402
from ai_face.search import run_search  # noqa: E402

SEARCH_TIMEOUT_SECS = 120
SESSION_TTL_SECS = 15 * 60
MAX_SESSIONS = 500
MAX_FILE_SIZE = 8 * 1024 * 1024

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)

TURNSTILE_SECRET = os.getenv("TURNSTILE_SECRET", "").strip()
TURNSTILE_ALLOWED_HOSTNAMES = {
    h.strip().lower() for h in os.getenv("TURNSTILE_ALLOWED_HOSTNAMES", "").split(",") if h.strip()
}
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
SEARCH_RATE_LIMIT = os.getenv("SEARCH_RATE_LIMIT", "6/minute")


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.headers.get("x-real-ip", "").strip() or get_remote_address(request)


limiter = Limiter(key_func=_client_ip)
app = FastAPI()
app.state.limiter = limiter

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type", "X-Turnstile-Token", "X-Admin-Token"],
)


def err(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": message, "code": code})


@app.exception_handler(RateLimitExceeded)
async def _rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return err(429, "rate-limited", "Too many search requests. Please wait a moment.")


# ------------------------------------------------------------- selfie session
# In-memory store of selfie EMBEDDINGS (never images) for the optional second
# selfie. Single-process service; entries expire after SESSION_TTL_SECS.
_sessions: dict[str, dict] = {}


def _session_put(search_id: str, embeddings: list) -> None:
    now = time.monotonic()
    for key in [k for k, v in _sessions.items() if now - v["at"] > SESSION_TTL_SECS]:
        _sessions.pop(key, None)
    while len(_sessions) >= MAX_SESSIONS:
        _sessions.pop(next(iter(_sessions)), None)
    _sessions[search_id] = {"embeddings": embeddings, "at": now}


def _session_get(search_id: str | None) -> list:
    if not search_id:
        return []
    entry = _sessions.get(search_id)
    if entry is None or time.monotonic() - entry["at"] > SESSION_TTL_SECS:
        return []
    return list(entry["embeddings"])


# ----------------------------------------------------------------- validation
def _validate_image_bytes(content: bytes) -> bool:
    if len(content) < 12:
        return False
    if content[:3] == b"\xff\xd8\xff":
        return True
    if content[:8] == b"\x89PNG\r\n\x1a\n":
        return True
    return content[:4] == b"RIFF" and content[8:12] == b"WEBP"


def _is_human(token: str | None, remote_ip: str | None) -> bool:
    if not TURNSTILE_SECRET:
        return True
    if not token:
        return False
    payload = {"secret": TURNSTILE_SECRET, "response": token}
    if remote_ip:
        payload["remoteip"] = remote_ip
    try:
        data = http_requests.post(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify", data=payload, timeout=5
        ).json()
        if not bool(data.get("success")):
            return False
        if TURNSTILE_ALLOWED_HOSTNAMES:
            return str(data.get("hostname", "")).strip().lower() in TURNSTILE_ALLOWED_HOSTNAMES
        return True
    except Exception:
        return False


@app.on_event("startup")
def _warm_up():
    engine.get_detector()
    engine.get_recognizer()
    print(f"[+] face engine v{config.FACE_PIPELINE_VERSION} ready "
          f"({config.DETECTOR_VERSION} + {config.RECOGNIZER_VERSION}, device={config.FACE_DEVICE}, "
          f"inference concurrency={config.AI_INFERENCE_CONCURRENCY})")


@app.get("/healthz")
def healthz():
    return {"ok": True, "pipeline": config.FACE_PIPELINE_VERSION, "recognizer": config.RECOGNIZER_VERSION}


def _read_selfie_embedding(content: bytes):
    """Decode + embed a selfie from raw bytes. Temp file removed in finally."""
    temp = tempfile.NamedTemporaryFile(delete=False, suffix=".img")
    try:
        temp.write(content)
        temp.close()
        try:
            selfie_bgr = pipeline.load_image_bgr(temp.name)
        except Exception:
            return None, "invalid-image"
        return pipeline.embed_selfie(selfie_bgr)
    finally:
        temp.close()
        if os.path.exists(temp.name):
            os.remove(temp.name)


@app.post("/search")
@limiter.limit(SEARCH_RATE_LIMIT)
async def search_faces(
    request: Request,
    album_id: str = Form(...),
    file: UploadFile = File(...),
    search_id: str | None = Form(None),
    guest_id: str | None = Form(None),
):
    if not UUID_RE.match(album_id or ""):
        return err(400, "invalid-album", "Invalid album.")
    if guest_id and not UUID_RE.match(guest_id):
        guest_id = None
    if search_id and not UUID_RE.match(search_id):
        search_id = None

    if not _is_human(request.headers.get("x-turnstile-token"), _client_ip(request)):
        return err(403, "bot-check-failed", "Bot check failed.")

    if file.content_type not in ("image/jpeg", "image/png", "image/webp"):
        return err(400, "invalid-file-type", "Please upload a JPEG, PNG, or WebP image.")
    content = await file.read(MAX_FILE_SIZE + 1)
    if len(content) > MAX_FILE_SIZE:
        return err(400, "file-too-large", "Selfie is too large (max 8 MB).")
    if len(content) == 0:
        return err(400, "empty-file", "Empty file.")
    if not _validate_image_bytes(content):
        return err(400, "invalid-image", "Not a valid image file.")

    loop = asyncio.get_running_loop()
    try:
        embedding, code = await asyncio.wait_for(
            loop.run_in_executor(None, functools.partial(_read_selfie_embedding, content)),
            timeout=SEARCH_TIMEOUT_SECS,
        )
        if embedding is None:
            messages = {
                "no-face": "No face detected in the photo.",
                "multiple-faces": "Multiple prominent faces detected; use a photo of just you.",
                "invalid-image": "Could not read the image.",
            }
            return err(400, code or "invalid-image", messages.get(code, "Could not process the photo."))

        selfie_embeddings = _session_get(search_id) + [embedding]
        outcome = await asyncio.wait_for(
            loop.run_in_executor(
                None, functools.partial(run_search, album_id, selfie_embeddings, guest_id)
            ),
            timeout=SEARCH_TIMEOUT_SECS,
        )
    except asyncio.TimeoutError:
        return err(408, "search-timeout", "Face search timed out. Please try again.")
    except ReindexRequiredError as e:
        print(f"[ERROR] reindex required: {e}")
        return err(503, "reindex-required",
                   "The photo index is being rebuilt. Please try again soon.")
    except Exception as e:
        print(f"[ERROR] search failed: {type(e).__name__}: {e}")
        return err(500, "search-failed", "Something went wrong during the search.")

    new_search_id = search_id or str(uuid_module.uuid4())
    _session_put(new_search_id, selfie_embeddings)

    print(f"[search] album={album_id} guest={guest_id or '-'} selfies={len(selfie_embeddings)} "
          f"seeds={outcome.seeds_used} (tags={outcome.tag_seeds_used}) "
          f"matches={len(outcome.photo_ids)} confidence={outcome.confidence}")
    return {
        "matched_photo_ids": outcome.photo_ids,
        "search_id": new_search_id,
        "confidence": outcome.confidence,
        "needs_second_selfie": outcome.needs_second_selfie,
    }


# =====================================================================
# Admin: debugging + reindex. Mounted only when ADMIN_DEBUG_TOKEN is set.
# =====================================================================
def _admin_guard(token_header: str | None):
    if not token_header or not secrets.compare_digest(token_header, config.ADMIN_DEBUG_TOKEN):
        return err(403, "forbidden", "Invalid admin token.")
    return None


if config.ADMIN_DEBUG_TOKEN:

    @app.get("/admin/photos/{photo_id}/faces")
    def admin_photo_faces(photo_id: str, x_admin_token: str | None = Header(None)):
        denied = _admin_guard(x_admin_token)
        if denied is not None:
            return denied
        if not UUID_RE.match(photo_id):
            return err(400, "invalid-photo", "Invalid photo id.")
        with db.connection() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT p.processing_state, p.processing_error, p.face_count,
                       p.detector_version, p.recognizer_version
                FROM photos p WHERE p.id = %s
                """,
                (photo_id,),
            )
            photo = cur.fetchone()
            if photo is None:
                cur.close()
                return err(404, "not-found", "Photo not found.")
            cur.execute(
                """
                SELECT id, box_area, detector_confidence, face_width, face_height,
                       quality_score, detector_version, recognizer_version
                FROM photo_embeddings WHERE photo_id = %s ORDER BY quality_score DESC NULLS LAST
                """,
                (photo_id,),
            )
            faces = cur.fetchall()
            cur.close()
        return {
            "photo_id": photo_id,
            "processing_state": photo[0],
            "processing_error": photo[1],
            "face_count": photo[2],
            "detector_version": photo[3],
            "recognizer_version": photo[4],
            "faces": [
                {
                    "face_id": str(f[0]),
                    "box_preview": f[1],
                    "detector_confidence": f[2],
                    "face_width": f[3],
                    "face_height": f[4],
                    "quality_score": f[5],
                    "detector_version": f[6],
                    "recognizer_version": f[7],
                }
                for f in faces
            ],
        }

    @app.post("/admin/search-debug")
    async def admin_search_debug(
        album_id: str = Form(...),
        file: UploadFile = File(...),
        x_admin_token: str | None = Header(None),
    ):
        denied = _admin_guard(x_admin_token)
        if denied is not None:
            return denied
        if not UUID_RE.match(album_id):
            return err(400, "invalid-album", "Invalid album.")
        content = await file.read(MAX_FILE_SIZE)
        loop = asyncio.get_running_loop()
        embedding, code = await loop.run_in_executor(
            None, functools.partial(_read_selfie_embedding, content)
        )
        if embedding is None:
            return err(400, code or "invalid-image", f"selfie error: {code}")
        try:
            index = index_cache.get(album_id)
        except ReindexRequiredError as e:
            return err(503, "reindex-required", str(e))
        sims = index.similarities(embedding)
        order = np.argsort(sims)[::-1][:20]
        with db.connection() as conn:
            cur = conn.cursor()
            boxes = {}
            for i in order:
                cur.execute(
                    "SELECT box_area FROM photo_embeddings WHERE id = %s",
                    (index.face_ids[int(i)],),
                )
                row = cur.fetchone()
                boxes[index.face_ids[int(i)]] = row[0] if row else None
            cur.close()
        return {
            "thresholds": {
                "strict": config.FACE_STRICT_THRESHOLD,
                "recovery": config.FACE_RECOVERY_THRESHOLD,
            },
            "top_matches": [
                {
                    "face_id": index.face_ids[int(i)],
                    "photo_id": index.photo_ids[int(i)],
                    "similarity": round(float(sims[int(i)]), 4),
                    "quality": round(float(index.qualities[int(i)]), 4),
                    "box_preview": boxes.get(index.face_ids[int(i)]),
                }
                for i in order
            ],
        }

    @app.post("/admin/reindex")
    def admin_reindex(payload: dict, x_admin_token: str | None = Header(None)):
        denied = _admin_guard(x_admin_token)
        if denied is not None:
            return denied
        from reindex import reindex

        result = reindex(
            album_id=payload.get("album_id"),
            photo_id=payload.get("photo_id"),
            failed_only=bool(payload.get("failed_only")),
        )
        index_cache.invalidate(payload.get("album_id"))
        return result

    @app.get("/admin/reindex/status")
    def admin_reindex_status(album_id: str, x_admin_token: str | None = Header(None)):
        denied = _admin_guard(x_admin_token)
        if denied is not None:
            return denied
        if not UUID_RE.match(album_id):
            return err(400, "invalid-album", "Invalid album.")
        with db.connection() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT processing_state, count(*) FROM photos WHERE album_id = %s GROUP BY 1",
                (album_id,),
            )
            states = dict(cur.fetchall())
            cur.execute(
                """
                SELECT j.status, count(*) FROM processing_jobs j
                JOIN photos p ON p.id = j.photo_id WHERE p.album_id = %s GROUP BY 1
                """,
                (album_id,),
            )
            jobs = dict(cur.fetchall())
            cur.close()
        return {"photo_states": states, "job_states": jobs}


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "5000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
