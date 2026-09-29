// SIH 26171 v2 rebuild -- Phase V4b (integration-v2, part B) -- browser
// evidence run. Same pattern as benchmarks/v4a-loop-bench.mjs (reused
// deliberately) extended to scenarios 1-7 and driven through the REAL
// consent panel (popup.js) for S2/S3/S7, instead of window.confirm()
// dialogs (V4a's now-removed stopgap).
//
// Talks to a REAL /v2/analyze on :8000 (benchmarks/v4b_server_launcher.py's
// ScenarioVLMClientV4b) and a REAL NER service on :8757. Loads the REAL
// unpacked extension (scratch copy, host_permissions widened to <all_urls>
// for chrome.tabs.captureVisibleTab ONLY -- see prepareEvidenceOnlyExtensionCopy()).
//
// PORT NOTE: port 5501 (v1's documented cross-origin port) was occupied by a
// pre-existing process this run did not start (a stray python.exe found
// listening there before this bench ever ran) -- per this phase's own
// instruction ("never kill a process you did not start; if a port is busy,
// use a different one and say so"), S5's cross-origin server runs on 5511
// instead. Reported here in the file header, not silently.
//
// Run with:
//   NODE_PATH="<repo>/spikes/ultraface/node_modules" node benchmarks/v4b-loop-bench.mjs

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
const XORIGIN_PORT = 5511; // see file header PORT NOTE

// V4b follow-up: the vault profile seeded for the profile-autofill scenario.
// getProfile()/setProfile() (extension/lib/profile-vault.js) read/write
// chrome.storage.local["agentProfile"] -- seeded directly here (not through
// the popup's own Save Profile button) since Playwright already drives the
// popup for everything else and this is the same storage key either way.
const VAULT_PROFILE = { full_name: "Asha Rao", email: "asha.vault@example.com", phone: "9876500000" };

// Every raw substring that must NEVER appear in any captured server-side
// body across S1-S7's own fixture values (demo/test-page.html's pw/email/
// Aadhaar, S6's shipping name/address, S2's password-ask, S7's dedicated
// email fixture, S3's name+email) PLUS the vault profile above (profile-
// autofill's own invariant: a PROFILE...# token rehydrates locally, the raw
// vault value must never reach any request body).
const FORBIDDEN_RAW_SUBSTRINGS = [
  "hunter2Demo!",
  "alice.demo@example.com",
  "1234 5678 9012",
  "Simon",
  "River Jane",
  "riverjane33@demo.com",
  "Meera Iyer",
  "14 MG Road",
  "411001",
  "priya.demo@example.com",
  VAULT_PROFILE.full_name,
  VAULT_PROFILE.email,
  VAULT_PROFILE.phone,
];

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function prepareEvidenceOnlyExtensionCopy() {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "v4b-loop-bench-ext-"));
  fs.cpSync(REAL_EXTENSION_PATH, dest, { recursive: true });
  const manifestPath = path.join(dest, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  if (!manifest.host_permissions.includes("<all_urls>")) {
    manifest.host_permissions.push("<all_urls>");
  }
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
  // Belt-and-braces -- v2 is already the documented default
  // (pipeline-version.js's DEFAULT_PIPELINE_VERSION), but this evidence run
  // must never silently run v1 if that default is ever changed underneath it.
  return page.evaluate(() => chrome.storage.local.set({ pipelineVersion: "v2" }));
}
async function setProfileVault(page, profile) {
  return page.evaluate((p) => chrome.storage.local.set({ agentProfile: p }), profile);
}
function runAgentLoop(page) {
  // Deliberately NOT awaited by the caller immediately -- S7 needs to click
  // the consent panel WHILE this is in flight (see runScenario() below).
  return page.evaluate(() => new Promise((resolve) => chrome.runtime.sendMessage({ type: "RUN_AGENT_LOOP" }, resolve)));
}

function readCapturedContexts() {
  const p = path.join(REPO_ROOT, "benchmarks", "results", "v4b-captured-contexts.jsonl");
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf-8").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
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
  bench: "v4b-loop",
  phase: "V4b integration-v2 (part B)",
  date: new Date().toISOString(),
  machine: {},
  portNote: `port 5501 was occupied by a pre-existing, non-bench process; the cross-origin server for S5 ran on ${XORIGIN_PORT} instead.`,
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

  const capturePath = path.join(REPO_ROOT, "benchmarks", "results", "v4b-captured-contexts.jsonl");
  fs.mkdirSync(path.dirname(capturePath), { recursive: true });
  fs.writeFileSync(capturePath, "");

  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "v4b-loop-bench-"));
  evidenceExtensionDir = prepareEvidenceOnlyExtensionCopy();
  results.notes.push(
    "captureVisibleTab requires <all_urls> or a real activeTab gesture; this run drives a SCRATCH COPY of the " +
      "extension with host_permissions widened to <all_urls> for capture only. extension/manifest.json (the " +
      "shipping product) is untouched."
  );

  console.log("launching persistent context with EVIDENCE-ONLY extension copy:", evidenceExtensionDir);
  const context = await withTimeout(
    chromium.launchPersistentContext(userDataDir, {
      headless: false,
      viewport: null, // see v4a-loop-bench.mjs's own comment on why -- CDP's default viewport override desyncs captureVisibleTab from window.innerWidth
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
    await withTimeout(driverPage.goto(`chrome-extension://${extensionId}/popup.html`), 15000, "goto popup.html");
    await setPipelineVersion(driverPage);
    await setProfileVault(driverPage, VAULT_PROFILE);
    console.log("driver page (popup.html) loaded, pipelineVersion=v2, vault seeded");

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
      { name: "S1_fill_name", goal: "fill the name as Simon", url: "http://localhost:5500/test-page.html", expectOutcome: "done" },
      { name: "S2_password_ask_denied", goal: "Fill in the password field with the value hunter2", url: "http://localhost:5500/test-page.html", expectOutcome: "blocked", consent: "deny" },
      {
        name: "S3_name_and_email_ask_denied",
        goal: "Fill the name as River Jane and email id as riverjane33@demo.com",
        url: "http://localhost:5500/test-page.html",
        expectOutcome: "blocked",
        consent: "deny",
      },
      {
        // V4b follow-up (checkpoint gap): S4, the checkout/IRREVERSIBLE_ACTION
        // leg -- same page family as v1's own scenario 4, ported to v2's
        // ask-then-consent flow instead of a hard client-side block.
        name: "S4_checkout_irreversible_denied",
        goal: "Complete the checkout by clicking Place Order",
        url: "http://localhost:5500/test-page.html?scenario=checkout",
        expectOutcome: "blocked",
        consent: "deny",
      },
      {
        name: "S5_subframe_shadow_parity",
        goal: "fill the traveler name",
        url: `http://localhost:5500/frames-test.html?xorigin=1&xoriginPort=${XORIGIN_PORT}`,
        expectOutcome: "done",
      },
      {
        name: "S6_shipping_address_tokens",
        goal: "Ship to Meera Iyer, 14 MG Road, Pune 411001",
        url: "http://localhost:5500/test-page.html?scenario=shipping",
        expectOutcome: "done",
      },
      {
        name: "S7_consent_approve",
        goal: "type priya.demo@example.com into the email field",
        url: "http://localhost:5500/test-page.html",
        expectOutcome: "done",
        consent: "approve",
      },
      {
        name: "S7_consent_deny",
        goal: "type priya.demo@example.com into the email field",
        url: "http://localhost:5500/test-page.html",
        expectOutcome: "blocked",
        consent: "deny",
      },
      {
        // V4b follow-up (checkpoint gap): profile autofill. fill_profile is
        // EXEMPT from guardSensitive() by design (extension/lib/action-
        // executor.js's carve-out -- the model never supplies the value, so
        // there is nothing to guard against), so this never opens the
        // consent panel; the invariant under test is purely "no raw vault
        // value in any request body", proven via the forbidden-substring
        // audit against VAULT_PROFILE above.
        name: "ProfileAutofill_fill_all_details",
        goal: "fill all my details",
        url: "http://localhost:5500/test-page.html",
        expectOutcome: "done",
      },
      {
        // C5/C2 amendment (2026-09-26): the goal-ask row. "Fill in my full
        // name" is the amendment's OWN worked example of NER swallowing an
        // entire plain instruction as an ask-band PERSONNAME span (score
        // ~0.427) -- the goalPrivacyPanel must open before step 1, and
        // clicking "Not private" must send the instruction back to the
        // server exactly as written (no PERSONNAME#n token at all).
        name: "GoalAskBand_not_private",
        goal: "Fill in my full name",
        url: "http://localhost:5500/test-page.html",
        expectOutcome: "done",
        goalPrivacy: "notPrivate",
      },
    ];

    for (const def of scenarioDefs) {
      console.log(`\n=== ${def.name}: "${def.goal}" ===`);
      const demoPage = await context.newPage();
      await withTimeout(demoPage.goto(def.url, { waitUntil: "load" }), 15000, `goto ${def.url}`);
      await demoPage.waitForTimeout(500); // let content.js (document_idle) + FRAME_HELLO settle

      const consoleLines = [];
      demoPage.on("console", (msg) => {
        const text = msg.text();
        if (text.includes("[agent-loop") || text.includes("RUN SUMMARY")) consoleLines.push(text);
      });

      await setTaskGoal(driverPage, def.goal);
      await demoPage.bringToFront();

      const t0 = Date.now();
      const runPromise = runAgentLoop(driverPage);

      let consentAction = null;
      if (def.consent) {
        try {
          await withTimeout(
            driverPage.waitForSelector("#consentPanel:not([hidden])", { timeout: 20000 }),
            21000,
            `${def.name}: waiting for consent panel`
          );
          consentAction = def.consent;
          console.log(`  consent panel opened -- clicking ${def.consent === "approve" ? "Approve" : "Deny"}`);
          await driverPage.click(def.consent === "approve" ? "#consentApprove" : "#consentDeny");
        } catch (err) {
          consentAction = `FAILED_TO_OPEN: ${err.message}`;
          console.log(`  WARNING: consent panel never opened for ${def.name}: ${err.message}`);
        }
      }

      // C5/C2 amendment: the goal ask-band privacy review panel -- a
      // SEPARATE panel/selector from the consent panel above (see
      // popup.html/popup.js's own amendment comments for why).
      let goalPrivacyAction = null;
      if (def.goalPrivacy) {
        try {
          await withTimeout(
            driverPage.waitForSelector("#goalPrivacyPanel:not([hidden])", { timeout: 20000 }),
            21000,
            `${def.name}: waiting for goal-privacy-review panel`
          );
          goalPrivacyAction = def.goalPrivacy;
          const btnSelector = def.goalPrivacy === "notPrivate" ? "#goalPrivacyNotPrivate" : "#goalPrivacyKeepPrivate";
          console.log(`  goal-privacy-review panel opened -- clicking ${def.goalPrivacy === "notPrivate" ? "Not private" : "Keep private"}`);
          await driverPage.click(btnSelector);
        } catch (err) {
          goalPrivacyAction = `FAILED_TO_OPEN: ${err.message}`;
          console.log(`  WARNING: goal-privacy-review panel never opened for ${def.name}: ${err.message}`);
        }
      }

      const runResult = await withTimeout(runPromise, 90000, `RUN_AGENT_LOOP (${def.name})`);
      const wallMs = Date.now() - t0;

      console.log(`outcome: ${runResult && runResult.outcome} (wall ${wallMs}ms, ${(runResult && runResult.stepResults || []).length} step result(s))`);

      results.scenarios.push({
        name: def.name,
        goal: def.goal,
        expectOutcome: def.expectOutcome,
        outcome: runResult && runResult.outcome,
        outcomeMatchesExpectation: runResult && runResult.outcome === def.expectOutcome,
        consentAction,
        goalPrivacyAction,
        wallMs,
        steps: runResult && runResult.steps,
        stepResults: runResult && runResult.stepResults,
        staleCaptureCount: runResult && runResult.staleCaptureCount,
        consoleSample: consoleLines.slice(0, 20),
      });

      await demoPage.close();
    }

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
        carriesAddressToken: /ADDRESS#\d+/.test(c.taskGoal),
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

  const outPath = path.join(REPO_ROOT, "benchmarks", "results", "v4b-loop.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log("\nWROTE", outPath);
}

main();
