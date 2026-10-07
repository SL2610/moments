"""Face pipeline configuration. All knobs are environment variables."""

import os


def _f(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, "") or default)
    except ValueError:
        return default


def _i(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "") or default)
    except ValueError:
        return default


def _b(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


# ---------------------------------------------------------------- versions
FACE_PIPELINE_VERSION = 2
DETECTOR_VERSION = "scrfd_10g_buffalo_l"
# The active recognizer's version string is derived from FACE_RECOGNIZER below.

# ---------------------------------------------------------------- models
FACE_RECOGNIZER = os.getenv("FACE_RECOGNIZER", "adaface_ir101")  # adaface_ir101 | arcface_w600k_r50
FACE_DEVICE = os.getenv("FACE_DEVICE", "cpu")  # cuda | cpu
MODELS_DIR = os.getenv("FACE_MODELS_DIR", "/models/face")

RECOGNIZER_VERSIONS = {
    "adaface_ir101": "adaface_ir101_webface12m",
    "arcface_w600k_r50": "arcface_w600k_r50",
}
RECOGNIZER_VERSION = RECOGNIZER_VERSIONS.get(FACE_RECOGNIZER, FACE_RECOGNIZER)

# ---------------------------------------------------------------- detection
# The original photo is resized (EXIF-corrected) to this long side before
# detection; originals are never modified.
FACE_DETECTION_LONG_SIDE = _i("FACE_DETECTION_LONG_SIDE", 2400)
# SCRFD det_10g is exported at 640x640; larger inputs measurably lose recall
# (verified empirically), so the full-frame pass letterboxes to 640 and small
# faces are recovered by 640px tiles instead of a bigger single pass.
FACE_DET_INPUT = _i("FACE_DET_INPUT", 640)
FACE_DET_THRESHOLD = _f("FACE_DET_THRESHOLD", 0.5)
FACE_DETECTION_TILING = _b("FACE_DETECTION_TILING", True)
# NOTE: diverges from the spec's 1280 example on purpose: tiles are run at the
# detector's native 640 so tile content is never downscaled.
FACE_TILE_SIZE = _i("FACE_TILE_SIZE", 640)
FACE_TILE_OVERLAP = _f("FACE_TILE_OVERLAP", 0.20)
FACE_TILE_MAX = _i("FACE_TILE_MAX", 40)  # safety cap per photo
FACE_NMS_IOU = _f("FACE_NMS_IOU", 0.45)

# Pillow decompression-bomb ceiling. Photos above this FAIL loudly (never
# silently marked processed).
MAX_IMAGE_PIXELS = _i("FACE_MAX_IMAGE_PIXELS", 300_000_000)

# ---------------------------------------------------------------- quality
FACE_MIN_SIZE_PX = _i("FACE_MIN_SIZE_PX", 20)          # below this (original px): unusable
FACE_MIN_DET_CONFIDENCE = _f("FACE_MIN_DET_CONFIDENCE", 0.50)

# ---------------------------------------------------------------- search
# UN-CALIBRATED DEVELOPMENT DEFAULTS. Run calibrate.py on event data and set
# these in .env. Cosine similarity on L2-normalized embeddings.
FACE_STRICT_THRESHOLD = _f("FACE_STRICT_THRESHOLD", 0.45)
FACE_RECOVERY_THRESHOLD = _f("FACE_RECOVERY_THRESHOLD", 0.34)
FACE_MIN_SEED_QUALITY = _f("FACE_MIN_SEED_QUALITY", 0.45)
FACE_STRICT_TOP_K = _i("FACE_STRICT_TOP_K", 100)
FACE_MAX_SEEDS = _i("FACE_MAX_SEEDS", 8)
FACE_MIN_SEEDS_FOR_CONFIDENCE = _i("FACE_MIN_SEEDS_FOR_CONFIDENCE", 2)
MAX_TEMPLATE_EXPANSION_ROUNDS = 1  # by design; see anti-contamination rules
# Near-duplicate seeds add no information; skip a candidate seed more similar
# than this to an already-chosen seed.
FACE_SEED_DIVERSITY_MAX_SIM = _f("FACE_SEED_DIVERSITY_MAX_SIM", 0.95)
# A second prominent face at least this fraction of the largest face's area
# means the selfie is ambiguous.
FACE_SELFIE_AMBIGUITY_RATIO = _f("FACE_SELFIE_AMBIGUITY_RATIO", 0.55)
FACE_MAX_RESULTS = _i("FACE_MAX_RESULTS", 500)

# ---------------------------------------------------------------- runtime
AI_INFERENCE_CONCURRENCY = _i("AI_INFERENCE_CONCURRENCY", _i("AI_WORKER_CONCURRENCY", 2))
PHOTO_PROCESS_TIMEOUT_SECS = _i("PHOTO_PROCESS_TIMEOUT_SECS", 300)
STORE_DEBUG_FACE_CROPS = _b("STORE_DEBUG_FACE_CROPS", False)
DEBUG_FACE_CROPS_DIR = os.getenv("DEBUG_FACE_CROPS_DIR", "/data/photos/debug/faces")
ADMIN_DEBUG_TOKEN = os.getenv("ADMIN_DEBUG_TOKEN", "").strip()

STORAGE_PATH = os.getenv("STORAGE_PATH", "/data/photos")
