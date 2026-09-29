// SIH 26171 -- Tier 4 (usable-extension pass), TASK 2:
// extension/lib/action-describe.js tests.
//
// Pure formatting module, zero DOM/chrome dependency -- run with plain
// Node's built-in test runner.
//
// Run with: node --test tests/unit/test_action_describe.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  describeAction,
  describeOutcome,
  describePendingAction,
  describePolicyReason,
  phraseForValueToken,
} from "../../extension/lib/action-describe.js";

describe("describeAction", () => {
  test("type action with a labeled node -> 'typed into <label>'", () => {
    const domSnapshot = [{ agentId: "agent-1", tag: "input", type: "text", text: "Full name" }];
    const result = describeAction({ action: "type", targetId: "agent-1", value: "Simon" }, domSnapshot);
    assert.equal(result, "typed into Full name");
  });

  test("click action with a labeled node -> 'clicked <label>'", () => {
    const domSnapshot = [{ agentId: "agent-5", tag: "button", text: "Continue" }];
    const result = describeAction({ action: "click", targetId: "agent-5" }, domSnapshot);
    assert.equal(result, "clicked Continue");
  });

  test("scroll -> fixed phrase, ignores targetId", () => {
    assert.equal(describeAction({ action: "scroll", targetId: "page" }, []), "scrolled the page");
  });

  test("done -> fixed phrase", () => {
    assert.equal(describeAction({ action: "done", targetId: "page" }, []), "marked the task as done");
  });

  test("NEVER echoes action.value into the description, even for a successful type on a non-sensitive field", () => {
    const domSnapshot = [{ agentId: "agent-1", tag: "input", type: "email", text: "Email" }];
    const result = describeAction({ action: "type", targetId: "agent-1", value: "someone@example.com" }, domSnapshot);
    assert.ok(!result.includes("someone@example.com"), "the typed value must never appear in the plain-language description");
    assert.equal(result, "typed into Email");
  });

  test("fill_profile: 'filled <category> from your profile', reading only action.profileField", () => {
    const result = describeAction({ action: "fill_profile", targetId: "agent-1", value: null, profileField: "email" }, []);
    assert.equal(result, "filled email from your profile");
  });

  test("fill_profile: 'full_name' humanizes to 'full name' (underscore replaced with a space)", () => {
    const result = describeAction({ action: "fill_profile", targetId: "agent-1", value: null, profileField: "full_name" }, []);
    assert.equal(result, "filled full name from your profile");
  });

  test("fill_profile: 'phone' reads naturally", () => {
    const result = describeAction({ action: "fill_profile", targetId: "agent-3", value: null, profileField: "phone" }, []);
    assert.equal(result, "filled phone from your profile");
  });

  test("fill_profile: NEVER echoes the vault value, even if one is (incorrectly) present on action.value", () => {
    const result = describeAction(
      { action: "fill_profile", targetId: "agent-1", value: "vault-secret@example.com", profileField: "email" },
      []
    );
    assert.ok(!result.includes("vault-secret@example.com"), "the vault-sourced value must never appear in the description, under any circumstances");
    assert.equal(result, "filled email from your profile");
  });

  test("fill_profile: ignores domSnapshot/label entirely -- the category name is the whole story regardless of the target field's own label", () => {
    const domSnapshot = [{ agentId: "agent-1", tag: "input", type: "email", text: "Work Email Address" }];
    const result = describeAction({ action: "fill_profile", targetId: "agent-1", value: null, profileField: "email" }, domSnapshot);
    assert.equal(result, "filled email from your profile");
  });

  test("fill_profile: a missing/malformed profileField degrades to 'a field' rather than throwing or showing 'undefined'", () => {
    assert.equal(describeAction({ action: "fill_profile", targetId: "agent-1", value: null }, []), "filled a field from your profile");
    assert.equal(describeAction({ action: "fill_profile", targetId: "agent-1", value: null, profileField: null }, []), "filled a field from your profile");
    assert.equal(describeAction({ action: "fill_profile", targetId: "agent-1", value: null, profileField: 42 }, []), "filled a field from your profile");
  });

  test("fill_profile: an unrecognized-but-string profileField still renders legibly (underscore-to-space fallback)", () => {
    const result = describeAction({ action: "fill_profile", targetId: "agent-1", value: null, profileField: "some_future_field" }, []);
    assert.equal(result, "filled some future field from your profile");
  });

  test("falls back to role, then tag, when text is empty", () => {
    const byRole = describeAction({ action: "click", targetId: "a1" }, [{ agentId: "a1", role: "button", text: "" }]);
    assert.equal(byRole, "clicked button");
    const byTag = describeAction({ action: "click", targetId: "a1" }, [{ agentId: "a1", tag: "a", text: "", role: "" }]);
    assert.equal(byTag, "clicked a");
  });

  test("falls back to the raw targetId when no matching node is found (e.g. ranked out or cross-frame)", () => {
    const result = describeAction({ action: "click", targetId: "agent-f7-2" }, [{ agentId: "agent-1", text: "Something else" }]);
    assert.equal(result, "clicked agent-f7-2");
  });

  test("falls back to a generic phrase when there's no label AND targetId is the page sentinel", () => {
    const result = describeAction({ action: "click", targetId: "page" }, []);
    assert.equal(result, "clicked an element");
  });

  test("long text labels are truncated so the popup layout can't be blown out", () => {
    const longText = "A".repeat(100);
    const result = describeAction({ action: "click", targetId: "a1" }, [{ agentId: "a1", text: longText }]);
    assert.ok(result.length < 60, `expected a short truncated description, got length ${result.length}`);
    assert.match(result, /^clicked A+\.\.\.$/);
  });

  test("malformed action never throws -- degrades to a generic phrase", () => {
    assert.equal(describeAction(null, []), "performed an action");
    assert.equal(describeAction({}, []), "performed an action");
    assert.equal(describeAction(undefined, undefined), "performed an action");
  });

  test("an unrecognized action type still produces a legible sentence, not a blank", () => {
    const result = describeAction({ action: "hover", targetId: "a1" }, [{ agentId: "a1", text: "Menu" }]);
    assert.equal(result, "hover on Menu");
  });

  test("non-array domSnapshot degrades to targetId-only lookup instead of throwing", () => {
    const result = describeAction({ action: "click", targetId: "agent-9" }, null);
    assert.equal(result, "clicked agent-9");
  });
});

describe("describeOutcome", () => {
  test("every outcome string content.js's own instrumentation can currently produce maps to a distinct, non-blank label", () => {
    const outcomes = [
      "done",
      "stopped",
      "blocked",
      "stalled",
      "max_steps_reached",
      "capture_failed",
      "analyze_failed",
      "act_failed",
      "section5_violation",
    ];
    const seen = new Set();
    for (const outcome of outcomes) {
      const { label, tone } = describeOutcome(outcome);
      assert.ok(label && label.length > 0, `outcome ${outcome} must have a non-empty label`);
      assert.ok(["success", "neutral", "warning", "error"].includes(tone), `outcome ${outcome} must have a valid tone`);
      seen.add(label);
    }
    assert.equal(seen.size, outcomes.length, "every outcome must render a DISTINCT label -- none may collide");
  });

  test("'stopped' is never confusable with 'done' or 'stalled' -- distinct label AND distinct tone from both", () => {
    const stopped = describeOutcome("stopped");
    const done = describeOutcome("done");
    const stalled = describeOutcome("stalled");
    assert.notEqual(stopped.label, done.label);
    assert.notEqual(stopped.label, stalled.label);
    assert.notEqual(stopped.tone, done.tone, "stopped must not render with the same tone as a successful completion");
  });

  test("null/undefined outcome (still running) renders as a neutral 'In progress', not blank or an error", () => {
    assert.deepEqual(describeOutcome(null), { label: "In progress", tone: "neutral" });
    assert.deepEqual(describeOutcome(undefined), { label: "In progress", tone: "neutral" });
  });

  test("an unrecognized outcome string renders AS ITSELF rather than being swallowed or shown blank", () => {
    const result = describeOutcome("some_future_outcome_not_yet_mapped");
    assert.equal(result.label, "some_future_outcome_not_yet_mapped");
    assert.equal(result.tone, "neutral");
  });

  test("'done' renders with a success tone", () => {
    assert.equal(describeOutcome("done").tone, "success");
  });

  test("act_failed and section5_violation both render with an error tone (they are genuine failures, not deliberate stops)", () => {
    assert.equal(describeOutcome("act_failed").tone, "error");
    assert.equal(describeOutcome("section5_violation").tone, "error");
  });

  // REPORTING FIX (coordinator, 2026-09-13): a guard deliberately refusing
  // an action (SENSITIVE_TARGET_BLOCKED / IRREVERSIBLE_ACTION_BLOCKED) is
  // the safeguard working, not a failure. Before this fix both a guard
  // refusal AND a genuine execution failure were folded into one outcome,
  // "act_failed" -- rendered as "Blocked or failed to act", directly
  // contradicting the popup's own "a BLOCKED banner means the safeguard
  // worked" copy. These tests lock in the split: "blocked" reads as a
  // deliberate, successful stop; "act_failed" stays reserved for a
  // genuine failure; and the two can never again collapse into each other.
  describe("'blocked' -- the guard-refusal outcome, split out from 'act_failed'", () => {
    test("renders with a success tone, never an error tone", () => {
      assert.equal(describeOutcome("blocked").tone, "success");
    });

    test("label reads as deliberate protection, never uses the word 'failed'", () => {
      const { label } = describeOutcome("blocked");
      assert.ok(label && label.length > 0);
      assert.ok(!/fail/i.test(label), `"blocked" label must never say "failed" -- got: "${label}"`);
    });

    test("is distinguishable from 'act_failed' -- distinct label AND distinct tone", () => {
      const blocked = describeOutcome("blocked");
      const actFailed = describeOutcome("act_failed");
      assert.notEqual(blocked.label, actFailed.label);
      assert.notEqual(blocked.tone, actFailed.tone, "a guard refusal must not render with the same tone as a genuine execution failure");
    });

    test("act_failed's own label no longer mentions being blocked -- the two outcomes must never be conflated in either direction", () => {
      const { label } = describeOutcome("act_failed");
      assert.ok(!/block/i.test(label), `"act_failed" label must not describe a blocked/refused action -- got: "${label}"`);
    });

    test("is distinguishable from 'done' and 'stopped' by label (even though 'blocked' and 'done' may legitimately share a success tone)", () => {
      const blocked = describeOutcome("blocked");
      assert.notEqual(blocked.label, describeOutcome("done").label);
      assert.notEqual(blocked.label, describeOutcome("stopped").label);
    });
  });
});

// ===========================================================================
// V4b (integration-v2, part B): consent-panel helpers.
// ===========================================================================
describe("phraseForValueToken", () => {
  test("PROFILE-prefixed tokens -> 'your saved <category>'", () => {
    assert.equal(phraseForValueToken("PROFILEEMAIL#1"), "your saved email");
    assert.equal(phraseForValueToken("PROFILENAME#1"), "your saved name");
    assert.equal(phraseForValueToken("PROFILEPHONE#2"), "your saved phone number");
  });

  test("ordinary regex/NER token prefixes -> a category phrase, never the token itself", () => {
    assert.equal(phraseForValueToken("EMAIL#1"), "a previously-seen email address");
    assert.equal(phraseForValueToken("PERSONNAME#3"), "a previously-seen name");
    assert.equal(phraseForValueToken("AADHAAR#1"), "a previously-seen Aadhaar-shaped number");
  });

  test("an unrecognized-but-token-shaped prefix still degrades to a safe generic phrase", () => {
    assert.equal(phraseForValueToken("SOMENEWLABEL#7"), "a previously-seen value");
  });

  test("non-token-shaped value -> null (caller must say nothing about it, never fall back to printing it)", () => {
    assert.equal(phraseForValueToken("mock-input"), null);
    assert.equal(phraseForValueToken("hunter2"), null);
    assert.equal(phraseForValueToken(""), null);
    assert.equal(phraseForValueToken(null), null);
    assert.equal(phraseForValueToken(undefined), null);
    assert.equal(phraseForValueToken(42), null);
  });
});

describe("describePendingAction", () => {
  test("type with a PROFILE token value into a labeled sensitive field -> 'type your saved email into <label>', never the value", () => {
    const element = { agentId: "agent-2", tag: "input", type: "email", label: "Email" };
    const result = describePendingAction({ action: "type", targetId: "agent-2", value: "PROFILEEMAIL#1" }, element);
    assert.equal(result, "type your saved email into 'Email'");
  });

  test("type with an ordinary (non-token) value -> value is never printed, only the target", () => {
    const element = { agentId: "agent-4", tag: "input", type: "text", label: "Full name" };
    const result = describePendingAction({ action: "type", targetId: "agent-4", value: "some plain text" }, element);
    assert.ok(!result.includes("some plain text"), "the raw value must never appear in a consent description");
    assert.equal(result, "type into 'Full name'");
  });

  test("click with a labeled element -> 'click <label>'", () => {
    const element = { agentId: "agent-6", tag: "button", label: "Place Order" };
    assert.equal(describePendingAction({ action: "click", targetId: "agent-6" }, element), "click 'Place Order'");
  });

  test("page-level action (no element) degrades to a generic phrase, never throws", () => {
    assert.equal(describePendingAction({ action: "click", targetId: "page" }, null), "click an element");
    assert.equal(describePendingAction({ action: "scroll", targetId: "page" }, null), "scroll the page");
    assert.equal(describePendingAction({ action: "done", targetId: "page" }, null), "mark the task as done");
  });

  test("press_key includes the (safe, closed-enum) key name but not the target's value", () => {
    const element = { agentId: "agent-9", tag: "input", label: "Search" };
    const result = describePendingAction({ action: "press_key", targetId: "agent-9", key: "Enter" }, element);
    assert.equal(result, "press Enter on 'Search'");
  });

  test("fill_profile names the category, not the vault value, even if one is (incorrectly) present", () => {
    const element = { agentId: "agent-2", tag: "input", label: "Email" };
    const result = describePendingAction(
      { action: "fill_profile", targetId: "agent-2", value: "vault-secret@example.com", profileField: "email" },
      element
    );
    assert.ok(!result.includes("vault-secret@example.com"));
    assert.equal(result, "fill 'Email' with your saved email");
  });

  test("malformed/missing action never throws", () => {
    assert.equal(describePendingAction(null, null), "perform an action");
    assert.equal(describePendingAction({}, null), "perform an action");
  });
});

describe("describePolicyReason", () => {
  test("SENSITIVE_TARGET -> plain-English sensitivity explanation", () => {
    assert.match(describePolicyReason("SENSITIVE_TARGET"), /sensitive/i);
  });

  test("IRREVERSIBLE_ACTION -> plain-English 'hard to undo' explanation", () => {
    assert.match(describePolicyReason("IRREVERSIBLE_ACTION"), /undo/i);
  });

  test("INTENT_MISMATCH and SERVER_TIGHTENED each render their own distinct sentence", () => {
    const intentMismatch = describePolicyReason("INTENT_MISMATCH");
    const serverTightened = describePolicyReason("SERVER_TIGHTENED");
    assert.notEqual(intentMismatch, serverTightened);
    assert.ok(intentMismatch.length > 0 && serverTightened.length > 0);
  });

  test("an unrecognized code still renders a safe, non-empty generic sentence rather than the raw code or nothing", () => {
    const result = describePolicyReason("SOME_FUTURE_CODE");
    assert.ok(result.length > 0);
    assert.ok(!result.includes("SOME_FUTURE_CODE"));
  });

  test("null/undefined code degrades to the same generic sentence, never throws", () => {
    assert.equal(describePolicyReason(null), describePolicyReason(undefined));
  });
});
