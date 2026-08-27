"""Embeds the golden set with the v2 pipeline (SCRFD + AdaFace).

Runs two detection variants per photo (tiling on/off) so the analyzer can
quantify what tiling buys and costs. Also embeds every query selfie.

Output: <out>/v2_faces.pkl
  {
    "meta": {...versions, timings...},
    "photos": {photo_id: {variant: {"boxes": [[x,y,w,h]...], "confs": [...],
                                    "qualities": [...], "embs": ndarray,
                                    "ms": float, "raw_detections": int}}},
    "queries": {query_file: {"emb": ndarray | None, "error": str | None}},
  }

Run inside the ai-search container (GPU) or on a host venv with FACE_MODELS_DIR set.
"""

import argparse
import json
import os
import pickle
import time

import numpy as np

import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ai_face import config, engine, pipeline  # noqa: E402


def detect_and_embed(image_bgr, tiling: bool):
    detector = engine.get_detector()
    recognizer = engine.get_recognizer()
    from ai_face.align import align_face
    from ai_face.quality import blur_score, is_usable, quality_score

    inference_img, scale = pipeline._resize_long_side(image_bgr, config.FACE_DETECTION_LONG_SIDE)
    t0 = time.perf_counter()
    full = detector._detect_pass(inference_img)
    raw = len(full)
    dets = list(full)
    if tiling and max(inference_img.shape[:2]) > config.FACE_TILE_SIZE * 1.5:
        tiled = detector._detect_tiled(inference_img)
        raw += len(tiled)
        from ai_face.detector import merge_detections
        dets = merge_detections(dets + tiled, config.FACE_NMS_IOU)
    boxes, confs, qualities, aligned = [], [], [], []
    for det in dets:
        bbox = det.bbox / scale
        lm = det.landmarks / scale
        w = int(round(bbox[2] - bbox[0])); h = int(round(bbox[3] - bbox[1]))
        if not is_usable(det.confidence, w, h):
            continue
        crop = align_face(image_bgr, lm)
        blur = blur_score(crop)
        boxes.append([float(bbox[0]), float(bbox[1]), float(w), float(h)])
        confs.append(float(det.confidence))
        qualities.append(quality_score(det.confidence, w, h, blur))
        aligned.append(crop)
    embs = recognizer.embed_batch(aligned) if aligned else np.zeros((0, 512), np.float32)
    ms = (time.perf_counter() - t0) * 1000
    return {"boxes": boxes, "confs": confs, "qualities": qualities,
            "embs": embs.astype(np.float32), "ms": ms, "raw_detections": raw}


def main(golden: str, out_path: str) -> None:
    with open(os.path.join(golden, "ground_truth.json")) as f:
        gt = json.load(f)

    engine.get_detector(); engine.get_recognizer()
    result = {
        "meta": {
            "detector": config.DETECTOR_VERSION,
            "recognizer": config.RECOGNIZER_VERSION,
            "pipeline": config.FACE_PIPELINE_VERSION,
            "device": config.FACE_DEVICE,
            "long_side": config.FACE_DETECTION_LONG_SIDE,
            "tile_size": config.FACE_TILE_SIZE,
            "dataset_version": gt.get("dataset_version"),
        },
        "photos": {},
        "queries": {},
    }

    t_start = time.perf_counter()
    for i, photo_id in enumerate(sorted(gt["photos"])):
        path = os.path.join(golden, "photos", f"{photo_id}.jpg")
        img = pipeline.load_image_bgr(path)
        result["photos"][photo_id] = {
            "tiled": detect_and_embed(img, tiling=True),
            "notile": detect_and_embed(img, tiling=False),
        }
        if (i + 1) % 100 == 0:
            print(f"  {i + 1}/{len(gt['photos'])} photos")
    index_secs = time.perf_counter() - t_start
    result["meta"]["index_seconds"] = index_secs
    result["meta"]["photos_per_min"] = len(gt["photos"]) / index_secs * 60

    for person, info in gt["people"].items():
        for qfile in info["queries"]:
            img = pipeline.load_image_bgr(os.path.join(golden, "queries", qfile))
            emb, err = pipeline.embed_selfie(img)
            result["queries"][qfile] = {"emb": None if emb is None else emb.astype(np.float32),
                                        "error": err}

    with open(out_path, "wb") as f:
        pickle.dump(result, f)
    print(f"v2 embeddings -> {out_path} "
          f"({result['meta']['photos_per_min']:.1f} photos/min on {config.FACE_DEVICE})")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--golden", default="eval/wedding")
    parser.add_argument("--out", default="eval/wedding/v2_faces.pkl")
    args = parser.parse_args()
    main(args.golden, args.out)
