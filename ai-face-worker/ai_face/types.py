"""Shared datatypes for the face pipeline."""

from dataclasses import dataclass, field

import numpy as np


@dataclass
class DetectedFace:
    """One detector hit, in inference-image coordinates."""

    bbox: np.ndarray          # [x1, y1, x2, y2] float32
    confidence: float
    landmarks: np.ndarray     # (5, 2) float32

    @property
    def width(self) -> float:
        return float(self.bbox[2] - self.bbox[0])

    @property
    def height(self) -> float:
        return float(self.bbox[3] - self.bbox[1])


@dataclass
class FaceRecord:
    """A fully processed face ready for persistence."""

    embedding: np.ndarray     # (512,) float32, L2-normalized
    bbox_original: tuple      # (x, y, w, h) in original-image pixels
    bbox_preview: tuple       # (x, y, w, h) in preview-image pixels (UI contract)
    confidence: float
    face_width: int           # original-image pixels
    face_height: int
    blur_score: float
    quality_score: float
    aligned_crop: np.ndarray | None = None  # BGR 112x112, only if debug crops enabled


@dataclass
class FaceCandidate:
    """One face row from the album index, scored against a query."""

    face_id: str
    photo_id: str
    similarity: float          # to the primary query (selfie)
    quality: float
    centroid_sim: float = 0.0
    seed_sim: float = 0.0      # best similarity to any trusted event seed
    ref_support: int = 0       # references (selfies+seeds) above recovery
    tier: str = "REJECTED"     # CONFIDENT | LIKELY | WEAK | REJECTED


@dataclass
class SearchOutcome:
    photo_ids: list[str] = field(default_factory=list)
    confidence: str = "low"    # high | medium | low
    needs_second_selfie: bool = False
    seeds_used: int = 0
    tag_seeds_used: int = 0
    candidates: list[FaceCandidate] = field(default_factory=list)
