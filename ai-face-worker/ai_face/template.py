"""Guest identity template: selfie anchors + verified event exemplars."""

from dataclasses import dataclass, field

import numpy as np

from .recognizer import l2_normalize


@dataclass
class GuestIdentityTemplate:
    """Multi-exemplar identity. The selfie embeddings are permanent anchors;
    event seeds are only ever added from very confident matches."""

    selfie_embeddings: list = field(default_factory=list)
    seed_embeddings: list = field(default_factory=list)

    def add_seed(self, embedding: np.ndarray) -> None:
        self.seed_embeddings.append(np.asarray(embedding, dtype=np.float32))

    @property
    def centroid(self) -> np.ndarray:
        refs = list(self.selfie_embeddings) + list(self.seed_embeddings)
        return l2_normalize(np.mean(np.stack(refs), axis=0))

    @property
    def reference_embeddings(self) -> np.ndarray:
        return np.stack(list(self.selfie_embeddings) + list(self.seed_embeddings))


def select_diverse_seeds(
    candidates: list[tuple[float, str, np.ndarray]],
    max_seeds: int,
    max_similarity: float,
    max_per_photo: int = 1,
) -> list[tuple[float, str, np.ndarray]]:
    """Greedy diverse selection from (similarity, photo_id, embedding) tuples.

    Prefers the strongest matches but skips near-duplicate faces and limits
    seeds per photo, so the template captures pose/expression/image diversity
    instead of eight copies of the same crop.
    """
    chosen: list[tuple[float, str, np.ndarray]] = []
    photo_counts: dict[str, int] = {}
    for sim, photo_id, emb in sorted(candidates, key=lambda c: c[0], reverse=True):
        if len(chosen) >= max_seeds:
            break
        if photo_counts.get(photo_id, 0) >= max_per_photo:
            continue
        if any(float(emb @ c[2]) > max_similarity for c in chosen):
            continue
        chosen.append((sim, photo_id, emb))
        photo_counts[photo_id] = photo_counts.get(photo_id, 0) + 1
    return chosen
