// Node-first verification for candidate 2:
// OpenDILabCommunity/webpage_element_detection (web_detect_best_m.onnx).
//
// This is the most directly on-topic candidate found: a YOLOv8-medium
// model trained SPECIFICALLY on webpage screenshots (Roboflow dataset
// "roboflow-gw7yv/website-screenshots"), with 8 real semantic UI classes
// confirmed via the ONNX file's own embedded ultralytics metadata:
//   {0: 'button', 1: 'field', 2: 'heading', 3: 'iframe', 4: 'image',
//    5: 'label', 6: 'link', 7: 'text'}
// Unlike OmniParser's icon_detect (nc=1, no semantic type), this model
// could in principle answer "what KIND of element is this", not just
// "is there one". Size is the tradeoff: 103,477,118 bytes (~98.7MiB),
// verified byte-exact against the file actually downloaded -- more than
// 2x the extension's current ~48MB footprint. Flagged here, not hidden.
//
// YOLOv8 architecture (not in transformers.js's pipeline() whitelist) --
// raw onnxruntime-node with hand-written pre/post-processing, same as
// the OmniParser test.

import ort from "onnxruntime-node";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { letterboxResize, toCHWFloat, decodeYoloV8, unletterbox, nms, median } from "./lib/yolo-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(__dirname, "assets", "demo-page-screenshot.png");
const MODEL_PATH = path.join(
  __dirname,
  "models/OpenDILabCommunity/webpage_element_detection/web_detect_best_m.onnx"
);
// Confirmed via onnx.load(...).metadata_props on the actual downloaded file.
const LABELS = ["button", "field", "heading", "iframe", "image", "label", "link", "text"];
const SCORE_THRESHOLD = 0.25;
const INPUT_SIZE = 640; // fixed square, confirmed via metadata: imgsz=[640,640]

async function runOnce(session, chw) {
  const tensor = new ort.Tensor("float32", chw, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const t0 = performance.now();
  const outputs = await session.run({ images: tensor });
  const ms = performance.now() - t0;
  return { outputs, ms };
}

async function main() {
  console.log("=== Node-first verification: OpenDILabCommunity/webpage_element_detection ===");
  console.log(`Test image: ${TEST_IMAGE}`);
  console.log(`Model: web_detect_best_m.onnx (98.7MiB, YOLOv8-medium)`);
  console.log(`Classes: ${LABELS.join(", ")}`);
  console.log(`Backend: onnxruntime-node (native CPU) -- optimistic floor, not a WebGPU proxy.`);

  let session;
  try {
    const loadT0 = performance.now();
    session = await ort.InferenceSession.create(MODEL_PATH, { executionProviders: ["cpu"] });
    const loadMs = performance.now() - loadT0;
    console.log(`\nload: ${loadMs.toFixed(1)}ms`);
    console.log(`input names: ${session.inputNames}, output names: ${session.outputNames}`);
  } catch (err) {
    console.error(`FAILED to load session:`, err.message);
    process.exit(1);
  }

  const pre = await letterboxResize(TEST_IMAGE, INPUT_SIZE, INPUT_SIZE);
  console.log(
    `preprocess: orig ${pre.origWidth}x${pre.origHeight} -> letterboxed ${pre.width}x${pre.height} (scale=${pre.scale.toFixed(4)}, pad=${pre.padX},${pre.padY})`
  );
  const chw = toCHWFloat(pre.data, pre.width, pre.height);

  let times;
  let lastOutputs;
  try {
    const cold = await runOnce(session, chw);
    console.log(`cold inference: ${cold.ms.toFixed(1)}ms`);
    const warm = [];
    for (let i = 0; i < 3; i++) {
      const r = await runOnce(session, chw);
      warm.push(r.ms);
      lastOutputs = r.outputs;
      console.log(`warm run ${i + 1}: ${r.ms.toFixed(1)}ms`);
    }
    times = { cold: cold.ms, warm };
  } catch (err) {
    console.error(`FAILED during inference:`, err.message, err.stack);
    process.exit(1);
  }

  const medianWarm = median(times.warm);
  const outTensor = lastOutputs[session.outputNames[0]];
  console.log(`raw output dims: ${JSON.stringify(outTensor.dims)}`);

  const raw = decodeYoloV8(outTensor, LABELS.length, LABELS, SCORE_THRESHOLD);
  const unlb = unletterbox(raw, pre.scale, pre.padX, pre.padY);
  const detections = nms(unlb, 0.45);
  console.log(`detections (score>=${SCORE_THRESHOLD}, after NMS): ${detections.length}`);
  for (const d of detections) {
    console.log(
      `  ${d.label} score=${d.score.toFixed(3)} box=[${d.xmin.toFixed(0)},${d.ymin.toFixed(0)},${d.xmax.toFixed(0)},${d.ymax.toFixed(0)}]`
    );
  }

  // Per-class breakdown at a lower threshold too, for the class-coverage
  // section -- does it actually fire on button/field/link/text on a real
  // web form, or only on some classes?
  const rawLow = decodeYoloV8(outTensor, LABELS.length, LABELS, 0.05);
  const unlbLow = unletterbox(rawLow, pre.scale, pre.padX, pre.padY);
  const keptLow = nms(unlbLow, 0.45);
  const byClass = {};
  for (const d of keptLow) {
    byClass[d.label] = (byClass[d.label] || 0) + 1;
  }
  console.log(`\nAt threshold 0.05 (diagnostic, not a real operating point), ${keptLow.length} detections, by class:`);
  console.log(JSON.stringify(byClass, null, 2));

  console.log(`\nmedian warm: ${medianWarm.toFixed(1)}ms | gate (<1000ms): ${medianWarm < 1000 ? "PASS" : "FAIL"}`);

  await session.release();

  console.log("\n=== FINAL SUMMARY TABLE (OpenDILab webpage_element_detection, onnxruntime-node CPU) ===");
  console.log("| Config | Status | Cold (ms) | Warm runs (ms) | Median warm (ms) | Gate (<1000ms) | Detections @0.25 |");
  console.log("|---|---|---|---|---|---|---|");
  console.log(
    `| web_detect_best_m fp32 | OK | ${times.cold.toFixed(1)} | ${times.warm.map((w) => w.toFixed(1)).join(", ")} | ${medianWarm.toFixed(1)} | ${medianWarm < 1000 ? "PASS" : "FAIL"} | ${detections.length} |`
  );
}

main().catch((err) => {
  console.error("[node-test-webpage-detect] FAILED:", err);
  process.exit(1);
});
