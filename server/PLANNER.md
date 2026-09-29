# V3 — planner-local

> ⚠️ **SUPERSEDED — 2026-09-27.** Everything below this line documents **run 1** only
> (GATE FAILED, `qwen2.5:1.5b` set as a flagged non-passing default). Two retries
> followed and changed the prompt/schema (`fill_profile` dropped from the model-facing
> action set, per-request JSON-Schema `targetId` enum, C5-tokenized goals) — **retry 2
> (final) PASSED: `llama3.1:8b` 15/15**, `qwen2.5:3b` 9/15, `qwen2.5:1.5b` 3/15. See
> `docs/v2/ARCHITECTURE.md`'s "V3 planner-local (retry 2, final)" row and
> `benchmarks/results/v3-planner-retry2.json` (`chosen_default_model: "llama3.1:8b"`).
> `DEFAULT_OLLAMA_TEXT_MODEL_V2` in `server/vlm_client.py` was left at run 1's
> `qwen2.5:1.5b` through both retries — a live run via `start-demo.ps1 -Planner local`
> (which never sets `OLLAMA_TEXT_MODEL`) silently used the worst-scoring model instead
> of the one the gate actually passed on. Fixed 2026-09-27 (see the constant's own
> docstring for the full account); this file's run-1 numbers below are left as the
> historical record, not corrected in place.

Local, on-device planning for `POST /v2/analyze` (docs/v2/ARCHITECTURE.md contract C5).
Machine: i5-1334U, 16.8 GB RAM, **no GPU — CPU inference only**. Ollama 0.34.0 on
`127.0.0.1:11434`.

## Default backend selection

`VLM_BACKEND_V2` defaults to `ollama` (separate from v1's `VLM_BACKEND`, which stays
`mock` — see `server/README.md`'s "v2 VLM backend" section and
`docs/v2/ARCHITECTURE.md`'s V3 phase entry). Which Ollama **text** model
(`OLLAMA_TEXT_MODEL`, used for semantic-mode requests) is the default was decided by a
**pre-registered benchmark**, not by recollection or vibes — the scoring rule and the 5
scene fixtures were fixed *before* any model was run, and were not adjusted afterward.

### Method

- Fixtures: `tests/fixtures/v2/planner/scenario-{1..5}.json` — hand-built C5
  (`dhristi-scene-v2`) requests mirroring `demo/test-page.html` (scenario 4 mirrors
  `?scenario=checkout`), with realistic `agentId`s and an `expected.accept` list of
  acceptable step-1 planner actions per fixture, written down with the judgment behind
  each acceptance rule (see each fixture's own `_fixture_notes` field).
- Candidates: `qwen2.5:1.5b`, `qwen2.5:3b`, `llama3.1:8b` — the three models already
  installed on this machine. No text-model was downloaded (binding user decision).
- Each candidate: 5 fixtures × 3 trials, **temperature 0**, through the real
  `POST /v2/analyze` path (`uvicorn` on `127.0.0.1:8012`, `VLM_BACKEND_V2=ollama`,
  `OLLAMA_TEXT_MODEL=<candidate>`), one throwaway warm-up call excluded from timing.
- Score for one trial = HTTP 200 (schema-valid `ActionResponseV2`) **and** the returned
  `(action, targetId, value, profileField)` matches at least one predicate in that
  fixture's `expected.accept` list.
- **Decision rule (pre-registered):** DEFAULT = the smallest model scoring 15/15. If no
  model scores 15/15, choose the highest scorer, report the gate as FAILED, and flag it.
  ("Smallest" = the pre-registered candidate order `qwen2.5:1.5b` < `qwen2.5:3b` <
  `llama3.1:8b`.)
- CPU load measured via `Get-CimInstance Win32_Processor` immediately before each
  model's run; the benchmark waits (up to 240 s, polling every 5 s) for load < 30% before
  measuring, and records whatever load was actually observed.

Script: `benchmarks/bench_v3_planner.py`. Raw evidence (all 45 trials, raw actions,
per-model CPU load, prompt-token counts from Ollama's own `prompt_eval_count`):
`benchmarks/results/v3-planner.json`.

### Results — 🔴 GATE FAILED

| Model | Score | s/step p50 | s/step p95 | prompt tokens (mean) | CPU load at measurement | Warm-up (cold load) |
|---|---|---|---|---|---|---|
| `qwen2.5:1.5b` | **4/15** | 8.94 s | 26.17 s | 683.5 | 18% | 11.7 s |
| `qwen2.5:3b` | **0/15** | 10.49 s | 44.67 s | 683.5 | 26% | 59.1 s |
| `llama3.1:8b` | **3/15** | 22.55 s | 111.32 s | 635.2 | 21% | 123.4 s |

**No installed model scored 15/15.** Per the pre-registered rule ("if none scores 15/15,
choose the highest scorer, report the gate as FAILED, and flag it"): **DEFAULT =
`qwen2.5:1.5b`** (highest scorer, 4/15) — set as `DEFAULT_OLLAMA_TEXT_MODEL_V2` in
`server/vlm_client.py`, itself overridable via `OLLAMA_TEXT_MODEL`. **This is a flagged
default, not a passing one.** Full raw evidence (all 45 trials + raw actions):
`benchmarks/results/v3-planner.json`.

**What actually went wrong, per scenario** (real, observed failure modes — not
speculation):

- **Scenario 1 (fill the name) / Scenario 3 (name + email token echo):** `qwen2.5:1.5b`
  and `qwen2.5:3b` both defaulted to `fill_profile` with a hallucinated, non-null
  `value` — tripping `FILL_PROFILE_VALUE_SUPPLIED` — instead of a plain `type` with the
  literal/token value, even though the ELEMENTS listing gave no profile-vault cue.
  `llama3.1:8b` got the target AND the value exactly right every time (including
  echoing `PERSONNAME#1` verbatim, unprompted) but consistently chose `action="click"`
  instead of `"type"` — a systematic action-verb bias, not a comprehension failure. This
  is scored a fail under the pre-registered strict-action-match rule, correctly, but is
  the closest of the three to "almost right."
- **Scenario 2 (password, expects `type` on `agent-1`):** `qwen2.5:1.5b` supplied a
  `press_key`-shaped `key` on a non-`press_key` action (cross-field schema violation,
  502) or the same `fill_profile` mistake. `qwen2.5:3b` hallucinated the literal string
  `"agentId=agent-1"` as `targetId` (echoing the concise prompt's own `agentId=` label
  prefix back as part of the value) → `UNKNOWN_TARGET`. `llama3.1:8b` got target+value
  right (`agent-1`, `hunter2`) but again used `click`, not `type`.
- **Scenario 4 (checkout click) — the one every model got right, every time.** All 15/15
  trials across all three models scored 3/3 on this fixture — the simplest case
  (unambiguous single destructive button, plain `click`) is where these models agree.
- **Scenario 5 (profile autofill, no explicit value given):** `qwen2.5:1.5b` scored
  1/3 (occasionally correct `fill_profile`); `qwen2.5:3b` targeted the wrong field
  (`agent-3`, the Aadhaar-shaped ID field) all 3 times; `llama3.1:8b` used `click` again,
  and once hallucinated a `PERSONNAME#1`-shaped token value that was never introduced
  anywhere in this prompt — a genuine (if schema-valid) invention, worth flagging even
  though it didn't leak real PII.

**Cross-cutting observation:** `llama3.1:8b` demonstrates the best actual task
comprehension of the three (correct targets, correct token verbatim-echo, correct
values) but has a near-total bias toward `action="click"` over `"type"` in this prompt
format, which the strict pre-registered scoring correctly penalizes. That bias — not
comprehension — is what kept it from a higher score, and is the most promising lead for
anyone tuning `build_prompt_v2_concise()` further (e.g. making the type-vs-click
distinction more explicit, or relaxing KEYBOARD/PROFILE section ordering). Not acted on
here — the scoring rule was pre-registered and the fixtures/rubric were not touched
after seeing these numbers.

**Non-determinism at temperature 0, noted not investigated:** `llama3.1:8b`'s scenario-5
trial 1 and trials 2–3 produced different `value`s (`'PERSONNAME#1'` vs `None`) for the
byte-identical request. Ollama's CPU backend is not guaranteed bit-reproducible across
calls even at `temperature=0` (thread-count/scheduling-dependent floating-point
summation order); this was observed once, not characterized further.

### Caveats

- CPU was contended during measurement by other concurrent agents on this machine
  (V1b `ner-service` benchmarking runs in parallel per this session's brief) — the
  recorded `cpu_load_percent_at_measurement` values reflect that contention honestly
  rather than being fabricated as clean.
- Scoring is intentionally generous on `value` content for scenarios 2 and 5 (see each
  fixture's `_fixture_notes`): the planner's job at this layer is to *propose* the right
  action on the right target; downstream policy-engine (C4, extension-side) and the
  server's own `compute_server_verdict()` are what actually block/reject an unsafe or
  malformed value. A model proposing `type` into a sensitive field is scored correct
  here even though the real extension will refuse to execute it.
- 15 trials per model is a small sample for a p95 latency figure — enough to see the
  gate result and a rough speed profile, not enough for a tight confidence interval.

## Ollama client tightening (v2 only — v1's OllamaVLMClient.analyze() is untouched)

`OllamaVLMClient.analyze_v2` (`server/vlm_client.py`):

1. **`format`** is `MODEL_ACTION_V2_JSON_SCHEMA` (full JSON Schema for `ModelActionV2`,
   confirmed live against this machine's Ollama 0.34.0 + `qwen2.5:1.5b` — see the smoke
   curl in this pass's evidence). Falls back to bare `"json"` mode only on a 400/422
   (a format-incompatibility signal), never on any other failure.
2. **`num_ctx`** sized to the actual prompt via `_estimate_ollama_num_ctx()` (~4
   chars/token estimate, rounded up to Ollama's usual power-of-two-ish context sizes).
3. **`keep_alive`** (default `10m`, `OLLAMA_KEEP_ALIVE`) so the model stays warm between
   loop steps — cold load measured at ~47 s vs ~8 s warm for `qwen2.5:1.5b` on this
   machine (see the smoke test in this pass's evidence).
4. **Concise prompt** — `build_prompt_v2_concise()`, used only by this backend, built
   directly from `VLMRequestContextV2`'s structured fields rather than the verbose
   `context.prompt` every other backend receives. Every privacy rule
   `build_prompt_v2()` states is still stated explicitly (token verbatim-echo, never
   guess a redacted region, `fill_profile`'s value-must-be-null shape, `press_key`'s
   key-only-for-press_key shape) — the wording is shorter, the rules are not.
   `build_prompt_v2()` itself (used by main.py for every backend uniformly) is
   untouched, so this touches no other backend's behaviour or tests.
5. **`temperature`** defaults to `0` (`OLLAMA_TEMPERATURE`) — a deterministic default
   for an action-selection loop, not just a benchmarking convenience.

## Image mode — `qwen2.5vl:3b`

Pulled via `ollama pull qwen2.5vl:3b` (~3.2 GB, background, logged to
`scratch_logs/ollama-pull-qwen2.5vl3b.log`) — the one download this pass was allowed.
`OLLAMA_VL_MODEL` defaults to `qwen2.5vl:3b` (was `qwen2.5vl:7b` before this pass, which
was never actually pulled). Image-mode and semantic-mode requests share ONE
`OllamaVLMClient` / one running server process — `analyze_v2` picks the model by
`context.mode`, so no separate server instance is needed to exercise both.

### Results

- **`valid_image.json` smoke run** (`OLLAMA_VL_MODEL=qwen2.5vl:3b`, `OLLAMA_TEXT_MODEL`
  = the chosen default `qwen2.5:1.5b`): cold call **timed out** at the client's
  120 s inner `OllamaVLMClient` timeout (`httpx.ReadTimeout` → clean `502
  VLM_BACKEND_CALL_FAILED`, no crash, no hang) — `qwen2.5vl:3b`'s cold load on this
  CPU-only machine exceeds 120 s. **Warm re-run: 200 OK in 35.0 s**, correctly clicked
  the fixture's sole element (`agent-1`, the submit button), `serverVerdict: accept`.
- **`need_visual` escalation — attempted live, did not reproduce with either model
  tried.** Built a genuinely ambiguous semantic-mode fixture (two structurally
  identical `submit` buttons distinguished only by a visual cue — "the button with a
  red background" — that ELEMENTS/REGIONS alone cannot resolve;
  `scratch_logs/escalation-semantic.json`). Neither `qwen2.5:1.5b` (502 schema
  violation) nor `llama3.1:8b` (guessed `click` on `agent-2` in 82.7 s, never asked for
  the image) chose `action="need_visual"` — both guessed rather than escalating. **This
  is a real, honest negative result, not a mechanism failure**: the `need_visual`
  contract itself is proven independently at two points — (1) `ModelActionV2` structurally
  accepts a well-formed `need_visual` response
  (`test_model_action_need_visual_valid`, `tests/unit/test_v2_schemas.py`), and (2) the
  image-mode leg of the escalation (re-sending the same revision with `mode="image"`
  and a real `image` payload) is exactly what the `valid_image.json` smoke run above
  exercised successfully end-to-end against a real model. What was **not** observed
  live is a real small model actually choosing to escalate rather than guess — worth
  flagging for anyone extending this: on this prompt, at this model size, `need_visual`
  may be effectively unreachable in practice even though it is fully wired and schema-valid.
- **s/step, image mode (warm):** 35.0 s (`qwen2.5vl:3b`) — one sample. Consistent with
  the text-model latencies at this CPU-only scale; not enough samples for a p50/p95.

## Claude / Gemini `analyze_v2` — explicit opt-in

Both backends now implement `analyze_v2` (previously `NotImplementedError` →
`VLM_BACKEND_V2_NOT_IMPLEMENTED`), reusing their v1 credential resolution and
error-mapping code verbatim (`ClaudeCredentialsMissing`/`GeminiCredentialsMissing`,
the same `NotFound`/`RateLimit`/`API`/`Connection` error hierarchy). Selected via
`VLM_BACKEND_V2=claude` / `VLM_BACKEND_V2=gemini` — never the default, never reached
unless explicitly selected. With no API key configured, both fail with their existing
credentials-missing error (never a silent fallback to mock or to each other) — this is
exercised by `test_v2_analyze_unwired_backend_returns_clean_502` in
`tests/unit/test_v2_analyze.py`, plus dedicated unit tests in
`tests/unit/test_claude_vlm_client.py` / `tests/unit/test_gemini_vlm_client.py` (all
via injected fakes — no live API call, matching every existing test in those files).

**Invariant 4 ("no silent cloud fallback")** is covered by two tests: a unit test in
`tests/unit/test_ollama_v2_tightening.py`
(`test_ollama_v2_connection_error_propagates_and_never_calls_cloud`) and an
integration test in `tests/unit/test_v2_analyze.py`
(`test_v2_analyze_ollama_down_returns_clean_502_never_falls_back_to_cloud`) — both
point `OllamaVLMClient` at a closed port, spy on `ClaudeVLMClient.analyze_v2` /
`GeminiVLMClient.analyze_v2`, and assert neither is ever called while the real
`/v2/analyze` endpoint still returns a clean `502 VLM_BACKEND_CALL_FAILED`.

## Env defaults set by this pass

| Var | Default | Notes |
|---|---|---|
| `VLM_BACKEND_V2` | `ollama` | New, v2-only, separate from v1's `VLM_BACKEND` (still `mock`, untouched). |
| `OLLAMA_TEXT_MODEL` | see selection table above | Read fresh per-call (matches the existing `OLLAMA_VL_MODEL` pattern), so it's also overridable per-process without a code change. |
| `OLLAMA_VL_MODEL` | `qwen2.5vl:3b` | Was `qwen2.5vl:7b` (never pulled) before this pass. |
| `OLLAMA_TEMPERATURE` | `0` | v2 Ollama calls only. |
| `OLLAMA_KEEP_ALIVE` | `10m` | v2 Ollama calls only. |

v1's `/analyze` defaults (`VLM_BACKEND=mock`) are **unchanged** — the demo still runs
v1 until V4.

## Tests

- `tests/unit/test_ollama_v2_tightening.py` (16 tests, network stubbed) — concise
  prompt content/length, `num_ctx` sizing, request shape (format/temperature/keep_alive/
  model selection), schema→`"json"` fallback behaviour, the invariant-4 connection-error
  test, and opt-in metrics logging.
- `tests/unit/test_vlm_client.py` — 7 new `get_vlm_client_v2()` factory tests (default
  `ollama`, explicit selection of every backend, unknown-backend rejection, and
  independence from `VLM_BACKEND`).
- `tests/unit/test_claude_vlm_client.py` / `tests/unit/test_gemini_vlm_client.py` — v2
  `analyze_v2` request-shape, credentials-missing, and error-mapping tests (8 + 8),
  mirroring each file's existing v1 test style exactly.
- `tests/unit/test_v2_analyze.py` — dependency-override key updated to
  `main.get_vlm_client_v2`; 2 new tests (Claude opt-in now reaches a real credentials
  check instead of the old "not implemented" 502; the invariant-4 integration test).
- `tests/conftest.py` — new autouse fixture forcing `VLM_BACKEND_V2=mock` for every
  test, so the full suite stays hermetic despite the new `ollama` production default.
