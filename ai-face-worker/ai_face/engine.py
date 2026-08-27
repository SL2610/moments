"""Model loading, weight bootstrap, and bounded inference access.

Weights live in a mounted volume (MODELS_DIR) and are downloaded once on
first start, never per-start.
"""

import os
import threading
import urllib.request
import zipfile

from . import config

_BUFFALO_ZIP_URL = "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip"
_ADAFACE_URL = (
    "https://huggingface.co/Evn9172/cvlface_adaface_ir101_webface12m_onnx/resolve/main/adaface_ir101.onnx"
)

# Bounds simultaneous heavy inference calls (GPU memory safety). Cheap numpy
# matrix search is NOT gated by this.
inference_semaphore = threading.Semaphore(config.AI_INFERENCE_CONCURRENCY)

_lock = threading.Lock()
_detector = None
_recognizer = None


def providers() -> list[str]:
    if config.FACE_DEVICE == "cuda":
        return ["CUDAExecutionProvider", "CPUExecutionProvider"]
    return ["CPUExecutionProvider"]


def _download(url: str, dest: str) -> None:
    tmp = dest + ".part"
    print(f"[models] downloading {url} -> {dest}")
    urllib.request.urlretrieve(url, tmp)
    os.replace(tmp, dest)


def ensure_models() -> dict:
    """Idempotent: makes sure required weight files exist in MODELS_DIR."""
    os.makedirs(config.MODELS_DIR, exist_ok=True)
    det_path = os.path.join(config.MODELS_DIR, "det_10g.onnx")
    arcface_path = os.path.join(config.MODELS_DIR, "w600k_r50.onnx")
    adaface_path = os.path.join(config.MODELS_DIR, "adaface_ir101.onnx")

    if not os.path.isfile(det_path) or (
        config.FACE_RECOGNIZER == "arcface_w600k_r50" and not os.path.isfile(arcface_path)
    ):
        zip_path = os.path.join(config.MODELS_DIR, "buffalo_l.zip")
        _download(_BUFFALO_ZIP_URL, zip_path)
        with zipfile.ZipFile(zip_path) as zf:
            for name in zf.namelist():
                base = os.path.basename(name)
                if base in ("det_10g.onnx", "w600k_r50.onnx"):
                    with zf.open(name) as src, open(os.path.join(config.MODELS_DIR, base), "wb") as out:
                        out.write(src.read())
        os.remove(zip_path)

    if config.FACE_RECOGNIZER == "adaface_ir101" and not os.path.isfile(adaface_path):
        _download(_ADAFACE_URL, adaface_path)

    return {"detector": det_path, "adaface": adaface_path, "arcface": arcface_path}


def get_detector():
    """SCRFD-10G with 5-point landmarks (thread-safe singleton)."""
    global _detector
    with _lock:
        if _detector is None:
            paths = ensure_models()
            from .detector import ScrfdDetector

            _detector = ScrfdDetector(paths["detector"], providers())
            print(f"[models] detector ready: {config.DETECTOR_VERSION} on {config.FACE_DEVICE}")
        return _detector


def get_recognizer():
    global _recognizer
    with _lock:
        if _recognizer is None:
            paths = ensure_models()
            from .recognizer import AdaFaceOnnx, ArcFaceOnnx

            if config.FACE_RECOGNIZER == "adaface_ir101":
                _recognizer = AdaFaceOnnx(paths["adaface"], providers())
            elif config.FACE_RECOGNIZER == "arcface_w600k_r50":
                _recognizer = ArcFaceOnnx(paths["arcface"], providers())
            else:
                raise ValueError(f"Unknown FACE_RECOGNIZER: {config.FACE_RECOGNIZER}")
            print(f"[models] recognizer ready: {config.RECOGNIZER_VERSION} on {config.FACE_DEVICE}")
        return _recognizer
