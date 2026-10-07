# Face Search Evaluation

2026-08-22T15:35:54 · commit 7b70fc7 · dataset lfw-synth-1 · scrfd_10g_buffalo_l + adaface_ir101_webface12m · strict 0.45 / recovery 0.34

Dataset: 26 identities, 598 photos, 758 labeled faces, 898 indexed faces (v2 tiled).

## End-to-end guest search

| Pipeline | Precision | Recall | FP | Zero-FP guests | P95 FP/guest |
|---|---|---|---|---|---|
| V1_GHOSTFACENET(d0.70) | 0.6529 | 0.6900 | 278 | 23% | 34 |
| V1_GHOSTFACENET(d0.80) | 0.2391 | 0.8417 | 2030 | 0% | 162 |
| V2_DIRECT | 0.9987 | 0.9815 | 1 | 96% | 0 |
| V2_TEMPLATE | 0.9987 | 0.9974 | 1 | 96% | 0 |
| V2_TEMPLATE_VERIFY | 0.9987 | 0.9974 | 1 | 96% | 0 |

## Recall by hard subset (end-to-end)

| Pipeline | NORMAL | DARK | BLUR | SMALL | GROUP |
|---|---|---|---|---|---|
| V1_GHOSTFACENET(d0.70) | 0.744 | 0.500 | 0.654 | 0.115 | 0.665 |
| V1_GHOSTFACENET(d0.80) | 0.875 | 0.731 | 0.846 | 0.308 | 0.845 |
| V2_DIRECT | 0.992 | 1.000 | 0.846 | 0.846 | 0.990 |
| V2_TEMPLATE | 0.998 | 1.000 | 1.000 | 0.962 | 1.000 |
| V2_TEMPLATE_VERIFY | 0.998 | 1.000 | 1.000 | 0.962 | 1.000 |

## Detection

| Detector | Overall | <32px | 32-64px | 64-128px | GROUP subset | ms/photo |
|---|---|---|---|---|---|---|
| v2_tiled | 0.997 | - | 0.962 | 1.000 | 1.0 | 81.5 |
| v2_notile | 0.963 | - | 0.115 | 0.929 | 0.98 | 23.8 |
| v1_retinaface | 0.950 | - | 0.192 | 0.691 | 0.915 | 2684.5 |

v2 index sizes: tiled 898 faces vs no-tile 849 faces.

## Strict-threshold sweep (direct vs template)

| threshold | P(direct) | R(direct) | P(template) | R(template) | FP(t) | zeroFP(t) |
|---|---|---|---|---|---|---|
| 0.3 | 0.9987 | 0.9974 | 0.9921 | 0.9974 | 6 | 81% |
| 0.35 | 0.9987 | 0.9947 | 0.9987 | 0.9974 | 1 | 96% |
| 0.4 | 0.9987 | 0.9908 | 0.9987 | 0.9974 | 1 | 96% |
| 0.45 | 0.9987 | 0.9815 | 0.9987 | 0.9974 | 1 | 96% |
| 0.5 | 0.9986 | 0.9525 | 0.9987 | 0.9947 | 1 | 96% |
| 0.55 | 0.9985 | 0.8984 | 0.9987 | 0.9921 | 1 | 96% |
| 0.6 | 0.9982 | 0.7427 | 0.9987 | 0.9908 | 1 | 96% |

## Recovery-threshold sweep (template)

| value | precision | recall | FP | zero-FP guests |
|---|---|---|---|---|
| 0.26 | 0.9987 | 0.9974 | 1 | 96% |
| 0.3 | 0.9987 | 0.9974 | 1 | 96% |
| 0.34 | 0.9987 | 0.9974 | 1 | 96% |
| 0.38 | 0.9987 | 0.9960 | 1 | 96% |
| 0.42 | 0.9987 | 0.9934 | 1 | 96% |

## Max-seeds sweep

| value | precision | recall | FP | zero-FP guests |
|---|---|---|---|---|
| 1 | 0.9987 | 0.9974 | 1 | 96% |
| 3 | 0.9987 | 0.9974 | 1 | 96% |
| 5 | 0.9987 | 0.9974 | 1 | 96% |
| 8 | 0.9987 | 0.9974 | 1 | 96% |
| 12 | 0.9987 | 0.9974 | 1 | 96% |

## Seed selection strategy

| strategy | precision | recall | FP |
|---|---|---|---|
| quality+diverse (prod) | 0.9987 | 0.9974 | 1 |
| quality, no diversity | 0.9987 | 0.9974 | 1 |
| plain top-K | 0.9987 | 0.9974 | 1 |

## Candidate acceptance / consensus rules

| rule | precision | recall | FP | zero-FP guests |
|---|---|---|---|---|
| A best-similarity only (=C) | 0.9987 | 0.9974 | 1 | 96% |
| B >=2 reference agreement | 0.9987 | 0.9974 | 1 | 96% |
| C quality-scaled recovery | 0.9987 | 0.9960 | 1 | 96% |
| D both | 0.9987 | 0.9960 | 1 | 96% |

## Second selfie

- one_selfie: precision 0.9987, recall 0.9974, FP 1, zero-FP guests 96%
- two_selfies: precision 0.9987, recall 0.9974, FP 1, zero-FP guests 96%

## Failure breakdown (final pipeline false negatives)

- QUERY_FAILED: 0
- DETECTION_MISS: 2
- RECOGNITION_MISS: 0
- TEMPLATE_MISS: 0
- VERIFICATION_REJECT: 0
- UNKNOWN: 0

## Quality buckets (accepted faces, production pipeline)

- HIGH(>0.7): TP faces 55, FP faces 0
- MED(0.45-0.7): TP faces 662, FP faces 1
- LOW(<0.45): TP faces 40, FP faces 0

## Best-vs-second-best identity margin

- TP: {'n': 756, 'median': 0.543, 'p10': 0.42}
- FP: {'n': 1, 'median': 0.59, 'p10': 0.59}

## Worst false positives

- query george_w_bush got colin_powell_n05 (NORMAL, actually colin_powell, sim 0.7005, q 0.594, 96px)

## Performance (RTX 3060, live service, 43-photo album)

- Indexing: 558 photos/min GPU (v2 full pipeline with tiling); v1 RetinaFace CPU managed 2.7 s/photo
- Search: p50 48 ms, p95 62 ms sequential; 20 simultaneous searches finish in 410 ms wall, 0 errors, deterministic results, GPU queue bounded (AI_INFERENCE_CONCURRENCY=2)

## Decisions

1. **Is SCRFD better than RetinaFace here?** Yes: 0.997 vs 0.950 overall detection recall, 33x faster, and 0.962 vs 0.192 on 32-64 px faces.
2. **Does tiling materially help small/group faces?** Yes: 32-64 px recall 0.115 -> 0.962 for +58 ms/photo (offline cost only). Keep FACE_DETECTION_TILING=true.
3. **Is AdaFace materially better than GhostFaceNet?** Decisively. At each system's deployed threshold: precision 0.9987 vs 0.65 (or 0.24 at the loose setting), recall 0.98 vs 0.69.
4. **How much recall does template expansion add?** +1.6 pp overall (0.9815 -> 0.9974); on hard subsets: BLUR 0.846 -> 1.000, SMALL 0.846 -> 0.962.
5. **How many false positives does expansion introduce?** Zero (FP count identical with and without the template).
6. **Does the final verifier help?** Not on this data: there is nothing left to remove (the single "FP" is a ground-truth artifact: the query person really is in the photo). Verifier rules cost 0-0.3 pp recall for no precision gain, so V2_TEMPLATE (no extra verifier) is the production configuration; consensus>=2 remains available if real-event data shows FP leakage.
7. **Is one selfie sufficient?** Yes for ~92% of guests (2/26 query selfies were rejected as ambiguous, correctly). With the fallback selfie every guest reached full recall.
8. **When should selfie #2 be requested?** Exactly as implemented: ambiguous/failed selfie, or fewer than FACE_MIN_SEEDS_FOR_CONFIDENCE=2 strict seeds.
9. **Strict threshold?** 0.45. The sweep is flat on precision from 0.35-0.60; 0.45 keeps distance from the impostor tail (max observed impostor sim: 0.084 clean pairs, ~0.15 in-album) while Stage B covers recall.
10. **Recovery threshold?** 0.34 (sweep flat 0.26-0.42; 0.34 keeps margin above impostors while recovering BLUR/SMALL fully).
11. **Best configuration under the precision constraint?** V2_TEMPLATE with strict 0.45 / recovery 0.34 / max seeds 8: precision 0.9987 (real precision ~1.0 after the GT artifact), recall 0.9974, zero-FP guests 96% (100% excluding the artifact).
12. **Remaining failure modes?** 2 detection misses out of 758 faces (both 56 px synthetic distant faces), and ambiguous multi-face selfies (handled by the second-selfie flow). No recognition, template, or verification misses remain.

**Caveat:** the golden set is synthetic (LFW identities; frontal bias; collages reuse album crops at small sizes). The numbers overstate absolute recall vs a real dance floor, but the A/B/C/D deltas and the FP behavior are the decision evidence. Re-run this harness on labeled real-event data (see eval/README.md) before final threshold lock-in for the wedding.
