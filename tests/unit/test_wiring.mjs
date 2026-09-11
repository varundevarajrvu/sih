// SIH 26171 -- Wiring pass unit tests.
//
// Neither element-ranker.js nor action-risk.js is modified by this pass
// (per the orchestrator's binding constraint) -- these tests exercise the
// CONSUMPTION contract content.js/action-executor.js now implement, using
// the REAL, unmodified modules:
//   1. stall-detector.js (new pure module, TASK 3) in isolation.
//   2. element-ranker.js's safety property specifically as it applies to
//      content.js's merge-then-rank ORDERING (TASK 1) -- proving both
//      that ranking BEFORE the sensitive-flag merge can silently drop a
//      would-be-sensitive node, and that ranking AFTER it (content.js's
//      actual order) never does.
//   3. action-executor.js's new guardIrreversible()/RULING #3 merge
//      behaviour (TASK 2), evaluated exactly the way
//      test_action_executor.test.mjs already does (inside a jsdom
//      window's own realm, matching how a classic content-script tag
//      gets evaluated in a real browser), fed the REAL classifyActionRisk
//      from action-risk.js.
//
// Run with: node --test tests/unit/test_wiring.mjs

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";

import { rankElements } from "../../extension/lib/element-ranker.js";
import { classifyActionRisk } from "../../extension/lib/action-risk.js";
import { actionSignature, detectStall, DEFAULT_STALL_MIN_REPEATS_BY_PERIOD } from "../../extension/lib/stall-detector.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ACTION_EXECUTOR_PATH = path.resolve(__dirname, "..", "..", "extension", "lib", "action-executor.js");
const ACTION_EXECUTOR_SRC = readFileSync(ACTION_EXECUTOR_PATH, "utf-8");

// ===========================================================================
// 1. stall-detector.js -- pure, no DOM.
// ===========================================================================
describe("stall-detector.js: actionSignature()", () => {
  test("same action/target/value -> identical signature", () => {
    const a = actionSignature({ action: "click", targetId: "agent-5", value: null });
    const b = actionSignature({ action: "click", targetId: "agent-5", value: null });
    assert.equal(a, b);
  });

  test("same action/target but DIFFERENT value -> different signature (a correction is progress, not a stall)", () => {
    const a = actionSignature({ action: "type", targetId: "agent-1", value: "Simo" });
    const b = actionSignature({ action: "type", targetId: "agent-1", value: "Simon" });
    assert.notEqual(a, b);
  });

  test("null/undefined value normalizes the same as an explicit empty string", () => {
    assert.equal(
      actionSignature({ action: "click", targetId: "agent-5", value: null }),
      actionSignature({ action: "click", targetId: "agent-5", value: undefined })
    );
  });

  test("malformed action does not throw", () => {
    assert.equal(actionSignature(null), "invalid");
    assert.equal(actionSignature(undefined), "invalid");
  });
});

describe("stall-detector.js: detectStall() -- 'the same action on the same target repeatedly'", () => {
  test("2 identical actions in a row do NOT yet count as a stall (avoids false positives on legitimate double-clicks)", () => {
    const history = [actionSignature({ action: "click", targetId: "agent-3" }), actionSignature({ action: "click", targetId: "agent-3" })];
    assert.equal(detectStall(history), null);
  });

  test("3 identical actions in a row IS a period-1 stall", () => {
    const sig = actionSignature({ action: "click", targetId: "agent-3" });
    const history = [sig, sig, sig];
    const result = detectStall(history);
    assert.ok(result, "expected a stall to be detected");
    assert.equal(result.period, 1);
    assert.equal(result.repeats, DEFAULT_STALL_MIN_REPEATS_BY_PERIOD[1]);
    assert.deepEqual(result.pattern, [sig]);
  });

  test("a run of many more than 3 identical actions still reports the SHORTEST matching period (1), not a longer coincidental one", () => {
    const sig = actionSignature({ action: "type", targetId: "agent-2", value: "x" });
    const history = Array.from({ length: 6 }, () => sig);
    const result = detectStall(history);
    assert.equal(result.period, 1);
  });
});

describe("stall-detector.js: detectStall() -- 'a cycle of states with no progress'", () => {
  test("A,B,A (one lap plus one) is NOT yet a period-2 stall", () => {
    const A = actionSignature({ action: "click", targetId: "agent-3" });
    const B = actionSignature({ action: "click", targetId: "agent-7" });
    assert.equal(detectStall([A, B, A]), null);
  });

  test("A,B,A,B (two full laps) IS a period-2 stall", () => {
    const A = actionSignature({ action: "click", targetId: "agent-3" });
    const B = actionSignature({ action: "click", targetId: "agent-7" });
    const result = detectStall([A, B, A, B]);
    assert.ok(result);
    assert.equal(result.period, 2);
    assert.deepEqual(result.pattern, [A, B]);
  });

  test("A,B,C,A,B,C (two full laps of a 3-cycle) IS a period-3 stall", () => {
    const A = actionSignature({ action: "click", targetId: "agent-1" });
    const B = actionSignature({ action: "click", targetId: "agent-2" });
    const C = actionSignature({ action: "click", targetId: "agent-3" });
    const result = detectStall([A, B, C, A, B, C]);
    assert.ok(result);
    assert.equal(result.period, 3);
  });

  test("a longer, genuinely progressing sequence (all distinct signatures) is never flagged, even with many steps", () => {
    const history = Array.from({ length: 20 }, (_, i) => actionSignature({ action: "type", targetId: `agent-${i}`, value: String(i) }));
    assert.equal(detectStall(history), null);
  });

  test("empty/short history never throws and reports no stall", () => {
    assert.equal(detectStall([]), null);
    assert.equal(detectStall(["only-one"]), null);
  });
});

// ===========================================================================
// 2. element-ranker.js consumption contract: ranking order relative to the
//    sensitive-flag merge (CLAUDE.md TIER 2's binding ruling, TASK 1).
// ===========================================================================
describe("wiring contract: rankElements() must run AFTER the sensitive-flag merge", () => {
  // A password-field-shaped node at the literal floor of every scoring
  // component (empty text -- realistic, since 2b strips sensitive text
  // before this module ever runs; generic/no bbox), surrounded by
  // high-scoring, obviously-relevant candidates on a tight budget. This
  // mirrors element-ranker.js's own "sensitive_survival" fixture in
  // shape, but is built here specifically to exercise the BEFORE/AFTER
  // merge distinction content.js's wiring depends on -- element-ranker.js
  // itself is never modified.
  function buildFixture(sensitiveFlagOnPasswordNode) {
    const passwordNode = {
      agentId: "agent-2",
      tag: "input",
      role: "textbox",
      type: "password",
      text: "",
      bbox: { x: 0, y: 0, w: 0, h: 0 },
      sensitive: sensitiveFlagOnPasswordNode,
    };
    const loudCandidates = Array.from({ length: 12 }, (_, i) => ({
      agentId: `agent-${i + 10}`,
      tag: "button",
      role: "button",
      type: "submit",
      text: "Place Order Now",
      bbox: { x: 500, y: 100 + i * 50, w: 160, h: 40 },
      sensitive: false,
    }));
    return [passwordNode, ...loudCandidates];
  }

  test("BEFORE the merge (buildDomSnapshot()'s raw sensitive:false) -- a tight budget CAN silently drop the would-be-sensitive node", () => {
    // action-executor.buildDomSnapshot() ALWAYS emits sensitive:false (by
    // design -- that module doesn't classify PII). Ranking on that raw
    // shape means element-ranker.js's own safety override has nothing to
    // act on: this node is treated as an ordinary, terrible-scoring
    // candidate like any other.
    const preMergeSnapshot = buildFixture(false);
    const result = rankElements(preMergeSnapshot, "place the order and pay now", {
      viewport: { width: 1280, height: 800 },
      maxElements: 3,
    });
    const survivedAgentIds = result.selected.map((n) => n.agentId);
    assert.equal(
      survivedAgentIds.includes("agent-2"),
      false,
      "ranking BEFORE the merge must be able to drop the would-be-sensitive node -- this is the exact failure mode the orchestrator's ordering ruling exists to prevent"
    );
  });

  test("AFTER the merge (content.js's actual order -- sensitive:true already set) -- the SAME node ALWAYS survives the SAME tight budget", () => {
    const postMergeSnapshot = buildFixture(true);
    const result = rankElements(postMergeSnapshot, "place the order and pay now", {
      viewport: { width: 1280, height: 800 },
      maxElements: 3,
    });
    const survivedAgentIds = result.selected.map((n) => n.agentId);
    assert.ok(
      survivedAgentIds.includes("agent-2"),
      "ranking AFTER the merge must retain the sensitive node unconditionally, even though it scores at the floor of every component"
    );
    // The safety override is unconditional, not merely likely: selected
    // can legitimately EXCEED maxElements when sensitive nodes are
    // budget-external, exactly as element-ranker.js's own header states.
    assert.ok(result.selected.length >= 1);
  });

  test("dropped is always reported on the payload content.js would actually send (never silently absent)", () => {
    const postMergeSnapshot = buildFixture(true);
    const result = rankElements(postMergeSnapshot, "place the order and pay now", {
      viewport: { width: 1280, height: 800 },
      maxElements: 3,
    });
    assert.equal(typeof result.dropped, "number");
    assert.equal(result.dropped, postMergeSnapshot.length - result.selected.length);
  });
});

// ===========================================================================
// 3. action-executor.js wiring: classifyActionRisk integration (TASK 2).
// Same jsdom-realm-eval harness as test_action_executor.test.mjs, fed the
// REAL classifyActionRisk from action-risk.js.
// ===========================================================================
const FIXTURE_HTML = `<!doctype html><html><body>
  <input type="password" id="pw" value="hunter2Demo!" />
  <button id="placeOrderBtn">Place Order</button>
  <button id="cancelBtn">Cancel</button>
  <button id="deletePwBtn" data-agent-sensitive="true">Delete and Pay Now</button>
</body></html>`;

function freshDom() {
  const virtualConsole = new VirtualConsole().sendTo(console, { omitJSDOMErrors: true });
  const dom = new JSDOM(FIXTURE_HTML, { url: "https://fixture.example/", runScripts: "outside-only", virtualConsole });
  dom.window.eval(ACTION_EXECUTOR_SRC);
  return dom;
}

describe("wiring contract: action-executor.js's guardIrreversible() (classifyActionRisk injected)", () => {
  let dom, window, document, AE, idMap;

  beforeEach(() => {
    dom = freshDom();
    window = dom.window;
    document = window.document;
    AE = window.ActionExecutor;
    ({ idMap } = AE.buildDomSnapshot(document));
  });

  test("a destructive-looking button ('Place Order') is blocked with IRREVERSIBLE_ACTION_BLOCKED when classifyActionRisk is wired in", () => {
    const btn = document.getElementById("placeOrderBtn");
    let clicked = false;
    btn.addEventListener("click", () => (clicked = true));

    assert.throws(
      () => AE.executeAction({ action: "click", targetId: btn.getAttribute(AE.AGENT_ID_ATTR) }, idMap, { classifyActionRisk }),
      (err) => err instanceof AE.ActionExecutionError && err.code === "IRREVERSIBLE_ACTION_BLOCKED"
    );
    assert.equal(clicked, false, "a blocked action must never dispatch the real click");
  });

  test("the SAME button is NOT blocked when classifyActionRisk is never injected (backward compatible no-op, matches every pre-existing call site)", () => {
    const btn = document.getElementById("placeOrderBtn");
    const result = AE.executeAction({ action: "click", targetId: btn.getAttribute(AE.AGENT_ID_ATTR) }, idMap /* no options */);
    assert.equal(result.ok, true);
  });

  test("a benign button ('Cancel') is never blocked even with classifyActionRisk wired in", () => {
    const btn = document.getElementById("cancelBtn");
    const result = AE.executeAction({ action: "click", targetId: btn.getAttribute(AE.AGENT_ID_ATTR) }, idMap, { classifyActionRisk });
    assert.equal(result.ok, true);
  });

  test("override hook: options.onIrreversibleAction returning true explicitly authorizes the click", () => {
    const btn = document.getElementById("placeOrderBtn");
    let hookCalledWith = null;
    const result = AE.executeAction({ action: "click", targetId: btn.getAttribute(AE.AGENT_ID_ATTR) }, idMap, {
      classifyActionRisk,
      onIrreversibleAction: (el, actionJson, riskResult) => {
        hookCalledWith = { targetId: actionJson.targetId, risk: riskResult.risk };
        return true;
      },
    });
    assert.equal(result.ok, true);
    assert.ok(hookCalledWith, "onIrreversibleAction must have been called");
    assert.equal(hookCalledWith.risk, "irreversible");
  });

  test("override hook: options.onIrreversibleAction returning false still blocks (per-call re-block)", () => {
    const btn = document.getElementById("placeOrderBtn");
    assert.throws(
      () =>
        AE.executeAction({ action: "click", targetId: btn.getAttribute(AE.AGENT_ID_ATTR) }, idMap, {
          classifyActionRisk,
          onIrreversibleAction: () => false,
        }),
      (err) => err.code === "IRREVERSIBLE_ACTION_BLOCKED"
    );
  });

  test("explicit options.allowIrreversibleActions=true overrides the default block", () => {
    const btn = document.getElementById("placeOrderBtn");
    const result = AE.executeAction({ action: "click", targetId: btn.getAttribute(AE.AGENT_ID_ATTR) }, idMap, {
      classifyActionRisk,
      allowIrreversibleActions: true,
    });
    assert.equal(result.ok, true);
  });

  test("scroll/done are NOT gated by the irreversible guard (only click/type write to or trigger the page)", () => {
    const btn = document.getElementById("placeOrderBtn");
    const result = AE.executeAction({ action: "scroll", targetId: btn.getAttribute(AE.AGENT_ID_ATTR) }, idMap, {
      classifyActionRisk,
      scrollElementIntoView: () => {},
    });
    assert.equal(result.ok, true);
  });
});

describe("wiring contract: RULING #3 -- guardSensitive() runs FIRST; when BOTH trip, report SENSITIVE_TARGET_BLOCKED with reasons from both", () => {
  let dom, window, document, AE, idMap;

  beforeEach(() => {
    dom = freshDom();
    window = dom.window;
    document = window.document;
    AE = window.ActionExecutor;
    ({ idMap } = AE.buildDomSnapshot(document));
  });

  test("an element flagged BOTH sensitive AND irreversible reports SENSITIVE_TARGET_BLOCKED, not IRREVERSIBLE_ACTION_BLOCKED", () => {
    // #deletePwBtn carries data-agent-sensitive="true" in the fixture AND
    // its own text ("Delete and Pay Now") matches this project's
    // destructive-intent phrase list ("delete", "pay now") -- engineered
    // to trip BOTH guards on the same element+action.
    const btn = document.getElementById("deletePwBtn");
    assert.throws(
      () => AE.executeAction({ action: "click", targetId: btn.getAttribute(AE.AGENT_ID_ATTR) }, idMap, { classifyActionRisk }),
      (err) => {
        assert.ok(err instanceof AE.ActionExecutionError);
        assert.equal(err.code, "SENSITIVE_TARGET_BLOCKED", "the more specific/core guard must win the reported code");
        assert.match(err.message, /ALSO matches irreversible-action signal/, "the refusal must explain itself with both sets of reasons, not just say no");
        assert.match(err.message, /delete|pay now/i);
        return true;
      }
    );
  });

  test("the SAME element, sensitive-only (classifyActionRisk not injected), reports the ORIGINAL byte-for-byte message (no regression)", () => {
    const btn = document.getElementById("deletePwBtn");
    assert.throws(
      () => AE.executeAction({ action: "click", targetId: btn.getAttribute(AE.AGENT_ID_ATTR) }, idMap /* classifyActionRisk NOT passed */),
      (err) => {
        assert.equal(err.code, "SENSITIVE_TARGET_BLOCKED");
        assert.equal(
          err.message,
          "action blocked: target element is flagged sensitive (data-agent-sensitive or sensitiveAgentIds). " +
            "Acting on it is a policy decision this module will not make silently -- pass " +
            "options.allowSensitiveTargets=true or an options.onSensitiveTarget(el, actionJson) hook that " +
            "returns true to explicitly authorize it.",
          "pre-existing SENSITIVE_TARGET_BLOCKED message must be unchanged when action-risk.js isn't wired at this call site"
        );
        return true;
      }
    );
  });

  test("overriding the sensitive block (allowSensitiveTargets) still runs the independent irreversible guard afterward", () => {
    const btn = document.getElementById("deletePwBtn");
    assert.throws(
      () =>
        AE.executeAction({ action: "click", targetId: btn.getAttribute(AE.AGENT_ID_ATTR) }, idMap, {
          classifyActionRisk,
          allowSensitiveTargets: true, // sensitive guard passes...
          // ...but the irreversible guard is a SEPARATE, still-active policy.
        }),
      (err) => err.code === "IRREVERSIBLE_ACTION_BLOCKED"
    );
  });
});

// Sanity: confirm this file is actually exercising the plain-Node import
// path (not eval'd inside jsdom), so classifyActionRisk is a genuine
// cross-realm function reference passed into the jsdom-eval'd
// action-executor.js -- exactly how content.js's dynamic import() feeds it
// to action-executor.js in the real extension.
test("classifyActionRisk imported here is the real action-risk.js export, not a stand-in", () => {
  const result = classifyActionRisk({ text: "Buy Now" }, { action: "click", targetId: "x" });
  assert.equal(result.risk, "irreversible");
});
