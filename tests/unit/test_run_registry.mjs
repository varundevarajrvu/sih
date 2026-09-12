// SIH 26171 -- Tier 4 (usable-extension pass), TASK 1 + TASK 2:
// extension/lib/run-registry.js tests.
//
// Pure state-transition module, zero DOM/chrome dependency -- run with
// plain Node's built-in test runner. These are exactly the "stop-state
// transitions" the task brief asked to be covered mechanically: starting a
// run, progress patches, requesting a stop, finishing a run, and the two
// derived predicates (canStop/isRunningForTab) background.js keys its
// message handlers off of.
//
// Run with: node --test tests/unit/test_run_registry.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  createRunState,
  startRun,
  applyProgress,
  requestStop,
  finishRun,
  canStop,
  isRunningForTab,
} from "../../extension/lib/run-registry.js";

describe("createRunState", () => {
  test("fresh state is inactive, with every field at its documented default", () => {
    const s = createRunState();
    assert.equal(s.active, false);
    assert.equal(s.stopRequested, false);
    assert.equal(s.tabId, null);
    assert.equal(s.step, 0);
    assert.equal(s.outcome, null);
    assert.equal(s.lastAction, null);
    assert.equal(s.lastBlock, null);
    assert.equal(s.lastError, null);
  });

  test("two calls return independent objects (never the same reference)", () => {
    assert.notEqual(createRunState(), createRunState());
  });
});

describe("startRun", () => {
  test("produces an active state carrying the given tabId/taskGoal/maxSteps", () => {
    const s = startRun("fill the name as Simon", { tabId: 42, maxSteps: 25, now: 1000 });
    assert.equal(s.active, true);
    assert.equal(s.stopRequested, false);
    assert.equal(s.tabId, 42);
    assert.equal(s.taskGoal, "fill the name as Simon");
    assert.equal(s.maxSteps, 25);
    assert.equal(s.stage, "starting");
    assert.equal(s.startedAt, 1000);
    assert.equal(s.updatedAt, 1000);
    assert.equal(s.finishedAt, null);
  });

  test("never carries over a previous run's step/lastAction/lastBlock/lastError -- a new run starts clean", () => {
    let s = startRun("goal A", { tabId: 1 });
    s = applyProgress(s, {
      step: 5,
      lastAction: { description: "clicked Continue" },
      lastBlock: { code: "SENSITIVE_TARGET_BLOCKED", reasons: ["x"] },
      lastError: { summary: "oops" },
    });
    const fresh = startRun("goal B", { tabId: 1 });
    assert.equal(fresh.step, 0);
    assert.equal(fresh.lastAction, null);
    assert.equal(fresh.lastBlock, null);
    assert.equal(fresh.lastError, null);
  });

  test("missing tabId/maxSteps degrade to null rather than NaN/undefined", () => {
    const s = startRun("goal", {});
    assert.equal(s.tabId, null);
    assert.equal(s.maxSteps, null);
  });

  test("does not mutate a state object passed in as some other context's reference (pure)", () => {
    const before = createRunState();
    const frozen = Object.freeze({ ...before });
    // startRun() doesn't take a prior state at all, so nothing to freeze
    // against directly -- this test instead documents that its return
    // value is a fresh object, not `before` itself.
    const after = startRun("goal");
    assert.notEqual(after, frozen);
  });
});

describe("applyProgress", () => {
  test("merges a patch onto the existing state, leaving untouched fields alone", () => {
    const s0 = startRun("goal", { tabId: 1, maxSteps: 25, now: 1000 });
    const s1 = applyProgress(s0, { step: 3, stage: "capture" }, { now: 2000 });
    assert.equal(s1.step, 3);
    assert.equal(s1.stage, "capture");
    assert.equal(s1.tabId, 1); // untouched
    assert.equal(s1.taskGoal, "goal"); // untouched
    assert.equal(s1.updatedAt, 2000);
  });

  test("never mutates the input state object", () => {
    const s0 = startRun("goal", { tabId: 1 });
    const snapshotBefore = JSON.stringify(s0);
    applyProgress(s0, { step: 9 });
    assert.equal(JSON.stringify(s0), snapshotBefore);
  });

  test("a null/undefined base state degrades to a fresh createRunState() rather than throwing", () => {
    const s = applyProgress(null, { step: 1 });
    assert.equal(s.step, 1);
    assert.equal(s.active, false);
  });

  test("lastBlock persists across a later patch that doesn't mention it -- a block is not silently cleared by unrelated progress", () => {
    let s = startRun("goal", { tabId: 1 });
    s = applyProgress(s, { lastBlock: { code: "SENSITIVE_TARGET_BLOCKED", reasons: ["target flagged sensitive"], step: 2 } });
    s = applyProgress(s, { step: 3, stage: "capture" }); // no lastBlock key in this patch
    assert.deepEqual(s.lastBlock, { code: "SENSITIVE_TARGET_BLOCKED", reasons: ["target flagged sensitive"], step: 2 });
  });

  test("an explicit lastBlock: null in a later patch DOES clear it -- the reducer has no field-specific opinion, the caller decides", () => {
    let s = startRun("goal", { tabId: 1 });
    s = applyProgress(s, { lastBlock: { code: "IRREVERSIBLE_ACTION_BLOCKED", reasons: [], step: 2 } });
    s = applyProgress(s, { lastBlock: null });
    assert.equal(s.lastBlock, null);
  });
});

describe("requestStop", () => {
  test("sets stopRequested on an active run", () => {
    const s0 = startRun("goal", { tabId: 1 });
    const s1 = requestStop(s0, { now: 5000 });
    assert.equal(s1.stopRequested, true);
    assert.equal(s1.active, true, "requestStop alone does not end the run -- finishRun is the one that sets active:false");
    assert.equal(s1.updatedAt, 5000);
  });

  test("is idempotent -- requesting stop twice does not error or change anything further", () => {
    let s = startRun("goal", { tabId: 1 });
    s = requestStop(s);
    const again = requestStop(s);
    assert.equal(again.stopRequested, true);
  });

  test("refuses to fabricate an active run: on an inactive/fresh state, stopRequested stays false", () => {
    const fresh = createRunState();
    const result = requestStop(fresh);
    assert.equal(result.active, false);
    assert.equal(result.stopRequested, false);
  });

  test("does not mutate its input", () => {
    const s0 = startRun("goal", { tabId: 1 });
    const snapshotBefore = JSON.stringify(s0);
    requestStop(s0);
    assert.equal(JSON.stringify(s0), snapshotBefore);
  });
});

describe("finishRun", () => {
  test("sets active:false, stage:'finished', and the given outcome", () => {
    const s0 = startRun("goal", { tabId: 1 });
    const s1 = finishRun(s0, "done", { now: 9000 });
    assert.equal(s1.active, false);
    assert.equal(s1.stage, "finished");
    assert.equal(s1.outcome, "done");
    assert.equal(s1.finishedAt, 9000);
  });

  test("'stopped' is never confusable with 'done' or 'stalled' -- three distinct calls produce three distinct outcomes", () => {
    const base = startRun("goal", { tabId: 1 });
    assert.equal(finishRun(base, "done").outcome, "done");
    assert.equal(finishRun(base, "stopped").outcome, "stopped");
    assert.equal(finishRun(base, "stalled").outcome, "stalled");
  });

  test("finishing a run that already had stopRequested:true still finalizes with whatever outcome is passed (the caller decides, not this function)", () => {
    let s = startRun("goal", { tabId: 1 });
    s = requestStop(s);
    const finished = finishRun(s, "stopped");
    assert.equal(finished.active, false);
    assert.equal(finished.outcome, "stopped");
  });

  test("a missing/falsy outcome falls back to whatever the state already had, never silently becoming an empty string", () => {
    let s = startRun("goal", { tabId: 1 });
    s = applyProgress(s, { outcome: "act_failed" });
    const finished = finishRun(s, undefined);
    assert.equal(finished.outcome, "act_failed");
  });
});

describe("canStop -- the popup's Stop-button-enablement rule", () => {
  test("true only while active AND no stop already requested", () => {
    const active = startRun("goal", { tabId: 1 });
    assert.equal(canStop(active), true);
  });

  test("false once a stop has already been requested (prevents a confusing double-stop)", () => {
    let s = startRun("goal", { tabId: 1 });
    s = requestStop(s);
    assert.equal(canStop(s), false);
  });

  test("false on a fresh/never-started state", () => {
    assert.equal(canStop(createRunState()), false);
  });

  test("false once a run has finished", () => {
    const s = finishRun(startRun("goal", { tabId: 1 }), "done");
    assert.equal(canStop(s), false);
  });

  test("false on null/undefined (never throws)", () => {
    assert.equal(canStop(null), false);
    assert.equal(canStop(undefined), false);
  });
});

describe("isRunningForTab", () => {
  test("true for the exact active tabId", () => {
    const s = startRun("goal", { tabId: 7 });
    assert.equal(isRunningForTab(s, 7), true);
  });

  test("false for a different tabId", () => {
    const s = startRun("goal", { tabId: 7 });
    assert.equal(isRunningForTab(s, 8), false);
  });

  test("false once the run has finished, even for the same tabId", () => {
    const s = finishRun(startRun("goal", { tabId: 7 }), "done");
    assert.equal(isRunningForTab(s, 7), false);
  });

  test("false on null/undefined state", () => {
    assert.equal(isRunningForTab(null, 7), false);
  });
});

// ===========================================================================
// End-to-end transition sequence, mirroring exactly what background.js does
// across a real Stop click: start -> a few progress patches -> requestStop
// -> finishRun("stopped"). Exercises the full lifecycle in one scenario
// rather than only unit-level transitions.
// ===========================================================================
describe("full lifecycle: start -> progress -> stop -> finish", () => {
  test("end state is inactive, stopRequested, outcome 'stopped', and distinguishable from a 'done'/'stalled' finish", () => {
    let s = startRun("book a train ticket", { tabId: 3, maxSteps: 25, now: 0 });
    assert.equal(canStop(s), true);

    s = applyProgress(s, { step: 1, stage: "capture" }, { now: 100 });
    s = applyProgress(s, { step: 1, stage: "act", lastAction: { description: "clicked Continue" } }, { now: 200 });

    s = requestStop(s, { now: 300 });
    assert.equal(canStop(s), false, "Stop button must disable itself the instant a stop is in flight");

    s = finishRun(s, "stopped", { now: 400 });
    assert.equal(s.active, false);
    assert.equal(s.outcome, "stopped");
    assert.notEqual(s.outcome, "done");
    assert.notEqual(s.outcome, "stalled");
    // Evidence from earlier in the run survives to the final state -- the
    // popup can still show "last action: clicked Continue" alongside
    // "Outcome: Stopped by you".
    assert.equal(s.lastAction.description, "clicked Continue");
  });
});
