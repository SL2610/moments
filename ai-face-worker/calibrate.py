"""Threshold calibration from labeled identity folders.

Input layout (eval/identities/<person-name>/*.jpg, several images per person):

  eval/identities/
    dana/    img1.jpg img2.jpg ...
    yossi/   ...

Every image is run through the CURRENT pipeline (largest face per image).
All same-person and different-person embedding pairs are scored, and the
tool prints similarity distributions plus recommended thresholds:

  strict   = impostor-distribution quantile at FACE_TARGET_FPR (default 1e-4)
  recovery = midpoint between strict and the genuine 10th percentile, capped

Usage:
  docker compose exec ai-search python calibrate.py --dir eval/identities
"""

import argparse
import itertools
import os

import numpy as np
from dotenv import load_dotenv

load_dotenv()

from ai_face import pipeline  # noqa: E402


def collect_embeddings(root: str) -> dict[str, list[np.ndarray]]:
    people: dict[str, list[np.ndarray]] = {}
    for person in sorted(os.listdir(root)):
        pdir = os.path.join(root, person)
        if not os.path.isdir(pdir):
            continue
        for name in sorted(os.listdir(pdir)):
            if not name.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
                continue
            path = os.path.join(pdir, name)
            try:
                emb, code = pipeline.embed_selfie(pipeline.load_image_bgr(path))
            except Exception as e:
                print(f"  ! {path}: {e}")
                continue
            if emb is None:
                print(f"  ! {path}: {code}")
                continue
            people.setdefault(person, []).append(emb)
            print(f"  + {person}/{name}")
    return people


def pair_scores(people: dict[str, list[np.ndarray]]) -> tuple[np.ndarray, np.ndarray]:
    genuine, impostor = [], []
    for person, embs in people.items():
        for a, b in itertools.combinations(embs, 2):
            genuine.append(float(a @ b))
    names = list(people)
    for i, j in itertools.combinations(range(len(names)), 2):
        for a in people[names[i]]:
            for b in people[names[j]]:
                impostor.append(float(a @ b))
    return np.asarray(genuine), np.asarray(impostor)


def describe(name: str, scores: np.ndarray) -> None:
    if len(scores) == 0:
        print(f"{name}: no pairs")
        return
    qs = np.percentile(scores, [0, 10, 25, 50, 75, 90, 100])
    print(f"{name}: n={len(scores)} min={qs[0]:.3f} p10={qs[1]:.3f} p25={qs[2]:.3f} "
          f"median={qs[3]:.3f} p75={qs[4]:.3f} p90={qs[5]:.3f} max={qs[6]:.3f}")


def recommend(genuine: np.ndarray, impostor: np.ndarray, target_fpr: float) -> tuple[float, float]:
    # Strict: similarity above which fewer than target_fpr of impostor pairs fall.
    if len(impostor):
        strict = float(np.quantile(impostor, 1.0 - target_fpr))
        strict = max(strict + 0.03, 0.30)  # margin above the observed tail
    else:
        strict = 0.45
    genuine_p10 = float(np.percentile(genuine, 10)) if len(genuine) else strict
    recovery = max(min((strict + genuine_p10) / 2.0, strict - 0.05), 0.25)
    return round(strict, 3), round(recovery, 3)


def report(people: dict[str, list[np.ndarray]], target_fpr: float) -> None:
    genuine, impostor = pair_scores(people)
    print()
    describe("same-person   ", genuine)
    describe("different-pers", impostor)

    strict, recovery = recommend(genuine, impostor, target_fpr)
    print(f"\nprecision/recall at candidate thresholds:")
    for t in sorted({strict, recovery, 0.30, 0.35, 0.40, 0.45, 0.50}):
        tp = int((genuine >= t).sum()); fn = len(genuine) - tp
        fp = int((impostor >= t).sum()); tn = len(impostor) - fp
        precision = tp / (tp + fp) if tp + fp else 1.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        fpr = fp / len(impostor) if len(impostor) else 0.0
        print(f"  t={t:.3f}  precision={precision:.4f} recall={recall:.4f} "
              f"FPR={fpr:.5f} (fp={fp} fn={fn})")

    print(f"\nrecommended (target FPR {target_fpr:g}):")
    print(f"  FACE_STRICT_THRESHOLD={strict}")
    print(f"  FACE_RECOVERY_THRESHOLD={recovery}")
    print("set these in .env and restart ai-search.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", default="eval/identities")
    parser.add_argument("--target-fpr", type=float, default=float(os.getenv("FACE_TARGET_FPR", "1e-4")))
    args = parser.parse_args()

    people = collect_embeddings(args.dir)
    usable = {k: v for k, v in people.items() if len(v) >= 1}
    print(f"\n{len(usable)} identities, {sum(len(v) for v in usable.values())} faces")
    report(usable, args.target_fpr)
