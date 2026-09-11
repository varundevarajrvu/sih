// One-off diagnostic: draw detected boxes on the test image so the README
// claims about detection quality can be visually spot-checked, not just
// asserted from raw coordinate numbers.
import ort from "onnxruntime-node";
import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { letterboxResize, divisorResize, toCHWFloat, decodeYoloV8, unletterbox, nms } from "./lib/yolo-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMAGE = path.join(__dirname, "assets", "demo-page-screenshot.png");

const COLORS = {
  button: "red",
  field: "lime",
  heading: "orange",
  iframe: "cyan",
  image: "magenta",
  label: "yellow",
  link: "blue",
  text: "grey",
  icon: "red",
};

async function drawFor(modelPath, labels, threshold, preprocessFn, outName) {
  const session = await ort.InferenceSession.create(modelPath, { executionProviders: ["cpu"] });
  const pre = await preprocessFn(IMAGE);
  const chw = toCHWFloat(pre.data, pre.width, pre.height);
  const tensor = new ort.Tensor("float32", chw, [1, 3, pre.height, pre.width]);
  const outputs = await session.run({ images: tensor });
  const outTensor = outputs[session.outputNames[0]];
  const raw = decodeYoloV8(outTensor, labels.length, labels, threshold);
  const unlb = unletterbox(raw, pre.scale, pre.padX, pre.padY);
  const kept = nms(unlb, 0.45);
  await session.release();

  const meta = await sharp(IMAGE).metadata();
  const rects = kept
    .map(
      (d) =>
        `<rect x="${d.xmin}" y="${d.ymin}" width="${d.xmax - d.xmin}" height="${d.ymax - d.ymin}" fill="none" stroke="${COLORS[d.label] || "red"}" stroke-width="3"/>` +
        `<text x="${d.xmin}" y="${Math.max(12, d.ymin - 4)}" fill="${COLORS[d.label] || "red"}" font-size="16" font-family="monospace">${d.label} ${d.score.toFixed(2)}</text>`
    )
    .join("\n");
  const svg = `<svg width="${meta.width}" height="${meta.height}" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;

  await sharp(IMAGE)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .toFile(path.join(__dirname, "assets", outName));

  console.log(`${outName}: ${kept.length} boxes drawn`);
  return kept;
}

async function main() {
  await drawFor(
    "models/OpenDILabCommunity/webpage_element_detection/web_detect_best_m.onnx",
    ["button", "field", "heading", "iframe", "image", "label", "link", "text"],
    0.25,
    (img) => letterboxResize(img, 640, 640),
    "annotated-webpage-detect.png"
  );

  await drawFor(
    "models/onnx-community/OmniParser-icon_detect/onnx/model.onnx",
    ["icon"],
    0.1,
    (img) => divisorResize(img, 640, 32),
    "annotated-omniparser.png"
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
