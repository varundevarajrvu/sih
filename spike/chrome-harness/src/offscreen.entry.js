// Phase 0 spike -- Chrome MV3 offscreen document harness.
// RETRY 3 -- yolos-tiny (DETR-family ViT) is SUPERSEDED per Chief's re-scope
// (CLAUDE.md Phase 0 RESULT, 2026-09-10). This benchmarks CNN-backbone
// real-time detectors as replacement candidates.
//
// UNVERIFIED BY THIS AGENT. This code has never been run inside Chrome --
// the authoring agent has no browser automation. Varun must load this
// unpacked and read the console output himself. See ../README.md for
// exact steps.
//
// RETRY HISTORY (full detail in ../README.md and CLAUDE.md Phase 0 RESULT):
//   Retry 0: CDN-based ORT loading blocked by MV3 script-src. Fixed by
//            bundling ORT locally.
//   Retry 1: confirmed navigator.gpu EXISTS in an MV3 offscreen document
//            (the core architectural risk) and the local-ORT/local-weights
//            architecture works with zero network calls. But only tested
//            yolos-tiny+webgpu+fp32 (8.7s single sample) -- wasm fallback
//            never ran because webgpu succeeded.
//   Retry 2: full {webgpu,wasm}x{fp32,q8} matrix for yolos-tiny, median of
//            3 warm runs per cell. FINAL: webgpu+fp32 8,432ms (best case),
//            all four cells FAIL the ~1s gate by 8x-33x. q8 dominated by
//            fp32 on both speed and accuracy (7 detections vs 5 -- false
//            positives) -- retired. wasm confirmed catastrophically slower
//            than webgpu (4x), settled, not being re-tested per retry 3
//            instructions. Root cause: yolos-tiny is DETR-family (ViT
//            backbone) -- shape ops don't map to WebGPU, ORT logged "Some
//            nodes were not assigned to the preferred execution providers",
//            the graph splits, and every GPU<->CPU boundary crossing
//            round-trips tensors on a model too small to amortize the cost.
//   Retry 3 (this file): Chief authorized swapping the detector architecture
//            entirely -- CNN-backbone real-time detectors are expected to
//            map cleanly to WebGPU without the graph-splitting problem.
//            Benchmarks two verified candidates, both found via the live HF
//            API (not guessed) and both members of
//            MODEL_FOR_OBJECT_DETECTION_MAPPING_NAMES in
//            node_modules/@huggingface/transformers/src/models.js, meaning
//            BOTH are @huggingface/transformers pipeline()-compatible --
//            no raw onnxruntime-web inference, no manual letterbox
//            preprocessing, no manual NMS postprocessing needed. The pipeline
//            resolves each model's `image_processor_type: "RTDetrImageProcessor"`
//            (declared in its preprocessor_config.json) automatically via
//            AutoImageProcessor (models/auto/image_processing_auto.js) --
//            confirmed by reading that resolution code, not assumed.
//
//   Candidate 1: onnx-community/rtdetr_r18vd (model_type "rt_detr") --
//     RT-DETR, explicitly designed as a real-time alternative to YOLO:
//     ResNet-18 CNN backbone + a comparatively light transformer
//     encoder-decoder (NOT a pure ViT backbone like yolos-tiny). 80 COCO
//     classes (verified via live config.json). fp32 onnx/model.onnx =
//     82,572,357 bytes (downloaded and byte-count-verified against the
//     server's Content-Length).
//   Candidate 2: onnx-community/dfine_n_coco-ONNX (model_type "d_fine") --
//     D-FINE "nano", architecturally descended from RT-DETR's line (reuses
//     the identical RTDetrImageProcessor), also CNN-backbone-based. 80 COCO
//     classes. fp32 onnx/model.onnx = 15,258,358 bytes (smallest of any
//     candidate seen in this whole spike, including yolos-tiny) --
//     downloaded and byte-count-verified.
//   Candidate considered, VERIFIED, but NOT bundled: onnx-community/rfdetr_nano-ONNX
//     (model_type "rf_detr", real repo, real file, confirmed via live API
//     -- not guessed). Excluded for two independently sufficient reasons:
//     (1) its fp32 onnx/model.onnx is 108,074,865 bytes -- exceeds GitHub's
//     100MiB (104,857,600 byte) hard per-file push limit, so committing it
//     as a plain tracked file would break `git push` outright without
//     setting up Git LFS (an infrastructure decision outside this spike's
//     scope). (2) RF-DETR's own model card (Roboflow/rf-detr-segmentation,
//     README fetched from HF) states its backbone is explicitly "a
//     DINOv2-with-registers style ViT" -- the SAME architecture family
//     (Vision Transformer) already identified as yolos-tiny's root cause.
//     Both reasons are independently verified, not speculated.
//
// IMPORTANT CAVEAT ON CNN BACKBONE != AUTOMATIC WIN: RT-DETR and D-FINE
// still retain a transformer encoder/decoder on top of their CNN backbones
// -- the exact structural pattern (shape ops potentially falling back to
// CPU, graph splitting) that made yolos-tiny slow is NOT proven absent here
// just because the backbone changed. This harness explicitly watches for
// the same ORT "not assigned to preferred execution provider" warning seen
// with yolos-tiny (by temporarily intercepting console.warn/console.error
// during each candidate's pipeline load) and reports whether it recurs --
// do not assume "CNN backbone" alone fixes the problem; let the measurement
// say so.
//
// Local-only, zero network calls (unchanged since retry 1):
//   env.backends.onnx.wasm.wasmPaths -> chrome-harness/ort/ (shared by both
//     candidates -- same ORT jsep build handles any model's WebGPU/WASM ops).
//   env.localModelPath -> chrome-harness/models/, env.allowRemoteModels =
//     false so any accidental remote fetch attempt fails loudly with the
//     exact missing path named, instead of silently phoning out.
//
// SCOPE: webgpu + fp32 ONLY, per retry-3 instructions -- wasm and q8 are
// "settled and dead" (retry 2 already proved wasm is ~4x slower than
// webgpu and q8 is dominated by fp32; re-testing either for new candidates
// was explicitly not requested). 1 cold + 3 warm runs per candidate,
// median reported (a single warm sample is not a measurement).

import { pipeline, RawImage, env } from "@huggingface/transformers";

const IMAGE_URL = chrome.runtime.getURL("assets/test-image.jpg");
const WARM_RUNS = 3;
const GATE_MS = 1000; // CLAUDE.md Section 4 Phase 0 "~1s gate"

// yolos-tiny's already-recorded result (CLAUDE.md Phase 0 RESULT, retry 2,
// median of 3 warm runs, measured in Varun's browser) -- NOT re-run here,
// included only as a fixed reference row in the final summary table so the
// new candidates are visually comparable to the number they're replacing.
const YOLOS_TINY_BASELINE = {
  label: "yolos-tiny (BASELINE, not re-run)",
  medianWarmMs: 8432,
  gatePass: 8432 < GATE_MS,
  note: "webgpu+fp32, retry 2, CLAUDE.md Phase 0 RESULT -- ViT backbone, graph-split confirmed",
};

// Candidates verified against the live HF API before this file was written
// -- see the header comment block for the exact verification (repo exists,
// file exists, byte size matches Content-Length, model_type is in the
// pipeline's supported mapping, image_processor_type resolves to a real
// class). Both use device:"webgpu", dtype:"fp32" -- the only scope this
// retry asks for.
const CANDIDATES = [
  {
    modelId: "onnx-community/rtdetr_r18vd",
    label: "rtdetr_r18vd",
    architecture: "rt_detr -- ResNet-18 CNN backbone + transformer encoder/decoder",
    onnxBytes: 82572357,
  },
  {
    modelId: "onnx-community/dfine_n_coco-ONNX",
    label: "dfine_n_coco",
    architecture: "d_fine (nano) -- CNN backbone (RT-DETR lineage) + transformer decoder",
    onnxBytes: 15258358,
  },
];

// Proxy classes this project actually cares about (redacts faces, ID cards,
// screens showing sensitive data) -- these are the COCO-ish stand-ins
// CLAUDE.md's rubric context uses: person, tv/tvmonitor, laptop, cell
// phone, book. Checked against each candidate's REAL id2label at runtime
// (not just the config.json this agent already inspected out-of-band) so
// the harness is self-verifying, not trusting an earlier curl check.
const PROXY_CLASSES = ["person", "tv", "tvmonitor", "laptop", "cell phone", "book", "cat", "couch", "sofa"];

function log(...args) {
  console.log("[spike]", ...args);
}

// ---- Local-only configuration. Must happen before any pipeline() call. ----
const ORT_BASE_URL = chrome.runtime.getURL("ort/"); // trailing slash matters
const MODELS_BASE_URL = chrome.runtime.getURL("models/"); // trailing slash matters

env.backends.onnx.wasm.wasmPaths = ORT_BASE_URL;
env.allowLocalModels = true; // browser default is false -- must opt in
env.allowRemoteModels = false; // hard-fail loudly if anything is still missing locally
env.localModelPath = MODELS_BASE_URL;
env.useBrowserCache = false; // don't let a stale Cache Storage hit mask a missing-local-file bug

log("config: env.backends.onnx.wasm.wasmPaths =", env.backends.onnx.wasm.wasmPaths);
log("config: env.localModelPath =", env.localModelPath);
log("config: env.allowLocalModels =", env.allowLocalModels, "| env.allowRemoteModels =", env.allowRemoteModels);
log("config: candidates =", CANDIDATES.map((c) => `${c.label} (${c.modelId})`).join(", "));
log("config: scope = webgpu+fp32 ONLY (wasm/q8 settled dead per retry-3 instructions)");

async function imageUrlToBase64(url) {
  const res = await fetch(url);
  const blob = await res.blob();
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// THE INTERFACE CONTRACT (CLAUDE.md Section 4, Phase 0) -- NON-NEGOTIABLE,
// unchanged regardless of which model wins:
//   runDetection(imageBase64) -> [{label, score, xmin, ymin, xmax, ymax}]
//
// The library's raw per-detection shape is { score, label, box: {xmin,
// ymin, xmax, ymax} } -- nested, not flat -- for EVERY object-detection
// pipeline model, DETR-family or CNN-family alike, since ObjectDetectionPipeline._call
// is shared code across all of them (verified in pipelines.js). This
// wrapper does the same flattening adapter already proven against
// yolos-tiny, and it holds unmodified for both new candidates -- downstream
// modules never learn which model is underneath, which is the entire point
// of the contract.
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
  // explicit here for clarity). threshold matches prior retries for a fair
  // before/after comparison against the yolos-tiny baseline.
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

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Runs ONE candidate: load pipeline (webgpu+fp32 only), 1 cold inference,
// WARM_RUNS warm inferences, class-coverage check against the model's REAL
// runtime id2label, then disposes the ONNX session. Entire body wrapped in
// try/catch so one failing candidate doesn't abort the other. Also
// temporarily intercepts console.warn/console.error during the WHOLE
// candidate run (load + all inferences) to catch and report the same ORT
// "not assigned to preferred execution provider" node-splitting warning
// seen with yolos-tiny -- this is a direct empirical check, not an
// assumption that a CNN backbone fixes it.
async function benchmarkCandidate(candidate, base64) {
  const { modelId, label, architecture } = candidate;
  log(`--- [${label}] (${modelId}) starting ---`);
  log(`[${label}] architecture: ${architecture}`);

  const nodeAssignmentWarnings = [];
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
    if (/not assigned|preferred execution provider|fallback/i.test(text)) {
      nodeAssignmentWarnings.push(text);
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

  let detector;
  try {
    const t0 = performance.now();
    detector = await pipeline("object-detection", modelId, { device: "webgpu", dtype: "fp32" });
    const loadMs = performance.now() - t0;
    log(`[${label}] pipeline loaded in ${loadMs.toFixed(1)}ms`);

    // Class-coverage check against the REAL loaded model config, not just
    // this agent's earlier out-of-band curl inspection.
    const id2label = detector?.model?.config?.id2label ?? {};
    const labelValues = Object.values(id2label);
    const coverage = {};
    for (const c of PROXY_CLASSES) coverage[c] = labelValues.includes(c);
    log(`[${label}] runtime class count:`, labelValues.length);
    log(`[${label}] proxy-class coverage (runtime, from loaded model config):`, JSON.stringify(coverage));

    // COLD run
    const tc = performance.now();
    const coldDetections = await runDetection(base64, detector);
    const coldMs = performance.now() - tc;
    log(`[${label}] COLD inference: ${coldMs.toFixed(1)}ms, ${coldDetections.length} detections`);

    // WARM_RUNS warm runs
    const warmTimes = [];
    const warmDetectionsRuns = [];
    for (let i = 0; i < WARM_RUNS; i++) {
      const tw = performance.now();
      const d = await runDetection(base64, detector);
      const ms = performance.now() - tw;
      warmTimes.push(ms);
      warmDetectionsRuns.push(d);
      log(`[${label}] WARM run ${i + 1}/${WARM_RUNS}: ${ms.toFixed(1)}ms, ${d.length} detections`);
    }
    const medianWarmMs = median(warmTimes);
    const lastWarmDetections = warmDetectionsRuns[warmDetectionsRuns.length - 1];

    log(`[${label}] MEDIAN warm: ${medianWarmMs.toFixed(1)}ms`);
    log(`[${label}] gate (<${GATE_MS}ms on median warm):`, medianWarmMs < GATE_MS ? "PASS" : "FAIL");
    log(`[${label}] ORT node-assignment/graph-split warning observed:`, nodeAssignmentWarnings.length > 0 ? "YES" : "NO");
    if (nodeAssignmentWarnings.length) {
      log(`[${label}] warning text(s):`, JSON.stringify(nodeAssignmentWarnings, null, 2));
    }
    log(`[${label}] detections (last warm run, contract shape):`, JSON.stringify(lastWarmDetections, null, 2));

    return {
      label,
      modelId,
      architecture,
      status: "ok",
      loadMs,
      coldMs,
      coldDetections,
      warmTimes,
      medianWarmMs,
      warmDetectionsRuns,
      detections: lastWarmDetections,
      gatePass: medianWarmMs < GATE_MS,
      nodeAssignmentWarnings,
      classCount: labelValues.length,
      proxyCoverage: coverage,
    };
  } catch (err) {
    const msg = (err && err.stack) || String(err);
    log(`[${label}] FAILED. Error:`, msg);
    return { label, modelId, architecture, status: "failed", error: msg, nodeAssignmentWarnings };
  } finally {
    console.warn = origWarn;
    console.error = origError;
    if (detector?.model?.dispose) {
      try {
        await detector.model.dispose();
        log(`[${label}] session disposed.`);
      } catch (disposeErr) {
        log(`[${label}] session dispose FAILED (non-fatal):`, disposeErr);
      }
    }
  }
}

function buildSummaryTable(results) {
  const header = "| Config                        | Status | Cold (ms) | Warm runs (ms)                    | Median Warm (ms) | Gate (<1000ms) | ORT graph-split warning | Detections |";
  const sep    = "|--------------------------------|--------|-----------|------------------------------------|-------------------|----------------|--------------------------|------------|";
  const rows = results.map((r) => {
    const cfg = r.label.padEnd(30);
    if (r.status === "baseline") {
      return `| ${cfg} | fixed  | ${"-".padStart(9)} | ${("(8,432ms single-cell median, retry 2)").padEnd(34)} | ${r.medianWarmMs.toFixed(1).padStart(17)} | ${(r.gatePass ? "PASS" : "FAIL").padEnd(24)} | ${"n/a -- prior retry".padEnd(24)} | ${"5".padStart(10)} |`;
    } else if (r.status === "ok") {
      const cold = r.coldMs.toFixed(1).padStart(9);
      const warms = r.warmTimes.map((t) => t.toFixed(1)).join(", ").padEnd(34);
      const med = r.medianWarmMs.toFixed(1).padStart(17);
      const gate = (r.gatePass ? "PASS" : "FAIL").padEnd(14);
      const warn = (r.nodeAssignmentWarnings.length > 0 ? "YES" : "NO").padEnd(24);
      const count = String(r.detections.length).padStart(10);
      return `| ${cfg} | ok     | ${cold} | ${warms} | ${med} | ${gate} | ${warn} | ${count} |`;
    } else {
      const shortErr = (r.error || "").split("\n")[0].slice(0, 34).padEnd(34);
      return `| ${cfg} | FAILED | ${"-".padStart(9)} | ${shortErr} | ${"-".padStart(17)} | ${"-".padEnd(14)} | ${"-".padEnd(24)} | ${"-".padStart(10)} |`;
    }
  });
  return [header, sep, ...rows].join("\n");
}

async function main() {
  log("offscreen document starting...");
  log("=== RETRY 3: CNN-backbone candidate benchmark ===");

  const base64 = await imageUrlToBase64(IMAGE_URL);
  log("test image loaded as base64, length:", base64.length);
  log("NOTE: test image (assets/test-image.jpg, the same COCO cats/remotes/couch photo used in every prior retry) contains NO person/tv/laptop/cell-phone/book -- kept identical on purpose for latency comparability with the yolos-tiny baseline. Proxy-class COVERAGE below is checked against each model's declared class LIST at runtime, not demonstrated by detecting those objects in this specific photo.");

  const results = [];
  for (const candidate of CANDIDATES) {
    const r = await benchmarkCandidate(candidate, base64);
    results.push(r);
  }

  log("=== CANDIDATE BENCHMARK COMPLETE ===");

  log("=== CLASS COVERAGE SUMMARY ===");
  for (const r of results) {
    if (r.status !== "ok") {
      log(`[${r.label}] class coverage: N/A (candidate failed to load/run)`);
      continue;
    }
    const missing = PROXY_CLASSES.filter((c) => !r.proxyCoverage[c]);
    log(`[${r.label}] ${r.classCount} total classes. Proxy coverage:`, JSON.stringify(r.proxyCoverage), missing.length ? `MISSING: ${missing.join(", ")}` : "all present");
  }

  log("=== FINAL SUMMARY TABLE (copy-paste this whole block back) ===");
  console.log(buildSummaryTable([YOLOS_TINY_BASELINE, ...results]));

  log("=== RAW RESULTS (JSON, for reference) ===");
  log(JSON.stringify(
    results.map((r) => ({
      label: r.label,
      modelId: r.modelId,
      status: r.status,
      loadMs: r.loadMs,
      coldMs: r.coldMs,
      warmTimes: r.warmTimes,
      medianWarmMs: r.medianWarmMs,
      gatePass: r.gatePass,
      detectionCount: r.detections?.length,
      nodeAssignmentWarnings: r.nodeAssignmentWarnings,
      classCount: r.classCount,
      proxyCoverage: r.proxyCoverage,
      error: r.error,
    })),
    null,
    2,
  ));
}

main().catch((err) => {
  console.error("[spike] FAILED (top-level, candidate benchmark did not complete):", err);
});
