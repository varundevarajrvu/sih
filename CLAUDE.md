# Project Orchestrator — SIH 26171: On-Device Visual Perception for Lightweight Browser Agents

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

**Chrome offscreen/WebGPU half: UNVERIFIED.** Harness built at `spike/chrome-harness/` (esbuild-bundled — MV3 CSP blocks transformers.js's bare-specifier remote imports). Never run in a real browser. Open questions it exists to answer: does `navigator.gpu` exist inside an MV3 offscreen document; is the `"WORKERS"` offscreen reason accepted; does the runtime weight fetch succeed from that context. Steps in `spike/README.md`.

**Phase 1 is BLOCKED pending Chief's re-scope decision.**

### Phase 1 — `extension-scaffold`
MV3 manifest, background service worker, content script skeleton, popup for task input, the offscreen document wired to Phase 0's confirmed inference call.
**Interface it produces:** message-passing contract between background SW and offscreen doc:
```
→ { type: "DETECT_OBJECTS", requestId, imageData: base64 }
← { type: "DETECTION_RESULT", requestId, boxes: [{label, score, xmin, ymin, xmax, ymax}] }
```

### Phase 2a — `dom-pii-scanner`
Content-script DOM walker. Flags `input[type=password]`, `autocomplete` values (`cc-number`, `current-password`, `email`, etc.), and regex-matches visible text nodes for email/phone/Aadhaar(12-digit)/PAN patterns.
**Interface it produces:**
```json
{ "sensitiveNodes": [
  { "selector": "#pw", "bbox": {"x":0,"y":0,"w":0,"h":0}, "piiType": "password", "agentId": "agent-1" }
]}
```

### Phase 2b — `redaction-engine`
Canvas 2D redaction. Merges Phase 0's vision boxes with Phase 2a's DOM boxes, blacks/blurs them on the captured screenshot, re-encodes PNG. Also strips flagged values from the DOM JSON before it's sent anywhere.
**Interface it produces:** `redact(screenshotBase64, visionBoxes, domNodes) → { redactedImage: base64, redactedRegions: [{type, bbox}] }` — the `redactedRegions` array is what Phase 2c's prompt tells the VLM to ignore.

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

### Phase 3 — `action-executor`
Content-script side of the loop: assigns `data-agent-id` to actionable elements (Set-of-Mark grounding — the model refers to elements by stable ID, not fragile pixel coordinates), receives Phase 2c's action JSON, dispatches the real DOM event.

### Phase 4 — `integration-loop`
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
