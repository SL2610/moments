"""Live-service performance + concurrency benchmark for /search.

Measures sequential latency percentiles, concurrency behavior (1/5/10/20
simultaneous searches), and determinism (same selfie must return the same
photo set every time, regardless of concurrency).

Usage:
  python eval/perf_bench.py --album <album-id> --selfie <path> [--url ...]
"""

import argparse
import json
import statistics
import time
from concurrent.futures import ThreadPoolExecutor

import requests


def one_search(url, album_id, selfie_bytes):
    t0 = time.perf_counter()
    r = requests.post(url, data={"album_id": album_id},
                      files={"file": ("selfie.jpg", selfie_bytes, "image/jpeg")},
                      timeout=300)
    ms = (time.perf_counter() - t0) * 1000
    ids = tuple(sorted(r.json().get("matched_photo_ids", []))) if r.ok else ("ERR", r.status_code)
    return ms, ids


def pct(values, p):
    values = sorted(values)
    return values[min(len(values) - 1, int(p / 100 * len(values)))]


def main(url, album_id, selfie_path, out_path):
    selfie = open(selfie_path, "rb").read()
    report = {"url": url}

    lat = [one_search(url, album_id, selfie)[0] for _ in range(20)]
    report["sequential_ms"] = {"p50": round(pct(lat, 50)), "p95": round(pct(lat, 95)),
                               "p99": round(pct(lat, 99)), "mean": round(statistics.mean(lat))}
    print("sequential:", report["sequential_ms"])

    baseline_ids = one_search(url, album_id, selfie)[1]
    report["concurrency"] = {}
    for n in (1, 5, 10, 20):
        with ThreadPoolExecutor(max_workers=n) as pool:
            t0 = time.perf_counter()
            results = list(pool.map(lambda _: one_search(url, album_id, selfie), range(n)))
            wall = (time.perf_counter() - t0) * 1000
        latencies = [r[0] for r in results]
        deterministic = all(r[1] == baseline_ids for r in results)
        errors = sum(1 for r in results if r[1] and r[1][0] == "ERR")
        report["concurrency"][n] = {
            "wall_ms": round(wall), "p95_ms": round(pct(latencies, 95)),
            "max_ms": round(max(latencies)), "errors": errors,
            "deterministic": deterministic,
        }
        print(f"concurrency {n}: {report['concurrency'][n]}")

    with open(out_path, "w") as f:
        json.dump(report, f, indent=1)
    print(f"-> {out_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://localhost:2610/api/ai/search")
    parser.add_argument("--album", required=True)
    parser.add_argument("--selfie", required=True)
    parser.add_argument("--out", default="eval/reports/perf.json")
    args = parser.parse_args()
    main(args.url, args.album, args.selfie, args.out)
