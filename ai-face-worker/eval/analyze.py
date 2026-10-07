"""Wedding Golden Set analyzer: compares pipelines A/B/C/D, runs ablations,
threshold sweeps, failure classification, and writes JSON reports plus a
final Markdown report.

  A  V1_GHOSTFACENET   RetinaFace + GhostFaceNet, single distance threshold
  B  V2_DIRECT         SCRFD + AdaFace, single strict threshold
  C  V2_TEMPLATE       production two-stage search (strict seeds + recovery)
  D  V2_TEMPLATE_VERIFY  C + consensus/quality verifier (eval-layer)

Inputs: ground_truth.json, v1_faces.pkl, v2_faces.pkl (see embed_*.py).
Usage:  proto-venv/bin/python analyze.py --golden eval/wedding
"""

import argparse
import contextlib
import datetime
import json
import os
import pickle
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ai_face import config  # noqa: E402
from ai_face.search import two_stage_search  # noqa: E402

SUBSETS = ["NORMAL", "DARK", "BLUR", "SMALL", "GROUP"]
SIZE_BUCKETS = [(0, 32), (32, 64), (64, 128), (128, 10**9)]


# ------------------------------------------------------------------ helpers
@contextlib.contextmanager
def patched(**overrides):
    saved = {k: getattr(config, k) for k in overrides}
    for k, v in overrides.items():
        setattr(config, k, v)
    try:
        yield
    finally:
        for k, v in saved.items():
            setattr(config, k, v)


class EvalIndex:
    """AlbumFaceIndex-like view over the golden-set embeddings."""

    def __init__(self, photos: dict, variant: str | None):
        face_ids, photo_ids, embs, quals, boxes = [], [], [], [], []
        for pid, data in photos.items():
            d = data[variant] if variant else data
            for j in range(len(d["embs"])):
                face_ids.append(f"{pid}#{j}")
                photo_ids.append(pid)
                embs.append(d["embs"][j])
                quals.append(d["qualities"][j] if "qualities" in d else 0.9)
                boxes.append(d["boxes"][j])
        self.face_ids = face_ids
        self.photo_ids = photo_ids
        self.embeddings = np.stack(embs) if embs else np.zeros((0, 512), np.float32)
        self.qualities = np.asarray(quals, dtype=np.float32)
        self.boxes = boxes


def usable_queries(store, info, n=1) -> list:
    """First n query embeddings that actually embedded (production would ask
    the guest to retry; eval falls back to the next selfie)."""
    out = []
    for qf in info["queries"]:
        q = store["queries"].get(qf, {}).get("emb")
        if q is not None:
            out.append(q)
        if len(out) == n:
            break
    return out


def face_identity(gt, photo_id, box) -> str | None:
    """Attribute a detected face to a labeled identity (center containment)."""
    faces = gt["photos"][photo_id]["faces"]
    if len(faces) == 1:
        return faces[0]["identity"]
    cx, cy = box[0] + box[2] / 2, box[1] + box[3] / 2
    for f in faces:
        x, y, w, h = f["bbox"]
        if x <= cx <= x + w and y <= cy <= y + h:
            return f["identity"]
    return None


# ------------------------------------------------------------------ metrics
def product_metrics(matched: dict, gt) -> dict:
    per_guest = []
    for person, info in gt["people"].items():
        got = matched.get(person, set())
        truth = set(info["positive_photos"])
        tp = len(got & truth); fp = len(got - truth); fn = len(truth - got)
        per_guest.append({"person": person, "tp": tp, "fp": fp, "fn": fn,
                          "returned": len(got)})
    tp = sum(g["tp"] for g in per_guest)
    fp = sum(g["fp"] for g in per_guest)
    fn = sum(g["fn"] for g in per_guest)
    fps = sorted(g["fp"] for g in per_guest)
    returned = sorted(g["returned"] for g in per_guest)
    n = len(per_guest)
    # per-subset recall
    subset_recall = {}
    for subset in SUBSETS:
        s_tp = s_fn = 0
        for person, info in gt["people"].items():
            got = matched.get(person, set())
            for pid in info["positive_photos"]:
                if gt["photos"][pid]["subset"] == subset:
                    if pid in got:
                        s_tp += 1
                    else:
                        s_fn += 1
        subset_recall[subset] = round(s_tp / (s_tp + s_fn), 4) if s_tp + s_fn else None
    return {
        "precision": round(tp / (tp + fp), 4) if tp + fp else 1.0,
        "recall": round(tp / (tp + fn), 4) if tp + fn else 0.0,
        "fp_total": fp, "fn_total": fn,
        "zero_fp_guest_rate": round(sum(1 for g in per_guest if g["fp"] == 0) / n, 4),
        "any_fp_rate": round(sum(1 for g in per_guest if g["fp"] > 0) / n, 4),
        "fp_per_guest_avg": round(fp / n, 3),
        "fp_per_guest_p95": fps[min(n - 1, int(0.95 * n))],
        "fn_per_guest_avg": round(fn / n, 3),
        "returned_avg": round(sum(returned) / n, 1),
        "returned_median": returned[n // 2],
        "subset_recall": subset_recall,
        "per_guest": per_guest,
    }


# ------------------------------------------------------------------ pipelines
def run_A(v1, gt, sim_threshold: float) -> dict:
    matched = {}
    for person, info in gt["people"].items():
        qs = usable_queries(v1, info, 1)
        if not qs:
            matched[person] = set()
            continue
        q = qs[0]
        got = set()
        for pid, d in v1["photos"].items():
            if len(d["embs"]) and float(np.max(d["embs"] @ q)) >= sim_threshold:
                got.add(pid)
        matched[person] = got
    return matched


def run_B(index: EvalIndex, v2, gt, threshold: float) -> dict:
    matched = {}
    for person, info in gt["people"].items():
        qs = usable_queries(v2, info, 1)
        if not qs:
            matched[person] = set()
            continue
        sims = index.embeddings @ qs[0]
        matched[person] = {index.photo_ids[i] for i in np.nonzero(sims >= threshold)[0]}
    return matched


def run_C(index: EvalIndex, v2, gt, n_selfies=1, **cfg) -> tuple[dict, dict]:
    matched, outcomes = {}, {}
    with patched(**cfg):
        for person, info in gt["people"].items():
            queries = usable_queries(v2, info, n_selfies)
            if not queries:
                matched[person] = set()
                continue
            out = two_stage_search(index, queries)
            matched[person] = set(out.photo_ids)
            outcomes[person] = out
    return matched, outcomes


def run_D(index, v2, gt, verifier: str, n_selfies=1, **cfg) -> dict:
    """C + eval-layer verifier applied to LIKELY (Stage B) candidates."""
    _, outcomes = run_C(index, v2, gt, n_selfies=n_selfies, **cfg)
    strict = cfg.get("FACE_STRICT_THRESHOLD", config.FACE_STRICT_THRESHOLD)
    recovery = cfg.get("FACE_RECOVERY_THRESHOLD", config.FACE_RECOVERY_THRESHOLD)
    matched = {}
    for person, out in outcomes.items():
        got = set()
        for c in out.candidates:
            if c.tier == "CONFIDENT":
                got.add(c.photo_id)
            elif c.tier == "LIKELY":
                if verifier == "consensus2" and c.ref_support >= 2:
                    got.add(c.photo_id)
                elif verifier == "quality_scaled":
                    if min(c.centroid_sim, c.seed_sim) >= recovery + 0.06 * (1 - c.quality):
                        got.add(c.photo_id)
                elif verifier == "consensus2+quality":
                    if c.ref_support >= 2 and \
                       min(c.centroid_sim, c.seed_sim) >= recovery + 0.06 * (1 - c.quality):
                        got.add(c.photo_id)
        matched[person] = got
    return matched


# ------------------------------------------------------------------ detection
def detection_recall(gt, detections: dict[str, list], by=None) -> dict:
    total = {"all": [0, 0]}
    for pid, photo in gt["photos"].items():
        det_boxes = detections.get(pid, [])
        for face in photo["faces"]:
            x, y, w, h = face["bbox"]
            hit = any(x <= b[0] + b[2] / 2 <= x + w and y <= b[1] + b[3] / 2 <= y + h
                      for b in det_boxes)
            keys = ["all"]
            if by == "size":
                for lo, hi in SIZE_BUCKETS:
                    if lo <= min(w, h) < hi:
                        keys.append(f"{lo}-{hi if hi < 10**8 else '+'}px")
            elif by == "subset":
                keys.append(photo["subset"])
            for k in keys:
                total.setdefault(k, [0, 0])
                total[k][1] += 1
                if hit:
                    total[k][0] += 1
    return {k: {"recall": round(v[0] / v[1], 4), "n": v[1]} for k, v in total.items()}


# ------------------------------------------------------------------ failures
def classify_failures(matched_C, matched_D, gt, index: EvalIndex, v2) -> dict:
    counts = {"QUERY_FAILED": 0, "DETECTION_MISS": 0, "RECOGNITION_MISS": 0,
              "TEMPLATE_MISS": 0, "VERIFICATION_REJECT": 0, "UNKNOWN": 0}
    face_sims = {}
    for person, info in gt["people"].items():
        qs = usable_queries(v2, info, 1)
        if not qs:
            counts["QUERY_FAILED"] += len(set(info["positive_photos"]))
            continue
        sims = index.embeddings @ qs[0]
        for person2, info2 in [(person, info)]:
            for pid in set(info2["positive_photos"]) - matched_D.get(person, set()):
                idxs = [i for i, p in enumerate(index.photo_ids)
                        if p == pid and face_identity(gt, pid, index.boxes[i]) == person]
                if not idxs:
                    counts["DETECTION_MISS"] += 1
                    continue
                best = float(max(sims[i] for i in idxs))
                face_sims[(person, pid)] = best
                if best < config.FACE_RECOVERY_THRESHOLD:
                    counts["RECOGNITION_MISS"] += 1
                elif pid in matched_C.get(person, set()):
                    counts["VERIFICATION_REJECT"] += 1
                elif best < config.FACE_STRICT_THRESHOLD:
                    counts["TEMPLATE_MISS"] += 1
                else:
                    counts["UNKNOWN"] += 1
    return counts


def fp_report(matched, gt, index: EvalIndex, v2, limit=15) -> list:
    rows = []
    for person, info in gt["people"].items():
        qs = usable_queries(v2, info, 1)
        if not qs:
            continue
        sims = index.embeddings @ qs[0]
        for pid in matched.get(person, set()) - set(info["positive_photos"]):
            idxs = [i for i, p in enumerate(index.photo_ids) if p == pid]
            i = max(idxs, key=lambda i: sims[i])
            rows.append({
                "query_identity": person, "photo": pid,
                "wrong_identity": face_identity(gt, pid, index.boxes[i]),
                "similarity": round(float(sims[i]), 4),
                "quality": round(float(index.qualities[i]), 3),
                "face_px": round(min(index.boxes[i][2], index.boxes[i][3])),
                "subset": gt["photos"][pid]["subset"],
            })
    return sorted(rows, key=lambda r: -r["similarity"])[:limit]


def margin_analysis(matched, gt, index: EvalIndex, v2) -> dict:
    """best-vs-second-best identity margin for accepted photos (TP vs FP)."""
    all_q = {p: (usable_queries(v2, i, 1) or [None])[0] for p, i in gt["people"].items()}
    all_q = {p: q for p, q in all_q.items() if q is not None}
    people = list(all_q)
    Q = np.stack([all_q[p] for p in people])          # (P, 512)
    S = index.embeddings @ Q.T                         # (F, P)
    tp_margins, fp_margins = [], []
    for pi, person in enumerate(people):
        truth = set(gt["people"][person]["positive_photos"])
        for pid in matched.get(person, set()):
            idxs = [i for i, p in enumerate(index.photo_ids) if p == pid]
            i = max(idxs, key=lambda i: S[i, pi])
            own = S[i, pi]
            other = max(S[i, pj] for pj in range(len(people)) if pj != pi)
            (tp_margins if pid in truth else fp_margins).append(float(own - other))
    def stats(a):
        return None if not a else {"n": len(a), "median": round(float(np.median(a)), 3),
                                   "p10": round(float(np.percentile(a, 10)), 3)}
    return {"tp": stats(tp_margins), "fp": stats(fp_margins)}


# ------------------------------------------------------------------ reporting
def save_report(reports_dir: str, name: str, payload: dict) -> str:
    os.makedirs(reports_dir, exist_ok=True)
    path = os.path.join(reports_dir, f"{name}.json")
    n = 1
    while os.path.exists(path):  # never overwrite previous experiments
        n += 1
        path = os.path.join(reports_dir, f"{name}_{n}.json")
    with open(path, "w") as f:
        json.dump(payload, f, indent=1, default=str)
    return path


def experiment_meta(gt) -> dict:
    try:
        commit = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"],
                                         cwd=os.path.dirname(__file__), text=True).strip()
    except Exception:
        commit = "unknown"
    return {
        "date": datetime.datetime.now().isoformat(timespec="seconds"),
        "git_commit": commit,
        "dataset_version": gt.get("dataset_version"),
        "detector": config.DETECTOR_VERSION,
        "recognizer": config.RECOGNIZER_VERSION,
        "thresholds": {"strict": config.FACE_STRICT_THRESHOLD,
                       "recovery": config.FACE_RECOVERY_THRESHOLD,
                       "seed_quality": config.FACE_MIN_SEED_QUALITY,
                       "max_seeds": config.FACE_MAX_SEEDS},
        "long_side": config.FACE_DETECTION_LONG_SIDE,
    }


def fmt_row(name, m):
    return (f"| {name} | {m['precision']:.4f} | {m['recall']:.4f} | {m['fp_total']} "
            f"| {m['zero_fp_guest_rate']*100:.0f}% | {m['fp_per_guest_p95']} |")


def main(golden: str) -> None:
    with open(os.path.join(golden, "ground_truth.json")) as f:
        gt = json.load(f)
    with open(os.path.join(golden, "v2_faces.pkl"), "rb") as f:
        v2 = pickle.load(f)
    v1 = None
    v1_path = os.path.join(golden, "v1_faces.pkl")
    if os.path.exists(v1_path):
        with open(v1_path, "rb") as f:
            v1 = pickle.load(f)

    reports_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reports")
    meta = experiment_meta(gt)
    index = EvalIndex(v2["photos"], "tiled")
    index_notile = EvalIndex(v2["photos"], "notile")
    n_photos = len(gt["photos"])
    n_faces = sum(len(p["faces"]) for p in gt["photos"].values())
    print(f"golden set: {n_photos} photos, {n_faces} GT faces, "
          f"{len(gt['people'])} identities, v2 index {len(index.face_ids)} faces")

    R: dict = {"meta": meta, "dataset": {"photos": n_photos, "gt_faces": n_faces,
               "identities": len(gt["people"]), "indexed_faces": len(index.face_ids)}}

    # ============================== detection ==============================
    det = {}
    det["v2_tiled"] = {"overall": detection_recall(gt, {p: d["tiled"]["boxes"] for p, d in v2["photos"].items()}),
                       "by_size": detection_recall(gt, {p: d["tiled"]["boxes"] for p, d in v2["photos"].items()}, by="size"),
                       "by_subset": detection_recall(gt, {p: d["tiled"]["boxes"] for p, d in v2["photos"].items()}, by="subset"),
                       "ms_avg": round(float(np.mean([d["tiled"]["ms"] for d in v2["photos"].values()])), 1)}
    det["v2_notile"] = {"overall": detection_recall(gt, {p: d["notile"]["boxes"] for p, d in v2["photos"].items()}),
                        "by_size": detection_recall(gt, {p: d["notile"]["boxes"] for p, d in v2["photos"].items()}, by="size"),
                        "by_subset": detection_recall(gt, {p: d["notile"]["boxes"] for p, d in v2["photos"].items()}, by="subset"),
                        "ms_avg": round(float(np.mean([d["notile"]["ms"] for d in v2["photos"].values()])), 1)}
    if v1:
        det["v1_retinaface"] = {"overall": detection_recall(gt, {p: d["boxes"] for p, d in v1["photos"].items()}),
                                "by_size": detection_recall(gt, {p: d["boxes"] for p, d in v1["photos"].items()}, by="size"),
                                "by_subset": detection_recall(gt, {p: d["boxes"] for p, d in v1["photos"].items()}, by="subset"),
                                "ms_avg": round(float(np.mean([d["ms"] for d in v1["photos"].values()])), 1)}
    R["detection"] = det

    # ============================== pipelines ==============================
    pipelines = {}
    if v1:
        for tau, label in [(0.30, "V1_GHOSTFACENET(d0.70)"), (0.20, "V1_GHOSTFACENET(d0.80)")]:
            pipelines[label] = product_metrics(run_A(v1, gt, tau), gt)
    matched_B = run_B(index, v2, gt, config.FACE_STRICT_THRESHOLD)
    pipelines["V2_DIRECT"] = product_metrics(matched_B, gt)
    matched_C, outcomes_C = run_C(index, v2, gt)
    pipelines["V2_TEMPLATE"] = product_metrics(matched_C, gt)
    matched_D = run_D(index, v2, gt, verifier="consensus2")
    pipelines["V2_TEMPLATE_VERIFY"] = product_metrics(matched_D, gt)
    R["pipelines"] = pipelines

    # ============================== sweeps =================================
    strict_sweep = {}
    for t in [0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60]:
        m_b = product_metrics(run_B(index, v2, gt, t), gt)
        m_c = product_metrics(run_C(index, v2, gt, FACE_STRICT_THRESHOLD=t,
                                    FACE_RECOVERY_THRESHOLD=max(0.2, round(t - 0.11, 2)))[0], gt)
        strict_sweep[t] = {"direct": {k: m_b[k] for k in ("precision", "recall", "fp_total", "zero_fp_guest_rate")},
                           "template": {k: m_c[k] for k in ("precision", "recall", "fp_total", "zero_fp_guest_rate")}}
    R["strict_sweep"] = strict_sweep

    recovery_sweep = {}
    for r in [0.26, 0.30, 0.34, 0.38, 0.42]:
        m = product_metrics(run_C(index, v2, gt, FACE_RECOVERY_THRESHOLD=r)[0], gt)
        recovery_sweep[r] = {k: m[k] for k in ("precision", "recall", "fp_total", "zero_fp_guest_rate")}
    R["recovery_sweep"] = recovery_sweep

    seeds_sweep = {}
    for s in [1, 3, 5, 8, 12]:
        m = product_metrics(run_C(index, v2, gt, FACE_MAX_SEEDS=s)[0], gt)
        seeds_sweep[s] = {k: m[k] for k in ("precision", "recall", "fp_total", "zero_fp_guest_rate")}
    R["seeds_sweep"] = seeds_sweep

    seed_strategy = {}
    seed_strategy["quality+diverse (prod)"] = {k: pipelines["V2_TEMPLATE"][k] for k in ("precision", "recall", "fp_total")}
    m = product_metrics(run_C(index, v2, gt, FACE_SEED_DIVERSITY_MAX_SIM=1.1)[0], gt)
    seed_strategy["quality, no diversity"] = {k: m[k] for k in ("precision", "recall", "fp_total")}
    m = product_metrics(run_C(index, v2, gt, FACE_MIN_SEED_QUALITY=0.0, FACE_SEED_DIVERSITY_MAX_SIM=1.1)[0], gt)
    seed_strategy["plain top-K"] = {k: m[k] for k in ("precision", "recall", "fp_total")}
    R["seed_strategy"] = seed_strategy

    consensus = {}
    for verifier, label in [(None, "A best-similarity only (=C)"),
                            ("consensus2", "B >=2 reference agreement"),
                            ("quality_scaled", "C quality-scaled recovery"),
                            ("consensus2+quality", "D both")]:
        m = product_metrics(matched_C if verifier is None else run_D(index, v2, gt, verifier), gt)
        consensus[label] = {k: m[k] for k in ("precision", "recall", "fp_total", "zero_fp_guest_rate")}
    R["consensus_rules"] = consensus

    second = {"one_selfie": {k: pipelines["V2_TEMPLATE"][k] for k in ("precision", "recall", "fp_total", "zero_fp_guest_rate")}}
    m2 = product_metrics(run_C(index, v2, gt, n_selfies=2)[0], gt)
    second["two_selfies"] = {k: m2[k] for k in ("precision", "recall", "fp_total", "zero_fp_guest_rate")}
    R["second_selfie"] = second

    # quality buckets on the production pipeline results
    buckets = {"HIGH(>0.7)": [0, 0], "MED(0.45-0.7)": [0, 0], "LOW(<0.45)": [0, 0]}
    for person, out in outcomes_C.items():
        truth = set(gt["people"][person]["positive_photos"])
        for c in out.candidates:
            if c.tier not in ("CONFIDENT", "LIKELY"):
                continue
            b = "HIGH(>0.7)" if c.quality > 0.7 else ("MED(0.45-0.7)" if c.quality >= 0.45 else "LOW(<0.45)")
            buckets[b][0 if c.photo_id in truth else 1] += 1
    R["quality_buckets"] = {b: {"tp_faces": v[0], "fp_faces": v[1]} for b, v in buckets.items()}

    R["failure_classes"] = classify_failures(matched_C, matched_D, gt, index, v2)
    R["worst_false_positives"] = fp_report(matched_D, gt, index, v2)
    R["margin"] = margin_analysis(matched_C, gt, index, v2)

    path = save_report(reports_dir, "benchmark", R)
    print(f"report JSON -> {path}")
    write_markdown(R, det, reports_dir, index, index_notile)


def write_markdown(R, det, reports_dir, index, index_notile) -> None:
    L = []
    m = R["meta"]; d = R["dataset"]
    L.append("# Face Search Evaluation\n")
    L.append(f"{m['date']} · commit {m['git_commit']} · dataset {m['dataset_version']} · "
             f"{m['detector']} + {m['recognizer']} · strict {m['thresholds']['strict']} / "
             f"recovery {m['thresholds']['recovery']}\n")
    L.append(f"Dataset: {d['identities']} identities, {d['photos']} photos, "
             f"{d['gt_faces']} labeled faces, {d['indexed_faces']} indexed faces (v2 tiled).\n")

    L.append("## End-to-end guest search\n")
    L.append("| Pipeline | Precision | Recall | FP | Zero-FP guests | P95 FP/guest |")
    L.append("|---|---|---|---|---|---|")
    for name, mm in R["pipelines"].items():
        L.append(fmt_row(name, mm))
    L.append("")

    L.append("## Recall by hard subset (end-to-end)\n")
    subs = SUBSETS
    L.append("| Pipeline | " + " | ".join(subs) + " |")
    L.append("|---|" + "---|" * len(subs))
    for name, mm in R["pipelines"].items():
        L.append(f"| {name} | " + " | ".join(
            f"{mm['subset_recall'][s]:.3f}" if mm['subset_recall'][s] is not None else "-" for s in subs) + " |")
    L.append("")

    L.append("## Detection\n")
    L.append("| Detector | Overall | <32px | 32-64px | 64-128px | GROUP subset | ms/photo |")
    L.append("|---|---|---|---|---|---|---|")
    for name, dd in det.items():
        bs = dd["by_size"]; sub = dd["by_subset"]
        def g(k):
            return f"{bs[k]['recall']:.3f}" if k in bs else "-"
        L.append(f"| {name} | {dd['overall']['all']['recall']:.3f} | {g('0-32px')} | "
                 f"{g('32-64px')} | {g('64-128px')} | "
                 f"{sub.get('GROUP', {}).get('recall', '-')} | {dd['ms_avg']} |")
    L.append(f"\nv2 index sizes: tiled {len(index.face_ids)} faces vs no-tile "
             f"{len(index_notile.face_ids)} faces.\n")

    for title, key in [("Strict-threshold sweep (direct vs template)", "strict_sweep"),
                       ("Recovery-threshold sweep (template)", "recovery_sweep"),
                       ("Max-seeds sweep", "seeds_sweep")]:
        L.append(f"## {title}\n")
        rows = R[key]
        first = next(iter(rows.values()))
        if "direct" in first:
            L.append("| threshold | P(direct) | R(direct) | P(template) | R(template) | FP(t) | zeroFP(t) |")
            L.append("|---|---|---|---|---|---|---|")
            for t, v in rows.items():
                L.append(f"| {t} | {v['direct']['precision']:.4f} | {v['direct']['recall']:.4f} "
                         f"| {v['template']['precision']:.4f} | {v['template']['recall']:.4f} "
                         f"| {v['template']['fp_total']} | {v['template']['zero_fp_guest_rate']*100:.0f}% |")
        else:
            L.append("| value | precision | recall | FP | zero-FP guests |")
            L.append("|---|---|---|---|---|")
            for t, v in rows.items():
                L.append(f"| {t} | {v['precision']:.4f} | {v['recall']:.4f} | {v['fp_total']} "
                         f"| {v['zero_fp_guest_rate']*100:.0f}% |")
        L.append("")

    L.append("## Seed selection strategy\n")
    L.append("| strategy | precision | recall | FP |")
    L.append("|---|---|---|---|")
    for k, v in R["seed_strategy"].items():
        L.append(f"| {k} | {v['precision']:.4f} | {v['recall']:.4f} | {v['fp_total']} |")
    L.append("\n## Candidate acceptance / consensus rules\n")
    L.append("| rule | precision | recall | FP | zero-FP guests |")
    L.append("|---|---|---|---|---|")
    for k, v in R["consensus_rules"].items():
        L.append(f"| {k} | {v['precision']:.4f} | {v['recall']:.4f} | {v['fp_total']} "
                 f"| {v['zero_fp_guest_rate']*100:.0f}% |")

    L.append("\n## Second selfie\n")
    for k, v in R["second_selfie"].items():
        L.append(f"- {k}: precision {v['precision']:.4f}, recall {v['recall']:.4f}, "
                 f"FP {v['fp_total']}, zero-FP guests {v['zero_fp_guest_rate']*100:.0f}%")

    L.append("\n## Failure breakdown (final pipeline false negatives)\n")
    for k, v in R["failure_classes"].items():
        L.append(f"- {k}: {v}")
    L.append("\n## Quality buckets (accepted faces, production pipeline)\n")
    for k, v in R["quality_buckets"].items():
        L.append(f"- {k}: TP faces {v['tp_faces']}, FP faces {v['fp_faces']}")
    L.append("\n## Best-vs-second-best identity margin\n")
    L.append(f"- TP: {R['margin']['tp']}")
    L.append(f"- FP: {R['margin']['fp']}")
    L.append("\n## Worst false positives\n")
    for r in R["worst_false_positives"]:
        L.append(f"- query {r['query_identity']} got {r['photo']} ({r['subset']}, "
                 f"actually {r['wrong_identity']}, sim {r['similarity']}, "
                 f"q {r['quality']}, {r['face_px']}px)")

    out = os.path.join(reports_dir, "REPORT.md")
    with open(out, "w") as f:
        f.write("\n".join(L) + "\n")
    print(f"markdown report -> {out}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--golden", default="eval/wedding")
    args = parser.parse_args()
    main(args.golden)
