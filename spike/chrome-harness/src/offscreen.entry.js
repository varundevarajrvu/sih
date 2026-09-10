// Phase 0 spike -- Chrome MV3 offscreen document harness.
//
// UNVERIFIED BY THIS AGENT. This code has never been run inside Chrome --
// the authoring agent has no browser automation. Varun must load this
// unpacked and read the console output himself. See ../README.md for
// exact steps.
//
// Question this answers: does Xenova/yolos-tiny run via
// @huggingface/transformers inside an MV3 offscreen document, on WebGPU
// with automatic WASM fallback, and how fast?
//
// This file is bundled by esbuild into offscreen.bundle.js (see
// ../package.json "build" script) because @huggingface/transformers'
// browser build (dist/transformers.web.js) imports the bare specifiers
// "onnxruntime-common" / "onnxruntime-web", which only resolve through a
// bundler -- a raw <script type="module"> can't resolve bare specifiers,
// and MV3's script-src CSP ('self' + 'wasm-unsafe-eval' only) forbids
// loading either the library or onnxruntime-web from a remote CDN as
// <script src>. So the JS itself must be fully local/bundled.
//
// The ONNX/ORT *.wasm binaries are a separate matter: @huggingface/transformers
// defaults env.backends.onnx.wasm.wasmPaths to
// `https://cdn.jsdelivr.net/npm/@huggingface/transformers@<version>/dist/`
// (see node_modules/@huggingface/transformers/src/backends/onnx.js) and
// fetches them over the network at runtime. That's a `fetch()` data
// request (connect-src), not a <script> load (script-src), so it is not
// blocked by MV3's default extension_pages CSP -- but it DOES mean this
// harness needs network access to huggingface.co / cdn.jsdelivr.net the
// first time it runs. Unverified whether that fetch actually succeeds
// from inside an offscreen document specifically -- report what the
// console shows.

import { pipeline, RawImage } from "@huggingface/transformers";

const MODEL_ID = "Xenova/yolos-tiny";
const IMAGE_URL = chrome.runtime.getURL("assets/test-image.jpg");

function log(...args) {
  console.log("[spike]", ...args);
}

async function imageUrlToBase64(url) {
  const res = await fetch(url);
  const blob = await res.blob();
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// THE INTERFACE CONTRACT (CLAUDE.md Section 4, Phase 0):
//   runDetection(imageBase64) -> [{label, score, xmin, ymin, xmax, ymax}]
//
// The library's raw per-detection shape is actually
//   { score, label, box: { xmin, ymin, xmax, ymax } }
// (box NESTED, not flat -- confirmed empirically and against library
// source in the Node half of this spike, see ../node-test-contract.js).
// This wrapper does the flattening so callers get exactly the contract
// shape, matching what Phase 1 should also do.
async function runDetection(imageBase64, detector) {
  const b64 = imageBase64.startsWith("data:")
    ? imageBase64.slice(imageBase64.indexOf(",") + 1)
    : imageBase64;
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: "image/jpeg" });
  const image = await RawImage.fromBlob(blob);

  // percentage:false -> absolute pixel coords (also the library default;
  // explicit here for clarity). threshold chosen to match the Node spike
  // for a fair before/after comparison.
  const raw = await detector(image, { threshold: 0.5, percentage: false });

  return raw.map((r) => ({
    label: r.label,
    score: r.score,
    xmin: r.box.xmin,
    ymin: r.box.ymin,
    xmax: r.box.xmax,
    ymax: r.box.ymax,
  }));
}

// Tries WebGPU first; on ANY failure (navigator.gpu missing, pipeline()
// rejecting, adapter request failing, etc.) falls back to WASM. This is
// the "automatic WASM fallback" the brief and CLAUDE.md Section 5's
// invariant both require -- WebGPU must never be a hard dependency.
async function loadDetector() {
  const hasNavigatorGpu = typeof navigator !== "undefined" && !!navigator.gpu;
  log("navigator.gpu present in this offscreen document:", hasNavigatorGpu);

  if (hasNavigatorGpu) {
    try {
      const t0 = performance.now();
      const detector = await pipeline("object-detection", MODEL_ID, { device: "webgpu" });
      const ms = performance.now() - t0;
      log(`WebGPU pipeline load succeeded in ${ms.toFixed(1)}ms`);
      return { detector, backend: "webgpu" };
    } catch (err) {
      log("WebGPU pipeline load FAILED, falling back to WASM. Error:", err);
    }
  } else {
    log("navigator.gpu is undefined in this offscreen document -- skipping WebGPU, using WASM.");
  }

  const t0 = performance.now();
  const detector = await pipeline("object-detection", MODEL_ID, { device: "wasm" });
  const ms = performance.now() - t0;
  log(`WASM pipeline load succeeded in ${ms.toFixed(1)}ms`);
  return { detector, backend: "wasm" };
}

async function main() {
  log("offscreen document starting...");
  log("model:", MODEL_ID);

  const { detector, backend } = await loadDetector();

  const base64 = await imageUrlToBase64(IMAGE_URL);
  log("test image loaded as base64, length:", base64.length);

  // COLD run (first call on this detector instance)
  const t0 = performance.now();
  const boxesCold = await runDetection(base64, detector);
  const coldMs = performance.now() - t0;

  // WARM run (second call, same detector, same process)
  const t1 = performance.now();
  const boxesWarm = await runDetection(base64, detector);
  const warmMs = performance.now() - t1;

  log("=== RESULT ===");
  log("BACKEND ACTUALLY USED:", backend);
  log("COLD inference time (ms):", coldMs.toFixed(1));
  log("WARM inference time (ms):", warmMs.toFixed(1));
  log("~1s gate on WARM inference (CLAUDE.md Section 4, Phase 0):", warmMs < 1000 ? "PASS" : "FAIL");
  log("DETECTIONS (contract shape [{label,score,xmin,ymin,xmax,ymax}]):");
  log(JSON.stringify(boxesWarm, null, 2));
}

main().catch((err) => {
  console.error("[spike] FAILED:", err);
});
