"""Face quality scoring and usability tiers.

Tiers:
  unusable   -> not embedded at all (too small / too low confidence)
  searchable -> embedded and searchable, but never trusted as an identity seed
  anchor     -> may become an identity-template seed (gated again by
                FACE_MIN_SEED_QUALITY at search time)
"""

import cv2
import numpy as np

from . import config


def blur_score(aligned_bgr: np.ndarray) -> float:
    """Variance of Laplacian mapped to [0, 1]; higher = sharper."""
    gray = cv2.cvtColor(aligned_bgr, cv2.COLOR_BGR2GRAY)
    variance = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    # ~0 for flat/blurred crops; wedding-sharp crops land in the hundreds.
    return float(min(1.0, variance / 300.0))


def quality_score(det_confidence: float, face_width: int, face_height: int, blur: float) -> float:
    """Blend of detector confidence, face size, and sharpness, in [0, 1]."""
    size = min(face_width, face_height)
    # 20px -> ~0, 60px -> ~0.5, 160px+ -> ~1
    size_term = float(np.clip((size - 20) / 140.0, 0.0, 1.0))
    conf_term = float(np.clip((det_confidence - 0.5) / 0.5, 0.0, 1.0))
    return round(0.45 * conf_term + 0.35 * size_term + 0.20 * blur, 4)


def is_usable(det_confidence: float, face_width: int, face_height: int) -> bool:
    if min(face_width, face_height) < config.FACE_MIN_SIZE_PX:
        return False
    return det_confidence >= config.FACE_MIN_DET_CONFIDENCE
