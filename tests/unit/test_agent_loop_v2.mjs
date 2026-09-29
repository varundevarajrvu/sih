// SIH 26171 v2 rebuild -- Phase V4a (integration-v2).
// Unit tests for extension/lib/agent-loop-v2.js's runAgentLoopV2(), driven
// entirely by hand-written fakes for every io.* injection point -- no
// browser, no chrome.*, no network, no real NER model. This is what "pure
// orchestration with injected I/O ... unit-test it with fakes" (CLAUDE.md's
// V4a brief) means concretely: every fake below stands in for one of
// capture/scan/detect/ner/send/execute plus consent/redact/profile/revision.

import test from "node:test";
import assert from "node:assert/strict";

import {
  runAgentLoopV2,
  assertEgressV2,
  EgressAssertionError,
  NerUnavailableError,
  PAGE_TARGET_ID_V2,
} from "../../extension/lib/agent-loop-v2.js";

// ---------------------------------------------------------------------------
// Fake NER: recognizes a small fixed dictionary of PERSONNAME-shaped words
// (mirrors what the real GLiNER service does for an imperative "fill the
// name as X" sentence -- see docs/v2/ARCHITECTURE.md's V1b probe numbers),
// everything else -> no spans. Deliberately dumb/deterministic, matching
// this project's own "the mock is a stand-in for behavior, not for
// language understanding" philosophy (server/vlm_client.py's
// MockVLMClient docstring).
// ---------------------------------------------------------------------------
const NAME_DICTIONARY = new Set(["Simon", "River", "Jane"]);

function fakeNerCall(texts) {
  return Promise.resolve(
    texts.map((text) => {
      const spans = [];
      const re = /\b[A-Z][a-z]+\b/g;
      let m;
      while ((m = re.exec(text))) {
        if (NAME_DICTIONARY.has(m[0])) {
          spans.push({ start: m.index, end: m.index + m[0].length, label: "PERSONNAME", score: 0.47, source: "ner" });
        }
      }
      return spans;
    })
  );
}

function unavailableNerCall() {
  return Promise.reject(new NerUnavailableError("ECONNREFUSED 127.0.0.1:8757 (fake)"));
}

// ---------------------------------------------------------------------------
// Fixture domSnapshot: one plain text "full name" field, one sensitive
// password field -- mirrors demo/test-page.html's own shape closely enough
// to exercise both the accept path and the sensitive-ask path.
// ---------------------------------------------------------------------------
function buildScan({ nameValue = "", sensitiveNodes } = {}) {
  const domSnapshot = [
    { agentId: "agent-1", tag: "input", role: null, type: "text", text: nameValue, bbox: { x: 10, y: 10, w: 100, h: 20 }, sensitive: false },
    { agentId: "agent-2", tag: "input", role: null, type: "password", text: "", bbox: { x: 10, y: 40, w: 100, h: 20 }, sensitive: false },
  ];
  const idMap = new Map([
    ["agent-1", { fakeEl: "name-input" }],
    ["agent-2", { fakeEl: "password-input" }],
  ]);
  return {
    domSnapshot,
    idMap,
    sensitiveNodes: sensitiveNodes || [{ selector: "#pw", bbox: { x: 10, y: 40, w: 100, h: 20 }, piiType: "password", agentId: "agent-2" }],
    unscannableRegions: [],
  };
}

function baseIo(overrides = {}) {
  return {
    getTaskGoal: async () => "fill the name as Simon",
    getProfile: async () => ({ full_name: "", email: "", phone: "" }),
    getViewport: () => ({ width: 1280, height: 800, devicePixelRatio: 1 }),
    newRevision: (() => {
      let n = 0;
      return () => `rev-${++n}`;
    })(),
    now: () => 0,
    sleep: async () => {},
    isAborted: () => false,
    reportProgress: () => {},
    capture: async () => ({ screenshotBase64: "AAAA", screenshotWidthPx: 1280, screenshotHeightPx: 800, screenshotHash: "hash-1", captureMs: 5 }),
    detect: async () => ({ boxes: [], detectMs: 1 }),
    scanDom: async () => buildScan(),
    nerCall: fakeNerCall,
    sendAnalyze: async () => ({ ok: true, body: { action: "done", targetId: PAGE_TARGET_ID_V2, revision: "rev-1", serverVerdict: "accept", value: null } }),
    executeAction: async () => ({ ok: true }),
    requestConsent: async () => false,
    redact: async () => ({ redactedImage: "REDACTED_BASE64", redactedRegions: [] }),
    getLiveSensitiveRawValues: () => [],
    getProfileValue: () => null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Full accept flow: type a token from the tokenized taskGoal, rehydrate
//    it, execute -- then a second step returns "done".
// ---------------------------------------------------------------------------
test("accept flow: taskGoal token is rehydrated and the raw value reaches executeAction, never the server payload", async () => {
  let step = 0;
  const executeCalls = [];
  const sendCalls = [];

  const io = baseIo({
    executeAction: async (action) => {
      executeCalls.push(action);
      return { ok: true };
    },
    sendAnalyze: async (payload) => {
      sendCalls.push(payload);
      step++;
      if (step === 1) {
        // Server should only ever be able to name the TOKEN, never "Simon" --
        // the mock/planner literally cannot know the raw value.
        const goalToken = payload.taskGoal.match(/PERSONNAME#\d+/)[0];
        return { ok: true, body: { action: "type", targetId: "agent-1", value: goalToken, revision: payload.revision, serverVerdict: "accept" } };
      }
      return { ok: true, body: { action: "done", targetId: PAGE_TARGET_ID_V2, revision: payload.revision, serverVerdict: "accept", value: null } };
    },
  });

  const result = await runAgentLoopV2(io);

  assert.equal(result.outcome, "done");
  // C4 amendment (2026-09-28): this goal ("fill the name as Simon") has one
  // value token and no click intent, so once step 1 types it the loop ends
  // the run itself with GOAL_TOKENS_COMPLETE -- the planner is never asked
  // again. Previously this test expected a second planner call answering
  // "done"; that step no longer happens, by design.
  assert.equal(executeCalls.length, 1);
  assert.equal(sendCalls.length, 1, "no second planner call once the goal's tokens are all typed");
  assert.equal(executeCalls[0].action, "type");
  assert.equal(executeCalls[0].targetId, "agent-1");
  assert.equal(executeCalls[0].value, "Simon", "the DOM must receive the REHYDRATED raw value");
  assert.equal(result.stepResults[0].code, "GOAL_TOKENS_COMPLETE");

  // Every payload actually sent over the wire must be free of "Simon" and
  // must instead carry the token.
  for (const payload of sendCalls) {
    const payloadStr = JSON.stringify(payload);
    assert.ok(!payloadStr.includes("Simon"), "raw name must never appear in a sent payload");
  }
  assert.ok(sendCalls[0].taskGoal.includes("PERSONNAME#1"), "taskGoal must carry the token");
});

// ---------------------------------------------------------------------------
// 2. NER unavailable -- C3: the run stops, no regex-only fallback, and no
//    /v2/analyze send is ever attempted for that step.
// ---------------------------------------------------------------------------
test("NER unavailable stops the run (C3) before any send is attempted", async () => {
  let sendCalled = false;
  const io = baseIo({
    nerCall: unavailableNerCall,
    sendAnalyze: async (payload) => {
      sendCalled = true;
      return { ok: true, body: { action: "done", targetId: PAGE_TARGET_ID_V2, revision: payload.revision, serverVerdict: "accept" } };
    },
  });

  const result = await runAgentLoopV2(io);
  assert.equal(result.outcome, "ner_unavailable");
  assert.equal(sendCalled, false, "no request may leave the client when NER is down");
});

// ---------------------------------------------------------------------------
// 3. SENSITIVE_TARGET ask, denied by timeout-default consent -> v1-style
//    SENSITIVE_TARGET_BLOCKED outcome, run ends (v1 semantics).
// ---------------------------------------------------------------------------
test("sensitive target ask, denied -> SENSITIVE_TARGET_BLOCKED, run ends", async () => {
  const executeCalls = [];
  const io = baseIo({
    executeAction: async (action) => {
      executeCalls.push(action);
      return { ok: true };
    },
    sendAnalyze: async (payload) => ({
      ok: true,
      body: { action: "type", targetId: "agent-2", value: "anything", revision: payload.revision, serverVerdict: "accept" },
    }),
    requestConsent: async () => false, // deny / timeout default
  });

  const result = await runAgentLoopV2(io);
  assert.equal(result.outcome, "blocked");
  assert.equal(executeCalls.length, 0, "a denied sensitive-target action must never reach executeAction");
  const blocked = result.stepResults.find((r) => r.blocked);
  assert.equal(blocked.blocked, "SENSITIVE_TARGET_BLOCKED");
});

// ---------------------------------------------------------------------------
// 4. SENSITIVE_TARGET ask, APPROVED via consent -> action executes, with the
//    override hooks neutralizing action-executor's own (older) guard.
// ---------------------------------------------------------------------------
test("sensitive target ask, approved -> executes with always-true override hooks", async () => {
  const executeCalls = [];
  let step = 0;
  const io = baseIo({
    executeAction: async (action, idMap, opts) => {
      executeCalls.push({ action, opts });
      return { ok: true };
    },
    sendAnalyze: async (payload) => {
      step++;
      if (step === 1) {
        return { ok: true, body: { action: "type", targetId: "agent-2", value: "PROFILEEMAIL#1", revision: payload.revision, serverVerdict: "ask" } };
      }
      return { ok: true, body: { action: "done", targetId: PAGE_TARGET_ID_V2, revision: payload.revision, serverVerdict: "accept" } };
    },
    requestConsent: async () => true,
    getProfile: async () => ({ full_name: "", email: "demo@example.com", phone: "" }),
  });

  const result = await runAgentLoopV2(io);
  // Step 1 (type, approved-sensitive) + step 2 ("done") both flow through
  // executeAction -- see the equivalent comment in the accept-flow test.
  assert.equal(executeCalls.length, 2);
  assert.equal(executeCalls[0].opts.onSensitiveTarget(), true);
  assert.equal(executeCalls[0].opts.onIrreversibleAction(), true);
  assert.equal(executeCalls[0].action.value, "demo@example.com", "a vault-seeded token must rehydrate to the vault's own value");
  assert.equal(result.outcome, "done");
});

// ---------------------------------------------------------------------------
// 5. UNKNOWN_TARGET reject (decide() rule 2) -> run ends, nothing executed.
// ---------------------------------------------------------------------------
test("server names a targetId absent from the scene -> UNKNOWN_TARGET reject, run ends", async () => {
  const executeCalls = [];
  const io = baseIo({
    executeAction: async (action) => {
      executeCalls.push(action);
      return { ok: true };
    },
    sendAnalyze: async (payload) => ({
      ok: true,
      body: { action: "click", targetId: "agent-does-not-exist", value: null, revision: payload.revision, serverVerdict: "accept" },
    }),
  });

  const result = await runAgentLoopV2(io);
  assert.equal(result.outcome, "rejected");
  assert.equal(executeCalls.length, 0);
  const rejected = result.stepResults.find((r) => r.rejected);
  assert.equal(rejected.rejected, "UNKNOWN_TARGET");
});

// ---------------------------------------------------------------------------
// 6. UNKNOWN_TOKEN: the server response's value carries a token that was
//    never actually minted this run -- rehydrate() must throw and the loop
//    must reject locally rather than ever attempting to type a bogus token.
// ---------------------------------------------------------------------------
test("a hallucinated token in the response value is rejected locally (UNKNOWN_TOKEN_LOCAL), never executed", async () => {
  const executeCalls = [];
  const io = baseIo({
    executeAction: async (action) => {
      executeCalls.push(action);
      return { ok: true };
    },
    sendAnalyze: async (payload) => ({
      ok: true,
      body: { action: "type", targetId: "agent-1", value: "PERSONNAME#99", revision: payload.revision, serverVerdict: "accept" },
    }),
  });

  const result = await runAgentLoopV2(io);
  assert.equal(result.outcome, "rejected");
  assert.equal(executeCalls.length, 0);
  const rejected = result.stepResults.find((r) => r.rejected);
  assert.equal(rejected.rejected, "UNKNOWN_TOKEN_LOCAL");
});

// ---------------------------------------------------------------------------
// 7. C6 egress assertion: a live sensitive raw value that leaked into the
//    payload must throw, and the loop must propagate the throw rather than
//    silently sending anyway ("Failure throws; the request never leaves").
// ---------------------------------------------------------------------------
test("C6: a raw sensitive value present in the outgoing payload throws EgressAssertionError and the send never happens", async () => {
  let sendCalled = false;
  const io = baseIo({
    // Simulate a bug: a sensitive node's raw value somehow equals the
    // taskGoal's own text (all that matters for this test is that the
    // live value shows up in JSON.stringify(payload)).
    getTaskGoal: async () => "please read hunter2Demo!",
    getLiveSensitiveRawValues: () => [{ agentId: "agent-2", rawValue: "hunter2Demo!" }],
    sendAnalyze: async (payload) => {
      sendCalled = true;
      return { ok: true, body: { action: "done", targetId: PAGE_TARGET_ID_V2, revision: payload.revision, serverVerdict: "accept" } };
    },
  });

  await assert.rejects(() => runAgentLoopV2(io), EgressAssertionError);
  assert.equal(sendCalled, false, "C6 must fire before send, not after");
});

// ---------------------------------------------------------------------------
// 8. assertEgressV2 direct unit coverage: mode/image mismatch both directions.
// ---------------------------------------------------------------------------
test("assertEgressV2: semantic mode carrying an image key throws", () => {
  assert.throws(
    () => assertEgressV2({ mode: "semantic", image: "AAAA" }, "semantic", new Set(), []),
    EgressAssertionError
  );
});

test("assertEgressV2: image mode missing the image key throws", () => {
  assert.throws(() => assertEgressV2({ mode: "image" }, "image", new Set(), []), EgressAssertionError);
});

test("assertEgressV2: a clean semantic payload with no leaks passes", () => {
  assert.doesNotThrow(() => assertEgressV2({ mode: "semantic", taskGoal: "PERSONNAME#1" }, "semantic", new Set(["Simon"]), []));
});

// ---------------------------------------------------------------------------
// 9. need_visual escalation: exactly one re-send in image mode, same
//    revision, then acts on the second response.
// ---------------------------------------------------------------------------
test("need_visual escalates once, same revision, image mode -- then acts normally", async () => {
  const sendPayloads = [];
  let redactCalls = 0;
  const io = baseIo({
    redact: async () => {
      redactCalls++;
      return { redactedImage: "REDACTED", redactedRegions: [] };
    },
    sendAnalyze: async (payload) => {
      sendPayloads.push(payload);
      if (payload.mode === "semantic") {
        return { ok: true, body: { action: "need_visual", targetId: PAGE_TARGET_ID_V2, value: null, revision: payload.revision, serverVerdict: "accept" } };
      }
      return { ok: true, body: { action: "done", targetId: PAGE_TARGET_ID_V2, value: null, revision: payload.revision, serverVerdict: "accept" } };
    },
  });

  const result = await runAgentLoopV2(io);
  assert.equal(result.outcome, "done");
  assert.equal(redactCalls, 1);
  assert.equal(sendPayloads.length, 2);
  assert.equal(sendPayloads[0].mode, "semantic");
  assert.equal(sendPayloads[1].mode, "image");
  assert.equal(sendPayloads[1].revision, sendPayloads[0].revision, "the image-mode re-send must carry the SAME revision");
  assert.equal(sendPayloads[1].image, "REDACTED");
});

test("a SECOND need_visual in the same step is capped -- step is skipped, not a second escalation", async () => {
  const sendPayloads = [];
  const io = baseIo({
    sendAnalyze: async (payload) => {
      sendPayloads.push(payload);
      return { ok: true, body: { action: "need_visual", targetId: PAGE_TARGET_ID_V2, value: null, revision: payload.revision, serverVerdict: "accept" } };
    },
  });

  const result = await runAgentLoopV2(io, { maxSteps: 2 });
  // Each step sends semantic then image (2 sends/step), capped at maxSteps=2 -> 4 sends, never a 3rd send within one step.
  assert.equal(sendPayloads.length, 4);
  assert.equal(result.outcome, "max_steps_reached");
});

// ---------------------------------------------------------------------------
// 10. Stale capture: detectStaleCapture firing skips the step's send
//     entirely (RULING C: continue, not break) and the run still reaches
//     "done" on a later step.
// ---------------------------------------------------------------------------
test("a positive stale-capture verdict skips that step's send and the run continues", async () => {
  let call = 0;
  let sendCalls = 0;
  const io = baseIo({
    detectStaleCapture: () => {
      call++;
      return call === 1 ? { dimensionMismatch: null, hashRecurrence: { hash: "h" } } : null;
    },
    sendAnalyze: async (payload) => {
      sendCalls++;
      return { ok: true, body: { action: "done", targetId: PAGE_TARGET_ID_V2, value: null, revision: payload.revision, serverVerdict: "accept" } };
    },
  });

  const result = await runAgentLoopV2(io);
  assert.equal(result.outcome, "done");
  assert.equal(result.staleCaptureCount, 1);
  assert.equal(sendCalls, 1, "the first (stale) step must never have sent");
});

// ---------------------------------------------------------------------------
// 11. MAX_STEPS reached when the model never says "done".
// ---------------------------------------------------------------------------
test("outcome is max_steps_reached when the server never says done", async () => {
  const io = baseIo({
    sendAnalyze: async (payload) => ({
      ok: true,
      body: { action: "scroll", targetId: PAGE_TARGET_ID_V2, value: null, revision: payload.revision, serverVerdict: "accept" },
    }),
  });

  const result = await runAgentLoopV2(io, { maxSteps: 3 });
  assert.equal(result.outcome, "max_steps_reached");
  assert.equal(result.steps, 3);
});

// ---------------------------------------------------------------------------
// 12b. REGRESSION (found live in the V4a browser evidence run): a
//      sensitive node's raw DOM value (action-executor.js's
//      buildDomSnapshot() deliberately reads a form field's live `.value`
//      as `text`) must NEVER be tokenized-and-sent as elements[].label --
//      it must be null. Regex/NER only catch PII-SHAPED text; a password
//      like "hunter2Demo!" matches nothing and would otherwise tokenize to
//      itself, unchanged.
// ---------------------------------------------------------------------------
test("a sensitive node's raw live value never becomes elements[].label", async () => {
  const sendPayloads = [];
  const io = baseIo({
    scanDom: async () =>
      buildScan({
        sensitiveNodes: [{ selector: "#pw", bbox: { x: 10, y: 40, w: 100, h: 20 }, piiType: "password", agentId: "agent-2" }],
      }),
    getLiveSensitiveRawValues: () => [{ agentId: "agent-2", rawValue: "hunter2Demo!" }],
    sendAnalyze: async (payload) => {
      sendPayloads.push(payload);
      return { ok: true, body: { action: "done", targetId: PAGE_TARGET_ID_V2, value: null, revision: payload.revision, serverVerdict: "accept" } };
    },
  });

  // buildScan()'s agent-2 domSnapshot entry has text:"" by default (the
  // fixture doesn't set a live value on the fake element) -- exercise the
  // REAL failure shape by overriding scanDom to report agent-2's text as
  // the raw password, exactly like a real <input type=password> would.
  io.scanDom = async () => {
    const scan = buildScan({ sensitiveNodes: [{ selector: "#pw", bbox: { x: 10, y: 40, w: 100, h: 20 }, piiType: "password", agentId: "agent-2" }] });
    scan.domSnapshot[1].text = "hunter2Demo!";
    return scan;
  };

  const result = await runAgentLoopV2(io);
  assert.equal(result.outcome, "done");
  const el2 = sendPayloads[0].elements.find((e) => e.agentId === "agent-2");
  assert.equal(el2.label, null, "a sensitive element's label must be null, never its raw live value");
  assert.ok(!JSON.stringify(sendPayloads[0]).includes("hunter2Demo!"));
});

// ---------------------------------------------------------------------------
// 12c. REGRESSION (found live in the V4a browser evidence run): history
//      values must NEVER be re-run through regex/NER. A real GLiNER probe
//      on the literal string "PERSONNAME#1" tags the WHOLE token as a
//      PERSONNAME entity -- re-tokenizing it mints a bogus second token
//      whose raw value IS the token string itself, which then poisons the
//      rawValueRegistry and makes C6 reject the NEXT step's payload for
//      containing its own legitimate taskGoal token. This fake NER
//      reproduces that exact real-world behavior.
// ---------------------------------------------------------------------------
test("history values are copied through verbatim, never re-tokenized (a token-shaped NER false-positive must not poison later steps)", async () => {
  function nerThatFlagsTokenShapedStrings(texts) {
    return Promise.resolve(
      texts.map((text) => {
        const m = /^[A-Z][A-Z0-9]*#\d+$/.exec(text);
        return m ? [{ start: 0, end: text.length, label: "PERSONNAME", score: 0.71, source: "ner" }] : fakeNerRealNames(text);
      })
    );
  }
  function fakeNerRealNames(text) {
    const spans = [];
    const re = /\b[A-Z][a-z]+\b/g;
    let m;
    while ((m = re.exec(text))) {
      if (NAME_DICTIONARY.has(m[0])) spans.push({ start: m.index, end: m.index + m[0].length, label: "PERSONNAME", score: 0.9, source: "ner" });
    }
    return spans;
  }

  let step = 0;
  const sendPayloads = [];
  const io = baseIo({
    // C4 amendment (2026-09-28): this test's PURPOSE is the second step's
    // payload (history carried through verbatim). "fill the name as Simon"
    // alone would now end after step 1 via GOAL_TOKENS_COMPLETE, so the goal
    // genuinely asks for a follow-up click ("... and click Continue") -- a
    // real task that needs step 2, not a word added to dodge the rule.
    getTaskGoal: async () => "fill the name as Simon and click Continue",
    nerCall: nerThatFlagsTokenShapedStrings,
    sendAnalyze: async (payload) => {
      sendPayloads.push(payload);
      step++;
      if (step === 1) {
        return { ok: true, body: { action: "type", targetId: "agent-1", value: "PERSONNAME#1", revision: payload.revision, serverVerdict: "accept" } };
      }
      return { ok: true, body: { action: "done", targetId: PAGE_TARGET_ID_V2, value: null, revision: payload.revision, serverVerdict: "accept" } };
    },
  });

  const result = await runAgentLoopV2(io);
  assert.equal(result.outcome, "done", "a second step must not throw EgressAssertionError from a poisoned rawValueRegistry");
  assert.equal(sendPayloads.length, 2);
  assert.equal(sendPayloads[1].history[0].action.value, "PERSONNAME#1");
  assert.ok(sendPayloads[1].taskGoal.includes("PERSONNAME#1"), "the real token must still legitimately appear in taskGoal");
});

// ---------------------------------------------------------------------------
// 13. Instrumentation (CLAUDE.md V4a brief item 6): every completed step
//     carries per-stage timings and a memory snapshot when io provides one.
// ---------------------------------------------------------------------------
test("every step result carries per-stage timings, and memory when io.getMemoryUsage is provided", async () => {
  let t = 0;
  const io = baseIo({
    now: () => (t += 10), // monotonically increasing fake clock
    getMemoryUsage: () => ({ usedJSHeapSize: 12345, totalJSHeapSize: 99999 }),
    sendAnalyze: async (payload) => ({
      ok: true,
      body: { action: "done", targetId: PAGE_TARGET_ID_V2, value: null, revision: payload.revision, serverVerdict: "accept" },
    }),
  });

  const result = await runAgentLoopV2(io);
  assert.equal(result.stepResults.length, 1);
  const [step1] = result.stepResults;
  assert.ok(step1.timings, "step result must carry a timings object");
  for (const key of ["captureMs", "detectMs", "scanMs", "rankMs", "nerMs", "egressAssertMs", "sendMs", "policyMs", "actMs"]) {
    assert.ok(key in step1.timings, `timings must include ${key}`);
  }
  assert.deepEqual(step1.memory, { usedJSHeapSize: 12345, totalJSHeapSize: 99999 });
});

test("memory is null when io.getMemoryUsage is not provided (never a hard requirement)", async () => {
  const io = baseIo({
    sendAnalyze: async (payload) => ({
      ok: true,
      body: { action: "done", targetId: PAGE_TARGET_ID_V2, value: null, revision: payload.revision, serverVerdict: "accept" },
    }),
  });
  const result = await runAgentLoopV2(io);
  assert.equal(result.stepResults[0].memory, null);
});

// ---------------------------------------------------------------------------
// 12. History carries the TOKEN, never the rehydrated raw value.
// ---------------------------------------------------------------------------
test("history entries carry the server's tokenized value, never the rehydrated raw value", async () => {
  const sendPayloads = [];
  let step = 0;
  const io = baseIo({
    // C4 amendment (2026-09-28): the assertion is about the SECOND payload's
    // history, so the goal is a real two-step task (type, then click);
    // "fill the name as Simon" alone now ends after step 1 by design.
    getTaskGoal: async () => "fill the name as Simon and click Continue",
    sendAnalyze: async (payload) => {
      sendPayloads.push(payload);
      step++;
      if (step === 1) {
        return { ok: true, body: { action: "type", targetId: "agent-1", value: "PERSONNAME#1", revision: payload.revision, serverVerdict: "accept" } };
      }
      return { ok: true, body: { action: "done", targetId: PAGE_TARGET_ID_V2, value: null, revision: payload.revision, serverVerdict: "accept" } };
    },
  });

  await runAgentLoopV2(io);
  assert.equal(sendPayloads.length, 2, "a type-then-click goal must reach a second planner call");
  const secondPayload = sendPayloads[1];
  assert.equal(secondPayload.history.length, 1);
  assert.equal(secondPayload.history[0].action.value, "PERSONNAME#1");
  assert.ok(!JSON.stringify(secondPayload).includes("Simon"));
});

// ---------------------------------------------------------------------------
// V4b (integration-v2, part B): subframe + shadow-DOM parity -- unscannable
// regions (a dropped subframe report, a closed shadow host) fold into C5's
// `regions` list as `kind: "frame"`, and frame-coordination stats surface
// in the step's timings whenever the io adapter supplies them.
// ---------------------------------------------------------------------------
test("unscannableRegions (dropped subframe / closed shadow root) become kind:'frame' C5 regions, scaled by devicePixelRatio", async () => {
  let capturedPayload = null;
  const io = baseIo({
    getViewport: () => ({ width: 1280, height: 800, devicePixelRatio: 2 }),
    scanDom: async () => ({
      ...buildScan(),
      unscannableRegions: [{ selector: "iframe#pay", bbox: { x: 10, y: 20, w: 30, h: 40 }, reason: "subframe-report-unmerged-this-step" }],
      framesReported: 2,
      framesMerged: 1,
      framesDropped: 1,
      defensivelyRedactedIframeCount: 1,
    }),
    sendAnalyze: async (payload) => {
      capturedPayload = payload;
      return { ok: true, body: { action: "done", targetId: PAGE_TARGET_ID_V2, revision: payload.revision, serverVerdict: "accept" } };
    },
  });

  const result = await runAgentLoopV2(io);
  assert.equal(result.outcome, "done");
  const frameRegion = capturedPayload.regions.find((r) => r.kind === "frame");
  assert.ok(frameRegion, "an unscannable region must appear in the outgoing regions list");
  assert.deepEqual(frameRegion.bbox, { x: 20, y: 40, w: 60, h: 80 }, "frame region bbox must be scaled by devicePixelRatio, same as every other DOM-sourced region");
  assert.equal(frameRegion.source, "dom");

  const stepTimings = result.stepResults[0].timings;
  assert.equal(stepTimings.framesReported, 2);
  assert.equal(stepTimings.framesMerged, 1);
  assert.equal(stepTimings.framesDropped, 1);
  assert.equal(stepTimings.defensivelyRedactedIframeCount, 1);
  assert.equal(stepTimings.unscannableRegions, 1);
});

test("an unscannableRegions entry with no bbox is skipped, never sent as a fabricated {x:0,y:0,w:0,h:0} region", async () => {
  let capturedPayload = null;
  const io = baseIo({
    scanDom: async () => ({ ...buildScan(), unscannableRegions: [{ selector: "iframe#broken", reason: "offset unresolved" }] }),
    sendAnalyze: async (payload) => {
      capturedPayload = payload;
      return { ok: true, body: { action: "done", targetId: PAGE_TARGET_ID_V2, revision: payload.revision, serverVerdict: "accept" } };
    },
  });

  await runAgentLoopV2(io);
  assert.equal(capturedPayload.regions.filter((r) => r.kind === "frame").length, 0);
});

test("frame-coordination stats are absent from timings entirely when the io adapter never supplies them (no fabricated zeros)", async () => {
  const result = await runAgentLoopV2(baseIo()); // baseIo's scanDom() never sets framesReported etc.
  const stepTimings = result.stepResults[0].timings;
  assert.equal("framesReported" in stepTimings, false);
  assert.equal("framesMerged" in stepTimings, false);
  // unscannableRegions count IS always reported (it's derived from a field
  // every io.scanDom() always returns, per the IO CONTRACT), unlike the
  // OPTIONAL frame-coordination fields above.
  assert.equal(stepTimings.unscannableRegions, 0);
});

test("need_visual escalation folds unscannableRegions into redact()'s domNodes as piiType:'other', alongside sensitiveNodes", async () => {
  let redactCallArgs = null;
  let step = 0;
  const io = baseIo({
    scanDom: async () => ({ ...buildScan(), unscannableRegions: [{ selector: "iframe#pay", bbox: { x: 1, y: 2, w: 3, h: 4 } }] }),
    redact: async (screenshotBase64, visionBoxes, domNodes, options) => {
      redactCallArgs = { domNodes, options };
      return { redactedImage: "REDACTED", redactedRegions: [] };
    },
    sendAnalyze: async (payload) => {
      step++;
      if (step === 1) return { ok: true, body: { action: "need_visual", targetId: PAGE_TARGET_ID_V2, revision: payload.revision, serverVerdict: "accept" } };
      return { ok: true, body: { action: "done", targetId: PAGE_TARGET_ID_V2, revision: payload.revision, serverVerdict: "accept" } };
    },
  });

  await runAgentLoopV2(io);
  assert.ok(redactCallArgs, "redact() must be called for a need_visual escalation");
  const unscannableEntry = redactCallArgs.domNodes.find((n) => n.piiType === "other" && n.bbox && n.bbox.x === 1);
  assert.ok(unscannableEntry, "the unscannable region must be folded into redact()'s domNodes so the image blacks it out too");
  // The existing sensitive node (agent-2, the password field) must still be present -- folding in unscannableRegions must not replace sensitiveNodes.
  assert.ok(redactCallArgs.domNodes.some((n) => n.piiType === "password"));
});

// ---------------------------------------------------------------------------
// V4b: requestConsent() now also receives the pending action + resolved
// element, for the real consent panel's plain-language description.
// ---------------------------------------------------------------------------
test("requestConsent receives the pending action (still token-valued) and the resolved element", async () => {
  let consentArgs = null;
  const io = baseIo({
    sendAnalyze: async (payload) => ({
      ok: true,
      body: { action: "type", targetId: "agent-2", value: "PROFILEEMAIL#1", revision: payload.revision, serverVerdict: "ask" },
    }),
    requestConsent: async (args) => {
      consentArgs = args;
      return true;
    },
    getProfile: async () => ({ full_name: "", email: "demo@example.com", phone: "" }),
  });

  await runAgentLoopV2(io);
  assert.ok(consentArgs, "requestConsent must have been called");
  assert.equal(consentArgs.action.action, "type");
  assert.equal(consentArgs.action.targetId, "agent-2");
  assert.equal(consentArgs.action.value, "PROFILEEMAIL#1", "the action passed to requestConsent must still carry the TOKEN, never the rehydrated raw value");
  assert.equal(consentArgs.element.agentId, "agent-2");
});

test("requestConsent's element is null for a page-level pending action", async () => {
  // classifyTier(element=null, {action:"click", targetId:"page"}) never
  // returns "destructive" for a page target with no destructive signal, so
  // this exercises the null-element path via SERVER_TIGHTENED instead: a
  // local accept strictly tightened by the server to "ask".
  let consentArgs = null;
  const io = baseIo({
    sendAnalyze: async (payload) => ({
      ok: true,
      body: { action: "click", targetId: PAGE_TARGET_ID_V2, value: null, revision: payload.revision, serverVerdict: "ask" },
    }),
    requestConsent: async (args) => {
      consentArgs = args;
      return true;
    },
  });

  await runAgentLoopV2(io);
  assert.ok(consentArgs, "requestConsent must have been called (server strictly tightened a local accept to ask)");
  assert.equal(consentArgs.element, null);
  assert.equal(consentArgs.action.targetId, PAGE_TARGET_ID_V2);
});

// ---------------------------------------------------------------------------
// C5/C2 amendment (2026-09-26): `vault` -- {token, field} pairs announcing a
// seeded PROFILE...#n token exists, never a value.
// ---------------------------------------------------------------------------
test("a non-empty profile seeds `vault` into the C5 payload as {token, field} pairs, never a raw value", async () => {
  let capturedPayload = null;
  const io = baseIo({
    getProfile: async () => ({ full_name: "Asha Rao", email: "asha.vault@example.com", phone: "" }),
    sendAnalyze: async (payload) => {
      capturedPayload = payload;
      return { ok: true, body: { action: "done", targetId: PAGE_TARGET_ID_V2, revision: payload.revision, serverVerdict: "accept" } };
    },
  });

  await runAgentLoopV2(io);
  assert.ok(Array.isArray(capturedPayload.vault), "vault must be present when the profile has at least one saved field");
  assert.equal(capturedPayload.vault.length, 2, "only the two POPULATED profile fields seed a vault entry -- phone was empty");
  const byField = Object.fromEntries(capturedPayload.vault.map((v) => [v.field, v.token]));
  assert.match(byField.full_name, /^PROFILENAME#\d+$/);
  assert.match(byField.email, /^PROFILEEMAIL#\d+$/);
  assert.equal(byField.phone, undefined, "an empty profile field must never mint a vault entry");

  const payloadStr = JSON.stringify(capturedPayload);
  assert.ok(!payloadStr.includes("Asha Rao"), "the raw vault name must never appear in the outgoing payload");
  assert.ok(!payloadStr.includes("asha.vault@example.com"), "the raw vault email must never appear in the outgoing payload");
});

test("an empty profile omits `vault` from the C5 payload entirely (never sent as [])", async () => {
  let capturedPayload = null;
  const io = baseIo({
    getProfile: async () => ({ full_name: "", email: "", phone: "" }),
    sendAnalyze: async (payload) => {
      capturedPayload = payload;
      return { ok: true, body: { action: "done", targetId: PAGE_TARGET_ID_V2, revision: payload.revision, serverVerdict: "accept" } };
    },
  });

  await runAgentLoopV2(io);
  assert.equal("vault" in capturedPayload, false, "vault must be OMITTED, not sent as an empty array, when the profile is empty");
});

test("a real planner echoing a vault token in `value` rehydrates to the real vault value locally (defence already worked; this pins the vault-announcement path specifically)", async () => {
  const executeCalls = [];
  let step = 0;
  const io = baseIo({
    getProfile: async () => ({ full_name: "Asha Rao", email: "", phone: "" }),
    executeAction: async (action) => {
      executeCalls.push(action);
      return { ok: true };
    },
    sendAnalyze: async (payload) => {
      step++;
      // Confirms the vault manifest actually reached the wire, then
      // simulates a real planner reading it and echoing the token back --
      // exactly what build_prompt_v2's new "SAVED DETAILS" instruction
      // tells a real backend to do.
      const vaultToken = payload.vault && payload.vault[0] && payload.vault[0].token;
      assert.match(vaultToken, /^PROFILENAME#\d+$/);
      if (step === 1) {
        return { ok: true, body: { action: "type", targetId: "agent-1", value: vaultToken, revision: payload.revision, serverVerdict: "accept" } };
      }
      return { ok: true, body: { action: "done", targetId: PAGE_TARGET_ID_V2, value: null, revision: payload.revision, serverVerdict: "accept" } };
    },
  });

  const result = await runAgentLoopV2(io);
  assert.equal(result.outcome, "done");
  assert.equal(executeCalls[0].value, "Asha Rao", "the vault token must rehydrate to the REAL vault value before dispatch");
});

// ---------------------------------------------------------------------------
// C5/C2 amendment (2026-09-26): ask-band spans in taskGoal are reviewed with
// the user before step 1, once each -- io.reviewGoalPrivacySpan(). baseIo's
// goal "fill the name as Simon" already carries an ask-band PERSONNAME span
// via fakeNerCall (score 0.47, ask band) -- every test above this point ran
// with that span silently defaulting to tokenized; these tests exercise the
// review hook directly.
// ---------------------------------------------------------------------------
test("ask-band goal span, no reviewGoalPrivacySpan hook wired -> stays tokenized (safe default, byte-identical to before this amendment)", async () => {
  let capturedPayload = null;
  const io = baseIo({
    sendAnalyze: async (payload) => {
      if (!capturedPayload) capturedPayload = payload;
      return { ok: true, body: { action: "done", targetId: PAGE_TARGET_ID_V2, revision: payload.revision, serverVerdict: "accept" } };
    },
  });
  await runAgentLoopV2(io);
  assert.match(capturedPayload.taskGoal, /PERSONNAME#\d+/);
  assert.ok(!capturedPayload.taskGoal.includes("Simon"));
});

test("ask-band goal span, reviewGoalPrivacySpan resolves true (Keep private, the default) -> stays tokenized", async () => {
  const reviewCalls = [];
  let capturedPayload = null;
  const io = baseIo({
    reviewGoalPrivacySpan: async (args) => {
      reviewCalls.push(args);
      return true;
    },
    sendAnalyze: async (payload) => {
      if (!capturedPayload) capturedPayload = payload;
      return { ok: true, body: { action: "done", targetId: PAGE_TARGET_ID_V2, revision: payload.revision, serverVerdict: "accept" } };
    },
  });
  await runAgentLoopV2(io);
  assert.equal(reviewCalls.length, 1, "called exactly once for the one ask-band span, never once per step");
  assert.equal(reviewCalls[0].text, "Simon", "the RAW span text is what gets reviewed -- shown only locally, never sent");
  assert.equal(reviewCalls[0].label, "PERSONNAME");
  assert.match(capturedPayload.taskGoal, /PERSONNAME#\d+/);
  assert.ok(!capturedPayload.taskGoal.includes("Simon"));
});

test("ask-band goal span, reviewGoalPrivacySpan resolves false (Not private) -> raw text restored verbatim, C6 still passes", async () => {
  let capturedPayload = null;
  const io = baseIo({
    reviewGoalPrivacySpan: async () => false,
    sendAnalyze: async (payload) => {
      if (!capturedPayload) capturedPayload = payload;
      return { ok: true, body: { action: "done", targetId: PAGE_TARGET_ID_V2, revision: payload.revision, serverVerdict: "accept" } };
    },
  });
  const result = await runAgentLoopV2(io);
  assert.notEqual(result.outcome, "egress_assertion_failed", "declassifying a span must not trip C6 -- it must be removed from rawValueRegistry, not just re-inserted");
  assert.equal(capturedPayload.taskGoal, "fill the name as Simon", "the goal must read exactly as the user wrote it once declassified");
});

test("timeout answer (hook resolves false only after its own delay) is honoured exactly like an immediate answer -- this module just awaits whatever the io adapter resolves", async () => {
  let capturedPayload = null;
  const io = baseIo({
    reviewGoalPrivacySpan: async () => new Promise((resolve) => setTimeout(() => resolve(true), 5)),
    sendAnalyze: async (payload) => {
      if (!capturedPayload) capturedPayload = payload;
      return { ok: true, body: { action: "done", targetId: PAGE_TARGET_ID_V2, revision: payload.revision, serverVerdict: "accept" } };
    },
  });
  await runAgentLoopV2(io);
  assert.match(capturedPayload.taskGoal, /PERSONNAME#\d+/, "a delayed 'keep private' answer behaves identically to an immediate one");
});
