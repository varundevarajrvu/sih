// SIH 26171 -- Phase 1 (extension-scaffold): offscreen document, the
// inference host.
//
// Wires Phase 0's confirmed inference call (CLAUDE.md "PHASE 0 CLOSED",
// spike/README.md) into the background<->offscreen message contract
// (CLAUDE.md Section 4, Phase 1):
//
//   -> { type: "DETECT_OBJECTS", requestId, imageData: base64 }
//   <- { type: "DETECTION_RESULT", requestId, boxes: [{label, score, xmin, ymin, xmax, ymax}] }
//   <- { type: "DETECTION_ERROR", requestId, error: { message, stage } }
//
// The error variant is a Phase 1 addition -- Section 4's contract only
// specified the success leg. See extension/README.md "Message contract"
// for the full writeup of why it's shaped this way.
//
// SHIPPING CONFIG (Chief's decision, CLAUDE.md "PHASE 0 CLOSED" --
// non-negotiable, do not substitute): Xenova/yolos-tiny, device:
// "webgpu", dtype: "fp32". The only configuration proven to run
// end-to-end in a browser (median warm 8,432ms -- 8.4x over the
// original ~1s gate, which Chief re-scoped to this measured floor).
//
// This file is bundled with esbuild (`npm run build` in extension/)
// because @huggingface/transformers' browser build uses bare-specifier
// imports ("onnxruntime-common" / "onnxruntime-web") that a raw
// `<script type="module">` cannot resolve -- mandatory carry-over #6.
// Rebuild after editing:
//   cd extension && npm run build

import { pipeline, RawImage, env } from "@huggingface/transformers";

function log(...args) {
  console.log("[offscreen]", ...args);
}

// ---- Mandatory carry-overs #1 + #2 (CLAUDE.md "PHASE 0 CLOSED"):
// bundle ORT + weights locally, zero network calls at runtime. Must be
// set BEFORE any pipeline() call -- MV3's script-src 'self' blocks the
// library's CDN-default dynamic import() outright, and this is required
// for the on-device privacy claim regardless. ----
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("ort/"); // trailing slash matters
env.allowLocalModels = true; // browser default is false -- must opt in
env.allowRemoteModels = false; // fail LOUDLY (naming the missing path) instead of silently phoning out
env.localModelPath = chrome.runtime.getURL("models/"); // trailing slash matters
env.useBrowserCache = false; // don't let stale Cache Storage mask a missing local file

log("config: env.backends.onnx.wasm.wasmPaths =", env.backends.onnx.wasm.wasmPaths);
log("config: env.localModelPath =", env.localModelPath);
log("config: env.allowLocalModels =", env.allowLocalModels, "| env.allowRemoteModels =", env.allowRemoteModels);

// Chief's shipping config (CLAUDE.md "PHASE 0 CLOSED") -- do not swap
// models here; see spike/README.md's retry 3 for why the CNN-backbone
// candidates (rtdetr_r18vd, dfine_n_coco) are NOT used: neither was ever
// verified end-to-end in-browser (both crash on an onnxruntime-web
// WebGPU AveragePool/ceil_mode op gap per CLAUDE.md).
const MODEL_ID = "Xenova/yolos-tiny";

// Mandatory carry-over #3: dtype pinned explicitly on every pipeline()
// call. The library's own DEFAULT_DEVICE_DTYPE_MAPPING gives "wasm" a
// different default (q8) than "webgpu"/others (fp32) -- an unpinned
// webgpu->wasm fallback would silently need a second weight file. This
// extension bundles fp32 ONLY: q8 was retired in Phase 0 (dominated by
// fp32 on both speed AND accuracy -- slower on both backends tested, and
// produced quantization-noise false positives).
const DTYPE = "fp32";

// NOT specified anywhere in CLAUDE.md's Phase 0/1 sections -- a Phase 1
// judgment call, flagged in the report back to the orchestrator. The
// library defaults `threshold` to 0.9; every Phase 0 spike run
// (node-test.js, node-test-contract.js, all three chrome-harness
// retries) used 0.5 "to see more candidate boxes for verification".
// Kept at 0.5 here for continuity with the only numbers this project has
// ever measured for this model+config. Phase 2b (redaction) may want to
// revisit this once it has an opinion on false-positive tolerance for
// vision-sourced redaction boxes.
const SCORE_THRESHOLD = 0.5;

// ---- CLAUDE.md Section 5 invariant: "WebGPU is a speed optimization,
// never a dependency. Every inference call must degrade to WASM, not
// fail." IMPORTANT CAVEAT: every Phase 0 harness run had WebGPU succeed
// on the first try, so this fallback path has never actually fired in
// this project -- it is DESIGN satisfying the invariant, not a
// carried-over VERIFIED behavior. Flagged in extension/README.md as
// something Varun can exercise for real (e.g. temporarily disabling
// WebGPU via chrome://flags/#enable-unsafe-webgpu or on a machine
// without a WebGPU-capable GPU) if he wants the fallback leg proven. ----
let detectorPromise = null;
let activeDevice = null; // "webgpu" | "wasm" | null (not loaded yet) -- surfaced in logs only

async function loadDetector() {
  try {
    log("loading pipeline: device=webgpu dtype=fp32 ...");
    const t0 = performance.now();
    const detector = await pipeline("object-detection", MODEL_ID, { device: "webgpu", dtype: DTYPE });
    activeDevice = "webgpu";
    log(`pipeline loaded on webgpu in ${(performance.now() - t0).toFixed(1)}ms`);
    return detector;
  } catch (err) {
    log("webgpu pipeline load FAILED, falling back to wasm:", err?.message || err);
    const t0 = performance.now();
    const detector = await pipeline("object-detection", MODEL_ID, { device: "wasm", dtype: DTYPE });
    activeDevice = "wasm";
    log(`pipeline loaded on wasm (fallback) in ${(performance.now() - t0).toFixed(1)}ms`);
    return detector;
  }
}

function getDetector() {
  if (!detectorPromise) detectorPromise = loadDetector();
  return detectorPromise;
}

// The contract's `imageData` field is documented as "base64" (no
// data:-URL framing specified). background.js is expected to send raw
// base64 (it strips chrome.tabs.captureVisibleTab's data:-URL prefix
// before sending -- see extension/README.md). This strip is kept here
// too, defensively, in case a future caller sends the prefix intact --
// costs nothing and matches the spike's own defensive pattern.
function stripDataUrlPrefix(imageData) {
  if (typeof imageData === "string" && imageData.startsWith("data:")) {
    const commaIdx = imageData.indexOf(",");
    if (commaIdx !== -1) return imageData.slice(commaIdx + 1);
  }
  return imageData;
}

function base64ToBlob(base64, mimeType = "image/png") {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

// Mandatory carry-over #4: flatten the library's nested
// { score, label, box: {xmin,ymin,xmax,ymax} } into the flat contract
// shape { label, score, xmin, ymin, xmax, ymax }. Adapter reused
// verbatim from spike/node-test-contract.js (verified against the
// library's real output and ObjectDetectionPipeline._call source).
function flattenDetections(raw) {
  return raw.map((r) => ({
    label: r.label,
    score: r.score,
    xmin: r.box.xmin,
    ymin: r.box.ymin,
    xmax: r.box.xmax,
    ymax: r.box.ymax,
  }));
}

// Carries WHICH stage of runDetection failed, so DETECTION_ERROR replies
// are debuggable (model_load / image_decode / inference) instead of a
// bare message string.
class DetectionStageError extends Error {
  constructor(stage, cause) {
    super(cause?.message || String(cause));
    this.stage = stage;
    this.cause = cause;
  }
}

// THE INTERFACE CONTRACT (CLAUDE.md Section 4, Phase 0/1) --
// runDetection(imageBase64) -> [{label, score, xmin, ymin, xmax, ymax}].
//
// Phase 4 diagnostic instrumentation (coordinator-requested, 2026-09-11):
// a live run measured `detect` at ~17-21s per step across a multi-step
// loop, vs. an earlier single-shot measurement of ~800ms -- ambiguous
// because the old contract conflated model-LOAD time with INFERENCE time
// into one number. This is the ONLY place that ambiguity can be resolved:
// `detectorPromise` (below) is module-local state invisible to
// background.js, so only code in THIS file can truthfully report whether
// a given call paid a fresh model-load cost or reused an already-warm
// pipeline. The return shape below is therefore an OBJECT, not the bare
// array the contract originally specified -- additive, not a breaking
// rename (`boxes` is still exactly the old array). No detection LOGIC
// changed: same model, same device/dtype, same threshold.
async function runDetection(imageDataBase64) {
  // Captured BEFORE getDetector() runs: is there already a (settled or
  // in-flight) pipeline promise? If yes, this call will NOT pay a load
  // cost. If this offscreen document was just freshly created (or its
  // module state was otherwise reset), detectorPromise is null and this
  // call WILL pay the full load cost -- exactly the signal needed to
  // confirm or refute "the offscreen doc/pipeline gets torn down between
  // steps."
  const wasAlreadyLoaded = detectorPromise !== null;

  let detector;
  const tLoad0 = performance.now();
  try {
    detector = await getDetector();
  } catch (err) {
    throw new DetectionStageError("model_load", err);
  }
  // If the pipeline was already loaded/loading, this await resolves near-
  // instantly (microtask overhead only, not a real load) -- report a
  // clean 0 rather than a few stray milliseconds of noise, so
  // modelLoadMs is unambiguous: >0 means a real load happened THIS call.
  const modelLoadMs = wasAlreadyLoaded ? 0 : performance.now() - tLoad0;

  // Mandatory carry-over #5: RawImage.fromBlob(), not fromURL() with a
  // data: URI (fromURL rejects data: URIs under Node; the Blob path is
  // used everywhere in this project for consistency, and is what was
  // actually verified in-browser by Phase 0).
  let image;
  try {
    const base64 = stripDataUrlPrefix(imageDataBase64);
    const blob = base64ToBlob(base64);
    image = await RawImage.fromBlob(blob);
  } catch (err) {
    throw new DetectionStageError("image_decode", err);
  }

  const tInfer0 = performance.now();
  try {
    // percentage:false -> absolute pixel coordinates in the INPUT
    // image's own dimensions (matches the contract's implicit
    // assumption; also the library default, passed explicitly here for
    // clarity per spike/README.md's guidance not to rely on either
    // default silently).
    const raw = await detector(image, { threshold: SCORE_THRESHOLD, percentage: false });
    const inferenceMs = performance.now() - tInfer0;
    return {
      boxes: flattenDetections(raw),
      modelLoadMs,
      inferenceMs,
      pipelineWasAlreadyLoaded: wasAlreadyLoaded,
      device: activeDevice,
    };
  } catch (err) {
    throw new DetectionStageError("inference", err);
  }
}

// ---- Message contract wiring ----
chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "DETECT_OBJECTS") return; // not for us -- ignore (e.g. SET_TASK_GOAL, RUN_TEST_DETECTION meant for background.js)

  const { requestId, imageData } = message;
  handleDetectObjects(requestId, imageData);
  // Fire-and-forget: the reply travels as a NEW broadcast sendMessage
  // (DETECTION_RESULT / DETECTION_ERROR), not a synchronous
  // sendResponse -- matches CLAUDE.md's contract arrows exactly, and
  // lets background.js correlate replies to concurrent requests by
  // requestId instead of relying on one in-flight request at a time.
  return false;
});

async function handleDetectObjects(requestId, imageData) {
  if (!requestId) {
    log("DETECT_OBJECTS received with no requestId -- dropping (cannot correlate a reply, and the sender has no way to await one either).");
    return;
  }

  log(`DETECT_OBJECTS ${requestId} received (device so far: ${activeDevice ?? "not loaded yet"})`);
  try {
    const t0 = performance.now();
    const result = await runDetection(imageData);
    const ms = performance.now() - t0;
    log(
      `DETECT_OBJECTS ${requestId} OK in ${ms.toFixed(1)}ms on device=${result.device} ` +
        `(modelLoadMs=${result.modelLoadMs.toFixed(1)}, inferenceMs=${result.inferenceMs.toFixed(1)}, ` +
        `pipelineWasAlreadyLoaded=${result.pipelineWasAlreadyLoaded}), ${result.boxes.length} detection(s)`,
    );
    chrome.runtime.sendMessage({
      type: "DETECTION_RESULT",
      requestId,
      boxes: result.boxes,
      // Phase 4 diagnostic additions -- additive, existing consumers that
      // only read `boxes` are unaffected.
      modelLoadMs: result.modelLoadMs,
      inferenceMs: result.inferenceMs,
      pipelineWasAlreadyLoaded: result.pipelineWasAlreadyLoaded,
      device: result.device,
    }).catch(() => {
      // Background may have been torn down/restarted mid-flight (MV3 SWs
      // are killed on idle). Nothing more this side can do for this
      // specific request -- background's own request timeout is the
      // backstop that keeps its caller from hanging forever.
      log(`DETECT_OBJECTS ${requestId}: could not deliver DETECTION_RESULT (no listener) -- background likely restarted mid-request`);
    });
  } catch (err) {
    const stage = err instanceof DetectionStageError ? err.stage : "unknown";
    const errMessage = err?.message || String(err);
    log(`DETECT_OBJECTS ${requestId} FAILED at stage=${stage}:`, errMessage);
    chrome.runtime.sendMessage({
      type: "DETECTION_ERROR",
      requestId,
      error: { message: errMessage, stage },
    }).catch(() => {
      log(`DETECT_OBJECTS ${requestId}: could not deliver DETECTION_ERROR (no listener) -- background likely restarted mid-request`);
    });
  }
}

log("offscreen document ready, waiting for DETECT_OBJECTS messages.");
