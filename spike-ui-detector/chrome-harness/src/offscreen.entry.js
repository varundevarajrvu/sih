// UI-detector follow-up spike -- Chrome MV3 offscreen document harness.
//
// UNVERIFIED BY THIS AGENT. This code has never been run inside Chrome --
// the authoring agent has no browser automation. Varun must load this
// unpacked and read the console output himself. See ../../README.md for
// exact steps. Both candidates PASSED Node-first verification (real
// onnxruntime-node forward pass, real detections, see ../../README.md) --
// this harness is what tells us whether they also survive WebGPU inside
// an MV3 offscreen document, and at what latency.
//
// WHY RAW onnxruntime-web, NOT @huggingface/transformers' pipeline():
// both candidates are YOLOv8 (model_type "yolov8"), which is NOT in
// transformers.js's MODEL_FOR_OBJECT_DETECTION_MAPPING_NAMES whitelist
// (confirmed in Phase 0's own retry-3 investigation: only detr, rt_detr,
// rt_detr_v2, rf_detr, d_fine, table-transformer, yolos are supported).
// So this harness imports onnxruntime-web directly and reuses the EXACT
// same preprocessing/decode/NMS math already verified in Node
// (../../lib/yolo-math.js, ported to canvas-based image I/O in
// ./browser-image-utils.js) -- a Node PASS and a browser PASS are testing
// the same decode logic, not two independently-written implementations.
//
// Local-only, zero network calls, same mechanism Phase 0 proved out:
//   ort.env.wasm.wasmPaths -> chrome-extension://.../ort/ (the exact
//   ort-wasm-simd-threaded.jsep.{mjs,wasm} files copied verbatim from
//   spike/chrome-harness/ort/, which Phase 0 already verified working in
//   a real browser on webgpu). Model weights are fetched via
//   chrome.runtime.getURL(...) -- same-origin, no CDN, no network call
//   outside the extension package.
//
// CANDIDATES (both verified against the live HF API -- real repo, real
// onnx file, real byte size, matched against Content-Length before
// download; see ../../README.md for the full verification log):
//   1. onnx-community/OmniParser-icon_detect (fp32 12,136,163 bytes,
//      quantized/uint8 3,226,354 bytes) -- THIRD-PARTY ONNX conversion
//      (org "onnx-community", HF's own auto-convert bot) of Microsoft's
//      real OmniParser icon_detect weights. CONFIRMED nc=1 (single class
//      "icon") via microsoft/OmniParser-v2.0's icon_detect/model.yaml --
//      this model answers "is this a UI element", not "what kind".
//   2. OpenDILabCommunity/webpage_element_detection (web_detect_best_m.onnx,
//      103,477,118 bytes, YOLOv8-medium) -- trained specifically on
//      webpage screenshots (Roboflow "website-screenshots" dataset).
//      CONFIRMED 8 real semantic classes via the ONNX file's own embedded
//      ultralytics metadata: button, field, heading, iframe, image, label,
//      link, text. Far more directly on-topic than OmniParser, but >2x
//      the size of the extension's current ~48MB footprint -- flagged,
//      not hidden.
//
// Both are pure CNN (YOLOv8: Conv/BatchNorm/SiLU/Concat/Upsample/MaxPool)
// with NO transformer encoder/decoder -- unlike yolos-tiny/RT-DETR/D-FINE,
// there is no attention block or DETR-style shape op expected to force a
// CPU fallback. That is a reason to expect clean WebGPU mapping, NOT
// confirmation -- this harness still watches for the same ORT "not
// assigned to preferred execution provider" graph-split warning, exactly
// like every prior retry, and reports it plainly if it fires.

import * as ort from "onnxruntime-web/webgpu";
import { letterboxResizeBrowser, divisorResizeBrowser } from "./browser-image-utils.js";
import { toCHWFloat, decodeYoloV8, unletterbox, nms, median } from "../../lib/yolo-math.js";

const WARM_RUNS = 3;
const GATE_MS = 1000; // CLAUDE.md Section 4 Phase 0 "~1s gate"
const IMAGE_URL = chrome.runtime.getURL("assets/demo-page-screenshot.png");

// ---- Local-only configuration. Must happen before any InferenceSession.create call. ----
const ORT_BASE_URL = chrome.runtime.getURL("ort/"); // trailing slash matters
ort.env.wasm.wasmPaths = ORT_BASE_URL;

function log(...args) {
  console.log("[ui-detector-spike]", ...args);
}

log("config: ort.env.wasm.wasmPaths =", ort.env.wasm.wasmPaths);
log("onnxruntime-web version:", ort.env.versions?.common ?? "(unknown)");

// Reference points for the summary table:
// - PRODUCTION shipping baseline (yolos-tiny, webgpu+fp32, real detections,
//   real viewport captures) is CLAUDE.md's CURRENT number, NOT the
//   superseded 8,432ms spike-harness figure. See CLAUDE.md Phase 0
//   "CORRECTION" block, 2026-09-11: 784/817/860/881ms, ~780-880ms.
const YOLOS_TINY_PRODUCTION_BASELINE_MS = 830; // midpoint of the 784-881ms shipped-extension range

const CANDIDATES = [
  {
    key: "omniparser_fp32",
    label: "OmniParser icon_detect (fp32)",
    modelUrl: chrome.runtime.getURL("models/onnx-community/OmniParser-icon_detect/onnx/model.onnx"),
    numClasses: 1,
    labels: ["icon"],
    scoreThreshold: 0.3,
    preprocess: (url) => divisorResizeBrowser(url, 640, 32), // see ../../node-test-omniparser.js for the divisor=32 finding
    sizeBytes: 12136163,
  },
  {
    key: "omniparser_q8",
    label: "OmniParser icon_detect (quantized/uint8)",
    modelUrl: chrome.runtime.getURL("models/onnx-community/OmniParser-icon_detect/onnx/model_quantized.onnx"),
    numClasses: 1,
    labels: ["icon"],
    scoreThreshold: 0.3,
    preprocess: (url) => divisorResizeBrowser(url, 640, 32),
    sizeBytes: 3226354,
  },
  {
    key: "webpage_element_detect",
    label: "OpenDILab webpage_element_detection (fp32, 98.7MiB)",
    modelUrl: chrome.runtime.getURL("models/OpenDILabCommunity/webpage_element_detection/web_detect_best_m.onnx"),
    numClasses: 8,
    labels: ["button", "field", "heading", "iframe", "image", "label", "link", "text"],
    scoreThreshold: 0.25,
    preprocess: (url) => letterboxResizeBrowser(url, 640, 640),
    sizeBytes: 103477118,
  },
];

async function runOnce(session, chw, width, height) {
  const tensor = new ort.Tensor("float32", chw, [1, 3, height, width]);
  const t0 = performance.now();
  const outputs = await session.run({ images: tensor });
  const ms = performance.now() - t0;
  return { outputs, ms };
}

// Wraps console.warn/error for the WHOLE candidate run (session create +
// all inferences) to catch ORT's "not assigned to the preferred execution
// provider" graph-split warning and the specific known blocker from Phase 0
// ("using ceil() in shape computation is not yet supported for AveragePool")
// -- or any other unimplemented-WebGPU-kernel error. Same mechanism as
// spike/chrome-harness/src/offscreen.entry.js, not modified, freshly
// applied here.
function interceptWarnings() {
  const hits = [];
  const origWarn = console.warn;
  const origError = console.error;
  const scan = (args) => {
    const text = args
      .map((a) => {
        try {
          return typeof a === "string" ? a : JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(" ");
    if (/not assigned|preferred execution provider|not yet supported|fallback/i.test(text)) {
      hits.push(text);
    }
  };
  console.warn = (...args) => {
    scan(args);
    origWarn.apply(console, args);
  };
  console.error = (...args) => {
    scan(args);
    origError.apply(console, args);
  };
  return {
    hits,
    restore() {
      console.warn = origWarn;
      console.error = origError;
    },
  };
}

async function benchmarkCandidate(candidate) {
  const { key, label, modelUrl, numClasses, labels, scoreThreshold, preprocess, sizeBytes } = candidate;
  log(`--- [${key}] (${label}, ${(sizeBytes / 1024 / 1024).toFixed(1)}MiB) starting ---`);

  const warnings = interceptWarnings();
  let session;
  let backendUsed = "webgpu";

  try {
    const t0 = performance.now();
    try {
      session = await ort.InferenceSession.create(modelUrl, { executionProviders: ["webgpu"] });
    } catch (webgpuErr) {
      // Section 5 invariant: "WebGPU is a speed optimization, never a
      // dependency. Every inference call must degrade to WASM, not fail."
      log(`[${key}] webgpu session create FAILED, falling back to wasm. Error:`, webgpuErr?.message ?? webgpuErr);
      backendUsed = "wasm";
      session = await ort.InferenceSession.create(modelUrl, { executionProviders: ["wasm"] });
    }
    const loadMs = performance.now() - t0;
    log(`[${key}] session loaded on backend=${backendUsed} in ${loadMs.toFixed(1)}ms`);

    const pre = await preprocess(IMAGE_URL);
    log(
      `[${key}] preprocess: orig ${pre.origWidth}x${pre.origHeight} -> ${pre.width}x${pre.height} (scale=${pre.scale.toFixed(4)}, pad=${pre.padX},${pre.padY})`
    );
    const chw = toCHWFloat(pre.data, pre.width, pre.height);

    const cold = await runOnce(session, chw, pre.width, pre.height);
    log(`[${key}] COLD inference: ${cold.ms.toFixed(1)}ms`);

    const warmTimes = [];
    let lastOutputs;
    for (let i = 0; i < WARM_RUNS; i++) {
      const r = await runOnce(session, chw, pre.width, pre.height);
      warmTimes.push(r.ms);
      lastOutputs = r.outputs;
      log(`[${key}] WARM run ${i + 1}/${WARM_RUNS}: ${r.ms.toFixed(1)}ms`);
    }
    const medianWarmMs = median(warmTimes);

    const outTensor = lastOutputs[session.outputNames[0]];
    log(`[${key}] raw output dims:`, JSON.stringify(outTensor.dims));
    const raw = decodeYoloV8(outTensor, numClasses, labels, scoreThreshold);
    const unlb = unletterbox(raw, pre.scale, pre.padX, pre.padY);
    const detections = nms(unlb, 0.45);

    log(`[${key}] detections (score>=${scoreThreshold}, after NMS): ${detections.length}`);
    for (const d of detections.slice(0, 20)) {
      log(
        `[${key}]   ${d.label} score=${d.score.toFixed(3)} box=[${d.xmin.toFixed(0)},${d.ymin.toFixed(0)},${d.xmax.toFixed(0)},${d.ymax.toFixed(0)}]`
      );
    }

    log(`[${key}] MEDIAN warm: ${medianWarmMs.toFixed(1)}ms`);
    log(`[${key}] gate (<${GATE_MS}ms on median warm):`, medianWarmMs < GATE_MS ? "PASS" : "FAIL");
    log(`[${key}] ORT graph-split/unsupported-op warning observed:`, warnings.hits.length > 0 ? "YES" : "NO");
    if (warnings.hits.length) {
      log(`[${key}] warning text(s):`, JSON.stringify(warnings.hits, null, 2));
    }

    return {
      key,
      label,
      status: "ok",
      backendUsed,
      loadMs,
      coldMs: cold.ms,
      warmTimes,
      medianWarmMs,
      gatePass: medianWarmMs < GATE_MS,
      detections,
      warnings: warnings.hits,
      sizeBytes,
    };
  } catch (err) {
    const msg = (err && err.stack) || String(err);
    log(`[${key}] FAILED. Error:`, msg);
    return { key, label, status: "failed", backendUsed, error: msg, warnings: warnings.hits, sizeBytes };
  } finally {
    warnings.restore();
    if (session?.release) {
      try {
        await session.release();
        log(`[${key}] session released.`);
      } catch (releaseErr) {
        log(`[${key}] session release FAILED (non-fatal):`, releaseErr);
      }
    }
  }
}

function buildSummaryTable(results) {
  const header =
    "| Config | Backend | Status | Cold (ms) | Warm runs (ms) | Median warm (ms) | Gate (<1000ms) | ORT warning | Detections |";
  const sep = "|---|---|---|---|---|---|---|---|---|";
  const rows = [
    `| yolos-tiny (PRODUCTION baseline, not re-run) | webgpu | fixed | - | (784/817/860/881ms observed) | ${YOLOS_TINY_PRODUCTION_BASELINE_MS} | PASS | n/a | 5 |`,
  ];
  for (const r of results) {
    if (r.status === "ok") {
      rows.push(
        `| ${r.label} | ${r.backendUsed} | ok | ${r.coldMs.toFixed(1)} | ${r.warmTimes.map((t) => t.toFixed(1)).join(", ")} | ${r.medianWarmMs.toFixed(1)} | ${r.gatePass ? "PASS" : "FAIL"} | ${r.warnings.length ? "YES" : "NO"} | ${r.detections.length} |`
      );
    } else {
      rows.push(
        `| ${r.label} | ${r.backendUsed ?? "-"} | FAILED | - | - | - | - | ${r.warnings.length ? "YES" : "NO"} | error: ${(r.error || "").split("\n")[0]} |`
      );
    }
  }
  return [header, sep, ...rows].join("\n");
}

async function main() {
  log("offscreen document starting...");
  log("Test image:", IMAGE_URL, "(real demo/test-page.html screenshot, NOT a COCO photo -- this is on-topic UI content, form inputs + an ID card image)");

  const results = [];
  for (const candidate of CANDIDATES) {
    results.push(await benchmarkCandidate(candidate));
  }

  log("=== CANDIDATE BENCHMARK COMPLETE ===");
  log("=== FINAL SUMMARY TABLE (copy-paste this whole block back) ===");
  console.log(buildSummaryTable(results));

  log("=== RAW RESULTS (JSON, for reference) ===");
  log(
    JSON.stringify(
      results.map((r) => ({
        key: r.key,
        status: r.status,
        backendUsed: r.backendUsed,
        loadMs: r.loadMs,
        coldMs: r.coldMs,
        warmTimes: r.warmTimes,
        medianWarmMs: r.medianWarmMs,
        gatePass: r.gatePass,
        detectionCount: r.detections?.length,
        warnings: r.warnings,
        error: r.error,
        sizeBytes: r.sizeBytes,
      })),
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error("[ui-detector-spike] FAILED (top-level, candidate benchmark did not complete):", err);
});
