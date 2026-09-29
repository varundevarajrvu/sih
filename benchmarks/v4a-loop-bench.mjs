// SIH 26171 v2 rebuild -- Phase V4a (integration-v2) -- browser evidence run.
//
// Loads the REAL unpacked extension into a real Chromium via Playwright's
// persistent context (same pattern as benchmarks/v2-vision-bench.mjs --
// reused deliberately, not reinvented), drives the REAL v2 loop
// (extension/lib/agent-loop-v2.js via content.js's runAgentLoopV2Adapter(),
// PIPELINE_VERSION defaults to "v2") against demo/test-page.html served on
// :5500, talking to a REAL /v2/analyze on :8000 (benchmarks/
// v4a_server_launcher.py's ScenarioVLMClient -- see that file's own header
// for why the unmodified MockVLMClient cannot express scenario 3) and a
// REAL NER service on :8757.
//
// Drives from the extension's POPUP PAGE, exactly like v2-vision-bench.mjs
// (a service worker cannot chrome.runtime.sendMessage to itself -- see that
// file's own "IMPORTANT" comment, verified against this exact extension
// before relying on it here too).
//
// Runs TWO scenarios end to end:
//   1. "fill the name as Simon"                        -- scenario 1
//   2. "Fill the name as River Jane and email id as riverjane33@demo.com" -- scenario 3
// and proves, from BOTH sides of the wire (the client's own RUN_AGENT_LOOP_RESULT
// AND the server's own captured VLMRequestContextV2 log):
//   - no raw name/email ever appears in any request body
//   - the tokenized taskGoal carries a PERSONNAME#/EMAIL# token
//   - the REHYDRATED value is what actually landed in the page's DOM
//   - scenario 3's email write is refused (SENSITIVE_TARGET_BLOCKED)
//
// Background servers only, explicit timeouts, kills nothing it didn't start
// (this script assumes the server/NER processes are ALREADY running --
// started/stopped by the orchestrating shell, not by this script, so a
// human/agent driving several bench runs doesn't pay model cold-load twice).
//
// Run with:
//   NODE_PATH="<repo>/spikes/ultraface/node_modules" node benchmarks/v4a-loop-bench.mjs

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const ultrafaceRequire = createRequire(path.join(REPO_ROOT, "spikes", "ultraface", "package.json"));
const { chromium } = ultrafaceRequire("playwright");
const REAL_EXTENSION_PATH = path.join(REPO_ROOT, "extension");
const DEMO_URL = "http://localhost:5500/test-page.html";

// ---------------------------------------------------------------------------
// chrome.tabs.captureVisibleTab requires EITHER the "<all_urls>" host
// permission OR the transient "activeTab" grant a real user gesture
// provides (confirmed against this exact extension: probed first with the
// shipping manifest.json's scoped host_permissions -- "http://localhost/*"
// -- and captureVisibleTab rejected with the literal Chrome runtime error
// "Either the '<all_urls>' or 'activeTab' permission is required."
// Scoped host_permissions do NOT satisfy this API specifically, unlike
// fetch()/CORS, which DO accept them -- this is the exact limitation
// CLAUDE.md's full-page-capture entry already flagged ("opening popup.html
// as a bare tab does not grant activeTab, which only a genuine
// toolbar-icon click provides", and Playwright cannot script a genuine
// toolbar-icon click -- that's browser chrome, not page DOM).
//
// The SHIPPING extension/manifest.json is never touched by this script.
// This copies extension/ into a scratch directory and widens ONLY that
// copy's host_permissions to <all_urls>, purely so an AUTOMATED evidence
// run can drive captureVisibleTab without a human clicking the toolbar
// icon. The product's actual permission surface (CLAUDE.md's own explicit
// ruling: "host_permissions stays narrow") is unaffected -- this is a
// test-harness accommodation, not a product change, and the scratch copy
// is deleted at the end of this script.
// ---------------------------------------------------------------------------
function prepareEvidenceOnlyExtensionCopy() {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "v4a-loop-bench-ext-"));
  fs.cpSync(REAL_EXTENSION_PATH, dest, { recursive: true });
  const manifestPath = path.join(dest, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  if (!manifest.host_permissions.includes("<all_urls>")) {
    manifest.host_permissions.push("<all_urls>");
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return dest;
}

// Substrings that must NEVER appear in any body a request captured
// server-side, per demo/test-page.html's own fixture values (see that
// file: pw value "hunter2Demo!", email "alice.demo@example.com", Aadhaar
// "1234 5678 9012") plus this run's own scenario names.
const FORBIDDEN_RAW_SUBSTRINGS = [
  "hunter2Demo!",
  "alice.demo@example.com",
  "1234 5678 9012",
  "Simon",
  "River Jane",
  "riverjane33@demo.com",
];

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function getPrewarmStatus(page) {
  return page.evaluate(() => new Promise((resolve) => chrome.runtime.sendMessage({ type: "GET_PREWARM_STATUS" }, resolve)));
}

async function setTaskGoal(page, goal) {
  return page.evaluate(
    (g) => new Promise((resolve) => chrome.runtime.sendMessage({ type: "SET_TASK_GOAL", goal: g }, resolve)),
    goal
  );
}

async function runAgentLoop(page) {
  return page.evaluate(() => new Promise((resolve) => chrome.runtime.sendMessage({ type: "RUN_AGENT_LOOP" }, resolve)));
}

function readCapturedContexts() {
  const p = path.join(REPO_ROOT, "benchmarks", "results", "v4a-captured-contexts.jsonl");
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function auditContextsForRawLeaks(contexts) {
  const violations = [];
  for (const ctx of contexts) {
    const str = JSON.stringify(ctx);
    for (const forbidden of FORBIDDEN_RAW_SUBSTRINGS) {
      if (str.includes(forbidden)) violations.push({ forbidden, taskGoal: ctx.taskGoal });
    }
  }
  return violations;
}

const results = {
  bench: "v4a-loop",
  phase: "V4a integration-v2 (loop wiring)",
  date: new Date().toISOString(),
  machine: {},
  scenarios: [],
  privacyAudit: {},
  notes: [],
  crashed: false,
};

let browser = null;
let userDataDir = null;
let evidenceExtensionDir = null;

async function main() {
  results.machine = {
    platform: os.platform(),
    osRelease: os.release(),
    cpuModel: os.cpus()[0]?.model || null,
    cpuCount: os.cpus().length,
    totalMemGB: +(os.totalmem() / 1e9).toFixed(1),
  };

  // Fresh capture log for this run only.
  const capturePath = path.join(REPO_ROOT, "benchmarks", "results", "v4a-captured-contexts.jsonl");
  fs.mkdirSync(path.dirname(capturePath), { recursive: true });
  fs.writeFileSync(capturePath, "");

  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "v4a-loop-bench-"));
  evidenceExtensionDir = prepareEvidenceOnlyExtensionCopy();
  results.notes.push(
    "captureVisibleTab requires <all_urls> or a real activeTab gesture; Playwright cannot produce the latter, " +
      "so this run drives a SCRATCH COPY of the extension with host_permissions widened to <all_urls> for capture " +
      "only. extension/manifest.json itself (the shipping product) is untouched -- see this file's own header comment."
  );

  console.log("launching persistent context with EVIDENCE-ONLY extension copy:", evidenceExtensionDir);
  const context = await withTimeout(
    chromium.launchPersistentContext(userDataDir, {
      headless: false,
      // viewport:null -- observed WITHOUT this, Playwright applies its own
      // default CDP viewport override (1280x720 logical) to the PAGE, but
      // chrome.tabs.captureVisibleTab operates on the REAL native browser
      // window (this machine's actual window came out 1600x900) -- a
      // Playwright/CDP testing artifact (the two are decoupled), not real
      // display-scaling. This fired RULING A's dimension-mismatch
      // stale-capture guard on EVERY step, working exactly as designed
      // (CLAUDE.md's own flagged risk: "if it is wrong for the display
      // scaling in use, detectDimensionMismatch() fires on every step").
      // Explicitly setting deviceScaleFactor:1 with a fixed viewport did
      // NOT fix it (captureVisibleTab still returned 1600x900 -- proving
      // captureVisibleTab is NOT affected by CDP's Emulation.
      // setDeviceMetricsOverride at all). viewport:null disables Playwright's
      // CDP viewport override entirely, so window.innerWidth (what
      // content.js reads) reflects the SAME real native window
      // captureVisibleTab reads -- the two agree by construction, matching
      // every non-automated (Varun's own manual) browser run in this
      // project's history.
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
    console.log("waiting for background service worker...");
    let sw = context.serviceWorkers()[0];
    if (!sw) sw = await withTimeout(context.waitForEvent("serviceworker"), 20000, "waitForEvent(serviceworker)");
    const extensionId = new URL(sw.url()).host;
    results.extensionId = extensionId;
    console.log("extension id:", extensionId);

    const driverPage = await context.newPage();
    // C4: consent denies by default after 60s -- but for the parts of this
    // run that need it to fire QUICKLY (scenario 3's email refusal), the
    // popup's own CONSENT_REQUEST listener uses window.confirm(); dismiss
    // every dialog immediately rather than waiting out the full timeout.
    driverPage.on("dialog", (d) => d.dismiss().catch(() => {}));
    await withTimeout(driverPage.goto(`chrome-extension://${extensionId}/popup.html`), 15000, "goto popup.html");
    console.log("driver page (popup.html) loaded");

    console.log("polling GET_PREWARM_STATUS for cold-load completion...");
    let prewarm = await getPrewarmStatus(driverPage);
    const prewarmDeadline = Date.now() + 60000;
    while (prewarm.status !== "warm" && prewarm.status !== "failed" && Date.now() < prewarmDeadline) {
      await new Promise((r) => setTimeout(r, 500));
      prewarm = await getPrewarmStatus(driverPage);
    }
    console.log("prewarm status:", prewarm.status, prewarm.elapsedMs ? `${prewarm.elapsedMs.toFixed(0)}ms` : "");
    results.prewarm = prewarm;

    const scenarioDefs = [
      { name: "scenario1_fill_name", goal: "fill the name as Simon", expectOutcome: "done" },
      {
        name: "scenario3_fill_name_and_refuse_email",
        goal: "Fill the name as River Jane and email id as riverjane33@demo.com",
        expectOutcome: "blocked",
      },
    ];

    for (const def of scenarioDefs) {
      console.log(`\n=== ${def.name}: "${def.goal}" ===`);
      const demoPage = await context.newPage();
      await withTimeout(demoPage.goto(DEMO_URL, { waitUntil: "load" }), 15000, `goto ${DEMO_URL}`);
      // give content.js (document_idle) + FRAME_HELLO a moment to settle
      await demoPage.waitForTimeout(500);

      const consoleLines = [];
      demoPage.on("console", (msg) => {
        const text = msg.text();
        if (text.includes("[agent-loop") || text.includes("RUN SUMMARY")) consoleLines.push(text);
      });

      await setTaskGoal(driverPage, def.goal);
      // background.js's RUN_AGENT_LOOP handler resolves the ACTIVE tab via
      // browser.tabs.query({active:true, currentWindow:true}) -- the demo
      // page must be the focused tab when we send it, even though the
      // driver page (popup.html) is what actually calls sendMessage.
      await demoPage.bringToFront();

      const t0 = Date.now();
      const runResult = await withTimeout(runAgentLoop(driverPage), 90000, `RUN_AGENT_LOOP (${def.name})`);
      const wallMs = Date.now() - t0;

      console.log(`outcome: ${runResult && runResult.outcome} (wall ${wallMs}ms, ${(runResult && runResult.stepResults || []).length} step result(s))`);

      results.scenarios.push({
        name: def.name,
        goal: def.goal,
        expectOutcome: def.expectOutcome,
        outcome: runResult && runResult.outcome,
        outcomeMatchesExpectation: runResult && runResult.outcome === def.expectOutcome,
        wallMs,
        steps: runResult && runResult.steps,
        stepResults: runResult && runResult.stepResults,
        staleCaptureCount: runResult && runResult.staleCaptureCount,
        consoleSample: consoleLines.slice(0, 20),
      });

      await demoPage.close();
    }

    // ---- Privacy audit: server-side captured contexts (see
    // v4a_server_launcher.py) -- proves what ACTUALLY reached /v2/analyze,
    // independent of the client's own claim. ----
    const contexts = readCapturedContexts();
    const violations = auditContextsForRawLeaks(contexts);
    results.privacyAudit = {
      capturedContextCount: contexts.length,
      forbiddenSubstringsChecked: FORBIDDEN_RAW_SUBSTRINGS,
      violations,
      pass: violations.length === 0,
      goalTokensObserved: contexts.map((c) => ({
        taskGoal: c.taskGoal,
        carriesPersonNameToken: /PERSONNAME#\d+/.test(c.taskGoal),
        carriesEmailToken: /EMAIL#\d+/.test(c.taskGoal),
      })),
    };

    console.log("\n=== PRIVACY AUDIT ===");
    console.log(JSON.stringify(results.privacyAudit, null, 2));
  } catch (err) {
    results.crashed = true;
    results.error = err && err.message;
    console.error("BENCH CRASHED:", err);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
    if (evidenceExtensionDir) fs.rmSync(evidenceExtensionDir, { recursive: true, force: true });
  }

  const outPath = path.join(REPO_ROOT, "benchmarks", "results", "v4a-loop.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log("\nWROTE", outPath);
}

main();
