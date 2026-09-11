// SIH 26171 -- Tier 2, action-risk.js unit tests.
//
// Runs under plain Node, zero extra dependencies (no jsdom needed -- this
// module's input is already plain data, there is no HTML to parse).
//
// Run with: node --test tests/unit/test_action_risk.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  classifyActionRisk,
  buildSignalMatchers,
  matchDestructiveSignal,
  DESTRUCTIVE_SIGNALS,
  _internal,
} from "../../extension/lib/action-risk.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");

function loadFixture(filename) {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, filename), "utf8"));
}

// ---------------------------------------------------------------------------
// Golden fixtures -- each is a self-contained (domNode, actionJson) ->
// expected {risk, reasonIncludes?} scenario. See each fixture's own
// "_comment" for why it exists and, for the false-positive fixtures, why
// the over-block is accepted rather than a bug.
// ---------------------------------------------------------------------------
const GOLDEN_FIXTURES = [
  ["action_risk_buy_now_button.json", "buy now button (<button> text)"],
  ["action_risk_place_order_flipkart_style.json", "input[type=submit] value=\"Place Order\" (Flipkart/Amazon.in-style)"],
  ["action_risk_input_submit_value_pay_now.json", "input[type=submit] value=\"Pay Now\""],
  ["action_risk_delete_account_button.json", "delete account button"],
  ["action_risk_icon_only_destructive_id.json", "icon-only button, destructive intent only in a camelCase id"],
  ["action_risk_benign_cancel_dialog.json", "bare 'Cancel' modal abort control -- must NOT be flagged"],
  ["action_risk_benign_submit_contact_form.json", "bare 'Submit' contact form -- must NOT be flagged"],
  ["action_risk_benign_reset_password.json", "'Reset Password' -- must NOT be flagged"],
  ["action_risk_cancel_subscription_compound.json", "'Cancel Subscription' -- compound phrase, must be flagged"],
  ["action_risk_recharge_now_indian.json", "Indian-market 'Recharge Now'"],
  ["action_risk_book_now_travel_booking.json", "Indian-market travel/ticket 'Book Now'"],
  ["action_risk_add_to_cart_not_flagged.json", "'Add to Cart' -- reversible, must NOT be flagged"],
  ["action_risk_track_order_false_positive.json", "'Track Order' -- documented accepted false positive"],
  ["action_risk_confirm_email_false_positive.json", "'Confirm Email' -- documented accepted false positive"],
];

describe("golden fixtures (domNode + actionJson -> expected risk)", () => {
  for (const [filename, description] of GOLDEN_FIXTURES) {
    test(`${filename}: ${description}`, () => {
      const fixture = loadFixture(filename);
      const result = classifyActionRisk(fixture.domNode, fixture.actionJson);
      assert.equal(result.risk, fixture.expected.risk, `risk mismatch for ${filename}`);
      if (fixture.expected.risk === "irreversible") {
        assert.ok(result.reasons.length > 0, `${filename}: irreversible result must carry at least one reason`);
        const joined = result.reasons.join(" | ");
        assert.ok(
          joined.toLowerCase().includes(fixture.expected.reasonIncludes.toLowerCase()),
          `${filename}: expected reasons to mention ${JSON.stringify(fixture.expected.reasonIncludes)}, got ${JSON.stringify(result.reasons)}`
        );
      } else {
        assert.deepEqual(result.reasons, [], `${filename}: safe result must carry no reasons`);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Action-type scoping: scroll/done never trigger element behaviour, so they
// must NEVER be flagged irreversible regardless of how destructive the
// target element looks -- mirrors action-executor.js's own guardSensitive()
// scoping (click/type only).
// ---------------------------------------------------------------------------
describe("action-type scoping: scroll/done are never flagged, regardless of element content", () => {
  const destructiveNode = { tag: "button", type: "button", text: "Delete Account Permanently" };

  test("scroll onto a destructive button is safe", () => {
    const result = classifyActionRisk(destructiveNode, { action: "scroll", targetId: "agent-1" });
    assert.deepEqual(result, { risk: "safe", reasons: [] });
  });

  test("done referencing a destructive button is safe", () => {
    const result = classifyActionRisk(destructiveNode, { action: "done", targetId: "agent-1" });
    assert.deepEqual(result, { risk: "safe", reasons: [] });
  });

  test("scroll on the page sentinel is safe", () => {
    const result = classifyActionRisk(destructiveNode, { action: "scroll", targetId: "page" });
    assert.deepEqual(result, { risk: "safe", reasons: [] });
  });
});

// ---------------------------------------------------------------------------
// Typed-value recall: the "type DELETE to confirm"-style destructive
// confirmation pattern, where the target element itself is generic but the
// VALUE the agent is about to type carries destructive intent.
// ---------------------------------------------------------------------------
describe("typed value carries its own destructive-intent signal (action=type only)", () => {
  test("typing a destructive phrase into a generic confirmation textbox is flagged", () => {
    const genericTextbox = { tag: "input", type: "text", text: "", value: "", name: "confirm-input" };
    const result = classifyActionRisk(genericTextbox, {
      action: "type",
      targetId: "agent-2",
      value: "DELETE MY ACCOUNT",
    });
    assert.equal(result.risk, "irreversible");
    assert.ok(result.reasons.some((r) => r.startsWith("typed value matches")));
  });

  test("typing an ordinary value into a generic textbox is safe", () => {
    const genericTextbox = { tag: "input", type: "text", text: "" };
    const result = classifyActionRisk(genericTextbox, { action: "type", targetId: "agent-3", value: "hello world" });
    assert.deepEqual(result, { risk: "safe", reasons: [] });
  });

  test("a click action never inspects actionJson.value for typed-value signal (there is nothing being typed)", () => {
    // A click with an (unusual, but not impossible) stray `value` field on
    // the actionJson must not be treated as typed-value recall -- that
    // signal only makes sense for `type`.
    const genericButton = { tag: "button", type: "button", text: "OK" };
    const result = classifyActionRisk(genericButton, { action: "click", targetId: "agent-4", value: "DELETE" });
    assert.deepEqual(result, { risk: "safe", reasons: [] });
  });

  test("an empty/whitespace-only typed value is not treated as a signal", () => {
    const genericTextbox = { tag: "input", type: "text", text: "" };
    const result = classifyActionRisk(genericTextbox, { action: "type", targetId: "agent-5", value: "   " });
    assert.deepEqual(result, { risk: "safe", reasons: [] });
  });
});

// ---------------------------------------------------------------------------
// Multiple independent field signals -- proves reasons[] can carry more
// than one entry when more than one field independently matches, and that
// each field is only checked once (no duplicate reason per field).
// ---------------------------------------------------------------------------
describe("structured reasons: multiple independently-matching fields each produce their own reason", () => {
  test("a button whose text AND id both carry destructive intent produces two distinct reasons", () => {
    const node = { tag: "button", type: "button", text: "Delete", id: "permanently-delete-account" };
    const result = classifyActionRisk(node, { action: "click", targetId: "agent-6" });
    assert.equal(result.risk, "irreversible");
    assert.equal(result.reasons.length, 2);
    assert.ok(result.reasons.some((r) => r.startsWith("text matches")));
    assert.ok(result.reasons.some((r) => r.startsWith("id matches")));
  });

  test("field check order is text, value, ariaLabel, name, id, type", () => {
    const node = {
      tag: "button",
      type: "button",
      text: "Buy",
      value: "Buy",
      ariaLabel: "Buy",
      name: "buy",
      id: "buy",
    };
    const result = classifyActionRisk(node, { action: "click", targetId: "agent-7" });
    const fieldsInOrder = result.reasons.map((r) => r.split(" ")[0]);
    assert.deepEqual(fieldsInOrder, ["text", "value", "ariaLabel", "name", "id"]);
  });
});

// ---------------------------------------------------------------------------
// aria-label field acceptance -- both the camelCase convention and the
// literal HTML attribute key must work, since callers may pass either.
// ---------------------------------------------------------------------------
describe("aria-label field: accepts both `ariaLabel` and the literal `aria-label` key", () => {
  test("ariaLabel (camelCase) is read", () => {
    const node = { tag: "button", type: "button", text: "", ariaLabel: "Delete my account" };
    const result = classifyActionRisk(node, { action: "click", targetId: "agent-8" });
    assert.equal(result.risk, "irreversible");
  });

  test("'aria-label' (literal HTML attribute key) is read as a fallback", () => {
    const node = { tag: "button", type: "button", text: "", "aria-label": "Delete my account" };
    const result = classifyActionRisk(node, { action: "click", targetId: "agent-9" });
    assert.equal(result.risk, "irreversible");
  });

  test("camelCase `ariaLabel`, if present (even empty string), takes precedence over the kebab key", () => {
    const node = { tag: "button", type: "button", text: "", ariaLabel: "", "aria-label": "Delete my account" };
    const result = classifyActionRisk(node, { action: "click", targetId: "agent-10" });
    // ariaLabel="" wins (explicit empty signal), so the kebab fallback is
    // never consulted -- this click is safe.
    assert.equal(result.risk, "safe");
  });
});

// ---------------------------------------------------------------------------
// Missing/empty domNode -- must never throw, must default to safe absent
// any signal (documented KNOWN GAP: an icon-only control with truly zero
// textual signal cannot be classified irreversible; see action-risk.js).
// ---------------------------------------------------------------------------
describe("missing/empty input handling", () => {
  test("null domNode does not throw and produces safe with no reasons", () => {
    const result = classifyActionRisk(null, { action: "click", targetId: "agent-11" });
    assert.deepEqual(result, { risk: "safe", reasons: [] });
  });

  test("undefined domNode does not throw", () => {
    const result = classifyActionRisk(undefined, { action: "click", targetId: "agent-12" });
    assert.deepEqual(result, { risk: "safe", reasons: [] });
  });

  test("empty object domNode is safe", () => {
    const result = classifyActionRisk({}, { action: "click", targetId: "agent-13" });
    assert.deepEqual(result, { risk: "safe", reasons: [] });
  });

  test("null/undefined actionJson does not throw and is treated as a non-click/type action (safe)", () => {
    assert.deepEqual(classifyActionRisk({ text: "Delete" }, null), { risk: "safe", reasons: [] });
    assert.deepEqual(classifyActionRisk({ text: "Delete" }, undefined), { risk: "safe", reasons: [] });
  });
});

// ---------------------------------------------------------------------------
// Determinism -- same input always produces the same output.
// ---------------------------------------------------------------------------
describe("determinism", () => {
  test("calling classifyActionRisk twice with identical input produces byte-identical output", () => {
    const node = { tag: "button", type: "submit", text: "Confirm Purchase", id: "confirm-purchase-btn" };
    const actionJson = { action: "click", targetId: "agent-14" };
    const first = classifyActionRisk(node, actionJson);
    const second = classifyActionRisk(node, actionJson);
    assert.deepEqual(first, second);
  });
});

// ---------------------------------------------------------------------------
// Longest-match-wins and camelCase/kebab/snake decomposition, via the
// exported matchDestructiveSignal()/buildSignalMatchers() helpers directly.
// ---------------------------------------------------------------------------
describe("matchDestructiveSignal / buildSignalMatchers", () => {
  test("prefers the longest matching phrase over a shorter one contained within it", () => {
    assert.equal(matchDestructiveSignal("place your order now"), "place your order");
  });

  test("camelCase identifiers decompose into matchable words", () => {
    assert.equal(matchDestructiveSignal("deleteAccountBtn"), "delete account");
  });

  test("snake_case identifiers decompose into matchable words", () => {
    assert.equal(matchDestructiveSignal("btn_buy_now"), "buy now");
  });

  test("kebab-case identifiers decompose into matchable words", () => {
    assert.equal(matchDestructiveSignal("cancel-subscription-link"), "cancel subscription");
  });

  test("no match returns null", () => {
    assert.equal(matchDestructiveSignal("Home"), null);
  });

  test("falsy input returns null without throwing", () => {
    assert.equal(matchDestructiveSignal(""), null);
    assert.equal(matchDestructiveSignal(null), null);
    assert.equal(matchDestructiveSignal(undefined), null);
  });

  test("word-boundary matching: 'confirmation' does NOT match bare 'confirm'", () => {
    assert.equal(matchDestructiveSignal("Confirmation sent"), null);
  });
});

// ---------------------------------------------------------------------------
// Injectable matcher override (options.matchers) -- the same
// injectable-dependency pattern as dom-scanner.js's getBBox/getAgentId and
// action-executor.js's isSensitive/scrollWindowBy.
// ---------------------------------------------------------------------------
describe("options.matchers override (injectable, per this repo's established style)", () => {
  test("a custom matcher set replaces the default keyword list entirely", () => {
    const customMatchers = buildSignalMatchers(["totally custom destructive phrase"]);
    const node = { tag: "button", type: "button", text: "Buy Now" }; // would normally be flagged
    const result = classifyActionRisk(node, { action: "click", targetId: "agent-15" }, { matchers: customMatchers });
    assert.equal(result.risk, "safe", "the default 'buy now' keyword should not apply once matchers are overridden");
  });

  test("the custom matcher set's own phrase IS detected", () => {
    const customMatchers = buildSignalMatchers(["totally custom destructive phrase"]);
    const node = { tag: "button", type: "button", text: "Totally Custom Destructive Phrase" };
    const result = classifyActionRisk(node, { action: "click", targetId: "agent-16" }, { matchers: customMatchers });
    assert.equal(result.risk, "irreversible");
  });
});

// ---------------------------------------------------------------------------
// Sanity on the shipped keyword list itself.
// ---------------------------------------------------------------------------
describe("DESTRUCTIVE_SIGNALS sanity", () => {
  test("is a non-empty, frozen array of unique lowercase phrases", () => {
    assert.ok(Array.isArray(DESTRUCTIVE_SIGNALS));
    assert.ok(DESTRUCTIVE_SIGNALS.length > 20);
    assert.ok(Object.isFrozen(DESTRUCTIVE_SIGNALS));
    const unique = new Set(DESTRUCTIVE_SIGNALS);
    assert.equal(unique.size, DESTRUCTIVE_SIGNALS.length, "no duplicate phrases");
    for (const phrase of DESTRUCTIVE_SIGNALS) {
      assert.equal(phrase, phrase.toLowerCase(), `phrase ${JSON.stringify(phrase)} should be lowercase in the source list`);
    }
  });

  test("bare 'cancel', 'reset', 'clear', 'submit' are deliberately absent (precision carve-out)", () => {
    assert.ok(!DESTRUCTIVE_SIGNALS.includes("cancel"));
    assert.ok(!DESTRUCTIVE_SIGNALS.includes("reset"));
    assert.ok(!DESTRUCTIVE_SIGNALS.includes("clear"));
    assert.ok(!DESTRUCTIVE_SIGNALS.includes("submit"));
  });

  test("Indian-market phrasing is present (book now, recharge, top up)", () => {
    for (const phrase of ["book now", "recharge", "recharge now", "top up"]) {
      assert.ok(DESTRUCTIVE_SIGNALS.includes(phrase), `expected ${JSON.stringify(phrase)} in DESTRUCTIVE_SIGNALS`);
    }
  });
});

// ---------------------------------------------------------------------------
// _internal.decompose direct tests.
// ---------------------------------------------------------------------------
describe("_internal.decompose", () => {
  test("camelCase boundary", () => {
    assert.equal(_internal.decompose("deleteAccountBtn"), "delete account btn");
  });
  test("kebab-case", () => {
    assert.equal(_internal.decompose("cancel-subscription-link"), "cancel subscription link");
  });
  test("snake_case", () => {
    assert.equal(_internal.decompose("btn_buy_now"), "btn buy now");
  });
  test("already-spaced text passes through, lowercased", () => {
    assert.equal(_internal.decompose("Buy Now"), "buy now");
  });
});
