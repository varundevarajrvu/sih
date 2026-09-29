// SIH 26171 v2 rebuild -- Phase V4b (integration-v2, part B) -- ONE real
// local-planner run. Proves the v2 loop end to end against the REAL,
// UNMODIFIED server/main.py (no dependency override, no ScenarioVLMClient)
// with VLM_BACKEND_V2=ollama (llama3.1:8b) -- the product's actual default
// planner, per docs/v2/ARCHITECTURE.md's 2026-09-25 decision log entry.
//
// Deliberately scenario 1 ONLY ("fill the name as Simon") -- this is the
// resource-heavy leg (llama3.1:8b + the NER service loaded simultaneously,
// ~16 GB RAM machine, no GPU) and the brief asks for ONE real run to prove
// the local path works and to record s/step, not a full scenario sweep
// (that's what the mock/scenario bench already covered, 7/7, in
// benchmarks/results/v4b-loop.json).
//
// No server-side context capture here (the real server is unmodified --
// there is no override point to hook without editing server/ code, which
// this phase's brief does not ask for). Client-side RUN_AGENT_LOOP_RESULT
// stepResults/timings are the evidence for this run.
//
// Run with:
//   NODE_PATH="<repo>/spikes/ultraface/node_modules" node benchmarks/v4b-real-ollama-bench.mjs

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// V4b follow-up (coordinator instruction): a hard memory precheck BEFORE
// starting anything (server, NER, browser, Ollama) -- llama3.1:8b's own
// ~5 GB RSS on top of the NER service's ~1.5 GB and Chrome/Playwright's own
// footprint has genuinely exhausted this 16 GB machine before (see this
// run's own results/v4b-real-ollama.json for the reap that killed the FIRST
// attempt at this exact leg). Uses the SAME PowerShell query the coordinator
// specified, not Node's own os.freemem() (which reads a different, less
// precise counter on Windows), so a manual check and this script's own
// measurement can never silently disagree.
const REQUIRED_FREE_MB = Number(process.env.MIN_FREE_MB) || 7 * 1024; // 7 GB default; override recorded in results.memoryPrecheck
function getFreePhysicalMemoryMB() {
  const out = execSync(
    'powershell.exe -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory"',
    { encoding: "utf-8" }
  ).trim();
  const kb = parseInt(out, 10);
  if (!Number.isFinite(kb)) throw new Error(`could not parse FreePhysicalMemory output: ${JSON.stringify(out)}`);
  return kb / 1024;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const ultrafaceRequire = createRequire(path.join(REPO_ROOT, "spikes", "ultraface", "package.json"));
const { chromium } = ultrafaceRequire("playwright");
const REAL_EXTENSION_PATH = path.join(REPO_ROOT, "extension");
const DEMO_URL = "http://localhost:5500/test-page.html";

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function prepareEvidenceOnlyExtensionCopy() {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "v4b-real-ollama-ext-"));
  fs.cpSync(REAL_EXTENSION_PATH, dest, { recursive: true });
  const manifestPath = path.join(dest, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  if (!manifest.host_permissions.includes("<all_urls>")) manifest.host_permissions.push("<all_urls>");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return dest;
}

async function getPrewarmStatus(page) {
  return page.evaluate(() => new Promise((resolve) => chrome.runtime.sendMessage({ type: "GET_PREWARM_STATUS" }, resolve)));
}
async function setTaskGoal(page, goal) {
  return page.evaluate((g) => new Promise((resolve) => chrome.runtime.sendMessage({ type: "SET_TASK_GOAL", goal: g }, resolve)), goal);
}
async function setPipelineVersion(page) {
  return page.evaluate(() => chrome.storage.local.set({ pipelineVersion: "v2" }));
}
async function runAgentLoop(page) {
  return page.evaluate(() => new Promise((resolve) => chrome.runtime.sendMessage({ type: "RUN_AGENT_LOOP" }, resolve)));
}

const results = {
  bench: "v4b-real-ollama",
  phase: "V4b integration-v2 (part B) -- real local planner (llama3.1:8b)",
  date: new Date().toISOString(),
  backend: "VLM_BACKEND_V2=ollama, model=llama3.1:8b (server default per get_vlm_client_v2)",
  machine: { platform: os.platform(), cpuModel: os.cpus()[0]?.model || null, cpuCount: os.cpus().length, totalMemGB: +(os.totalmem() / 1e9).toFixed(1) },
  scenario: { name: "S1_fill_name_real_ollama", goal: "fill the name as Simon" },
  crashed: false,
};

let browser = null, userDataDir = null, evidenceExtensionDir = null;

async function main() {
  const freeMB = getFreePhysicalMemoryMB();
  results.memoryPrecheck = { requiredFreeMB: REQUIRED_FREE_MB, measuredFreeMB: +freeMB.toFixed(0) };
  console.log(`memory precheck: ${freeMB.toFixed(0)} MB free (need >= ${REQUIRED_FREE_MB} MB)`);
  if (freeMB < REQUIRED_FREE_MB) {
    results.crashed = false;
    results.outcome = "precheck_failed";
    results.memoryPrecheck.precheckPassed = false;
    console.log("PRECHECK FAILED -- not starting the browser, the server, or Ollama. Writing the result and stopping.");
    const outPath = path.join(REPO_ROOT, "benchmarks", "results", "v4b-real-ollama.json");
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
    console.log("WROTE", outPath);
    return;
  }
  results.memoryPrecheck.precheckPassed = true;

  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "v4b-real-ollama-"));
  evidenceExtensionDir = prepareEvidenceOnlyExtensionCopy();

  const context = await withTimeout(
    chromium.launchPersistentContext(userDataDir, {
      headless: false,
      viewport: null,
      args: [
        `--disable-extensions-except=${evidenceExtensionDir}`,
        `--load-extension=${evidenceExtensionDir}`,
        "--no-first-run",
        "--no-default-browser-check",
      ],
    }),
    30000,
    "launchPersistentContext"
  );
  browser = context;

  try {
    let sw = context.serviceWorkers()[0];
    if (!sw) sw = await withTimeout(context.waitForEvent("serviceworker"), 20000, "waitForEvent(serviceworker)");
    const extensionId = new URL(sw.url()).host;
    results.extensionId = extensionId;
    console.log("extension id:", extensionId);

    const driverPage = await context.newPage();
    await withTimeout(driverPage.goto(`chrome-extension://${extensionId}/popup.html`), 15000, "goto popup.html");
    await setPipelineVersion(driverPage);

    let prewarm = await getPrewarmStatus(driverPage);
    const prewarmDeadline = Date.now() + 60000;
    while (prewarm.status !== "warm" && prewarm.status !== "failed" && Date.now() < prewarmDeadline) {
      await new Promise((r) => setTimeout(r, 500));
      prewarm = await getPrewarmStatus(driverPage);
    }
    console.log("prewarm:", prewarm.status);
    results.prewarm = prewarm;

    const demoPage = await context.newPage();
    await withTimeout(demoPage.goto(DEMO_URL, { waitUntil: "load" }), 15000, `goto ${DEMO_URL}`);
    await demoPage.waitForTimeout(500);

    await setTaskGoal(driverPage, results.scenario.goal);
    await demoPage.bringToFront();

    console.log("running against REAL Ollama (llama3.1:8b) -- this can take a while, no GPU...");
    const t0 = Date.now();
    // Real llama3.1:8b p50 measured at ~11.4s/step (ARCHITECTURE.md's V3
    // retry-2 record) on this exact machine -- 25 steps' worth of headroom
    // would be ~5 minutes; this run should finish in far fewer steps
    // (S1 completes in 2 in every mock/v1 run), but the timeout is sized
    // generously rather than tightly, since this is the one real-model call
    // in the whole evidence run and must not time out on a slow first token.
    const runResult = await withTimeout(runAgentLoop(driverPage), 240000, "RUN_AGENT_LOOP (real ollama)");
    const wallMs = Date.now() - t0;

    results.outcome = runResult && runResult.outcome;
    results.steps = runResult && runResult.steps;
    results.wallMs = wallMs;
    results.stepResults = runResult && runResult.stepResults;
    results.secondsPerStep = results.steps ? +(wallMs / 1000 / results.steps).toFixed(2) : null;

    console.log(`outcome: ${results.outcome}, steps: ${results.steps}, wallMs: ${wallMs}, s/step: ${results.secondsPerStep}`);
    await demoPage.close();
  } catch (err) {
    results.crashed = true;
    results.error = err && err.message;
    console.error("BENCH CRASHED:", err);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
    if (evidenceExtensionDir) fs.rmSync(evidenceExtensionDir, { recursive: true, force: true });
  }

  const outPath = path.join(REPO_ROOT, "benchmarks", "results", "v4b-real-ollama.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log("WROTE", outPath);
}

main();
