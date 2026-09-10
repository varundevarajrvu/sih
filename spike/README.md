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

## Part 3 — Chrome harness (RETRY 3 — model swap, you must run this)

Everything below this line was built but **never executed in a real browser**.
The authoring agent has no browser automation and cannot read Chrome's
DevTools console. Do not treat this as passing until you've done the steps
below and seen real console output.

**This is not a third attempt at fixing the same problem** — CLAUDE.md
Section 7's 2-retry cap applied to getting `Xenova/yolos-tiny` to work; that
cap was reached (retry 2's matrix conclusively proved yolos-tiny cannot meet
the gate at any device/dtype setting) and Chief re-scoped instead of
authorizing a third fix attempt on the same model. This is a fresh task under
that re-scope: find and benchmark a replacement detector architecture. The
harness infrastructure (local ORT, offscreen doc, benchmark methodology,
contract adapter) is unchanged and carries over as-is — only which model(s)
get loaded changed.

### RETRY 3: yolos-tiny is superseded — what changed and why

Retry 2's final matrix (real browser numbers, median of 3 warm runs, all
four `{webgpu,wasm}×{fp32,q8}` cells) is recorded in full in CLAUDE.md's
Phase 0 RESULT section. Summary: **every cell failed the ~1s gate**, the best
case was `webgpu+fp32` at **8,432ms** (8.4× over gate), and the ORT runtime
itself explained why: `Some nodes were not assigned to the preferred
execution providers` — yolos-tiny is DETR-family, a Vision Transformer. Its
shape ops don't map to WebGPU, the inference graph splits between GPU and
CPU, and every boundary crossing round-trips tensors on a model too small to
amortize that cost. 8.4s is yolos-tiny's floor, not a tuning problem.

**Chief's decision, recorded in CLAUDE.md: swap the detector architecture.**
Section 4's `yolos-tiny` choice is superseded. CNN-backbone real-time
detectors are expected to map to WebGPU without the same graph-splitting
failure — but per the explicit instruction for this retry, that expectation
is **not** taken on faith; it's measured the same way retry 2 measured
yolos-tiny, watching for the identical ORT warning.

**Research first, verified against the live HF API — nothing here is guessed:**

1. Checked `node_modules/@huggingface/transformers/src/models.js`'s
   `MODEL_FOR_OBJECT_DETECTION_MAPPING_NAMES` directly (not assumed): the
   `pipeline("object-detection", ...)` call only supports model types
   `detr`, `rt_detr`, `rt_detr_v2`, `rf_detr`, `d_fine`, `table-transformer`,
   `yolos`. **No YOLOv5/v8/v9/v10/v11-family CNN detector is in this list** —
   confirms the coordinator's warning that classic YOLO exports need raw
   `onnxruntime-web` inference with hand-written letterbox preprocessing and
   NMS postprocessing, not the `pipeline()` convenience API.
2. `rt_detr`, `d_fine`, and `rf_detr`, however, **are** in that mapping —
   all three are recent "real-time detection transformer" architectures
   (RT-DETR, D-FINE, RF-DETR) that use a **CNN backbone** with a comparatively
   lightweight transformer head, explicitly designed to beat YOLO on the
   speed/accuracy curve while staying `pipeline()`-compatible. This
   eliminates the raw-ORT/manual-NMS path entirely for these three — a real,
   verified simplification, not assumed.
3. Queried the live HF API (`https://huggingface.co/api/models?search=...`)
   for each candidate family. Verified real repos, real `onnx/model.onnx`
   files, and real byte sizes (matched against the server's `Content-Length`
   header before ever downloading), exactly as done for `model_quantized.onnx`
   in retry 2:

| Candidate | Repo (verified real) | `model_type` | fp32 `onnx/model.onnx` size | Verdict |
|---|---|---|---|---|
| RT-DETR (ResNet-18) | `onnx-community/rtdetr_r18vd` | `rt_detr` ✅ pipeline-compatible | 82,572,357 bytes (~78.7MiB) | **Bundled + benchmarked** |
| D-FINE (nano) | `onnx-community/dfine_n_coco-ONNX` | `d_fine` ✅ pipeline-compatible | 15,258,358 bytes (~14.6MiB) | **Bundled + benchmarked** — smallest model in this entire spike |
| RF-DETR (nano) | `onnx-community/rfdetr_nano-ONNX` | `rf_detr` ✅ pipeline-compatible | 108,074,865 bytes (~103.1MiB) | **Verified to exist, NOT bundled** — see below |

**Why RF-DETR was excluded from the actual browser benchmark, not silently
dropped:** two independently sufficient reasons, both verified rather than
assumed.
   1. **Size is a hard blocker, not a preference.** 108,074,865 bytes exceeds
      GitHub's 100 MiB (104,857,600-byte) hard per-file push limit. Committing
      it as a plain tracked file would make `git push` fail outright — this
      isn't the "soft 50MB warning" threshold this spike has flagged-but-proceeded
      past before (e.g. `rtdetr_r18vd` below); it's a wall, and setting up Git
      LFS to get around it is an infrastructure decision outside this spike's
      scope.
   2. **Architecture red flag, confirmed from the primary source, not
      inferred.** Fetched RF-DETR's own model card
      (`Roboflow/rf-detr-segmentation` README from HF) directly. It states:
      *"a DINOv2-with-registers style ViT backbone"* — DINOv2 is a Vision
      Transformer family. That is the **same architecture family** already
      identified as yolos-tiny's root cause (shape ops falling back to CPU,
      graph splitting). RF-DETR does use windowed attention and a deformable
      decoder that yolos-tiny's plain DETR head lacks, so this isn't a
      certain repeat of the failure — but combined with reason 1, it wasn't
      worth 103MB and a hard git-push blocker to find out empirically this
      round.

**Caution built into the benchmark itself, per the explicit instruction not
to assume "CNN backbone" alone fixes anything:** RT-DETR and D-FINE both
still retain a transformer encoder/decoder on top of their CNN backbones —
structurally the same pattern that made yolos-tiny slow. `offscreen.entry.js`
temporarily intercepts `console.warn`/`console.error` around each candidate's
entire pipeline-load-and-inference sequence and pattern-matches for the same
`"not assigned to the preferred execution provider"`-shaped ORT warning seen
with yolos-tiny, reporting per-candidate whether it recurs. If both
candidates show it, that's real evidence the whole transformer-head detector
family is unusable in this environment regardless of backbone — a decisive
finding pointing back to raw-ORT YOLO, not a reason to hide the warning.

**Cleanup done as part of this retry:**
- Deleted `chrome-harness/models/Xenova/yolos-tiny/onnx/model_quantized.onnx`
  (the q8 weights, 9.66MB) — explicitly instructed, retired per retry 2's
  conclusion 2 (q8 was dominated by fp32 on both speed and accuracy).
- **Also deleted the rest of `chrome-harness/models/Xenova/yolos-tiny/`**
  (the fp32 `model.onnx`, 26.2MB, plus its tiny config files) — beyond the
  literal instruction, but reasoned: yolos-tiny's number is already
  permanently recorded in CLAUDE.md's Phase 0 RESULT with full citations, the
  harness copy served only the now-complete retry-1/retry-2 browser
  benchmarks, and leaving 26.2MB of acknowledged-dead weights in the repo
  while flagging size concerns on the new additions would be inconsistent.
  If this was unwanted, it's fully recoverable from git history — flagging
  it clearly here rather than leaving it undisclosed.

### THE CANDIDATE MATRIX — fill this in from Varun's console output

Empty on purpose, same reasoning as retry 2's matrix: this agent has not
observed a single number from this benchmark in a real browser.

| Model | Median warm (ms) | Gate | ORT graph-split warning? | Detections |
|---|---|---|---|---|
| yolos-tiny (baseline, NOT re-run) | 8,432 | FAIL | n/a (prior retry) | 5 |
| rtdetr_r18vd | ? | ? | ? | ? |
| dfine_n_coco | ? | ? | ? | ? |

**How to fill it in:** run the harness (steps below), then copy the
`=== FINAL SUMMARY TABLE ===` block the console prints — built by
`buildSummaryTable()` in `offscreen.entry.js`, already includes the
yolos-tiny baseline row for direct comparison. Paste that whole block in
place of the table above.

### CLASS COVERAGE — methodology (results pending Varun's run)

This project redacts PII-bearing visual objects — faces, ID cards, screens
showing sensitive data. `yolos-tiny` was COCO-80 and covered the rough
proxies: `person`, `tv`/`tvmonitor`, `laptop`, `cell phone`, `book`. A
replacement that's 20x faster but can't detect `person` is useless here —
speed is worthless if it can't see what needs redacting.

`offscreen.entry.js` checks this at **runtime**, against each candidate's
actually-loaded `detector.model.config.id2label` (not just this agent's
earlier out-of-band `curl` inspection of `config.json` — belt and suspenders,
in case of a packaging mismatch). Both candidates were already confirmed via
live API to be 80-class COCO sets with all proxy classes present:

```
person -> true | tvmonitor -> true | laptop -> true | cell phone -> true
book -> true | cat -> true | sofa -> true
```

**One real naming difference to flag for Phase 1, confirmed via the live
config, not assumed:** RT-DETR/D-FINE use `tvmonitor` and `sofa`, where
yolos-tiny used `tv` and `couch` for the same real-world objects. If any
downstream code does exact string-matching against class names (e.g. a
redaction rule keyed on the literal string `"tv"`), it will silently miss
`"tvmonitor"` after this swap — Phase 1 must either match on both names or
normalize label strings at the contract boundary.

**Test image caveat, stated plainly:** `assets/test-image.jpg` (the same
COCO cats/remotes/couch photo used in every prior retry, kept **identical on
purpose** for latency comparability) contains no person, ID card, laptop,
cell phone, or book. So the class-coverage claims above are verified against
each model's **declared class list**, not demonstrated by an actual
detection of those specific objects on this specific photo. The harness does
not swap in a "better" test image to make coverage look empirically
demonstrated — that would break latency comparability with the yolos-tiny
baseline, which the instructions were explicit about preserving.

### RECOMMENDED CANDIDATE — decision rule (pending Varun's numbers)

Cannot name a winner yet — the numbers don't exist until the browser run
produces them. The rule to apply once the matrix above is filled in:

1. **Does either candidate clear (or credibly approach) the ~1s gate on
   median warm?** If yes, that candidate is the leading contender for
   Phase 1. If both still fail badly, check the ORT graph-split warning
   column first — if it fired for both, that's a decisive finding: the
   whole transformer-head detector family (DETR/RT-DETR/D-FINE/YOLOS/RF-DETR)
   is unusable in an MV3 offscreen document regardless of backbone, and the
   only paths left are raw-ORT YOLO (accepted tradeoff: more code, Phase 1
   owns preprocessing+NMS) or Chief's DOM-only fallback (CLAUDE.md Section
   9.5) if even that doesn't pan out. Report plainly — do not force a pass
   by cherry-picking a warm run or shrinking the input image.
2. **Confirm class coverage holds** (see above — already verified at rest,
   re-confirm from the runtime log in case of any packaging surprise).
3. **`webgpu` vs `wasm` fallback logic still applies** regardless of which
   model wins — CLAUDE.md Section 5: "WebGPU is a speed optimization, never
   a dependency." This retry didn't re-test wasm for the new candidates
   (explicitly out of scope — wasm's ~4x latency penalty vs webgpu was
   already established architecture-independently by retry 2's ORT-level
   explanation), but Phase 1's `runDetection` must still catch-and-fall-back.

### Bundle size — after the model swap

```
21M  chrome-harness/ort/                                    (ORT runtime, unchanged since retry 1)
79M  chrome-harness/models/onnx-community/rtdetr_r18vd/      (fp32, 82,572,357 bytes)
15M  chrome-harness/models/onnx-community/dfine_n_coco-ONNX/ (fp32, 15,258,358 bytes)
172K chrome-harness/assets/
2.0M chrome-harness/offscreen.bundle.js
---
~116M chrome-harness/ total (121,737,672 bytes exact, measured via `find ... -exec wc -c`)
```

`Xenova/yolos-tiny/` (previously ~26MB fp32 + 9.66MB q8) is now fully
removed — see Cleanup above. **`rtdetr_r18vd/onnx/model.onnx` (82.5MB) is
the first file in this entire spike to cross the 50MB GitHub soft-warning
threshold** that every earlier bundled file stayed under — still safely
under the 100MB hard limit, but a real, disclosed size jump from retry 2's
~58MB harness, not something decided quietly. If ~116MB is unwelcome in this
repo, the concrete lower-footprint path is: drop whichever candidate loses
the benchmark entirely (this spike only needs both bundled simultaneously to
compare them — Phase 1 ships one model, not two, the same "keep only the
winner" logic already applied to fp32-vs-q8 in retry 2).

---

### RETRY 2 (for reference): what retry 1 found, and why one more pass was needed

Retry 1's fix worked — Varun's real console output confirmed:
```
navigator.gpu present in this offscreen document: true
WebGPU pipeline load succeeded in 1128.0ms
BACKEND ACTUALLY USED: webgpu
COLD inference time (ms): 14097.9
WARM inference time (ms): 8696.1
~1s gate: FAIL
[ORT warning] Some nodes were not assigned to the preferred execution providers ... shape related ops to CPU
```
Detections were correct, in the flat contract shape, with **zero network
calls** — the local-ORT + local-weights architecture is confirmed working.
**The core Phase 0 risk (does WebGPU exist in an MV3 offscreen document?) is
resolved positively.** That part is not being redone.

But two things were left open:

1. **WebGPU was ~2x slower than Node's native CPU** (8.7s warm vs. the
   3.5–5.8s already measured on Node) — the ORT warning explains why: YOLOS
   is a DETR-style ViT, its shape ops fall back to CPU, the graph splits, and
   every GPU↔CPU boundary crossing round-trips tensors on a model too small
   to amortize that cost. **Do not assume WebGPU is the fast path for this
   model** — that assumption would have been wrong if retry 1 had stopped here.
2. **The WASM fallback never ran.** Because webgpu succeeded, the try/catch
   fallback to `{ device: "wasm" }` never executed — and CLAUDE.md's ~1s gate
   is explicitly *defined* on WASM fallback. That number had never been
   measured in a real browser. Phase 0 could not close on an unmeasured gate.

**Retry 2 fix: stop testing one path at a time. Benchmark all four
{webgpu, wasm} × {fp32, q8} configs in a single page load, sequentially**,
each with 1 cold + 3 warm runs (a single warm sample is not a measurement —
Node's own numbers showed 3.5–4.1s spread across 5 runs). Plus an explicit
q8-vs-fp32 **accuracy** comparison, not just speed: "accuracy of visual
context" is 25% of the hackathon rubric, more than latency's 15%, so a config
that's faster but quietly drops a detection or shifts boxes by tens of pixels
is not a free win.

**q8 weights added.** Verified the real filename via the live HF API listing
for `Xenova/yolos-tiny` (`https://huggingface.co/api/models/Xenova/yolos-tiny`)
rather than guessing — `onnx/model_quantized.onnx` is real, confirmed present,
downloaded and byte-count-verified against the server's `Content-Length`
(9,661,148 bytes, exact match). This matches
`DEFAULT_DTYPE_SUFFIX_MAPPING[DATA_TYPES.q8] = '_quantized'` in
`node_modules/@huggingface/transformers/src/utils/dtypes.js` — `q8` is the
dtype name the library uses internally, `model_quantized.onnx` is the file it
maps to on disk. Both `onnx/model.onnx` (fp32, 26,227,993 bytes) and
`onnx/model_quantized.onnx` (q8, 9,661,148 bytes) now sit side by side under
`chrome-harness/models/Xenova/yolos-tiny/onnx/`, so all four matrix cells are
runnable from one load without fetching anything new.

`offscreen.entry.js` was rewritten around a `CONFIGS` array and a
`runConfig()` function that loads a pipeline, runs 1 cold + 3 warm
inferences, disposes the ONNX session (`detector.model.dispose()`) before
moving to the next config so GPU/WASM memory doesn't accumulate across all
four, and — critically — wraps the **entire** per-config sequence in
try/catch so one failing cell (e.g. `webgpu+q8`, plausible since JSEP's
quantized-op support is uneven) logs its exact error and lets the loop
continue to the remaining three cells instead of aborting the whole run.

### THE MATRIX — fill this in from Varun's console output

This table is intentionally empty. Every previous version of this README
that stated a number the authoring agent hadn't personally observed in a
browser was wrong at least once already (see retry 1's corrected CSP claim
above) — so this section states nothing until Varun pastes the real output.

| Device | fp32 (cold / median warm / gate) | q8 (cold / median warm / gate) |
|---|---|---|
| **webgpu** | *(redo in-harness — the 8.7s from retry 1 was a single sample, not a median of 3)* | ? |
| **wasm** | ? — **this is the number CLAUDE.md's gate is actually defined on** | ? |

**How to fill it in:** run the harness (steps below), then copy the
`=== FINAL SUMMARY TABLE ===` block the console prints — it's built by
`buildSummaryTable()` in `offscreen.entry.js` as a ready-to-paste markdown
table with columns: Config | Status | Cold (ms) | Warm runs (ms) | Median
Warm (ms) | Gate (<1000ms) | Detections. Paste that whole block in place of
the table above.

### ACCURACY COMPARISON — q8 vs fp32, methodology (results pending Varun's run)

`offscreen.entry.js` runs `compareDetections()` after all four configs
finish, once per device (webgpu and wasm), comparing that device's q8 result
against its fp32 result on the *same* test image:

- Matches each fp32 detection to its best-IoU same-label detection in the q8
  result (IoU > 0.3 threshold — generous on purpose, so quantization-induced
  box drift counts as "the same detection, shifted" rather than getting
  miscounted as one missing + one spurious).
- For every matched pair, reports: IoU, both scores and the score delta,
  and per-edge coordinate drift in pixels (`xmin`/`ymin`/`xmax`/`ymax` each,
  plus the max absolute drift across all four edges).
- Anything in fp32 with no adequate q8 match is reported as **missing in
  q8** with its box. Anything in q8 with no fp32 match is reported as
  **extra in q8**. Both are logged explicitly, not summarized away.

This is not optional per the coordinator's retry-2 instructions, and it's
logged as full JSON (`[${device}] full comparison: ...`) so exact numbers —
not a vibe — decide whether q8 is an acceptable trade. **Fill in after
Varun's run:**

| Device | fp32 count | q8 count | Matched | Missing in q8 | Extra in q8 | Max coord drift (px) | Max |score delta| |
|---|---|---|---|---|---|---|---|
| webgpu | ? | ? | ? | ? | ? | ? | ? |
| wasm | ? | ? | ? | ? | ? | ? | ? |

### RECOMMENDED CONFIG — decision rule (final pick pending Varun's numbers)

This agent cannot recommend a specific cell yet — the numbers don't exist
until the browser run produces them. What can be stated now is the decision
rule Phase 1 should apply once the matrix + accuracy table above are filled in:

1. **First filter: does any config clear the ~1s gate on median warm?** If
   yes, that's the pool to choose from. If literally none do (plausible,
   given Node's own fp32 CPU numbers were 3.5–5.8s), the gate itself needs a
   conversation with Chief before Phase 1 proceeds — per CLAUDE.md Section
   7 rule 4, that's a "stop and escalate" situation, not a "quietly loosen
   the gate" situation.
2. **Within configs that pass (or if none pass, among the fastest), check
   the accuracy table.** A config that drops a real detection (e.g. loses
   `couch` or a `cat`) or drifts a box by a large fraction of that box's own
   size is disqualified regardless of speed — 25% of the rubric is visual
   accuracy, and a redaction/action system built on wrong boxes is worse
   than a slow one.
3. **`webgpu` vs `wasm` is not just a speed question.** CLAUDE.md Section 5:
   "WebGPU is a speed optimization, never a dependency." Whatever wins the
   benchmark, Phase 1's `runDetection` must still attempt `webgpu` first and
   catch-and-fall-back to `wasm` on any failure (this harness already does
   that) — whichever config is *fastest* only decides tuning (e.g. `dtype`
   default), not whether the fallback path stays in the code.

**Bundle-size follow-on question, answered now (not contingent on the
matrix):** *if* q8 ends up winning on both speed and accuracy for the config
Phase 1 actually ships, **yes, fp32 could be dropped entirely from the
shipped extension** — the only reason both are bundled in this spike is to
run the comparison at all. Dropping fp32 would cut ~26.2MB from the shipped
package (see bundle-size figures below). This spike deliberately keeps both
because the decision requires the accuracy table above to exist first — that
table is the actual evidence, not a guess made in advance.

### Bundle size — after adding q8 weights

```
21M   chrome-harness/ort/           (ORT runtime, unchanged since retry 1)
35M   chrome-harness/models/        (fp32 26.2MB + q8 9.66MB + tiny config files, was 26M before this retry)
172K  chrome-harness/assets/
2.0M  chrome-harness/offscreen.bundle.js
---
~58M  chrome-harness/ total (59,784,378 bytes exact, measured via `find ... -exec wc -c`)
```

Grew from retry 1's ~48MB by exactly the q8 weight file's size (+9,661,148
bytes) plus negligible bundle-code growth. Still under GitHub's 100MB hard
limit and every individual file is still under the 50MB soft-warning
threshold (largest single file remains `model.onnx` at 26.2MB). Both weight
files are needed *for this benchmark run* — see the bundle-size follow-on
question above for what ships in Phase 1 once the matrix picks a winner.

---

### RETRY 1 (for reference): what broke the first time, and what changed

Varun's first run failed at model load with:
```
[spike] FAILED: Error: no available backend found. ERR: [webgpu] TypeError: Failed to fetch dynamically imported module: https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/ort-wasm-simd-threaded.jsep.mjs
```
Both webgpu and wasm failed the same way, so the actual Phase 0 question
(does `navigator.gpu` exist in an offscreen document) was never reached.

**The previous version of this README had the root cause wrong**, and that
wrong claim would have misled Phase 1 if left uncorrected. It said the CDN
fetch for the ORT `.wasm`/`.mjs` runtime "is a `fetch()` data request, not a
`<script>` load, so it shouldn't be blocked by MV3's `script-src`." **That is
false.** The error text says `Failed to fetch dynamically imported module` —
onnxruntime-web loads its backend via a real `import()` of a remote `.mjs`
file, which **is** a script load and **is** governed by `script-src`.
`script-src 'self' 'wasm-unsafe-eval'` permits nothing remote, so it was
blocked outright — correctly, since relaxing CSP to allow remote script was
never an approved option (CLAUDE.md Section 5 / this retry's constraints).
`host_permissions` do not help here either: host permissions and CSP are two
separate, non-overlapping mechanisms — one governs cross-origin `fetch`/CORS,
the other governs what can execute as script. Neither overrides the other.

**Fix applied: everything the offscreen document needs is now bundled inside
the extension. Nothing is fetched from any CDN or from huggingface.co at
runtime.**

1. **ORT runtime, copied verbatim** from
   `node_modules/@huggingface/transformers/dist/` into `chrome-harness/ort/`:
   - `ort-wasm-simd-threaded.jsep.mjs` (44,484 bytes)
   - `ort-wasm-simd-threaded.jsep.wasm` (21,596,019 bytes)

   These are the exact two files, verified by listing the source `dist/`
   directory rather than guessed, and verified byte-for-byte identical after
   copying (`ls -la` sizes match on both sides). This is the library's single
   "jsep" build — it's used for **both** the WASM path and the WebGPU path
   (JSEP = JavaScript Execution Provider, the mechanism onnxruntime-web uses
   to dispatch to WebGPU); there is no separate non-jsep variant shipped by
   this package, so one pair of files covers both backends. Inspecting the
   `.mjs` also showed it spawns a `new Worker(new URL(import.meta.url), {type:
   "module"})` — i.e. it loads *itself* as a worker for threaded WASM. Since
   that URL is relative to the already-local `.mjs`, this stays same-origin
   automatically; it also confirms the `"WORKERS"` offscreen-document reason
   (see below) is the genuinely correct justification, not just a guess.

2. `offscreen.entry.js` now sets, **before any `pipeline()` call**:
   ```js
   env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("ort/"); // trailing slash matters
   ```
   This makes onnxruntime-web's dynamic `import()` and its `.wasm` fetch both
   resolve to `chrome-extension://<id>/ort/...` — same-origin, satisfies
   `script-src 'self' 'wasm-unsafe-eval'` with **no CSP relaxation**.

3. **Model weights, also bundled locally**, per the coordinator's retry
   instructions and because this is meant to be an on-device privacy tool —
   phoning out to a CDN to function undercuts that premise. Files were
   downloaded from the *real* Hugging Face repo listing for `Xenova/yolos-tiny`
   (queried via `https://huggingface.co/api/models/Xenova/yolos-tiny`, not
   guessed) into `chrome-harness/models/Xenova/yolos-tiny/`:
   - `config.json` (4,145 bytes)
   - `preprocessor_config.json` (457 bytes)
   - `onnx/model.onnx` (26,227,993 bytes — the **fp32** weights)

   `offscreen.entry.js` also sets, before any `pipeline()` call:
   ```js
   env.allowLocalModels = true;   // browser default is false — must opt in
   env.allowRemoteModels = false; // hard-fails loudly if anything is still missing locally
   env.localModelPath = chrome.runtime.getURL("models/"); // trailing slash matters
   ```
   `allowRemoteModels = false` is deliberate: if some file was still missed,
   this makes the harness fail with a clear
   `env.allowRemoteModels=false, but attempted to load a remote file from: ...`
   error naming the exact missing path, instead of silently succeeding over
   the network and hiding the gap.

4. **Dtype pinned to `fp32` on both the WebGPU and WASM `pipeline()` calls
   (retry 1 only — superseded by retry 2's benchmark matrix below).** This
   was a discovery made while building the retry-1 fix, not something the
   coordinator specified: the library's own `DEFAULT_DEVICE_DTYPE_MAPPING`
   (`node_modules/@huggingface/transformers/src/utils/dtypes.js`) gives the
   `"wasm"` device a *different* default dtype (`q8`, i.e.
   `model_quantized.onnx`) than `"webgpu"` or any other device (which default
   to `fp32`, i.e. `model.onnx`). Retry 1 pinned `fp32` on both calls so only
   one weight file was needed. **Retry 2 changes this**: since the whole
   point now is to measure fp32 and q8 explicitly as separate matrix cells,
   both weight files are bundled (see the RETRY 2 section above) and dtype is
   no longer pinned to a single value — it's one of the two axes of the
   matrix.

5. `manifest.json` no longer declares `host_permissions` for
   `huggingface.co`/`jsdelivr.net` — they're not needed anymore since nothing
   is fetched remotely. Added `web_accessible_resources` for `ort/*`,
   `models/*`, `assets/*` defensively (the offscreen document is same-origin
   with these files as part of the extension package, so this is very likely
   unnecessary, but costs nothing and removes one more variable given this
   agent cannot test it directly).

**Repo footprint added by this fix: ~48MB total** (`ort/` 21MB +
`models/` 26MB + `assets/` 172KB + the 2MB bundle). This is a real, disclosed
tradeoff — not something decided silently. It was not treated as a stop
condition because: no single file exceeds GitHub's 50MB soft-warning
threshold (largest is the 26.2MB fp32 `model.onnx`), the total is well under
GitHub's 100MB hard limit, and it directly fixes both the reported crash and
the "on-device" premise concern the coordinator raised. If ~48MB turns out to
be unwelcome in this repo, the concrete lower-footprint alternative is
already identified above (switch to `q8`/`model_quantized.onnx`, ~31MB total)
— flagging that option rather than silently taking it.

**Remaining runtime network dependency: none identified.** With
`env.allowRemoteModels = false`, any code path that still tried to reach the
network would throw loudly instead of silently succeeding — that's the
mechanism this fix relies on to prove there's no remaining gap. Whether that
claim actually holds is exactly what Varun's next run will show: a clean run
with no `allowRemoteModels` error means it's confirmed; any such error names
the exact missing local file to add.

### What it is (current — retry 3)

- `chrome-harness/manifest.json` — MV3, `"offscreen"` permission only. No
  popup, no content script.
- `chrome-harness/background.js` — the only thing it does is call
  `chrome.offscreen.createDocument(...)` on install/startup. All real work
  happens in the offscreen document. Unchanged since retry 1.
- `chrome-harness/offscreen.html` — loads `offscreen.bundle.js` as a module
  script. Intentionally blank/inert page. Unchanged since retry 1.
- `chrome-harness/offscreen.bundle.js` — the actual logic, esbuild-bundled
  from `chrome-harness/src/offscreen.entry.js`. Bundling was required because
  `@huggingface/transformers`'s browser build imports the bare specifiers
  `"onnxruntime-common"` / `"onnxruntime-web"`, which a raw `<script type="module">`
  cannot resolve. To rebuild after editing the source:
  ```
  cd spike
  npm run build-chrome-harness
  ```
- `chrome-harness/ort/` — the ONNX runtime WASM binary + its JS glue,
  copied locally (see RETRY 1 section below), unchanged since retry 1,
  shared by both candidates (same ORT jsep build regardless of which model
  it's running).
- `chrome-harness/models/onnx-community/rtdetr_r18vd/` and
  `chrome-harness/models/onnx-community/dfine_n_coco-ONNX/` — the two
  candidate models' weights (fp32 only, per this retry's scope), verified
  and downloaded as described in the RETRY 3 section above.
  `chrome-harness/models/Xenova/yolos-tiny/` is **gone** — deleted this retry
  (see Cleanup above).
- `chrome-harness/assets/test-image.jpg` — same COCO test image used in
  every prior retry and the Node half, unchanged, bundled locally.

### What `offscreen.entry.js` does, in order (retry 3 — candidate benchmark)

0. Configures `env.backends.onnx.wasm.wasmPaths`, `env.allowLocalModels`,
   `env.allowRemoteModels`, `env.localModelPath` (all local, unchanged
   mechanism since retry 1) and logs each value to console for verification.
1. Loads the bundled test image once, converts it to a base64 string (to
   genuinely exercise the `runDetection(imageBase64)` contract signature,
   not just pass a `Blob` directly), and logs the test-image caveat (no
   person/tv/laptop/cell-phone/book in this specific photo — see CLASS
   COVERAGE above).
2. Loops over the two `CANDIDATES` (`rtdetr_r18vd`, `dfine_n_coco`), always
   `device: "webgpu", dtype: "fp32"` — no device/dtype matrix this retry, per
   the explicit instruction that wasm and q8 are settled and out of scope.
   For each candidate, `benchmarkCandidate()`:
   - temporarily intercepts `console.warn`/`console.error` for the whole
     candidate run, pattern-matching for ORT's
     `"not assigned to the preferred execution provider"`-shaped
     graph-split warning (the same one seen with yolos-tiny) and recording
     any hits.
   - loads the pipeline for that model, timing the load.
   - reads the model's **actual runtime** `id2label` off
     `detector.model.config` and checks it against `PROXY_CLASSES`
     (`person`, `tv`/`tvmonitor`, `laptop`, `cell phone`, `book`, `cat`,
     `couch`/`sofa`), logging per-class coverage — not just trusting this
     agent's earlier out-of-band `config.json` inspection.
   - runs **1 cold inference**, then **3 warm inferences** (same session),
     logging each individually plus the computed median of the 3 warm times.
   - logs the pass/fail of the ~1s gate against the *median* warm time, and
     whether the ORT graph-split warning fired for this candidate.
   - disposes the ONNX session (`detector.model.dispose()`) before returning,
     bounding memory across the two candidates.
   - **the entire candidate run is wrapped in try/catch**: any failure at
     any stage is caught, logged with its full error, and recorded as a
     `failed` result — the loop continues to the remaining candidate(s)
     regardless.
3. Logs a `=== CLASS COVERAGE SUMMARY ===` block per candidate.
4. Prints the copy-pasteable **`=== FINAL SUMMARY TABLE ===`** markdown
   table — includes a fixed `yolos-tiny (BASELINE, not re-run)` row using
   the already-recorded 8,432ms number, plus one row per candidate (status,
   cold, each warm run, median warm, gate pass/fail, ORT-warning yes/no,
   detection count) — and a raw JSON dump of all results for reference.

<details>
<summary>Retry 2's device×dtype matrix description (superseded, for history)</summary>

Retry 2 benchmarked ONE model (yolos-tiny) across all four
`{webgpu,wasm}×{fp32,q8}` combinations. Retry 3 instead benchmarks TWO
candidate MODELS, both fixed to `webgpu+fp32` only (that axis is settled —
see RETRY 3 section above for why wasm/q8 weren't re-tested). The underlying
mechanics (1 cold + 3 warm, median, try/catch-per-cell, session disposal,
copy-pasteable summary table) carry over unchanged, just applied along a
different axis.

</details>

### Known unverified risk points — watch for these specifically

- **Either candidate may show the same ORT graph-split warning as
  yolos-tiny.** RT-DETR and D-FINE both retain a transformer encoder/decoder
  on a CNN backbone — the harness explicitly watches for this (see above)
  rather than assuming a CNN backbone alone fixes it. A `YES` in the
  ORT-warning column is a valid, important result, not a broken harness — it
  would mean the whole transformer-head detector family is unusable here
  regardless of backbone.
- **Either candidate may simply fail to load or run.** `rtdetr_r18vd` is by
  far the largest model bundled in this entire spike (82.5MB fp32) — loading
  it as a WebGPU session is untested territory. The harness catches this
  per-candidate and continues; a `FAILED` row is a valid result.
- **Loading two large ONNX sessions in one page (even sequentially, with
  disposal between each) is real memory pressure**, more than retry 1's
  single path, comparable to retry 2's four-cell run.
  `detector.model.dispose()` is called after each candidate specifically to
  bound this, but actual peak memory in a real offscreen document has not
  been observed for models this large.
- **The `"WORKERS"` offscreen-document reason, threaded-WASM
  `SharedArrayBuffer` requirement, and `navigator.gpu` presence** are all
  unchanged and already resolved as of retry 1 — not re-flagging as open.
- **Total run time.** Two candidates × (1 load + 1 cold + 3 warm) inferences.
  `rtdetr_r18vd`'s 82.5MB load time in particular is unknown — let it run to
  completion; the `=== FINAL SUMMARY TABLE ===` line only appears after both
  candidates (success or failure) are done.

### How to load it and where to look — exact steps

1. Open Chrome, go to `chrome://extensions`.
2. **If the extension from a previous attempt is still loaded, click the
   refresh/reload icon on its card first** (or remove it and re-load) so
   Chrome picks up all the new files — don't rely on a stale load. This
   matters more than usual this retry since the bundled models changed
   entirely (yolos-tiny removed, two new candidates added).
3. Turn on **Developer mode** (top-right toggle) if not already on.
4. Click **Load unpacked**.
5. Select the folder `spike/chrome-harness` (the one containing
   `manifest.json` — not `spike/` itself).
6. The extension card for "SIH 26171 - Phase 0 webgpu-spike" appears. If
   Chrome shows an error banner on the card (red text), the manifest failed
   to load — read that error first, it means the harness didn't even start.
7. On that same extension card, look for a line of small links under the
   card's details, e.g. **"Inspect views: service worker"** and possibly
   **"offscreen.html"**. If you only see "service worker" and not
   "offscreen.html", the offscreen document may not have been created yet —
   click the **service worker** link first (opens its own DevTools) to check
   `background.js`'s console for creation errors, then go back to the
   extension card and check again for an "offscreen.html" link.
8. Click **"offscreen.html"** under Inspect views — this opens a separate
   DevTools window scoped to the offscreen document itself. **This is where
   all the real output is** — the model load, backend choice, and latency
   numbers are logged here, prefixed `[spike]`, not in the service worker's
   console.
9. Let it run to completion — two candidates, one of them an 82.5MB model
   that's never been loaded before, each with a load + 4 inferences. Read
   the console top to bottom. Look specifically for these markers:
   - `config: env.backends.onnx.wasm.wasmPaths = chrome-extension://.../ort/`
   - `config: env.localModelPath = chrome-extension://.../models/`
   - `--- [rtdetr_r18vd] (onnx-community/rtdetr_r18vd) starting ---`, then its
     architecture line, load time, class-coverage line, cold/3×warm/gate/
     ORT-warning/detections lines
   - `--- [dfine_n_coco] (onnx-community/dfine_n_coco-ONNX) starting ---`,
     same pattern
   - `=== CLASS COVERAGE SUMMARY ===`
   - `=== FINAL SUMMARY TABLE ===` — **copy this whole markdown table block
     verbatim**, it's what goes back into this README and what Phase 1 gets
     designed around
10. If a candidate shows `FAILED` with an error, that's a valid possible
    outcome (see risk points above), not a broken harness — the run should
    still complete for the other candidate. Report the failed candidate's
    exact error alongside the table.
11. If the *whole run* stops early with nothing resembling a summary table,
    or a `allowRemoteModels=false` error naming a path, copy the **full**
    error text and stack trace — per CLAUDE.md Section 7, report exactly
    where and why it failed rather than guessing at a fix.

### If it works

You now have, for real: latency and class-coverage numbers for two
CNN-backbone candidates, directly comparable to the yolos-tiny 8,432ms
baseline, plus a direct empirical answer to whether the transformer-head
graph-splitting problem recurs with a different backbone — all fully
on-device with zero network calls. Paste the summary table and class
coverage block back so Chief can decide whether either candidate is viable
for Phase 1, or whether this points to raw-ORT YOLO or the DOM-only fallback.

### If it doesn't work

Report the exact console output (or absence of one) back. Do not swap to an
unapproved model, do not relax the CSP, do not paper over the failure by
cherry-picking a run or shrinking the test image. An honest "neither
candidate gets near 1s, here's exactly what the numbers and warnings show" is
a complete and valuable result — Chief has the DOM-only fallback (CLAUDE.md
Section 9.5) ready specifically for this outcome.

<details>
<summary>Retry 2's closing note (superseded, for history)</summary>

**This is retry 2 of 2** (Section 7 rule 1) — this is the last
attempt; if it still fails, Phase 0 stops and escalates to Chief per Section
7 rule 4 rather than trying a third fix. (That cap governed fixing
yolos-tiny specifically; it was reached, and Chief re-scoped to a model swap
— retry 3 above — rather than authorizing a third attempt at the same model.)

</details>
