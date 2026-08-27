# Face Engine Evaluation Suite

Reproducible, deterministic benchmarks for the face pipeline. Every run
records model versions, thresholds, git commit, date, and dataset version;
result JSONs in `reports/` are never overwritten.

## Layout

```
eval/
  build_golden.py   builds the synthetic Wedding Golden Set (LFW, seed=42)
  embed_v2.py       SCRFD+AdaFace embeddings (tiled + no-tile variants)
  embed_v1.py       legacy RetinaFace+GhostFaceNet embeddings (separate venv)
  analyze.py        pipelines A/B/C/D, ablations, sweeps, failures -> reports/
  perf_bench.py     live /search latency, concurrency, determinism
  wedding/          golden set data (generated; gitignored)
  datasets/         manually placed public datasets (gitignored)
  reports/          experiment results (committed)
```

## Golden set

`build_golden.py` synthesizes an event from 26 real LFW identities: NORMAL
photos plus DARK / BLUR / SMALL variants and 40 GROUP collages, with 2
held-out query selfies per person and face-level ground truth by
construction. Limits to note honestly: LFW crops are frontal-ish and group
collages reuse album crops at reduced size, so GROUP mostly measures
small-face detection + low-res recognition, not novel poses.

**Real wedding data beats this.** To evaluate on the actual event: put
originals under `wedding/photos/`, selfies under `wedding/queries/`, write
the same `ground_truth.json` (photo-level `people` section is enough; add
face-level `photos[].faces` bboxes to enable detection-vs-recognition
attribution), then run the same embed + analyze steps.

## Running

```bash
python eval/build_golden.py --out eval/wedding
docker cp eval/wedding chizze-ai-search-1:/app/eval/wedding
docker exec chizze-ai-search-1 python eval/embed_v2.py           # GPU
v1-venv/bin/python eval/embed_v1.py --golden eval/wedding        # baseline
python eval/analyze.py --golden eval/wedding                     # -> reports/
python eval/perf_bench.py --album <id> --selfie <selfie.jpg>
```

## Public benchmarks (manual download; not bundled)

- **WIDER FACE** (detection, esp. Hard): place under `datasets/widerface/`
  (`WIDER_val/images/...` + `wider_face_split/wider_face_val_bbx_gt.txt`).
  The same center-containment detection evaluator in `analyze.py`
  (`detection_recall`) can be pointed at a loader for it; sizes bucketed
  <32 / 32-64 / 64-128 / >128 px.
- **CPLFW** (pose): place pairs + images under `datasets/cplfw/`; embed both
  sides with `pipeline.embed_selfie`, then reuse `calibrate.py`'s
  distribution/ROC reporting on the genuine/impostor scores.
- **TinyFace** (low-res identification): place under `datasets/tinyface/`;
  rank-K identification is gallery matmul + argsort over the same embeddings.

These are diagnostics only. Production decisions follow the Wedding Golden
Set, because the product question is exactly: "one selfie in, every photo of
that guest out, nobody else's photos."
