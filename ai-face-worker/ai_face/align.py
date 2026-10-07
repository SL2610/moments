"""Standard 5-point face alignment to the 112x112 ArcFace template."""

import numpy as np
from insightface.utils import face_align


def align_face(image_bgr: np.ndarray, landmarks: np.ndarray) -> np.ndarray:
    """Similarity-transform crop; landmarks are (5,2) in image coordinates."""
    return face_align.norm_crop(image_bgr, np.asarray(landmarks, dtype=np.float32))
