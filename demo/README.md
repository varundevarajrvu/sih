# demo/ — Phase 4 (`integration-loop`) end-to-end walkthrough

**STATUS: the full loop has already been run successfully in a real
Chrome browser against a real Gemini backend** — `type`→`click`→`done`,
Section 5 verified against the real serialized payload, vision + DOM
redaction both confirmed. That run also surfaced two robustness gaps
(a transient 502 ending the whole run; ambiguous ~20x latency variance
between steps) which this round addresses: bounded retry with backoff
around the `/analyze` send, and instrumentation that separates
model-load time from inference time per step so the latency question has
a real answer instead of a guess.

**Everything in this round is mechanically verified only** (this agent
cannot run Chrome): `manifest.json` parses; `content.js`, `background.js`,
and `src/offscreen.entry.js` all pass `node --check`; `offscreen.bundle.js`
was rebuilt via `npm run build` and directly confirmed (by `grep`, not
just file mtime) to contain the new instrumentation fields; a standalone
harness exercised the retry loop's exact control-flow shape with
synthetic 400/429/502/503/network-failure responses (see the report) to
prove the Section 5 check re-runs on every attempt and that 4xx never
retries; and all 238 tests (148 pytest + 90 Node `node:test`) still pass
unchanged. **The actual in-browser re-run needs Varun** — see Section 7,
"This round's changes," below for exact steps, and paste back the console
lines requested there.

---

## 1. Start the local server

```bash
cd server
./.venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Leave this running. `extension/background.js` posts to
`http://localhost:8000/analyze` (hardcoded as `SERVER_URL` near the top of
that file — change that one line if you need a different port). The
server defaults to the mock VLM backend (`VLM_BACKEND` unset / `mock`) —
no Ollama, no model pull needed for a first sanity pass.

**To re-test against the real Gemini backend** (recommended for this
round, since that's what surfaced both bugs this round fixes), set the
env var before starting uvicorn instead:
```bash
cd server
GEMINI_API_KEY=your-key-here ./.venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
# PowerShell: $env:GEMINI_API_KEY="your-key-here"; ./.venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```
`VLM_BACKEND` defaults to `mock` when unset — you additionally need
`VLM_BACKEND=gemini` set (either exported alongside `GEMINI_API_KEY`, or
in the same line) for the server to actually call Gemini instead of the
deterministic mock.

Quick sanity check in a second terminal:
```bash
curl http://127.0.0.1:8000/health
# expect: {"status":"ok"}
```

## 2. Load (or RELOAD) the extension in Chrome

**If you already have this extension loaded from an earlier run: you
MUST reload it, not just re-click things.** `content.js`, `background.js`,
and `offscreen.bundle.js` (rebuilt from `src/offscreen.entry.js`) all
changed this round — an already-loaded extension is running the OLD code
in memory until you explicitly reload it. Go to `chrome://extensions` →
find this extension's card → click the **circular reload arrow** on the
card itself (not just refreshing the demo page). Then close and reopen
any `test-page.html` tab, since content scripts only inject on
navigation/load, not retroactively into an already-open tab.

First-time load:
1. `chrome://extensions` → enable **Developer mode** → **Load unpacked**
   → select the `extension/` folder (the one with `manifest.json`).
2. Check for a red error banner on the card. If you see one, stop here
   and report the exact text — that means the manifest or a referenced
   file (most likely one of this phase's new `web_accessible_resources`
   entries, `lib/dom-scanner.js` / `lib/redaction.js`) failed to resolve.
3. Click **"Inspect views: service worker"** on the card to open
   `background.js`'s console. On install it runs the same self-test Phase
   1 built (loads the model, runs one throwaway detection — this is also
   this phase's pre-warm, Ruling 5). Give it 20-30 seconds; expect
   `[background] SELF-TEST PASSED in <N>ms`. If this fails, stop here —
   nothing downstream will work without a working offscreen/WebGPU path.

## 3. Serve the demo page over HTTP (not `file://`)

Chrome extensions do **not** get access to `file://` pages unless you
separately enable "Allow access to file URLs" for this specific extension
in `chrome://extensions` (a manifest `matches: ["<all_urls>"]` entry does
**not** cover `file://` on its own — a real, easy-to-hit Chrome quirk, not
a bug in this build). Avoid that whole class of failure entirely by
serving the page over plain HTTP instead:

```bash
cd demo
python -m http.server 5500
```

Then open **`http://localhost:5500/test-page.html`** in the same Chrome
profile the extension is loaded in.

(If you'd rather use `file://`, the alternative is: `chrome://extensions`
→ this extension's **Details** → toggle **"Allow access to file URLs"**
→ reload the page. Either approach works; HTTP is just one less setting
to remember.)

## 4. Open the PAGE's own DevTools console

Right-click the `test-page.html` tab → **Inspect** → **Console** tab.
This is where `content.js` runs and logs — **not** the popup, and **not**
the background service worker console from step 2. Keep this open before
the next step.

Make sure the whole page (password/email/ID-number fields, the ID card
photo, and the "Full name" field) is visible without scrolling — capture
is `chrome.tabs.captureVisibleTab()`, i.e. the visible **viewport** only,
not the full scrollable page. The page is intentionally short/compact so
this should be true at any normal window size; resize if it isn't.

## 5. Run the loop

Click the extension's icon in the toolbar (pin it via the puzzle-piece
menu if hidden) → scroll to **"Phase 4: full agent loop"** → click
**Run Agent Loop**.

This message-relays through `background.js` to `test-page.html`'s content
script and runs up to 6 iterations of capture → detect → scan → redact →
send → act, stopping early once the backend replies `"done"`.

### What should happen on this specific page, and why

With the mock backend (`server/vlm_client.py::MockVLMClient` — a
deterministic, stateless rule, not real visual reasoning), this page was
built to walk it through a specific 3-step sequence rather than leave
that to chance. **The same 3-step shape (type → click → done) has already
been observed against the REAL Gemini backend too** (Full name typed with
a real value derived from the task goal, then Continue clicked) — the
page's structure, not the backend, is what drives the sequence:

1. **Step 1 — `type`.** Password/email/ID-number are all flagged
   sensitive and excluded; "Full name" is the only safe, empty, typeable
   field, so the mock targets it. `content.js` dispatches a real `input`
   event (native value setter, per `action-executor.js`) — the page's own
   inline script sees that real event, removes the "Full name" field, and
   reveals a **Continue** button.
2. **Step 2 — `click`.** "Full name" no longer exists in the next scan;
   "Continue" is the only remaining safe, non-sensitive actionable
   element, so the mock targets it. `content.js` dispatches a real click
   — the page's script removes the button and shows a "Thanks!" message.
3. **Step 3 — `done`.** Nothing safe/actionable remains (only the three
   still-sensitive fields) — the mock's final fallback returns `done`,
   and the loop stops itself.

If you see this exact `type` → `click` → `done` sequence, that is the
checkpoint: **a full click+type cycle, end to end, through capture,
on-device detection, DOM PII scanning, client-side redaction, the network
send, and real DOM action execution.**

## 6. What to paste back

Paste the **entire** block between these two lines from the **page's**
console (step 4), produced once per run by `content.js`'s instrumentation:

```
================ [agent-loop] RUN SUMMARY -- copy/paste everything between these two lines ================
... JSON ...
==============================================================================================================
```

Also paste, from the same console, every line starting with
`[agent-loop] Section 5 check PASSED` (one should appear per step, right
before that step's network send) — this is the client-side proof that the
outgoing payload never contained a raw password/email/Aadhaar value, not
just a status-code check.

If anything failed instead, paste:
- The exact `RUN_AGENT_LOOP_ERROR` text shown in the popup, and/or
- Any `[agent-loop] step N :: ... :: error: ...` line, and/or
- Anything printed in the **background** service worker console (step 2's
  DevTools) at the same time — `CAPTURE_AND_DETECT`/`ANALYZE` failures log
  there, not on the page.

That's enough to confirm or refute this phase's checkpoint.

---

## 7. This round's changes: retry on transient failures + latency diagnosis

### 7a. Retry: what to expect if the server hiccups

If the VLM backend (real Gemini, in particular) returns a transient
error, `content.js` now retries the `/analyze` send up to 3 times with
backoff (~1s, then ~2s, jittered) BEFORE giving up on that step. Look
for lines like:
```
[agent-loop] step 2 attempt 1 failed (VLM_BACKEND_CALL_FAILED) -- retrying in 1043ms
[agent-loop] step 2 attempt 2 failed (VLM_BACKEND_CALL_FAILED) -- retrying in 2187ms
```
followed by either a normal `send+response` success line (attempt 3
worked) or a final `analyze_failed` with `attempts: 3` in the RUN
SUMMARY's `steps` array (all 3 attempts failed — the step stops cleanly,
same as before, it just tried harder first). The RUN SUMMARY's `stages`
array will show multiple `send+response` entries for the SAME step
number when this happens (one per attempt, each carrying `attempt`,
`errorClass`, `retrying`, `nextDelayMs`) — that's what makes a slow step
legible as "retrying" instead of looking frozen.

**A real 502 from Gemini is exactly the scenario this was built for** —
if you can reproduce last run's `VLM_BACKEND_CALL_FAILED` failure, this
is the thing to watch: does step 2 now retry and (likely) succeed on
attempt 2 or 3, instead of ending the whole run?

**What should NOT retry:** if the server ever returns a 400 (e.g.
`PII_LEAK_DETECTED`) or a 422, you should see exactly ONE attempt, no
"retrying" line, and an immediate stop — retrying a deterministic client
error would just waste time and look like a bug, not a feature.

### 7b. Latency diagnosis: model-load vs. inference, and the teardown question

Last run measured `detect` at 20,970ms and 17,470ms across two steps of
the SAME run — both slow, which ruled out "just a cold first inference."
The working hypothesis was that MV3 evicts the service worker between
steps, tearing down the offscreen document (and its loaded model) so
every step pays a full reload.

**Research finding, not yet browser-confirmed:** Chrome's documented
offscreen-document behavior is that a document created with reasons other
than `AUDIO_PLAYBACK` (this extension uses `"WORKERS"`) is independent of
the service worker's lifecycle — SW idle-eviction alone should NOT close
it. This makes the SW-eviction mechanism, AS STATED, less likely to be
the direct cause — but this is research about Chrome's general documented
behavior, not something observed on your machine. The instrumentation
below is what actually answers it; **no keep-alive fix has been added
pre-emptively** — implementing one before confirming the cause would risk
masking whatever the real cause turns out to be.

Every step's RUN SUMMARY now includes THREE separate stage entries where
there used to be one `detect` entry:
```
"capture"     -- offscreenDocumentAlreadyExisted: true|false
"model-load"  -- durationMs, pipelineWasAlreadyLoaded: true|false, device
"inference"   -- durationMs, detections, detectMsTotal
```

**How to read the result:**
- `offscreenDocumentAlreadyExisted: false` on step 2+ → the offscreen
  document really is being recreated between steps (confirms the
  teardown half of the hypothesis).
- `pipelineWasAlreadyLoaded: false` on step 2+, with `model-load`'s
  `durationMs` close to the old ~8-20s figure → the model is really being
  reloaded every step (confirms the reload half).
- If BOTH are `true` on step 2+ but `inference`'s `durationMs` is still
  ~17-20s → the offscreen doc and pipeline persisted fine, and the real
  cause is inference itself getting slow (a different bug — e.g. memory
  pressure, WebGPU context degradation, or something about repeated
  calls) — **not** the stated hypothesis, and would need a different fix.
- If `offscreenDocumentAlreadyExisted` is `true` but `pipelineWasAlreadyLoaded`
  is `false` → the document survives but something resets
  `detectorPromise` inside it without a navigation (worth its own
  follow-up).

**Please paste, per step, the `capture`/`model-load`/`inference` entries
from the RUN SUMMARY** (or just the whole RUN SUMMARY block from step 6
above — it's all in there) — that is the actual answer, not a guess, and
the report on this fix explicitly says not to trust a hypothesis that
wasn't confirmed against real data.

---

## Troubleshooting

- **`ANALYZE_ERROR` with `status: 0` and a "Failed to fetch"-style
  message** — the server isn't running, or is on a different port than
  `background.js`'s hardcoded `SERVER_URL = "http://localhost:8000"`
  (see step 1).
- **Popup's "Run Agent Loop" immediately returns an error mentioning "no
  active tab" or "content script gave no response"** — `test-page.html`
  isn't the focused/active tab in the current window when you click the
  button, or the content script never injected on it (see step 3's
  `file://` note).
- **First run is very slow (~15-20s) before anything happens** — expected
  only if the pre-warm self-test (step 2) hasn't finished yet, or this is
  the very first inference since a full Chrome restart. Phase 1 measured
  cold load at up to 19,407ms vs ~8,432ms warm; Ruling 5's pre-warm
  targets exactly this, but it only helps once the self-test itself has
  completed.
- **`pipeline loaded on wasm (fallback)` in the offscreen console instead
  of `webgpu`** — not a bug (Section 5: WebGPU is a speed optimization,
  never a dependency), but expect a much slower run (Phase 0 measured
  ~33s wasm vs ~8.4s webgpu, warm).
- **A `SENSITIVE_TARGET_BLOCKED` error appears** — this would mean the
  mock backend targeted the password/email/ID-number field despite them
  being marked sensitive in the payload sent to it. `MockVLMClient`
  itself already skips sensitive/redacted nodes when choosing a target,
  so this should not happen against this exact demo page; if it does,
  that's a real finding to report, not something to work around by
  loosening the guard.

---

## License note on the ID card photo

`demo/assets/id-card-face.jpg` is "Face portrait (Unsplash).jpg" from
Wikimedia Commons, licensed **CC0 (public domain dedication)**, originally
sourced from Unsplash. Used here purely as a local test fixture (a
realistic human face is what makes `yolos-tiny`'s `person` class detection
actually fire — see `CLAUDE.md`'s Phase 2b RESULT "demo risk" note) — not
published or distributed anywhere beyond this repo.
