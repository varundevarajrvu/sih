// SIH 26171 v2 rebuild -- Phase V4b (integration-v2, part B).
//
// DEFENCE-IN-DEPTH tests for the two-layer guard the orchestrator restored
// in agent-loop-v2.js (docs/v2/ARCHITECTURE.md's Phase-results entry for
// V4a integration (loop): "action-executor's v1 guards yield only to
// `approvedByConsent`"). Two INDEPENDENT layers must both agree before a
// sensitive/irreversible action ever touches the real DOM:
//
//   1. C4's policy.js decide()/tightenWithServer() -- computed from the
//      C5 SCENE (elements[].sensitive, tier), which is only as good as
//      this step's scan.
//   2. action-executor.js's OWN guardSensitive()/guardIrreversible() --
//      computed from the LIVE DOM element (data-agent-sensitive attribute /
//      sensitiveAgentIds, and classifyActionRisk() against the live
//      element's own text/value/attributes), independent of whatever the
//      scene said.
//
// agent-loop-v2.js wires layer 2's override hooks to `() => approvedByConsent`
// (see that file's own ORCHESTRATOR RULING comment at the io.executeAction
// call site) -- so layer 2 ALWAYS runs, and only an explicit human consent
// answer (never a bare policy "accept") can make it stand aside.
//
// Unlike tests/unit/test_agent_loop_v2.mjs (which fakes io.executeAction
// entirely), these tests wire a REAL action-executor.js -- evaluated
// inside a real jsdom window's realm, exactly like
// tests/unit/test_action_executor.test.mjs/test_wiring.mjs already do --
// so "never executed" is verified against an ACTUAL DOM element's `.value`
// staying untouched, not just against a call-count on a mock.
//
// Run with: node --test tests/unit/test_v4b_defense_in_depth.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";

import { runAgentLoopV2, PAGE_TARGET_ID_V2 } from "../../extension/lib/agent-loop-v2.js";
import { classifyActionRisk } from "../../extension/lib/action-risk.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ACTION_EXECUTOR_PATH = path.resolve(__dirname, "..", "..", "extension", "lib", "action-executor.js");
const ACTION_EXECUTOR_SRC = readFileSync(ACTION_EXECUTOR_PATH, "utf-8");

const FIXTURE_HTML = `<!doctype html><html><body>
  <input id="name" type="text" />
  <input id="pw" type="password" value="hunter2Demo!" />
  <button id="placeOrder" type="button">Place Order</button>
</body></html>`;

function freshDom() {
  const virtualConsole = new VirtualConsole().sendTo(console, { omitJSDOMErrors: true });
  const dom = new JSDOM(FIXTURE_HTML, { url: "https://fixture.example/", runScripts: "outside-only", virtualConsole });
  dom.window.eval(ACTION_EXECUTOR_SRC);
  return dom;
}

/**
 * Builds a real domSnapshot/idMap via the jsdom-realm ActionExecutor, and
 * a runAgentLoopV2-compatible io whose executeAction/scanDom are backed by
 * that SAME real DOM -- everything else (nerCall, sendAnalyze, requestConsent)
 * is a caller-supplied fake, same shape as test_agent_loop_v2.mjs's baseIo().
 */
function buildRealDomIo(dom, overrides = {}) {
  const AE = dom.window.ActionExecutor;
  const { domSnapshot, idMap } = AE.buildDomSnapshot(dom.window.document);

  return {
    getTaskGoal: async () => "fill the name field",
    getProfile: async () => ({ full_name: "", email: "demo@example.com", phone: "" }),
    getViewport: () => ({ width: 1280, height: 800, devicePixelRatio: 1 }),
    newRevision: (() => {
      let n = 0;
      return () => `rev-${++n}`;
    })(),
    now: () => 0,
    sleep: async () => {},
    isAborted: () => false,
    reportProgress: () => {},
    capture: async () => ({ screenshotBase64: "AAAA", screenshotWidthPx: 1280, screenshotHeightPx: 800, screenshotHash: "h1", captureMs: 1 }),
    detect: async () => ({ boxes: [], detectMs: 1 }),
    scanDom: async () => ({
      domSnapshot: domSnapshot.map((n) => ({ ...n })),
      idMap,
      sensitiveNodes: [],
      unscannableRegions: [],
    }),
    nerCall: async (texts) => texts.map(() => []), // no PII detected -- keeps this test focused on the guard layers, not tokenization
    executeAction: (action, map, opts) =>
      AE.executeAction(action, map, { ...opts, classifyActionRisk }),
    requestConsent: async () => false,
    redact: async () => ({ redactedImage: "R", redactedRegions: [] }),
    getLiveSensitiveRawValues: () => [],
    getProfileValue: () => null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// (a) policy accept + v1 guard flags sensitive -> refused, never executed.
// ---------------------------------------------------------------------------
test("(a) policy computes accept (scene never flagged the target sensitive), but the LIVE DOM element carries data-agent-sensitive -- action-executor's own guard refuses it anyway, real value never written", async () => {
  const dom = freshDom();
  const pwEl = dom.window.document.getElementById("pw");
  // Simulate the live-DOM sensitivity marker existing independently of
  // THIS step's scan pipeline (e.g. a prior step's scan flagged it, or a
  // scan-side gap) -- content.js's production wiring sets this exact
  // attribute from `sensitiveNodes` (runAgentLoop()'s
  // `el.setAttribute(ActionExecutor.SENSITIVE_ATTR, "true")`); this test
  // sets it directly to isolate "does layer 2 fire independent of layer 1"
  // without needing to reproduce a specific scan bug.
  pwEl.setAttribute("data-agent-sensitive", "true");

  const io = buildRealDomIo(dom, {
    sendAnalyze: async (payload) => ({
      ok: true,
      body: { action: "type", targetId: "agent-2", value: "some-non-pii-text", revision: payload.revision, serverVerdict: "accept" },
    }),
  });

  const result = await runAgentLoopV2(io);

  // Layer 1 (policy.js) never fired -- element.sensitive was false in the
  // C5 scene (this step's sensitiveNodes was empty), so decide()/
  // tightenWithServer() computed "accept", not "ask"/"reject". Confirmed
  // indirectly: outcome is "act_failed" (a THROW from executeAction,
  // caught by the loop's generic catch -- see agent-loop-v2.js), never
  // "blocked"/"rejected" (which are policy's OWN refusal outcomes and
  // would mean layer 1, not layer 2, was what fired).
  assert.equal(result.outcome, "act_failed");
  const errorStep = result.stepResults.find((r) => r.error);
  assert.ok(errorStep, "the executeAction throw must be captured in stepResults");
  assert.equal(errorStep.code, "SENSITIVE_TARGET_BLOCKED", "layer 2 (action-executor's own guard) must be what refused this");

  // "never executed" -- proven against the REAL DOM, not a call count.
  assert.equal(pwEl.value, "hunter2Demo!", "the live element's value must be COMPLETELY UNCHANGED -- the guard must have fired before any write");
});

// ---------------------------------------------------------------------------
// (b) ask + approved -> executed (both layers agree, via explicit consent).
// ---------------------------------------------------------------------------
test("(b) SENSITIVE_TARGET ask, approved via consent -> both layers agree, the REAL DOM element is actually written", async () => {
  const dom = freshDom();
  const pwEl = dom.window.document.getElementById("pw");
  pwEl.setAttribute("data-agent-sensitive", "true");

  const io = buildRealDomIo(dom, {
    // This time layer 1 (policy.js) DOES see it as sensitive -- the scan
    // pipeline agrees with the live DOM marker, matching production.
    scanDom: async () => {
      const { domSnapshot, idMap } = dom.window.ActionExecutor.buildDomSnapshot(dom.window.document);
      return {
        domSnapshot,
        idMap,
        sensitiveNodes: [{ selector: "#pw", bbox: { x: 0, y: 0, w: 0, h: 0 }, piiType: "password", agentId: "agent-2" }],
        unscannableRegions: [],
      };
    },
    sendAnalyze: (() => {
      let step = 0;
      return async (payload) => {
        step++;
        if (step === 1) {
          return { ok: true, body: { action: "type", targetId: "agent-2", value: "PROFILEEMAIL#1", revision: payload.revision, serverVerdict: "ask" } };
        }
        return { ok: true, body: { action: "done", targetId: PAGE_TARGET_ID_V2, value: null, revision: payload.revision, serverVerdict: "accept" } };
      };
    })(),
    requestConsent: async () => true, // the human approves
  });

  const result = await runAgentLoopV2(io);

  assert.equal(result.outcome, "done", "no more actionable elements after the write -- the run completes cleanly");
  // The REHYDRATED vault value actually landed in the live DOM.
  assert.equal(pwEl.value, "demo@example.com", "an explicitly approved action must actually execute against the real element");
});

// ---------------------------------------------------------------------------
// (c) ask + denied -> SENSITIVE_TARGET_BLOCKED, never executed (real DOM).
// ---------------------------------------------------------------------------
test("(c) SENSITIVE_TARGET ask, denied -> SENSITIVE_TARGET_BLOCKED, the real DOM element is never touched", async () => {
  const dom = freshDom();
  const pwEl = dom.window.document.getElementById("pw");
  pwEl.setAttribute("data-agent-sensitive", "true");

  const io = buildRealDomIo(dom, {
    scanDom: async () => {
      const { domSnapshot, idMap } = dom.window.ActionExecutor.buildDomSnapshot(dom.window.document);
      return {
        domSnapshot,
        idMap,
        sensitiveNodes: [{ selector: "#pw", bbox: { x: 0, y: 0, w: 0, h: 0 }, piiType: "password", agentId: "agent-2" }],
        unscannableRegions: [],
      };
    },
    sendAnalyze: async (payload) => ({
      ok: true,
      body: { action: "type", targetId: "agent-2", value: "anything", revision: payload.revision, serverVerdict: "accept" },
    }),
    requestConsent: async () => false, // denied (or, equivalently from this module's view, background.js's 60s timeout default)
  });

  const result = await runAgentLoopV2(io);

  assert.equal(result.outcome, "blocked");
  const blocked = result.stepResults.find((r) => r.blocked);
  assert.equal(blocked.blocked, "SENSITIVE_TARGET_BLOCKED");
  // The loop's own consent-denied branch breaks BEFORE ever calling
  // io.executeAction() (agent-loop-v2.js: "a denied sensitive-target
  // action must never reach executeAction") -- confirmed here against the
  // REAL element, closing the gap a fake-executeAction test structurally
  // cannot: the value was never written, full stop.
  assert.equal(pwEl.value, "hunter2Demo!");
});

// ---------------------------------------------------------------------------
// (c), the IRREVERSIBLE_ACTION_BLOCKED variant -- same shape, different
// guard and different real element (a destructive-intent button, not a
// PII field), proving the SAME defence-in-depth property holds for
// action-risk.js's guard, not only dom-scanner-sourced sensitivity.
// ---------------------------------------------------------------------------
test("(c variant) IRREVERSIBLE_ACTION ask, denied -> IRREVERSIBLE_ACTION_BLOCKED, the real button is never clicked", async () => {
  const dom = freshDom();
  const placeOrderBtn = dom.window.document.getElementById("placeOrder");
  let clicked = false;
  placeOrderBtn.addEventListener("click", () => {
    clicked = true;
  });

  const io = buildRealDomIo(dom, {
    getTaskGoal: async () => "complete the checkout by clicking Place Order",
    sendAnalyze: async (payload) => ({
      ok: true,
      body: { action: "click", targetId: "agent-3", value: null, revision: payload.revision, serverVerdict: "accept" },
    }),
    requestConsent: async () => false,
  });

  const result = await runAgentLoopV2(io);

  assert.equal(result.outcome, "blocked");
  const blocked = result.stepResults.find((r) => r.blocked);
  assert.equal(blocked.blocked, "IRREVERSIBLE_ACTION_BLOCKED");
  assert.equal(clicked, false, "the button's real click handler must never fire once the guard refuses the action");
});
