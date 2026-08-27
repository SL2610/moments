"""Builds the synthetic Wedding Golden Set (deterministic, seed=42).

Real wedding golden data is preferable; until it is labeled, this constructs
a reproducible event from LFW identities (people with >= MIN_IMAGES images):

  NORMAL  held-in album photos (1 face each, identity known)
  DARK    brightness-crushed copies (dance-floor proxy)
  BLUR    gaussian-blurred copies (motion-blur proxy)
  SMALL   face shrunk to ~56 px pasted on a large canvas (distant-face proxy)
  GROUP   collages of 5 identities at 110-190 px (group-photo proxy)

Two query selfies per identity are HELD OUT of the album. Face-level ground
truth (identity + bbox) is known by construction, which lets the evaluator
separate detection misses from recognition misses.

Usage (host):  proto-venv/bin/python build_golden.py --out <dir>
"""

import argparse
import json
import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SEED = 42
MIN_IMAGES = 15
MAX_IDENTITIES = 26
MAX_IMAGES_PER_ID = 22
N_QUERIES = 2
N_VARIANTS_PER_ID = 3
N_GROUPS = 40
GROUP_SIZE = 5
DATASET_VERSION = "lfw-synth-1"


def load_lfw():
    from sklearn.datasets import fetch_lfw_people

    print("fetching LFW (cached under ~/scikit_learn_data)...")
    lfw = fetch_lfw_people(min_faces_per_person=MIN_IMAGES, color=True, resize=1.0,
                           funneled=True, slice_=None)
    by_person: dict[str, list[np.ndarray]] = {}
    for img, target in zip(lfw.images, lfw.target):
        name = lfw.target_names[target].replace(" ", "_").lower()
        by_person.setdefault(name, [])
        if len(by_person[name]) < MAX_IMAGES_PER_ID:
            # sklearn returns floats in [0, 1]
            arr = img * 255.0 if img.max() <= 1.001 else img
            by_person[name].append(np.clip(arr, 0, 255).astype(np.uint8))
    names = sorted(by_person)[:MAX_IDENTITIES]
    return {n: by_person[n] for n in names}


def save(img: Image.Image, photos_dir: str, photo_id: str) -> None:
    img.convert("RGB").save(os.path.join(photos_dir, f"{photo_id}.jpg"), quality=92)


def main(out: str) -> None:
    rng = random.Random(SEED)
    photos_dir = os.path.join(out, "photos")
    queries_dir = os.path.join(out, "queries")
    os.makedirs(photos_dir, exist_ok=True)
    os.makedirs(queries_dir, exist_ok=True)

    people = load_lfw()
    print(f"{len(people)} identities")

    gt = {"dataset_version": DATASET_VERSION, "people": {}, "photos": {}}

    normals_by_person: dict[str, list[str]] = {}
    normal_images: dict[str, Image.Image] = {}

    for person, images in people.items():
        queries = []
        for qi in range(N_QUERIES):
            qname = f"{person}_q{qi}.jpg"
            Image.fromarray(images[qi]).save(os.path.join(queries_dir, qname), quality=92)
            queries.append(qname)
        gt["people"][person] = {"queries": queries, "positive_photos": []}

        for idx, arr in enumerate(images[N_QUERIES:]):
            img = Image.fromarray(arr)
            pid = f"{person}_n{idx:02d}"
            save(img, photos_dir, pid)
            w, h = img.size
            gt["photos"][pid] = {"subset": "NORMAL",
                                 "faces": [{"identity": person, "bbox": [0, 0, w, h]}]}
            gt["people"][person]["positive_photos"].append(pid)
            normals_by_person.setdefault(person, []).append(pid)
            normal_images[pid] = img

    # ---- hard single-face variants
    for person, pids in normals_by_person.items():
        for kind, pid in zip(["DARK", "BLUR", "SMALL"] * 1, pids[:N_VARIANTS_PER_ID]):
            img = normal_images[pid]
            vid = f"{person}_{kind.lower()}_{pid[-2:]}"
            if kind == "DARK":
                arr = (np.asarray(img, dtype=np.float32) * 0.32)
                noise = np.random.default_rng(SEED).normal(0, 6, arr.shape)
                v = Image.fromarray(np.clip(arr + noise, 0, 255).astype(np.uint8))
                w, h = v.size
                faces = [{"identity": person, "bbox": [0, 0, w, h]}]
            elif kind == "BLUR":
                v = img.filter(ImageFilter.GaussianBlur(2.2))
                w, h = v.size
                faces = [{"identity": person, "bbox": [0, 0, w, h]}]
            else:  # SMALL: face ~56px on a 1400x900 canvas
                small = img.resize((56, 56), Image.LANCZOS)
                v = Image.new("RGB", (1400, 900), (168, 160, 150))
                d = ImageDraw.Draw(v)
                for gx in range(0, 1400, 70):  # mild texture so it isn't a flat card
                    d.line([(gx, 0), (gx, 900)], fill=(160, 152, 142), width=1)
                x, y = rng.randint(80, 1260), rng.randint(80, 760)
                v.paste(small, (x, y))
                faces = [{"identity": person, "bbox": [x, y, 56, 56]}]
            save(v, photos_dir, vid)
            gt["photos"][vid] = {"subset": kind, "faces": faces}
            gt["people"][person]["positive_photos"].append(vid)

    # ---- group collages
    names = sorted(people)
    for g in range(N_GROUPS):
        members = rng.sample(names, GROUP_SIZE)
        canvas = Image.new("RGB", (2048, 1360), (172, 165, 152))
        d = ImageDraw.Draw(canvas)
        for gy in range(0, 1360, 90):
            d.line([(0, gy), (2048, gy)], fill=(164, 157, 145), width=1)
        gid = f"group_{g:03d}"
        faces = []
        slots = [(90 + col * 390 + rng.randint(-25, 25), 150 + row * 560 + rng.randint(-40, 40))
                 for row in range(2) for col in range(5)]
        rng.shuffle(slots)
        for person, (x, y) in zip(members, slots):
            src_pid = rng.choice(normals_by_person[person])
            size = rng.randint(110, 190)
            face = normal_images[src_pid].resize((size, size), Image.LANCZOS)
            canvas.paste(face, (x, y))
            faces.append({"identity": person, "bbox": [x, y, size, size]})
            gt["people"][person]["positive_photos"].append(gid)
        save(canvas, photos_dir, gid)
        gt["photos"][gid] = {"subset": "GROUP", "faces": faces}

    with open(os.path.join(out, "ground_truth.json"), "w") as f:
        json.dump(gt, f, indent=1)

    n_faces = sum(len(p["faces"]) for p in gt["photos"].values())
    print(f"golden set: {len(gt['photos'])} photos, {n_faces} labeled faces, "
          f"{len(gt['people'])} identities -> {out}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="eval/wedding")
    args = parser.parse_args()
    main(args.out)
