// Phase 0 spike — contract verification.
//
// CLAUDE.md Section 4, Phase 0 states the interface Phase 1 builds against:
//   runDetection(imageBase64) -> [{label, score, xmin, ymin, xmax, ymax}]
//
// This script implements that EXACT function signature (base64 string in,
// not a file path) and checks whether the library's real output matches
// the flat shape the contract promises, or needs adapting.

import { pipeline, RawImage } from "@huggingface/transformers";
import { performance } from "node:perf_hooks";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMAGE_PATH = path.join(__dirname, "assets", "test-image.jpg");

let detectorPromise;
function getDetector() {
  if (!detectorPromise) {
    detectorPromise = pipeline("object-detection", "Xenova/yolos-tiny");
  }
  return detectorPromise;
}

// The exact contract signature: base64 in, flat array out.
async function runDetection(imageBase64) {
  const detector = await getDetector();

  // NODE-SPECIFIC QUIRK (discovered while building this spike): RawImage.fromURL()
  // does NOT accept "data:" URIs in Node. Because @huggingface/transformers'
  // getFile() checks `env.useFS` first (true in Node) and only recognizes
  // http:/https:/blob: as URL protocols, a "data:..." string falls through to
  // the filesystem path branch (FileResponse), which then fails to find a file
  // literally named "data:image/jpeg;base64,...". This is Node-only: in a real
  // browser (the offscreen document), env.useFS is false and the Fetch API
  // natively supports data: URIs, so `fetch(dataUrl)` works fine there. The
  // portable fix that works in BOTH environments is to decode to a Blob and
  // call RawImage.fromBlob directly -- that's what we do here.
  const b64 = imageBase64.startsWith("data:")
    ? imageBase64.slice(imageBase64.indexOf(",") + 1)
    : imageBase64;
  const buffer = Buffer.from(b64, "base64");
  const blob = new Blob([buffer], { type: "image/jpeg" });
  const image = await RawImage.fromBlob(blob);

  const raw = await detector(image, { threshold: 0.5, percentage: false });

  // ---- THIS is the adapter Phase 1 will need, because the library does
  // NOT return the flat shape the contract states. See findings below. ----
  return raw.map((r) => ({
    label: r.label,
    score: r.score,
    xmin: r.box.xmin,
    ymin: r.box.ymin,
    xmax: r.box.xmax,
    ymax: r.box.ymax,
  }));
}

async function main() {
  const base64 = fs.readFileSync(IMAGE_PATH).toString("base64");
  console.log(`[contract] input: base64 string, length=${base64.length}`);

  const t0 = performance.now();
  const result = await runDetection(base64);
  const ms = performance.now() - t0;

  console.log(`[contract] runDetection(imageBase64) completed in ${ms.toFixed(1)}ms (includes model load on first call in this process)`);
  console.log("[contract] adapted output (matches stated contract shape):");
  console.log(JSON.stringify(result, null, 2));

  console.log("");
  console.log("=== CONTRACT CHECK ===");
  console.log("Stated contract:  [{label, score, xmin, ymin, xmax, ymax}]  (flat)");
  console.log("Library's ACTUAL raw shape: [{label, score, box: {xmin, ymin, xmax, ymax}}]  (box is NESTED, not flat)");
  console.log("-> Phase 1 MUST flatten `box.{xmin,ymin,xmax,ymax}` into top-level fields itself; the library does not do this.");
  console.log("Coordinates: verified against library source (node_modules/@huggingface/transformers/src/pipelines.js, ObjectDetectionPipeline._call): `percentage` defaults to FALSE.");
  console.log("  -> DEFAULT behavior (percentage option omitted) is ABSOLUTE PIXELS in the input image's original dimensions -- matches the contract's implicit assumption. Passing { percentage: true } would instead give 0-1 normalized floats. We pass percentage:false explicitly here for clarity, but it is also the library default.");
  console.log("Also note: `threshold` defaults to 0.9 in the library (we pass 0.5 in this spike to see more candidate boxes) -- Phase 1 should pick its own threshold deliberately, not rely on either default silently.");
  console.log("Score: 0-1 float (e.g. 0.99), not 0-100. Matches contract's implicit assumption.");
}

main().catch((err) => {
  console.error("[contract] FAILED:", err);
  process.exit(1);
});
