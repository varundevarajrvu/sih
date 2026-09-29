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
import {
  rgbaToNchw,
  decodeFaceDetections,
  offsetDetections,
  computeTileGrid,
  mergeTileResults,
  FACE_DETECT_CONSTANTS,
} from "../lib/face-detect.js";

function log(...args) {
  console.log("[offscreen]", ...args);
}

// ---------------------------------------------------------------------
// V2 Phase V2 (vision-v2) -- detector switch. CLAUDE.md/ARCHITECTURE.md
// V0b decision (spikes/ultraface/RESULT.md, all 3 legs of the
// pre-registered rule satisfied): UltraFace RFB-320 REPLACES
// Xenova/yolos-tiny as the default face-redaction detector. Kept as ONE
// named switch, in ONE place, rather than scattered feature flags --
// "don't delete yolos weights yet (V4 decides); just stop loading them
// by default" per the V2 brief. Changing this back to "yolos" restores
// the exact pre-V2 code path below unmodified.
// ---------------------------------------------------------------------
const VISION_MODEL = "ultraface"; // "ultraface" | "yolos"

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
//
// V2 NOTE: this is the "yolos" leg of VISION_MODEL. Kept byte-for-byte
// (not loaded by default any more -- see runDetection() dispatcher below)
// per the V2 brief: "don't delete yolos weights yet (V4 decides); just
// stop loading them by default."
async function runDetectionYolos(imageDataBase64) {
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

// =======================================================================
// V2 Phase V2 (vision-v2) -- UltraFace RFB-320 path. DEFAULT as of the
// V0b decision (ARCHITECTURE.md, spikes/ultraface/RESULT.md, all 3 legs
// of the pre-registered rule satisfied: detects the demo face, detects
// every >=80px face, and warm p95 (61.0ms) is decisively lower than
// yolos's own best-published number). Produces boxes with label "face"
// through the EXACT SAME DETECT_OBJECTS/DETECTION_RESULT contract as the
// yolos path above -- content.js's PRIVACY_RELEVANT_LABELS filter is the
// only downstream change this requires (adds "face" to the allowlist).
//
// Deliberately does NOT go through @huggingface/transformers' pipeline()
// API (or its bundled jsep-only onnxruntime-web build) -- the V0b spike
// found that build hard-fails to even LOAD with no WebGPU adapter present,
// on EITHER device:"webgpu" or device:"wasm" (spikes/ultraface/RESULT.md,
// "Environment finding: yolos-tiny could not be run in a browser here at
// all"). Raw onnxruntime-web, imported directly and pointed at the PLAIN
// (non-jsep) wasm runtime bundle, tolerated a missing GPU adapter
// gracefully in that same spike. This file therefore bundles that plain
// runtime separately (extension/ort/ort.wasm.min.mjs +
// ort-wasm-simd-threaded.{mjs,wasm}, copied verbatim from
// spikes/ultraface/models/ort/ -- same onnxruntime-web release,
// 1.22.0-dev.20250409-89f8206ba4, as the jsep build the yolos path above
// already ships, confirmed by comparing both packages' package.json
// before copying, so mixing the two build variants in one ort/ directory
// is not a version mismatch).
//
// WASM ONLY, unconditionally -- invariant 5 ("WebGPU is a speed
// optimization, never a dependency... must never be required") is
// trivially satisfied because this path never attempts WebGPU at all.
// This is a deliberate scope cut, not an oversight: the V0b spike's own
// numbers show requesting webgpu for this exact model was SLOWER to load
// AND to run than plain wasm (RESULT.md section 4, "UltraFace's `webgpu`-
// requested session was slower than its `wasm` session, not faster"),
// and a real WebGPU attempt would need the OTHER (jsep) runtime bundle
// with its own EP-negotiation risk for no measured benefit on this tiny
// model -- not worth the added failure surface for this pass. Flagged in
// the report back to the orchestrator, not silently decided.
// =======================================================================

const ULTRAFACE_MODEL_PATH = "models/ultraface/ultraface-rfb320.onnx";
const ULTRAFACE_RUNTIME_ENTRY = "ort/ort.wasm.min.mjs";
// Project B's validated default (spikes/ultraface/RESULT.md step 6: "this
// spike also validated at the model's natural output, no threshold
// override needed to hit the confidences above") -- NOT yolos's 0.5;
// different model, different natural operating point, carried over
// unmodified from the recipe that was actually measured working.
const ULTRAFACE_THRESHOLD = 0.7;
const { MODEL_INPUT_WIDTH: ULTRAFACE_INPUT_W, MODEL_INPUT_HEIGHT: ULTRAFACE_INPUT_H } = FACE_DETECT_CONSTANTS;

// Pre-registered mitigation for small/far faces (V0b spike: 40/60px faces
// missed, >=80px caught). Tiled second pass, 2x2, ONLY when the
// single-pass first attempt finds zero faces -- see runDetectionUltraface()
// below. Gate (pre-registered, not moved after seeing numbers): "adopt it
// only if warm p95 for the whole detect call stays <=300ms; otherwise
// leave it off and record the numbers."
//
// MEASURED (benchmarks/results/v2-vision.json, real unpacked-extension
// Chromium run via Playwright, 2026-09-24, i5-1334U, WASM, 15 tiled-pass
// samples across the 40px/60px face fixtures + 3 no-face fixtures x 3
// repeats each): p50 159.2ms, p95 196.2ms -- UNDER the 300ms gate.
// ADOPTED. Single-pass (no tile fallback) warm inference on the same
// machine: demo face p50 32.9ms/p95 38.2ms; 80-200px faces 27-53ms.
//
// Recall, reported honestly rather than implied by "adopted": the tiled
// pass did NOT rescue detection at 40px or 60px in this measurement (both
// still 0 detections with the tile pass fired) -- it earns its place on
// the pre-registered LATENCY gate alone, not because it closed the V0b
// spike's small-face gap. Zero false positives introduced on the 3
// no-face fixtures either way. See this module's own report for the full
// numbers.
//
// ORCHESTRATOR RULING 2026-09-24: OFF. The V2 gate was mis-specified -- it
// tested latency only, but the pass exists solely to recover small faces,
// and it recovered none. On, it would add ~150 ms to every face-free page
// (most pages) for zero recall. Re-enable only with evidence it finds a face
// the single pass misses. Small faces (< 80 px) remain a documented gap.
const TILED_SECOND_PASS_ENABLED = false;
const TILE_GRID_COLS = 2;
const TILE_GRID_ROWS = 2;

let ultrafaceSessionPromise = null;
let ultrafaceActiveDevice = null; // "wasm" only in this pass -- see the file-level note above
let ultrafaceResizeCanvas = null;
let ultrafaceResizeCtx = null;

async function loadUltrafaceSession() {
  const runtimeUrl = chrome.runtime.getURL(ULTRAFACE_RUNTIME_ENTRY);
  log("ultraface: importing onnxruntime-web runtime from", runtimeUrl);
  // Dynamic import of a chrome-extension:// URL, same pattern content.js
  // already uses for lib/*.js under MV3's "script-src 'self'" CSP (see
  // CLAUDE.md Phase 4 RESULT, integration mismatch #1) -- esbuild cannot
  // statically resolve a runtime-computed specifier and leaves this as a
  // real dynamic import, which is exactly what's needed here.
  const ort = await import(/* @vite-ignore */ runtimeUrl);
  // Recipe from spikes/ultraface/lib/vision.mjs::createVisionDetector,
  // reused verbatim (this IS the verified-working configuration, not a
  // reimplementation): runtime files resolved relative to the entry
  // module's own URL, single-threaded (MV3 extension pages cannot
  // guarantee the cross-origin-isolation headers threaded WASM needs),
  // proxy disabled (no Worker indirection -- keeps this simple and matches
  // what was actually measured).
  ort.env.wasm.wasmPaths = new URL(".", runtimeUrl).href;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  const modelUrl = chrome.runtime.getURL(ULTRAFACE_MODEL_PATH);
  const t0 = performance.now();
  const session = await ort.InferenceSession.create(modelUrl, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
  ultrafaceActiveDevice = "wasm";
  log(`ultraface: session created on wasm in ${(performance.now() - t0).toFixed(1)}ms`);
  return { ort, session };
}

function getUltrafaceSession() {
  if (!ultrafaceSessionPromise) ultrafaceSessionPromise = loadUltrafaceSession();
  return ultrafaceSessionPromise;
}

function getUltrafaceResizeCanvas() {
  if (!ultrafaceResizeCanvas) {
    ultrafaceResizeCanvas = new OffscreenCanvas(ULTRAFACE_INPUT_W, ULTRAFACE_INPUT_H);
    ultrafaceResizeCtx = ultrafaceResizeCanvas.getContext("2d", { willReadFrequently: true });
    if (!ultrafaceResizeCtx) throw new Error("ultraface: 2D canvas context unavailable in offscreen document");
  }
  return ultrafaceResizeCtx;
}

/**
 * Run one UltraFace inference over a rectangular region of `bitmap`
 * (region = the whole image for the single-pass path; a tile rect for the
 * mitigation pass), resized to the model's fixed 320x240 input. Decode
 * targets `regionWidth`/`regionHeight` directly -- see face-detect.js's
 * file header for why that needs no separate DPR-scaling step.
 */
async function runUltrafaceOnRegion(ort, session, bitmap, regionX, regionY, regionWidth, regionHeight) {
  const ctx = getUltrafaceResizeCanvas();
  ctx.clearRect(0, 0, ULTRAFACE_INPUT_W, ULTRAFACE_INPUT_H);
  ctx.drawImage(bitmap, regionX, regionY, regionWidth, regionHeight, 0, 0, ULTRAFACE_INPUT_W, ULTRAFACE_INPUT_H);
  const imageData = ctx.getImageData(0, 0, ULTRAFACE_INPUT_W, ULTRAFACE_INPUT_H);
  const nchw = rgbaToNchw(imageData.data, ULTRAFACE_INPUT_W, ULTRAFACE_INPUT_H);
  const tensor = new ort.Tensor("float32", nchw, [1, 3, ULTRAFACE_INPUT_H, ULTRAFACE_INPUT_W]);
  let output;
  try {
    output = await session.run({ [session.inputNames[0]]: tensor });
  } finally {
    tensor.dispose();
  }
  const outputs = Object.values(output);
  try {
    const scoresT = outputs.find((t) => t.dims.at(-1) === 2);
    const boxesT = outputs.find((t) => t.dims.at(-1) === 4);
    if (!scoresT || !boxesT) throw new Error("ultraface: unexpected model output tensor shapes");
    return decodeFaceDetections(scoresT.data, boxesT.data, regionWidth, regionHeight, ULTRAFACE_THRESHOLD);
  } finally {
    for (const t of outputs) {
      try {
        t.dispose();
      } catch {
        // best-effort cleanup; a dispose failure here must not mask the
        // real detection result/error already being propagated.
      }
    }
  }
}

async function runDetectionUltraface(imageDataBase64) {
  const wasAlreadyLoaded = ultrafaceSessionPromise !== null;
  const tLoad0 = performance.now();
  let ort, session;
  try {
    ({ ort, session } = await getUltrafaceSession());
  } catch (err) {
    throw new DetectionStageError("model_load", err);
  }
  const modelLoadMs = wasAlreadyLoaded ? 0 : performance.now() - tLoad0;

  let bitmap;
  try {
    const base64 = stripDataUrlPrefix(imageDataBase64);
    const blob = base64ToBlob(base64);
    bitmap = await createImageBitmap(blob);
  } catch (err) {
    throw new DetectionStageError("image_decode", err);
  }

  const tInfer0 = performance.now();
  let tiledPassUsed = false;
  try {
    const { width, height } = bitmap; // the screenshot's own real pixel dims -- see face-detect.js header on why this alone carries devicePixelRatio correctness through
    let boxes = await runUltrafaceOnRegion(ort, session, bitmap, 0, 0, width, height);

    if (boxes.length === 0 && TILED_SECOND_PASS_ENABLED) {
      tiledPassUsed = true;
      const tiles = computeTileGrid(width, height, TILE_GRID_COLS, TILE_GRID_ROWS);
      const perTile = [];
      for (const tile of tiles) {
        const tileDetections = await runUltrafaceOnRegion(ort, session, bitmap, tile.x, tile.y, tile.width, tile.height);
        perTile.push(offsetDetections(tileDetections, tile.x, tile.y));
      }
      boxes = mergeTileResults(perTile);
    }

    const inferenceMs = performance.now() - tInfer0;
    return {
      boxes,
      modelLoadMs,
      inferenceMs,
      pipelineWasAlreadyLoaded: wasAlreadyLoaded,
      device: ultrafaceActiveDevice,
      tiledPassUsed,
    };
  } catch (err) {
    if (err instanceof DetectionStageError) throw err;
    throw new DetectionStageError("inference", err);
  } finally {
    try {
      bitmap.close();
    } catch {
      // non-fatal cleanup
    }
  }
}

// ---- Detector switch dispatcher (CLAUDE.md/ARCHITECTURE.md V2 decision) ----
async function runDetection(imageDataBase64) {
  if (VISION_MODEL === "ultraface") return runDetectionUltraface(imageDataBase64);
  return runDetectionYolos(imageDataBase64);
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

  const deviceSoFar = VISION_MODEL === "ultraface" ? ultrafaceActiveDevice : activeDevice;
  log(`DETECT_OBJECTS ${requestId} received (model=${VISION_MODEL}, device so far: ${deviceSoFar ?? "not loaded yet"})`);
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
      // V2 addition -- undefined on the yolos leg (no tiled-pass concept
      // there), present (true/false) on the ultraface leg. Additive, same
      // shape as the other Phase 4 diagnostic fields above.
      tiledPassUsed: result.tiledPassUsed,
      visionModel: VISION_MODEL,
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
