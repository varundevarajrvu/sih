# Phase 0 spike — does Xenova/yolos-tiny run via @huggingface/transformers, and how fast?

This is a spike, not a feature. It answers one question for CLAUDE.md Section 4,
Phase 0, and produces the interface contract Phase 1 (`extension-scaffold`) builds
against. Nothing here is a redaction feature, a popup, or a content script.

Two independent halves:

1. **`node-test.js` / `node-test-contract.js`** — runs in plain Node, no browser.
   Verified by this agent, results below.
2. **`chrome-harness/`** — a bare MV3 extension with an offscreen document.
   **NOT verified by this agent** — no browser automation was available.
   Varun must load it unpacked in Chrome and read the console himself.

---

## Part 1 — Node result (verified)

```
cd spike
npm install
npm run test-node            # cold vs warm latency, raw library output
npm run test-node-contract   # exact runDetection(imageBase64) contract, verified
```

**What happened:** the model downloaded, loaded, and returned correct detections
on the standard COCO "two cats + remotes on a couch" test image
(`assets/test-image.jpg`) — 2x `remote`, 2x `cat`, 1x `couch`, all with plausible
boxes and high scores (0.63–0.99). This is real, measured output, not simulated.

**Measured latency** (this machine, Node v24.15.0, onnxruntime-node CPU backend,
fp32, no quantization specified):

| Stage | Time |
|---|---|
| Model load (cold — includes first-time download from HF Hub) | 84,858.8 ms |
| First inference after load (cold) | 3,790.4 ms |
| Second inference, same process (warm) | 4,093.3 ms |
| 3 more warm runs | 3,905.6 / 3,703.9 / 3,507.3 ms |

**Gate check: FAIL.** CLAUDE.md's ~1s gate is measured on warm inference. Warm
runs here are consistently ~3.5–4.1s — **3.5–4x over the gate**, not close, and
not a one-off cold-start artifact (5 consecutive runs all land in that band).

**Important caveat on what this number means:** Node's default backend for
`@huggingface/transformers` is `onnxruntime-node` (native CPU bindings), not
literally `onnxruntime-web`'s WASM backend that runs in a browser tab. Native
CPU execution is generally *faster* than browser WASM (which for `transformers.js`
in a fresh page context typically runs single-threaded unless cross-origin
isolation is set up for WASM SIMD+threads). So treat 3.5–4s as an **optimistic
floor** for the real WASM path, not a pessimistic one — actual in-browser WASM
latency in the offscreen document could easily be equal or worse. This is
exactly the framing the assignment specified ("Node is an honest proxy for the
WASM backend") and it already fails the gate before any browser overhead is
added.

One more variable not explored here: the model loaded in default `fp32` dtype
(the console explicitly logs `dtype not specified for "model". Using the
default dtype (fp32)`). A quantized dtype (`q8`/`uint8`) would very likely be
faster and is a real, unexplored lever — but per the task's error-handling rule
("no swapping to a different model, no unapproved substitution"), that decision
belongs to whoever picks up Phase 1, not to this spike. Flagging it, not doing it.

---

## Part 2 — the interface contract Phase 1 builds against

CLAUDE.md states:
```
runDetection(imageBase64) -> [{label, score, xmin, ymin, xmax, ymax}]
```

**This is achievable, but the library does NOT return that shape natively —
Phase 1 must adapt it.** Verified by running the exact `runDetection(imageBase64)`
signature end-to-end in `node-test-contract.js` (base64 string in, matching
array out) against the library's real behavior and source
(`node_modules/@huggingface/transformers/src/pipelines.js`,
`ObjectDetectionPipeline._call`):

| Contract says | Library actually returns |
|---|---|
| Flat `{label, score, xmin, ymin, xmax, ymax}` | **Nested**: `{score, label, box: {xmin, ymin, xmax, ymax}}` — `box` is a sub-object, not flat fields. Phase 1 must destructure `box.xmin` etc. into top-level fields itself. |
| (implied absolute pixels) | Coordinates are absolute pixels **only if you pass `{ percentage: false }`** — this happens to also be the library's own default when the option is omitted, so the contract's implicit assumption holds either way. Passing `{ percentage: true }` instead gives 0–1 normalized floats. Be deliberate about this option; don't rely on silently inheriting the default. |
| (implied 0–1 probability) | Confirmed: `score` is a 0–1 float (e.g. `0.992`), not 0–100. Matches. |
| (implied `threshold` filtering) | Library defaults `threshold` to `0.9`. This spike used `0.5` to see more candidate boxes for verification. Phase 1 should pick its own threshold deliberately. |

**Adapter Phase 1 needs** (already written and tested in
`node-test-contract.js`, reusable as-is):
```js
raw.map((r) => ({
  label: r.label,
  score: r.score,
  xmin: r.box.xmin,
  ymin: r.box.ymin,
  xmax: r.box.xmax,
  ymax: r.box.ymax,
}));
```

**Node-only quirk found while building this** (does not affect the browser
harness): `RawImage.fromURL()` does not accept `data:` URIs under Node,
because the library's `getFile()` checks `env.useFS` (true in Node) before
checking the URL protocol, and `data:` isn't in its recognized protocol list
— it falls through to a filesystem-path branch and fails to find a file
literally named `data:image/...`. The portable fix, used in both
`node-test-contract.js` and `chrome-harness/src/offscreen.entry.js`, is to
decode the base64 to bytes and construct a `Blob`, then call
`RawImage.fromBlob(blob)` — this works identically in Node and in the browser.
In an actual browser, `RawImage.fromURL(dataUrl)` would likely have worked
directly (the Fetch API natively supports `data:`), but the Blob path is
used everywhere here for consistency and because it's what's actually verified.

---

## Part 3 — Chrome harness (UNVERIFIED — you must run this)

Everything below this line was built but **never executed in a real browser**.
The authoring agent has no browser automation and cannot read Chrome's
DevTools console. Do not treat this as passing until you've done the steps
below and seen real console output.

### What it is

- `chrome-harness/manifest.json` — MV3, `"offscreen"` permission only. No
  popup, no content script, no host of unrelated permissions.
- `chrome-harness/background.js` — the only thing it does is call
  `chrome.offscreen.createDocument(...)` on install/startup. All real work
  happens in the offscreen document.
- `chrome-harness/offscreen.html` — loads `offscreen.bundle.js` as a module
  script. Intentionally blank/inert page.
- `chrome-harness/offscreen.bundle.js` — the actual logic, esbuild-bundled
  from `chrome-harness/src/offscreen.entry.js`. Bundling was required because
  `@huggingface/transformers`'s browser build imports the bare specifiers
  `"onnxruntime-common"` / `"onnxruntime-web"`, which a raw `<script type="module">`
  cannot resolve, and MV3's CSP forbids loading either from a remote CDN as a
  `<script src>` anyway. To rebuild after editing the source:
  ```
  cd spike
  npm run build-chrome-harness
  ```
- `chrome-harness/assets/test-image.jpg` — same COCO test image used in the
  Node half, bundled locally so the harness doesn't depend on any other
  network fetch besides the model itself.

### What `offscreen.entry.js` does, in order

1. Logs whether `navigator.gpu` exists in this offscreen document at all —
   **this is the actual open question CLAUDE.md flags as the real risk**
   (offscreen-doc WebGPU support is not guaranteed even when the tab-level
   WebGPU works fine). If it's `undefined`, the harness goes straight to WASM.
2. If `navigator.gpu` exists, tries `pipeline("object-detection", "Xenova/yolos-tiny", { device: "webgpu" })`. On ANY failure it logs the error and falls back to `{ device: "wasm" }`. WebGPU is never a hard dependency, per CLAUDE.md Section 5.
3. Loads the bundled test image, converts it to a base64 string (to genuinely
   exercise the `runDetection(imageBase64)` contract signature, not just pass
   a Blob directly), and runs detection twice — cold then warm.
4. Logs, to the offscreen document's own console: which backend was actually
   used (`webgpu` or `wasm`), cold inference time, warm inference time, the
   pass/fail against the ~1s gate, and the full detection array in the
   contract's flat shape.

### Known unverified risk points — watch for these specifically

- **Network access for model weights.** `@huggingface/transformers` fetches
  ONNX/WASM binaries from `https://cdn.jsdelivr.net/npm/@huggingface/transformers@<version>/dist/`
  at runtime (confirmed in library source, `src/backends/onnx.js` — it sets
  this path automatically unless running in a service worker). This is a
  `fetch()` data request, not a `<script>` load, so it shouldn't be blocked by
  MV3's `script-src 'self' 'wasm-unsafe-eval'` CSP — but this has NOT been
  confirmed to actually succeed from inside an offscreen document. If it hangs
  or errors, that's the first thing to report back.
- **The `"WORKERS"` offscreen-document reason.** Chrome requires a `reasons[]`
  justification for offscreen documents from a fixed enum. `"WORKERS"` was
  picked because WASM SIMD+threads execution can use Web Workers, but this
  hasn't been confirmed as the "correct" or even accepted reason for this
  specific use case — if Chrome rejects document creation, check
  `background.js`'s own console for the rejection reason first.
- **`navigator.gpu` may simply not exist in an offscreen document**, independent
  of whether your machine/Chrome build supports WebGPU at all in normal tabs.
  This is the literal question Phase 0 exists to answer. Either outcome is a
  valid, useful result — report exactly what the log line says.

### How to load it and where to look — exact steps

1. Open Chrome, go to `chrome://extensions`.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select the folder `spike/chrome-harness` (the one containing
   `manifest.json` — not `spike/` itself).
5. The extension card for "SIH 26171 - Phase 0 webgpu-spike" appears. If
   Chrome shows an error banner on the card (red text), the manifest failed
   to load — read that error first, it means the harness didn't even start.
6. On that same extension card, look for a line of small links under the
   card's details, e.g. **"Inspect views: service worker"** and possibly
   **"offscreen.html"**. If you only see "service worker" and not
   "offscreen.html", the offscreen document may not have been created yet —
   click the **service worker** link first (opens its own DevTools) to check
   `background.js`'s console for creation errors, then go back to the
   extension card and check again for an "offscreen.html" link.
7. Click **"offscreen.html"** under Inspect views — this opens a separate
   DevTools window scoped to the offscreen document itself. **This is where
   all the real output is** — the model load, backend choice, and latency
   numbers are logged here, prefixed `[spike]`, not in the service worker's
   console.
8. Read the console top to bottom. Look specifically for these lines:
   - `navigator.gpu present in this offscreen document: true/false`
   - `WebGPU pipeline load succeeded...` or `WebGPU pipeline load FAILED, falling back to WASM...`
   - `BACKEND ACTUALLY USED: webgpu` or `wasm`
   - `COLD inference time (ms): ...`
   - `WARM inference time (ms): ...`
   - `~1s gate ... PASS` or `FAIL`
   - the full `DETECTIONS` JSON array
9. If nothing appears, or you see a red error instead, copy the **full**
   error text and stack trace — per CLAUDE.md Section 7, report exactly
   where and why it failed rather than guessing at a fix.

### If it works

You now know, for real, whether WebGPU is available inside a Chrome offscreen
document on this machine, and the actual WASM-fallback latency in a real
browser tab (comparable against the Node numbers above, which used a faster
native-CPU backend, not the same WASM path).

### If it doesn't work

Report the exact console output (or absence of one) back. Per CLAUDE.md
Section 7: do not swap models, do not abandon the offscreen architecture, do
not paper over the failure. An honest "this doesn't work, here's exactly
where and why" is a complete and successful spike result.
