// Phase 0 spike — Node harness.
//
// Question: does Xenova/yolos-tiny run via @huggingface/transformers and
// return bounding boxes, and how fast?
//
// Node uses the WASM/CPU (onnxruntime-node) backend — there is no WebGPU
// in Node. This establishes the WASM latency FLOOR that CLAUDE.md Section
// 4's ~1s gate is measured against. It says nothing about whether WebGPU
// works inside a Chrome offscreen document — that is a separate,
// unverified question answered only by the Chrome harness in this same
// directory (manifest.json / offscreen.html / offscreen.js), which
// requires a human to load unpacked in Chrome and read the console.
//
// Usage:
//   npm install
//   npm run test-node
//
// This script runs detection on assets/test-image.jpg TWICE in the same
// process: once "cold" (includes model download/cache-read + graph
// compile) and once "warm" (model already resident, same image). Both
// numbers are reported separately per the assignment brief.

import { pipeline, RawImage } from "@huggingface/transformers";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMAGE_PATH = path.join(__dirname, "assets", "test-image.jpg");
const MODEL_ID = "Xenova/yolos-tiny";

function fmtMs(ms) {
  return `${ms.toFixed(1)}ms`;
}

async function main() {
  console.log(`[spike] model: ${MODEL_ID}`);
  console.log(`[spike] image: ${IMAGE_PATH}`);
  console.log(`[spike] backend: Node (onnxruntime-node, WASM/CPU — no WebGPU in Node)`);
  console.log("");

  // ---- Model load (download on first run, disk cache thereafter) ----
  console.log("[spike] loading pipeline (this includes model download on first run)...");
  const loadStart = performance.now();
  const detector = await pipeline("object-detection", MODEL_ID);
  const loadMs = performance.now() - loadStart;
  console.log(`[spike] pipeline loaded in ${fmtMs(loadMs)}`);
  console.log("");

  // ---- Load the image once, reuse the decoded tensor input for both runs ----
  const image = await RawImage.read(IMAGE_PATH);

  // ---- COLD inference run (first call — includes any lazy init/compile) ----
  console.log("[spike] running COLD inference (first call)...");
  const coldStart = performance.now();
  const coldResult = await detector(image, { threshold: 0.5, percentage: false });
  const coldMs = performance.now() - coldStart;
  console.log(`[spike] COLD inference: ${fmtMs(coldMs)}`);
  console.log(`[spike] COLD raw output (first 2 entries):`, JSON.stringify(coldResult.slice(0, 2), null, 2));
  console.log("");

  // ---- WARM inference run (second call, same process, same model) ----
  console.log("[spike] running WARM inference (second call, same process)...");
  const warmStart = performance.now();
  const warmResult = await detector(image, { threshold: 0.5, percentage: false });
  const warmMs = performance.now() - warmStart;
  console.log(`[spike] WARM inference: ${fmtMs(warmMs)}`);
  console.log("");

  // ---- A few more warm runs to see variance ----
  const extraRuns = 3;
  const extraTimes = [];
  for (let i = 0; i < extraRuns; i++) {
    const t0 = performance.now();
    await detector(image, { threshold: 0.5, percentage: false });
    extraTimes.push(performance.now() - t0);
  }
  console.log(`[spike] ${extraRuns} additional warm runs: ${extraTimes.map(fmtMs).join(", ")}`);
  console.log("");

  // ---- Report the raw contract shape exactly as the library returns it ----
  console.log("=== RAW LIBRARY OUTPUT SHAPE (percentage:false -> absolute px) ===");
  console.log(JSON.stringify(warmResult, null, 2));
  console.log("");

  console.log("=== SUMMARY ===");
  console.log(`Model load time (cold, includes download):        ${fmtMs(loadMs)}`);
  console.log(`First inference (cold, post-load):                ${fmtMs(coldMs)}`);
  console.log(`Second inference (warm, same process):            ${fmtMs(warmMs)}`);
  console.log(`Warm run variance (${extraRuns} runs):                        ${extraTimes.map(fmtMs).join(", ")}`);
  console.log(`Detections found (warm run):                      ${warmResult.length}`);
  console.log(`~1s gate (CLAUDE.md Section 4, Phase 0) on warm inference: ${warmMs < 1000 ? "PASS" : "FAIL"} (${fmtMs(warmMs)})`);
}

main().catch((err) => {
  console.error("[spike] FAILED:", err);
  process.exit(1);
});
