"""Indexing pipeline: original photo -> FaceRecords.

Original image (EXIF-corrected, never modified on disk)
    -> inference-sized copy (FACE_DETECTION_LONG_SIDE)
    -> SCRFD full pass + tiled pass, NMS merge
    -> 5-point alignment against the ORIGINAL resolution
    -> recognizer batch -> normalized embeddings
    -> quality metadata
"""

import os

import cv2
import numpy as np
from PIL import Image, ImageOps

from . import config, engine
from .align import align_face
from .quality import blur_score, is_usable, quality_score
from .types import DetectedFace, FaceRecord

Image.MAX_IMAGE_PIXELS = config.MAX_IMAGE_PIXELS


def load_image_bgr(path: str) -> np.ndarray:
    """EXIF-corrected BGR array. Raises on unreadable/oversized files."""
    with Image.open(path) as img:
        img = ImageOps.exif_transpose(img)
        if img.mode != "RGB":
            img = img.convert("RGB")
        rgb = np.asarray(img)
    return rgb[:, :, ::-1].copy()


def _resize_long_side(image: np.ndarray, long_side: int) -> tuple[np.ndarray, float]:
    """Returns (resized, scale) where original = resized / scale."""
    h, w = image.shape[:2]
    longest = max(h, w)
    if longest <= long_side:
        return image, 1.0
    scale = long_side / longest
    resized = cv2.resize(image, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    return resized, scale


def process_image(
    original_bgr: np.ndarray,
    preview_size: tuple[int, int] | None = None,
    keep_crops: bool = False,
) -> list[FaceRecord]:
    """Detect, align, and embed every usable face in the photo.

    preview_size: (width, height) of the UI preview image; bounding boxes are
    also expressed in that space to keep the existing frontend overlay contract.
    """
    detector = engine.get_detector()
    recognizer = engine.get_recognizer()

    orig_h, orig_w = original_bgr.shape[:2]
    inference_img, scale = _resize_long_side(original_bgr, config.FACE_DETECTION_LONG_SIDE)

    with engine.inference_semaphore:
        detections = detector.detect(inference_img)

    usable: list[tuple[DetectedFace, np.ndarray]] = []
    for det in detections:
        # Map to original coordinates for true face size + high-res alignment.
        bbox_orig = det.bbox / scale
        landmarks_orig = det.landmarks / scale
        face_w = int(round(bbox_orig[2] - bbox_orig[0]))
        face_h = int(round(bbox_orig[3] - bbox_orig[1]))
        if not is_usable(det.confidence, face_w, face_h):
            continue
        aligned = align_face(original_bgr, landmarks_orig)
        usable.append((det, aligned))

    if not usable:
        return []

    with engine.inference_semaphore:
        embeddings = recognizer.embed_batch([aligned for _, aligned in usable])

    if preview_size is not None:
        preview_scale_x = preview_size[0] / orig_w
        preview_scale_y = preview_size[1] / orig_h
    else:
        preview_scale_x = preview_scale_y = 1.0

    records: list[FaceRecord] = []
    for (det, aligned), embedding in zip(usable, embeddings):
        bbox_orig = det.bbox / scale
        x1, y1, x2, y2 = (float(v) for v in bbox_orig)
        face_w, face_h = int(round(x2 - x1)), int(round(y2 - y1))
        blur = blur_score(aligned)
        records.append(FaceRecord(
            embedding=embedding,
            bbox_original=(round(x1), round(y1), face_w, face_h),
            bbox_preview=(
                round(x1 * preview_scale_x),
                round(y1 * preview_scale_y),
                round((x2 - x1) * preview_scale_x),
                round((y2 - y1) * preview_scale_y),
            ),
            confidence=round(det.confidence, 4),
            face_width=face_w,
            face_height=face_h,
            blur_score=round(blur, 4),
            quality_score=quality_score(det.confidence, face_w, face_h, blur),
            aligned_crop=aligned if keep_crops else None,
        ))
    return records


def save_debug_crop(face_id: str, aligned_bgr: np.ndarray) -> None:
    os.makedirs(config.DEBUG_FACE_CROPS_DIR, exist_ok=True)
    cv2.imwrite(os.path.join(config.DEBUG_FACE_CROPS_DIR, f"{face_id}.webp"), aligned_bgr)


def detect_selfie_face(selfie_bgr: np.ndarray) -> tuple[DetectedFace | None, str | None]:
    """Best single face from a selfie.

    Returns (face, error_code). error_code is one of:
      no-face | multiple-faces | None
    Never tiles (selfies are single-subject) and never embeds a whole image
    when nothing is detected.
    """
    detector = engine.get_detector()
    resized, scale = _resize_long_side(selfie_bgr, 1280)
    with engine.inference_semaphore:
        detections = detector.detect(resized, tiling=False)
    if not detections:
        return None, "no-face"

    detections.sort(key=lambda d: d.width * d.height, reverse=True)
    best = detections[0]
    if len(detections) > 1:
        second = detections[1]
        ratio = (second.width * second.height) / max(1.0, best.width * best.height)
        if ratio >= config.FACE_SELFIE_AMBIGUITY_RATIO:
            return None, "multiple-faces"

    best.bbox = best.bbox / scale
    best.landmarks = best.landmarks / scale
    return best, None


def embed_selfie(selfie_bgr: np.ndarray) -> tuple[np.ndarray | None, str | None]:
    """(embedding, error_code) for the guest selfie."""
    face, error = detect_selfie_face(selfie_bgr)
    if face is None:
        return None, error
    aligned = align_face(selfie_bgr, face.landmarks)
    with engine.inference_semaphore:
        embedding = engine.get_recognizer().embed(aligned)
    return embedding, None
