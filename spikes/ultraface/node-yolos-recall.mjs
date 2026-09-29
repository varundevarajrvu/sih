// Fallback recall measurement for yolos-tiny, run in plain Node (not a
// browser). WHY THIS EXISTS: this sandboxed environment's headless
// Chromium has no WebGPU adapter at all (confirmed: navigator.gpu.
// requestAdapter() -> null), and @huggingface/transformers ^3.0.0's
// bundled jsep-enabled onnxruntime-web build hard-fails pipeline() load
// for BOTH device:"webgpu" AND device:"wasm" in that condition (same
// "Failed to get GPU adapter" / "WebGPU is not supported" error either
// way -- see run1-no-gpu-stub-yolos-hardfail.json and the run-bench.mjs
// console log for both reproductions). That is a real, reproducible
// transformers.js/onnxruntime-web limitation in a zero-WebGPU headless
// environment, not a modeling question -- so it is reported as a finding,
// not silently worked around by faking a browser number.
//
// What THIS script CAN still answer honestly: does yolos-tiny's "person"
// class detect the demo face / scale-ladder fixtures at all, and how many
// false-positive "person" detections does it produce on the no-face
// fixtures? Detection correctness (recall) does not depend on which CPU
// backend ran the model, only latency does -- so these numbers are valid
// recall evidence even though they come from onnxruntime-node (native
// CPU), not a browser. Latency numbers from THIS script are NOT reported
// as comparable to UltraFace's browser-measured latency; RESULT.md pulls
// yolos's latency instead from this project's own already-published,
// JSON-backed production measurements (CLAUDE.md "PHASE 0 CLOSED" /
// "THE PUBLISHED LATENCY FIGURE DOES NOT REPRODUCE").
import { pipeline, RawImage, env } from "@huggingface/transformers";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = path.join(__dirname, "models") + path.sep;
env.useBrowserCache = false;

const MODEL_ID = "Xenova/yolos-tiny";
const DTYPE = "fp32";
const THRESHOLD = 0.5;

function flatten(raw) {
  return raw.map((r) => ({ label: r.label, score: r.score, xmin: r.box.xmin, ymin: r.box.ymin, xmax: r.box.xmax, ymax: r.box.ymax }));
}

async function detect(detector, filePath) {
  const image = await RawImage.read(filePath);
  const t0 = performance.now();
  const raw = await detector(image, { threshold: THRESHOLD, percentage: false });
  const ms = performance.now() - t0;
  return { detections: flatten(raw), ms };
}

async function main() {
  const out = { note: "onnxruntime-node CPU fp32 -- recall evidence ONLY, NOT a browser latency comparison", results: {} };
  console.log("loading Xenova/yolos-tiny on Node (onnxruntime-node CPU)...");
  const t0 = performance.now();
  const detector = await pipeline("object-detection", MODEL_ID, { dtype: DTYPE });
  console.log(`loaded in ${(performance.now() - t0).toFixed(1)}ms`);

  const fixturesDir = path.join(__dirname, "fixtures");
  out.results.demoFace = await detect(detector, path.join(fixturesDir, "demo-face.jpg"));
  console.log("demoFace:", JSON.stringify(out.results.demoFace));

  out.results.scaleLadder = {};
  for (const h of [40, 60, 80, 96, 120, 200]) {
    const fp = path.join(fixturesDir, `face-${h}px.png`);
    out.results.scaleLadder[h] = await detect(detector, fp);
    console.log(`scale ${h}px:`, JSON.stringify(out.results.scaleLadder[h]));
  }

  out.results.falsePositives = {};
  for (const name of ["no-face-testpage.png", "no-face-wikipedia.png", "no-face-loginform.png"]) {
    const fp = path.join(fixturesDir, name);
    if (!fs.existsSync(fp)) {
      out.results.falsePositives[name] = { skipped: true };
      continue;
    }
    out.results.falsePositives[name] = await detect(detector, fp);
    console.log(`fp ${name}:`, JSON.stringify(out.results.falsePositives[name]));
  }

  fs.writeFileSync(path.join(__dirname, "node-yolos-recall-result.json"), JSON.stringify(out, null, 2));
  console.log("WROTE node-yolos-recall-result.json");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exitCode = 1;
});
