// One-off script: merges the browser benchmark JSON + the Node yolos
// recall fallback JSON into the final benchmarks/results/v0b-ultraface.json,
// with the pre-registered decision rule applied explicitly.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const browserResult = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "benchmarks", "results", "v0b-ultraface.json"), "utf8"));
const yolosRecall = JSON.parse(fs.readFileSync(path.join(__dirname, "node-yolos-recall-result.json"), "utf8"));

const yolosPublishedLatency = {
  source: "CLAUDE.md (this repo, v1) -- 'PHASE 0 CLOSED' and 'THE PUBLISHED LATENCY FIGURE DOES NOT REPRODUCE' entries",
  device: "webgpu",
  dtype: "fp32",
  warmMsBestCase_2026_09_11: [784, 817, 860, 881],
  warmMsMostRecentlyReproduced_2026_09_20: [2650, 2692, 2700],
  coldStartMs_afterServiceWorkerEviction: [18430, 19407],
  note:
    "v1's own docs flag the 780-880ms figure as unresolved/does-not-reproduce as of 2026-09-20; the most recent independent samples cluster ~2650-2700ms warm. Both cited unmodified as the pre-registered ARCHITECTURE.md V0b baseline ('current published yolos warm: ~2,350-2,700 ms').",
};

const uf = browserResult.ultraface.wasm;
const ufGpu = browserResult.ultraface.webgpu;

function scaleComparison(scaleLadderUF, scaleLadderYolos) {
  const out = {};
  for (const h of [40, 60, 80, 96, 120, 200]) {
    out[h] = {
      ultraface_wasm: {
        detected: scaleLadderUF[h].detections.length > 0,
        confidence: scaleLadderUF[h].detections[0]?.confidence ?? null,
        ms: scaleLadderUF[h].ms,
      },
      yolos_person_nodeCPU: {
        detected: scaleLadderYolos[h].detections.length > 0,
        score: scaleLadderYolos[h].detections[0]?.score ?? null,
        ms_NOT_comparable_see_note: scaleLadderYolos[h].ms,
      },
    };
  }
  return out;
}

const decisionRule =
  "ARCHITECTURE.md Phase V0b, pre-registered: replace yolos-tiny iff UltraFace detects the demo face AND every >=80px face, AND its warm p95 is lower than yolos. Keep yolos available only if it catches something UltraFace cannot that is PII-relevant.";

const ultrafaceDetectsDemoFace = uf.demoFace.detections.length > 0;
const ultrafaceDetectsAll80plus = [80, 96, 120, 200].every((h) => uf.scaleLadder[h].detections.length > 0);
const ultrafaceP95 = uf.latency.p95;
const yolosBestCaseMax = Math.max(...yolosPublishedLatency.warmMsBestCase_2026_09_11);
const ultrafaceP95LowerThanYolos = ultrafaceP95 < yolosBestCaseMax;
const decision =
  ultrafaceDetectsDemoFace && ultrafaceDetectsAll80plus && ultrafaceP95LowerThanYolos
    ? "REPLACE yolos-tiny with UltraFace RFB-320 for face redaction"
    : "KEEP yolos-tiny";

const final = {
  spike: "v0b-ultraface",
  question: "should UltraFace RFB-320 (ONNX, onnxruntime-web) replace Xenova/yolos-tiny (COCO person class) for face redaction?",
  date: browserResult.date,
  machine: browserResult.machine,
  gpuHardware: "Intel(R) UHD Graphics, driver 32.0.101.7085, 2147479552 bytes shared VRAM (Get-CimInstance Win32_VideoController)",
  chrome: {
    ...browserResult.chrome,
    note:
      "Playwright-bundled Chromium (not the system Chrome install), headless. navigator.gpu.requestAdapter() resolved to no adapter in this session -- every number below is on the WASM floor, per this project's own 'WebGPU is a speed optimization, never a dependency' invariant.",
  },
  gpu: browserResult.gpu,

  ultraface: {
    wasm: {
      backend: "wasm (matches Project B's shipped vision.mjs config exactly: executionProviders:['wasm'], single-thread, proxy:false)",
      coldLoadMs: uf.coldLoadMs,
      demoFace: uf.demoFace,
      scaleLadder: uf.scaleLadder,
      falsePositives: uf.falsePositives,
      latency_20warmRuns_1280x720_includesResizeTo320x240: uf.latency,
    },
    webgpuRequested: {
      note:
        "executionProviders:['webgpu','wasm'] requested; navigator.gpu absent in this session, so this almost certainly executed on the wasm EP internally after failed EP negotiation (session creation still succeeded, unlike transformers.js/yolos below). Slightly SLOWER than the explicit wasm session (higher cold load, higher p50/p95), consistent with wasted EP-negotiation overhead rather than real GPU execution. Reported for completeness; not used in the decision.",
      coldLoadMs: ufGpu.coldLoadMs,
      demoFace: ufGpu.demoFace,
      falsePositives: ufGpu.falsePositives,
      latency_20warmRuns: ufGpu.latency,
    },
  },

  yolos: {
    browserLoadFailure: {
      finding:
        "Xenova/yolos-tiny via @huggingface/transformers ^3.0.0 pipeline() could NOT be loaded in this headless spike environment on EITHER device:'webgpu' OR device:'wasm' -- both fail with the same underlying error. Reproduced 3 times across 2 separate browser sessions (with and without a navigator.gpu stub).",
      errorWithRealNavigatorGpu:
        "no available backend found. ERR: [webgpu] Error: Failed to get GPU adapter. You may need to enable flag \"--enable-unsafe-webgpu\" if you are using Chrome.",
      errorWithNavigatorGpuStubbedToUndefined: "no available backend found. ERR: [webgpu] Error: WebGPU is not supported in current environment",
      rootCauseAssessment:
        "transformers.js ^3.0.0 bundles ONLY the jsep-enabled onnxruntime-web wasm build (dist/ort-wasm-simd-threaded.jsep.mjs/.wasm -- verified, no plain non-jsep alternative ships in that package). That single binary appears to perform WebGPU capability/adapter negotiation at pipeline-load time regardless of the requested `device` option, and hard-fails when no adapter exists at all -- even for an explicit device:'wasm' request. This is an environment limitation (this sandbox's headless Chromium has zero WebGPU adapter), not evidence against yolos-tiny's architecture: this repo's own CLAUDE.md documents yolos-tiny running successfully on webgpu in a real (non-headless) Chrome session. Contrast: raw onnxruntime-web (not wrapped by transformers.js) DID gracefully tolerate the missing adapter for UltraFace's session (see ultraface.webgpuRequested above) -- so this is specifically a transformers.js/jsep-bundle limitation, not a Chromium or ONNX Runtime one.",
      evidenceFile: "spikes/ultraface/run1-no-gpu-stub-yolos-hardfail.json",
    },
    nodeCpuRecallFallback: {
      note:
        yolosRecall.note +
        " Run via onnxruntime-node (@huggingface/transformers' Node backend), CPU, fp32, the same local yolos-tiny weights extension/models/Xenova/yolos-tiny ships, same threshold=0.5/percentage=false as extension/src/offscreen.entry.js. Detection correctness (recall) does not depend on which CPU/GPU backend executed the model, only latency does -- so these are valid recall numbers despite not being a browser measurement. The `ms` fields here are onnxruntime-node timings on 1280x720 inputs and are NOT comparable to any browser WASM/WebGPU number -- not used for the latency leg of the decision rule.",
      demoFace: yolosRecall.results.demoFace,
      scaleLadder: yolosRecall.results.scaleLadder,
      falsePositives: yolosRecall.results.falsePositives,
    },
    publishedProductionLatency: yolosPublishedLatency,
  },

  scaleLadderComparison: scaleComparison(uf.scaleLadder, yolosRecall.results.scaleLadder),

  decision: {
    rule: decisionRule,
    ultrafaceDetectsDemoFace,
    ultrafaceDetectsAll80pxAndAbove: ultrafaceDetectsAll80plus,
    ultrafaceWarmP95Ms: ultrafaceP95,
    yolosWarmReferenceMs: {
      bestCaseSamples: yolosPublishedLatency.warmMsBestCase_2026_09_11,
      mostRecentlyReproducedSamples: yolosPublishedLatency.warmMsMostRecentlyReproduced_2026_09_20,
    },
    ultrafaceP95LowerThanYolosBestCase: ultrafaceP95LowerThanYolos,
    verdict: decision,
    yolosCatchesSomethingUltrafaceMisses: false,
    yolosCatchesSomethingUltrafaceMissesNote:
      "Not observed in this fixture set: every scale where yolos-person fired (96px, 200px), UltraFace also fired, and UltraFace additionally caught 80px and 120px where yolos missed. yolos was non-monotonic across scale (hit 96px, missed 120px) -- unreliable as a size signal. Design-level caveat, not measured here (all fixtures are forward-facing face crops): yolos's COCO 'person' class detects full-body/torso silhouettes and could in principle fire on a person whose face is occluded, turned away, or too small to resolve as a face, which a face-only detector like UltraFace structurally cannot. No fixture in this spike exercises that case.",
  },

  notes: browserResult.notes,
  consoleLog: browserResult.consoleLog,
  crashed: browserResult.crashed,
};

const outPath = path.join(REPO_ROOT, "benchmarks", "results", "v0b-ultraface.json");
fs.writeFileSync(outPath, JSON.stringify(final, null, 2));
console.log("wrote", outPath);
console.log("DECISION:", decision);
console.log("ultrafaceDetectsDemoFace:", ultrafaceDetectsDemoFace);
console.log("ultrafaceDetectsAll80plus:", ultrafaceDetectsAll80plus);
console.log("ultrafaceP95:", ultrafaceP95, "vs yolosBestCaseMax:", yolosBestCaseMax);
