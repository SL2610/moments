# Face Engine v2

SCRFD-10G detection + AdaFace IR101 (WebFace12M) recognition, exact in-memory search, and a precision-first two-stage identity algorithm. Replaces the GhostFaceNet/DeepFace pipeline.

## How it works

```mermaid
flowchart TD
    subgraph INDEXING [Indexing: offline, per photo]
        A[Original photo] --> B[EXIF orientation fix]
        B --> C[Resize to FACE_DETECTION_LONG_SIDE 2400px]
        C --> D[SCRFD full-frame pass 640]
        C --> E[SCRFD 640px tiles, 20% overlap]
        D --> F[NMS merge duplicates]
        E --> F
        F --> G[5-point alignment from the ORIGINAL resolution]
        G --> H[AdaFace IR101 batch embed]
        H --> I[L2-normalized 512-d embeddings + quality, confidence, size, blur, versions]
        I --> J[(PostgreSQL photo_embeddings)]
        I --> K{Outcome}
        K -->|faces| L[state READY]
        K -->|no faces| M[state NO_FACES]
        K -->|any error/timeout| N[state FAILED + error kept visible]
    end
```

```mermaid
flowchart TD
    subgraph SEARCH [Guest search: two stages, precision first]
        S[Guest selfie] --> S1[SCRFD: largest face only, ambiguous selfies rejected]
        S1 --> S2[Align + AdaFace embed, raw selfie deleted]
        S2 --> S3["Exact cosine search over the album (in-memory matrix)"]
        S3 --> A1{"Stage A: sim >= STRICT (0.45)"}
        A1 -->|yes, and quality >= seed gate| SEEDS["Event seeds: diverse, max 8, 1 per photo"]
        T[Photos already name-tagged as this guest] -->|face also resembles the selfie| SEEDS
        SEEDS --> TPL["Identity template = selfie anchors + seeds + centroid"]
        TPL --> B1["Stage B (one round only): accept if sim_selfie >= STRICT OR (centroid >= RECOVERY AND some seed >= RECOVERY)"]
        B1 --> TIERS[CONFIDENT / LIKELY kept, WEAK / REJECTED dropped]
        TIERS --> DEDUP[Deduplicate faces to photos, rank]
        DEDUP --> OUT["matched_photo_ids + confidence + needs_second_selfie"]
        A1 -->|too few seeds| SECOND[Ask for one more selfie from a different angle, embeddings merge into the same search]
    end
```

Anti-contamination rules: only strict, quality-gated matches seed the template; Stage B results never become seeds; expansion runs exactly once; the selfie stays a permanent anchor; a mis-tagged photo is ignored unless the face also resembles the selfie.

## Configuration (.env)

| Variable | Default | Meaning |
|---|---|---|
| `FACE_DEVICE` | cpu | `cuda` with docker-compose.gpu.yml |
| `FACE_RECOGNIZER` | adaface_ir101 | or `arcface_w600k_r50` (auto-downloaded fallback) |
| `FACE_DETECTION_LONG_SIDE` | 2400 | inference copy size; originals untouched |
| `FACE_DETECTION_TILING` | true | native-res 640 tiles for small faces in group photos |
| `FACE_STRICT_THRESHOLD` | 0.45 | UN-CALIBRATED DEV DEFAULT; Stage A/seed gate |
| `FACE_RECOVERY_THRESHOLD` | 0.34 | UN-CALIBRATED DEV DEFAULT; Stage B gate |
| `FACE_MIN_SEED_QUALITY` | 0.45 | faces below this never seed the template |
| `AI_INFERENCE_CONCURRENCY` | 2 | simultaneous model inferences; extra searches queue |
| `STORE_DEBUG_FACE_CROPS` | false | aligned crops in `data/photos/debug/faces/` |
| `ADMIN_DEBUG_TOKEN` | empty | empty = admin API disabled entirely |

Old `FACE_SEARCH_*` knobs (GhostFaceNet era) are obsolete and removed.

## Operations

```bash
# reindex (CLI is the primary interface)
docker compose exec ai-worker python reindex.py --album <id>   # or --photo / --failed / --all
docker compose exec ai-worker python reindex.py --status

# threshold calibration from labeled faces (eval/identities/<person>/*.jpg)
docker compose exec ai-search python calibrate.py --dir eval/identities

# golden-set regression (eval/queries + eval/ground_truth.json)
docker compose exec ai-search python evaluate.py --album <id>

# unit tests
docker compose exec ai-search python -m pytest tests -q
```

Admin debug API (requires `X-Admin-Token: $ADMIN_DEBUG_TOKEN`):

```bash
curl -H "X-Admin-Token: $TOK" http://localhost:2610/api/ai/admin/photos/<photo-id>/faces
curl -H "X-Admin-Token: $TOK" -F album_id=<id> -F file=@selfie.jpg \
     http://localhost:2610/api/ai/admin/search-debug
```

The admin album view also shows per-face confidence/quality/size on hover over each face box.

## Evaluation

`ai-face-worker/eval/` holds the reproducible benchmark suite (golden-set builder, V1/V2 embedders, A/B/C/D pipeline comparison, ablations, threshold sweeps, failure classification, performance/concurrency bench). Results live in `eval/reports/REPORT.md`. Headline vs the old engine on identical data: precision 0.65 -> 0.999, recall 0.69 -> 0.997, zero-false-positive guests 23% -> 96%, small-face detection 0.19 -> 0.96.

## Processing states

`photos.processing_state`: `PENDING → PROCESSING → READY | NO_FACES | FAILED` (with `processing_error`, `face_count`, `processing_attempts`, model versions). A failure is never recorded as processed. Embeddings carry `detector_version`/`recognizer_version`; search only loads current-version rows and answers `reindex-required` instead of silently returning nothing when versions mismatch.

## Models

Weights persist in the `ai-models` volume (`/models/face`), downloaded once on first start: `det_10g.onnx` (SCRFD, insightface release) and `adaface_ir101.onnx` (ONNX export of AdaFace IR101 WebFace12M, HuggingFace).
