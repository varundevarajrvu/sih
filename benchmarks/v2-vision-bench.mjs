// V2 Phase V2 (vision-v2) -- browser-proof + latency/recall benchmark.
//
// Loads the REAL unpacked extension (extension/) into a real Chromium via
// Playwright's persistent context (`--load-extension` /
// `--disable-extensions-except`), drives the REAL background service
// worker to round-trip DETECT_OBJECTS messages through the REAL offscreen
// document -- the same code path a live user session uses -- and measures:
//   1. cold load (the extension's own onInstalled self-test timing, via
//      GET_PREWARM_STATUS -- the same methodology this project has always
//      used for "cold" numbers, see CLAUDE.md's yolos precedent).
//   2. warm inference latency (repeated DETECT_OBJECTS calls on the demo
//      face fixture, after the session is already loaded).
//   3. recall across the V0b spike's face-scale ladder
//      (spikes/ultraface/fixtures/face-{40,60,80,96,120,200}px.png) and
//      3 no-face fixtures, including whether the tiled second pass fired
//      and what it cost.
//
// Reuses spikes/ultraface's already-resolved Playwright + cached Chromium
// (NODE_PATH points at its node_modules -- no new npm install, no new
// browser download; see this module's own report for why).
//
// Background servers only, explicit timeouts, kills what it starts.
// Run with:
//   NODE_PATH="<repo>/spikes/ultraface/node_modules" node benchmarks/v2-vision-bench.mjs

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// Node's ESM resolver does not honor NODE_PATH -- resolve `playwright`
// (and its already-cached Chromium binary) from spikes/ultraface's own
// node_modules via an anchored require(), instead of adding a new
// package.json/npm install anywhere. No new dependency, no new download:
// same package, same version, same cached browser the V0b spike already
// used (spikes/ultraface/node_modules/playwright, chromium-1243).
const ultrafaceRequire = createRequire(path.join(REPO_ROOT, "spikes", "ultraface", "package.json"));
const { chromium } = ultrafaceRequire("playwright");
const EXTENSION_PATH = path.join(REPO_ROOT, "extension");
const FIXTURES_DIR = path.join(REPO_ROOT, "spikes", "ultraface", "fixtures");
const DEMO_FACE_PNG = path.join(
  "C:\\Users\\varun\\AppData\\Local\\Temp\\claude\\C--Users-varun-brain-raw\\efdce0cc-4955-44f1-b020-eebfa544c7b1\\scratchpad",
  "demo-face.png",
);

const SCALES = [40, 60, 80, 96, 120, 200];
const FP_FILES = ["no-face-testpage.png", "no-face-wikipedia.png", "no-face-loginform.png"];
const WARM_REPEATS = 5; // per fixture, after the first (discarded as still-warming-up) call

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function percentile(arr, p) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function readFixtureBase64(fileName) {
  return fs.readFileSync(path.join(FIXTURES_DIR, fileName)).toString("base64");
}

const results = {
  bench: "v2-vision",
  phase: "V2 vision-v2",
  date: new Date().toISOString(),
  machine: {},
  visionModel: "ultraface",
  coldLoad: {},
  warmLatencyDemoFace: {},
  scaleLadder: [],
  falsePositives: [],
  tiledPass: { enabled: true, samples: [], decision: null },
  notes: [],
  crashed: false,
};

let browser = null;
let userDataDir = null;

// IMPORTANT, found by probing before writing the real harness: Chrome
// does NOT deliver a chrome.runtime.sendMessage() call back to a listener
// registered in the SAME execution context that sent it -- a service
// worker cannot message itself this way ("Could not establish connection.
// Receiving end does not exist."). background.js's own message router
// therefore cannot be driven from `serviceWorker.evaluate()` directly.
// Every message below is instead driven from the extension's POPUP PAGE
// (opened as a real `chrome-extension://<id>/popup.html` tab), a
// genuinely separate extension context whose chrome.runtime.sendMessage
// calls DO reach background.js's listener (and whose chrome.runtime.
// onMessage listener DOES receive the offscreen document's broadcast
// replies) -- verified against this exact extension before relying on it
// for the real run (see this module's own report).
async function evalInPage(page, fn, arg) {
  return page.evaluate(fn, arg);
}

// Runs inside the extension's REAL popup page (chrome.* APIs are the real
// extension APIs, not a stub -- same permissions the popup always has).
// Sends a REAL DETECT_OBJECTS message and waits for the REAL offscreen
// document's DETECTION_RESULT/DETECTION_ERROR reply -- exercising the
// exact same message contract a live user session uses. Does not attempt
// to create the offscreen document itself: background.js's own
// onInstalled self-test (runInstallSelfTest()) already creates it
// automatically on extension load, well before this function's first
// call in practice (confirmed via GET_PREWARM_STATUS polling below).
async function detectObjectsViaRealOffscreen(page, imageDataBase64, timeoutMs) {
  return page.evaluate(
    async ({ imageData, timeoutMs }) => {
      // Offscreen-document creation is deliberately NOT attempted from
      // here (see the file-level note above this function): background.js's
      // own onInstalled self-test already creates it, and this function
      // is only ever called after GET_PREWARM_STATUS confirms that
      // self-test has completed.
      const requestId = `bench-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const resultPromise = new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          chrome.runtime.onMessage.removeListener(listener);
          reject(new Error(`bench: timed out after ${timeoutMs}ms waiting for DETECTION_RESULT/DETECTION_ERROR`));
        }, timeoutMs);
        function listener(message) {
          if (!message || message.requestId !== requestId) return;
          if (message.type === "DETECTION_RESULT" || message.type === "DETECTION_ERROR") {
            clearTimeout(timeoutId);
            chrome.runtime.onMessage.removeListener(listener);
            resolve(message);
          }
        }
        chrome.runtime.onMessage.addListener(listener);
      });

      chrome.runtime.sendMessage({ type: "DETECT_OBJECTS", requestId, imageData });
      const t0 = performance.now();
      const message = await resultPromise;
      const roundTripMs = performance.now() - t0;
      return { message, roundTripMs };
    },
    { imageData: imageDataBase64, timeoutMs },
  );
}

async function getPrewarmStatus(page) {
  return page.evaluate(
    () => new Promise((resolve) => chrome.runtime.sendMessage({ type: "GET_PREWARM_STATUS" }, resolve)),
  );
}

function writeResults() {
  const outPath = path.join(REPO_ROOT, "benchmarks", "results", "v2-vision.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log("WROTE", outPath);
}

async function main() {
  results.machine = {
    platform: os.platform(),
    osRelease: os.release(),
    cpuModel: os.cpus()[0]?.model || null,
    cpuCount: os.cpus().length,
    totalMemGB: +(os.totalmem() / 1e9).toFixed(1),
  };

  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "v2-vision-bench-"));

  console.log("launching persistent context with extension:", EXTENSION_PATH);
  const context = await withTimeout(
    chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        "--no-first-run",
        "--no-default-browser-check",
      ],
    }),
    30000,
    "launchPersistentContext",
  );
  browser = context;

  try {
    console.log("waiting for background service worker...");
    let sw = context.serviceWorkers()[0];
    if (!sw) {
      sw = await withTimeout(context.waitForEvent("serviceworker"), 20000, "waitForEvent(serviceworker)");
    }
    console.log("service worker URL:", sw.url());
    const extensionId = new URL(sw.url()).host;
    results.extensionId = extensionId;

    // Driver context: the popup page, not the service worker itself --
    // see the file-level note above detectObjectsViaRealOffscreen() for
    // why (a context cannot chrome.runtime.sendMessage to its own
    // listener; verified by probe before this harness was written this
    // way).
    const driverPage = await context.newPage();
    await withTimeout(driverPage.goto(`chrome-extension://${extensionId}/popup.html`), 15000, "goto popup.html");
    console.log("driver page (popup.html) loaded");

    // --- 1. Cold load: poll GET_PREWARM_STATUS until it settles. This is
    // the extension's OWN onInstalled self-test -- a real model load +
    // real first inference, the same "cold" methodology this project has
    // always used (background.js runInstallSelfTest()/prewarmState).
    console.log("polling GET_PREWARM_STATUS for cold-load completion...");
    let prewarm = await getPrewarmStatus(driverPage);
    const prewarmDeadline = Date.now() + 60000;
    while (prewarm.status !== "warm" && prewarm.status !== "failed" && Date.now() < prewarmDeadline) {
      await new Promise((r) => setTimeout(r, 500));
      prewarm = await getPrewarmStatus(driverPage);
    }
    console.log("prewarm settled:", JSON.stringify(prewarm));
    results.coldLoad = prewarm;
    if (prewarm.status !== "warm") {
      results.notes.push(`Prewarm self-test did not reach 'warm' within 60s (status=${prewarm.status}, error=${prewarm.error}).`);
    }

    // --- 2. Browser proof + warm latency: repeated real DETECT_OBJECTS
    // round trips on the demo face image through the real offscreen doc.
    const demoFaceBase64 = fs.readFileSync(DEMO_FACE_PNG).toString("base64");
    const demoFaceSamples = [];
    for (let i = 0; i < WARM_REPEATS + 1; i++) {
      const { message, roundTripMs } = await withTimeout(
        detectObjectsViaRealOffscreen(driverPage, demoFaceBase64, 60000),
        65000,
        `demo-face DETECT_OBJECTS round trip #${i}`,
      );
      console.log(
        `demo-face round trip #${i}: type=${message.type} roundTripMs=${roundTripMs.toFixed(1)} ` +
          `inferenceMs=${message.inferenceMs?.toFixed?.(1)} boxes=${message.boxes?.length} tiledPassUsed=${message.tiledPassUsed}`,
      );
      if (message.type === "DETECTION_ERROR") {
        results.notes.push(`demo-face round trip #${i} FAILED: ${JSON.stringify(message.error)}`);
        results.crashed = true;
        continue;
      }
      demoFaceSamples.push({
        roundTripMs,
        inferenceMs: message.inferenceMs,
        modelLoadMs: message.modelLoadMs,
        pipelineWasAlreadyLoaded: message.pipelineWasAlreadyLoaded,
        device: message.device,
        boxesCount: message.boxes.length,
        topScore: message.boxes[0]?.score ?? null,
        tiledPassUsed: message.tiledPassUsed,
        visionModel: message.visionModel,
      });
      if (i === 0) {
        results.notes.push(`demo-face round trip #0 (first explicit call, may still be partially warming up): ${JSON.stringify(demoFaceSamples[0])}`);
      }
    }
    // First sample may still carry warm-up cost from this being the very
    // first EXPLICIT call after the self-test (which used a different
    // image) -- report both "including" and "excluding first" so neither
    // reading is silently hidden.
    const allDemoFaceInfer = demoFaceSamples.map((s) => s.inferenceMs);
    const warmOnlyInfer = demoFaceSamples.slice(1).map((s) => s.inferenceMs);
    results.warmLatencyDemoFace = {
      samples: demoFaceSamples,
      inferenceMsIncludingFirst: { p50: percentile(allDemoFaceInfer, 50), p95: percentile(allDemoFaceInfer, 95), samples: allDemoFaceInfer },
      inferenceMsExcludingFirst: { p50: percentile(warmOnlyInfer, 50), p95: percentile(warmOnlyInfer, 95), samples: warmOnlyInfer },
      demoFaceDetectedEveryRun: demoFaceSamples.every((s) => s.boxesCount > 0),
      topScoreRange: [Math.min(...demoFaceSamples.map((s) => s.topScore ?? 1)), Math.max(...demoFaceSamples.map((s) => s.topScore ?? 0))],
    };

    // --- 3. Scale ladder recall + false positives + tiled-pass numbers.
    for (const scale of SCALES) {
      const fileName = `face-${scale}px.png`;
      const base64 = readFixtureBase64(fileName);
      const runs = [];
      for (let i = 0; i < 3; i++) {
        const { message, roundTripMs } = await withTimeout(
          detectObjectsViaRealOffscreen(driverPage, base64, 60000),
          65000,
          `${fileName} DETECT_OBJECTS round trip #${i}`,
        );
        if (message.type === "DETECTION_ERROR") {
          results.notes.push(`${fileName} round trip #${i} FAILED: ${JSON.stringify(message.error)}`);
          continue;
        }
        runs.push({
          roundTripMs,
          inferenceMs: message.inferenceMs,
          boxesCount: message.boxes.length,
          topScore: message.boxes[0]?.score ?? null,
          tiledPassUsed: message.tiledPassUsed,
        });
        console.log(
          `${fileName} run #${i}: detected=${message.boxes.length > 0} score=${message.boxes[0]?.score} ` +
            `inferenceMs=${message.inferenceMs?.toFixed?.(1)} tiledPassUsed=${message.tiledPassUsed}`,
        );
      }
      const entry = {
        scalePx: scale,
        fileName,
        runs,
        detectedAnyRun: runs.some((r) => r.boxesCount > 0),
        detectedEveryRun: runs.length > 0 && runs.every((r) => r.boxesCount > 0),
        tiledPassFiredAnyRun: runs.some((r) => r.tiledPassUsed),
        inferenceMsP50: percentile(runs.map((r) => r.inferenceMs), 50),
      };
      results.scaleLadder.push(entry);
      if (entry.tiledPassFiredAnyRun) {
        results.tiledPass.samples.push({ source: fileName, scalePx: scale, runs });
      }
    }

    // --- 4. False positives (no-face fixtures) -- also feeds tiled-pass cost samples.
    for (const fileName of FP_FILES) {
      const filePath = path.join(FIXTURES_DIR, fileName);
      if (!fs.existsSync(filePath)) {
        results.notes.push(`false-positive fixture missing, skipped: ${fileName}`);
        continue;
      }
      const base64 = fs.readFileSync(filePath).toString("base64");
      const runs = [];
      for (let i = 0; i < 3; i++) {
        const { message, roundTripMs } = await withTimeout(
          detectObjectsViaRealOffscreen(driverPage, base64, 60000),
          65000,
          `${fileName} DETECT_OBJECTS round trip #${i}`,
        );
        if (message.type === "DETECTION_ERROR") {
          results.notes.push(`${fileName} round trip #${i} FAILED: ${JSON.stringify(message.error)}`);
          continue;
        }
        runs.push({
          roundTripMs,
          inferenceMs: message.inferenceMs,
          boxesCount: message.boxes.length,
          tiledPassUsed: message.tiledPassUsed,
        });
        console.log(`${fileName} run #${i}: detections=${message.boxes.length} inferenceMs=${message.inferenceMs?.toFixed?.(1)} tiledPassUsed=${message.tiledPassUsed}`);
      }
      const entry = { fileName, runs, falsePositiveAnyRun: runs.some((r) => r.boxesCount > 0) };
      results.falsePositives.push(entry);
      if (runs.some((r) => r.tiledPassUsed)) {
        results.tiledPass.samples.push({ source: fileName, runs });
      }
    }

    // --- 5. Tiled-pass decision, pre-registered gate: whole detect call
    // warm p95 <= 300ms when the tiled pass fires. "Whole detect call" =
    // inferenceMs (the field this project has always used for the
    // detect-stage timing; roundTripMs additionally includes message-bus
    // overhead which is not part of what the gate is measuring).
    const tiledInferenceMs = results.tiledPass.samples.flatMap((s) => s.runs.map((r) => r.inferenceMs));
    const tiledP50 = percentile(tiledInferenceMs, 50);
    const tiledP95 = percentile(tiledInferenceMs, 95);
    results.tiledPass.inferenceMsWhenFired = { p50: tiledP50, p95: tiledP95, n: tiledInferenceMs.length, samples: tiledInferenceMs };
    results.tiledPass.gateMs = 300;
    results.tiledPass.decision =
      tiledInferenceMs.length > 0 && tiledP95 !== null && tiledP95 <= 300
        ? "ADOPTED (tiled second pass stays ON -- measured warm p95 <= 300ms gate)"
        : "OFF (measured warm p95 > 300ms gate, or no samples -- tiled pass left DISABLED, numbers recorded as required)";
    // Recall improvement the tiled pass bought, specifically on the scale-ladder entries where it fired:
    results.tiledPass.recallImprovement = results.scaleLadder
      .filter((e) => e.tiledPassFiredAnyRun)
      .map((e) => ({ scalePx: e.scalePx, detectedWithTiledPass: e.detectedAnyRun }));
  } finally {
    writeResults();
    await context.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 });
  }
}

main().catch((err) => {
  console.error("BENCH FAILED:", err);
  results.crashed = true;
  results.notes.push(`FATAL: ${err.message}`);
  writeResults();
  process.exitCode = 1;
});
