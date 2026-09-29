// V0b ultraface-spike harness. Runs inside a plain Chromium page (a stand-in
// for the MV3 offscreen document -- no chrome.* APIs are used by either
// detection path, so this is a fair proxy). Exposes window.__bench with one
// method per measurement the RESULT needs. Driven by run-bench.mjs via
// Playwright's page.evaluate().
//
// YOLOS path: reproduces extension/src/offscreen.entry.js's pipeline() call
// exactly (device, dtype, threshold, percentage:false, flatten shape).
// ULTRAFACE path: reuses lib/vision.mjs's rgbaToNchw/decodeFaces verbatim
// (copied byte-for-byte from Prototype/shared/vision.mjs) for the actual
// pre/post-processing recipe; session creation is parameterized here (not in
// vision.mjs, which hardcodes executionProviders:['wasm']) so both wasm and
// webgpu execution providers can be benchmarked.

import { pipeline, RawImage, env as hfEnv } from "@huggingface/transformers";
import { rgbaToNchw, decodeFaces } from "./lib/vision.mjs";

// ---------------- YOLOS (Xenova/yolos-tiny) ----------------
// Config mirrors extension/src/offscreen.entry.js line for line.
hfEnv.allowLocalModels = true;
hfEnv.allowRemoteModels = false;
hfEnv.localModelPath = "/models/";
hfEnv.useBrowserCache = false;
// Mandatory per offscreen.entry.js -- without this, transformers.js's
// bundled onnxruntime-web resolves its own wasm/worker assets relative to
// the bundle's own location, which breaks under esbuild bundling (and would
// otherwise fall back to a CDN, which is exactly what MV3 CSP blocks in
// production; kept local here too so the spike measures the same code path).
hfEnv.backends.onnx.wasm.wasmPaths = "/models/ort-transformers/";

const YOLOS_MODEL_ID = "Xenova/yolos-tiny";
const YOLOS_DTYPE = "fp32";
const YOLOS_THRESHOLD = 0.5;

let yolosDetector = null;
let yolosDevice = null;

function flattenYolos(raw) {
  return raw.map((r) => ({
    label: r.label,
    score: r.score,
    xmin: r.box.xmin,
    ymin: r.box.ymin,
    xmax: r.box.xmax,
    ymax: r.box.ymax,
  }));
}

async function fetchBlob(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`);
  return res.blob();
}

// ---------------- UltraFace (RFB-320) ----------------
// session creation parameterized by executionProviders + which ORT build to
// load, so we can benchmark wasm (Project B's shipped config) and webgpu
// (this spike's question) with the identical pre/post-processing.
const ortModules = {}; // cache loaded ort module namespaces by key

async function loadOrt(key, mjsUrl, wasmDir) {
  if (ortModules[key]) return ortModules[key];
  const ort = await import(/* @vite-ignore */ mjsUrl);
  ort.env.wasm.wasmPaths = wasmDir;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ortModules[key] = ort;
  return ort;
}

let ultrafaceSession = null;
let ultrafaceBackendUsed = null;
let ultrafaceCanvas = null;
let ultrafaceCtx = null;

async function createUltraFaceSession(backend) {
  let ort, executionProviders;
  if (backend === "webgpu") {
    ort = await loadOrt("webgpu", "/models/ort-webgpu/ort.webgpu.min.mjs", "/models/ort-webgpu/");
    executionProviders = ["webgpu", "wasm"]; // let ORT fall back internally if webgpu unavailable
  } else {
    ort = await loadOrt("wasm", "/models/ort/ort.wasm.min.mjs", "/models/ort/");
    executionProviders = ["wasm"];
  }
  const session = await ort.InferenceSession.create("/models/ultraface-rfb320.onnx", {
    executionProviders,
    graphOptimizationLevel: "all",
  });
  // ORT records which EP actually claimed each node; inspect the session's
  // handler for a coarse signal, else fall back to "requested backend".
  return { ort, session };
}

window.__bench = {
  // ---- info ----
  async gpuInfo() {
    if (!navigator.gpu) return { webgpuAvailable: false, reason: "navigator.gpu absent (no adapter, or stubbed out for a WASM-floor run)" };
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return { webgpuAvailable: false, reason: "no adapter" };
      const info = adapter.info || {};
      return {
        webgpuAvailable: true,
        vendor: info.vendor || null,
        architecture: info.architecture || null,
        device: info.device || null,
        description: info.description || null,
      };
    } catch (err) {
      return { webgpuAvailable: false, reason: err?.message || String(err) };
    }
  },

  // ---- YOLOS lifecycle ----
  async loadYolos(device = "webgpu") {
    const t0 = performance.now();
    try {
      yolosDetector = await pipeline("object-detection", YOLOS_MODEL_ID, { device, dtype: YOLOS_DTYPE });
      yolosDevice = device;
      return { ok: true, device, loadMs: performance.now() - t0 };
    } catch (err) {
      return { ok: false, device, error: err?.message || String(err), loadMs: performance.now() - t0 };
    }
  },

  async detectYolos(imageUrl) {
    if (!yolosDetector) throw new Error("yolos not loaded");
    const blob = await fetchBlob(imageUrl);
    const image = await RawImage.fromBlob(blob);
    const t0 = performance.now();
    const raw = await yolosDetector(image, { threshold: YOLOS_THRESHOLD, percentage: false });
    const ms = performance.now() - t0;
    return { detections: flattenYolos(raw), ms, device: yolosDevice };
  },

  // ---- UltraFace lifecycle ----
  async loadUltraFace(backend = "wasm") {
    const t0 = performance.now();
    try {
      const { session } = await createUltraFaceSession(backend);
      ultrafaceSession = session;
      ultrafaceBackendUsed = backend;
      ultrafaceCanvas = new OffscreenCanvas(320, 240);
      ultrafaceCtx = ultrafaceCanvas.getContext("2d", { willReadFrequently: true });
      return { ok: true, backend, loadMs: performance.now() - t0 };
    } catch (err) {
      return { ok: false, backend, error: err?.message || String(err), loadMs: performance.now() - t0 };
    }
  },

  async detectUltraFace(imageUrl) {
    if (!ultrafaceSession) throw new Error("ultraface not loaded");
    const blob = await fetchBlob(imageUrl);
    const bitmap = await createImageBitmap(blob);
    const width = bitmap.width;
    const height = bitmap.height;
    const tTotal0 = performance.now();
    // resize-to-320x240 cost included, per spec.
    ultrafaceCtx.drawImage(bitmap, 0, 0, 320, 240);
    const pixels = ultrafaceCtx.getImageData(0, 0, 320, 240).data;
    const tensorData = rgbaToNchw(pixels, 320, 240);
    const tensor = new ultrafaceOrtTensor(tensorData);
    const tInferOnly0 = performance.now();
    const output = await ultrafaceSession.run({ [ultrafaceSession.inputNames[0]]: tensor });
    const inferOnlyMs = performance.now() - tInferOnly0;
    const outputs = Object.values(output);
    const scores = outputs.find((t) => t.dims.at(-1) === 2);
    const boxes = outputs.find((t) => t.dims.at(-1) === 4);
    if (!scores || !boxes) throw new Error("Unexpected face model outputs");
    const detections = decodeFaces(scores.data, boxes.data, width, height);
    const totalMs = performance.now() - tTotal0;
    ultrafaceCtx.clearRect(0, 0, 320, 240);
    bitmap.close();
    for (const t of Object.values(output)) {
      try { t.dispose?.(); } catch { /* ignore */ }
    }
    return {
      detections,
      ms: totalMs, // includes resize (per spec)
      inferOnlyMs,
      backend: ultrafaceBackendUsed,
      inputWidth: width,
      inputHeight: height,
    };
  },
};

// ort.Tensor constructor differs slightly by build namespace shape; resolve
// lazily against whichever ort module is currently active for UltraFace.
function ultrafaceOrtTensor(data) {
  const key = ultrafaceBackendUsed === "webgpu" ? "webgpu" : "wasm";
  const ort = ortModules[key];
  return new ort.Tensor("float32", data, [1, 3, 240, 320]);
}

console.log("[harness] ready");
