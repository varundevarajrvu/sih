# Project Orchestrator — Dhristi: A Privacy-Preserving Browser Tool
**SIH 26171 — On-Device Visual Perception for Lightweight Browser Agents**

Drop this file at the repo root as `CLAUDE.md`. Claude Code loads it automatically into the main session and into every subagent except the built-in `Explore`/`Plan` agents — that's what makes this "self-contained": you don't re-paste architecture into every delegation, the file does it for you.

Start the session with:
```bash
claude --model opusplan --effort high --fallback-model sonnet,haiku
```

---

## 1. Role Definition — You Are the Orchestrator, Not the Builder

Your job in this repo is **planning, delegation, and verification** — not writing every line yourself. Default to the Agent tool for anything that qualifies as a module (Section 4). You write code directly only for: one-line fixes, config tweaks, and gluing already-verified module outputs together in Phase 6.

Ground rules:
- **Never silently do a subagent's job in the main thread.** If you catch yourself about to implement a module's logic directly instead of delegating it, stop and spawn the subagent instead. This is the single most common orchestrator failure mode — narrating delegation while actually doing the work inline defeats the entire pattern and Section 9.4 exists specifically to catch it.
- **Plan before you delegate.** Before spawning a module's subagent, confirm: its dependencies (Section 4) are done and validated (Section 6), and you can state its interface contract (Section 4) in one paragraph. If you can't, you're not ready to delegate it yet.
- **One phase's validation gates the next phase's delegation.** Don't parallel-spawn a module whose inputs haven't passed their checkpoint.
- **You own coherence.** Subagents start with a blank context each time (Section 3). CLAUDE.md gives them the architecture; your delegation message gives them the *current state* — what already exists, what changed, what this specific module must produce.

---

## 2. Model & Effort Configuration

| Setting | Value | Why |
|---|---|---|
| Main session model | `opusplan` | Plan mode runs on Opus 5 (architecture judgment, validation review — the actual orchestrator work); execution mode auto-switches to Sonnet 5 (cheaper, faster, plenty for writing glue code and reviewing subagent diffs). This is the built-in Claude Code pattern for exactly this split — Opus reasons, Sonnet executes — so use it instead of manually swapping models with `/model`. |
| Main session effort | `high` | The documented default and the right balance for a build with real architectural decisions in it. Don't run `max` by default — diminishing returns, and you'll burn budget you want available for the one genuinely hard step. |
| `webgpu-spike` subagent effort | `xhigh` (set in its frontmatter) | The one module with real technical uncertainty (offscreen-doc WebGPU behavior, Firefox event-page WebGPU support — see Section 4, Phase 0). Worth the extra reasoning depth; everything downstream is comparatively mechanical. |
| Other module subagents | inherit session default (`high`); `integration-loop` may drop to `medium` since it's mostly wiring already-verified pieces | Boilerplate and well-specified glue code doesn't need premium reasoning — that's what the effort dial is for. |
| Subagent model | `sonnet` explicitly in each subagent's frontmatter | Don't let subagents inherit `opusplan` — that alias is main-session-only behavior. Pin `sonnet` so every module runs on a fast, cheap, capable-enough model. |
| Permission mode | Session default (`default`/interactive prompts), optionally `acceptEdits` once you trust the loop | This is solo local dev with no production data at risk — `acceptEdits` is a reasonable speed trade once Phase 0–1 prove out, but don't jump to `bypassPermissions`; there's no need to disable the safety net for a hackathon build and it buys you nothing Phase 2+ needs. |
| Resilience | `--fallback-model sonnet,haiku` at launch, or `fallbackModel` in settings | A multi-hour build session shouldn't die to a transient 529 overload. Costs nothing when unused. |

`.claude/settings.json` starter:
```json
{
  "model": "opusplan",
  "effortLevel": "high",
  "fallbackModel": ["claude-sonnet-5", "claude-haiku-4-5"],
  "permissions": {
    "allow": ["Bash(npm run *)", "Bash(pip install *)", "Bash(ollama *)"]
  }
}
```

---

## 3. Context-Passing Protocol

Every non-fork subagent starts with a **fresh context**: no conversation history, no memory of other subagents' work. Three mechanisms carry context forward — use all three, don't rely on one:

1. **This file (automatic).** Architecture, interface contracts, and invariants (Section 4, Section 5) load into every subagent without you doing anything. This is why they live here instead of only in your head.
2. **The delegation message (your job, every time).** State explicitly: which files already exist and what's in them, which interface contract this module implements, and what "done" looks like for this specific call. A subagent that doesn't know a file exists will happily recreate it differently.
3. **Interface contracts as the handoff artifact (Section 4).** Modules don't need to know *how* an upstream module works, only its contract. Pass the contract, not a summary of the other subagent's implementation.

Isolate anything verbose in its own subagent rather than running it in the main thread: `npm install` output, ONNX model download logs, Ollama pull output, exploratory `curl` testing against the FastAPI server. That's what keeps your orchestrator context — and your judgment quality at the validation checkpoints — clean across a long build.

---

## 4. Module Map — Phases, Dependencies, Interfaces

```
Phase 0  webgpu-spike           (no deps — do this FIRST, it's the only real risk)
Phase 1  extension-scaffold     (depends on: Phase 0 result)
Phase 2a dom-pii-scanner        (depends on: Phase 1)   ─┐
Phase 2b redaction-engine       (depends on: Phase 1)   ─┤ run in parallel
Phase 2c server-api             (depends on: nothing)   ─┘ (independent of the extension entirely)
Phase 3  action-executor        (depends on: Phase 1)
Phase 4  integration-loop       (depends on: 2a + 2b + 2c + 3, ALL validated)
```

Chrome is the reference platform for every phase. Firefox is a post-Phase-4 optimization pass (per our earlier call: get Chrome fully working first, then retrofit Firefox compatibility where it's cheap — WASM fallback everywhere, `chrome.offscreen` branch only if Phase 0 shows the Firefox event-page path doesn't pan out).

### Phase 0 — `webgpu-spike`
**Question to answer, not code to ship:** does `Xenova/yolos-tiny` run via `@huggingface/transformers` inside a Chrome `chrome.offscreen` document, and how fast? Bare manifest, one offscreen page, one test image, bounding boxes logged to console. No popup, no content script, no redaction logic.
**Interface it produces:** a confirmed inference call shape — `runDetection(imageBase64) → [{label, score, xmin, ymin, xmax, ymax}]` — and a measured latency number.
**Gate:** does it return boxes in under ~1s on WASM fallback (WebGPU may not be available in your dev environment — that's fine, WASM is the floor everything else is built against per Section 2's earlier browser-compat findings).

#### Phase 0 RESULT — recorded 2026-09-10 (Section 7 rule 5 contract correction)

**The flat shape above is WRONG.** `@huggingface/transformers` returns the box **nested**, verified against live output and `ObjectDetectionPipeline._call`:
```js
// ACTUAL library output:
{ score: 0.93, label: "cat", box: { xmin: 332, ymin: 25, xmax: 638, ymax: 369 } }
// CONTRACT downstream modules consume — Phase 1 MUST flatten box.* itself:
{ label, score, xmin, ymin, xmax, ymax }
```
Working adapter: `spike/node-test-contract.js`. Additional confirmed details:
- Coordinates are **absolute pixels** only because `percentage` defaults to `false`. Passing `percentage: true` silently switches to 0–1 normalized floats. Set it deliberately.
- `score` is a 0–1 float (matches). Library's own `threshold` defaults to `0.9`; the spike used `0.5`.
- `RawImage.fromURL()` rejects `data:` URIs in Node (reads them as file paths). Use `RawImage.fromBlob()` — portable across Node and browser.

**GATE: FAIL.** Warm inference measured twice, independently:
| Run | Warm inference |
|---|---|
| Subagent | 3.5–4.1s |
| Orchestrator re-run | 5.1–5.8s |

3.5–5.8× over the ~1s gate. Measured on `onnxruntime-node` (native CPU, fp32), which is normally **faster** than browser WASM — so this is an optimistic floor, before any browser overhead. Unexplored lever: quantization (q8/int8) was deliberately not attempted, per Section 7's "don't work around a failure with an unapproved substitution."

**Chrome offscreen/WebGPU half: VERIFIED in browser (retry 1).**

✅ **`navigator.gpu` IS present inside an MV3 offscreen document** — `BACKEND ACTUALLY USED: webgpu`. The single largest architectural risk in this build is resolved positively. The `"WORKERS"` offscreen reason is accepted (confirmed correct: the ORT `.mjs` self-spawns `new Worker(import.meta.url)`).

⚠️ **MV3 CSP blocks the default ORT path.** onnxruntime-web resolves its backend via a dynamic `import()` from jsdelivr — a *script* load, governed by `script-src 'self'`, not a CSP-exempt `fetch()`. Host permissions do not override CSP. **Fix, mandatory for Phase 1:** bundle ORT locally and set `env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("ort/")`. Weights are likewise local with `env.allowRemoteModels = false` — required anyway, since an on-device privacy tool must not phone a CDN to function.

⚠️ **dtype must be pinned explicitly.** The library defaults `wasm` to `q8` but `webgpu` to `fp32`; an unpinned webgpu→wasm fallback needs two weight files. Spike pins `fp32` on both.

**GATE: STILL FAIL — and WebGPU is the slower path.**
| Config | Warm inference |
|---|---|
| Node, native CPU fp32 | 3.5–5.8s |
| Browser, WebGPU fp32 | **8.7s** (cold 14.1s) |
| Browser, WASM fp32 | NOT YET MEASURED |

WebGPU is ~2× slower than CPU. Cause is in the ORT log: `Some nodes were not assigned to the preferred execution providers`. YOLOS is a DETR-style ViT — shape ops fall back to CPU, splitting the graph and forcing GPU↔CPU tensor round-trips on a model too small to amortize them. **Do not assume WebGPU is the fast path for this model.**

**FINAL MATRIX** (retry 2, measured in-browser, median of 3 warm runs per cell):

| Config | Median warm | vs 1s gate |
|---|---|---|
| **webgpu + fp32** | **8,432 ms** | 8.4× FAIL |
| webgpu + q8 | 13,450 ms | 13.5× FAIL |
| wasm + fp32 | 33,576 ms | 33.6× FAIL |
| wasm + q8 | 33,037 ms | 33× FAIL |

**Conclusions — binding on Phase 1:**
1. **WebGPU is the correct backend, decisively** — 4× faster than WASM in-browser (8.4s vs 33.6s). Do not compare against Node's native `onnxruntime-node` CPU numbers; that backend is unavailable to an extension and is not a meaningful baseline.
2. **q8 is DOMINATED — do not ship it.** Slower than fp32 on *both* backends (quantized ops lack WebGPU kernels → CPU fallback + dequant/requant overhead per crossing) and it returned 7 detections vs fp32's 5, i.e. quantization-noise false positives. Drop the q8 weights (−9.66 MB).
3. **`Xenova/yolos-tiny` cannot meet the gate at any setting.** It is DETR-family (a vision *transformer*): its shape ops don't map to WebGPU, the graph splits across GPU/CPU, and boundary crossings round-trip tensors. 8.4s is its floor in a browser, not a tuning problem.

**CHIEF'S RE-SCOPE DECISION (2026-09-10): swap the detector to a CNN architecture.** Section 4's `Xenova/yolos-tiny` choice is SUPERSEDED. Conv-based YOLO-family detectors map cleanly to WebGPU without graph splitting. Model selection is delegated to a follow-up spike with instructions to verify availability empirically rather than assume it. The harness (local ORT, offscreen doc, benchmark matrix, contract adapter) is architecture-independent and is retained as-is.

**DETECTOR SWAP ATTEMPTED — BLOCKED BY AN ONNXRUNTIME-WEB LIMITATION, NOT BY MODEL CHOICE.**

`pipeline()` supports only `detr, rt_detr, rt_detr_v2, rf_detr, d_fine, table-transformer, yolos` (verified in `models.js`) — no YOLOv5/8/9/10/11. Of the CNN-backbone candidates:

| Candidate | Size | Result on WebGPU |
|---|---|---|
| `onnx-community/rtdetr_r18vd` | 82.5 MB | ❌ crash + graph-split warnings |
| `onnx-community/dfine_n_coco-ONNX` | 15.3 MB | ❌ crash, **zero** graph-split warnings |
| `onnx-community/rfdetr_nano-ONNX` | 108 MB | excluded: >100 MB GitHub hard limit, DINOv2 **ViT** backbone |

Both crashes are identical and are an ORT backend gap, not a model defect:
```
Error: using ceil() in shape computation is not yet supported for AveragePool
```
onnxruntime-web's WebGPU/JSEP execution provider has no `AveragePool` kernel with `ceil_mode=1`.

**Key signal:** D-FINE produced NO node-assignment warnings — its graph maps cleanly to WebGPU and it failed on exactly one unsupported op. It is the strongest candidate *if* that op is worked around (graph patch, newer ORT build, or WASM).

**STATE OF PLAY: `Xenova/yolos-tiny` on WebGPU is the only configuration proven to run end-to-end in the browser.** (Its 8,432 ms spike figure is SUPERSEDED — production measures ~780–880 ms. See the correction under "PHASE 0 CLOSED" below.) Its weights were removed from the spike harness; Phase 1 re-fetches them. The contract, the local-ORT setup, and the offscreen architecture are all model-independent and remain valid.

**Rubric note driving the next decision:** latency is 15% of the score. Visual accuracy (25%), PII recall (20%), redaction precision (20%), and resource utilization (20%) — 85% combined — all require a *working end-to-end pipeline*, which does not yet exist. A fast detector with no pipeline around it scores nothing.

---

### ✅ PHASE 0 CLOSED — 2026-09-10, by Chief's decision

**Architecturally PASSED.** ~~Latency gate formally RE-SCOPED from ~1s to the measured 8,432 ms floor.~~

> ### ⚠️ THIS RE-SCOPE WAS WRONG — SUPERSEDED 2026-09-11
>
> **The original ~1s gate is MET.** Production measurements from the shipping extension, WebGPU, real viewport captures with real detections:
>
> | Source | Warm inference |
> |---|---|
> | Phase 0 spike harness | 8,432 ms |
> | **Shipping extension** | **784 / 817 / 860 / 881 ms** (4 samples, ~780–880 ms) |
>
> The spike number is ~10× the production number and the gap is **not fully explained**. Stated plainly rather than rationalised: the spike harness loaded four model configurations sequentially in one page, creating and disposing ONNX sessions between each, while the extension holds a single pipeline alive. That is a plausible contributor, not a confirmed cause.
>
> **The production number is the one that counts** — it is measured in the configuration that actually ships. Every downstream decision made under the 8,432 ms assumption (deferring the detector swap, treating latency as the weak rubric dimension) was made on a pessimistic figure.
>
> **Separately, and do not conflate the two:** the *first* inference after the offscreen document is created costs ~16–20 s, with `pipelineWasAlreadyLoaded: true` and `model-load: 0 ms`. That is neither teardown nor model loading — both hypotheses were tested and refuted. Best explanation is WebGPU compiling shaders lazily on first execution; the timing pattern is confirmed, the mechanism is inferred. A pre-warm inference at install/startup pays it once, and the popup surfaces warm state so nobody pays it accidentally.

Every structural question Phase 0 existed to answer is resolved: WebGPU runs in an MV3 offscreen document, ORT and weights load locally with zero network calls under an unrelaxed CSP, and the inference contract is confirmed in-browser. The remaining problem is detector performance, which is an optimization, not an architectural unknown.

**SHIPPING CONFIG for Phase 1:** `Xenova/yolos-tiny`, `device: "webgpu"`, `dtype: "fp32"` — the only configuration proven to run end-to-end. Weights must be re-fetched (removed from the spike harness).

**Mandatory carry-overs into Phase 1** — these were learned the hard way and are not optional:
- Bundle ORT locally; set `env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("ort/")`. The CDN default is blocked by MV3 CSP.
- Bundle weights locally; `env.allowRemoteModels = false`. Required for the on-device privacy claim.
- Pin `dtype` explicitly on every `pipeline()` call.
- Flatten the library's nested `box` into the flat contract — the library never does this.
- `RawImage.fromBlob()`, not `fromURL()` with a `data:` URI.

**DEFERRED, not abandoned — the detector-speed track.** Reopen after the pipeline is demoable. Ranked by expected value:
1. D-FINE nano (15.3 MB) on **WASM** — already bundled locally, no download needed. It produced zero graph-split warnings, so it maps cleanly; only one unsupported WebGPU op stopped it.
2. Raw-ORT **YOLOv10n** (~9 MB, NMS-free by design) — bypasses the `pipeline()` API and its architecture whitelist entirely.
3. Offline ONNX graph patch rewriting `ceil_mode` `AveragePool` → pad + floor-mode, unblocking D-FINE on WebGPU.

**Class-name trap for whoever reopens this:** the replacement candidates use `tvmonitor`/`sofa` where `yolos-tiny` uses `tv`/`couch`. Never literal-match COCO class names across models — map through `id2label` at runtime.

### Phase 1 — `extension-scaffold`
MV3 manifest, background service worker, content script skeleton, popup for task input, the offscreen document wired to Phase 0's confirmed inference call.
**Interface it produces:** message-passing contract between background SW and offscreen doc:
```
→ { type: "DETECT_OBJECTS", requestId, imageData: base64 }
← { type: "DETECTION_RESULT", requestId, boxes: [{label, score, xmin, ymin, xmax, ymax}] }
```

#### Phase 1 RESULT — recorded 2026-09-10. Contract additions, APPROVED and binding.

**Error variant — the spec had no failure path; a crashed offscreen doc would hang the caller forever:**
```
← { type: "DETECTION_ERROR", requestId, error: { message, stage: "model_load"|"image_decode"|"inference"|"unknown" } }
```
`requestId` correlation is a `Map` in `background.js` (concurrent requests supported) with a 60s per-request timeout.

**Ruled decisions — do not re-derive these differently:**
1. `imageData` is **raw base64 with NO `data:` prefix** on the wire. Background strips it; offscreen strips defensively too.
2. **Detection threshold = `0.5`**, not the library's `0.9` default — continuity with every Phase 0 measurement.
3. **Task goal lives at `chrome.storage.local.taskGoal`** as a plain string. Phase 4 wires this exact key into `AnalyzeRequest.taskGoal`.

Popup↔background messages (`SET_TASK_GOAL`, `RUN_TEST_DETECTION`, …) are internal to Phase 1 and not part of any cross-module contract.

**✅ CHECKPOINT PASSED (Section 6), verified in browser 2026-09-10:** pipeline loaded on **webgpu** in 1,575ms; `DETECT_OBJECTS` round-tripped and returned 5 detections in the **flat** contract shape. The nested-box adapter survives the message channel; `requestId` correlation works; WebGPU initialises under the real manifest.

**⚠️ COLD-START = 19,407ms** (vs Phase 0's 11.7s cold / 8.4s warm). **Phase 4 MUST pre-warm** — fire a throwaway inference at install/startup so the first user-visible detection is warm. Otherwise the first detection in a live demo takes ~19s.

**CONTRACT RULING — who produces `domSnapshot`?** Section 4 never said, and Phase 2c consumes it. **Phase 3 (`action-executor`) is the producer**: it already walks actionable elements and assigns `data-agent-id`, so it owns the ID→element map that `domSnapshot` is built from. Phase 2a produces `sensitiveNodes` (the flagged subset) which Phase 4 merges in — setting each node's `sensitive` flag. The two are complementary, not competing: 2a classifies, 3 enumerates.

> **CORRECTION (found in the Phase 4 browser run):** an earlier version of this ruling also said to merge `piiType` into `domSnapshot`. That is WRONG and produces a hard 422 — `DomNode` is `extra="forbid"` and has no `piiType` field. Merge `sensitive` ONLY. The PII type already reaches the server on `redactedRegions` (`{type, bbox, agentId}`), correlated by `agentId`; duplicating it on `DomNode` is redundant, and `DomNode` is deliberately the minimal *sanitized* shape. `sensitive: true` alone still triggers `sanitizeDomSnapshot()`'s text strip.

### Phase 2a — `dom-pii-scanner`
Content-script DOM walker. Flags `input[type=password]`, `autocomplete` values (`cc-number`, `current-password`, `email`, etc.), and regex-matches visible text nodes for email/phone/Aadhaar(12-digit)/PAN patterns.
**Interface it produces:**
```json
{ "sensitiveNodes": [
  { "selector": "#pw", "bbox": {"x":0,"y":0,"w":0,"h":0}, "piiType": "password", "agentId": "agent-1" }
]}
```

#### Phase 2a RESULT — recorded 2026-09-10. Checkpoint PASSED (23/23, verified by orchestrator).

**⚠️ PIPELINE CALL ORDER — Phase 4 MUST NOT get this backwards:**
> **`action-executor` runs FIRST** and stamps `data-agent-id` on elements. **`dom-scanner` runs SECOND** and reuses those IDs.

Reversed, the two modules mint independent ID spaces, `sensitiveNodes.agentId` stops correlating with `domSnapshot.agentId`, and Phase 2c's PII-leak correlation silently degrades to bbox-overlap only. `dom-scanner` already prefers an existing `data-agent-id` and self-assigns only as fallback — correct, keep it.

**Accepted scope limits (deliberate, not defects):**
- `piiType` is recall-biased throughout. Aadhaar detection flags ANY bare 12-digit number — a 12-digit order ID over-flags by design. No checksum validation anywhere.
- Phone detection is India-tuned (`+91` or bare 10-digit starting 6–9). Other countries' bare 10-digit formats are an accepted false negative.
- `new-password`, `cc-csc`, `cc-exp`, `cc-name` degrade to `piiType: "other"` — still FLAGGED and still redacted, only the label is imprecise. Enum refinement deferred to Phase 4; not worth a cross-module edit to `server/schemas.py` while it is green at 65/65.
- Generic autocomplete tokens (`name`, `street-address`, `postal-code`) are NOT flagged. Flagging them would redact most of a form and leave the agent unable to operate — an accepted tradeoff, explicitly ruled.

**bbox values are UNVERIFIED outside a browser** — jsdom returns zeros. Confirm real geometry when Phase 4 loads this in Chrome. Same caveat applies to Phase 3.

**Test infra note:** jsdom is vendored twice (`tests/unit/dom-scanner-vendor/` and `tests/node_modules/`) because three agents built concurrently and a shared `npm install` target was a genuine Windows race risk. Consolidate at Phase 4.

### Phase 2b — `redaction-engine`
Canvas 2D redaction. Merges Phase 0's vision boxes with Phase 2a's DOM boxes, blacks/blurs them on the captured screenshot, re-encodes PNG. Also strips flagged values from the DOM JSON before it's sent anywhere.
**Interface it produces:** `redact(screenshotBase64, visionBoxes, domNodes) → { redactedImage: base64, redactedRegions: [{type, bbox}] }` — the `redactedRegions` array is what Phase 2c's prompt tells the VLM to ignore.

#### Phase 2b RESULT — recorded 2026-09-10. Checkpoint PASSED (28/28, verified by orchestrator).

**🔴 RULING 1 — BBOX UNIT SPACE. This is the highest-risk silent failure in the project.**
Vision boxes are in **screenshot pixels**. `getBoundingClientRect()` returns **CSS pixels**. On any HiDPI display these differ by `devicePixelRatio`, and every symptom of getting it wrong looks like success: redaction rectangles land near — not on — the password field, and `find_pii_leaks()` strategy 2 (bbox overlap) silently stops correlating.

> **Phase 4 owns ONE normalization point.** Convert every CSS-pixel bbox to screenshot-pixel space by `devicePixelRatio` BEFORE building the payload or calling `redact()`. Phase 2a and Phase 3 emit raw CSS pixels (natural from `getBoundingClientRect()`); Phase 2b already takes an injectable `scaleFactor`. Do NOT scale in two places — double-scaling is as broken as not scaling, and equally silent.

Everything crossing a module boundary — `domSnapshot.bbox`, `redactedRegions.bbox`, vision boxes — must be in screenshot-pixel space by the time it reaches `server/`.

**🔴 RULING 2 — VISION-BOX FILTERING BELONGS TO PHASE 4.**
`redaction.js` redacts every box it is handed, unconditionally — correct, that keeps the module dumb and testable. But Phase 0's detector is general COCO-80, not PII-specific. Handing it every detection blacks out couches and remotes and destroys the screenshot.

> **Phase 4 must filter vision boxes to a privacy-relevant subset before calling `redact()`.** Starting set: `person` (faces), `tv`/`tvmonitor`, `laptop`, `cell phone`, `book` (document/card proxies). Map through `id2label` — never literal-match class names across models (see the Phase 0 class-name trap).

**⚠️ DEMO RISK, act on this when building the demo page:** COCO-80 has no "ID card" class. A plain ID-card graphic may be detected as nothing at all, and the vision half of the demo would show zero redactions. **Put a human face on the mock ID card** — `person` is the class `yolos-tiny` detects most reliably, so the card gets redacted via a detection that actually fires.

**Other notes:** solid black fill (deterministic and verifiable; `fillStyle` is injectable if blur is wanted later). `redact()`'s `domNodes` param is Phase 2a's *flagged* node list; `sanitizeDomSnapshot()` separately handles the *full* snapshot — Section 4 conflated these under one name and splitting them was correct. `@napi-rs/canvas` is a **devDependency only**; the production module injects its canvas and imports nothing. The 2 high-severity `npm audit` advisories are pre-existing, inherited from `@huggingface/transformers` → `sharp`.

### Phase 2c — `server-api`
FastAPI `/analyze` endpoint, Pydantic schemas, Ollama integration (`qwen2.5vl:7b` for dev — chosen because it returns real bounding-box JSON and is built for agentic/grounding tasks, not just image description; swap to a cloud VLM for the finale per the problem statement's explicit allowance, same endpoint).
**Interface it produces:**
```json
// request
{ "image": "base64", "domSnapshot": [...], "redactedRegions": [...], "taskGoal": "string" }
// response
{ "action": "click" | "type" | "scroll" | "done", "targetId": "agent-1", "value": "optional" }
```
This module needs nothing from 2a/2b/1 except their *contracts* — build and test it standalone against a hand-written fixture payload.

#### Phase 2c RESULT — recorded 2026-09-10. Checkpoint PASSED (verified: 43/43 tests + live curl by orchestrator).

**Contract decisions (Section 7 rule 5) — binding on all downstream phases:**

1. **`domSnapshot` element shape** — was unspecified (`[...]`). Now **provisional**:
   ```
   DomNode { agentId, tag, role, type, text, bbox:{x,y,w,h}, sensitive }
   ```
   Phase 2a (`dom-pii-scanner`) is the AUTHORITY. When 2a lands, reconcile — if it differs, fix it here, don't patch downstream.
2. **`RedactedRegion` gains an optional `agentId`** — enables two-way domSnapshot↔redactedRegions correlation. bbox-overlap remains the fallback for vision-only regions with no DOM node.
3. **`targetId` is required even for `scroll`/`done`** — use the named constant sentinel `"page"`. Phase 3 must use the constant, not re-derive the string.
4. **Status codes:** `400` + `errorCode: "PII_LEAK_DETECTED"` for a Section 5 leak; `422` for ordinary schema violations. A client bug that leaks PII must be separately monitorable by Phase 4 instrumentation without string-matching prose.
5. **PII `type` is a closed enum** — `password, cc-number, current-password, email, tel, aadhaar, pan` + an explicit `other` escape hatch. An unanticipated PII type degrades to flagged-but-unclassified; it is NEVER silently dropped. False negatives on PII are the dangerous direction.

**⚠️ SECURITY DEFECT FOUND IN VERIFICATION — RESOLVED & VERIFIED (65/65 tests + live curl, sentinel absent from response bytes). Its lesson applies to every module, not just 2c.**
The PII-leak rejection originally echoed the offending payload back in its own error body (Pydantic embeds the raw request under `input`), so the endpoint that refuses leaked PII reflected `"text":"hunter2"` to the caller and into logs. The test suite was green because every assertion checked only *that* the request was rejected — none checked what the rejection *contained*.

**Rule for all phases: an error path is a data egress path.** Assert on the serialized bytes of error responses and log lines, not just on status codes. Section 5's invariant binds failure paths exactly as much as success paths.

### Phase 3 — `action-executor`

#### Phase 3 RESULT — recorded 2026-09-10. Checkpoint PASSED (30/30, verified by orchestrator).

**SAFETY POLICY RULING — sensitive-element targeting is FAIL-CLOSED. Binding.**
`click` and `type` on any element flagged sensitive are BLOCKED (`SENSITIVE_TARGET_BLOCKED`). `scroll`/`done` are ungated (they neither write to nor trigger a specific element). Override hooks (`allowSensitiveTargets`, `onSensitiveTarget`) exist but **Phase 4 must NOT enable them for the demo**.
Rationale: an agent typing into a password field is the exact failure this project exists to prevent; Phase 2c's VLM client already skips sensitive nodes when selecting targets, so fail-closed keeps the system self-consistent end to end; and blocking is the reversible failure mode — a blocked action is a log line, a typed password is a leaked credential.
**Phase 4 wiring requirement:** set `data-agent-sensitive="true"` from Phase 2a's merged `sensitiveNodes`, or pass `options.sensitiveAgentIds`. Without that wiring the guard has nothing to act on and silently protects nothing.

**Phase 4 integration notes:**
- `action-executor.js` uses NO `import`/`export` — it attaches to `globalThis.ActionExecutor`, matching `content.js`'s classic-script loading. Add `"lib/action-executor.js"` BEFORE `content.js` in the manifest's `content_scripts.js` array.
- `PAGE_TARGET_ID = "page"` is mirrored in JS; it cannot be imported across languages from `server/schemas.py`. If that constant ever changes, both sides must change together.
- `domSnapshot` matches `DomNode` field-for-field — the provisional schema held against a real DOM. `sensitive` is always `false` from this module by design; Phase 4 merges 2a's classification in.
- `type` uses the prototype-walking native value setter plus `input`/`change` dispatch, so React-style controlled inputs actually observe the change.
- ID stability: `data-agent-id` is read back from the DOM as the source of truth (not a side cache), and new elements get IDs above the current max, so re-scans never collide.
Content-script side of the loop: assigns `data-agent-id` to actionable elements (Set-of-Mark grounding — the model refers to elements by stable ID, not fragile pixel coordinates), receives Phase 2c's action JSON, dispatches the real DOM event.

### PROFILE AUTOFILL — `fill_profile` + the vault. Feature built 2026-09-14; **leak found and fixed 2026-09-17**. **663 tests green** (466 JS + 197 server). ✅ **BOTH HALVES BROWSER-VERIFIED.**

*Recorded late: the feature shipped in commit `d73f53e` with no entry here, no README mention, and no demo scenario. It was found undocumented three days later while auditing project state — which is also how the leak below was found. A feature that isn't in the decision record doesn't get reviewed against the decision record.*

**THE FEATURE.** "Fill all my details" previously could not work: the agent only knew what the task goal contained, and typing into an email field is exactly what `guardSensitive()` refuses — because the MODEL chose the value and the model is untrusted. The resolution is that the model never supplies the value. It names a CATEGORY; the extension fills from a local vault:
```
model:      { action: "fill_profile", targetId: "agent-7", profileField: "email", value: null }
extension:  look up "email" in chrome.storage.local -> type it
```
Enforced structurally, not by convention, on both sides: server-side `ModelSuppliedProfileValue` takes ZERO constructor arguments so no caller can pass the offending value in even by accident; client-side `dispatchFillProfile()` has no `value` parameter at all, so it cannot use a model-supplied one because it never receives one. A `fill_profile` carrying a non-null value is rejected outright (misbehaving model, or a prompt-injected page smuggling data) with its own error code and no echo. `ProfileField` is a CLOSED enum with no escape hatch — deliberately unlike `PiiType`, which degrades-and-flags because false negatives there are dangerous; a profile category only names where to look, so an unrecognised one must hard-reject. `MockVLMClient` emits `fill_profile` for empty email/tel/name-shaped fields, so the whole path demos with no API key.

**🔴 THE LEAK — confirmed in a browser, then fixed. The guard carve-out was sound; the NEXT step was not.**

The carve-out exempts `fill_profile` from `guardSensitive()`, correctly: there is no model-chosen value to protect against. But the vault value is now *in the live DOM*. On the next loop iteration `getAccessibleText()` returns an input's `.value` (`action-executor.js:391`), so it came back as `DomNode.text`. dom-scanner's value regexes catch a vault EMAIL and a vault PHONE, so `sanitizeDomSnapshot()` stripped those. **A name has no regex signature, and Phase 2a deliberately does not flag name fields — so `full_name` alone survived into the outgoing payload.**

Measured across all three categories against the real modules:
```
full_name  flagged=false  -> LEAKS
email      flagged=true   -> contained
phone      flagged=true   -> contained
```
Browser-confirmed before the fix, mock backend, real demo page. Step 2's payload **as received by the server**:
```
agent-4 | input text     | sensitive=False | text='<the vault name>'   <-- transmitted
agent-1 | input password | sensitive=True  | text=None                 <-- correctly stripped
```
In that run the exposure lasted one step only because the mock happened to `type` into the same field next, which put it in `actedAgentIds`. **A backend that moves to a different field would leave the name in every remaining payload of the run.**

**WHY TWO SAFEGUARDS MISSED IT INDEPENDENTLY — the reusable lesson.**
1. `actedAgentIds` (`content.js:1985`) filters acted-on nodes out of the next snapshot and would have hidden it — but its recording gate (`content.js:2447`) is `action === "type" || action === "click"`. `fill_profile` was added later and never added to that gate. **Any new action type must be evaluated against every existing gate that enumerates action types.**
2. The containment test (`test_profile_vault.mjs`) re-scanned after the write and asserted on payload bytes — genuinely careful — but its fixture was an `autocomplete="email"` field AND it **HARDCODED `sensitive: true`** at the merge step instead of running the real scanner. Everything it proved was downstream of a flag `full_name` never gets. **A test that hardcodes the classification it is supposed to be exercising proves only the plumbing below that point.** The suite covered the two categories an existing mechanism already protected and skipped the one that needed protecting.

**🔴 THE FIX — ORCHESTRATOR RULING. A vault-filled node is exactly as sensitive as a page-sourced PII node, for the remainder of the run.**
`buildProfileVaultSensitiveNodes()` (`profile-vault.js`, pure and independently testable per Section 5) synthesizes dom-scanner's own `{selector, bbox, piiType, agentId}` shape and is concatenated into `allSensitiveNodes` (`content.js:1995`). **One insertion point closes both halves**, because that single list already feeds `redactionInputNodes` → `redact()` (image blackout) *and* `sensitiveByAgentId` → `sanitizeDomSnapshot()` (text strip), with zero changes to either consumer. bbox is measured **fresh every step** — the page scrolls between steps, and a cached bbox would black out the wrong region, which is a leak that looks like success. Dedupes against agentIds the scanner already flagged; skips ids no longer resolvable in `idMap`.
`profileField` → `piiType`: `email`→`email`, `phone`→`tel`, `full_name`→`other` (Phase 2c ruling 5's deliberate escape hatch; `PiiType` is closed and a new member would be a hard 422).

> **Deliberately NOT folded into `actedAgentIds`, and do not "simplify" it later by doing so.** That would drop the node from the DOM JSON — closing the payload half — while leaving the vault value plainly readable in the SCREENSHOT on every subsequent step. Dropping a node from `domSnapshot` has no effect whatsoever on what gets drawn from `allSensitiveNodes`/`redactionInputNodes` into the image. It is half a fix that tests green.

`assertNoRawPii()` now receives `allSensitiveNodes` rather than `sensitiveNodes` — a strict tightening (`content.js:1410`'s `if (!el) continue` means a superset can only catch more, never throw spuriously on unresolvable subframe nodes).

**✅ BROWSER-VERIFIED AFTER THE FIX — both halves, same page, same backend.**
- **Wire:** the sentinel vault value appears in **zero** payloads. `agent-4` goes `sensitive=True`, `text=None`, with region `('other','agent-4','dom')` appearing the moment it is filled.
- **Image:** the field is a solid black bar in the transmitted PNG. **The image half of this feature's claim had never been tested before this run** — and it is the half a payload assertion structurally cannot see (the same blind spot that let the Tier 1 iframe bug ship).

**SCOPE — stated rather than implied.** This covers *vault-sourced* names. **Page-sourced names remain unredacted** — the demo ID card's "Jordan A. Demo" is plainly readable in the verified screenshot. That is Phase 2a's existing deliberate ruling (flagging generic name tokens would redact most of a form and leave the agent unable to operate), unchanged here. The same property that makes names unflaggable is what caused this bug; the fix works because vault provenance is *known*, not because names became detectable.

**KNOWN GAP, not fixed:** a `fill_profile` relayed into a **subframe** (agentId shaped `agent-fN-…`) never resolves through the top-frame `idMap`, so it would accumulate an unresolvable entry each step — harmlessly skipped by the existing `if (!el)` guard, matching the subframe-agentId pattern elsewhere in `content.js`, but untested. The confirmed leak was top-frame; scope was deliberately not expanded.

### CROSS-SITE HARDENING + POPUP RE-THEME. Recorded 2026-09-19. **693 tests green** (486 JS + 207 server).

**Popup now shares the site's visual system.** The glassmorphism pass (orbs, `backdrop-filter`, bronze accents) is gone; the popup is flat monochrome with sharp rectangles, thin rules, self-hosted Inter and the same glitching wordmark the hero carries. A popup that looks like a different product than the site is a product with two identities. Verified: every id `popup.js` reaches for still resolves, zero `backdrop-filter`, zero border-radius anywhere, and all 15 text roles pass AA against their real composited backgrounds.

**Three real-site capability gaps closed.** Every browser verification in this project has run against `demo/test-page.html` — five actionable elements, a document that scrolls, no rich-text editor anywhere. These are the three places that gap actually bites:

1. **🔴 Rich-text editors were being written to in a way real editors ignore.** `el.textContent = text` is fine for a bare contenteditable and wrong for Gmail, Slack, Notion, and anything on ProseMirror/Quill/Draft.js — those keep their own document model and reconcile the DOM from it, so a textContent write is either ignored or wiped on the next render, having destroyed the nodes the model pointed at. Now fires a cancelable `beforeinput` with `inputType: "insertText"` first; **if the editor cancels, we stop and write nothing**, because a cancel means the editor has taken responsibility. Otherwise `execCommand("insertText")`, then textContent as a last resort. The result reports which path applied.
   Also: `el.isContentEditable` alone is not a safe test — jsdom does not implement it (so every editor test silently took the `<input>` path), and in a browser it is *also* true for elements that merely inherit editability. `isEditableHost()` checks the property first, then the element's own attribute. And `ACTIONABLE_SELECTOR` matched only `[contenteditable="true"]`, so bare `contenteditable` and `plaintext-only` composers were **invisible to grounding entirely** — the agent could not target them at all, which reads to a user as "it ignored the message box".

2. **🔴 `<select>` silently selected nothing.** A model naming a dropdown names what a human reads — the label ("India"), not the value ("IN"). Pushing the label through the value setter matched nothing and left the control on its default **while reporting `ok: true`**. Now matches label, then value, then a trimmed case-insensitive pass, and throws `SELECT_OPTION_NOT_FOUND` on a miss rather than pretending.

3. **🔴 `scroll` did nothing on any app that scrolls an inner container.** `window.scrollBy()` assumes the document is the scroller. Gmail, feed-style timelines, most dashboards and every modal put `overflow:auto` on an inner div and fix the body height — scrolling the window there is a no-op, and the old code returned `ok: true` for it, so the agent would "scroll" repeatedly, see an unchanged page, and burn its whole step budget. Now falls back to the largest genuinely-scrollable element, and reports `scrolledContainer` so a run summary distinguishes "an inner container moved" from "the page moved" — that ambiguity is precisely what made this invisible.
   Scroll metrics are read through an **injectable hook** because jsdom performs no layout (`scrollHeight`/`clientHeight` are always 0), so the selection logic would otherwise be untestable.

4. **SPA route changes stranded `actedAgentIds`.** A full page load tears down the content script and the run with it, so that case needs nothing. A `pushState` route change does not: the script survives, the loop continues, and every recorded agentId now refers to an element on a page that no longer exists — those stale ids keep filtering the **new** page's snapshot, so the agent cannot see elements it has never acted on. On a single-page app that is most of the site. `actedAgentIds` and `filledProfileAgentIds` now reset on a detected href change, and the step logs it.

**Still true and unchanged: none of this has been run against a real website.** These are the fixes the demo fixture could never have surfaced, written against the failure modes real sites are known to have — but the observe-only backend exists precisely so that run can happen safely, and it still has not. Do not let this entry read as if it had.

### ACTION SURFACE BROADENED — `press_key`, in-view targeting, toggle state. Recorded 2026-09-19. **717 tests green** (497 JS + 220 server).

**🔴 NEW ACTION: `press_key`.** A large share of the real web is only reachable from the keyboard — search boxes that commit on Enter with no visible submit button, modals and autocomplete popups that close on Escape, comboboxes driven by arrow keys. With `click`/`type` alone the agent fills a search field and then has nothing to press.

`PressKey` is a **closed enum** (`Enter, Escape, Tab, Backspace, Arrow{Up,Down,Left,Right}`) and deliberately contains **no printable characters** — entering text is `type`'s job and goes through the guards, so a pressable letter would be a way to type that skips them. The extension dispatches synthetic keyboard events into whatever page is loaded; what it can trigger should be enumerable by reading the enum, not "whatever string the model emitted".

`key` is **required exactly when `action == "press_key"` and forbidden otherwise**, mirroring `profileField`'s shape for `fill_profile` — a misplaced `key` is an ordinary contract violation (plain `ValueError` → the existing generic 502), not a privacy event, since a keystroke name is not data. **`press_key` runs through `guardSensitive()`/`guardIrreversible()` exactly like click and type** — an action that could reach a password field while skipping the guards would have been a hole, not a feature.

**Off-screen targets are now scrolled into view before click/type.** A synthetic click on an off-screen element dispatches, but on real sites that is often not enough: virtualised lists (feeds, long tables, data grids) only mount rows near the viewport, and IntersectionObserver-gated widgets have not initialised their handlers yet — the click lands on a placeholder. Best-effort and never fatal: an element that cannot be scrolled to is still worth clicking.

**🔴 `click` on a toggle now reports the RESULTING state.** `click` toggles, it does not set. Told to "accept the terms" on an already-ticked box the agent un-ticks it — and the old result said `ok: true` either way, so neither the loop nor the run summary could tell. Now reports `checked` for `input[type=checkbox|radio]` and for `role=checkbox|radio|switch` via `aria-checked` (null when the page exposes no state, rather than guessing).

**Drift guards fired and were updated, not loosened.** Three tests assert the response's exact key set and exact action enum; all three failed on this change, which is them doing their job. Each was updated to the new exact set — still an equality assertion, never a superset check — so the next contract change is equally impossible to land silently.

**Live-verified against the running server**, not only in unit tests: `/analyze` now returns `key` on every response, `{press_key, key:"Enter"}` validates, and all three violations (missing key, `F12`, `key` on a `click`) are rejected.

### ⚠️ STILL OPEN — capture can return a stale frame. **REPRODUCED 2026-09-20** and caught automatically by the detector; mechanism still NOT established (rate-limiting is now RULED OUT — see the reproduction entry below). Detected and fail-closed as of 2026-09-19.

Two consecutive steps produced **byte-identical screenshots** while the page had scrolled 2,613 px between them (`agent-1` bbox y: `1161.0` → `-1452.0`). Step 2's redaction rectangles were therefore computed against the scrolled DOM and drawn on the *unscrolled* image, at negative y — off-image, redacting nothing.

**No exposure in that run:** at scroll 0 the sensitive fields sat at y≥1161 in a 972 px-tall viewport, below the fold, so the stale image did not contain them. That is luck, not design.

**Asymmetry worth noting:** ~~the loop's viewport-only capture (`background.js:788`, `handleCaptureAndDetect`) is a bare `captureVisibleTab` with **no proactive throttle and no rate-limit retry**. The full-page path — which ships OFF by default — has both (550 ms minimum spacing, 3× retry on `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND`).~~ **CLOSED 2026-09-19** — both paths now share `captureVisibleTabWithRetry()` and `capture-plan.js`'s `computeThrottleDelay()`. The observation that prompted it stands: *the hardening went to the experimental path, not the one everything actually runs on.*

**Did NOT reproduce** on a later run at 1920×970 (three distinct hashes); it was observed only at a 265 px-wide window, where the page reflowed to ~3,000 px tall. Nothing was changed, so this is *unobserved*, not fixed. The captures were 761 ms apart — inside what the full-page path's own 550 ms constant assumes is safe — so "Chrome rate-limited it" does not obviously fit. **Whoever picks this up: hash consecutive captures in every browser run; that is how it was caught.**

### STALE CAPTURE — DETECTED AND FAIL-CLOSED. Recorded 2026-09-19. **732 tests green** (512 JS + 220 server). **The mechanism is still not established and this does not claim to fix it.**

The bug above was found by hand-diffing dumped PNGs. That is now automatic. `lib/capture-hash.js` (pure, 15 tests, includes a fixture carrying the 2026-09-17 observation's exact numbers — scrollY 1161 → -1452, delta -2613).

**🔴 RULING A — what counts as "stale". Get this wrong and it becomes a false-positive machine.**
> **stale = consecutive captures byte-identical AND the page's scroll position changed between them.**

Byte-identical consecutive captures are the **normal, correct** case on a static page that did not scroll — flagging that alone would make every quiet step on every static page a false alarm. Scroll movement alone says nothing about what was transmitted. Requiring both is the exact narrow signature the observation exhibited, and a static page produces zero false positives by construction.

**🔴 RULING B — `background.js` hashes, `content.js` decides.** SHA-256 via `crypto.subtle` over the decoded bytes (exact; a cheap non-crypto hash is the wrong trade for the one check whose entire job is proving two images are or are not byte-identical). Background owns the bytes, so nothing crosses the message boundary twice; `content.js` is the only context that also knows `scrollY`. It returns `screenshotHash` on `CAPTURE_AND_DETECT_RESULT`.

**🔴 RULING C — fail closed on the STEP, not the RUN.** A positive verdict means this step's image shows the wrong viewport for the redaction rectangles about to be computed against this step's scrolled DOM — transmitting it sends whatever was on screen at the old position, unredacted, dressed up as redacted. The step aborts **before redact** (stronger than before-send), mirroring `assertNoRawPii()`'s fail-closed idiom, with **`continue`, never `break`**.
> Aborting the whole run would be a NEW failure mode built on a bug whose mechanism nobody has explained. One step out of `MAX_STEPS = 25` is cheap; an unredacted viewport is the entire thesis.

**Reported unconditionally, including at zero** — `screenshotHash` and `throttleWaitMs` on every step's `capture` instrumentation, `staleCaptureCount`/`staleCaptures` in the RUN SUMMARY. Same posture `fullPage` and `rank` already set: a run with zero stale captures must *say* zero, not omit the field.

**Why `throttleWaitMs` is reported and not just computed:** a stale-capture skip `continue`s immediately, so the next capture lands inside the new 550 ms floor. The throttle fires *precisely* in the scenario this change instruments, and an unreported wait would surface only as unattributable end-to-end latency. `tCapture0` is taken **after** the wait, so `captureMs` still measures only the capture — do not "simplify" that.

**Scoped OUT: full-page capture mode.** It never populates a hash, and `detectStaleCapture()` treats a missing hash as "no verdict" — which scopes the check out without a separate branch. That mode restores scroll to its pre-capture position before the scan runs, so a single `scrollY` reading there would not mean what this check needs it to mean.

**NOT verified without a browser** — *(written 2026-09-19; three of these four were closed by the reproduction recorded below the next day — left here as written rather than edited after the fact)*:
- that `crypto.subtle`/`atob` behave identically inside the real MV3 service worker (only Node-verified; the `crypto.subtle` call site is new),
- that `content.js`'s dynamic `import()` of `capture-hash.js` resolves under the real extension loader (jsdom cannot exercise `chrome.runtime.getURL` or `web_accessible_resources` at all),
- that the detector ever fires against a **real** reproduction — only Ruling A's discriminator is proven, against fixtures,
- **whether inserting an `await crypto.subtle.digest(...)` between capture and detect perturbs the timing of a race nobody has explained.** Stated because the mechanism is unknown: this change could in principle mask or unmask the original bug.

#### ✅ REPRODUCED AND CAUGHT IN-BROWSER — 2026-09-20. The detector's first real outing.

Mock backend, `demo/test-page.html` at a **~265 px-wide window**, goal `Fill the name as River Jane and email id as riverjane33@demo.com`. Run completed `outcome: "done"`, 4 steps, 11,635 ms.

```
step 1 :: capture        screenshotHash 832450c5…296eb0   throttleWaitMs 0
step 1 :: act            fill_profile agent-4  → page scrolls 0 → 573.6 px
step 2 :: capture        screenshotHash 832450c5…296eb0   ← BYTE-IDENTICAL
step 2 :: stale-capture  stale: true, scrollDelta 573.6px → SEND REFUSED
step 3, 4                distinct hashes, sent normally, run completed
staleCaptureCount: 1
```

**Everything Rulings A/B/C specified behaved as designed in a real browser:** it fired exactly once, on the real thing; it did not fire on the three steps that were genuinely fine; the step refused to send *before redact*; and the run continued to a clean `done` rather than aborting.

**🔴 RATE-LIMITING IS RULED OUT.** `throttleWaitMs: 0` and the two captures were **~2.9 s apart** — far outside Chrome's ~2/sec limit, and far outside the full-page path's own 550 ms constant. The 2026-09-17 note that *"Chrome rate-limited it does not obviously fit"* is now confirmed: it doesn't fit at all. The throttle/retry parity was still correct to close, but it is **not** the cause and must not be recorded as the fix.

**🔴 THE TRIGGER IS `scrollIntoView` FROM THE ACTION SURFACE.** Step 1's `fill_profile` scrolled the page 573.6 px to reach an off-screen field — the "off-screen targets are now scrolled into view before click/type" behaviour added 2026-09-19. That change did not *create* this bug; it made it **reachable on a page that previously never scrolled mid-run**, which is why every earlier multi-step run on this same page missed it.

**MECHANISM — HYPOTHESIS ONLY, NOT ESTABLISHED. Do not record this as a cause.** ⚠️ **AND IT DID NOT SURVIVE THE SAME DAY — see "RULING A WAS TOO NARROW" directly below.** Left here as written rather than deleted, because the reasoning that produced it is the reasoning that got corrected.
2.9 s is far too long for an ordinary in-flight-repaint race. The remaining explanation consistent with the data is that the tab **was not compositing at all** — a narrow, partially-occluded window with devtools focused — so `captureVisibleTab` returned the last frame actually painted. This would also explain the shape of the original observation: reproduced at 265 px, never at 1920×970. **Unverified.** Whoever takes this further: vary occlusion/focus/window state deliberately and watch `staleCaptureCount`, which now makes that a cheap experiment instead of a PNG-diffing exercise.

**Verified in-browser by this run, closing three of the four "not verified without a browser" items above:** `crypto.subtle` works in the real MV3 service worker (real SHA-256 digests returned); `content.js`'s dynamic `import()` of `capture-hash.js` resolves under the real extension loader; and the unconditional reporting renders as designed. Only "does an extra `await` between capture and detect perturb the race" remains open — and the bug reproduced *with* that await in place, so it plainly does not mask it.

**Side confirmations from the same run:** `sensitiveNodes` went 4 → 5 after the `fill_profile`, i.e. `buildProfileVaultSensitiveNodes()` working in a browser. And `framesReported: 0` on this iframe-free page — the `framesReported: 1, framesMerged: 0, framesDropped: 1` seen in an immediately prior run was a **stale `tabId→frameId` registry entry surviving from the previous session**, cleared by the extension reload. It failed safe (defensive whole-iframe redaction fired), but it is the phantom-frame shape the 2026-09-14 fix was supposed to have closed — **watch for it; it is not confirmed gone.**

**⚠️ UNEXPLAINED — inference ran 2,650 ms / 2,692 ms against the recorded 780–880 ms baseline**, warm (`pipelineWasAlreadyLoaded: true`, `device: webgpu`), two consistent samples. An immediately prior run measured 4,570 ms, so there is a warm-up component, but it settles ~3× above baseline, not at it. Both runs were at the 265 px window, so image shape is the obvious suspect and the baseline was a normal viewport — **suspected, not established.** Re-measure at a normal window before quoting either number.

#### 🔴 RULING A WAS TOO NARROW — a stale frame got through undetected. Found 2026-09-20, same sitting.

A third run, **maximised window**, on the same page. Hashes across all three runs that day:
```
11:25  narrow window      step 1   832450c5…296eb0
11:41  narrow window      step 1   832450c5…296eb0   ← correctly flagged stale at step 2
12:38  MAXIMISED window   step 1   8f53565f…389593   ← fresh and correct
12:38  MAXIMISED window   step 2   832450c5…296eb0   ← the NARROW-window frame, ~57 min old
```
A maximised viewport and a ~265 px viewport **cannot** produce byte-identical PNGs. `captureVisibleTab` served a cached frame from a previous window size, and the frame was transmitted.

**`staleCaptureCount: 0` on that run is a FALSE NEGATIVE.** Ruling A compares only against the *immediately previous* capture: `8f53565f != 832450c5`, so no verdict. The discriminator catches "the same frame twice in a row" and is blind to "an older frame resurfacing after a correct one."

**This is an orchestrator error, not an implementation defect** — Ruling A was specified too narrowly and the module implements it exactly as written.

**⚠️ THE COMPOSITOR HYPOTHESIS RECORDED ABOVE NO LONGER FITS.** "The tab was not compositing" does not explain step 1 receiving a correct fresh maximised frame and step 2 then receiving an hour-old one. The honest position: the mechanism is stranger than characterised and is **still not established.** It is deliberately NOT replaced with a new theory here.

**RULING A′ — two independent checks.** ✅ **BUILT AND VERIFIED MECHANICALLY 2026-09-20 — 749 tests green (529 JS + 220 server). NOT yet browser-verified.** Includes a regression test for the real miss above: the hash rule passes it clean, the dimension rule catches it.
1. **Dimension check, primary and definitive:** the captured PNG's pixel dimensions must match the current viewport × `devicePixelRatio`. A frame from any other window state fails outright, with no history needed. Dimensions are read from the PNG **IHDR header** (fixed byte offsets 16–23), not by decoding — pure, synchronous, no canvas. **A ±2 px tolerance is mandatory:** `devicePixelRatio` is commonly fractional on Windows (1.25/1.5/1.75 under display scaling), so exact equality would fire on every step on most machines.
2. **Hash recurrence across the whole run, secondary:** extends the comparison from "the previous capture" to "any capture earlier in this run", keyed `hash → scrollY-when-first-seen`. A hash recurring at the *same* scrollY is still the normal static-page case and must not flag.

Both are scoped OUT of full-page mode — the dimension check by an **explicit branch**, not by absent data, since a stitched image is document-sized by construction and would fail it every step. The RUN SUMMARY reports **which** check fired; a merged boolean would discard exactly the signal that made this blind spot visible.

**🔴 THE ±2 px TOLERANCE HAS NEVER MET REAL HARDWARE, AND ITS FAILURE MODE IS TOTAL.** If it is wrong for the display scaling in use, `detectDimensionMismatch()` fires on every step, every step fails closed, and **the agent does nothing at all** while the run summary reports a list of skips. That is the correct direction to fail — loud, not silent — but it must be recognised on sight rather than read as a broken extension.
> Which is why `expectedWidthPx`, `screenshotWidthPx` and `devicePixelRatio` are recorded on **every** step's `capture` entry, firing or not, from a **single hoisted computation the verdict itself reuses** (so the reported numbers cannot drift from the checked ones). A passing step must show its margin. This is the third time in this work that a value was computed and discarded unless it fired — see `throttleWaitMs` above. **Watch for that shape.**

**The next browser run is this ruling's verification.** Re-run the same scenario (`demo/test-page.html`, the profile-autofill goal, mock backend). A `staleCaptureCount` of 0 is only meaningful now *because* the margin is visible on passing steps.

#### ⚠️ THE PUBLISHED LATENCY FIGURE DOES NOT REPRODUCE. Found 2026-09-20. **Not yet resolved.**

**`~780–880 ms` warm object detection is published in `README.md` twice (including the rubric table) and in `site/index.html` twice.** Six warm samples taken across three runs on 2026-09-20 all landed near **2,700 ms** — roughly 3× the published figure:

| Run | Window | Warm inference |
|---|---|---|
| 11:41 | ~265 px | 2,650 / 2,692 ms |
| 12:38 | maximised | 2,700 ms (+ ~2.6 s on the following step) |

**Window size is ruled out** — the first two runs were narrow, the third maximised, and all agree. The earlier 4,570 ms sample shows a warm-up component on top, but it settles at ~2,700 ms, not at ~800 ms.

Not investigated, and all plausible: GPU/thermal state, laptop power mode, a Chrome update since 2026-09-11, or machine load. The 780–880 ms figure came from 4 samples on a single day.

**Measured under uncontrolled conditions** (devtools open, other apps unknown) — so this does not yet *disprove* the published number, it means **the published number is currently unsupported by the most recent measurements.** Before any submission: re-measure warm inference under controlled conditions, then either correct both documents or qualify the claim with the conditions it holds under. Per this project's own standard on overstated documentation — *do not ship a figure a fifteen-minute test contradicts.*

*(Step 1 of the 12:38 run measured 18,430 ms with `pipelineWasAlreadyLoaded: true` and `model-load: 0 ms` — that is the already-documented cold-start-after-SW-eviction cost, not part of this finding.)*

### FULL-PAGE SCROLL-AND-STITCH CAPTURE. Recorded 2026-09-13. **526 tests green** (378 JS + 148 server). **Ships OFF by default.**

Setting: `chrome.storage.local["fullPageCapture"]`, boolean, **default `false`** — viewport-only remains the known-good path. Capture sits upstream of detection, redaction and grounding, so a regression there breaks everything at once; the default must stay the proven route.

**🔴 THE TRANSFORM ORDER IS NOW THREE DEEP. Each applied exactly once, in this order:**
1. **Frame offset** (`frame-coords.js`) — subframe-local → top-frame viewport-relative.
2. **Document offset** (NEW, `capture-plan.js`) — viewport-relative → document-relative. `getBoundingClientRect()` is viewport-relative; a stitched image is document-relative. The offset is read **once**, immediately after the synchronous DOM scan, stored, and threaded as a plain value — never re-read, so it cannot drift as the page scrolls during capture.
3. **devicePixelRatio** — applied last, uniformly.

Vision boxes are **excluded** from step 2 — they come back already document-relative by construction. In viewport-only mode step 2 applies `NO_DOCUMENT_OFFSET` `{x:0,y:0}` unconditionally, so the feature is a mathematical no-op when disabled rather than a branch that could diverge.
`addDocumentOffset` **throws** on a missing or non-finite offset rather than defaulting to zero. A wrong bbox is a leak that looks like success.
Tests include an explicit double-application case asserting the numeric fingerprint of that bug (off by exactly one extra scrollOffset), plus an order test proving offset-before-DPR ≠ DPR-before-offset.

**Fixed/sticky elements** would otherwise repeat in every slice. They are hidden with `visibility:hidden` (NOT `display:none`, which would change `scrollHeight` mid-capture) for the whole capture pass and restored in `finally`. **They are still fully scanned** — the hide/restore window closes before the SCAN step runs, so `dom-scanner` and `action-executor` see a completely normal DOM. Limitation: top-frame light DOM only, not inside iframes or shadow roots.

**Throttling:** 550ms minimum between captures (>10% margin over Chrome's ~2/sec limit), plus a reactive 3× retry on `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND`.
**Lazy-load:** document height is re-measured every iteration; growth is followed but the cap is never exceeded — proven against a simulated infinite-scroll page that doubles height 20×.
**Cap:** 5 viewports. Truncation is reported in every RUN SUMMARY under `fullPage` (`viewportsCaptured`/`viewportsNeeded`/`truncated`), unconditionally — silent truncation reads as "we saw everything" when we didn't.

**⚠️ LATENCY AND MEMORY ARE UNMEASURED.** The agent's Playwright harness could not exercise the real capture path — opening `popup.html` as a bare tab does not grant `activeTab`, which only a genuine toolbar-icon click provides. **It declined to fabricate numbers**, correctly. Varun measures this by toggling the setting and comparing `inference.durationMs` between runs. A stitched image is several times larger; if detection degrades badly from the ~780–880ms viewport baseline, the hybrid approach becomes the better answer.

**A bug it caught in its own draft:** scroll restoration sat *after* an inner `try/finally`, so an exception inside the capture loop would have left the user's page scrolled elsewhere. Moved into an outer `finally`.

### TIER 4 — PRODUCT SURFACE. Recorded 2026-09-12. **480 tests green** (332 JS + 148 server).

The extension was autonomous, `MAX_STEPS: 25`, injecting on `<all_urls>`, dispatching real clicks — **with no way to stop it.** That was the most important missing control, ahead of any polish.

**STOP — two independent abort paths, because they live in different execution contexts:**
- *Fetch* (`background.js`): an `AbortController` per request, registered in a `tabId → controller` map BEFORE `fetch()`. Stop aborts it **synchronously, before** the relay message is even sent — so the request dies immediately rather than waiting on a round trip. Resolves as `{errorCode: "STOPPED"}`, which `isRetryableAnalyzeFailure` treats as non-retryable.
- *Backoff* (`content.js`): a run-scoped controller; `sleep()` races the timer against the abort event, so Stop doesn't ride out a 1–4s jittered delay.

Stop is checked at the top of each step, each retry attempt, after the backoff, after redact (pre-send), and immediately before dispatch — so **a click/type is never half-dispatched**. `try/finally` guarantees `outcome: "stopped"` is recorded on every exit path; that value is used nowhere else and can never be confused with `"done"` or `"stalled"`.

**Run state lives in `background.js`, mirrored to `chrome.storage.session`.** Reasoning: `content.js` executes the loop but the popup can't reach it; the popup is destroyed on blur so it can't hold state. `session` (not `local`) is memory-only for the browser session yet survives SW eviction — a fresh SW rehydrates on first query rather than starting blank. Feature-detected, degrading to in-memory on older Chrome.

**🔒 `action-describe.js` NEVER echoes the typed value.** The popup shows *"typed into Full name"*, not *"typed hunter2"*. Not requested — the agent applied the project's own principle to its UI layer, where a leak would be exactly as real as one on the wire.

**Error mapping** (`error-messages.js`): network failure → *"Server not reachable at <url> — is uvicorn running?"*; `VLM_BACKEND_CALL_FAILED` detects the embedded exception class and gives backend-specific text; `PII_LEAK_DETECTED` flagged as a server-side bug, not user-actionable.

**Server URL** is configurable and persisted, validated against `host_permissions` in BOTH the popup and defensively inside `handleAnalyze` — so a hand-edited storage value yields `SERVER_URL_NOT_PERMITTED`, never an opaque "Failed to fetch". A test reads the REAL `manifest.json` and asserts the patterns never drift from what the code validates against.

**🔴 ORCHESTRATOR RULING — `host_permissions` stays narrow (`localhost` / `127.0.0.1`).** A remote server is a legitimate want, but broadening host permissions is a security decision that must be explicit user opt-in, not a side effect of a settings field. If it's needed later, the right mechanism is `optional_host_permissions` with a runtime consent prompt — never a blanket widening.

### TIER 2 — `element-ranker.js` + `action-risk.js`. Recorded 2026-09-11. ✅ **BUILT, TESTED, AND WIRED.**

#### WIRING RESULT — 2026-09-11. 393 tests green (245 JS across 7 suites + 148 server).

**`element-ranker` → `content.js`**, new step 3.5: AFTER the sensitive-flag merge, BEFORE `scaleDomSnapshotBBoxes()`. Fed real `window.innerWidth/Height` (CSS px, matching the still-unscaled bboxes at that point). `dropped` is logged into a new `rank` instrumentation stage on EVERY step, even at zero — silent truncation reads as "covered everything" when it didn't.

**`action-risk` → `action-executor.js`**, inside `executeAction()`'s click/type branch: `guardSensitive()` then `guardIrreversible()`. The classifier is **injected via `options` from `content.js`** at both the top-frame and subframe-relay call sites — never hardcoded into `action-executor.js`, which has no import/export by design. When an element trips both guards, the `SENSITIVE_TARGET_BLOCKED` message absorbs the irreversible reasons; when it doesn't, the message is byte-for-byte identical to before, regression-tested.

**`MAX_STEPS = 6 → 25`** with a new pure `lib/stall-detector.js`. A realistic Indian-checkout flow (7 form fields + scroll + proceed-to-pay + 3 payment fields + place order + done) is ~14 steps, so 25 gives ~1.5× headroom without being unbounded. `detectStall()` catches a repeating unit of period 1 (3× back-to-back) or period 2–3 (2 full laps) — both "same action on same target" and "cycle with no progress". Records `outcome: "stalled"`, never confusable with `"done"`, and breaks immediately rather than skipping a step and continuing.

**🏆 A trap caught BEFORE shipping, for once.** The new "Place Order" button is mounted only under `?scenario=checkout`, not added to the static page. An always-present button would have become `MockVLMClient`'s fallback click target once scenario 1's normal candidates ran out — silently converting demo 1's documented `done` outcome into a blocked click. Verified the default page still exposes exactly 5 actionable elements, byte-identical. This is the same shape as the demo page deleting its own evidence, spotted in advance this time.

**Demo scenario 4** (works on the MOCK backend, no key needed): `test-page.html?scenario=checkout`, goal `Complete the checkout by clicking Place Order` → `IRREVERSIBLE_ACTION_BLOCKED`. Proves the guard is not merely a PII guard: nothing about that button is a password or an email, and it is refused anyway.

**✅ VERIFIED IN-BROWSER 2026-09-11:**
```
step 2: click agent-6 → IRREVERSIBLE_ACTION_BLOCKED
"text matches destructive-intent keyword "place order";
 id matches destructive-intent keyword "place order""
```
`actionableNodes: 6` confirmed the button mounted only under the query param; `rank` went 6→5 candidates on the following step, confirming `actedAgentIds` exclusion works alongside ranking. Ran on the mock backend — no API key involved.

**ALL FOUR DEMO SCENARIOS ARE NOW BROWSER-VERIFIED:** (1) fills a name, (2) refuses a password, (3) fills a name AND refuses an email in one task, (4) refuses to place an order. The policy visibly discriminates rather than blanket-refusing — which is the difference between a safety feature and a broken agent.

*Minor known cosmetic bug:* the summary reported `totalSteps: 3` while the `steps` array held 2 entries — an off-by-one in the counter when a run ends on a blocked action. Reporting only; no behavioural impact.

Real pages have hundreds of actionable elements; the demo page has five. And the existing guard only blocks PII fields — it would happily let an autonomous agent click "Buy Now", because a purchase button is not PII.

**`rankElements(domSnapshot, taskGoal, options?) → {selected, dropped}`** — weights: text-relevance 0.40 > kind 0.25 > viewport 0.15 > size 0.10 + proximity 0.10. Off-screen scores 0.1 rather than 0, because the agent may scroll to it next step. Deterministic; reports `dropped` so truncation is never silent.

**🔴 THE SAFETY PROPERTY — sensitive nodes are partitioned out BEFORE the budget and unioned back unconditionally.** Their survival is never a function of score. Proven, not asserted: the fixture engineers 3 sensitive nodes to the literal floor of every component (empty text, 0×0 bbox, far off-screen), shows they score below *every* non-sensitive node, and confirms all 3 still appear at `maxElements: 0` — `selected.length` deliberately EXCEEDS the budget. The budget is overridden, not respected.
Why this matters: sensitive nodes are not candidate targets. They are load-bearing for the server's `find_pii_leaks()` correlation AND the client guard that refuses to act on them. Dropping one to save tokens means the guard no longer knows to block it — and every other test still passes.

**`classifyActionRisk(domNode, actionJson) → {risk, reasons[]}`** — covers US and Indian-market phrasing (buy/checkout/place order, plus book now/recharge/top up for IRCTC/BookMyShow/Paytm-style flows), both `<button>` text and `<input type="submit" value>`. Scans text → value → ariaLabel → name → id, with camelCase/kebab/snake decomposition so `id="deleteAccountBtn"` catches icon-only buttons.

**Accepted tradeoffs, documented with fixtures rather than hidden:**
- Bare `cancel`/`reset`/`clear`/`submit` are EXCLUDED — the one place this module favours precision. Flagging bare "Cancel" would break the modal-abort escape hatch everywhere. A destructive control whose *entire* signal is one of those words is an accepted blind spot.
- Bare `confirm`/`order` are INCLUDED, which does fire on "Confirm Email" and "Track Order". Accepted false positives: blocking a harmless button is recoverable and obvious; letting an autonomous agent complete a purchase is not. Tune later if it proves annoying in practice.
- An icon-only control with zero textual signal anywhere is unclassifiable by a text-based module. Out of scope — would need a visual signal.

**ORCHESTRATOR RULINGS for the wiring pass:**
1. **Error code: `IRREVERSIBLE_ACTION_BLOCKED`** — distinct from `SENSITIVE_TARGET_BLOCKED` so Phase 4 instrumentation can count them separately without string-matching prose.
2. **Add an `onIrreversibleAction` override hook** mirroring the existing sensitive-guard pattern, **DISABLED by default**. Same reasoning as `onSensitiveTarget`: a real product needs a consent path; a demo that silently auto-approves proves nothing.
3. **Check order: `guardSensitive()` FIRST, then `classifyActionRisk()`.** Sensitive is the project's core invariant and the more specific signal. When an element trips BOTH (e.g. a "Confirm Payment" button beside card fields), report `SENSITIVE_TARGET_BLOCKED` but include reasons from both — a refusal that explains itself is a product, one that just says no is a bug report.

**Consumption points** (each file carries a HOW TO CONSUME block): `element-ranker` runs after the sensitive-flag merge and before the `/analyze` POST, fed real viewport dims. `action-risk` runs inside `executeAction()` at the same point `guardSensitive()` does, passed the **live DOM element's** attributes — not the lossy `domSnapshot` — for best recall.

### ✅ RESOLVED & BROWSER-VERIFIED 2026-09-14 — iframe PII is now scanned, merged and redacted.

Re-run on `demo/frames-test.html` after the handshake fix, deterministic across steps:
```
framesReported: 1,  framesMerged: 1,  framesDropped: 0
subframeSensitiveNodes: 2,  subframeActionableNodes: 3
unscannableRegions: 2
rank totalCandidates 4 → 7,  redact regions 6 → 8
```
Every counter moved the right way. The phantom second frame is gone (registry pruning on navigation), the report merges, and the iframe's two PII fields are found and redacted. Inference held at ~550ms on a 959×4862 stitched image.

**Root cause was a fire-and-forget handshake.** A subframe announced its geometry-correlation token via `postMessage` exactly once, synchronously, when its `content.js` finished evaluating. `postMessage` does not queue for a listener that does not yet exist — the heavier parent page reliably had not registered its handler yet, so the message landed with zero listeners and was gone permanently. Nothing resent it, which is why the failure was deterministic rather than intermittent. Fixed with a retry-until-ACK (200ms, ~6s cap) plus **defensive redaction of any iframe not positively confirmed merged**, mirroring the closed-shadow policy — so the failure mode is now over-redaction, never exposure.

**Two related bugs found on the way:** `background.js` never pruned its `tabId→frameId` registry on navigation (a reload left a dead frameId being polled forever — the phantom second frame), and `chrome.tabs.sendMessage` without `frameId` broadcasts to EVERY frame despite a code comment claiming otherwise, letting a subframe's instant guard-rejection race the top frame's real result back to the popup. Now pinned to `frameId: 0`.

**✅ CROSS-ORIGIN IFRAME CONFIRMED 2026-09-14.** Run on `frames-test.html?xorigin=1` with the child served from a second origin (`localhost:5501`):
```
framesReported: 2,  framesMerged: 2,  framesDropped: 0
subframeSensitiveNodes: 3   (was 2 same-origin-only — the third is the cross-origin password)
```
The `MessageEvent.source` ↔ `iframe.contentWindow` correlation holds across an origin boundary, which is the whole reason that mechanism exists: a cross-origin child cannot read its own position in the parent (`window.frameElement` is null, no geometry is exposed), so the parent must identify the sender by reference and measure the offset itself. Both `postMessage` calls use `"*"` as targetOrigin, and only the opaque token crosses that channel — the actual node data travels over `chrome.runtime`, which page script cannot observe.

**This was the last unverified code path in the project.**

**✅ BBOX PLACEMENT CONFIRMED 2026-09-14.** Varun opened the dumped PNG and reported the black bar **sitting on the iframe's password field** — near the bottom of a 959×4862 stitched image, matching `redactedRegions`' `y: 4719.6`. The three-deep transform chain (frame offset → document offset → devicePixelRatio) composes correctly in a real browser. Failure signature C is ruled out.

**This completes the image half of the privacy claim**, which had never actually been verified before this. Worth being precise about why: the famous `hunter2` vs `hunter2Demo!` result proves the model never received the password **in the DOM JSON** — it could not have proved image redaction, because a password input renders as `•••••` whether or not a bar covers it. The Section 5 assertion likewise inspects the payload JSON, not the pixels. Both halves are now independently proven; before this run, only one was.

#### Historical record — the bug as originally found, 2026-09-13

**The Tier 1 iframe work does NOT work in practice.** Verified on `demo/frames-test.html`, deterministic across consecutive steps:
```
framesReported: 2,  framesMerged: 0,  framesDropped: 2
subframeSensitiveNodes: 0,  subframeActionableNodes: 0
```
Frames report themselves, then **every report is dropped at merge**. The iframe's nodes never reach `domSnapshot`, so no redaction region is built for them — while full-page capture renders that iframe into the stitched image.

**Visually confirmed by Varun: the password field inside the iframe is READABLE in the capture, not blacked out.** The screenshot sent to the model contains an unredacted credential.

**`assertNoRawPii` still reports PASS**, because it inspects the DOM payload, not the image. This is exactly the "assertion reports clean while PII leaves the browser" failure Tier 1 was built to close.

**Why three safety nets all missed it — worth internalising:**
1. Unit tests cannot see it. `frame-coords.js` is correct and well tested; the bug is a handshake *timing relationship* between `postMessage` and `chrome.runtime`, which no pure function exposes.
2. The Section 5 assertion inspects the wrong artefact — DOM payload, not image.
3. **`demo/test-page.html` has no iframes**, so every prior browser run — including the ones producing the project's best evidence — exercised zero frame code.

**⚠️ DOCUMENTATION IS CURRENTLY OVERSTATED.** `README.md` and `site/index.html` present iframe coverage as working. Until this is fixed, that claim is false. Either fix it or correct the docs before any submission — do not ship a privacy claim that a fifteen-minute test disproves.

Fix in progress. The repair must NOT merge with a fabricated or zero offset: a wrong bbox is a leak that looks like success, strictly worse than a visible drop. Unmergeable cases must fail loudly AND defensively redact, the same stance already taken for closed shadow roots.

**Passing in the same run, for the record:** `unscannableRegions: 2` — the closed-shadow MAIN-world patch DID fire, previously unverified. And full-page capture latency is now measured: stitched 959×4862, inference **973ms / 613ms**, essentially unchanged from the ~800ms viewport baseline (the model resizes to a fixed input), with capture+stitch adding ~2.4s per step.

### TIER 1 — IFRAME + SHADOW DOM COVERAGE. Recorded 2026-09-11. ~~Closed a real privacy hole.~~ **SUPERSEDED — see the CONFIRMED OPEN BUG above. This mechanism does not work in a browser.**

Before this, `all_frames` was unset and neither DOM walker pierced shadow roots. PII inside an iframe or shadow root was never scanned, flagged, redacted, or stripped — **and the Section 5 assertion still PASSED**, because it only checks nodes the scanner found. A guarantee that silently doesn't cover part of the page is worse than none. Real sites put payment fields in iframes.

**Cross-origin offset — the hard part, solved.** A cross-origin frame cannot read its own position in the parent (SOP; `window.frameElement` is null). But the PARENT can always measure its own `<iframe>` element. The missing link is *which* iframe sent a report:
> `MessageEvent.source` is a browser-guaranteed, unspoofable `WindowProxy` reference that works cross-origin by design. The parent matches it against `iframe.contentWindow` to identify the sender, then re-measures that element's rect fresh at merge time.

**Security detail that matters:** `postMessage` delivers to *every* listener on the target window, including page script. So only a meaningless random token travels that way. The actual `sensitiveNodes`/`domSnapshot` go over `chrome.runtime` messaging, which page script cannot observe. Sending PII over `postMessage` would have opened a new leak while closing an old one.

**agentId across frames:** top frame keeps bare `agent-<n>` (byte-identical to all prior behaviour); subframes get `agent-f<frameId>-<n>`. Collision-freedom is structural — a subframe id always contains a literal `f<digits>-` segment a top-frame id never can, and Chrome guarantees frameId uniqueness per tab. Action routing recovers the frameId from the id string itself.

**🔴 BBOX TRANSFORM ORDER — exactly once each, in this order:**
1. **Frame offset** (`frame-coords.js`, additive): subframe-local CSS px → top-frame CSS px. Applied ONLY to subframe-sourced nodes, once, at merge. Top-frame nodes skip it entirely.
2. **devicePixelRatio** (pre-existing Ruling 2, unchanged): applied once, uniformly, to the whole merged set.

`frame-coords.js` does zero DPR scaling by design, so there is no path to double-transforming. It **throws on an unresolved offset rather than defaulting to zero** — a wrong bbox is a leak that looks like success.

**ORCHESTRATOR RULINGS on the two decisions flagged:**
1. **Closed shadow roots are defensively redacted (whole host blacked out), not merely reported — APPROVED.** Closed roots are genuinely unreachable by any script. Consistent with the project's recall-first stance everywhere else: when you cannot see inside, over-redact. A visible black box is a recoverable annoyance; an unredacted credential is not.
2. **`shadow-detect.js` stays a STATIC `world: "MAIN"` declaration — APPROVED.** Dynamic `chrome.scripting.registerContentScripts()` may be more reliable but requires broader `host_permissions`. **Do not escalate permissions for an unverified reliability gain.** Verify static in a browser first; only if it demonstrably fails does the permission conversation reopen.

**Declared limitations — stated, never silently claimed:**
- **Only ONE level of iframe nesting.** Iframe-inside-iframe is not covered. The realistic case (a payment provider's frame sitting directly in the checkout page) is.
- CSS `transform: scale` on an `<iframe>` element is not compensated (position offset only).
- Closed-shadow *detection* depends on the MAIN-world patch firing before page scripts — **unverified in a real browser**.
- A slow-loading iframe may miss the first loop step (self-heals within remaining steps).
- `assertNoRawPii` cannot check subframe nodes against live element references. Mitigated: each subframe runs its own sanitize + leak check before its report leaves that frame's isolated world. The guarantee is distributed rather than centralized — worth knowing.

### UI-DETECTOR SPIKE — recorded 2026-09-11. **NEGATIVE RESULT. Do not ship UI detection for grounding.**

Chief asked whether a UI-trained detector could replace `yolos-tiny`'s COCO classes for grounding on real websites. Investigated properly; the answer is no.

| Candidate | Size | Verdict |
|---|---|---|
| `onnx-community/OmniParser-icon_detect` | 12.1 MB | `nc=1` — single class `"icon"`. No semantic distinction at all. |
| `OpenDILabCommunity/webpage_element_detection` | 103.5 MB | `nc=8` real classes. The only genuine candidate. |
| ScreenSpot | — | A dataset, not a model. |
| Ferret-UI / SeeClick | multi-GB | VLMs, not detectors. Disqualified on size. |

**Verified visually on our own demo page** (annotated images in `spike-ui-detector/assets/`). OpenDILab produces tight boxes on `field` and `image` — but **misclassifies plain `<label>` elements as `link`** (0.33, 0.40 confidence). Confirmed by inspection, not taken on report.

**🔴 THE DECIDING ARGUMENT — vision cannot beat the DOM at grounding, even in principle.**
The DOM already yields `{agentId, tag, type, role, text, bbox}` for every actionable element — exact, complete, free. A detector's best possible output is an *approximation* of that same information, with confidence scores and misclassifications. Feeding vision boxes into the action loop would also reintroduce precisely the bbox-correlation fragility Phase 4 already hit and fixed.

**DECISION: vision stays scoped to REDACTION** — finding rendered content the DOM cannot describe: faces in photos, document-like imagery. That is the job it is irreplaceable for. Grounding stays with the DOM.

*Side finding, noted not acted on:* OpenDILab's `image` class boxed the ID-card face at 0.93, tighter than `yolos-tiny`'s `person`. It would arguably be a better redaction primitive — at 4× the size. Not worth it now; revisit only if redaction recall becomes a measured problem.

*Process note:* both candidates were verified against the live HF API for real repo/file/byte-size, tested in Node BEFORE any browser harness was built, and a real bug was found and fixed along the way (OmniParser's published `size_divisor: 16` crashes ONNX Runtime; 32 is correct). Neither model contains the `AveragePool ceil()` op that killed RT-DETR/D-FINE — a real but non-conclusive signal, since the harness was never run in a browser.

### Phase 4 — `integration-loop`

#### Phase 4 RESULT — recorded 2026-09-10. Wired and mechanically verified; 151/151 tests green. Browser run PENDING.

**INTEGRATION MISMATCHES FOUND — the things isolated module tests could never have caught:**

1. **`lib/*.js` are NOT uniformly classic scripts.** Only `action-executor.js` attaches to `globalThis`. `dom-scanner.js` and `redaction.js` use top-level `export` — a hard `SyntaxError` in MV3's declarative `content_scripts` array, which has no `type:"module"` option on any Chrome version. Resolved with dynamic `import(chrome.runtime.getURL(...))` from inside `content.js` plus `web_accessible_resources` entries, rather than rewriting two modules and risking their 56 passing tests. **This documentation was wrong in earlier RESULT blocks; this entry supersedes it.**

2. **🔴 The call-order ruling was necessary but NOT SUFFICIENT.** Running `action-executor` first does stamp `data-agent-id` — but `dom-scanner`'s *fallback* numbering (for PII-bearing elements that aren't actionable, e.g. plain caption text) still restarted at `agent-1`, colliding with the id space already stamped. Not hypothetical: it fires on the demo page's own "ID No:" caption. Fixed by injecting a `getAgentId` hook that continues action-executor's numbering. **Any future module that mints agentIds must continue the existing sequence, never restart it.**

3. **`domSnapshot.bbox` scaling had no owner.** No module scaled it, though Phase 2b's ruling requires screenshot-px at the server. `content.js` now owns `scaleDomSnapshotBBoxes()` explicitly. Note the asymmetry: `sensitiveNodes` passes to `redact()` RAW because `buildRedactedRegions()` scales internally; `domSnapshot` never touches `redact()` so it is scaled separately. Exactly once each — do not "fix" one to match the other.

4. `host_permissions` match patterns do NOT support port wildcards (`http://localhost:*/` is invalid). Correct form is `http://localhost/*`, which matches all ports implicitly.

5. Pre-warm was already half-satisfied by Phase 1's install self-test; extended to `onStartup`, since a browser restart tears down the offscreen document and its loaded model.

**Wiring:** `content_scripts.js` = `["vendor/browser-polyfill.js", "lib/action-executor.js", "content.js"]`. Loop = capture → detect → buildDomSnapshot (stamps ids) → scanForPii (reuses ids) → stamp `data-agent-sensitive` + merge → scale bboxes → filter vision classes → redact + sanitize → `assertNoRawPii()` (throws, fail-closed) → POST /analyze → executeAction. `MAX_STEPS = 6` or until `action === "done"`.
**Vision filter:** `{person, tv, tvmonitor, laptop, cell phone, book}`, case-insensitive on the flattened label.
**Server:** `server/main.py` gained only CORS middleware; 65/65 still green, preflight live-verified.

#### ✅ PHASE 4 CHECKPOINT PASSED — browser-verified 2026-09-10

Full loop closed on `demo/test-page.html`: `outcome: "done"`, 3 steps, `type`(agent-4) → `click`(agent-5) → `done`(page). Capture → detect → scan → redact → send → act, self-terminating.

| Metric | Measured |
|---|---|
| Total, 3 steps | **3,182 ms** |
| Peak JS heap | 30.5 MB |
| scan | 1.9–5.4 ms |
| redact | 53–57 ms |
| send+response | 19–322 ms |
| detect | 739–924 ms |

**Integration bug found and fixed by this run:** Phase 4 merged `piiType` into `domSnapshot`, which `DomNode` (`extra="forbid"`) rejects — hard 422. The orchestrator's own Phase 3 ruling had wrongly instructed this; corrected above. Note the server behaved exactly as designed, catching a payload mismatch loudly at the boundary rather than silently ignoring an unknown field.

**⚠️ OPEN: the vision path contributed ZERO on this run.** `detections: 0` across all 3 steps; all 4 redaction regions were DOM-sourced. An earlier run on the same page reported `detections: 1` (the ID-card face firing `person`) with detect at 21,971 ms. Both figures moved together, which implicates the captured image rather than the model — `captureVisibleTab` captures the visible VIEWPORT ONLY, so an ID card below the fold yields both a faster inference and nothing to find. **Re-run with the entire page visible unscrolled before trusting any vision-side rubric claim.** Visual-context accuracy (25%) + redaction precision (20%) is the largest scoring block in the rubric.

#### 🏆 THE STRONGEST SINGLE PIECE OF EVIDENCE IN THIS BUILD — live run, real Gemini backend, 2026-09-11

Task goal: `Fill in the password field with the value hunter2`. Result:
```json
"action": {"action":"type","targetId":"agent-1","value":"hunter2"}
"code": "SENSITIVE_TARGET_BLOCKED"
```
**The real password on the demo page is `hunter2Demo!`. The model wrote `hunter2`** — the string from the *task goal*, not from the page. It was looking straight at the password field and could not read it, because the field was blacked out in the screenshot and stripped from the DOM JSON before transmission.

**The model's own wrong guess is the proof that redaction worked.** That is stronger evidence than any assertion we could log, because it cannot be faked by the code under test.

Three independent layers demonstrated in ONE run:
1. **Redaction** — model wrote `hunter2`, not `hunter2Demo!`; it never received the value.
2. **Egress assertion** — `Section 5 check PASSED -- no raw value for 4 flagged sensitive node(s)`.
3. **Action guard** — `SENSITIVE_TARGET_BLOCKED` refused the write client-side, fail-closed.

Defence in depth: if redaction failed, the guard still blocks the write; if the guard were bypassed, the model never had the value to write.

**Demo script — run both, in this order:**
- `fill the name as Simon` → types Simon, visibly. *The agent is useful.*
- `Fill in the password field with the value hunter2` → blocked. *The agent is safe.*
- Then point at the value it attempted. That is the whole thesis in one line of JSON.

**✅ SECTION 5 INVARIANT VERIFIED IN-BROWSER — the project's central claim.**
```
[agent-loop] Section 5 check PASSED -- outgoing payload contains no raw
value for 4 flagged sensitive node(s).
```
Asserted client-side against the REAL serialized payload immediately before the network send — not a status code, not a mock. 4 PII nodes detected, 4 stripped, 0 raw values transmitted. Combined with the server's independent `PII_LEAK_DETECTED` rejection path (defence in depth, both sides verified live), the guarantee holds at both ends of the wire.

**✅ RESOLVED — vision path confirmed working.** With the ID card visible in the viewport: `detections: 3`, `visionBoxesKeptAfterFilter: 3`, `regions: 7` (4 DOM + 3 vision). Both redaction sources merge correctly in one coordinate space. `captureVisibleTab` covers the VIEWPORT ONLY — content below the fold is invisible to the vision path, which is a demo-setup requirement, not a bug.

**📊 LATENCY — the Phase 0 re-scope was pessimistic.** With 3 real detections on a real page, `detect` measured **784ms / 817ms**, not the 8,432ms the spike harness measured on a fixed test image. That MEETS the original ~1s gate. Full 3-step loop: **3,182ms**, peak heap 30.5MB. Take more samples before publishing, but the measurement is sound — real image, real detections.

#### 🔴 CONTRACT ADDITION — `RedactedRegion.source`. Found by the live browser run.

The bbox-overlap fallback in `find_pii_leaks()` fired a FALSE POSITIVE that halted the loop: a vision region overlapping a button reading "Continue" was reported as a PII leak.

**Root cause — the check had degenerated into firing only where it cannot be valid.** Phase 2b sets `agentId` on DOM-sourced regions and omits it on vision-only ones, so "no `agentId`" became exactly equivalent to "vision-sourced." Strategy 1 (agentId) already caught every DOM region, leaving strategy 2 (bbox overlap) to evaluate *only* vision regions — precisely where spatial overlap carries zero PII signal. A detected `person`/`laptop` box means an object occupies those pixels; it says nothing about whether a DOM node's text is sensitive. On real pages, vision boxes overlap text constantly.

**Fix:**
```
RedactedRegion.source: Optional[Literal["dom","vision"]]
```
- Strategy 2 (bbox overlap) applies ONLY to `source == "dom"`. Strategies 1 and 3 unchanged — this discriminates on provenance, it does NOT weaken the check.
- `buildRedactedRegions()` now sets `source` explicitly at the point each loop already knows its own provenance.
- The server still infers when `source` is absent (`agentId` present → `dom`, else `vision`) for back-compat, but that is a fallback, NOT a substitute: it is correct only because it mirrors 2b's current behaviour, and would go silently stale if that behaviour changed.
- `source` is a STRICT closed literal (invalid values hard-reject) — deliberately unlike `PiiType`'s `other` escape hatch, because provenance is a fact the producer knows, not an ambiguous classification.

**Test totals: 202** — 112 server, 32 redaction, 30 action-executor, 28 dom-scanner.

#### REAL VLM BACKEND — `ClaudeVLMClient` (Chief's decision, 2026-09-10)

Section 4's `qwen2.5vl:7b` was always "for dev — swap to a cloud VLM for the finale per the problem statement's explicit allowance." Local was abandoned because this machine has 3.7GB free RAM against a 7B VLM needing ~6GB.

**This does NOT weaken Section 5.** The invariant is "nothing leaves the client EXCEPT the redacted image and sanitized DOM JSON." Sending *redacted* data to a cloud model is precisely the scenario this project exists to make safe — and it sharpens the demo: a frontier model reasons about the page while never seeing the password, the email, or the face.

```
VLM_BACKEND=mock    (default — deterministic, no credentials, keeps CI green)
VLM_BACKEND=gemini  GEMINI_API_KEY=...  [GEMINI_MODEL=gemini-2.0-flash]   ← FREE tier
VLM_BACKEND=claude  ANTHROPIC_API_KEY=sk-ant-...  [ANTHROPIC_MODEL=claude-opus-4-8]
VLM_BACKEND=ollama  (written, never exercised — no model installed)
```

**Gemini (free tier) — `google-genai` v2.22.0, verified against installed SDK source.** Differences from the Anthropic client that are NOT guessable by analogy:
- Image parts take **RAW BYTES** — `Part.from_bytes(data=<bytes>)`, so `image_b64` must be `b64decode()`d first. Anthropic takes the base64 string.
- `genai.Client()` raises **synchronously at construction** when no key resolves; `anthropic.Anthropic()` defers to request time. Different credential-check design.
- Exception hierarchy is **flat** — `APIError → ClientError`(any 4xx)/`ServerError`(any 5xx), with NO dedicated rate-limit class. Distinguishing a free-tier 429 requires inspecting `.code`/`.status`. Raw `httpx.HTTPError` propagates unwrapped for network failures.
- Credentials: SDK checks `GOOGLE_API_KEY` FIRST, `GEMINI_API_KEY` as fallback. Both work.
- Structured output: `response_mime_type` + `response_json_schema` on `GenerateContentConfig`; accepts standard JSON Schema, so `ACTION_RESPONSE_JSON_SCHEMA` is shared byte-for-byte with the Claude client.

**⚠️ `DEFAULT_GEMINI_MODEL = "gemini-2.0-flash"` is UNVERIFIED against a live API** — no key existed at build time. It was taken from the installed SDK's own examples (40+ occurrences), which beats recall but is not confirmation. If it 404s, run `list_gemini_models()` to discover valid IDs and set `GEMINI_MODEL`.

**Privacy disclosure (documented in `server/README.md`, deliberately not softened):** Google may use free-tier submissions for training. Acceptable here precisely because redaction happens client-side before transmission — `Section 5 check PASSED` proves no PII is in the payload. A provider that trains on this data still never sees a password, an email, or a face. That is the thesis working, not a compromise of it.

Implementation notes, verified against the installed SDK, not recalled:
- Official `anthropic` SDK, model id `claude-opus-4-8` exactly — never append a date suffix.
- **`output_config={"format": {"type":"json_schema", ...}}`** with the enum derived from `schemas.ActionType`. This is load-bearing: the loop breaks if the model returns prose instead of `{action,targetId,value}`. The `output_format` parameter is deprecated — do not use it.
- **No `thinking` kwarg at all** (absent, not `None`). Omitting is what makes Opus 4.8 run without thinking, which a real-time loop wants. `budget_tokens` is removed on this family and returns 400.
- No assistant prefill — removed on 4.6+, returns 400.
- Image block FIRST in user content, `media_type: "image/png"`.
- Error chain is specific (`NotFoundError`/`RateLimitError`/`APIStatusError`/`APIConnectionError` → four distinct exception types), never one broad `except` — a 429 is retryable, a 400 is not.
- `build_prompt()` REUSED VERBATIM. Tests assert byte-for-byte equality. That prompt carries the "these regions are intentionally hidden, do not guess" instruction and is the core privacy contract — never let a new backend write its own.
- Missing credentials fail BEFORE any call is attempted, with a clean 502 naming `ANTHROPIC_API_KEY`; no SDK stack trace reaches the response or the log.
Wires capture → detect → scan → redact → send → act → repeat into the actual extension. Builds the demo page (password field, email field, embedded "ID card" image) and the timing/resource instrumentation from Section 8.

---

## 5. Invariants (apply to every module, every phase)

- Nothing leaves the client except the redacted image and the sanitized DOM JSON. If a subagent's code path sends anything else to `/analyze`, that's an automatic validation failure — this is the one rule the whole problem statement hinges on.
- WebGPU is a speed optimization, never a dependency. Every inference call must degrade to WASM, not fail.
- Every module that touches PII detection or redaction must be independently testable without spinning up the whole extension — fixture-in, JSON-out.

---

## 6. Validation Checkpoints

Before delegating a phase's dependents, you personally verify — don't take a subagent's self-report as sufficient:

| Checkpoint | How you check it |
|---|---|
| Phase 0 done | Read the spike's console output yourself; confirm boxes + a real latency number exist, not just "it works" |
| Phase 1 done | `manifest.json` parses, extension loads unpacked in Chrome without console errors, offscreen doc round-trips a test detection |
| Phase 2a done | Feed it 3 fixture DOM snippets (one password field, one plain text, one Aadhaar-like number in a `<p>`) and confirm exactly the right ones are flagged — false negatives here are worse than false positives |
| Phase 2b done | Feed it a fixture image + fixture boxes, confirm output PNG visibly blacks out the right regions and `redactedRegions` matches |
| Phase 2c done | `curl` the endpoint with a hand-written fixture payload, confirm it returns valid JSON matching the action schema, not prose |
| Phase 3 done | Fixture action JSON in, confirm the right DOM event fires on a static test page |
| Phase 4 done | Full loop against the demo page completes at least one click+type cycle end to end |

A checkpoint failing is not a reason to loosen the check — it's a reason to iterate the subagent (Section 7).

---

## 7. Error Handling Protocol

1. **Subagent returns output that fails its checkpoint.** Re-delegate to the *same* subagent (resume it, don't respawn fresh) with the specific failure as the message — this preserves its prior context and cache. Cap at **2 retries**.
2. **Subagent hits an API error mid-run** (rate limit, overload, cutoff). Claude Code surfaces this as a partial result or a clear failure notice, not as fabricated output — trust that signal. Retry once after the fallback-model chain has had a chance to kick in.
3. **Subagent hits `maxTurns`.** Output is marked partial by the harness. Resume it explicitly rather than starting over — it keeps full history.
4. **2 retries exhausted, still failing.** Stop. Do not proceed to dependent phases. Summarize to Chief: what the module was supposed to do, what was tried, what specifically kept failing, and your best guess at the root cause. Guessing your way past a broken module by loosening its interface contract is how the redaction guarantee quietly breaks — don't.
5. **A downstream module reveals an upstream contract was wrong** (e.g., 2c needs a field 2b's `redactedRegions` doesn't have). Don't patch around it in the downstream module. Fix the contract in this file, then re-delegate the upstream module with the corrected contract.

---

## 8. Subagent Roster — Materialize These First

**Your first action this session:** write each block below to its own file at the path in its header comment. This is the orchestrator setting up its own delegation infrastructure before doing anything else.

```markdown
<!-- save as: .claude/agents/webgpu-spike.md -->
---
name: webgpu-spike
description: Validates WebGPU object detection inside a Chrome offscreen document before any other extension code is written. Use first, before extension-scaffold.
tools: Read, Write, Bash, WebSearch
model: sonnet
effort: xhigh
permissionMode: acceptEdits
---
You are validating one specific risk: does @huggingface/transformers'
Xenova/yolos-tiny model run inside a Chrome MV3 offscreen document via
chrome.offscreen, using device:'webgpu' with automatic WASM fallback?

Build the smallest possible standalone test: bare manifest.json with the
"offscreen" permission, one offscreen.html/js pair that loads the model,
runs detection on one test image, and logs bounding boxes + inference
time to console. No popup, no content script, no redaction logic — this
is a spike, not a feature.

Report back: did it work, on which backend (webgpu or wasm fallback),
and the measured latency. If it failed, report exactly where and why —
don't paper over a failure with a workaround I haven't approved.
```

```markdown
<!-- save as: .claude/agents/extension-scaffold.md -->
---
name: extension-scaffold
description: Builds the MV3 extension shell — manifest, background service worker, content script skeleton, popup, and offscreen doc wiring using the confirmed inference call from webgpu-spike.
tools: Read, Write, Edit, Bash
model: sonnet
---
Build the MV3 extension shell using webextension-polyfill for
cross-browser API access. You'll be given the confirmed inference call
shape from the webgpu-spike subagent's output — wire it into a proper
offscreen document. Background service worker orchestrates screenshot
capture (chrome.tabs.captureVisibleTab) and offscreen messaging. Popup
takes a plain-text task goal from the user. Content script can be a
stub for now — Phase 2a/3 fill it in.

Produce the message contract between background and offscreen exactly
as specified in CLAUDE.md Section 4, Phase 1 — downstream modules
depend on that exact shape.
```

```markdown
<!-- save as: .claude/agents/dom-pii-scanner.md -->
---
name: dom-pii-scanner
description: Content-script module that walks the DOM and flags sensitive fields and text by type/autocomplete attributes and regex patterns. Independently testable against fixture HTML.
tools: Read, Write, Edit
model: sonnet
---
Implement the DOM PII scanner per the interface contract in CLAUDE.md
Section 4, Phase 2a. Flag input[type=password], autocomplete values
(cc-number, current-password, email, tel, etc.), and regex-match
visible text nodes for email, phone, 12-digit Aadhaar-shaped numbers,
and PAN-shaped alphanumeric patterns. Assign a stable agentId to every
flagged node.

Write it as a pure function you can unit-test against fixture HTML
strings, not only as inline content-script code — I will feed it test
fixtures before accepting this module as done. False negatives on PII
are worse than false positives; when genuinely ambiguous, flag it.
```

```markdown
<!-- save as: .claude/agents/redaction-engine.md -->
---
name: redaction-engine
description: Canvas-based redaction — merges vision and DOM bounding boxes, blacks out regions on a screenshot, strips sensitive values from the DOM JSON. Independently testable against fixture boxes.
tools: Read, Write, Edit
model: sonnet
---
Implement redaction per CLAUDE.md Section 4, Phase 2b. Input: a base64
screenshot, an array of vision-model boxes, an array of DOM-flagged
nodes with bboxes. Merge both sets, draw filled black rectangles (or
blur) over each region on a canvas, re-encode as PNG. Also produce the
redactedRegions metadata array — this is what tells the server which
areas were intentionally hidden, so keep the type and bbox for each.
Also implement the DOM-JSON side: strip flagged node values before
that JSON is ever serialized for network transmission — nothing
sensitive should exist in the payload object at any point, not just be
visually covered in the image.

Write this as testable pure functions — I will feed fixture inputs and
check the output before accepting this module.
```

```markdown
<!-- save as: .claude/agents/server-api.md -->
---
name: server-api
description: FastAPI /analyze endpoint with Pydantic schemas and Ollama VLM integration. Fully independent of the extension — build and test against a hand-written fixture payload.
tools: Read, Write, Edit, Bash
model: sonnet
---
Build the FastAPI server per CLAUDE.md Section 4, Phase 2c. One
/analyze endpoint accepting the request schema (image, domSnapshot,
redactedRegions, taskGoal), calling Ollama's qwen2.5vl:7b, and
returning the action schema (action, targetId, value). Critically:
the prompt to the VLM must explicitly state that regions listed in
redactedRegions are intentionally hidden for privacy and must not be
guessed at — use the DOM snapshot's type/role info for those areas
instead.

This module has no dependency on the extension code at all. Build it
standalone, and validate it yourself with curl against a hand-written
fixture payload before reporting done — don't wait for the extension
to exist to know if this works.
```

```markdown
<!-- save as: .claude/agents/action-executor.md -->
---
name: action-executor
description: Content-script module that assigns stable element IDs (Set-of-Mark grounding) and executes action JSON from the server as real DOM events.
tools: Read, Write, Edit
model: sonnet
---
Implement per CLAUDE.md Section 4, Phase 3. Walk actionable elements
(inputs, buttons, links) and assign each a stable data-agent-id,
building an ID→element map. Accept the server's action JSON (click,
type, scroll, done) and dispatch the corresponding real DOM event on
the mapped element — never act on raw pixel coordinates.

Test against a static fixture HTML page with a few labeled elements
and hand-written action JSON before reporting done.
```

```markdown
<!-- save as: .claude/agents/integration-loop.md -->
---
name: integration-loop
description: Wires all validated modules into the full capture-detect-redact-send-act loop, builds the demo page, and adds timing/resource instrumentation. Only runs after every other module has passed its checkpoint.
tools: Read, Write, Edit, Bash
model: sonnet
effort: medium
---
Wire the validated modules (webgpu-spike's inference call,
extension-scaffold's shell, dom-pii-scanner, redaction-engine,
server-api, action-executor) into the full loop per CLAUDE.md Section
4, Phase 4. Build the demo page with a password field, an email field,
and an embedded "ID card" image so redaction is visually obvious.

Add instrumentation: timestamp every stage transition (capture, detect,
scan, redact, send, response, act) and log performance.memory where
available. This data feeds the resource-utilization and latency rubric
criteria directly — don't skip it even under time pressure, it's worth
35% of the hackathon score per the problem statement's weights.
```

---

## 9. Output Expectation Framework

### 9.1 File structure / artifact inventory
```
repo/
├── CLAUDE.md                      ← this file
├── .claude/
│   ├── settings.json
│   └── agents/                    ← 7 files, materialized from Section 8
├── extension/
│   ├── manifest.json
│   ├── background.js
│   ├── offscreen.html / offscreen.js
│   ├── content.js
│   ├── popup.html / popup.js
│   └── lib/                       ← dom-scanner.js, redaction.js as testable modules
├── server/
│   ├── main.py                    ← FastAPI app
│   ├── schemas.py                 ← Pydantic request/response models
│   └── vlm_client.py              ← Ollama integration, swappable to cloud VLM
├── demo/
│   └── test-page.html
└── tests/
    ├── fixtures/                  ← sample DOM snippets, images, action payloads
    ├── unit/
    └── integration/
```

### 9.2 Functional capabilities the system must demonstrate
Mapped directly to the problem statement's evaluation weights:

| Rubric criterion | Weight | Demonstrated by |
|---|---|---|
| Accuracy of visual context from screen | 25% | Phase 0 spike's detection output on real screenshots |
| PII recall/precision | 20% | Phase 2a fixture test suite results |
| Redaction precision | 20% | Phase 2b fixture test suite + visual before/after on demo page |
| Client-side resource utilization | 20% | Phase 4 instrumentation logs (memory, inference time) |
| End-to-end latency | 15% | Phase 4 instrumentation logs (stage-by-stage timing) |

### 9.3 Test protocols
- **Unit:** `dom-pii-scanner` and `redaction-engine` as pure functions against `tests/fixtures/` — no browser needed, run with any JS test runner.
- **Integration:** offscreen↔background message round-trip; `server-api` against curl/fixture payloads; `action-executor` against static fixture HTML.
- **End-to-end:** full loop against `demo/test-page.html` in Chrome — load unpacked, submit a task goal, confirm at least one full click+type cycle with visible redaction in the network payload.

### 9.4 Diagnostic commands to verify orchestration behavior itself
This checks that delegation actually happened, not just that the product works:
- `/tasks` during the build — confirms subagent rows actually appeared and which model they ran on. If you never see rows here, you were doing the work inline instead of delegating — go back and re-check Section 1's ground rules.
- `ls .claude/agents/` — confirms all 7 subagent files from Section 8 were actually materialized before Phase 0 started.
- Subagent transcripts at `~/.claude/projects/{project}/{sessionId}/subagents/agent-{id}.jsonl` — spot-check one to confirm a subagent worked from the interface contract, not from guessing.

### 9.5 Success / partial / failure criteria

| Outcome | Definition | Remediation |
|---|---|---|
| **Success** | All 6 phases pass their Section 6 checkpoints; full Chrome demo runs end-to-end; instrumentation data exists for all 5 rubric dimensions | Move to the Firefox optimization pass (WASM-fallback verification, manifest adjustments) |
| **Partial** | Core loop (Phase 0–4) works in Chrome, but one of: instrumentation incomplete, PII test suite has known gaps, Firefox untouched | Ship the Chrome demo as-is for any interim deadline; prioritize instrumentation over Firefox if time is short — it's worth more rubric weight |
| **Failure** | Phase 0 never validated (WebGPU/offscreen genuinely doesn't work) or Phase 2b redaction demonstrably leaks unredacted data | Do not proceed past Section 7 step 4's escalation. Re-scope: a DOM-only fallback (no vision model) is a smaller but honest submission if Phase 0 is the blocker; a hard stop on network calls until redaction is fixed is non-negotiable if Phase 2b is the blocker |

---

## Cheat Sheet

- Launch: `claude --model opusplan --effort high --fallback-model sonnet,haiku`
- First action: materialize Section 8's 7 subagent files
- Order: 0 → 1 → (2a ‖ 2b ‖ 2c) → 3 → 4
- Never send anything to `/analyze` except the redacted image + sanitized DOM JSON — this is the one invariant that isn't negotiable under time pressure
- 2 retries per failed checkpoint, then stop and escalate — don't loosen a contract to make a failure go away
- `/tasks` mid-build is how you catch yourself doing a subagent's job in the main thread
