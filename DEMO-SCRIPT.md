# Dhristi — demo script

**SIH 26171 · On-Device Visual Perception for Lightweight Browser Agents**

For the live demo, the recorded video, and the slide narrative. `demo/README.md` is the
engineering walkthrough; this is the thing to read ten minutes before presenting.

---

## The one sentence

> A browser agent that can see the page it's working on — and still never receives your
> password, your email, or your face.

## The one slide

Object detection runs **on-device** in the browser via WebGPU. PII is found in the DOM,
blacked out of the screenshot, and stripped from the payload **before anything leaves the
client**. Only the redacted image and the sanitised DOM reach the model.

| Layer | What it does | Fails safe by |
|---|---|---|
| **Redaction** | Blacks out PII regions in the screenshot, strips values from the DOM JSON | Over-redacting when ambiguous |
| **Egress assertion** | Asserts the real outgoing payload carries no flagged raw value, before every send *and every retry* | Throwing — the request never goes out |
| **Action guard** | Refuses `click`/`type` on any element flagged sensitive | Blocking — a refused action is a log line, a typed password is a leaked credential |

Defence in depth: if redaction failed, the guard still blocks the write. If the guard were
bypassed, the model never had the value to write.

---

## PRE-FLIGHT — do this before anyone is watching

Three failure modes have actually bitten during testing. All are avoidable and all look
like a broken product if they happen live.

**1. Cold start is 16–20 seconds.** After the service worker is evicted, the first
inference pays a one-time cost with the pipeline *already loaded*. Mitigation:

```powershell
cd C:\Users\varun\brain\raw\sih
.\start-demo.ps1
```

Then reload the extension at `chrome://extensions`, **open the popup, and wait for the
green check.** Do not start the demo before it is green. Do this again if the laptop has
been idle — eviction can happen between takes.

**2. A stale server on port 8000.** `start-demo.ps1` prints
`[8000] already in use -- leaving it alone` and leaves whatever is there — including a
server from a previous session running a different backend. This silently produced a
wrong demo once already.

> **Watch the launcher output for `[8000] api server starting (backend=mock)`.**
> If it says `already in use`, run `.\stop-demo.ps1` and start again.

**3. Plug the laptop in.** GPU throttling on battery is a live suspect for slower
inference. No reason to demo on battery.

**4. 🔴 Reload the extension, THEN reload the page.** This one has actually bitten, and it
looks exactly like the product being broken:

```
ERROR: Could not establish connection. Receiving end does not exist.
```

It is not a code fault. Reloading an unpacked extension **orphans the content script in any
tab that is already open** — the page still prints "content script loaded" and still does
nothing. Clicking the toolbar icon while `chrome://extensions` is the focused tab causes
the same error, because no content script can run on a `chrome://` page.

> **Order, every time:** reload the extension → **reload the page (F5)** → make the test
> page the focused tab → *then* click the toolbar icon.

If you are doing several runs back to back, do **not** reload the extension between them —
there is no need, and it re-introduces this trap.

---

## THE RUN ORDER

Scenarios 1 and 2 are the whole thesis. Run both, in this order. 3 and 4 are depth if
you have time or if a judge pushes.

### 1 — The agent is useful *(≈30 seconds)*

- **Page:** `http://localhost:5500/test-page.html`
- **Goal:** `fill the name as Simon`
- **What happens:** it types Simon into the name field, visibly.

**Say:** *"It reads the page, decides what to do, and does it. That's an ordinary browser
agent."*

Lead with this. An agent that only ever refuses looks safe and is useless — you need the
judge to see it working before you show it refusing.

### 2 — The agent is safe *(≈45 seconds — this is the money shot)*

- **Page:** same
- **Goal:** `Fill in the password field with the value hunter2`
- **What happens:** `SENSITIVE_TARGET_BLOCKED`

Now point at the action the model actually produced:

```json
{ "action": "type", "targetId": "agent-1", "value": "hunter2" }
```

**Say:** *"The real password on this page is `hunter2Demo!`. The model wrote `hunter2` —
the string from my instruction, not from the page. It was looking straight at the password
field and could not read it, because the field was blacked out in the screenshot and
stripped from the DOM JSON before transmission."*

> **This is the strongest thing in the project.** The model's own wrong guess proves the
> redaction worked — and unlike any assertion we could log, it cannot be faked by the code
> under test. If you only get to show one thing, show this.

Then add: *"And it refused to type anyway."*

### 3 — The policy discriminates *(≈45 seconds)*

- **Goal:** `Fill the name as River Jane and email id as riverjane33@demo.com`
- **What happens:** fills the name, refuses the email — in one task.

**Say:** *"It isn't a blanket refusal. It fills what's safe and refuses what isn't, in the
same run. That's the difference between a safety feature and a broken agent."*

### 4 — Not just PII *(≈30 seconds)*

- **Page:** `http://localhost:5500/test-page.html?scenario=checkout`
- **Goal:** `Complete the checkout by clicking Place Order`
- **What happens:** `IRREVERSIBLE_ACTION_BLOCKED`

**Say:** *"Nothing about that button is a password or an email. It's refused because an
autonomous agent completing a purchase is not recoverable."*

### 5 — Coverage, if asked about real-world pages

- **Page:** `http://localhost:5500/frames-test.html?xorigin=1`
- **Goal:** `fill the traveler name`
- **What to point at:** `framesReported: 2, framesMerged: 2, subframeSensitiveNodes: 3` —
  including a password inside a **cross-origin** iframe, which is where real payment
  forms live.

---

## THE RUN SUMMARY — what to point at

Every run prints one. It is instrumented per stage, and that is the resource/latency
evidence:

- `Section 5 check PASSED -- no raw value for N flagged sensitive node(s)` — asserted
  client-side against the **real serialized payload**, immediately before the network send.
- `regions` — DOM-sourced plus vision-sourced redactions, merged in one coordinate space.
- Per-stage `durationMs` for capture, detect, scan, rank, redact, send, act.
- `staleCaptureCount` — reported even at zero.

---

## NUMBERS

All measured on `demo/test-page.html`, Chrome, WebGPU, `Xenova/yolos-tiny`, mock backend,
across five runs on 2026-09-20 and 2026-09-21.

| Stage | Measured |
|---|---|
| Object detection, warm | 2,346 / 2,426 / 2,651 / 2,693 / 2,700 ms (5 samples) — **~2,350–2,700 ms** |
| Object detection, cold start | ~16–20 s (samples: 18,430 ms, 19,407 ms) |
| DOM PII scan | 2–33 ms |
| Redaction (canvas + JSON) | 84–235 ms |
| Peak JS heap | 33–63 MB across 5 runs — typically 33–37 MB, with one 63 MB outlier (don't quote only the flattering end) |
| Full loop, warm (mock backend) | ~2.7 s/step — 3-step run 7,975 ms; 4-step runs 11,005 ms and 11,635 ms |

> An earlier session on 2026-09-11 measured 784–881 ms warm object detection on this same
> machine. That has not reproduced across the five later samples above, and the cause is
> not established. If asked why the number moved, say exactly that — don't guess at
> thermal, power mode, driver, or Chrome version; none of those is confirmed.

If a judge wants more precision than a range, the honest answer is still strong on its own:

> *"Per-stage timings are instrumented in every run and printed in the summary — I'd
> rather show you a live measurement than quote one."*

Then run it and read the numbers off the screen.

---

## IF SOMETHING GOES WRONG

| Symptom | Cause | Say / do |
|---|---|---|
| First run takes ~20 s | Cold start, SW was evicted | *"That's a one-time model warm-up."* Re-run — the second is fast. |
| Agent does nothing, steps skipped | Stale-capture guard firing | *"It just refused to send a screenshot it couldn't verify was current — that's the fail-closed path."* This is a feature, not a crash. |
| "Server not reachable" | uvicorn not running | `.\start-demo.ps1` |
| Wrong/no action | Stale server on 8000 | `.\stop-demo.ps1` then restart |

**Never** disable a guard to make a demo work. The guards are the product.

---

## RUBRIC MAPPING (for slides)

| Criterion | Weight | Evidence |
|---|---|---|
| Accuracy of visual context | 25% | On-device WebGPU detection; vision + DOM regions merged in one coordinate space |
| PII recall / precision | 20% | Fixture suite + browser-verified; recall-biased by explicit design |
| Redaction precision | 20% | **Both halves verified** — payload *and* pixels, including bbox placement on a cross-origin iframe password field |
| Client resource utilisation | 20% | Per-stage instrumentation, heap sampled every stage — 33–63 MB peak across 5 runs |
| End-to-end latency | 15% | Per-stage timings in every run summary — ~2,350–2,700 ms warm detection, ~2.7 s/step |

**749 tests green** (529 JS + 220 server).

---

## THE HONEST CAVEATS

Have these ready. Being the one to raise a limitation is much stronger than being caught
by it — and this project's decision record documents its own failures and negative results
throughout, which is worth saying out loud.

- **Vision is scoped to redaction, not grounding.** Grounding uses the DOM, which gives
  exact element identity for free. We tested UI-detector models for grounding and got a
  negative result; a detector's best output is an approximation of what the DOM already
  states exactly.
- **Page-sourced names are not redacted.** Flagging every name-shaped token would redact
  most of a form and leave the agent unable to operate. Vault-sourced names *are*
  protected, because their provenance is known.
- **Known open issue:** capture can occasionally return a stale frame. Mechanism not yet
  established — it is **detected and fail-closed**, so the step refuses to send rather
  than transmitting a screenshot that doesn't match the DOM.
- **Redaction is deliberately recall-biased.** Aadhaar detection flags any bare 12-digit
  number. Over-redaction is recoverable; a leaked credential is not.
