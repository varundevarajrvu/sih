// Node-first verification (per task brief: "Test in Node FIRST with
// onnxruntime-node. If it cannot even load and run a forward pass there,
// it will not work in a browser and you have saved everyone the harness
// work.") for candidate 1: onnx-community/OmniParser-icon_detect.
//
// This is a THIRD-PARTY ONNX conversion (org "onnx-community", HF's own
// auto-conversion bot) of Microsoft's real OmniParser icon_detect weights
// (verified against microsoft/OmniParser-v2.0's icon_detect/model.yaml:
// nc: 1 -- confirmed single-class, "is this an interactable UI element",
// no button/input/link semantic distinction). YOLOv8 architecture (CNN,
// not a transformer head) -- not in transformers.js's pipeline() whitelist,
// so this runs raw onnxruntime-node with hand-written pre/post-processing.

import ort from "onnxruntime-node";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { divisorResize, toCHWFloat, decodeYoloV8, unletterbox, nms, median } from "./lib/yolo-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(__dirname, "assets", "demo-page-screenshot.png");
const LABELS = ["icon"]; // nc=1, confirmed via model.yaml
const SCORE_THRESHOLD = 0.3;
const LONGEST_EDGE = 640;
// preprocessor_config.json declares size_divisor:16, but that is NOT
// sufficient in practice: this is a 3-level YOLOv8 FPN (strides 8/16/32),
// and unless BOTH resized dimensions are exact multiples of 32, the
// repeated floor(x/2) downsamples + nearest-2x upsamples at the P5->P4
// skip connection round-trip to a size 1px off from the skip tensor,
// which throws a hard Concat/Resize shape-mismatch error inside ONNX
// Runtime (confirmed empirically below -- divisor:16 gave 560x640, whose
// 560/32=17.5, and the model crashed; divisor:32 fixes it). Flagging this
// because the published config is misleading on its own.
const SIZE_DIVISOR = 32;

const CONFIGS = [
  { name: "fp32", file: "models/onnx-community/OmniParser-icon_detect/onnx/model.onnx" },
  { name: "quantized (uint8)", file: "models/onnx-community/OmniParser-icon_detect/onnx/model_quantized.onnx" },
];

async function runOnce(session, chw, width, height) {
  const tensor = new ort.Tensor("float32", chw, [1, 3, height, width]);
  const t0 = performance.now();
  const outputs = await session.run({ images: tensor });
  const ms = performance.now() - t0;
  return { outputs, ms };
}

async function benchmarkConfig(cfg) {
  console.log(`\n--- [OmniParser icon_detect / ${cfg.name}] starting ---`);
  const modelPath = path.join(__dirname, cfg.file);

  let session;
  try {
    const loadT0 = performance.now();
    session = await ort.InferenceSession.create(modelPath, { executionProviders: ["cpu"] });
    const loadMs = performance.now() - loadT0;
    console.log(`  load: ${loadMs.toFixed(1)}ms`);
    console.log(`  input names: ${session.inputNames}, output names: ${session.outputNames}`);
  } catch (err) {
    console.error(`  FAILED to load session:`, err.message);
    return { name: cfg.name, status: "failed", stage: "load", error: err.message };
  }

  let pre;
  try {
    pre = await divisorResize(TEST_IMAGE, LONGEST_EDGE, SIZE_DIVISOR);
    console.log(
      `  preprocess: orig ${pre.origWidth}x${pre.origHeight} -> resized ${pre.width}x${pre.height} (scale=${pre.scale.toFixed(4)})`
    );
  } catch (err) {
    console.error(`  FAILED to preprocess image:`, err.message);
    return { name: cfg.name, status: "failed", stage: "preprocess", error: err.message };
  }

  const chw = toCHWFloat(pre.data, pre.width, pre.height);

  let times;
  let lastOutputs;
  try {
    const cold = await runOnce(session, chw, pre.width, pre.height);
    console.log(`  cold inference: ${cold.ms.toFixed(1)}ms`);
    const warm = [];
    for (let i = 0; i < 3; i++) {
      const r = await runOnce(session, chw, pre.width, pre.height);
      warm.push(r.ms);
      lastOutputs = r.outputs;
      console.log(`  warm run ${i + 1}: ${r.ms.toFixed(1)}ms`);
    }
    times = { cold: cold.ms, warm };
  } catch (err) {
    console.error(`  FAILED during inference:`, err.message, err.stack);
    return { name: cfg.name, status: "failed", stage: "inference", error: err.message };
  }

  const medianWarm = median(times.warm);

  let detections = [];
  try {
    const outTensor = lastOutputs[session.outputNames[0]];
    console.log(`  raw output dims: ${JSON.stringify(outTensor.dims)}`);
    const raw = decodeYoloV8(outTensor, LABELS.length, LABELS, SCORE_THRESHOLD);
    const unlb = unletterbox(raw, pre.scale, pre.padX, pre.padY);
    detections = nms(unlb, 0.45);
    console.log(`  detections (score>=${SCORE_THRESHOLD}, after NMS): ${detections.length}`);
    for (const d of detections.slice(0, 15)) {
      console.log(
        `    ${d.label} score=${d.score.toFixed(3)} box=[${d.xmin.toFixed(0)},${d.ymin.toFixed(0)},${d.xmax.toFixed(0)},${d.ymax.toFixed(0)}]`
      );
    }
    if (detections.length > 15) console.log(`    ... and ${detections.length - 15} more`);
  } catch (err) {
    console.error(`  FAILED during postprocess:`, err.message, err.stack);
    return { name: cfg.name, status: "failed", stage: "postprocess", error: err.message };
  }

  console.log(`  median warm: ${medianWarm.toFixed(1)}ms | gate (<1000ms): ${medianWarm < 1000 ? "PASS" : "FAIL"}`);

  await session.release();

  return {
    name: cfg.name,
    status: "ok",
    cold: times.cold,
    warm: times.warm,
    medianWarm,
    gate: medianWarm < 1000 ? "PASS" : "FAIL",
    detections: detections.length,
  };
}

async function main() {
  console.log("=== Node-first verification: onnx-community/OmniParser-icon_detect ===");
  console.log(`Test image: ${TEST_IMAGE}`);
  console.log(`Backend: onnxruntime-node (native CPU) -- per Phase 0's own framing, this is an`);
  console.log(`OPTIMISTIC floor for browser WASM, and NOT a proxy for browser WebGPU at all`);
  console.log(`(native CPU has no graph-splitting/GPU-CPU roundtrip behavior WebGPU has).`);
  console.log(`Class list: nc=1 ["icon"] -- confirmed via microsoft/OmniParser-v2.0's`);
  console.log(`icon_detect/model.yaml. This model detects "is this a UI element", not WHAT KIND.`);

  const results = [];
  for (const cfg of CONFIGS) {
    results.push(await benchmarkConfig(cfg));
  }

  console.log("\n=== FINAL SUMMARY TABLE (OmniParser icon_detect, onnxruntime-node CPU) ===");
  console.log("| Config | Status | Cold (ms) | Warm runs (ms) | Median warm (ms) | Gate (<1000ms) | Detections |");
  console.log("|---|---|---|---|---|---|---|");
  for (const r of results) {
    if (r.status === "ok") {
      console.log(
        `| ${r.name} | OK | ${r.cold.toFixed(1)} | ${r.warm.map((w) => w.toFixed(1)).join(", ")} | ${r.medianWarm.toFixed(1)} | ${r.gate} | ${r.detections} |`
      );
    } else {
      console.log(`| ${r.name} | FAILED (${r.stage}) | - | - | - | - | error: ${r.error} |`);
    }
  }
  console.log("\nRAW JSON:", JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error("[node-test-omniparser] FAILED:", err);
  process.exit(1);
});
