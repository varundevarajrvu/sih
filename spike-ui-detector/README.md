# UI-element detector spike (follow-up to Phase 0 `webgpu-spike`)

**Question:** is there a UI-element detector (buttons, inputs, links, menus
in a screenshot) that actually runs in a Chrome MV3 offscreen document on
onnxruntime-web's WebGPU backend, at usable latency — and does it add
anything the DOM doesn't already give the agent for free?

**Short answer, stated up front:** two real candidates exist and both run a
verified forward pass in Node. One (`OmniParser icon_detect`) is architecturally
wrong for this job — single-class, low-confidence, tuned for icon-dense
app UI, not web forms. The other (`OpenDILab webpage_element_detection`)
is a genuinely good webpage-element detector with real semantic classes,
but at 98.7MiB it more than doubles the extension's current footprint, and
even where it works well, **it doesn't tell the agent anything actionable
that the DOM's `data-agent-id` walk doesn't already provide more precisely,
for free, with zero model cost.** Its one plausible unique value — catching
UI that isn't DOM-addressable at all (canvas/WebGL apps, flat-image
buttons) — isn't demonstrated here and isn't what either candidate is
tuned for. Full reasoning in "Does this add anything the DOM doesn't
already give us?" below. Neither candidate has been run in an actual
browser — see "What is NOT verified" before treating this as final.

This spike lives entirely in `spike-ui-detector/`. `extension/`, `server/`,
`spike/`, and `demo/` were read from (never written to) — `spike/` was
copied FROM (ORT runtime files), never modified, per instructions.

---

## 1. Candidates researched and verified

Per the task brief and Phase 0's own hard-won lesson ("`models.list()` /
a repo existing is NOT proof a model works... Phase 0 found ids that were
listed yet 404'd"), every candidate below was checked against the **live**
HF API (`huggingface.co/api/models/...`), and every ONNX file's byte size
was confirmed via `curl -IL` (`Content-Length`, following the LFS redirect
to the actual CDN object — a plain `curl -I` without `-L` returns the tiny
redirect page's own length, not the file's; caught and fixed during this
spike) **and** re-confirmed byte-exact after download (`wc -c`).

### Families searched

- **ScreenSpot** — this is a *benchmark dataset*, not a model family. Every
  HF hit under "screenspot" is either the dataset itself or a full VLM
  fine-tuned on it (Qwen2.5-VL-3B, Gemma-3n-E2B) — multi-GB text-generation
  models, not lightweight detectors. No exportable-to-ONNX detector exists
  under this name.
- **Ferret-UI** — confirmed via live API: `jadechoghari/Ferret-UI-Llama8b`
  (Llama-8B backbone) and `Ferret-UI-Gemma2b` (Gemma-2B backbone). Both are
  `image-text-to-text` VLMs, safetensors, multi-GB. Disqualified by scale
  alone — architecture class, not just size, rules these out; they are not
  detectors, they're grounding-capable chat models.
- **OmniParser** — Microsoft's real repos (`microsoft/OmniParser`,
  `microsoft/OmniParser-v2.0`) ship `icon_detect/model.pt` or
  `model.safetensors` (PyTorch/ultralytics-native, no ONNX). A **third-party
  ONNX conversion exists**: `onnx-community/OmniParser-icon_detect` (HF's
  own auto-convert bot org) — this is the one candidate benchmarked below.
- **UIED** — the original UIED project (Chunyang Chen et al.) is a
  traditional CV pipeline (OpenCV + OCR), not a deep model, and has no HF
  ONNX presence. Two unofficial DETR fine-tunes exist on the "UIED" name
  (`Satish678/UIED`, `Yethi/UIED_DETR`) — both are `pytorch_model.bin` only
  (no ONNX export), and both are DETR-family, i.e. the exact ViT-backbone
  architecture Phase 0 already proved fails the WebGPU gate
  (`Xenova/yolos-tiny`'s graph-splitting problem). Not worth exporting to
  test an architecture Phase 0 already falsified.
- **Other webpage/UI-element searches** — turned up
  `OpenDILabCommunity/webpage_element_detection` (benchmarked below) and
  `macpaw-research/yolov11l-ui-elements-detection` (real multi-class desktop
  UI detector — button/checkbox/dropdown/etc. per the Screen2AX dataset —
  but ships **only** as `ui-elements-detection.pt`, a raw Ultralytics
  YOLO11-**large** checkpoint, 51.2MB, no ONNX export anywhere. Converting
  it would require installing `torch` + `ultralytics` — neither present in
  this environment — purely to attempt an export for a research spike. Not
  done; flagged as a real candidate if this track is ever reopened with a
  Python toolchain budgeted for it, not silently dropped).

### The two candidates actually tested

| Candidate | Repo | Files (verified real, byte-exact) | Classes |
|---|---|---|---|
| **OmniParser icon_detect** | `onnx-community/OmniParser-icon_detect` | `onnx/model.onnx` fp32 = **12,136,163 bytes** (11.6MiB)<br>`onnx/model_quantized.onnx` uint8 = **3,226,354 bytes** (3.1MiB) | `nc=1`, `["icon"]` — confirmed via `microsoft/OmniParser-v2.0`'s own `icon_detect/model.yaml` (`nc: 1`). Single class: "is this a UI element", never "what kind". |
| **OpenDILab webpage_element_detection** | `OpenDILabCommunity/webpage_element_detection` | `web_detect_best_m.onnx` fp32 = **103,477,118 bytes** (98.7MiB) | `nc=8`: `button, field, heading, iframe, image, label, link, text` — confirmed via the ONNX file's own embedded ultralytics metadata (`metadata_props['names']`), not a guess or a README claim. |

Both are **YOLOv8** (`model_type: "yolov8"`, confirmed via `config.json` /
embedded metadata) — a pure CNN detector, **not** in transformers.js's
`pipeline("object-detection")` whitelist (`detr, rt_detr, rt_detr_v2,
rf_detr, d_fine, table-transformer, yolos` — confirmed in Phase 0's own
investigation). Both required raw `onnxruntime-node`/`onnxruntime-web`
inference with hand-written preprocessing and YOLO decode/NMS — exactly
what the task brief anticipated.

### Size, reported honestly and early

Neither candidate is anywhere near the 500MB disqualifying line, but they
are **not equivalent**:

- OmniParser fp32 (11.6MiB) or quantized (3.1MiB) is a small, easy addition
  on top of the extension's current ~48MB.
- OpenDILab (98.7MiB) **more than doubles** the extension's current
  footprint on its own, before the ~21MB ORT runtime it also needs. This is
  disclosed prominently, not buried — see "Recommendation" for what this
  costs against what it buys.
- `macpaw-research`'s YOLO11-large UI detector (real multi-class desktop-UI
  labels) has no ONNX export and was not converted (see above) — its size
  as a raw `.pt` is 51.2MB, but a YOLO11-**large** ONNX export would likely
  land close to OpenDILab's territory, not smaller; this is an estimate,
  not a verified number, and is flagged as such.

---

## 2. Node-first verification (per task brief: test here before any harness work)

Both models were downloaded, loaded via `onnxruntime-node` (CPU backend),
and run through a **real forward pass** — hand-written preprocessing, raw
inference, hand-written YOLOv8 decode + NMS — against a **real UI
screenshot**, not the COCO cats/couch photo Phase 0 used. The COCO image is
wrong for this question (no buttons, inputs, or links in it); instead this
spike captured `demo/test-page.html` (the project's own Phase 4 demo page —
read-only, via headless Chrome `--screenshot`, nothing in `demo/` was
modified) at 1280×1450, containing a password field, email field, a plain
text field, an ID-card image, and page text — genuinely representative
content for this question.

Run yourself: `npm install && npm run test-omniparser && npm run test-webpage-detect`
(or `node draw-boxes.js` for the annotated-image diagnostic described below).

### OmniParser icon_detect — results

**A real bug was hit and fixed, not glossed over.** The published
`preprocessor_config.json` declares `size_divisor: 16`, but this is a
3-level YOLOv8 FPN (strides 8/16/32) — unless **both** resized dimensions
are exact multiples of **32**, the repeated floor(x/2) downsamples and
nearest-2x upsamples at the P5→P4 skip connection land 1px off, and ONNX
Runtime throws a hard `Concat`/`Resize` shape-mismatch error. Confirmed
empirically: divisor 16 → resize to 560×640 → crash (`560/32=17.5`);
divisor 32 → resize to 576×640 → runs clean. The published config is
misleading on its own; `node-test-omniparser.js` documents and works
around this.

| Config | Load | Cold | Warm (3 runs) | Median warm | Detections (thr=0.3) |
|---|---|---|---|---|---|
| fp32 | 176ms | 47ms | 46.5 / 43.8 / 47.4ms | **46.5ms** | 2 |
| quantized (uint8) | 603ms | 121ms | 131.7 / 128.5 / 128.9ms | **128.9ms** | 0 |

(Second run, after a code refactor, reproduced the same shape: fp32
median 70ms, q8 median 236ms — absolute numbers vary run to run on a
shared dev machine, the **pattern** — fp32 fast and more confident, q8
slower AND less confident — is consistent both times.)

**q8 is dominated, again — same pattern Phase 0 found with `yolos-tiny`.**
At the *same* threshold (0.3) fp32 found 2 elements and q8 found 0. Lowering
q8's threshold to 0.1 recovers 5 detections vs fp32's 6 at the same
threshold — q8 needs a lower bar to find roughly the same things, i.e. it's
throwing away real confidence signal, not just noise. Consistent with
Phase 0's ruling: "q8 is DOMINATED — do not ship it."

**Detection quality on a real web form is weak.** Threshold sweep on fp32:

| Threshold | Raw candidates (pre-NMS) | After NMS |
|---|---|---|
| 0.05 | 54 | 9 |
| 0.1 | 32 | 6 |
| 0.2 | 15 | 4 |
| 0.3 | 5 | 2 |

At 0.3 (a normal operating threshold), the model returns exactly 2 boxes,
both roughly 600px-wide horizontal bands — closer to "there's a UI panel
around here" than "there's a button/input here." See
`assets/annotated-omniparser.png` for the visual: boxes at threshold 0.1
cover whole card panels (one box spans the entire "ID CARD ON FILE" panel
rather than isolating the photo), all labeled generically `icon` with
confidence never exceeding 0.52. This matches the architecture: OmniParser
was trained on OS/app/mobile screenshots that are icon-dense (toolbars,
system trays), not plain HTML forms with large text inputs — real domain
mismatch, not a bug in this harness.

### OpenDILab webpage_element_detection — results

| Config | Load | Cold | Warm (3 runs) | Median warm | Detections (thr=0.25) |
|---|---|---|---|---|---|
| fp32 | 754ms | 697ms | 960.8 / 914.4 / 930.5ms | **930.5ms** | 15 |

**This is the more real result of the two.** `assets/annotated-webpage-detect.png`
shows it visually: the model puts a tight `field` (green) box around **all
three** real input elements (password, email, ID-number) with scores
0.53–0.82, and a tight `image` (magenta) box around the ID-card photo at
0.93 confidence — both genuinely accurate, both the right semantic label.
`text` and `heading` also fire correctly on paragraph and section-heading
text.

**It also makes a real classification error, disclosed rather than
cherry-picked around:** two plain `<label>`-style text strings ("Government
ID Number", "Full name") are misclassified as `link` (scores 0.33–0.40) —
there are no real hyperlinks anywhere on this page, so both are false
positives. `label` (the actual correct class for that content) is in the
model's vocabulary and was never chosen instead — the model confuses two
of its own 8 classes on real content, not a hypothetical edge case.

**Latency is a real concern, not a clear pass.** 930ms median warm on
**native CPU** in Node — this is explicitly the *optimistic floor* Phase 0
established the framing for ("Node's default backend... is generally
*faster* than browser WASM... treat this as an optimistic floor, not a
pessimistic one"). A model already sitting at 93% of the 1000ms gate on the
fast path, before any browser marshalling overhead, is not a comfortable
margin. Unlike `yolos-tiny` (DETR/ViT, confirmed slower on WebGPU than CPU
due to graph-splitting), this is a pure CNN with no attention block — see
the op-inventory check below for why WebGPU is *plausible* here — but
plausible is not measured, and this number alone does not predict a
WebGPU browser PASS.

---

## 3. Static check: does the known AveragePool blocker apply here?

Phase 0's exact, named blocker was:
```
using ceil() in shape computation is not yet supported for AveragePool
```
an unimplemented ORT WebGPU/JSEP kernel that killed both RT-DETR and
D-FINE. Before spending harness-build time, both candidates' ONNX graphs
were inventoried node-by-node (`onnx.load(...).graph.node`, Python):

- **Neither model contains an `AveragePool` node at all.** Both use
  `MaxPool` exclusively (3 instances each, inside the SPPF block), and
  every one has `ceil_mode: 0` (floor mode — the mode Phase 0 confirmed
  works; the crash was specifically `ceil_mode: 1`).
- **Zero `MatMul` or `LayerNormalization` nodes in either graph** — no
  attention block at all, confirmed by the full op counter, not inferred.
  Consistent with "pure CNN," unlike `yolos-tiny`/RT-DETR/D-FINE, all three
  of which are transformer-head architectures.
- Full op inventory (both models are nearly identical op-for-op, since
  both are YOLOv8 variants): `Conv, Sigmoid, Concat, Resize (nearest,
  2×), MaxPool (floor mode), Reshape, Transpose, Slice, Split, Range,
  Gather, Expand, ConstantOfShape, Add, Mul, Div, Sub, Cast, Shape,
  Unsqueeze, Softmax`. All are common, broadly-supported ops in
  onnxruntime-web's WebGPU JSEP provider.

**This is a real, evidence-based reason to expect neither candidate hits
Phase 0's specific named blocker — it is not a guarantee.** Some other node
could still lack a WebGPU kernel in this ORT build; that can only be
settled by actually running it, which is exactly what the harness below is
for.

---

## 4. Chrome offscreen harness — built, NOT run (no browser automation here)

Following the task's instruction to build this only after Node-first
verification survives, and to reuse `spike/chrome-harness/`'s proven
patterns (copied, not modified):

- `chrome-harness/ort/` — the exact `ort-wasm-simd-threaded.jsep.{mjs,wasm}`
  files copied byte-for-byte from `spike/chrome-harness/ort/` (already
  verified working on WebGPU in a real browser by Phase 0). `onnxruntime-web`
  is pinned to the **exact matching version**
  (`1.22.0-dev.20250409-89f8206ba4`) so the JS API glue matches the copied
  binary.
- `chrome-harness/manifest.json` — same shape as Phase 0's: `"offscreen"`
  permission only, `script-src 'self' 'wasm-unsafe-eval'` CSP (no
  relaxation), `web_accessible_resources` for `ort/*`, `models/*`,
  `assets/*`.
- `chrome-harness/background.js` — identical pattern, creates the
  offscreen document on install/startup, does nothing else.
- `chrome-harness/src/offscreen.entry.js` — raw `onnxruntime-web/webgpu`
  (not `@huggingface/transformers`, since neither model is
  `pipeline()`-compatible). Benchmarks all three configs (OmniParser fp32,
  OmniParser q8, OpenDILab fp32) with **1 cold + 3 warm runs, median
  reported**, exactly Phase 0's protocol. `webgpu` is attempted first with
  a hard fallback to `wasm` on session-create failure (Section 5 invariant:
  "WebGPU is a speed optimization, never a dependency"). Intercepts
  `console.warn`/`console.error` during each candidate's entire run to
  catch the same "not assigned to preferred execution provider" /
  "not yet supported" pattern Phase 0 watched for. Prints a copy-pasteable
  `=== FINAL SUMMARY TABLE ===` including the **current production**
  `yolos-tiny` baseline (784–881ms, the real shipping number, not the
  superseded 8,432ms spike figure) as a reference row.
- `chrome-harness/src/browser-image-utils.js` — canvas/`OffscreenCanvas`
  port of the Node preprocessing (letterbox + OmniParser's divisor-resize).
  The **decode/NMS math itself is not reimplemented** — both Node and
  browser import the identical `lib/yolo-math.js`, so a Node PASS and a
  browser PASS are testing the same postprocessing logic, not two
  independently-written copies that could silently diverge.

Bundle: `esbuild` → `offscreen.bundle.js`, 505,626 bytes (vs Phase 0's
2.06MB — smaller because this imports raw `onnxruntime-web` directly, not
the much larger `@huggingface/transformers`). Verified no CDN references
survived bundling (`grep -o jsdelivr... offscreen.bundle.js` → no hits;
only external string in the whole bundle is an inert docs-URL comment).

**Harness footprint if loaded exactly as-is (all 3 configs bundled for
comparison, matching Phase 0's own multi-candidate pattern):**
```
21M   chrome-harness/ort/
114M  chrome-harness/models/   (OmniParser fp32 11.6M + q8 3.1M + OpenDILab fp32 98.7M)
140K  chrome-harness/assets/
494K  chrome-harness/offscreen.bundle.js
---
~135M total (141,147,123 bytes exact, measured via `find ... -exec wc -c`,
same method Phase 0 used for its own bundle-size figures)
```
This is a spike-only figure for running all three side-by-side, exactly
like Phase 0 bundled both RT-DETR and D-FINE together to compare them —
**not** a shipping estimate. If OpenDILab is ever shipped, it would ship
*alone* (~120MB: 98.7MB model + 21MB ORT, no OmniParser); if OmniParser
quantized is ever shipped, it would ship *alone* (~24MB: 3.1MB + 21MB ORT).

### How to run it (Varun — this is the one part of this spike nobody has observed)

1. `chrome://extensions` → enable Developer mode → **Load unpacked** →
   select `spike-ui-detector/chrome-harness/` (the folder with
   `manifest.json`).
2. On the extension's card, click **"offscreen.html"** under "Inspect
   views" (not "service worker" — that console only sees
   `background.js`'s two log lines).
3. Read top to bottom. Look for:
   - `[ui-detector-spike] config: ort.env.wasm.wasmPaths = chrome-extension://.../ort/`
   - `--- [omniparser_fp32] ... starting ---`, then load/cold/warm/gate/
     warning/detection lines, same for `omniparser_q8` and
     `webpage_element_detect`.
   - `=== FINAL SUMMARY TABLE ===` — copy this whole block back.
4. If a candidate logs `ORT graph-split/unsupported-op warning observed: YES`,
   copy the exact warning text too — that's the signal from Section 3 above
   either holding or not.
5. If the whole run stops early, or `OpenDILab` (98.7MB) fails to even
   create a WebGPU session, that's a valid, reportable result on its own —
   loading a session that large on WebGPU is genuinely untested territory
   (Phase 0's largest bundled candidate was 82.5MB and it loaded fine, but
   that is not proof this one will).

**This README makes no claim about what these numbers will be.** Every
latency figure above this section is Node/CPU. No WebGPU number exists yet.

---

## 5. Does this add anything the DOM doesn't already give us?

This is the question the task explicitly asked to answer honestly, so it
gets answered directly rather than folded into the recommendation.

**What the DOM walk (Phase 3 `action-executor`) already provides, for
every actionable element, today, with zero model cost:** an exact
`getBoundingClientRect()` bbox (not a confidence-thresholded estimate),
the real tag/role/type, the real text content, a stable `data-agent-id`
the action-executor can dispatch a real DOM event to directly — and
critically, **perfect recall and precision on the thing it's built to
find**, because it's reading the actual accessibility tree, not
statistically guessing from pixels. There is no NMS, no confidence
threshold, no quantization tradeoff, no false "link" where a "label"
should be (see OpenDILab's demonstrated confusion above).

**What even the *better* candidate here (OpenDILab) actually adds on top
of that, concretely, from the real test above:** tight, correctly-labeled
boxes for `field`/`image`/`text`/`heading` — categories the DOM already
names exactly (`input`, `img`, text nodes, `h1`–`h6`) via its own tags,
with exact rather than approximate boxes. It does **not** add new
information here; it re-derives, approximately and with a real
misclassification (`link` for a plain label), information already sitting
in the DOM tree for free. And using its output for *grounding* (i.e.
telling the agent where to click) would mean re-solving a problem this
project already deliberately solved a different way: Phase 3's whole
Set-of-Mark design (`data-agent-id`, never raw pixel coordinates) exists
*specifically* because acting on unstable pixel-space boxes is fragile —
feeding vision boxes into the action loop would mean correlating them back
to DOM elements by bbox overlap, which is the **exact mechanism** that
produced Phase 4's real false-positive bug (`RedactedRegion.source`, a
vision box overlapping a "Continue" button wrongly flagged as a PII leak).
Reusing that same fragile correlation for grounding, on purpose, on top of
a system that already has exact IDs, would be a regression, not a feature.

**Where vision genuinely could add something the DOM structurally cannot
provide:** UI that isn't DOM-addressable at all — content painted onto
`<canvas>`/WebGL (games, some map/chart widgets), cross-origin `<iframe>`
internals, or flat-image buttons with no accessible text. This is a real,
narrow gap. Neither candidate here is positioned to close it well:
OmniParser's single undifferentiated `icon` class doesn't say what a
detected icon *does*, and OpenDILab was trained on ordinary webpage
screenshots (Roboflow's `website-screenshots` set), not canvas/WebGL
content specifically — its "field"/"image"/"text" classes describe
ordinary HTML elements, which is exactly the content the DOM already
covers best. Neither candidate's demonstrated behavior in this spike
actually exercises the canvas/cross-origin-iframe gap.

**Separately, and not in scope for this "grounding" question:** the
project's *redaction* use case (finding faces, ID cards, screens) is
already vision's proven, working value here — `yolos-tiny`'s `person`
class is exactly what makes Phase 4's redaction demo fire on the ID card.
That's a different question (visual PII detection, no DOM equivalent
exists for "this pixel region is a face") from this spike's question
(UI-element *grounding*, where the DOM equivalent is exact and already
built). Conflating the two would be the wrong takeaway from this spike —
vision's win on redaction says nothing about vision's case for grounding.

**Honest conclusion: for grounding specifically, no — not given this
architecture.** The DOM walk + the VLM's own direct view of the
(redacted) screenshot already jointly cover what a bolt-on UI-element
detector would add: the DOM gives exact structure, the VLM gives visual
reasoning over the same image these detectors would run on, at far higher
semantic capability than an 8-class YOLOv8 that confuses `link` and
`label` on a four-field form. A narrow, real case exists (non-DOM UI) that
neither candidate targets or demonstrates, and would need its own
purpose-built evaluation on canvas/WebGL/iframe content specifically to
argue for — not evidence produced here, so not claimed here.

---

## 6. Recommendation

1. **Do not ship a UI-element detector for grounding.** The DOM walk
   already does this task better, exactly, and for free. This is a
   negative result and it's a complete, valuable answer to the question
   asked — not a placeholder for more work.
2. **OmniParser icon_detect: reject.** Wrong domain (app-icon screenshots,
   not web forms), single undifferentiated class, low confidence
   (max 0.52 on real content), q8 dominated by fp32 (same pattern Phase 0
   already found and ruled on). Nothing here is worth the smallest of the
   size costs.
3. **OpenDILab webpage_element_detection: the one worth remembering, not
   shipping today.** Real semantic classes, real accuracy on `field`/
   `image` in this spike's own test, but 98.7MB (>2x current bundle), a
   demonstrated real classification error (`link`/`label` confusion), a
   930ms Node-CPU median that leaves no comfortable margin against the 1s
   gate even before WebGPU browser overhead, and — per Section 5 — even a
   perfect version of this model wouldn't add grounding information the
   DOM doesn't already have. If the project's needs ever shift toward
   non-DOM-addressable UI (canvas/WebGL apps, cross-origin iframes), this
   is the more credible starting point of the two, but that is a different
   project than the one currently being built.
4. **Chief's existing fallback (redaction-only vision, no grounding
   claim) is the right call**, and this spike is independent evidence for
   it, not just a restatement of it: the DOM already grounds, the VLM
   already sees, and neither tested detector changes that math enough to
   justify its cost.

## What is NOT verified

- **No WebGPU number exists for either candidate.** Everything timed above
  is `onnxruntime-node` CPU — an optimistic floor per Phase 0's own
  framing, not a WebGPU proxy. The harness in `chrome-harness/` is built
  and ready; it has not been run in a real browser by this agent (no
  browser automation available), per the task's explicit constraint.
- The op-inventory argument in Section 3 is evidence the *specific named*
  Phase 0 blocker (`ceil_mode=1` AveragePool) doesn't apply — it is not
  proof every op has a WebGPU kernel in this ORT build.
- `macpaw-research/yolov11l-ui-elements-detection`'s real multi-class
  desktop-UI labels were never tested — no ONNX export exists for it, and
  converting one (`torch`+`ultralytics`, neither installed) was judged out
  of scope for a research spike. Flagged as a lead, not benchmarked.

## Files

- `node-test-omniparser.js`, `node-test-webpage-detect.js` — Node-first
  verification, runnable (`npm install` first).
- `lib/yolo-math.js` — shared decode/NMS math (Node + browser both import
  this, unmodified, so their postprocessing can't silently diverge).
- `lib/yolo-utils.js` — Node-only (sharp-based) image loading, re-exports
  `yolo-math.js`.
- `draw-boxes.js` — draws detections onto the test screenshot; produced
  `assets/annotated-omniparser.png` and `assets/annotated-webpage-detect.png`,
  the visual evidence cited in Section 2.
- `assets/demo-page-screenshot.png` — real screenshot of `demo/test-page.html`
  (captured via headless Chrome, `demo/` itself untouched).
- `chrome-harness/` — the unrun browser harness, see Section 4.
- `models/` — downloaded ONNX weights (also duplicated under
  `chrome-harness/models/` for the extension bundle — same pattern Phase 0
  used, top-level copy for Node tests, `chrome-harness/` copy for the
  browser harness).
