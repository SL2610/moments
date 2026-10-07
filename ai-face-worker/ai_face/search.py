"""Two-stage precision-first identity search.

Stage A: exact search of the selfie embedding; only very confident matches
become seeds (quality-gated, diversity-selected, capped).

Tag boost: photos already name-tagged as this guest contribute seed
candidates, but only when the face ALSO resembles the selfie (tag + selfie =
two independent proofs). A mis-tag cannot contaminate the identity because
the selfie remains a permanent anchor and disagreeing faces are ignored.

Stage B (exactly one round, by design): candidates are accepted when strongly
similar to the selfie itself, OR strongly similar to BOTH the template
centroid and at least one trusted event exemplar. Weak single-reference
evidence is never enough, and Stage B results never become new seeds.
"""

import numpy as np

from . import config, db
from .index import index_cache
from .template import GuestIdentityTemplate, select_diverse_seeds
from .types import FaceCandidate, SearchOutcome


def tagged_photo_ids(guest_id: str) -> list[str]:
    with db.connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT photo_id FROM photo_tags WHERE guest_id = %s", (guest_id,))
        rows = cur.fetchall()
        cur.close()
    return [str(r[0]) for r in rows]


def two_stage_search(index, selfie_embeddings: list[np.ndarray], tag_photos: list[str] | None = None) -> SearchOutcome:
    """Pure search logic over an AlbumFaceIndex-like object (unit-testable)."""
    outcome = SearchOutcome()
    n = len(index.face_ids)
    if n == 0:
        return outcome

    queries = np.stack([np.asarray(e, dtype=np.float32) for e in selfie_embeddings])
    sim_selfie = (index.embeddings @ queries.T).max(axis=1)

    # ---------------- Stage A: strict seed matches
    top_k = min(config.FACE_STRICT_TOP_K, n)
    top_idx = np.argsort(sim_selfie)[::-1][:top_k]
    strict_idx = [int(i) for i in top_idx if sim_selfie[i] >= config.FACE_STRICT_THRESHOLD]

    seed_pool = [
        (float(sim_selfie[i]), index.photo_ids[i], index.embeddings[i])
        for i in strict_idx
        if index.qualities[i] >= config.FACE_MIN_SEED_QUALITY
    ]

    # ---------------- Tag boost: tag + selfie agreement
    tag_seeds = 0
    if tag_photos:
        tag_set = set(tag_photos)
        seed_photos = {p for _, p, _ in seed_pool}
        best_in_photo: dict[str, int] = {}
        for i in range(n):
            pid = index.photo_ids[i]
            if pid in tag_set and (pid not in best_in_photo or sim_selfie[i] > sim_selfie[best_in_photo[pid]]):
                best_in_photo[pid] = i
        for pid, i in best_in_photo.items():
            if pid in seed_photos:
                continue  # already seeded via strict match
            if (
                sim_selfie[i] >= config.FACE_RECOVERY_THRESHOLD
                and index.qualities[i] >= config.FACE_MIN_SEED_QUALITY
            ):
                seed_pool.append((float(sim_selfie[i]), pid, index.embeddings[i]))
                tag_seeds += 1

    seeds = select_diverse_seeds(
        seed_pool, config.FACE_MAX_SEEDS, config.FACE_SEED_DIVERSITY_MAX_SIM
    )
    template = GuestIdentityTemplate(selfie_embeddings=list(queries))
    for _, _, emb in seeds:
        template.add_seed(emb)

    # ---------------- Stage B: single bounded recovery round
    if template.seed_embeddings:
        seed_matrix = np.stack(template.seed_embeddings)
        sim_seed_max = (index.embeddings @ seed_matrix.T).max(axis=1)
    else:
        sim_seed_max = np.zeros(n, dtype=np.float32)
    sim_centroid = index.embeddings @ template.centroid
    ref_sims = index.embeddings @ template.reference_embeddings.T
    ref_support = (ref_sims >= config.FACE_RECOVERY_THRESHOLD).sum(axis=1)

    candidates: list[FaceCandidate] = []
    for i in range(n):
        confident = sim_selfie[i] >= config.FACE_STRICT_THRESHOLD
        centroid_ok = sim_centroid[i] >= config.FACE_RECOVERY_THRESHOLD
        seed_ok = bool(template.seed_embeddings) and sim_seed_max[i] >= config.FACE_RECOVERY_THRESHOLD
        if confident:
            tier = "CONFIDENT"
        elif centroid_ok and seed_ok:
            tier = "LIKELY"
        elif centroid_ok or seed_ok or sim_selfie[i] >= config.FACE_RECOVERY_THRESHOLD:
            tier = "WEAK"      # internal only; never shown to guests
        else:
            tier = "REJECTED"
        if tier in ("CONFIDENT", "LIKELY", "WEAK"):
            candidates.append(FaceCandidate(
                face_id=index.face_ids[i],
                photo_id=index.photo_ids[i],
                similarity=float(sim_selfie[i]),
                quality=float(index.qualities[i]),
                centroid_sim=float(sim_centroid[i]),
                seed_sim=float(sim_seed_max[i]),
                ref_support=int(ref_support[i]),
                tier=tier,
            ))

    accepted = [c for c in candidates if c.tier in ("CONFIDENT", "LIKELY")]

    # ---------------- deduplicate faces -> photos, rank by best evidence
    best_by_photo: dict[str, FaceCandidate] = {}
    for c in accepted:
        prev = best_by_photo.get(c.photo_id)
        if prev is None or _rank_score(c) > _rank_score(prev):
            best_by_photo[c.photo_id] = c
    ranked = sorted(best_by_photo.values(), key=_rank_score, reverse=True)[: config.FACE_MAX_RESULTS]

    confident_count = sum(1 for c in accepted if c.tier == "CONFIDENT")
    outcome.photo_ids = [c.photo_id for c in ranked]
    outcome.seeds_used = len(seeds)
    outcome.tag_seeds_used = tag_seeds
    outcome.candidates = candidates
    outcome.needs_second_selfie = (
        len(seeds) < config.FACE_MIN_SEEDS_FOR_CONFIDENCE and len(selfie_embeddings) < 2
    )
    if confident_count >= 1 and len(seeds) >= config.FACE_MIN_SEEDS_FOR_CONFIDENCE:
        outcome.confidence = "high"
    elif confident_count >= 1:
        outcome.confidence = "medium"
    else:
        outcome.confidence = "low"
    return outcome


def _rank_score(c: FaceCandidate) -> float:
    return max(c.similarity, c.centroid_sim)


def run_search(album_id: str, selfie_embeddings: list[np.ndarray], guest_id: str | None = None) -> SearchOutcome:
    """DB-backed entry point. Raises ReindexRequiredError via the index."""
    index = index_cache.get(album_id)
    tag_photos = tagged_photo_ids(guest_id) if guest_id else None
    return two_stage_search(index, selfie_embeddings, tag_photos)
