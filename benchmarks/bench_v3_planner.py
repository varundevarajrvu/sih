"""V3 (planner-local) pre-registered model-selection benchmark.

Runs the real /v2/analyze path (uvicorn on 127.0.0.1:8012, backend=ollama)
against the 5 hand-built scene fixtures in tests/fixtures/v2/planner/, for
each of qwen2.5:1.5b, qwen2.5:3b, llama3.1:8b, 3 trials per fixture at
temperature 0. Scoring and fixtures were fixed BEFORE this script was run
(the "expected" block in each fixture) and are not adjusted afterward.

Score = HTTP 200 (schema-valid ActionResponseV2) AND the returned
(action, targetId, value, profileField) matches at least one entry in the
fixture's expected.accept list.

Usage (from repo root, server venv):
    server/.venv/Scripts/python.exe benchmarks/bench_v3_planner.py [output.json] [log_dir]

Writes benchmarks/results/v3-planner.json by default, or the path given
as the first CLI arg (e.g. benchmarks/results/v3-planner-retry1.json for
a re-run after a prompt/contract fix — CLAUDE.md §7's retry protocol:
the ORIGINAL file is never overwritten). Per-model uvicorn logs and raw
metrics go to the second CLI arg if given, else a temp directory (never
back into the repo tree — see the retry-1 cleanup note in
server/PLANNER.md for why this changed from an earlier repo-root
scratch_logs/ location).

Starts/stops its own uvicorn per model (sequentially — one model's
OLLAMA_TEXT_MODEL is baked into the server process's environment at
startup, so switching models means restarting the server, not just
changing a request). Explicit timeouts throughout; always terminates the
uvicorn subprocess it started, even on error.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

import httpx

REPO_ROOT = Path(__file__).resolve().parent.parent
SERVER_DIR = REPO_ROOT / "server"
FIXTURES_DIR = REPO_ROOT / "tests" / "fixtures" / "v2" / "planner"
RESULTS_PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO_ROOT / "benchmarks" / "results" / "v3-planner.json"
VENV_PYTHON = SERVER_DIR / ".venv" / "Scripts" / "python.exe"
LOG_DIR = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(tempfile.gettempdir()) / "dhristi-v3-planner-bench"
LOG_DIR.mkdir(parents=True, exist_ok=True)

PORT = 8012
BASE_URL = f"http://127.0.0.1:{PORT}"

MODELS = ["qwen2.5:1.5b", "qwen2.5:3b", "llama3.1:8b"]  # smallest -> largest, pre-registered order
TRIALS_PER_FIXTURE = 3
CPU_LOAD_THRESHOLD = 30
CPU_WAIT_MAX_S = 240
CPU_POLL_INTERVAL_S = 5
REQUEST_TIMEOUT_S = 180.0
SERVER_READY_TIMEOUT_S = 30.0


def _load_fixtures() -> list[dict[str, Any]]:
    fixtures = []
    for path in sorted(FIXTURES_DIR.glob("scenario-*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        fixtures.append({"name": path.stem, "data": data})
    return fixtures


_FIXTURE_ONLY_KEYS = (
    "expected", "_fixture_notes", "rawGoal", "tokenLabels", "pureRegexNerTokenization",
)


def _request_body(fixture_data: dict[str, Any], goal_mode: str = "tokenized") -> dict[str, Any]:
    """Strip fixture-only keys (never valid AnalyzeRequestV2 fields —
    extra="forbid" would 422 on them). goal_mode="raw" swaps in the
    fixture's rawGoal (the true, un-tokenized C5-noncompliant goal) in
    place of taskGoal — retry 2 (CLAUDE.md §7): "Score retry 2 against
    the ORIGINAL raw-goal fixtures as well... so nobody can say we moved
    the goalposts." A raw goal containing regex-detectable PII (e.g.
    scenario 3's real email) is EXPECTED to be rejected by the server's
    own C5 leak re-check before ever reaching the model — that rejection
    is itself part of what this comparison is meant to demonstrate, not
    a bug in the harness."""
    body = {k: v for k, v in fixture_data.items() if k not in _FIXTURE_ONLY_KEYS}
    if goal_mode == "raw":
        body["taskGoal"] = fixture_data["rawGoal"]
    return body


def _get_cpu_load() -> float | None:
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average"],
            capture_output=True, text=True, timeout=15,
        )
        return float(out.stdout.strip())
    except Exception:
        return None


def wait_for_low_cpu() -> float | None:
    deadline = time.time() + CPU_WAIT_MAX_S
    last = None
    while time.time() < deadline:
        last = _get_cpu_load()
        if last is None:
            return None  # can't measure -- don't block the benchmark on a measurement failure
        if last < CPU_LOAD_THRESHOLD:
            return last
        print(f"  [cpu] load {last:.0f}% >= {CPU_LOAD_THRESHOLD}%, waiting {CPU_POLL_INTERVAL_S}s...", flush=True)
        time.sleep(CPU_POLL_INTERVAL_S)
    return last  # timed out -- proceed anyway, but record the (high) load honestly


def _matches_predicate(action: dict[str, Any], predicate: dict[str, Any]) -> bool:
    if action.get("action") != predicate["action"]:
        return False
    if action.get("targetId") != predicate["targetId"]:
        return False
    value = action.get("value")
    if "valueContains" in predicate:
        if not isinstance(value, str) or predicate["valueContains"].lower() not in value.lower():
            return False
    if "valueEquals" in predicate:
        if value != predicate["valueEquals"]:
            return False
    if "valuePattern" in predicate:
        if not isinstance(value, str) or not re.fullmatch(predicate["valuePattern"], value):
            return False
    if predicate.get("valueIsNull") and value is not None:
        return False
    if "profileField" in predicate:
        if action.get("profileField") != predicate["profileField"]:
            return False
    return True


def score_action(action: dict[str, Any], expected: dict[str, Any], goal_mode: str = "tokenized") -> bool:
    key = "accept" if goal_mode == "tokenized" else "acceptRawGoal"
    return any(_matches_predicate(action, p) for p in expected[key])


def start_server(model: str, metrics_log: Path) -> subprocess.Popen:
    env = os.environ.copy()
    env["VLM_BACKEND_V2"] = "ollama"
    env["OLLAMA_TEXT_MODEL"] = model
    env["OLLAMA_VL_MODEL"] = "qwen2.5vl:3b"
    env["OLLAMA_TEMPERATURE"] = "0"
    env["OLLAMA_KEEP_ALIVE"] = "10m"
    env["OLLAMA_METRICS_LOG_V2"] = str(metrics_log)
    # Keep v1 defaults untouched -- do not set VLM_BACKEND here.
    log_path = LOG_DIR / f"uvicorn-v3-{model.replace(':', '_')}.log"
    log_file = open(log_path, "w", encoding="utf-8")
    proc = subprocess.Popen(
        [str(VENV_PYTHON), "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(PORT)],
        cwd=str(SERVER_DIR), env=env, stdout=log_file, stderr=subprocess.STDOUT,
    )
    proc._log_file = log_file  # type: ignore[attr-defined]
    return proc


def wait_for_server_ready() -> bool:
    deadline = time.time() + SERVER_READY_TIMEOUT_S
    while time.time() < deadline:
        try:
            r = httpx.get(f"{BASE_URL}/openapi.json", timeout=2.0)
            if r.status_code == 200:
                return True
        except Exception:
            pass
        time.sleep(0.5)
    return False


def stop_server(proc: subprocess.Popen) -> None:
    try:
        proc.terminate()
        proc.wait(timeout=15)
    except Exception:
        try:
            proc.kill()
            proc.wait(timeout=10)
        except Exception:
            pass
    finally:
        log_file = getattr(proc, "_log_file", None)
        if log_file:
            log_file.close()


def _percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    k = (len(s) - 1) * pct
    f = int(k)
    c = min(f + 1, len(s) - 1)
    if f == c:
        return s[f]
    return s[f] + (s[c] - s[f]) * (k - f)


GOAL_MODES = ("tokenized", "raw")


def run_model(model: str, fixtures: list[dict[str, Any]]) -> dict[str, Any]:
    """Runs BOTH goal modes (tokenized, C5-compliant; raw, the true
    un-tokenized goal) against ONE server session per model — the
    OLLAMA_TEXT_MODEL env var is fixed at server startup, but taskGoal
    varies per request, so both modes share one cold-load cost. Retry 2
    (CLAUDE.md §7): "Score retry 2 against the ORIGINAL raw-goal fixtures
    as well, and report both.\""""
    print(f"\n=== {model} ===", flush=True)
    cpu_load = wait_for_low_cpu()
    print(f"  cpu load at measurement start: {cpu_load}", flush=True)

    metrics_log = LOG_DIR / f"ollama-metrics-{model.replace(':', '_')}.jsonl"
    if metrics_log.exists():
        metrics_log.unlink()

    proc = start_server(model, metrics_log)
    trials: list[dict[str, Any]] = []
    warmup_latency_s: float | None = None
    try:
        if not wait_for_server_ready():
            raise RuntimeError(f"server did not become ready for model {model!r} within {SERVER_READY_TIMEOUT_S}s")

        # One throwaway warm-up call (matches this project's established
        # pre-warm pattern for inference elsewhere — ARCHITECTURE.md /
        # CLAUDE.md Phase 1/4 RESULTs): Ollama pays a one-time model-load
        # cost on the FIRST call after the server starts. Excluding that
        # from the timed trials keeps s/step p50/p95 a measure of
        # steady-state inference speed, not a one-off load cost. NOT
        # scored, NOT counted in the 30 trials.
        warm_body = _request_body(fixtures[0]["data"])
        t_warm = time.perf_counter()
        try:
            httpx.post(f"{BASE_URL}/v2/analyze", json=warm_body, timeout=REQUEST_TIMEOUT_S)
        except Exception as exc:  # noqa: BLE001
            print(f"  [warmup] call failed (non-fatal, continuing): {exc}", flush=True)
        warmup_latency_s = time.perf_counter() - t_warm
        print(f"  [warmup] {warmup_latency_s:.2f}s", flush=True)

        for goal_mode in GOAL_MODES:
            for fixture in fixtures:
                body = _request_body(fixture["data"], goal_mode=goal_mode)
                expected = fixture["data"]["expected"]
                for trial_idx in range(TRIALS_PER_FIXTURE):
                    t0 = time.perf_counter()
                    ok = False
                    action_out: dict[str, Any] | None = None
                    error: str | None = None
                    try:
                        resp = httpx.post(f"{BASE_URL}/v2/analyze", json=body, timeout=REQUEST_TIMEOUT_S)
                        latency_s = time.perf_counter() - t0
                        if resp.status_code == 200:
                            action_out = resp.json()
                            ok = score_action(action_out, expected, goal_mode=goal_mode)
                        else:
                            error = f"HTTP {resp.status_code}: {resp.text[:300]}"
                    except Exception as exc:  # noqa: BLE001
                        latency_s = time.perf_counter() - t0
                        error = f"{type(exc).__name__}: {exc}"

                    print(
                        f"  [{goal_mode}] {fixture['name']} trial {trial_idx+1}/{TRIALS_PER_FIXTURE}: "
                        f"{'OK' if ok else 'FAIL'} ({latency_s:.2f}s) "
                        f"{action_out if action_out else error}",
                        flush=True,
                    )
                    trials.append({
                        "goal_mode": goal_mode,
                        "fixture": fixture["name"],
                        "trial": trial_idx + 1,
                        "ok": ok,
                        "latency_s": latency_s,
                        "action": action_out,
                        "error": error,
                    })
    finally:
        stop_server(proc)
        time.sleep(1.0)  # let the port free up before the next model starts

    latencies = [t["latency_s"] for t in trials]
    prompt_tokens: list[int] = []
    if metrics_log.exists():
        for line in metrics_log.read_text(encoding="utf-8").splitlines():
            try:
                rec = json.loads(line)
                if rec.get("prompt_eval_count") is not None:
                    prompt_tokens.append(rec["prompt_eval_count"])
            except json.JSONDecodeError:
                pass

    by_mode = {}
    for goal_mode in GOAL_MODES:
        mode_trials = [t for t in trials if t["goal_mode"] == goal_mode]
        mode_latencies = [t["latency_s"] for t in mode_trials]
        by_mode[goal_mode] = {
            "score": sum(1 for t in mode_trials if t["ok"]),
            "total": len(mode_trials),
            "s_step_p50": round(_percentile(mode_latencies, 0.50), 3),
            "s_step_p95": round(_percentile(mode_latencies, 0.95), 3),
        }

    score = by_mode["tokenized"]["score"]
    total = by_mode["tokenized"]["total"]
    return {
        "model": model,
        "score": score,  # gate/selection is based on the TOKENIZED (C5-compliant) run only
        "total": total,
        "by_goal_mode": by_mode,
        "s_step_p50": round(_percentile(latencies, 0.50), 3),  # combined, both modes
        "s_step_p95": round(_percentile(latencies, 0.95), 3),
        "prompt_tokens_mean": round(sum(prompt_tokens) / len(prompt_tokens), 1) if prompt_tokens else None,
        "prompt_tokens_samples": prompt_tokens,
        "cpu_load_percent_at_measurement": cpu_load,
        "warmup_latency_s": round(warmup_latency_s, 2) if warmup_latency_s is not None else None,
        "trials": trials,
    }


def main() -> None:
    fixtures = _load_fixtures()
    if len(fixtures) != 5:
        print(f"WARNING: expected 5 planner fixtures, found {len(fixtures)}", file=sys.stderr)

    results = []
    for model in MODELS:
        results.append(run_model(model, fixtures))

    # DEFAULT selection: smallest model scoring 15/15 (pre-registered rule).
    full_scorers = [r for r in results if r["score"] == r["total"] == 5 * TRIALS_PER_FIXTURE]
    gate_passed = len(full_scorers) > 0
    if gate_passed:
        chosen = full_scorers[0]  # MODELS is already smallest-first
    else:
        chosen = max(results, key=lambda r: r["score"])

    output = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "fixtures": [f["name"] for f in fixtures],
        "trials_per_fixture": TRIALS_PER_FIXTURE,
        "temperature": 0.0,
        "models": results,
        "gate_passed": gate_passed,
        "chosen_default_model": chosen["model"],
        "chosen_default_score": f"{chosen['score']}/{chosen['total']}",
    }

    RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    RESULTS_PATH.write_text(json.dumps(output, indent=2), encoding="utf-8")

    print("\n=== SELECTION TABLE (tokenized/C5-compliant goals — this is what the gate uses) ===")
    for r in results:
        print(f"  {r['model']:16s} score={r['score']}/{r['total']}  p50={r['s_step_p50']}s  p95={r['s_step_p95']}s  "
              f"prompt_tokens_mean={r['prompt_tokens_mean']}  cpu={r['cpu_load_percent_at_measurement']}")
    print("\n=== RAW-GOAL COMPARISON TABLE (un-tokenized goals — reported, not gated on) ===")
    for r in results:
        raw = r["by_goal_mode"]["raw"]
        print(f"  {r['model']:16s} score={raw['score']}/{raw['total']}  p50={raw['s_step_p50']}s  p95={raw['s_step_p95']}s")
    print(f"\nGATE PASSED: {gate_passed}")
    print(f"CHOSEN DEFAULT: {chosen['model']} ({chosen['score']}/{chosen['total']})")
    print(f"\nWrote {RESULTS_PATH}")


if __name__ == "__main__":
    main()
