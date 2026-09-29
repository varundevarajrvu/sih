// SIH 26171 -- v2 rebuild, Phase V1c, policy.js unit tests.
//
// Runs under plain Node, zero extra dependencies (no jsdom needed -- this
// module's input is already plain data, there is no HTML to parse).
//
// Run with: node --test tests/unit/test_policy.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  classifyTier,
  checkIntentCoherence,
  expressesDestructiveIntent,
  decide,
  tightenWithServer,
  POLICY_CODES,
  TIERS,
  CLICK_INTENT_WORDS,
  goalExpressesClickIntent,
  isGoalTokenComplete,
} from "../../extension/lib/policy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, "../fixtures/v2/policy/cases.json");
const CASES = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

// ---------------------------------------------------------------------------
// decideCases -- contract C4's 7 ordered rules, first match wins. At least
// 2 cases per rule (see cases.json's `rule` field on each entry).
// ---------------------------------------------------------------------------
describe("decide() -- fixture table (contract C4's 7 ordered rules)", () => {
  for (const c of CASES.decideCases) {
    test(`${c.id} [${c.rule}]`, () => {
      const result = decide(c.input);
      assert.equal(result.verdict, c.expected.verdict, `${c.id}: verdict mismatch`);
      assert.equal(result.code, c.expected.code, `${c.id}: code mismatch`);
      assert.ok(typeof result.reason === "string" && result.reason.length > 0, `${c.id}: reason must be a non-empty string`);
    });
  }

  test("every one of the 6 rule codes plus OK is exercised at least twice by decideCases (SERVER_TIGHTENED and GOAL_TOKENS_COMPLETE excluded -- decide() never produces either; the first is tightenWithServer()'s alone, the second is agent-loop-v2.js's own loop-level early exit)", () => {
    const counts = {};
    for (const c of CASES.decideCases) {
      counts[c.expected.code] = (counts[c.expected.code] || 0) + 1;
    }
    const decideProducibleCodes = Object.values(POLICY_CODES).filter(
      (code) => code !== POLICY_CODES.SERVER_TIGHTENED && code !== POLICY_CODES.GOAL_TOKENS_COMPLETE
    );
    for (const code of decideProducibleCodes) {
      assert.ok((counts[code] || 0) >= 2, `code ${code} should appear at least twice in decideCases, got ${counts[code] || 0}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Rule ordering -- first match wins. A case engineered to trip MULTIPLE
// rules at once must report only the FIRST one in contract order.
// ---------------------------------------------------------------------------
describe("decide() -- first-match-wins ordering, proven directly (not just via single-rule fixtures)", () => {
  test("stale revision wins over an otherwise-unknown target (rule 1 before rule 2)", () => {
    const result = decide({
      action: { action: "click", targetId: "agent-999", value: null, revision: "wrong-rev" },
      element: null,
      scene: { elements: [] },
      currentRevision: "rev-1",
      taskGoal: "anything",
      tokenValues: [],
    });
    assert.equal(result.code, POLICY_CODES.STALE_REVISION);
  });

  test("unknown target wins over a raw-value-carrying action (rule 2 before rule 3)", () => {
    const result = decide({
      action: { action: "type", targetId: "agent-999", value: "leak-me", revision: "rev-1" },
      element: null,
      scene: { elements: [] },
      currentRevision: "rev-1",
      taskGoal: "anything",
      tokenValues: ["leak-me"],
    });
    assert.equal(result.code, POLICY_CODES.UNKNOWN_TARGET);
  });

  test("raw value in action wins over a sensitive target (rule 3 before rule 4)", () => {
    const element = { agentId: "agent-1", tag: "input", type: "password", label: "PASSWORD#1", sensitive: true };
    const result = decide({
      action: { action: "type", targetId: "agent-1", value: "the-raw-secret", revision: "rev-1" },
      element,
      scene: { elements: [element] },
      currentRevision: "rev-1",
      taskGoal: "log in",
      tokenValues: ["the-raw-secret"],
    });
    assert.equal(result.code, POLICY_CODES.RAW_VALUE_IN_ACTION);
  });

  test("sensitive target wins over a destructive-tier action on the same element (rule 4 before rule 5)", () => {
    const element = { agentId: "agent-1", tag: "button", label: "Delete Account", sensitive: true };
    const result = decide({
      action: { action: "click", targetId: "agent-1", value: null, revision: "rev-1" },
      element,
      scene: { elements: [element] },
      currentRevision: "rev-1",
      taskGoal: "delete my account",
      tokenValues: [],
    });
    assert.equal(result.code, POLICY_CODES.SENSITIVE_TARGET);
  });

  test("irreversible action wins over intent mismatch on the same click (rule 5 before rule 6)", () => {
    // Task expresses destructive intent AND the target itself is destructive
    // -- coherent by checkIntentCoherence()'s own rule, but rule 5 (tier ===
    // destructive) still returns before rule 6 is ever evaluated.
    const element = { agentId: "agent-1", tag: "button", label: "Delete Account", sensitive: false };
    const result = decide({
      action: { action: "click", targetId: "agent-1", value: null, revision: "rev-1" },
      element,
      scene: { elements: [element] },
      currentRevision: "rev-1",
      taskGoal: "delete my account",
      tokenValues: [],
    });
    assert.equal(result.code, POLICY_CODES.IRREVERSIBLE_ACTION);
  });
});

// ---------------------------------------------------------------------------
// classifyTier() direct tests.
// ---------------------------------------------------------------------------
describe("classifyTier()", () => {
  for (const c of CASES.tierCases) {
    test(c.id, () => {
      const tier = classifyTier(c.input.element, c.input.action);
      assert.equal(tier, c.expected, c._comment || undefined);
    });
  }

  test("classifyTier() always returns one of the 4 frozen TIERS", () => {
    for (const c of CASES.tierCases) {
      assert.ok(TIERS.includes(classifyTier(c.input.element, c.input.action)));
    }
  });
});

// ---------------------------------------------------------------------------
// checkIntentCoherence() / expressesDestructiveIntent() direct tests.
// ---------------------------------------------------------------------------
describe("checkIntentCoherence()", () => {
  for (const c of CASES.coherenceCases) {
    test(c.id, () => {
      const result = checkIntentCoherence(c.input.taskGoal, c.input.element, c.input.action);
      assert.equal(result.coherent, c.expected.coherent, c._comment || undefined);
      if (!c.expected.coherent) {
        assert.ok(typeof result.reason === "string" && result.reason.length > 0);
      } else {
        assert.equal(result.reason, null);
      }
    });
  }

  test("expressesDestructiveIntent: ported regex sanity (verbatim from warden/tiers.py)", () => {
    assert.equal(expressesDestructiveIntent("please delete my profile"), true);
    assert.equal(expressesDestructiveIntent("close my account"), true);
    assert.equal(expressesDestructiveIntent("cancel the subscription"), true);
    assert.equal(expressesDestructiveIntent("search for a laptop"), false);
    assert.equal(expressesDestructiveIntent(""), false);
    assert.equal(expressesDestructiveIntent(undefined), false);
  });
});

// ---------------------------------------------------------------------------
// benignFromActionRisk -- v1 action-risk.js's benign fixtures must not
// become tier=destructive under policy.js's own tiering.
// ---------------------------------------------------------------------------
describe("benign action-risk fixtures translated to C5 shape must NOT classify as destructive", () => {
  for (const c of CASES.benignFromActionRisk) {
    test(`${c.id} (source: ${c.sourceFixture})`, () => {
      const tier = classifyTier(c.input.element, c.input.action);
      assert.notEqual(tier, c.expectedTierNot, `${c.id}: must not classify as ${c.expectedTierNot}`);
    });
  }
});

// ---------------------------------------------------------------------------
// probePlans -- Project B's six warden/README.md probe-plan rows, ported to
// the C5 element+action shape and run through decide().
// ---------------------------------------------------------------------------
describe("probePlans -- warden/README.md's six-probe-plan table, verdicts must agree", () => {
  for (const c of CASES.probePlans) {
    test(`${c.id}: ${c.sourceRow}`, () => {
      const result = decide(c.input);
      assert.equal(result.verdict, c.expected.verdict, `${c.id}: verdict mismatch -- ${c._comment || ""}`);
      assert.equal(result.code, c.expected.code, `${c.id}: code mismatch -- ${c._comment || ""}`);
    });
  }
});

// ---------------------------------------------------------------------------
// tightenWithServer() -- server-tighten table (accept+ask->ask,
// ask+accept->ask, accept+reject->reject, reject+accept->reject) plus a few
// extra edge cases.
// ---------------------------------------------------------------------------
describe("tightenWithServer() -- server can only tighten, never loosen", () => {
  for (const c of CASES.tightenCases) {
    test(`${c.id}: ${c._comment}`, () => {
      const result = tightenWithServer(c.local, c.server);
      assert.equal(result.verdict, c.expected.verdict, `${c.id}: verdict mismatch`);
      if (c.expected.code) {
        assert.equal(result.code, c.expected.code, `${c.id}: code mismatch`);
      }
      if (c.expected.reasonUnchanged) {
        assert.equal(result.reason, c.local.reason, `${c.id}: reason should be untouched when the server does not tighten`);
        assert.equal(result.code, c.local.code, `${c.id}: code should be untouched when the server does not tighten`);
      }
    });
  }

  test("SERVER_TIGHTENED is used ONLY when local was accept (code OK) and the server strictly tightens it", () => {
    const local = { verdict: "accept", code: POLICY_CODES.OK, reason: "no policy rule blocked this action" };
    const tightened = tightenWithServer(local, "reject");
    assert.equal(tightened.code, POLICY_CODES.SERVER_TIGHTENED);
    assert.equal(tightened.verdict, "reject");
  });

  test("when local was already ask/reject (a rule already fired), tightening further keeps the ORIGINAL local code -- never SERVER_TIGHTENED", () => {
    const local = { verdict: "ask", code: POLICY_CODES.SENSITIVE_TARGET, reason: "target element is flagged sensitive" };
    const tightened = tightenWithServer(local, "reject");
    assert.equal(tightened.code, POLICY_CODES.SENSITIVE_TARGET);
    assert.notEqual(tightened.code, POLICY_CODES.SERVER_TIGHTENED);
    assert.equal(tightened.verdict, "reject");
  });

  test("decide() itself never returns SERVER_TIGHTENED -- that code is exclusive to tightenWithServer()'s own escalation", () => {
    for (const c of CASES.decideCases.concat(CASES.probePlans)) {
      const result = decide(c.input);
      assert.notEqual(result.code, POLICY_CODES.SERVER_TIGHTENED, `${c.id}: decide() must never produce SERVER_TIGHTENED`);
    }
  });

  test("tightening never mutates the original localDecision object", () => {
    const local = { verdict: "accept", code: POLICY_CODES.OK, reason: "no policy rule blocked this action" };
    const snapshot = JSON.parse(JSON.stringify(local));
    tightenWithServer(local, "reject");
    assert.deepEqual(local, snapshot);
  });

  test("accepts a {verdict, reason} object as serverVerdict, not only a bare string", () => {
    const local = { verdict: "accept", code: POLICY_CODES.OK, reason: "no policy rule blocked this action" };
    const tightened = tightenWithServer(local, { verdict: "ask", reason: "server flagged this" });
    assert.equal(tightened.verdict, "ask");
  });
});

// ---------------------------------------------------------------------------
// SECURITY PROPERTY: `reason` (from decide(), and transitively from
// tightenWithServer()) must NEVER contain a raw tokenValues value --
// tokenValues carries the raw secrets a TokenMap holds, and rule 3's job is
// to refuse a leak, not describe it. Checked across every fixture that
// supplies non-empty tokenValues, plus two fixtures deliberately carrying
// realistic secrets (a password, an email address).
// ---------------------------------------------------------------------------
describe("reason strings never echo a raw tokenValues value (rule 3's own guarantee)", () => {
  const casesWithTokenValues = CASES.decideCases
    .concat(CASES.probePlans)
    .filter((c) => Array.isArray(c.input.tokenValues) && c.input.tokenValues.length > 0);

  test("at least one fixture actually exercises a non-empty tokenValues list (sanity on the test itself)", () => {
    assert.ok(casesWithTokenValues.length >= 2, "expected at least 2 fixtures with non-empty tokenValues to make this check meaningful");
  });

  for (const c of casesWithTokenValues) {
    test(`${c.id}: reason excludes every raw tokenValues entry`, () => {
      const result = decide(c.input);
      for (const raw of c.input.tokenValues) {
        assert.ok(!result.reason.includes(raw), `${c.id}: reason leaked raw token value ${JSON.stringify(raw)} -- reason was ${JSON.stringify(result.reason)}`);
      }
    });
  }

  test("a raw value that leaks through decide() -> tightenWithServer() is still absent from the tightened reason", () => {
    const secret = "hunter2Demo!VeryRaw";
    const element = { agentId: "agent-4", tag: "input", type: "password", label: "PASSWORD#1", sensitive: false };
    const local = decide({
      action: { action: "type", targetId: "agent-4", value: secret, revision: "rev-1" },
      element,
      scene: { elements: [element] },
      currentRevision: "rev-1",
      taskGoal: "fill in the password",
      tokenValues: [secret],
    });
    assert.equal(local.code, POLICY_CODES.RAW_VALUE_IN_ACTION);
    assert.ok(!local.reason.includes(secret));

    const tightened = tightenWithServer(local, "reject");
    assert.ok(!tightened.reason.includes(secret), `tightened reason leaked the secret: ${JSON.stringify(tightened.reason)}`);
  });
});

// ---------------------------------------------------------------------------
// Determinism + defensive input handling.
// ---------------------------------------------------------------------------
describe("determinism and defensive input handling", () => {
  test("decide() is deterministic: identical input -> byte-identical output", () => {
    const input = CASES.decideCases[0].input;
    const first = decide(input);
    const second = decide(input);
    assert.deepEqual(first, second);
  });

  test("decide() with no params object does not throw (treated as a fully absent/invalid action)", () => {
    assert.doesNotThrow(() => decide());
  });

  test("classifyTier() with null element and a minimal action does not throw", () => {
    assert.doesNotThrow(() => classifyTier(null, { action: "click", targetId: "agent-1" }));
  });

  test("checkIntentCoherence() with undefined taskGoal does not throw and is coherent (no destructive intent expressed)", () => {
    const result = checkIntentCoherence(undefined, null, { action: "click", targetId: "agent-1" });
    assert.equal(result.coherent, true);
  });

  test("scene accepted as a bare array (not only {elements: [...]})", () => {
    const element = { agentId: "agent-1", tag: "a", role: "link", label: "Home", sensitive: false };
    const result = decide({
      action: { action: "click", targetId: "agent-1", value: null, revision: "rev-1" },
      element,
      scene: [element],
      currentRevision: "rev-1",
      taskGoal: "go home",
      tokenValues: [],
    });
    assert.equal(result.verdict, "accept");
  });
});

// ---------------------------------------------------------------------------
// POLICY_CODES enum sanity.
// ---------------------------------------------------------------------------
describe("POLICY_CODES sanity", () => {
  test("is frozen and closed (9 codes exactly: 6 rules + OK + SERVER_TIGHTENED + GOAL_TOKENS_COMPLETE)", () => {
    assert.ok(Object.isFrozen(POLICY_CODES));
    assert.equal(Object.keys(POLICY_CODES).length, 9);
    assert.deepEqual(
      Object.keys(POLICY_CODES).sort(),
      [
        "IRREVERSIBLE_ACTION", "INTENT_MISMATCH", "OK", "RAW_VALUE_IN_ACTION",
        "SENSITIVE_TARGET", "SERVER_TIGHTENED", "STALE_REVISION", "UNKNOWN_TARGET",
        "GOAL_TOKENS_COMPLETE",
      ].sort()
    );
  });

  test("TIERS is frozen and matches contract C4's 4 tiers exactly", () => {
    assert.ok(Object.isFrozen(TIERS));
    assert.deepEqual(TIERS, ["reversible", "navigational", "state-changing", "destructive"]);
  });
});

// ---------------------------------------------------------------------------
// C4 amendment (2026-09-28) -- "deterministic task completion".
// CLICK_INTENT_WORDS / goalExpressesClickIntent() / isGoalTokenComplete().
// ---------------------------------------------------------------------------
describe("CLICK_INTENT_WORDS / goalExpressesClickIntent()", () => {
  test("CLICK_INTENT_WORDS is frozen and matches the amendment's literal list exactly", () => {
    assert.ok(Object.isFrozen(CLICK_INTENT_WORDS));
    assert.deepEqual(CLICK_INTENT_WORDS, [
      "click", "press", "submit", "place", "order", "continue", "next", "send",
      "pay", "buy", "book", "confirm", "sign in", "log in", "login", "checkout",
    ]);
  });

  test("matches every listed word/phrase, case-insensitively", () => {
    for (const w of CLICK_INTENT_WORDS) {
      assert.equal(goalExpressesClickIntent(`please ${w} now`), true, `expected a hit on "${w}"`);
      assert.equal(goalExpressesClickIntent(`please ${w.toUpperCase()} now`), true, `expected a case-insensitive hit on "${w.toUpperCase()}"`);
    }
  });

  test("word-bounded: does not fire on a word that merely CONTAINS a click-intent word as a substring", () => {
    // "clicked"/"pressing"/"orderly"/"sender" etc. contain a listed word but
    // are not themselves that word -- \b...\b must not match mid-word.
    assert.equal(goalExpressesClickIntent("the orderly queue moved"), false);
    assert.equal(goalExpressesClickIntent("sender field is empty"), false);
    assert.equal(goalExpressesClickIntent("bookkeeping the accounts"), false);
  });

  test("multi-word phrases match as an exact phrase, not as two independent single-word hits", () => {
    assert.equal(goalExpressesClickIntent("please sign in to the portal"), true);
    assert.equal(goalExpressesClickIntent("log in with my saved details"), true);
    // "sign" alone and "in" alone must not trip it when "sign in" is not
    // actually the phrase present.
    assert.equal(goalExpressesClickIntent("sign the form and drop it in the box"), false);
  });

  test("a goal with no click-intent word at all returns false", () => {
    assert.equal(goalExpressesClickIntent("fill the name as Simon"), false);
    assert.equal(goalExpressesClickIntent("fill all my details"), false);
  });

  test("defensive on null/undefined input -- does not throw, returns false", () => {
    assert.equal(goalExpressesClickIntent(undefined), false);
    assert.equal(goalExpressesClickIntent(null), false);
    assert.equal(goalExpressesClickIntent(""), false);
  });
});

describe("isGoalTokenComplete() -- C4 amendment rules 1-3", () => {
  const ok = (action, value) => ({ action: { action, value }, outcome: "ok" });

  test("rule 1: a goal with NO value token returns false regardless of history (e.g. 'fill all my details', a bare checkout goal)", () => {
    assert.equal(
      isGoalTokenComplete({ tokenizedGoal: "fill all my details", rawGoal: "fill all my details", history: [] }),
      false
    );
    assert.equal(
      isGoalTokenComplete({ tokenizedGoal: "complete the checkout", rawGoal: "complete the checkout", history: [ok("type", "PERSONNAME#1")] }),
      false
    );
  });

  test("rule 1+2: a single value token, typed successfully, no click intent -> true (the S1 shape)", () => {
    const result = isGoalTokenComplete({
      tokenizedGoal: "fill the name as PERSONNAME#1",
      rawGoal: "fill the name as Simon",
      history: [ok("type", "PERSONNAME#1")],
    });
    assert.equal(result, true);
  });

  test("rule 2: the token has NOT yet been typed -> false", () => {
    const result = isGoalTokenComplete({
      tokenizedGoal: "fill the name as PERSONNAME#1",
      rawGoal: "fill the name as Simon",
      history: [],
    });
    assert.equal(result, false);
  });

  test("rule 2: two distinct value tokens, only one typed -> false (both must be typed)", () => {
    const result = isGoalTokenComplete({
      tokenizedGoal: "fill the name as PERSONNAME#1 and the email as EMAIL#1",
      rawGoal: "fill the name as Simon and the email as simon@example.com",
      history: [ok("type", "PERSONNAME#1")],
    });
    assert.equal(result, false);
  });

  test("rule 2: two distinct value tokens, both typed -> true", () => {
    const result = isGoalTokenComplete({
      tokenizedGoal: "fill the name as PERSONNAME#1 and the email as EMAIL#1",
      rawGoal: "fill the name as Simon and the email as simon@example.com",
      history: [ok("type", "PERSONNAME#1"), ok("type", "EMAIL#1")],
    });
    assert.equal(result, true);
  });

  test("edge case: the SAME token appears twice in the goal -- typing it once still satisfies rule 2", () => {
    const result = isGoalTokenComplete({
      tokenizedGoal: "PERSONNAME#1 should be spelled the same as PERSONNAME#1 everywhere",
      rawGoal: "Simon should be spelled the same as Simon everywhere",
      history: [ok("type", "PERSONNAME#1")],
    });
    assert.equal(result, true);
  });

  test("edge case: a token typed then the action FAILED (rejected/denied outcome) -- must not count as rule 2 satisfied", () => {
    const rejected = { action: { action: "type", value: "PERSONNAME#1" }, outcome: "rejected:UNKNOWN_TOKEN_LOCAL" };
    const denied = { action: { action: "type", value: "PERSONNAME#1" }, outcome: "asked-denied" };
    assert.equal(
      isGoalTokenComplete({ tokenizedGoal: "fill the name as PERSONNAME#1", rawGoal: "fill the name as Simon", history: [rejected] }),
      false
    );
    assert.equal(
      isGoalTokenComplete({ tokenizedGoal: "fill the name as PERSONNAME#1", rawGoal: "fill the name as Simon", history: [denied] }),
      false
    );
  });

  test("edge case: a vault-shaped token (PROFILENAME#1) is matched by the same generic rule -- not scoped to PERSONNAME/EMAIL/PHONE prefixes", () => {
    const result = isGoalTokenComplete({
      tokenizedGoal: "fill in PROFILENAME#1 where it asks for a name",
      rawGoal: "fill in my saved name where it asks for a name",
      history: [ok("type", "PROFILENAME#1")],
    });
    assert.equal(result, true);
  });

  test("edge case: a vault token typed does NOT satisfy a DIFFERENT token named in the goal", () => {
    const result = isGoalTokenComplete({
      tokenizedGoal: "fill the name as PERSONNAME#1",
      rawGoal: "fill the name as Simon",
      history: [ok("type", "PROFILEEMAIL#1")], // wrong token -- unrelated to the goal's own PERSONNAME#1
    });
    assert.equal(result, false);
  });

  test("edge case: a click-intent goal -- rule 3 blocks completion even though rules 1+2 are otherwise satisfied (the checkout shape)", () => {
    const result = isGoalTokenComplete({
      tokenizedGoal: "fill the name as PERSONNAME#1 then click continue",
      rawGoal: "fill the name as Simon then click continue",
      history: [ok("type", "PERSONNAME#1")],
    });
    assert.equal(result, false);
  });

  test("fill_profile actions can never satisfy rule 2 -- their history value is always null, never a token", () => {
    const result = isGoalTokenComplete({
      tokenizedGoal: "fill the name as PERSONNAME#1",
      rawGoal: "fill the name as Simon",
      history: [{ action: { action: "fill_profile", value: null }, outcome: "ok" }],
    });
    assert.equal(result, false);
  });

  test("defensive: missing/empty history, missing tokenizedGoal/rawGoal, or no args at all -- never throws, always returns a boolean", () => {
    assert.equal(isGoalTokenComplete({ tokenizedGoal: "PERSONNAME#1", rawGoal: "x", history: undefined }), false);
    assert.equal(isGoalTokenComplete({ tokenizedGoal: undefined, rawGoal: undefined, history: [] }), false);
    assert.doesNotThrow(() => isGoalTokenComplete());
    assert.equal(isGoalTokenComplete(), false);
  });

  test("the check can never produce an action -- it is a pure boolean predicate, never an object/action-shaped value", () => {
    const inputs = [
      { tokenizedGoal: "fill the name as PERSONNAME#1", rawGoal: "fill the name as Simon", history: [ok("type", "PERSONNAME#1")] },
      { tokenizedGoal: "fill all my details", rawGoal: "fill all my details", history: [] },
      { tokenizedGoal: "fill the name as PERSONNAME#1 then click continue", rawGoal: "fill the name as Simon then click continue", history: [ok("type", "PERSONNAME#1")] },
    ];
    for (const input of inputs) {
      const result = isGoalTokenComplete(input);
      assert.equal(typeof result, "boolean", "isGoalTokenComplete must return a plain boolean, never an action/object");
    }
    // Calling it must not mutate the history array passed in (no way for
    // this check to smuggle an action back through its own input).
    const history = [ok("type", "PERSONNAME#1")];
    const snapshot = JSON.parse(JSON.stringify(history));
    isGoalTokenComplete({ tokenizedGoal: "fill the name as PERSONNAME#1", rawGoal: "fill the name as Simon", history });
    assert.deepEqual(history, snapshot, "isGoalTokenComplete must never mutate the history it is given");
  });
});
