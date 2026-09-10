# demo/ — Phase 4 (`integration-loop`) end-to-end walkthrough

**Nothing in this phase has been run in a browser by the authoring agent
— no browser automation was available.** Everything below is mechanically
verified: `manifest.json` parses, every `.js` file (including the new
`content.js`, the `background.js` additions, and `popup.js`) passes
`node --check`, and all 151 pre-existing unit tests (65 pytest + 86
Node `node:test`) still pass unchanged. The FastAPI server itself was
started locally and curl-tested (CORS headers present, `/analyze` returns
a valid action against a fixture payload) — see the report for the exact
commands. **The actual in-browser loop needs Varun.** Follow this file
exactly, then paste back the console lines requested at the end.

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
no Ollama, no model pull needed for this demo.

Quick sanity check in a second terminal:
```bash
curl http://127.0.0.1:8000/health
# expect: {"status":"ok"}
```

## 2. Load the extension in Chrome

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
send → act, stopping early once the mock backend replies `"done"`.

### What should happen on this specific page, and why

The mock VLM backend (`server/vlm_client.py::MockVLMClient`) is a
deterministic, stateless rule — not real visual reasoning — so this page
was built to walk it through a specific 3-step sequence rather than leave
that to chance:

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
