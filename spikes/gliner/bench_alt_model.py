"""spikes/gliner/bench_alt_model.py -- PRE-REGISTERED FOLLOW-UP RULE.

V1b ner-service's ner/bench.py measured the warm UNCACHED p95 on the 2 KB
f10_checkout_blob fixture at 4,736.5 ms (uncontended, CPU load 2%) against
urchade/gliner_multi_pii-v1 -- see benchmarks/results/v1b-ner.json. The
phase brief's pre-registered rule: "if the warm uncached 2 KB p95 is >
1,500 ms, also benchmark ONE smaller GLiNER PII-capable model ... and
report both. Do NOT switch models yourself -- I decide." 4,736.5 > 1,500,
so this script exists.

Model chosen: `vicgalle/gliner-small-pii` (fine-tuned from
gliner-community/gliner_small-v2.5, ~0.2B params, Apache 2.0, PII-labelled
fine-tune -- vs. the production model's ~278M-param mdeberta-v3-base
backbone). Picked over `urchade/gliner_small-v2.1` (166M params but a
GENERAL-purpose NER fine-tune, not PII-specific) because the brief asks for
a "PII-capable" model, not merely a smaller one.

This script is DELIBERATELY OUTSIDE `ner/` -- it must never be imported by
the production service, and it is the one place in this phase's work that
needs live network access (to download the new model), so it does NOT set
HF_HUB_OFFLINE. It reuses ner/chunking.py and ner/labels.py (both pure,
torch-free) so the alt-model numbers are produced by the exact same
chunking/mapping/recall logic as the production benchmark, for a fair
comparison -- only the model object differs.

Writes its result into benchmarks/results/v1b-ner.json under the
"alt_model_benchmark" key, alongside (not replacing) the primary result
ner/bench.py already wrote there.

Run (spike venv):
    spikes/gliner/.venv/Scripts/python.exe spikes/gliner/bench_alt_model.py
"""

from __future__ import annotations

import json
import os
import statistics
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SPIKE_DIR = REPO_ROOT / "spikes" / "gliner"

# Same cache location as the production service's config.py -- reuse the
# HF cache dir, but deliberately do NOT set HF_HUB_OFFLINE=1: this script's
# whole purpose this one time is to download a model that isn't cached yet.
os.environ.setdefault("HF_HOME", str(SPIKE_DIR / ".hf"))
os.environ.setdefault("HF_HUB_ENABLE_HF_TRANSFER", "0")

sys.path.insert(0, str(REPO_ROOT))

from ner import labels as labels_mod  # noqa: E402  (pure, torch-free)
from ner.chunking import chunk_text  # noqa: E402  (pure, torch-free)

ALT_MODEL_ID = "vicgalle/gliner-small-pii"
FIXTURES_PATH = SPIKE_DIR / "fixtures.json"
OUT_PATH = REPO_ROOT / "benchmarks" / "results" / "v1b-ner.json"
WARM_RUNS = 20


def _percentile(values, pct):
    s = sorted(values)
    k = max(0, min(len(s) - 1, int(round(pct / 100 * (len(s) - 1)))))
    return s[k]


def _load_fixtures():
    return json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))["fixtures"]


def _overlaps(a_s, a_e, b_s, b_e):
    return a_s < b_e and b_s < a_e


def _detect_single(text, model):
    """Same chunk -> model.inference -> map/filter/dedupe pipeline as
    ner/ner_engine.py, inlined here to avoid importing ner_engine.py (which
    would be fine dependency-wise, but this keeps the alt-model script
    fully self-contained and obviously not wired into the production
    import graph)."""
    from ner.ner_engine import _dedupe, _map_and_filter  # pure, torch-free

    if not text:
        return []
    chunks = chunk_text(text)
    raw = model.inference(
        [c.text for c in chunks], labels_mod.GLINER_LABELS, threshold=labels_mod.PREDICT_FLOOR, batch_size=8
    )
    spans = []
    for chunk, r in zip(chunks, raw):
        spans.extend(_map_and_filter(r, chunk.offset))
    return _dedupe(spans)


def _prefetch_inference_files_only():
    """`GLiNER.from_pretrained` calls `snapshot_download` on the WHOLE repo
    by default. This repo (vicgalle/gliner-small-pii) is a raw training
    checkpoint dump, not a trimmed inference-only repo: `model_info` shows
    `optimizer.pt` alone is 1.27 GB (Adam momentum/variance state -- never
    needed for inference), plus a redundant duplicate of the weights in
    both `pytorch_model.bin` AND `model.safetensors` (633 MB each, only one
    is needed). An untrimmed download stalled well past 10 minutes on this
    connection. Pre-fetch just the files inference actually needs so
    `from_pretrained`'s own snapshot_download finds them already cached and
    fetches nothing further."""
    from huggingface_hub import snapshot_download

    # NOTE: model.safetensors (same weights, different format) repeatedly
    # stalled indefinitely on this connection across two separate attempts
    # while every other file (including the equally large tokenizer.json)
    # transferred fine -- a shard/CDN-specific issue, not a general
    # bandwidth problem. pytorch_model.bin carries the same weights; GLiNER
    # (and this repo's original urchade/gliner_multi_pii-v1) both load from
    # .bin natively, so this is not a downgrade.
    snapshot_download(
        repo_id=ALT_MODEL_ID,
        ignore_patterns=["optimizer.pt", "scheduler.pt", "rng_state.pth", "training_args.bin", "model.safetensors"],
    )


def main():
    print(f"[bench_alt] pre-fetching inference-only files for {ALT_MODEL_ID}...", file=sys.stderr)
    _prefetch_inference_files_only()

    print(f"[bench_alt] loading {ALT_MODEL_ID} (local_files_only, no further network calls)...", file=sys.stderr)
    from gliner import GLiNER

    t0 = time.perf_counter()
    # local_files_only=True is load-bearing here, not a style choice:
    # without it, from_pretrained() runs its OWN internal snapshot_download
    # of the full repo (all 14 files, including the 1.27 GB optimizer.pt
    # this script's prefetch deliberately skipped) regardless of what was
    # already prefetched -- discovered when this happened for real and
    # re-triggered the exact multi-GB download the prefetch step exists to
    # avoid. Everything inference needs is already local at this point.
    model = GLiNER.from_pretrained(ALT_MODEL_ID, local_files_only=True)
    model.eval()
    cold_load_s = time.perf_counter() - t0
    print(f"[bench_alt] cold load: {cold_load_s:.3f}s", file=sys.stderr)

    # Model size on disk (mirrors bench_python.py's own measurement).
    hf_hub_dir = Path(os.environ["HF_HOME"]) / "hub"
    model_dir = hf_hub_dir / ("models--" + ALT_MODEL_ID.replace("/", "--"))
    model_size_mb = 0.0
    if model_dir.exists():
        model_size_mb = sum(p.stat().st_size for p in model_dir.rglob("*") if p.is_file() and not p.is_symlink()) / (
            1024 * 1024
        )
    print(f"[bench_alt] model size on disk: {model_size_mb:.1f} MB", file=sys.stderr)

    fixtures = {fx["id"]: fx for fx in _load_fixtures()}
    blob_text = fixtures["f10_checkout_blob"]["text"]

    warm_ms = []
    for _ in range(WARM_RUNS):
        t0 = time.perf_counter()
        _detect_single(blob_text, model)
        warm_ms.append((time.perf_counter() - t0) * 1000.0)
    p50 = _percentile(warm_ms, 50)
    p95 = _percentile(warm_ms, 95)
    print(f"[bench_alt] warm uncached 2KB blob: p50={p50:.1f}ms p95={p95:.1f}ms", file=sys.stderr)

    # Recall on all 10 fixtures, same methodology as ner/bench.py.
    total_expected = 0
    total_matched = 0
    per_fixture = []
    for fx in _load_fixtures():
        spans = _detect_single(fx["text"], model)
        matched = 0
        misses = []
        for exp in fx["expected"]:
            hit = any(s["label"] == exp["label"] and _overlaps(s["start"], s["end"], exp["start"], exp["end"]) for s in spans)
            if hit:
                matched += 1
            else:
                misses.append(exp)
        total_expected += len(fx["expected"])
        total_matched += matched
        per_fixture.append({"id": fx["id"], "expected_count": len(fx["expected"]), "matched_count": matched, "missed": misses})
    recall = (total_matched / total_expected) if total_expected else None
    print(f"[bench_alt] recall: {total_matched}/{total_expected}", file=sys.stderr)

    result = {
        "model_id": ALT_MODEL_ID,
        "reason": "PRE_REGISTERED_1500MS_RULE_TRIGGERED",
        "primary_model_warm_uncached_p95_ms": 4736.5,
        "model_size_on_disk_mb": round(model_size_mb, 2),
        "cold_load_s": round(cold_load_s, 3),
        "warm_uncached_2kb_blob": {
            "fixture_id": "f10_checkout_blob",
            "runs": WARM_RUNS,
            "p50_ms": round(p50, 2),
            "p95_ms": round(p95, 2),
            "mean_ms": round(statistics.mean(warm_ms), 2),
            "min_ms": round(min(warm_ms), 2),
            "max_ms": round(max(warm_ms), 2),
        },
        "recall": {
            "total_matched": total_matched,
            "total_expected": total_expected,
            "recall": recall,
            "per_fixture": per_fixture,
        },
        "note": (
            "Benchmarked per the pre-registered follow-up rule after the primary "
            "model's warm uncached p95 exceeded 1500ms. This does NOT change the "
            "production model -- that decision is explicitly reserved (see "
            "ner/README.md and docs/v2/ARCHITECTURE.md contract C3)."
        ),
    }

    existing = {}
    if OUT_PATH.exists():
        existing = json.loads(OUT_PATH.read_text(encoding="utf-8"))
    existing["alt_model_benchmark"] = result
    OUT_PATH.write_text(json.dumps(existing, indent=2), encoding="utf-8")
    print(f"[bench_alt] wrote alt_model_benchmark into {OUT_PATH}", file=sys.stderr)


if __name__ == "__main__":
    main()
