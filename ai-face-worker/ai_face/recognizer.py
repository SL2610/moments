"""Face recognizers. All backends return L2-normalized 512-d float32 vectors
from aligned 112x112 BGR crops."""

import numpy as np


def l2_normalize(vectors: np.ndarray) -> np.ndarray:
    """Row-wise L2 normalization; zero vectors stay zero instead of NaN."""
    vectors = np.asarray(vectors, dtype=np.float32)
    single = vectors.ndim == 1
    if single:
        vectors = vectors[None]
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms = np.where(norms == 0, 1.0, norms)
    out = vectors / norms
    return out[0] if single else out


class FaceRecognizer:
    """Interface: embed_batch(aligned_bgr_faces) -> (N, 512) normalized."""

    version: str = "unknown"

    def embed_batch(self, aligned_faces: list[np.ndarray]) -> np.ndarray:  # pragma: no cover
        raise NotImplementedError

    def embed(self, aligned_face: np.ndarray) -> np.ndarray:
        return self.embed_batch([aligned_face])[0]


class AdaFaceOnnx(FaceRecognizer):
    """AdaFace IR-101 (WebFace12M). Preprocessing: BGR, (x/255 - 0.5) / 0.5."""

    version = "adaface_ir101_webface12m"

    def __init__(self, model_path: str, providers: list[str]):
        import onnxruntime as ort

        self._session = ort.InferenceSession(model_path, providers=providers)
        self._input = self._session.get_inputs()[0].name

    def embed_batch(self, aligned_faces: list[np.ndarray]) -> np.ndarray:
        batch = np.stack([f.astype(np.float32) for f in aligned_faces])
        batch = (batch / 255.0 - 0.5) / 0.5
        batch = batch.transpose(0, 3, 1, 2)  # NHWC(BGR) -> NCHW
        out = self._session.run(None, {self._input: batch})[0]
        return l2_normalize(np.asarray(out, dtype=np.float32)[:, :512])


class ArcFaceOnnx(FaceRecognizer):
    """insightface w600k_r50 fallback backend (auto-downloadable pack)."""

    version = "arcface_w600k_r50"

    def __init__(self, model_path: str, providers: list[str]):
        from insightface.model_zoo import get_model

        self._model = get_model(model_path, providers=providers)
        ctx_id = 0 if "CUDAExecutionProvider" in providers else -1
        self._model.prepare(ctx_id=ctx_id)

    def embed_batch(self, aligned_faces: list[np.ndarray]) -> np.ndarray:
        vectors = [self._model.get_feat(face).flatten() for face in aligned_faces]
        return l2_normalize(np.stack(vectors))
