"""Golden-set regression evaluation against the live /search endpoint.

Layout:
  eval/queries/<query>.jpg          selfie images
  eval/ground_truth.json            {"<query>.jpg": ["<photo-id>", ...]}

Reports precision/recall/FP/FN per query and overall, and attributes misses:
  detection-miss    the expected photo has NO indexed face at all
  identity-miss     faces were indexed but the identity wasn't matched

Usage:
  docker compose exec ai-search python evaluate.py --album <album-id>
  (add --url to point at a different /search, e.g. the old engine)
"""

import argparse
import json
import os

import requests
from dotenv import load_dotenv

load_dotenv()


def indexed_photo_ids() -> set[str]:
    from ai_face import db

    with db.connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT DISTINCT photo_id FROM photo_embeddings")
        rows = cur.fetchall()
        cur.close()
    return {str(r[0]) for r in rows}


def run(album_id: str, url: str, queries_dir: str, truth_path: str) -> None:
    with open(truth_path) as f:
        truth: dict[str, list[str]] = json.load(f)

    try:
        with_faces = indexed_photo_ids()
    except Exception:
        with_faces = set()  # remote/old engine without DB access

    total_tp = total_fp = total_fn = 0
    detection_misses = identity_misses = 0

    for query, expected in truth.items():
        path = os.path.join(queries_dir, query)
        if not os.path.isfile(path):
            print(f"! missing query image {path}")
            continue
        with open(path, "rb") as f:
            resp = requests.post(
                url,
                data={"album_id": album_id},
                files={"file": (query, f, "image/jpeg")},
                timeout=180,
            )
        matched = set(resp.json().get("matched_photo_ids", [])) if resp.ok else set()
        expected_set = set(expected)

        tp = len(matched & expected_set)
        fp = len(matched - expected_set)
        fn_set = expected_set - matched
        total_tp += tp
        total_fp += fp
        total_fn += len(fn_set)
        for photo in fn_set:
            if with_faces and photo not in with_faces:
                detection_misses += 1
            else:
                identity_misses += 1

        precision = tp / len(matched) if matched else 1.0
        recall = tp / len(expected_set) if expected_set else 1.0
        print(f"{query}: matched={len(matched)} tp={tp} fp={fp} fn={len(fn_set)} "
              f"precision={precision:.3f} recall={recall:.3f}")
        if resp.ok and resp.json().get("confidence"):
            print(f"    confidence={resp.json()['confidence']} "
                  f"needs_second_selfie={resp.json().get('needs_second_selfie')}")

    n_matched = total_tp + total_fp
    n_expected = total_tp + total_fn
    print("\n==== overall ====")
    print(f"precision@all = {total_tp / n_matched if n_matched else 1.0:.4f}")
    print(f"recall@all    = {total_tp / n_expected if n_expected else 1.0:.4f}")
    print(f"false positives = {total_fp}")
    print(f"false negatives = {total_fn} "
          f"(detection-miss: {detection_misses}, identity-miss: {identity_misses})")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--album", required=True)
    parser.add_argument("--url", default="http://localhost:5000/search")
    parser.add_argument("--queries", default="eval/queries")
    parser.add_argument("--truth", default="eval/ground_truth.json")
    args = parser.parse_args()
    run(args.album, args.url, args.queries, args.truth)
