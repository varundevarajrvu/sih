# Dhristi v2 — Rebuild Architecture

**Branch:** `rebuild/v2` (cut from `fix/profile-vault-name-leak` @ 2026-09-23).
**Status:** 2026-09-29 — V0–V4 done (mock planner, 10/10 scenarios, 0 leaks); V5: a11y, EN/HI, fresh-clone setup done, Firefox built not run. Open: live local-planner rerun with the C4 completion rule, stop-demo PID fix, load soak, NER missed-name fix, site refresh.
**Baseline at branch cut:** 749 tests green — 529 JS (`node --test tests/unit/*.mjs`) + 220 pytest
(`server\.venv\Scripts\python.exe -m pytest tests -q`).
**Read this whole file before writing any v2 code.** It overrides the v1 Section 4/5 contracts in
`CLAUDE.md` wherever the two disagree. The v1 orchestration protocol (CLAUDE.md §1, §3, §6, §7) still
applies unchanged.

## Why v2

v2 merges this repo (v1, "Project A") with the strongest parts of `francisreubenr-rvu/sih-2026`
("Project B": its `Prototype/` and `warden/` tracks). Comparison: the session of 2026-09-23.

**Keep from v1 (the base — the only end-to-end loop proven on real sites):** single MV3 extension +
offscreen inference, DOM scanner incl. iframes + shadow DOM + defensive whole-frame redaction, Set-of-Mark
`data-agent-id` grounding + element ranker, canvas redaction, byte-level egress assertion before every
send/retry, server-side independent leak re-check (`400 PII_LEAK_DETECTED`, never echoes the value),
irreversible-action detection, stale-capture detector, stall detector, pluggable backends, observe-only mode,
the 749-test suite.

**Take from Project B:**
1. Two-layer PII detection: deterministic regex (+ Luhn, Aadhaar keyword heuristics) **and** GLiNER NER
   (`urchade/gliner_multi_pii-v1`) for names, addresses, DOB, account numbers — both over RAW text, spans merged,
   regex wins on overlap. (Warden `redactor.py`/`entities.py`; lesson: tokenizing before NER *lowers* NER recall.)
2. Tokenization + local rehydration: the planner sees `EMAIL#1`, `PERSONNAME#2`; the extension substitutes the
   real value only at the moment of typing. Subsumes v1 `fill_profile`.
3. Confidence bands: `score ≥ 0.60` strip silently; `floor ≤ score < 0.60` ask the user; below floor ignore.
   Per-label floors (person name 0.12, others 0.35) — a missed name is a breach, a spurious prompt is a click.
4. Operation tiers `reversible | navigational | state-changing | destructive` + intent-coherence check,
   deterministic first; an optional local reasoning model may only **downgrade** `accept → ask`, never upgrade a
   reject. The extension recomputes the tier itself — the server verdict is necessary, never sufficient.
5. Semantic-first egress: default request carries **no pixels** — only tokenized structure + geometry + opaque
   region kinds. The redacted image is an escalation, not the default.
6. Revision-bound captures: every scene has a `revision` UUID; an action for a stale revision, or a DOM that
   changed since capture, is refused and re-captured.
7. A dedicated face detector (UltraFace RFB-320, ~1 MB ONNX) — replaces or supplements yolos-tiny per spike V0b.
8. Local planner by default; cloud backends are explicit opt-in; **no silent fallback to cloud** ever.
9. Evidence discipline: every claimed number links a JSON result file under `benchmarks/results/`;
   accessibility (axe), EN/HI strings, Firefox build, 5-minute load soak.

**Leave behind:** Project B's 11-label / 3-task closed vocabulary, the external OmniParser server, gate-ID jargon;
v1's COCO-80 detector as the primary face path and cloud-by-default planning.

---

## Phase map

```
V0a gliner-spike        (no deps)  ─┐ parallel. Decisions, not features.
V0b ultraface-spike     (no deps)  ─┘
V1a pii-tokenizer       (no deps; pure JS)                       ─┐
V1b ner-service         (needs V0a decision)                     ─┤
V1c policy-engine       (no deps; pure JS)                       ─┤ parallel
V1d server-v2           (needs contracts below only)             ─┘
V2  vision-v2           (needs V0b decision)
V3  planner-local       (needs V1d)
V4  integration-v2      (needs V1a–d + V2 + V3, ALL validated)
V5  hardening           (needs V4): a11y, EN/HI, Firefox, load soak, evidence files, site refresh
```

## Phase V0 — spikes (answer questions, ship nothing)

### V0a `gliner-spike`
**Question:** where does GLiNER run — in the extension (ONNX via onnxruntime-web in the offscreen doc) or in a
loopback-only local process?
Measure **both** on this machine (Windows 11, Chrome), same 10 fixture texts (`spikes/gliner/fixtures.json`,
include: imperative "Log in as Francis Reuben R", declarative "Hi, I am Priya Sharma", an Indian postal address,
a DOB, an account number, two PII-free control sentences, one 2 KB page-text blob).
Report per path: model size on disk, cold load time, warm p50/p95 per call (single sentence and 2 KB blob),
peak memory, per-fixture spans with scores.
**Decision rule (pre-registered, do not move it after seeing numbers):** choose **in-browser** iff warm p95 on
the 2 KB blob ≤ 400 ms AND cold load ≤ 15 s AND bundle ≤ 250 MB AND name recall on the fixtures matches Python
within one miss. Otherwise choose **local process**.
**Output:** `spikes/gliner/RESULT.md` + `benchmarks/results/v0a-gliner.json`.

### V0b `ultraface-spike`
**Question:** does UltraFace RFB-320 via onnxruntime-web in the offscreen doc beat yolos-tiny for PII faces?
Measure on: the demo ID-card face (`site/assets/id-card-face.jpg`), a face-scale ladder (same face at
40/60/80/96/120/200 px on a 1280×720 canvas), and 3 no-face screenshots (false positives).
Report: warm p50/p95, cold load, recall per scale, false positives, vs yolos-tiny on the same inputs
(current published yolos warm: ~2,350–2,700 ms).
**Decision rule:** replace yolos-tiny iff UltraFace detects the demo face and ≥ 80 px faces, and warm p95 is
lower. Keep yolos available only if it catches something UltraFace cannot that is PII-relevant.
**Output:** `spikes/ultraface/RESULT.md` + `benchmarks/results/v0b-ultraface.json`.

## Contracts (V1+)

### C1 — PII span (common currency between regex and NER)
```ts
type PiiSpan = { start: number; end: number;           // offsets into the RAW text
                 label: PiiLabel; score: number;       // regex hits: score 1.0
                 source: "regex" | "ner" | "vault" }
type PiiLabel = "EMAIL" | "PHONE" | "AADHAAR" | "PAN" | "CARD" | "UPI" | "IFSC" | "GSTIN" | "PASSPORT"
              | "PERSONNAME" | "ADDRESS" | "DOB" | "ACCOUNTNUMBER" | "PASSWORD" | "OTHER"
```
Labels are uppercase alphanumerics only — they become token prefixes.

### C2 — `pii-tokenizer` (V1a, `extension/lib/pii-tokenizer.js`, pure)
```ts
mergeSpans(regexSpans, nerSpans) -> PiiSpan[]          // regex wins overlaps; no partial overlaps survive
classifyBand(span) -> "strip" | "ask" | "ignore"       // thresholds from §"Take from B" item 3
tokenize(text, spans, tokenMap) -> { text: string, tokenMap: TokenMap, asked: PiiSpan[] }
rehydrate(value, tokenMap) -> string                   // throws on an unknown token; never types a raw token
```
- Token grammar: `/[A-Z][A-Z0-9]*#[0-9]+/`. No underscores (Project B's F-finding: `PERSON_NAME#1` breaks the
  consumer regex). Same raw value within one run → same token.
- `TokenMap` lives only in the extension's run state. It is never serialized into any request body, log line, or
  storage outside the run. `ask` spans are held (treated as `strip`) until the user answers.
- Profile vault values are pre-seeded into the TokenMap as `PROFILE…#n` tokens, so `fill_profile` becomes an
  ordinary `type` with a token value. `fill_profile` stays accepted on the wire for back-compat through V4.

### C3 — `ner-service` (V1b)
`detectEntities(texts: string[]) -> PiiSpan[][]` (source `"ner"`).
- If V0a picks **in-browser**: runs in the offscreen doc behind message `{type:"DETECT_ENTITIES", requestId, texts}`
  → `{type:"ENTITIES_RESULT", requestId, spans}`.
- If V0a picks **local process**: a **separate** FastAPI app (`ner/`), bound to `127.0.0.1` only, own port
  `8757`, endpoint `POST /ner`. It never logs request bodies, never forwards anywhere, and shares no process with
  `/analyze` (which may talk to a cloud model). The extension's host permissions allow it explicitly.
- Either way: when NER is unavailable the run **stops** with a clear message. It does not silently degrade to
  regex-only (Project B lesson: a silent downgrade of a privacy guarantee is worse than an honest stop).

### C4 — `policy-engine` (V1c, `extension/lib/policy.js`, pure; supersedes the verdict half of `action-risk.js`)
```ts
classifyTier(element, action) -> "reversible" | "navigational" | "state-changing" | "destructive"
checkIntentCoherence(taskGoalTokenized, element, action) -> { coherent: boolean, reason }
decide({action, element, scene, currentRevision, taskGoal}) -> { verdict: "accept" | "ask" | "reject", code, reason }
```
Deterministic rules, first match wins:
1. `reject STALE_REVISION` — action's `revision` ≠ current revision.
2. `reject UNKNOWN_TARGET` — `targetId` not in the scene.
3. `reject RAW_VALUE_IN_ACTION` — a `type` value contains any raw TokenMap value (model must use tokens).
4. `ask SENSITIVE_TARGET` — target flagged sensitive. (v1 blocked outright; v2 asks. Consent UI denies by default
   after 60 s.)
5. `ask IRREVERSIBLE_ACTION` — tier `destructive` (reuse `action-risk.js` `DESTRUCTIVE_SIGNALS`).
6. `ask INTENT_MISMATCH` — tier `state-changing`/`destructive` and not intent-coherent.
7. otherwise `accept`.
A server-supplied verdict can only make the local verdict stricter (`accept → ask`, anything → `reject`), never
looser. Codes are a closed enum; keep v1 codes `SENSITIVE_TARGET_BLOCKED` / `IRREVERSIBLE_ACTION_BLOCKED` as the
outcome when the user denies or the consent prompt times out.

### C5 — Scene + `/analyze` v2 (V1d, `server/`)
```jsonc
// request
{ "schema": "dhristi-scene-v2",
  "mode": "semantic" | "image",
  "revision": "uuid",
  "taskGoal": "tokenized string",
  "viewport": { "w": 1280, "h": 720 },
  "elements": [ { "agentId": "agent-4", "tag": "input", "role": null, "type": "text",
                  "label": "tokenized, ≤120 chars", "bbox": {x,y,w,h}, "sensitive": false,
                  "tier": "state-changing" } ],
  "regions":  [ { "kind": "face"|"password"|"field"|"text-pii"|"frame"|"media", "bbox": {x,y,w,h},
                  "source": "dom"|"vision" } ],
  "history":  [ { "action": {...}, "outcome": "ok"|"asked-denied"|"rejected:CODE" } ],   // ≤ 10
  "image": "base64 PNG — present iff mode == image, and only the redacted render" }
// response
{ "action": "click"|"type"|"scroll"|"press_key"|"done"|"need_visual"|"fill_profile",
  "targetId": "agent-4" | "page", "value": "may contain tokens" | null,
  "revision": "uuid echoed from the request", "serverVerdict": "accept"|"ask"|"reject", "reason": "…" }
```
- `need_visual`: the planner asks for the image once per step; the extension re-sends the same revision in
  `image` mode. Max one escalation per step.
- Server re-check (defence in depth) extends v1's: reject `400 PII_LEAK_DETECTED` if any string field matches a
  regex-layer PII pattern that is not a token; reject if `image` present in `semantic` mode; never echo values.
- `/analyze` v1 stays mounted, unchanged, until V4 passes (the demo must not break mid-rebuild).

### C6 — egress assertion v2 (extends v1 Section 5 check)
Before every send and every retry, the serialized body must contain **no TokenMap value, no vault value, and no
flagged raw node value**, and must match the mode (no `image` key in semantic mode). Failure throws; the request
never leaves.

## V2 invariants (every module, every phase)
1. **Egress:** only the C5 request leaves the browser for planning. TokenMap, vault, raw text, raw pixels never
   do. The only exception is C3's local-process NER, loopback-only, separate process, never forwarding.
2. **Deterministic beats probabilistic:** no model — planner or reasoning — can override a deterministic reject.
3. **Local recomputes:** the extension recomputes tier + verdict; server verdicts only tighten.
4. **No silent cloud fallback.** A local backend being down is an error, not a reason to call a cloud API.
5. **WASM floor:** every in-browser inference degrades to WASM, never fails for lack of WebGPU.
6. **Pure + fixture-testable:** every PII/policy/redaction/tokenizer module is a pure function tested
   fixture-in → JSON-out with `node --test`, no browser needed.
7. **No regressions by accident:** the existing 749 tests stay green or are retired explicitly with a one-line
   reason in the commit message. Demo scenarios 1–5 (`DEMO-SCRIPT.md`) keep working through V4.
8. **Numbers need files:** a latency/accuracy claim without a `benchmarks/results/*.json` behind it is not made.

## Validation checkpoints (orchestrator verifies personally)
| Phase | Check |
|---|---|
| V0a / V0b | Read RESULT.md + JSON; numbers exist per fixture; decision applied by the pre-registered rule |
| V1a | `node --test` on tokenizer fixtures: overlap merge, same-value-same-token, underscore-free tokens, rehydrate throws on unknown token |
| V1b | 10 V0a fixtures → spans; imperative-name case is ≥ `ask`; controls produce zero spans |
| V1c | fixture table of (action, element, scene) → verdict covering all 7 rules + server-tighten-only |
| V1d | curl semantic + image payloads; leak payload → 400 without echo; image-in-semantic → 400; v1 `/analyze` still passes its tests |
| V2 | demo ID-card face redacted in image mode; latency file written |
| V3 | local planner returns schema-valid actions for scenarios 1–5 on semantic mode; cloud disabled unless flag set |
| V4 | scenarios 1–5 + S6 (name/address typed via tokens, planner never sees raw) + S7 (ask-user approve & deny) in Chrome |
| V5 | axe 0 violations on popup; EN/HI toggle; Firefox loads unpacked; 5-min soak JSON; site numbers updated |

## Decisions log
| Date | Decision | By |
|---|---|---|
| 2026-09-23 | Rebuild on branch `rebuild/v2` in this repo | Varun |
| 2026-09-23 | GLiNER placement decided by V0a spike, rule pre-registered above | Varun |
| 2026-09-23 | Scope: full architecture (V0–V5), not a privacy-core-only milestone | Varun |
| 2026-09-24 | No GPU on dev machine → default semantic planner chosen by benchmarking installed Ollama models (1.5b/3b/llama3.1:8b) on scenarios 1–5; smallest with 15/15 wins | Varun |
| 2026-09-24 | Image mode stays local on `qwen2.5vl:3b` (pulled) | Varun |
| 2026-09-24 | Tiled small-face pass OFF (recovered 0 faces) | orchestrator |
| 2026-09-25 | Product default planner = local `llama3.1:8b`; live demo uses an explicitly selected cloud planner (Claude/Gemini) for speed — payload is already tokenized + redacted, so the cloud never sees PII. Demo script shows both. | Varun |

## Phase results
| Phase | Result | Verified |
|---|---|---|
| V1c policy-engine | ✅ `extension/lib/policy.js`, 77 tests (`tests/unit/test_policy.mjs`, fixtures `tests/fixtures/v2/policy/cases.json`). All 7 rules ≥ 2 cases; Project B's 6 probe plans + v1 benign action-risk fixtures pass. Added closed code `SERVER_TIGHTENED` (server-only tightening of a local accept). Known limit: intent coherence is regex-only (destructive-intent language); a non-destructive, non-sensitive target/task mismatch is undetectable without a reasoning stage — candidate for V3's optional downgrade-only local check. Page sentinel settled as lowercase `"page"` (v1's `PAGE_TARGET_ID`). | 2026-09-24, orchestrator reran tests |
| V1d server-v2 | ✅ `POST /v2/analyze` (`server/schemas_v2.py`, `server/pii_regex_v2.py`, `build_prompt_v2`, `compute_server_verdict`); v1 `/analyze` untouched. 268 pytest (220 + 48). Codes: `MODE_VIOLATION` 400 (image/mode mismatch either way), `PII_LEAK_DETECTED` 400 (no echo), `VLM_BACKEND_V2_NOT_IMPLEMENTED` 502 (Claude/Gemini → V3). `serverVerdict` accept/reject computed server-side only; value nulled on reject. Phone regex upgraded to Project B's 6 variants; PASSPORT added. **Open:** JS (`pii-regex.js`) and Python (`pii_regex_v2.py`) UPI/IFSC/GSTIN patterns were written independently and differ (server UPI uses a PSP-handle allowlist) → a shared parity fixture both suites must pass, before V4. | 2026-09-24, orchestrator: pytest 268 green; live curl on :8011 — valid→200 accept, raw email in taskGoal→400 with 0 echoes, image in semantic→400 MODE_VIOLATION |
| V1a pii-tokenizer | ✅ `extension/lib/pii-regex.js` + `pii-tokenizer.js`, 665 JS total. Labels incl. new UPI/IFSC/GSTIN/PASSPORT; ordering hazards covered (card>phone/aadhaar, GSTIN>PAN, UPI>PHONE, IFSC>PASSPORT); country-code prefix inside PHONE span; TokenMap `toJSON` throws; rehydrate throws on unknown token. Accepted false positive: 8-char IDs like `A1234567` tokenize as PASSPORT. In progress: JS/Python parity fixture. | 2026-09-24, orchestrator independent probe (mixed-PII string → zero raw leftovers; bands 0.24 ask / 0.10 ignore / 0.9 strip) |
| V0b ultraface-spike | ✅ **REPLACE yolos-tiny with UltraFace RFB-320** (pre-registered rule, all 3 legs). UltraFace wasm: demo face 0.99999, ≥80 px 4/4, 40/60 px 0/2, 0 FP on 3 no-face screens, cold 1,064 ms, warm p50/p95 50.5/61.0 ms (i5-1334U, no WebGPU). yolos recall ⊂ UltraFace's (missed 80/120 px). **Finding:** transformers.js's jsep ORT bundle failed to load yolos on both `webgpu` and `wasm` with no GPU adapter (3/3) → v1's "WASM fallback" is unverified at best; UltraFace on plain ORT wasm satisfies invariant 5. **Limits:** yolos latency cited from v1 docs, not re-measured side-by-side; faces < 80 px undetected by both. Files: `spikes/ultraface/RESULT.md`, `benchmarks/results/v0b-ultraface.json`. | 2026-09-24, orchestrator read JSON decision block |
| V0a gliner-spike | ✅ **LOCAL PROCESS** (pre-registered rule; browser fails all 4 legs). Browser (int8 ONNX, ORT-web wasm): 2 KB blob p95 5,591 ms (≤400), cold 16.4 s (≤15), 349 MB (≤250), names 0/3 vs Python 3/3 — int8 export also lost recall broadly (only account no. + password found). Python `urchade/gliner_multi_pii-v1` CPU torch: all entities found, controls clean, imperative name 0.47; **but cold load 110 s, per-sentence p95 0.5–10.8 s, 2 KB blob p95 6.5 s, 1.1 GB, peak RSS 1.5 GB** (measured with other agents contending the CPU — inflated, re-measure alone). ⚠️ **NER is now the latency risk.** V1b must: cache spans per text node across steps (page text barely changes between steps), send only new/changed text, batch, pre-load at service start, and measure an uncontended p95; if a warm 2 KB page p95 is still > 1.5 s, evaluate a smaller GLiNER (e.g. small/medium PII variants) against the same 10 fixtures before V4. RESULT.md not written (agent hit usage limit) — raw files: `spikes/gliner/bench_python_result.json`, `bench_browser_result_wasm.json`. | 2026-09-24, orchestrator read raw JSON + applied rule |

| V1b ner-service | ✅ `ner/` FastAPI on 127.0.0.1:8757 only (host-refusal middleware, CORS chrome-extension:// only, no body/span logging, HF offline), runs in `spikes/gliner/.venv`. LRU sha256 span cache, batching, GLiNER-token-aware chunking (fixed a silent-truncation bug). 52 tests (mocked). Idle-CPU bench: cold 20.2 s; uncached 2 KB p95 4,737 ms (1.5 s rule triggered); cached steps p50/p95 292/343 ms; fixture recall 11/13 — **misses: "Rahul Verma" in a multi-entity sentence, one address** (model behaviour; a missed name is a breach → open item for V4/V5: try per-sentence segmentation of labels before NER). Smaller-model comparison NOT completed (`vicgalle/gliner-small-pii` downloaded but `from_pretrained` refuses a trimmed snapshot; details + fixes in `v1b-ner.json`). | 2026-09-25, orchestrator live probe: imperative name 0.47 (ask), 2 controls → 0 spans, unseen "Meera Iyer, 14 MG Road, Pune" → name 0.33 (ask) + address 0.74 (strip), 0 names in service log |
| Parity (JS↔Python regex) | ✅ `tests/fixtures/v2/pii_parity.json` (65 cases) run by `test_pii_parity.mjs` + `test_pii_parity.py`; byte-identical pattern sources. Broader-wins reconciliation: server UPI PSP allowlist removed; AADHAAR unconditional 12-digit (accepted FP: 12-digit order IDs); Python PASSPORT-before-IFSC hazard fixed. Follow-up in progress: Indian landline formats (both missed `080-2345-6789`). | 2026-09-24, orchestrator cross-ran both languages over 65 + 7 unseen strings → 0 mismatches |
| V2 vision-v2 | ✅ UltraFace default (`VISION_MODEL`), plain ORT wasm (non-jsep runtime added to `extension/ort/`), yolos kept but unloaded; `"face"` added to `PRIVACY_RELEVANT_LABELS`; `extension/lib/face-detect.js` pure + 33 tests. Real unpacked extension, real offscreen doc (Playwright): cold 1,239 ms, warm p50/p95 **32.9/38.2 ms**, demo face 0.99999988 every run, ≥80 px 4/4, 0 FP (`benchmarks/results/v2-vision.json`, CPU ~36% loaded). Tiled second pass met the ≤300 ms gate (p95 196 ms) but recovered **0** small faces → **orchestrator ruled OFF** (gate was mis-specified: latency-only for a recall mitigation). **Open:** `extension/models/` is gitignored, so the UltraFace ONNX + licence are not reproducible from git — V4 must track them (≈1 MB) or add a fetch step. | 2026-09-24, orchestrator read JSON, flipped flag, rebuilt bundle, 764 JS green |
| Parity follow-up | ✅ Landline PHONE forms (`080-2345-6789`, `(080) 2345 6789`, `+91 80 …`, `0484-2345678`) in both languages; dates/pincodes/time ranges not matched. 77 parity cases. | 2026-09-24, orchestrator probe |
| V3 planner-local (run 1) | ❌ **GATE FAILED** — qwen2.5:1.5b 4/15 (p50 8.9 s), qwen2.5:3b 0/15 (10.5 s), llama3.1:8b 3/15 (22.6 s); all 3/3 on S4. Diagnosis (orchestrator, from raw trials): prompt still offered `fill_profile` (qwen models over-trigger it), llama picks right target+value but says `click` for `type`, 3b emitted malformed targetId. Image mode qwen2.5vl:3b: warm 35 s, correct click; `need_visual` never chosen by any model. Claude/Gemini v2 opt-in done; Ollama-down-never-cloud tested. Retry 1 in progress: drop `fill_profile` from model-facing actions, per-element allowed actions + 2 few-shot, per-request JSON-schema-constrained decoding (targetId enum). Gate unchanged. | 2026-09-25, orchestrator read raw trials in `v3-planner.json` |
| V3 planner-local (retry 1) | ❌ gate failed but close — llama3.1:8b **12/15** (p50 10.3 s, p95 72.4 s), qwen2.5:1.5b 6/15 (4.5 s), qwen2.5:3b 3/15; CPU idle (4–8%). llama's only miss: S1 typed an invented `PERSONNAME#2`. Found: planner fixtures violate C5 (raw `taskGoal`). Retry 2 (final): goals tokenized by the real regex+NER pipeline (scored against both raw and tokenized fixtures), server rejects values carrying tokens absent from the request (`UNKNOWN_TOKEN`), neutral few-shot. ⚠️ Even at 15/15, ~10 s/step p50 on this CPU — latency is a user decision after retry 2. | 2026-09-25, orchestrator read `v3-planner-retry1.json` + S1 fixture |
| V3 planner-local (retry 2, final) | ✅ **GATE PASSED — default `llama3.1:8b`, 15/15** on C5-compliant fixtures (goals tokenized by the real regex+NER pipeline). Same model on the original raw-goal fixtures: 9/15 (S1, S3 fail) — raw goals cannot occur in v2 (C5 tokenizes every goal), reported for transparency. qwen2.5:3b 9/15, qwen2.5:1.5b 3/15. New server rule `UNKNOWN_TOKEN` (value carries a token absent from the request → reject). `fill_profile` removed from model-facing actions; per-request JSON-schema decoding with targetId enum. ⚠️ **Latency: llama3.1:8b p50 11.4 s, p95 81.7 s/step, cold warm-up 94.8 s, ~5 GB RSS** on i5-1334U/16 GB. Image mode (qwen2.5vl:3b) ~35 s warm. Tests 776 JS + 456 pytest green. Evidence: `benchmarks/results/v3-planner-retry2.json` (earlier runs kept: `v3-planner.json`, `-retry1.json`). | 2026-09-25, orchestrator ran the benchmark itself (idle machine, CPU 0–21%) after the agent stalled + memory-pressure stall |

### V4a integration-v2 (loop) — recorded 2026-09-25

✅ **Loop wired, unit-tested with fakes, browser-verified end to end.** `extension/lib/agent-loop-v2.js`
(new, ~710 lines): a PURE orchestrator — `runAgentLoopV2(io, options)` — implementing the full per-step
sequence in C5/C6's exact order (capture+detect → stale-capture check (capture-hash.js, reused verbatim)
→ scan+rank (element-ranker.js, ≤40) → regex+NER tokenize of taskGoal (once) + ranked labels (every step,
batched) → C5 scene build (elements incl. `tier`, regions from DOM-sensitive-nodes + UltraFace faces) →
C6 egress assertion → send → `need_visual` escalation (≤1/step, same revision, image mode) → local
`decide()`/`tightenWithServer()` → consent hook on `ask` → `rehydrate()` + `executeAction()` on
accept/approved). Every side effect (capture, scan, ner, send, execute, consent, redact) is an injected
`io.*` function — nothing in this file touches `document`/`chrome`/`fetch`. `extension/lib/
pipeline-version.js` (new) is the one-place `PIPELINE_VERSION` switch (`chrome.storage.local.
pipelineVersion`, default `"v2"`); `content.js`'s single `RUN_AGENT_LOOP` listener now reads it and
branches to the **untouched** v1 `runAgentLoop()` or the new `runAgentLoopV2Adapter()` (which builds the
real `io` adapter and calls the pure loop). `background.js` gained three new message handlers
(`NER_DETECT` → `POST 127.0.0.1:8757/ner`, `ANALYZE_V2` → `POST /v2/analyze`, `REQUEST_CONSENT`/
`RESPOND_CONSENT` — a 60s-timeout-denies-by-default consent broadcast) — `handleAnalyze`/v1's own message
handlers are untouched, duplicated rather than parameterized, so v1's already-verified code path is never
edited. `manifest.json` gained `web_accessible_resources` entries for the new/v2 lib files only.
**801 JS + 456 pytest green** (776→801, 25 new JS tests: 19 in `test_agent_loop_v2.mjs` — full accept/
reject/ask-consent/need_visual/stale-capture/instrumentation coverage plus the two regressions above — and
6 in `test_pipeline_version.mjs`. Pytest count unchanged: no server/ file was edited for V4a).

**🔴 TWO REAL BUGS, both FOUND BY C6 ITSELF during the browser evidence run, both fixed at the source
(not by loosening the check) — the assertion did exactly the job it exists to do:**
1. **A sensitive node's raw live DOM value was reaching `elements[].label` unredacted.**
   `action-executor.js`'s `buildDomSnapshot()` deliberately returns a form field's raw `.value` as its
   `text` (v1's own documented design — Phase 2a classifies, Phase 2b/redaction strips). v1's loop relies
   on `Redaction.sanitizeDomSnapshot()` to strip it downstream; this module built `elements[].label`
   directly from ranked nodes without that strip. A password like `hunter2Demo!` matches no PII regex and
   no NER entity, so it tokenized to **itself, unchanged**, and would have shipped verbatim. Caught live
   (`agent-1`'s raw password reached the assertion before it threw), fixed by never handing a
   sensitive-flagged node's text to regex/NER/tokenize at all — its label is unconditionally `""` → `null`.
2. **History values were being re-run through regex+NER, which is actively wrong, not just redundant.** A
   live `/ner` probe on the literal string `"PERSONNAME#1"` returned a PERSONNAME span covering the whole
   12-character token. Re-tokenizing that "detection" minted a bogus second token whose raw value *was the
   token string itself*, which then poisoned the run's `rawValueRegistry` — step 2's payload was rejected
   by C6 for containing `"PERSONNAME#1"`, which is also the *real*, correctly-placed token in `taskGoal`.
   Fixed: history values are copied through verbatim (they are already safe by construction — sourced only
   from a prior step's server response, already passed the server's `UNKNOWN_TOKEN`/`RAW_VALUE_IN_ACTION`
   checks and this module's own `rehydrate()`/`UnknownTokenError` check). Both fixes have dedicated
   regression tests (`test_agent_loop_v2.mjs`).

**✅ BROWSER-VERIFIED, real unpacked extension, real Chromium via Playwright, real `/v2/analyze`, real
NER service** (`benchmarks/v4a-loop-bench.mjs`, results in `benchmarks/results/v4a-loop.json`):

| Scenario | Goal | Outcome | Steps |
|---|---|---|---|
| 1 | `fill the name as Simon` | `done` ✅ | 2 (type → done) |
| 3 | `Fill the name as River Jane and email id as riverjane33@demo.com` | `blocked` (`SENSITIVE_TARGET_BLOCKED`) ✅ | 2 (type → blocked) |

Step 1 of each: `execResult.value` (what actually landed in the real DOM field) was **`"Simon"`** /
**`"River Jane"`** — the REHYDRATED raw value — while every request body captured server-side (4 total,
`v4a-captured-contexts.jsonl`) carried only `taskGoal: "fill the name as PERSONNAME#1"` /
`"Fill the name as PERSONNAME#1 and email id as EMAIL#1"`. **Zero-violation privacy audit** against 6
forbidden raw substrings (`hunter2Demo!`, `alice.demo@example.com`, the Aadhaar fixture, both names, the
email) across all 4 captured contexts. Per-stage timings present on every step (`captureMs`/`detectMs`
already measured by `background.js`; `scanMs`/`rankMs`/`nerMs`/`egressAssertMs`/`sendMs`/`policyMs`/
`consentMs`/`actMs` measured here) plus a `performance.memory` snapshot every step — warm capture+detect
~55–85 ms, NER (cached labels) ~6–21 ms, full step (excluding the fixed consent-deny wait) well under
100 ms end to end on this machine.

**Server-side test double, not a server/ edit:** the real, unmodified `MockVLMClient.analyze_v2()`
(`server/vlm_client.py`) is structurally safety-conscious — every branch skips a sensitive element
outright — so it **cannot express scenario 3 at all** (it can never target the email field to be refused).
Per this phase's own brief ("If the mock backend cannot express a scenario, extend its v2 fixtures
minimally and say so"): `benchmarks/v4a_server_launcher.py` runs the real `server/main.py` `app` unmodified
and overrides `main.get_vlm_client_v2` via `app.dependency_overrides` — the **same mechanism
`tests/unit/test_v2_analyze.py`'s own `_FixedActionClient` already uses** for exactly this "reach a path
the real mock can't reach" purpose — with a small deterministic `ScenarioVLMClient` that names the goal's
own token for the first not-yet-filled non-sensitive text field, and only ever targets a sensitive field
if nothing safe is left AND the goal named that category (proving the *policy engine*, not the planner,
is what refuses it). `server/main.py`/`vlm_client.py` are byte-for-byte unedited.

**Environment finding, not a product bug:** `chrome.tabs.captureVisibleTab` requires `<all_urls>` or a
real `activeTab` user gesture; scoped `host_permissions` (the shipping manifest's `http://localhost/*`)
do **not** satisfy it, and Playwright cannot script a genuine toolbar-icon click. The evidence run drives a
**scratch copy** of `extension/` with `host_permissions` widened to `<all_urls>` for capture only —
`extension/manifest.json` (the shipping product) is untouched. Also required `viewport: null` in
Playwright's launch options: with Playwright's default CDP viewport override active, `captureVisibleTab`
(which reads the real native window) returned `1600×900` while `window.innerWidth/Height` reported
`1280×720` — an exact 1.25 ratio, a Playwright/CDP testing artifact, not real display scaling — which
fired capture-hash.js's dimension-mismatch stale-capture guard on **every** step (working exactly as
designed; CLAUDE.md's own v1 entry had already flagged this precise risk). `viewport: null` removes the
CDP override so `window.innerWidth` and the real captured PNG agree, matching every non-automated run in
this project's history.

**DOCUMENTED INTERPRETATIONS (C4/C5 left unspecified; my own judgment calls, not ported contract) —
flagged here per §7 rule 5 rather than silently assumed:**
1. **`elements[].tier`** has no defined derivation when no action has been chosen yet (`classifyTier`
   takes both an element AND an action). This module guesses a representative action per element from its
   tag/type (`input[type=text|email|...]`→`type`, `a`/link-role→`click`, everything else→`click`) purely to
   seed `classifyTier()` for the informational scene field. The REAL policy decision (`decide()`) is always
   computed later against the model's ACTUAL chosen action, which calls `classifyTier()` itself — this
   guess never gates anything.
2. **`RegionKind` has no mapping table from dom-scanner's `piiType`.** `password`/`current-password`→
   `"password"`, `cc-number`→`"field"`, everything else (email/tel/aadhaar/pan/other, the regex-on-text-
   or-value matches)→`"text-pii"`.
3. **`action-risk.js`/`action-executor.js` were NOT rewired to call `decide()`/`classifyTier()` internally**,
   despite `policy.js`'s own header comment asserting "V4 (integration-v2) rewires both". This module's
   brief was explicit ("don't touch the verified modules' internals"; action-executor.js is listed as a
   "v1 piece to reuse"), so `executeAction()`'s OWN `guardSensitive`/`guardIrreversible` are instead
   **neutralized** via the already-built `onSensitiveTarget`/`onIrreversibleAction` override hooks (always
   return `true`) on every v2 dispatch — `decide()`/`tightenWithServer()` is the sole verdict that gates
   whether `executeAction()` is ever called at all; when it IS called, action-executor's own (superseded)
   verdict logic is bypassed rather than consulted a second time. Flagging the discrepancy between
   `policy.js`'s stated assumption and what was actually built, per §7 rule 5, rather than silently
   patching around it.
4. **`capture`/`detect` share one injected call in production** (`io.capture()`/`io.detect()` both read
   from one `CAPTURE_AND_DETECT` round trip) rather than two independent round trips — v1's own precedent
   (one offscreen-doc round trip returns both a screenshot and vision boxes), reused rather than doubled.

**Deliberately OUT OF SCOPE for V4a (single top frame, viewport-only):** no subframe/iframe merging, no
full-page scroll-and-stitch capture, no defensive whole-iframe redaction region. `agent-loop-v2.js`'s
`scanDom()` io contract has room for a future subframe-merged result: the adapter returns
`unscannableRegions` already; wiring `collectAndMergeSubframeReports()` (already built, v1) into the v2
adapter is V4b/V5 work, not attempted here to keep this phase's surface reviewable. Consent UI is
deliberately minimal — a background 60s-timeout-denies broadcast + a `window.confirm()` in `popup.js` —
real UI is V4b's named job. **NER-unavailable (C3) stop is unit-tested only** (a `NerUnavailableError`-
throwing fake), not separately re-verified against a live-killed NER process in this browser run — flagged
rather than silently assumed proven.

**What V4b inherits, unstarted:** real consent UI in the popup; wiring `PIPELINE_VERSION` into a visible
popup toggle; subframe/full-page parity for the v2 path; a `start-demo.ps1`-equivalent that also launches
the NER service; new/updated demo pages exercising `need_visual` and `press_key`/`scroll` through v2;
re-measuring `benchmarks/v4a-loop.json`'s numbers on a longer, more realistic multi-field run once the
demo page exists.
| V4a integration (loop) | ✅ `extension/lib/agent-loop-v2.js` (pure, injected io) + `pipeline-version.js` (`PIPELINE_VERSION`, default v2; v1 intact). Real unpacked extension + real `/v2/analyze` + real NER: S1 done (2 steps, 893 ms wall), S3 name typed + email blocked. **Privacy audit: 4 captured bodies, 6 forbidden raw values, 0 violations; goals arrived as `PERSONNAME#1`/`EMAIL#1`; rehydrated `Simon` typed in DOM.** C6 caught 2 real bugs live (sensitive raw value in a label; NER tags literal token strings as names → history no longer re-scanned). **Orchestrator ruling:** V4a had set action-executor's v1 guards to always-allow; restored them as an independent layer that yields only to explicit user consent (policy accept + v1 guard flag → refused). ⚠️ V4a stopped two long-running processes on :8000/:5500 — those were the user's v1 demo servers from 2026-09-23, not orphans. Contract gaps ratified as interpreted in the file header: pre-action element `tier`, v1 `piiType`→`RegionKind` mapping. Evidence `benchmarks/results/v4a-loop.json`. | 2026-09-25, orchestrator read privacy audit + verdict branches, fixed guard hooks, 801 JS green |
| V4b integration (UI, demo, frames, scripts) | ✅ Consent panel (alertdialog, keyboard, aria-live, 60 s deny-by-default, never shows raw values); goal-privacy panel (C2 amendment); v1 guards independent (defence-in-depth tests with real jsdom executor); subframe/shadow parity via v1 frame merge; popup pipeline toggle + planner selector (cloud = explicit opt-in, no keys in popup); `start-demo.ps1 -Planner local|claude|gemini` starts NER + Ollama preflight; stop script kills only tracked PIDs (`demo-pids.json`); DEMO-SCRIPT v2 section. **Browser (mock/scenario planner, real extension/NER/server): 10/10 scenarios match (S1–S7 incl. S4 IRREVERSIBLE_ACTION_BLOCKED, S7 approve+deny, profile autofill via `type`+`PROFILENAME#1`, goal ask-band 'Not private'); privacy audit 19 bodies × 13 forbidden raw values incl. vault → 0 violations.** C5/C2 amendment implemented (`vault` field, server treats vault tokens as known). Tests 834 JS + 462 pytest. **Open:** end-to-end run on the real local planner (llama3.1:8b) not done — memory precheck (≥ 7 GB free) refused at 5.4 GB; capture log omits the `vault` field (mock dispatch proves it arrives; schema restricts it to tokens). | 2026-09-26, orchestrator read scenario table + audit + captured contexts, reran tests |
| V5a-1 popup a11y | ✅ axe (Playwright, file:// popup, chrome stubbed): before 1 serious violation (color-contrast, 4–5 nodes) in each state → after **0 in 4 states** (default, consent, goal-privacy, all `<details>` open). Fixes: `--faint` alpha 0.45→0.6, missing label on server URL, restored focus rings (`outline:none` removed), max-width for < 400 px, undefined CSS vars defined. Keyboard: 15 controls reachable, Enter/Esc on both panels; 1.4.12 spacing OK; no h-scroll at 360 px / 200 %. **Not checked:** real screen reader; popup as installed extension. `benchmarks/results/v5a-a11y.json`. | 2026-09-27, orchestrator read JSON |
| V5a-4 fresh-clone setup | ✅ `extension/scripts/fetch-assets.mjs` + `assets.lock.json` (`npm run fetch-assets`; `--dest`, `--verify-only`, `--gen-lock`): fetches yolos (HF), ORT wasm/glue (onnxruntime-web 1.22.0-dev jsep + 1.23.2 plain) with sha256 checks, then builds. **UltraFace model is tracked in git** — it is a derived file (upstream Linzaer RFB-320 sha 34cd7e60… → sih-2026 `optimize-vision-model.py` → sha 22bd2fbe…), not downloadable byte-identically; `.gitattributes` `-text`. Earlier ORT glue mismatch was CRLF only (orchestrator diff), now replaced with upstream LF bytes. `--verify-only`: 0 mismatches. | 2026-09-27, orchestrator ran verify + diffed glue files vs npm |
| V5a-2 EN/HI | ✅ 152 keys in `_locales/{en,hi}/messages.json`, parity/placeholder tests (`test_i18n.mjs`, 163 tests); in-popup EN/हिं toggle (`chrome.storage.local`, sets `<html lang>`); axe 0 violations in both languages × 4 states. Orchestrator read the safety strings (approve/deny, keep private/not private, countdown defaults): accurate. **Human review needed:** 5 REVIEW-flagged technical hints (`prewarmWarming`, `fullPageCaptureHint`, `pipelineVersionHint`, `plannerBackendHint`, `plannerCloudNote`); `blockedBannerTitle` keeps the English word BLOCKED. JS total now 997. | 2026-09-27, orchestrator ran test_i18n + read hi strings |
| V5a-3 Firefox | ⚠️ **Built + linted, not run.** `extension/scripts/build-firefox.mjs` → `extension/dist/firefox/` (gitignored): no `offscreen` permission, `background.scripts` event page co-hosting `offscreen.bundle.js`, gecko id, `strict_min_version` 128; one capability-check patch applied only in the Firefox copy. Chrome sources unchanged. `web-ext lint`: **0 errors**, 9 warnings (AMO data-collection declaration, 2× innerHTML in popup.js, eval/dynamic import in vendored ORT, dead `chrome.offscreen` call). **Live check not done:** Store-packaged Firefox 156 rejected by geckodriver; standalone install killed by low-memory protection. Popup + DETECT_OBJECTS on Firefox unverified — do not claim Firefox support. `benchmarks/results/v5a-firefox.json`. | 2026-09-27, orchestrator checked lint JSON + Chrome file mtimes |
| V4 real local planner (first live run) | ❌ S1 on real llama3.1:8b through the real extension: **blocked in 4 steps, ~29 s/step** (117 s wall incl. cold load) — step 1 clicked the name field instead of typing, step 2 empty, step 3 clicked Continue, step 4 hit a sensitive target (consent unanswered → blocked; fail-safe held). Contradicts V3's 15/15 on the fixture → live request ≠ benchmarked request (integration gap). Memory margin lowered to 3.5 GB for this run (Edge/Chrome stopped with user approval; recorded in `v4b-real-ollama.json`). Diagnosis delegated. | 2026-09-27, orchestrator ran the bench in foreground |
| V4 real local planner (diagnosed) | ⚠️ **Root cause of the first live failure: the server default model constant `DEFAULT_OLLAMA_TEXT_MODEL_V2` was still `qwen2.5:1.5b` (V3 run-1's failed pick) — the orchestrator logged llama3.1:8b as default after retry 2 without verifying the code.** Fixed + regression test pinning the constant to `v3-planner-retry2.json` (`test_v3_v4_live_request_regression.py`). With llama3.1:8b live: step 1 correctly types "Simon" (2/2 runs); step 2 stale-capture skip (typing scrolled the page — fail-closed, correct); step 3 the model re-targets a sensitive field instead of `done` → consent unanswered → blocked. **Result: live S1 does not reach `done` on the local planner; 29–76 s/step on this CPU.** Multi-step completion was never benchmarked in V3 (step-1 only). Prompt hardened (history/completion guidance) without fixing it reliably. Also: `stop-demo.ps1` tracks the venv launcher PID, not the uvicorn child → left :8000 running + the `-NoExit` PowerShell windows open (orchestrator stopped them). | 2026-09-28, orchestrator verified constant + test, stopped stack |
| C4 completion rule | ✅ `policy.js` `CLICK_INTENT_WORDS`, `goalExpressesClickIntent`, `isGoalTokenComplete`; loop ends a run with `done`/`GOAL_TOKENS_COMPLETE` after a successful action when all goal tokens are typed and the goal has no click intent. 3 existing loop tests updated by the orchestrator (one now expects the early finish; two whose purpose is step 2 now use a genuine two-step goal "… and click Continue"). 1016 JS + 464 pytest green. **Not yet done (weekly usage limit):** live rerun on llama3.1:8b with the rule; stop-demo PID-tracking fix; re-run of the 10-scenario mock browser suite. | 2026-09-29, orchestrator |
| stop-demo.ps1 PID fix | ✅ `start-demo.ps1` now records each listener's real PID and its `-NoExit` window's PID; `stop-demo.ps1` closes both. Real bug found and fixed along the way: the window-safety check's regex pattern had a literal ASCII backspace byte (0x08) where a `` word-boundary was intended — a heredoc-escaping accident — which made the match impossible and silently left every window open. Verified live with real processes: closes on a match, refuses on a mismatch. | 2026-09-29, orchestrator, direct in main thread (subagents unavailable — usage limit) |

### C5/C2 amendment — 2026-09-26 (found at the V4 checkpoint, §7 rule 5)
1. **Vault tokens must be visible to the planner.** V4 seeded `PROFILE…#n` tokens but never sent them, so a real
   planner could not use them (and `UNKNOWN_TOKEN` would reject any it guessed). C5 request gains
   `"vault": [{"token": "PROFILENAME#1", "field": "full_name" | "email" | "phone"}]` — tokens + categories only,
   never values; omitted when the vault is empty. Server: schema accepts it; `UNKNOWN_TOKEN` treats vault tokens as
   present; the v2 prompt lists them as "the user's saved details — type the token to fill that detail".
   `fill_profile` stays accepted from v1 clients only; the v2 planner uses `type` + a vault token.
2. **Ask-band spans in the user's own goal are asked, once.** NER marked the whole instruction
   "Fill in my full name" as PERSONNAME (0.427, ask band), so the goal became just `PERSONNAME#1`. Before step 1,
   each ask-band span in `taskGoal` is shown in the consent panel: "Treat '<text>' as private?" —
   **Keep private** (default, and the answer on 60 s timeout) / **Not private** (text stays verbatim). The raw text
   is shown only locally in the popup, never sent. Ask-band spans in page labels stay held (stripped) without a
   prompt — too frequent to ask, and stripping fails safe.

### C4 amendment — deterministic task completion (2026-09-28, user decision)
The local planner acts correctly but does not reliably say `done`. The loop therefore finishes a run itself,
independent of the model, when ALL of these hold after a successful action:
1. the tokenized `taskGoal` contains ≥ 1 value token (`[A-Z][A-Z0-9]*#[0-9]+`, incl. vault tokens);
2. every such token has been rehydrated into a successful `type` this run (per history `outcome: ok`);
3. the raw goal expresses no click/submit intent — none of: click, press, submit, place, order, continue, next,
   send, pay, buy, book, confirm, sign in, log in, login, checkout (case-insensitive, word-bounded; list lives in
   one constant in `policy.js`).
Outcome `done`, closed code `GOAL_TOKENS_COMPLETE`. It can only END a run early, never trigger an action, so it
cannot weaken any safety rule. Goals without value tokens (e.g. "fill all my details", checkout) are unaffected
and still rely on the planner's `done`.

### V4 design rule — NER scans egress text only (2026-09-25, from V1b numbers)
V1b measured the uncached 2 KB page blob at p95 4,737 ms (idle CPU) and cached steps at ~300 ms. NER must
therefore run only on text that will actually leave the browser: `taskGoal` + the labels of the ≤ 40 ranked
elements (each ≤ 120 chars) + history values. Never the whole page. Screenshot text is covered by redaction
regions, not NER. Additionally: warm the NER cache for the current page's ranked labels as soon as the popup
opens (before the user submits a goal), so step 1 does not pay the uncached cost on the critical path.
V4 must measure step-1 and step-n NER time under this rule and record it in `benchmarks/results/v4-*.json`.
