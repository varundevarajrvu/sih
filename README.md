# Dhristi — A Privacy-Preserving Browser Tool

**SIH Problem Statement 26171 — On-Device Visual Perception for Lightweight Browser Agents**

A Chrome extension that lets a browser agent *see* the page it's working on — without ever sending your passwords, emails, ID numbers, or face to the model.

Object detection runs **on-device** in the browser via WebGPU. PII is detected in the DOM, blacked out of the screenshot, and stripped from the payload **before anything leaves the client**. Only the redacted image and the sanitized DOM reach the vision model.

---

## The proof

The most convincing evidence in this project isn't an assertion we wrote. It's a mistake the model made.

Given the task **"Fill in the password field with the value hunter2"**, the agent produced:

```json
{ "action": "type", "targetId": "agent-1", "value": "hunter2" }
→ SENSITIVE_TARGET_BLOCKED
```

The real password on the page is **`hunter2Demo!`**.

The model wrote `hunter2` — the string from the *instruction*, not from the page. It was looking directly at the password field and could not read it, because the field was blacked out in the screenshot and stripped from the DOM JSON before transmission. **The model's own wrong guess proves the redaction worked** — and it can't be faked by the code under test.

Then the action guard refused the write anyway.

---

## Three independent layers

| Layer | What it does | Fails safe by |
|---|---|---|
| **Redaction** | Blacks out PII regions in the screenshot; strips values from the DOM JSON | Over-redacting when ambiguous |
| **Egress assertion** | Asserts the real outgoing payload contains no flagged raw value, before every send *and every retry* | Throwing — the request never goes out |
| **Action guard** | Refuses `click`/`type` on any element flagged sensitive | Blocking — a refused action is a log line, a typed password is a leaked credential |

If redaction failed, the guard still blocks the write. If the guard were bypassed, the model never had the value to write.

---

## How it works

```
┌─ Browser (client) ─────────────────────────────────────────────┐
│                                                                │
│  capture ──▶ detect ──▶ scan ──▶ redact ──▶ ASSERT ──┐         │
│  viewport    WebGPU     DOM PII   canvas +   no raw  │         │
│  screenshot  yolos-tiny  regex    JSON strip  PII    │         │
│                                                       │        │
│  act  ◀────────────────────────────────────────┐     │        │
│  real DOM events, guarded                      │     │        │
└────────────────────────────────────────────────│─────│────────┘
                                                 │     ▼
                                    ┌────────────┴──────────────┐
                                    │  FastAPI /analyze         │
                                    │  redacted image +         │
                                    │  sanitized DOM only       │
                                    │  → VLM → {action,         │
                                    │     targetId, value}      │
                                    └───────────────────────────┘
```

**Set-of-Mark grounding.** Every actionable element gets a stable `data-agent-id`. The model refers to elements by ID, never by pixel coordinates — so an action can't drift between the screenshot the model saw and the DOM it acts on.

**Defence in depth at the server.** `/analyze` independently re-checks the payload and rejects with `400 PII_LEAK_DETECTED` if a client bug ever leaks a flagged value. It never echoes the offending value back — an error path is a data egress path too.

---

## Measured results

Real numbers from browser runs.

| Stage | Measured |
|---|---|
| Object detection (warm) | **~2,350–2,700 ms** (5 samples, Chrome/WebGPU/mock backend, warm, 2026-09-20–21: 2,346 / 2,426 / 2,651 / 2,693 / 2,700) ² |
| Object detection (first call) | ~16–20 s ¹ |
| DOM PII scan | 2–33 ms |
| Redaction (canvas + JSON) | 84–235 ms |
| Peak JS heap | 33–63 MB (5 runs: 33.1 / 33.2 / 34.8 / 37.2 / 63.3 — typically 33–37 MB, with one 63 MB outlier) |
| Full loop (mock backend, warm) | ~2.7 s per step (3-step run: 7,975 ms; 4-step runs: 11,005 ms and 11,635 ms) |

¹ The first inference after the offscreen document is created is ~20× slower, with the pipeline *already loaded* and model-load time at 0 ms. Best explanation is WebGPU compiling shaders lazily on first execution — the timing pattern is confirmed; that specific mechanism is inferred, not instrumented. A pre-warm inference runs at install and startup, and the popup shows warm status, so the common case pays this cost once per offscreen-document lifetime rather than mid-run. An MV3 service worker is evicted routinely, and when it is, the offscreen document goes with it — the next inference re-incurs the full cost. A recorded step-1 sample after such an eviction measured 18,430 ms with `pipelineWasAlreadyLoaded: true`.

² An earlier session on 2026-09-11 measured 784–881 ms on this same machine. That has not reproduced across five later samples taken 2026-09-20–21, and the cause is not established.

**Detection:** `Xenova/yolos-tiny`, WebGPU with automatic WASM fallback by design, ONNX runtime and weights bundled locally — **zero network calls for inference**.

---

## Quick start

**Requirements:** Python 3.11+, Node 18+, Chrome.

### One command (Windows)

```powershell
.\start-demo.ps1              # mock backend — no API key needed
.\start-demo.ps1 -Backend gemini   # real model (needs GEMINI_API_KEY)
.\start-demo.ps1 -DebugDump        # also dump transmitted images to disk
```

Starts all three servers, waits until each actually answers, and prints the URL
and task goal for every demo scenario. `.\stop-demo.ps1` shuts them down.

Three servers are needed, and the third is not redundant: **a different port is
a different origin**, which is what makes the cross-origin iframe test genuinely
cross-origin rather than same-origin wearing a different path.

Then load the extension: `chrome://extensions` → Developer mode → **Load
unpacked** → select `extension/`. Wait for the popup's green ✓ before running —
the first inference after the offscreen document is created is slow, and a
service-worker eviction re-creates it, so check for the ✓ again after the
browser has been idle.

### Or manually

```bash
# 1. Server
cd server
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python -m uvicorn main:app --host 127.0.0.1 --port 8000

# 2. Demo page (separate terminal)
cd demo && python -m http.server 5500

# 3. Extension deps + bundle
cd extension && npm install && npm run build
```

Then: `chrome://extensions` → Developer mode → **Load unpacked** → select `extension/`.
Open **http://localhost:5500/test-page.html**, wait for the popup's green ✓, and click **Run Agent Loop**.

> ⚠️ ML binaries (~48 MB of ONNX weights + runtime) are gitignored. See `spike/README.md` to fetch them.

### Choosing a model backend

```bash
VLM_BACKEND=mock                      # default — deterministic, no key, keeps CI green
VLM_BACKEND=gemini  GEMINI_API_KEY=…  # free tier (aistudio.google.com)
VLM_BACKEND=claude  ANTHROPIC_API_KEY=…
```

All three sit behind one interface. Swapping models touches exactly one file — `server/vlm_client.py` — and nothing in the extension moves.

---

## Demos

**1. The agent is useful**
Task goal: `fill the name as Simon` → types **Simon** into the name field.

**2. The agent is safe (PII)**
Task goal: `Fill in the password field with the value hunter2` → **`SENSITIVE_TARGET_BLOCKED`**.

**3. Both at once**
Task goal: `Fill the name as River Jane and email id as riverjane33@demo.com` → fills the name, refuses the email. The policy discriminates; it doesn't just say no to everything.

**4. The agent is safe (destructive actions, not just PII)**
On `test-page.html?scenario=checkout`, task goal: `Complete the checkout by clicking Place Order` → **`IRREVERSIBLE_ACTION_BLOCKED`**, a distinct code from #2/#3 above. `action-risk.js` classifies "Buy Now"/"Place Order"/"Delete Account"-style controls by their own text/value/aria-label/name/id — no PII involved at all — so an autonomous agent can't complete a purchase or delete an account just because nothing on that button is a password or an email. See `demo/README.md` §9 for the exact console line.

**5. The agent fills your details — and the model still never sees them**
Save a name/email/phone under **"Your profile (autofill)"** in the popup, then task goal: `fill all my details`. The model cannot supply these values; the sensitive guard would refuse a model-chosen `type` into them anyway. Instead it names a *category* and the extension fills from a local vault:

```json
{ "action": "fill_profile", "targetId": "agent-4", "profileField": "full_name", "value": null }
```

`value` must be null — a `fill_profile` carrying one is rejected outright as a misbehaving model or a prompt-injected page trying to smuggle data. The vault never leaves the client, and from the moment a field is filled it is treated as sensitive for the rest of the run: stripped from the DOM JSON **and** blacked out in the screenshot. Both halves are browser-verified — see `CLAUDE.md`'s profile-autofill entry, including the leak this originally shipped with and how it was found.

> **"But what if I want it to fill my email / complete the purchase?"** Both guards are fail-closed *by policy, not by limitation*. `action-executor.js` exposes `onSensitiveTarget(el, action)` and `onIrreversibleAction(el, action, riskResult)` hooks so a real product can prompt for consent and authorize the write. Both are deliberately disabled here — a demo that silently auto-approves sensitive/destructive writes proves nothing.

---

## What's detected as PII

`input[type=password]` · `autocomplete` values (`cc-number`, `current-password`, `email`, `tel`, …) · and regex over visible text **and** `input`/`textarea` values and placeholders: email, phone, 12-digit Aadhaar-shaped numbers, PAN-shaped alphanumerics.

Detection is deliberately **recall-biased**. A 12-digit order number gets flagged as possible Aadhaar. A missed password is an unredacted credential in a screenshot; a false positive is a harmlessly blacked-out box.

Vision boxes are filtered to privacy-relevant COCO classes (`person`, `tv`, `laptop`, `cell phone`, `book`) before redaction — the detector is general-purpose, so passing everything through would black out the whole page.

---

## Project layout

```
extension/        MV3 extension — background SW, offscreen inference, content script, popup
  lib/            dom-scanner.js · redaction.js · action-executor.js · frame-coords.js ·
                   element-ranker.js · action-risk.js · stall-detector.js ·
                   profile-vault.js (all pure, unit-tested)
server/           FastAPI /analyze — Pydantic schemas, swappable VLM clients
demo/             test-page.html with password, email, Aadhaar-shaped ID, an ID card, and a
                   guard-test "Place Order" button (?scenario=checkout)
spike/            Phase 0 research — the WebGPU/offscreen viability investigation
tests/            749 tests
CLAUDE.md         full decision record: every ruling, measurement, and correction
```

## Tests

```bash
node --test tests/unit/*.mjs                      # 529
server/.venv/Scripts/python -m pytest tests/      # 220
```

529 Node `node:test` + 220 pytest = **749 tests, all green**. This figure
supersedes the "238"/"367"/"393"/"526"/"663"/"717" counts in older
commentary elsewhere in this repo; `CLAUDE.md` carries the per-pass
breakdown.

Redaction is verified by **sampling actual pixels** inside and outside each rect — including a test asserting the *unscaled* coordinate is NOT painted, which proves the HiDPI scaling is load-bearing rather than merely present.

---

## Known limitations

- **Viewport only.** `captureVisibleTab` can't see below the fold. Content off-screen is invisible to the vision layer.
- **`yolos-tiny` is a general COCO detector**, not a PII detector. It finds faces via the `person` class; there is no "ID card" class. Modern real-time detectors (RT-DETR, D-FINE) currently crash on onnxruntime-web's WebGPU backend — a missing `ceil_mode` `AveragePool` kernel, not a model defect. Documented in `CLAUDE.md`.
- **Names in page content are not redacted.** A name has no regex signature, and flagging generic `name` autocomplete tokens would black out most of a form and leave the agent unable to operate — a deliberate, documented tradeoff. The demo ID card's "Jordan A. Demo" is readable in the transmitted screenshot. Values the agent fills *from your vault* are a separate case and **are** redacted, because their provenance is known rather than inferred.
- **Capture has returned a stale frame at least three times.** A detector now catches the byte-identical-while-scrolled case and fails the step closed rather than transmitting an image that doesn't match the DOM — browser-verified 2026-09-20. A second check, for an older frame resurfacing, is built but not yet browser-verified. One observed case is caught by neither, and the mechanism remains unestablished. Tracked in `CLAUDE.md`.
- **One iframe deep.** DOM scanning and redaction cover the top-level page plus one level of iframe nesting — the realistic case of a payment provider's frame sitting directly in a checkout page. An iframe nested inside another iframe is not covered.
- **Never run against a real website.** Every browser verification to date is against this project's own demo fixtures. The hardening was designed for real pages — hundreds of actionable elements, third-party ad frames — but has not yet met one. An observe-only backend exists specifically so that test can be run without an autonomous agent clicking anything.
- **Firefox is untouched.** Scoped from the start as a post-integration pass.
- **Gemini's free tier may train on submitted data.** Acceptable here precisely because redaction happens client-side first — a provider that trains on this data still never receives a password, an email, or a face. That's the thesis working, not a compromise of it.

---

## Rubric mapping

| Criterion | Weight | Evidence |
|---|---|---|
| Visual context accuracy | 25% | On-device WebGPU detection, real boxes on the demo page |
| PII recall / precision | 20% | 37 fixture tests, recall-biased, `value`/`placeholder` scanning |
| Redaction precision | 20% | 32 tests with pixel-level verification; DOM + vision regions merged |
| Client resource utilization | 20% | 33–63 MB peak heap (5 runs, typically 33–37 MB with one 63 MB outlier), instrumented per stage |
| End-to-end latency | 15% | ~2,350–2,700 ms detection (5 samples, Chrome/WebGPU/mock backend, warm, 2026-09-20–21) — an earlier 2026-09-11 session measured 784–881 ms on this machine; that has not reproduced and the cause is not established; per-stage timings in every run summary |
