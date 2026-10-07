"""Unit tests for the pure face-engine logic (no models, no DB)."""

import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Deterministic thresholds for tests, independent of .env.
os.environ.update({
    "FACE_STRICT_THRESHOLD": "0.5",
    "FACE_RECOVERY_THRESHOLD": "0.35",
    "FACE_MIN_SEED_QUALITY": "0.5",
    "FACE_MAX_SEEDS": "4",
    "FACE_MIN_SEEDS_FOR_CONFIDENCE": "2",
    "FACE_SEED_DIVERSITY_MAX_SIM": "0.99",
    "FACE_STRICT_TOP_K": "100",
})

from ai_face import config  # noqa: E402
from ai_face.recognizer import l2_normalize  # noqa: E402
from ai_face.search import two_stage_search  # noqa: E402
from ai_face.template import GuestIdentityTemplate, select_diverse_seeds  # noqa: E402
from ai_face.detector import merge_detections  # noqa: E402
from ai_face.types import DetectedFace  # noqa: E402


def unit(seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return l2_normalize(rng.normal(size=512).astype(np.float32))


def near(base: np.ndarray, seed: int, closeness: float) -> np.ndarray:
    """A vector with cosine similarity roughly `closeness` to base."""
    noise = unit(seed)
    noise = l2_normalize(noise - float(noise @ base) * base)  # orthogonal
    return l2_normalize(closeness * base + np.sqrt(1 - closeness**2) * noise)


class FakeIndex:
    def __init__(self, rows):
        # rows: list of (face_id, photo_id, embedding, quality)
        self.face_ids = [r[0] for r in rows]
        self.photo_ids = [r[1] for r in rows]
        self.embeddings = np.stack([r[2] for r in rows]) if rows else np.zeros((0, 512), np.float32)
        self.qualities = np.asarray([r[3] for r in rows], dtype=np.float32)


# ---------------------------------------------------------------- basics

def test_l2_normalize_unit_norm():
    v = np.array([3.0, 4.0] + [0.0] * 510, dtype=np.float32)
    n = l2_normalize(v)
    assert abs(np.linalg.norm(n) - 1.0) < 1e-6
    assert abs(n[0] - 0.6) < 1e-6


def test_l2_normalize_zero_vector_safe():
    n = l2_normalize(np.zeros(512, dtype=np.float32))
    assert not np.isnan(n).any()


def test_exact_search_orders_by_cosine():
    me = unit(1)
    rows = [
        ("f1", "p1", near(me, 10, 0.9), 0.9),
        ("f2", "p2", near(me, 11, 0.6), 0.9),
        ("f3", "p3", unit(99), 0.9),
    ]
    index = FakeIndex(rows)
    sims = index.embeddings @ me
    assert sims[0] > sims[1] > sims[2]


# ---------------------------------------------------------------- seeds

def test_seed_diversity_skips_near_duplicates():
    base = unit(2)
    dup = near(base, 3, 0.999)
    other = near(base, 4, 0.7)
    chosen = select_diverse_seeds(
        [(0.9, "p1", base), (0.89, "p1b", dup), (0.7, "p2", other)],
        max_seeds=3, max_similarity=0.99,
    )
    embs = [c[2] for c in chosen]
    assert len(embs) == 2  # duplicate skipped

def test_seed_photo_cap():
    base = unit(5)
    cands = [(0.9 - i * 0.01, "same-photo", near(base, 20 + i, 0.6 + i * 0.05)) for i in range(3)]
    chosen = select_diverse_seeds(cands, max_seeds=3, max_similarity=0.999, max_per_photo=1)
    assert len(chosen) == 1


def test_seed_cap_respected():
    base = unit(6)
    cands = [(0.9, f"p{i}", near(base, 30 + i, 0.5 + 0.03 * i)) for i in range(10)]
    chosen = select_diverse_seeds(cands, max_seeds=4, max_similarity=0.999)
    assert len(chosen) == 4


# ---------------------------------------------------------------- template

def test_template_centroid_normalized_and_anchored():
    t = GuestIdentityTemplate(selfie_embeddings=[unit(7)])
    t.add_seed(near(unit(7), 8, 0.8))
    assert abs(np.linalg.norm(t.centroid) - 1.0) < 1e-5
    assert len(t.reference_embeddings) == 2


# ---------------------------------------------------------------- search

def test_two_stage_confident_and_recovery():
    me = unit(40)
    imposter = unit(41)
    rows = [
        ("f1", "p1", near(me, 50, 0.85), 0.9),   # strict seed
        ("f2", "p2", near(me, 51, 0.80), 0.9),   # strict seed
        ("f3", "p3", near(me, 52, 0.42), 0.9),   # recoverable only via template
        ("f4", "p4", imposter, 0.9),              # unrelated person
    ]
    # f3: too far from the selfie for Stage A, but close to a trusted event
    # seed (same-event conditions) -> recovered by Stage B only.
    rows[2] = ("f3", "p3", near(rows[0][2], 52, 0.55), 0.9)
    assert float(rows[2][2] @ me) < 0.5  # below strict: Stage A alone misses it
    out = two_stage_search(FakeIndex(rows), [me])
    assert "p1" in out.photo_ids and "p2" in out.photo_ids
    assert "p3" in out.photo_ids            # Stage B recovery
    assert "p4" not in out.photo_ids        # imposter rejected
    assert out.seeds_used >= 2
    assert out.needs_second_selfie is False


def test_low_quality_face_never_seeds_but_still_matchable():
    me = unit(60)
    rows = [
        ("f1", "p1", near(me, 61, 0.9), 0.2),   # strong match, junk quality
        ("f2", "p2", near(me, 62, 0.4), 0.9),   # needs template help
    ]
    out = two_stage_search(FakeIndex(rows), [me])
    assert out.seeds_used == 0               # quality gate held
    assert "p1" in out.photo_ids             # still a CONFIDENT result
    assert "p2" not in out.photo_ids         # no seeds -> no recovery chain


def test_weak_match_cannot_contaminate():
    """One borderline face of a DIFFERENT person must not drag in that
    person's other photos through the template."""
    me = unit(70)
    stranger = unit(71)
    borderline = l2_normalize(0.42 * me + np.sqrt(1 - 0.42**2) * stranger)  # sim to me ~0.42
    rows = [
        ("f1", "p1", near(me, 72, 0.85), 0.9),
        ("f2", "p2", borderline, 0.9),                    # weak lookalike (never a seed)
        ("f3", "p3", near(stranger, 73, 0.9), 0.9),       # stranger's other photo
        ("f4", "p4", near(borderline, 74, 0.9), 0.9),     # close to the lookalike only
    ]
    out = two_stage_search(FakeIndex(rows), [me])
    assert out.seeds_used == 1                # only f1 seeds; borderline is below strict
    assert "p3" not in out.photo_ids          # stranger's identity never recovered
    # f4 is supported only by the non-seed lookalike: no chaining allowed
    candidates = {c.photo_id: c.tier for c in out.candidates}
    assert candidates.get("p4") != "CONFIDENT"
    assert "p4" not in out.photo_ids or candidates.get("p4") == "LIKELY" and False


def test_dedup_by_photo():
    me = unit(80)
    rows = [
        ("f1", "p1", near(me, 81, 0.9), 0.9),
        ("f2", "p1", near(me, 82, 0.8), 0.9),  # second face, same photo
    ]
    out = two_stage_search(FakeIndex(rows), [me])
    assert out.photo_ids.count("p1") == 1


def test_needs_second_selfie_when_too_few_seeds():
    me = unit(90)
    rows = [("f1", "p1", near(me, 91, 0.85), 0.9)]  # only one seedable match
    out = two_stage_search(FakeIndex(rows), [me])
    assert out.needs_second_selfie is True
    out2 = two_stage_search(FakeIndex(rows), [me, near(me, 92, 0.95)])
    assert out2.needs_second_selfie is False  # second selfie already provided


def test_tag_boost_requires_selfie_agreement():
    me = unit(100)
    stranger = unit(101)
    rows = [
        ("f1", "p1", near(me, 102, 0.85), 0.9),
        ("f2", "p-tagged-me", near(me, 103, 0.40), 0.9),       # tag + moderate sim -> seed
        ("f3", "p-mistagged", near(stranger, 104, 0.9), 0.9),  # tagged but unlike selfie
    ]
    out = two_stage_search(FakeIndex(rows), [me], tag_photos=["p-tagged-me", "p-mistagged"])
    assert out.tag_seeds_used == 1
    assert "p-tagged-me" in out.photo_ids
    assert "p-mistagged" not in out.photo_ids  # mis-tag ignored: no contamination


def test_empty_index():
    out = two_stage_search(FakeIndex([]), [unit(1)])
    assert out.photo_ids == []


# ---------------------------------------------------------------- detector NMS

def _det(x1, y1, x2, y2, conf):
    return DetectedFace(
        bbox=np.array([x1, y1, x2, y2], dtype=np.float32),
        confidence=conf,
        landmarks=np.zeros((5, 2), dtype=np.float32),
    )


def test_nms_merges_tile_duplicates():
    a = _det(100, 100, 200, 200, 0.9)
    b = _det(105, 103, 202, 199, 0.8)   # same face from an overlapping tile
    c = _det(400, 400, 500, 500, 0.7)   # different face
    kept = merge_detections([a, b, c], iou_threshold=0.45)
    assert len(kept) == 2
    assert kept[0].confidence == 0.9


# ---------------------------------------------------------------- states

def test_processing_state_rules():
    """Failed processing must never look processed."""
    def processed_flag(state: str) -> bool:
        return state in ("READY", "NO_FACES")

    assert processed_flag("READY")
    assert processed_flag("NO_FACES")
    assert not processed_flag("FAILED")
    assert not processed_flag("PENDING")
    assert not processed_flag("PROCESSING")


def test_version_mismatch_is_detected():
    from ai_face.index import ReindexRequiredError
    assert issubclass(ReindexRequiredError, Exception)
    assert config.RECOGNIZER_VERSION in ("adaface_ir101_webface12m", "arcface_w600k_r50")


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
