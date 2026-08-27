"""SCRFD-10G face detection with full-frame + tiled passes.

Coordinates returned by detect() are in the coordinate space of the image
passed in (the "inference image"); callers scale to original space.
"""

import numpy as np

from . import config
from .types import DetectedFace


class FaceDetector:
    """Interface: detect(image_bgr) -> list[DetectedFace]."""

    def detect(self, image_bgr: np.ndarray) -> list[DetectedFace]:  # pragma: no cover
        raise NotImplementedError


def _iou(a: np.ndarray, b: np.ndarray) -> float:
    x1 = max(a[0], b[0]); y1 = max(a[1], b[1])
    x2 = min(a[2], b[2]); y2 = min(a[3], b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    if inter <= 0:
        return 0.0
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    return float(inter / (area_a + area_b - inter))


def merge_detections(faces: list[DetectedFace], iou_threshold: float) -> list[DetectedFace]:
    """Greedy NMS keeping the highest-confidence duplicate (tile overlaps)."""
    faces = sorted(faces, key=lambda f: f.confidence, reverse=True)
    kept: list[DetectedFace] = []
    for face in faces:
        if all(_iou(face.bbox, k.bbox) < iou_threshold for k in kept):
            kept.append(face)
    return kept


class ScrfdDetector(FaceDetector):
    def __init__(self, model_path: str, providers: list[str]):
        from insightface.model_zoo import get_model

        self._model = get_model(model_path, providers=providers)
        ctx_id = 0 if "CUDAExecutionProvider" in providers else -1
        size = config.FACE_DET_INPUT
        self._model.prepare(ctx_id=ctx_id, input_size=(size, size), det_thresh=config.FACE_DET_THRESHOLD)

    def _detect_pass(self, image_bgr: np.ndarray) -> list[DetectedFace]:
        bboxes, kpss = self._model.detect(image_bgr)
        faces = []
        for bbox, kps in zip(bboxes, kpss if kpss is not None else []):
            faces.append(DetectedFace(
                bbox=np.asarray(bbox[:4], dtype=np.float32),
                confidence=float(bbox[4]),
                landmarks=np.asarray(kps, dtype=np.float32),
            ))
        return faces

    def detect(self, image_bgr: np.ndarray, tiling: bool | None = None) -> list[DetectedFace]:
        faces = self._detect_pass(image_bgr)

        use_tiling = config.FACE_DETECTION_TILING if tiling is None else tiling
        h, w = image_bgr.shape[:2]
        tile = config.FACE_TILE_SIZE
        # Tiles only add information when the full pass had to downscale.
        if use_tiling and max(h, w) > tile * 1.5:
            faces += self._detect_tiled(image_bgr)
            faces = merge_detections(faces, config.FACE_NMS_IOU)
        return faces

    def _detect_tiled(self, image_bgr: np.ndarray) -> list[DetectedFace]:
        h, w = image_bgr.shape[:2]
        tile = config.FACE_TILE_SIZE
        step = max(1, int(tile * (1.0 - config.FACE_TILE_OVERLAP)))

        xs = list(range(0, max(w - tile, 0) + 1, step)) or [0]
        ys = list(range(0, max(h - tile, 0) + 1, step)) or [0]
        if xs[-1] + tile < w:
            xs.append(w - tile)
        if ys[-1] + tile < h:
            ys.append(h - tile)

        coords = [(x, y) for y in ys for x in xs][: config.FACE_TILE_MAX]
        faces: list[DetectedFace] = []
        for x, y in coords:
            crop = image_bgr[y:y + tile, x:x + tile]
            for face in self._detect_pass(crop):
                # Faces cut in half by a tile edge are re-found whole by the
                # neighboring tile or the full pass; drop edge-clipped hits.
                bx1, by1, bx2, by2 = face.bbox
                margin = 2.0
                ch, cw = crop.shape[:2]
                clipped = (
                    (bx1 <= margin and x > 0)
                    or (by1 <= margin and y > 0)
                    or (bx2 >= cw - margin and x + tile < w)
                    or (by2 >= ch - margin and y + tile < h)
                )
                if clipped:
                    continue
                face.bbox = face.bbox + np.array([x, y, x, y], dtype=np.float32)
                face.landmarks = face.landmarks + np.array([x, y], dtype=np.float32)
                faces.append(face)
        return faces
