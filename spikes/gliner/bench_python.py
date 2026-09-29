"""
Phase V0a spike: benchmark GLiNER PII NER in a loopback-only local Python process.

Measures: cold load time, per-fixture warm p50/p95 over 20 runs, spans with
scores, peak RSS. Every number here comes from a real run on this machine --
nothing is invented.

Usage:
    .venv/Scripts/python.exe bench_python.py
"""
import gc
import json
import os
import platform
import statistics
import sys
import time
from pathlib import Path

# Keep HF weights inside the spike folder, never touching the shared user cache.
SPIKE_DIR = Path(__file__).parent.resolve()
os.environ.setdefault("HF_HOME", str(SPIKE_DIR / ".hf"))
os.environ.setdefault("HF_HUB_ENABLE_HF_TRANSFER", "0")

import psutil  # noqa: E402  (import after HF_HOME is set)

MODEL_ID = "urchade/gliner_multi_pii-v1"
WARM_RUNS = 20
LABELS = [
    "person name",
    "address",
    "date of birth",
    "account number",
    "password",
    "email",
    "phone number",
]
# NER model confidence threshold for span extraction (GLiNER's own default is 0.5;
# we also record raw scores so downstream can re-threshold without re-running).
GLINER_THRESHOLD = 0.3

PROC = psutil.Process(os.getpid())


def rss_mb():
    return PROC.memory_info().rss / (1024 * 1024)


def percentile(values, pct):
    """Nearest-rank percentile, no interpolation surprises for small N."""
    s = sorted(values)
    k = max(0, min(len(s) - 1, int(round(pct / 100 * (len(s) - 1)))))
    return s[k]


def main():
    fixtures_path = SPIKE_DIR / "fixtures.json"
    fixtures = json.loads(fixtures_path.read_text(encoding="utf-8"))["fixtures"]

    print(f"[bench_python] Python {sys.version}", file=sys.stderr)
    print(f"[bench_python] HF_HOME={os.environ['HF_HOME']}", file=sys.stderr)
    print(f"[bench_python] loading GLiNER model: {MODEL_ID}", file=sys.stderr)

    rss_before_load = rss_mb()
    t0 = time.perf_counter()
    from gliner import GLiNER  # import here so cold-load timing includes torch init cost fairly

    model = GLiNER.from_pretrained(MODEL_ID)
    cold_load_s = time.perf_counter() - t0
    rss_after_load = rss_mb()
    print(f"[bench_python] cold load: {cold_load_s:.3f}s, RSS {rss_before_load:.1f} -> {rss_after_load:.1f} MB", file=sys.stderr)

    # One untimed warm-up call per fixture text length class isn't enough to
    # stabilize caches across *different* texts, so we do a single throwaway
    # predict call on the longest fixture to let torch/threading spin up,
    # then measure every fixture fresh.
    longest = max(fixtures, key=lambda f: len(f["text"]))
    _ = model.predict_entities(longest["text"], LABELS, threshold=GLINER_THRESHOLD)

    results = []
    peak_rss = max(rss_before_load, rss_after_load)

    for fx in fixtures:
        text = fx["text"]
        durations_ms = []
        last_spans = None
        for i in range(WARM_RUNS):
            gc.collect()
            t_start = time.perf_counter()
            spans = model.predict_entities(text, LABELS, threshold=GLINER_THRESHOLD)
            t_end = time.perf_counter()
            durations_ms.append((t_end - t_start) * 1000.0)
            last_spans = spans
            peak_rss = max(peak_rss, rss_mb())

        p50 = percentile(durations_ms, 50)
        p95 = percentile(durations_ms, 95)
        mean = statistics.mean(durations_ms)

        norm_spans = [
            {
                "start": s["start"],
                "end": s["end"],
                "label": s["label"],
                "text": s["text"],
                "score": round(float(s["score"]), 4),
            }
            for s in last_spans
        ]

        results.append({
            "id": fx["id"],
            "text_len_chars": len(text),
            "warm_runs": WARM_RUNS,
            "p50_ms": round(p50, 2),
            "p95_ms": round(p95, 2),
            "mean_ms": round(mean, 2),
            "min_ms": round(min(durations_ms), 2),
            "max_ms": round(max(durations_ms), 2),
            "spans": norm_spans,
        })
        print(
            f"[bench_python] {fx['id']:26s} p50={p50:8.2f}ms p95={p95:8.2f}ms "
            f"spans={len(norm_spans)}",
            file=sys.stderr,
        )
        for s in norm_spans:
            print(f"    -> [{s['label']:14s}] score={s['score']:.4f} {s['text']!r}", file=sys.stderr)

    peak_rss = max(peak_rss, rss_mb())

    # model size on disk: sum the snapshot dir for this repo in the HF cache
    model_size_bytes = 0
    hf_hub_dir = Path(os.environ["HF_HOME"]) / "hub"
    model_dir_name = "models--" + MODEL_ID.replace("/", "--")
    model_dir = hf_hub_dir / model_dir_name
    if model_dir.exists():
        for p in model_dir.rglob("*"):
            if p.is_file() and not p.is_symlink():
                model_size_bytes += p.stat().st_size

    output = {
        "path": "B_python_local_process",
        "model_id": MODEL_ID,
        "labels_requested": LABELS,
        "threshold": GLINER_THRESHOLD,
        "warm_runs_per_fixture": WARM_RUNS,
        "cold_load_s": round(cold_load_s, 3),
        "model_size_on_disk_mb": round(model_size_bytes / (1024 * 1024), 2),
        "peak_rss_mb": round(peak_rss, 2),
        "rss_before_load_mb": round(rss_before_load, 2),
        "rss_after_load_mb": round(rss_after_load, 2),
        "python_version": sys.version,
        "torch_version": __import__("torch").__version__,
        "platform": platform.platform(),
        "results": results,
    }

    out_path = SPIKE_DIR / "bench_python_result.json"
    out_path.write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(f"[bench_python] wrote {out_path}", file=sys.stderr)
    print(f"[bench_python] model size on disk: {output['model_size_on_disk_mb']} MB", file=sys.stderr)
    print(f"[bench_python] peak RSS: {output['peak_rss_mb']} MB", file=sys.stderr)


if __name__ == "__main__":
    main()
