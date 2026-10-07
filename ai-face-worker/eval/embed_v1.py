"""Embeds the golden set with the LEGACY GrabPic pipeline
(RetinaFace + GhostFaceNet via DeepFace), reproducing production behavior:
photos processed at preview scale (long side 2000), enforce_detection=False.

Run with a deepface/tensorflow venv (NOT the v2 environment):
  v1-venv/bin/python embed_v1.py --golden <dir> --out v1_faces.pkl
"""

import argparse
import json
import os
import pickle
import time

import numpy as np
from PIL import Image


def main(golden: str, out_path: str) -> None:
    from deepface import DeepFace

    with open(os.path.join(golden, "ground_truth.json")) as f:
        gt = json.load(f)

    def represent(path: str, enforce: bool):
        t0 = time.perf_counter()
        try:
            faces = DeepFace.represent(
                img_path=path, model_name="GhostFaceNet",
                detector_backend="retinaface", enforce_detection=enforce,
            )
        except ValueError:
            faces = []
        ms = (time.perf_counter() - t0) * 1000
        boxes, embs = [], []
        for f in faces:
            area = f.get("facial_area", {})
            if area.get("w", 0) <= 0:
                continue
            boxes.append([area["x"], area["y"], area["w"], area["h"]])
            v = np.asarray(f["embedding"], dtype=np.float32)
            embs.append(v / (np.linalg.norm(v) or 1.0))  # cosine semantics
        return boxes, (np.stack(embs) if embs else np.zeros((0, 512), np.float32)), ms

    # production v1 downscaled photos to a 2000px preview before detection
    result = {"meta": {"detector": "retinaface", "recognizer": "ghostfacenet",
                       "dataset_version": gt.get("dataset_version")},
              "photos": {}, "queries": {}}
    tmp = "/tmp/v1_preview.jpg"
    t_start = time.perf_counter()
    for i, photo_id in enumerate(sorted(gt["photos"])):
        src = os.path.join(golden, "photos", f"{photo_id}.jpg")
        with Image.open(src) as img:
            img = img.convert("RGB")
            img.thumbnail((2000, 2000))
            img.save(tmp, quality=85)
        boxes, embs, ms = represent(tmp, enforce=False)
        result["photos"][photo_id] = {"boxes": boxes, "embs": embs, "ms": ms}
        if (i + 1) % 50 == 0:
            print(f"  {i + 1}/{len(gt['photos'])}")
    result["meta"]["index_seconds"] = time.perf_counter() - t_start

    for person, info in gt["people"].items():
        for qfile in info["queries"]:
            boxes, embs, _ = represent(os.path.join(golden, "queries", qfile), enforce=True)
            result["queries"][qfile] = {"emb": embs[0] if len(embs) else None,
                                        "error": None if len(embs) else "no-face"}

    with open(out_path, "wb") as f:
        pickle.dump(result, f)
    print(f"v1 embeddings -> {out_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--golden", default="eval/wedding")
    parser.add_argument("--out", default="eval/wedding/v1_faces.pkl")
    args = parser.parse_args()
    main(args.golden, args.out)
