# extension/ — Phase 1 (`extension-scaffold`)

MV3 extension shell: manifest, background service worker, offscreen
inference document wired to Phase 0's confirmed `Xenova/yolos-tiny` +
WebGPU inference call, popup for task-goal input, and a content-script
stub. Built per `CLAUDE.md` Section 4, Phase 1.

**Nothing in this directory has been run in a browser by the authoring
agent — no browser automation was available.** Everything below is
mechanically verified (manifest parses, all JS passes `node --check`,
the offscreen bundle builds cleanly, every path referenced by manifest/
HTML/JS exists on disk with the expected byte count). The actual
in-browser round trip needs Varun. This file exists to make that check
fast and unambiguous — follow it exactly, then paste back the console
lines requested at the end.

---

## 0. Fresh clone setup — fetching the gitignored ML binaries

`extension/models/`, `extension/ort/`, and `extension/offscreen.bundle.js` are gitignored EXCEPT for two
files under `extension/models/ultraface/` that `.gitignore` carves back out with a `!` negation (see the
"Vendored ML binaries" comment near line 30 of the repo-root `.gitignore`) because one of them is a
**derived** file with no upstream URL to re-fetch — see "Tracked vs fetched" below. Everything else is
~64 MB of ONNX weights and ONNX Runtime Web binaries that get swapped as the detector changes, so keeping
them out of history was a deliberate call. A fresh clone is missing the fetched files until you run:

```bash
cd extension
npm install
node scripts/fetch-assets.mjs
```

This fetches the 8 non-tracked files, verifies all 10 (8 fetched + 2 tracked-in-place) against
`extension/scripts/assets.lock.json` (a sha256 manifest generated from the files already in this working
copy via `--gen-lock` — see the header comment in `fetch-assets.mjs` for every flag), and on a clean verify
runs `npm run build` for you. **With no flags, on a normal checkout, this reports 0 mismatches.** It is
safe to re-run: a destination file that already exists on disk is never downloaded, overwritten, or
deleted — only missing fetched files are fetched, and tracked files are only ever read. Pass `--dest <dir>`
to fetch the non-tracked files into a scratch directory instead of `extension/{models,ort}` (useful for CI
or for checking upstream without touching real assets — tracked files are still verified against the real
`extension/` tree, since there's nothing to fetch for them), or `--verify-only` to just hash what's on disk
with nothing fetched or built.

### Fetched vs tracked

| Files | Fetched from | Verified |
|---|---|---|
| `models/Xenova/yolos-tiny/{onnx/model.onnx,config.json,preprocessor_config.json}` | Hugging Face Hub, `Xenova/yolos-tiny` `resolve/main/...` — the same approach `spike/README.md` documents for the V1 detector | **byte-identical**, all 3 files |
| `ort/ort-wasm-simd-threaded.jsep.{mjs,wasm}` | `onnxruntime-web@1.22.0-dev.20250409-89f8206ba4` (npm/jsdelivr) — the exact transitive dependency `@huggingface/transformers@3.8.1` pins in `package-lock.json`, and the only build that package ships (jsep-enabled; see `spikes/ultraface/RESULT.md` line 30) | **byte-identical**, both files, and identical to `node_modules/onnxruntime-web/dist/` at that pinned version |
| `ort/ort-wasm-simd-threaded.wasm`, `ort/ort-wasm-simd-threaded.mjs`, `ort/ort.wasm.min.mjs` | `onnxruntime-web@1.23.2` (npm/jsdelivr) — the plain, non-jsep runtime added for the raw `onnxruntime-web` UltraFace path in `offscreen.entry.js` (`@huggingface/transformers` ships only the jsep build, so this trio came from `onnxruntime-web` directly) | **byte-identical**, all three files |

| Files | Tracked in git because... | Upstream reference (for provenance only — never fetched) |
|---|---|---|
| `models/ultraface/ultraface-rfb320.onnx` | it's a **derived** file: `sih-2026`'s `scripts/optimize-vision-model.py` produced it from the upstream ONNX below, so it was never going to be byte-identical to any upstream URL, fetched or not | `Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB`, `models/onnx/version-RFB-320.onnx`, commit `dffdddda9794a50607cba8f318507a28c1c27cab` — **1,270,727 bytes**, sha256 `34cd7e60aeff28744c657de7a3dc64e872d506741de66987f3426f2b79f88017`. The tracked, optimized copy is **1,257,907 bytes**, sha256 `22bd2fbe053a8e54d54b44b25901f0f6260059ac9ae7d3cc8720f5f7c0d936fa` |
| `models/ultraface/ULTRAFACE-LICENSE.txt` | ships alongside the model above rather than being re-fetched separately | same repo/commit, `LICENSE` — text byte-identical |

`fetch-assets.mjs` never downloads the two tracked files — it only sha256-verifies them in place against
`assets.lock.json`, on every mode including `--dest`. A tracked file drifting from the lock (edited without
regenerating it, or vice versa) is reported as a mismatch distinctly from an upstream-provenance gap; a
tracked file missing from `extension/` entirely (e.g. a shallow/partial checkout) is reported as missing
and pointed at `git checkout -- <path>`, never silently re-derived or downloaded. Both tracked files are
covered by a `.gitattributes` entry (`extension/models/ultraface/* -text`) so git never normalizes their
line endings on checkout — see the correction directly below for why that matters.

### Correction, 2026-09-27 — the earlier "hand-applied patch" claim on the ORT glue files was wrong

An earlier revision of this file (and of `fetch-assets.mjs`/`assets.lock.json`) reported
`ort/ort-wasm-simd-threaded.mjs` and `ort/ort.wasm.min.mjs` as differing from `onnxruntime-web@1.23.2`'s
published files by 68 and 7 bytes respectively, and — wrongly — attributed that to a small hand-applied
patch, tracking both files in git as a result. **The real cause: both diffs were exactly the file's CR
(`\r`, byte `0x0D`) count** — 68 CRs in the `.mjs`, 7 in `ort.wasm.min.mjs` — i.e. a Windows CRLF conversion
of a plain copy, not a patch. Stripping every `\r` from the then-local files produced an exact byte match to
the upstream (LF) originals. The same mechanism explained `ULTRAFACE-LICENSE.txt`'s 21-byte diff (21 CRs)
from the start, correctly identified as benign at the time — the ORT glue files just weren't checked against
the same explanation.

**Fixed:** both glue files were replaced with the exact upstream (LF) bytes, the `.gitignore` exception for
them was reverted (they fetch normally again, verified byte-identical), and `fetch-assets.mjs`/
`assets.lock.json` no longer mark them `tracked`. Only the two files with a genuine, non-CRLF reason to be
tracked — the derived UltraFace model and its license — remain in git.

---

## 1. Load it — exact steps

1. Open Chrome, go to `chrome://extensions`.
2. Turn on **Developer mode** (top-right toggle), if not already on.
3. Click **Load unpacked**.
4. Select the `extension/` folder (the one containing `manifest.json` —
   not the repo root, not `extension/src/`).
5. **Check for a red error banner on the extension's card immediately.**
   If you see one, the manifest or a referenced file failed to load —
   copy the exact error text, that's the first thing to report back.
6. The card should read "Dhristi - A Privacy-Preserving Browser Tool".
   Chrome will show a permissions notice mentioning access to all sites
   (from `content_scripts.matches: ["<all_urls>"]` — expected; see
   §4 "Design decisions" for why) and "Read your browsing history" /
   similar (from `activeTab` + `scripting` — also expected).

## 2. Check the background service worker console (self-test)

On the extension's card, under its details, look for a small link
**"Inspect views: service worker"**. Click it — this opens DevTools
scoped to `background.js`.

On install, `background.js` automatically runs a **self-test**: it
creates the offscreen document, loads the bundled `assets/test-image.jpg`
(the same COCO cats/remotes/couch photo used throughout Phase 0), and
runs one full `DETECT_OBJECTS` round trip against it — no tab capture,
no user interaction needed. This is the most direct proof of this
module's checkpoint ("offscreen doc round-trips a test detection").

**Look for this exact sequence, in order:**
```
[background] onInstalled -- setting up offscreen document and running self-test.
[background] self-test: ensuring offscreen document...
[background] offscreen document created.
[background] self-test: bundled test image loaded, requesting detection (first run loads the model -- ...)...
[background] SELF-TEST PASSED in <N>ms -- <count> detection(s):
[ ... JSON array of {label, score, xmin, ymin, xmax, ymax} ... ]
```
The first run includes model load time — Phase 0 measured cold WebGPU
load+inference at up to 14,097ms and warm inference alone at 8,432ms
(`CLAUDE.md`, "PHASE 0 CLOSED"). **Give it at least 20-30 seconds before
concluding it hung.**

**If you instead see `[background] SELF-TEST FAILED: <message>`** — copy
that full line plus the stack trace Chrome prints immediately after it
(`console.error(err)` on the next line). Do not paraphrase it.

## 3. Check the offscreen document console (the real detail)

Back on the extension's card, look for a second link, **"Inspect views:
offscreen.html"** (it may take a second or two to appear after step 2
starts — the offscreen document is created on demand). Click it. All the
`[offscreen]`-prefixed lines are the actual model-loading and inference
detail; the background console only shows the summary.

**Look for this sequence:**
```
[offscreen] config: env.backends.onnx.wasm.wasmPaths = chrome-extension://<id>/ort/
[offscreen] config: env.localModelPath = chrome-extension://<id>/models/
[offscreen] config: env.allowLocalModels = true | env.allowRemoteModels = false
[offscreen] loading pipeline: device=webgpu dtype=fp32 ...
[offscreen] pipeline loaded on webgpu in <N>ms
[offscreen] DETECT_OBJECTS req-... received (device so far: not loaded yet)
[offscreen] DETECT_OBJECTS req-... OK in <N>ms on device=webgpu, <count> detection(s)
```

**Specifically watch for these failure signatures** (each one points at
a different mandatory carry-over from Phase 0 that would have regressed):
- `Failed to fetch dynamically imported module` → the CSP/CDN-blocking
  failure from Phase 0 retry 1. Would mean `env.backends.onnx.wasm.wasmPaths`
  isn't taking effect before the first `pipeline()` call.
- `allowRemoteModels=false, but attempted to load a remote file from: ...`
  → names the exact missing local file. Would mean a model asset didn't
  bundle correctly (check the path it names exists under `extension/models/`).
- `pipeline loaded on wasm (fallback)` instead of `webgpu` → not
  necessarily a bug (Section 5: WebGPU is a speed optimization, not a
  dependency, and this fallback path was NEVER exercised in Phase 0's
  browser runs — see §4 below), but it's a real behavior change worth
  reporting: it means WebGPU failed to initialize on this machine, and
  inference will be far slower (~33s per Phase 0's wasm/fp32 number vs
  ~8.4s on webgpu).

## 4. Interactive check via the popup

Click the extension's icon in the toolbar (pin it first via the puzzle-
piece menu if it's hidden).
- Type anything into the **Task Goal** box, click **Save Task**. You
  should see "Saved at HH:MM:SS." appear underneath.
- Click **Run Test Detection on Current Tab**. This captures whatever
  tab is currently active (via `activeTab` + `chrome.tabs.captureVisibleTab`)
  and runs it through the same `DETECT_OBJECTS` pipeline as the self-test.
  Wait for it — the button disables itself while running. You should see
  either `OK in <N>ms -- <count> detection(s):` followed by a JSON box
  array, or an `ERROR: ...` line.

## What to paste back

1. Whether step 1's card showed a red error banner (and its exact text,
   if so).
2. The full self-test block from §2 (PASSED with its JSON, or FAILED
   with its full error).
3. The full offscreen console block from §3, from `config: env...` down
   through the first `DETECT_OBJECTS ... OK` (or its FAILED line).
4. Whether §4's popup test succeeded, and what device it reported
   (visible in the offscreen console line right above the popup's
   result).

That's enough to confirm or refute this module's checkpoint. If
everything above passes, Phase 2a/2b/3 can be delegated.

**Harmless noise you may also see:** `content.js`'s stub listener runs on
every open tab and receives every extension-wide broadcast (including
`SET_TASK_GOAL`/`RUN_TEST_DETECTION`/`DETECT_OBJECTS`/`DETECTION_RESULT`,
since `chrome.runtime.onMessage` fires in all extension contexts, not
just the intended recipient). If you open a page's own DevTools console
while testing, you'll see repeated
`[content] received message (stub, no handler implemented yet): ...`
lines — that's expected and not an error; it's exactly what the stub is
for (§ "Content script" plug-in points).

---

## Message contract (CLAUDE.md Section 4, Phase 1)

### Background ↔ Offscreen (the contract downstream modules depend on)

```
→ { type: "DETECT_OBJECTS", requestId, imageData: base64 }
← { type: "DETECTION_RESULT", requestId, boxes: [{label, score, xmin, ymin, xmax, ymax}] }
← { type: "DETECTION_ERROR", requestId, error: { message: string, stage: "model_load"|"image_decode"|"inference"|"unknown" } }   -- Phase 1 addition, see below
```

- **`requestId`** is generated by `background.js` per call
  (`req-<timestamp>-<random>`) and is the correlation key. `background.js`
  keeps a `Map<requestId, {resolve, reject, timeoutId}>` — **concurrent
  in-flight requests are supported**, not assumed away. A reply with an
  unrecognized `requestId` (e.g. its timeout already fired) is silently
  ignored rather than erroring.
- **`imageData`** is raw base64, **no `data:` prefix** — `background.js`
  strips the prefix `chrome.tabs.captureVisibleTab()` returns before
  sending. `offscreen.entry.js` defensively strips it again if present
  (costs nothing, guards a future caller that doesn't strip it). Section
  4's contract only said "base64" without specifying this; flagging the
  interpretation here rather than leaving it implicit.
- **`DETECTION_ERROR` is a Phase 1 addition** — Section 4's contract only
  specified the success leg. A detection failure (model load failure,
  corrupt/undecodable image, an inference-time exception) must not hang
  the caller forever; every failure path replies with this shape.
  `stage` tells you *where* it failed without needing to parse the
  message string. **`background.js` also has a 60-second hard timeout**
  independent of this message — if the offscreen document crashes,
  never loads, or the message never arrives at all, `detectObjects()`
  still rejects instead of hanging. 60s was chosen as generous headroom
  over Phase 0's measured 8,432ms *warm* median (cold load measured up
  to 14,097ms) — not itself re-measured in this browser.
- Delivery is fire-and-forget in both directions (a `sendMessage()` that
  finds no listener, or a listener that finds an unknown `requestId`,
  both just log-and-return rather than throwing) — this matches the
  contract's arrows literally (no synchronous `sendResponse` leg is
  specified) and is what makes the requestId-based correlation necessary
  in the first place.

### Popup ↔ Background (not specified in CLAUDE.md — a Phase 1 addition, scoped entirely within this module)

```
→ { type: "SET_TASK_GOAL", goal: string }
← { type: "TASK_GOAL_SAVED", goal: string, savedAt: number }

→ { type: "RUN_TEST_DETECTION" }
← { type: "TEST_DETECTION_RESULT", boxes: [...], elapsedMs: number }
← { type: "TEST_DETECTION_ERROR", error: string }
```
`taskGoal` is persisted via `browser.storage.local` under the key
`taskGoal` — a plain string, trimmed, no schema beyond that. This is a
Phase 1-internal design choice (the popup's own job per Section 4), not
part of the Section 4 contract Phase 2a/2b/3/4 depend on — but Phase 4
(`integration-loop`) will need to read this same `chrome.storage.local`
key when it wires the task goal into the `/analyze` request's `taskGoal`
field (`server/schemas.py`'s `AnalyzeRequest.taskGoal`). Flagging the key
name (`taskGoal`) now so Phase 4 doesn't have to guess it or invent a
different one.

---

## Design decisions made in this module (flagged, not silent)

1. **Score threshold = 0.5**, not the library's default 0.9. CLAUDE.md
   never specifies a Phase 1 threshold; every Phase 0 spike run used 0.5
   "to see more candidate boxes for verification" and explicitly punted
   the real decision to whoever builds Phase 1. Kept 0.5 for continuity
   with the only numbers this project has ever measured for this
   model+config. Revisit once Phase 2b (redaction) has an opinion on
   false-positive tolerance for vision-sourced boxes.

2. **The WASM fallback path is untested in-browser.** CLAUDE.md Section
   5 requires "every inference call must degrade to WASM, not fail," and
   `offscreen.entry.js` implements that (try webgpu, catch, retry with
   `{device: "wasm"}`). But every single Phase 0 browser run had WebGPU
   succeed on the first attempt — the fallback branch has literally never
   executed. It's architecturally sound (mirrors the try/catch pattern
   Phase 0's own README recommended) but is DESIGN, not VERIFIED
   behavior. If you want to prove it, one way is temporarily disabling
   WebGPU (e.g. `chrome://flags/#enable-unsafe-webgpu` off, or a machine
   without a WebGPU-capable GPU) and re-running the self-test — expect
   `pipeline loaded on wasm (fallback)` in the offscreen console and a
   much slower detection (Phase 0's wasm+fp32 number was 33,576ms
   median warm — 4x slower than webgpu).

3. **`webextension-polyfill` is vendored as a UMD build, not bundled with
   esbuild into each entry point.** Only `offscreen.entry.js` strictly
   needs esbuild (mandatory carry-over #6 — transformers.js's
   bare-specifier imports). `content.js`/`popup.js` load it via a plain
   `<script src="vendor/browser-polyfill.js">` tag (or a manifest
   `content_scripts.js` array entry) before their own script — both are
   classic scripts. `chrome.offscreen.createDocument` and
   `chrome.runtime.onInstalled`/`onStartup` are deliberately left as
   native `chrome.*` calls (no Firefox equivalent exists for
   `chrome.offscreen` — this is the intended future branch point for the
   Firefox retrofit pass CLAUDE.md describes).

   **CORRECTION (superseded design, kept for history):** `background.js`
   was originally declared as a **classic** (non-module) service worker
   specifically so it could `importScripts("vendor/browser-polyfill.js")`,
   with the five `lib/*.js` helper modules (`run-registry.js`,
   `action-describe.js`, `error-messages.js`, `server-url.js`,
   `capture-plan.js`) loaded via `await import(chrome.runtime.getURL(...))`
   inside a `loadHelperLibs()` function. **This was broken in production**
   — dynamic `import()` is disallowed inside `ServiceWorkerGlobalScope` by
   the HTML spec (Chrome: `Uncaught TypeError: import() is disallowed on
   ServiceWorkerGlobalScope`; see
   https://github.com/w3c/ServiceWorker/issues/1356), so the service
   worker never started. `background.js` is now declared as a **MODULE**
   service worker (`manifest.json`'s `background.type: "module"`), loads
   the polyfill via a static side-effect `import "./vendor/browser-polyfill.js"`
   (module workers have no `importScripts()`), and loads all five helper
   libs via static top-level `import * as X from "./lib/x.js"` instead of
   `loadHelperLibs()`, which no longer exists. `content.js` is unaffected
   — it is a content script (a regular document context, not a service
   worker), where dynamic `import()` is legitimate and still used for its
   own six dynamically-loaded libs.

4. **`content_scripts.matches` is `<all_urls>`.** This is the broadest
   possible content-script permission and Chrome will show a
   correspondingly broad install warning. It's necessary because this
   extension's entire purpose is a browser agent that must observe/act
   on arbitrary pages (Phase 2a/3's whole job) — there's no narrower
   pattern that doesn't defeat the point. Flagging it as a real,
   disclosed tradeoff rather than something decided silently, consistent
   with the spike's own disclosure culture around the model bundle size.

5. **Self-test on install, in addition to the popup's interactive test.**
   Section 4 doesn't ask for either explicitly (it only specifies the
   background↔offscreen message contract). Added because the module's
   own checkpoint ("offscreen doc round-trips a test detection") needs a
   way to prove that round trip that doesn't depend on the popup UI
   working correctly too — the self-test isolates the one thing this
   checkpoint actually cares about into a single, deterministic,
   zero-interaction console trace.

6. **`activeTab` (not the broader `tabs` permission or `<all_urls>` host
   permission) for `captureVisibleTab`.** Sufficient because the capture
   is always triggered by a user gesture on the popup (clicking "Run Test
   Detection"), which is exactly what `activeTab` is designed to cover —
   least-privilege given Section 5's overall privacy framing, even though
   `content_scripts.matches` above already requests the broader
   always-on access for a different reason.

7. **`"scripting"` permission is declared but unused by any Phase 1
   code.** The role brief said "activeTab/tabs and scripting as needed
   for captureVisibleTab" — Phase 1's own capture flow doesn't call
   `chrome.scripting`, but Phase 2a/3 (programmatic content-script
   re-injection, or `executeScript` calls to run DOM queries on demand)
   plausibly will. Declared now rather than deferred so those modules
   don't need a manifest permission change (and a corresponding
   re-approval of the unpacked extension) just to add their own logic.
   If this guess is wrong and neither module ends up needing it, it's a
   one-line removal.

---

## Bundle size

```
21M   ort/            (ORT WASM runtime — copied verbatim from spike/chrome-harness/ort/, not re-downloaded)
26M   models/          (Xenova/yolos-tiny fp32 only — config.json 4,145B + preprocessor_config.json 457B + onnx/model.onnx 26,227,993B; q8 deliberately NOT bundled, retired in Phase 0)
172K  assets/          (test-image.jpg, for the install self-test)
2.0M  offscreen.bundle.js  (esbuild --bundle output of src/offscreen.entry.js)
40K   vendor/          (webextension-polyfill UMD build)
~28K  manifest.json, background.js, content.js, popup.html, popup.js, offscreen.html
---
~50.2M total shippable footprint (50,159,007 bytes exact, excludes node_modules/, src/, package*.json — build-only, not loaded by Chrome)
```
Every individual file stays under GitHub's 50MiB soft-warning threshold
(largest is `model.onnx` at 26.2MB); total crosses 50MB but there is no
hard limit on total repo size the way there is per-file. `extension/models/`,
`extension/ort/`, and `extension/offscreen.bundle.js` are already listed
in the repo's `.gitignore` (pre-existing, matches the same pattern used
for `spike/chrome-harness/`) — re-fetch/rebuild per this file's
instructions rather than expecting them in git history:
```
cd extension && npm install
npm run build                    # rebuilds offscreen.bundle.js from src/offscreen.entry.js
# models/ and ort/ are fetched/copied once — see the commands used to
# produce them in this module's delegation report; re-run the equivalent
# curl/cp commands if you need to regenerate this directory from scratch.
```

---

## What was verified mechanically (this agent) vs. what needs Varun (browser)

**Verified mechanically:**
- `manifest.json` parses as valid JSON (`node -e "require('./manifest.json')"`).
- Every `.js` file (`background.js`, `content.js`, `popup.js`,
  `offscreen.bundle.js`, `vendor/browser-polyfill.js`) passes `node --check`.
- `src/offscreen.entry.js` passes `node --check` and builds cleanly via
  `esbuild --bundle` with no errors/warnings beyond the expected 2.0MB
  size notice.
- Every file path referenced by `manifest.json`, `offscreen.html`, and
  `popup.html` exists on disk.
- Every runtime resource path `offscreen.entry.js`/`background.js`
  construct via `chrome.runtime.getURL(...)` (`ort/*.mjs`, `ort/*.wasm`,
  `models/Xenova/yolos-tiny/{config.json,preprocessor_config.json,onnx/model.onnx}`,
  `assets/test-image.jpg`) exists on disk, with byte counts matching the
  live Hugging Face API's `Content-Length` headers (re-verified fresh,
  not assumed from Phase 0's numbers — see the delegation report for the
  exact `curl -sSIL` output).
- The compiled `offscreen.bundle.js` contains the string
  `Xenova/yolos-tiny` (confirms the model ID actually made it into the
  bundle, not silently dropped by tree-shaking or a typo).

**NOT verified — needs Varun, per §1-4 above:**
- The manifest actually loads in Chrome without a console error.
- `navigator.gpu` / WebGPU actually initializes inside this specific
  offscreen document (Phase 0 verified this for the harness's manifest;
  this is a new, structurally similar but not byte-identical manifest —
  re-verify, don't assume the harness's result carries over unchanged).
- The self-test round trip actually completes and returns real
  detections.
- The popup's interactive test round trip.
- The WASM fallback path (see Design decision #2 above) — not exercised
  by any check in this delegation at all.
