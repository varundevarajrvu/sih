"""ner/bench.py -- writes benchmarks/results/v1b-ner.json.

Measures, in-process against ner_engine.py directly (not through the HTTP
layer -- loopback HTTP overhead is negligible and this isolates exactly the
number the phase brief's pre-registered 1.5s rule is about: NER inference
latency):

  1. cold load time (model_loader.load_model, fresh ModelState)
  2. warm p50/p95, CACHE DISABLED, on the 2 KB checkout-blob fixture
     (spikes/gliner/fixtures.json's f10_checkout_blob -- the same fixture
     V0a's pre-registered decision rule was measured against)
  3. a 10-step simulated agent run where 9/10 texts repeat each step after
     the first (~90% cache hit), CACHE ENABLED -- p50/p95 over steps 1-9
     (step 0 is the cold-cache first scan, reported separately)
  4. recall against all 10 fixtures' expected entities

Checks CPU load first (Win32_Processor.LoadPercentage) and polls briefly if
another process is busy (another agent may be running Chromium
benchmarks); the load measured immediately before the timed section is
recorded in the output JSON either way, so the numbers are never presented
without their contention context.

PRE-REGISTERED FOLLOW-UP RULE (do not act on it here -- report only): if
`warm_uncached_2kb_p95_ms` > 1500, a second, smaller GLiNER PII model must
also be benchmarked on the same fixtures before anyone switches models.
This script does not download or evaluate an alternative model; it only
computes the boolean and flags it in the output for a human to act on.

Run (spike venv has torch+gliner):
    spikes/gliner/.venv/Scripts/python.exe -m ner.bench
"""

from __future__ import annotations

import json
import statistics
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

from . import config
from . import labels as labels_mod
from . import model_loader
from .cache import LRUSpanCache
from .ner_engine import detect_entities, detect_entities_single

REPO_ROOT = config.REPO_ROOT
FIXTURES_PATH = REPO_ROOT / "spikes" / "gliner" / "fixtures.json"
OUT_PATH = REPO_ROOT / "benchmarks" / "results" / "v1b-ner.json"

WARM_RUNS = 20
LOAD_THRESHOLD_PERCENT = 30
LOAD_POLL_ATTEMPTS = 4
LOAD_POLL_WAIT_S = 15
LATENCY_GATE_MS = 1500.0


def _percentile(values: List[float], pct: float) -> float:
    s = sorted(values)
    k = max(0, min(len(s) - 1, int(round(pct / 100 * (len(s) - 1)))))
    return s[k]


def _cpu_load_percent() -> "int | None":
    """Read Win32_Processor.LoadPercentage via PowerShell. Returns None if
    the read fails (never blocks the benchmark on a diagnostic)."""
    try:
        out = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                "(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average",
            ],
            capture_output=True,
            text=True,
            timeout=15,
        )
        return int(round(float(out.stdout.strip())))
    except Exception:
        return None


def _wait_for_idle_cpu() -> Dict[str, Any]:
    """Poll CPU load a few times before the timed section; proceed
    regardless once attempts are exhausted, recording what was actually
    observed rather than blocking indefinitely (another agent's Chromium
    benchmark may simply run the whole time this script does)."""
    readings = []
    for attempt in range(LOAD_POLL_ATTEMPTS):
        load = _cpu_load_percent()
        readings.append(load)
        print(f"[bench] cpu load attempt {attempt}: {load}%", file=sys.stderr)
        if load is not None and load < LOAD_THRESHOLD_PERCENT:
            break
        if attempt < LOAD_POLL_ATTEMPTS - 1:
            time.sleep(LOAD_POLL_WAIT_S)
    final = readings[-1]
    return {
        "readings_percent": readings,
        "final_percent": final,
        "contended": (final is None) or (final >= LOAD_THRESHOLD_PERCENT),
        "threshold_percent": LOAD_THRESHOLD_PERCENT,
    }


def _load_fixtures() -> List[Dict[str, Any]]:
    return json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))["fixtures"]


def _overlaps(a_start, a_end, b_start, b_end) -> bool:
    return a_start < b_end and b_start < a_end


def _recall(model) -> Dict[str, Any]:
    fixtures = _load_fixtures()
    total_expected = 0
    total_matched = 0
    per_fixture = []
    for fx in fixtures:
        spans = detect_entities_single(fx["text"], model)
        expected = fx["expected"]
        matched = 0
        misses = []
        for exp in expected:
            hit = any(
                s["label"] == exp["label"] and _overlaps(s["start"], s["end"], exp["start"], exp["end"])
                for s in spans
            )
            if hit:
                matched += 1
            else:
                misses.append(exp)
        total_expected += len(expected)
        total_matched += matched
        per_fixture.append(
            {
                "id": fx["id"],
                "expected_count": len(expected),
                "matched_count": matched,
                "missed": misses,
                "produced_spans": spans,
            }
        )
    return {
        "total_expected": total_expected,
        "total_matched": total_matched,
        "recall": (total_matched / total_expected) if total_expected else None,
        "per_fixture": per_fixture,
    }


def main() -> None:
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    print("[bench] checking CPU load before starting (another agent may be busy)...", file=sys.stderr)
    pre_load_load = _wait_for_idle_cpu()

    # --- 1. cold load ---------------------------------------------------
    state = model_loader.ModelState()
    print("[bench] cold loading model...", file=sys.stderr)
    t0 = time.perf_counter()
    model_loader.load_model(state)
    cold_load_s = time.perf_counter() - t0
    if state.model is None:
        raise RuntimeError(f"model failed to load: {state.load_error}")
    print(f"[bench] cold load: {cold_load_s:.3f}s", file=sys.stderr)

    # CPU load right before the timed section is what actually matters for
    # interpreting the latency numbers below -- re-check now, after the
    # ~20-110s cold load has had time to change the picture.
    load_at_bench = _wait_for_idle_cpu()

    # --- 2. warm p50/p95, cache DISABLED, on the 2 KB checkout blob -----
    fixtures = {fx["id"]: fx for fx in _load_fixtures()}
    blob_text = fixtures["f10_checkout_blob"]["text"]

    warm_uncached_ms: List[float] = []
    for _ in range(WARM_RUNS):
        t0 = time.perf_counter()
        detect_entities_single(blob_text, state.model)  # no cache passed -> always uncached
        warm_uncached_ms.append((time.perf_counter() - t0) * 1000.0)

    warm_uncached_p50 = _percentile(warm_uncached_ms, 50)
    warm_uncached_p95 = _percentile(warm_uncached_ms, 95)
    print(
        f"[bench] warm uncached 2KB blob: p50={warm_uncached_p50:.1f}ms p95={warm_uncached_p95:.1f}ms",
        file=sys.stderr,
    )

    # --- 3. 10-step simulated run, ~90% repeat, cache ENABLED -----------
    all_fixture_texts = [fx["text"] for fx in _load_fixtures()]  # 10 texts
    cache = LRUSpanCache(max_entries=config.CACHE_MAX_ENTRIES)

    step_latencies_ms: List[float] = []
    step_cache_hits: List[int] = []
    step_cache_misses: List[int] = []
    for step_i in range(10):
        step_texts = list(all_fixture_texts)
        if step_i > 0:
            idx = (step_i - 1) % len(step_texts)
            # 9/10 texts byte-identical to every prior step (guaranteed
            # cache hits by construction); exactly 1/10 changed, simulating
            # "page text barely changes between agent steps."
            step_texts[idx] = step_texts[idx] + f" (step {step_i} delta)"

        hits_before, misses_before = cache.hits, cache.misses
        t0 = time.perf_counter()
        detect_entities(step_texts, state.model, cache=cache)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0

        step_latencies_ms.append(elapsed_ms)
        step_cache_hits.append(cache.hits - hits_before)
        step_cache_misses.append(cache.misses - misses_before)

    # Step 0 is the cold-cache scan (0% hit, expected); steps 1-9 are the
    # ~90%-repeat warm-cache run this measurement is actually about.
    warm_cached_steps_ms = step_latencies_ms[1:]
    warm_cached_p50 = _percentile(warm_cached_steps_ms, 50)
    warm_cached_p95 = _percentile(warm_cached_steps_ms, 95)
    print(
        f"[bench] 10-step ~90%-repeat run: step0(cold)={step_latencies_ms[0]:.1f}ms "
        f"steps1-9 p50={warm_cached_p50:.1f}ms p95={warm_cached_p95:.1f}ms",
        file=sys.stderr,
    )

    # --- 4. recall on the 10 fixtures ------------------------------------
    recall_result = _recall(state.model)
    print(f"[bench] recall: {recall_result['total_matched']}/{recall_result['total_expected']}", file=sys.stderr)

    latency_gate_triggered = warm_uncached_p95 > LATENCY_GATE_MS

    output = {
        "phase": "V1b ner-service",
        "model_id": config.MODEL_ID,
        "labels_requested": list(labels_mod.GLINER_LABELS),
        "torch_threads": config.TORCH_THREADS,
        "cache_max_entries": config.CACHE_MAX_ENTRIES,
        "cpu_load": {
            "pre_load_check": pre_load_load,
            "pre_bench_check": load_at_bench,
        },
        "cold_load_s": round(cold_load_s, 3),
        "warm_uncached_2kb_blob": {
            "fixture_id": "f10_checkout_blob",
            "text_len_chars": len(blob_text),
            "runs": WARM_RUNS,
            "p50_ms": round(warm_uncached_p50, 2),
            "p95_ms": round(warm_uncached_p95, 2),
            "mean_ms": round(statistics.mean(warm_uncached_ms), 2),
            "min_ms": round(min(warm_uncached_ms), 2),
            "max_ms": round(max(warm_uncached_ms), 2),
            "all_ms": [round(v, 2) for v in warm_uncached_ms],
        },
        "ten_step_simulated_run_90pct_repeat": {
            "step_latencies_ms": [round(v, 2) for v in step_latencies_ms],
            "step_cache_hits": step_cache_hits,
            "step_cache_misses": step_cache_misses,
            "step0_cold_ms": round(step_latencies_ms[0], 2),
            "steps1to9_warm_cached_p50_ms": round(warm_cached_p50, 2),
            "steps1to9_warm_cached_p95_ms": round(warm_cached_p95, 2),
        },
        "recall": recall_result,
        "pre_registered_1500ms_rule": {
            "gate_ms": LATENCY_GATE_MS,
            "measured_warm_uncached_p95_ms": round(warm_uncached_p95, 2),
            "triggered": latency_gate_triggered,
            "note": (
                "If triggered, benchmark one smaller GLiNER PII model on the same "
                "10 fixtures and report both -- do NOT switch models without "
                "explicit approval (see ner/README.md)."
                if latency_gate_triggered
                else "Not triggered -- no smaller-model benchmark required by this rule."
            ),
        },
    }

    OUT_PATH.write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(f"[bench] wrote {OUT_PATH}", file=sys.stderr)


if __name__ == "__main__":
    main()
