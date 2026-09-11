// SIH 26171 -- Tier 2, action-risk.js
//
// classifyActionRisk(domNode, actionJson) -> { risk: "safe"|"irreversible", reasons: string[] }
//
// PROBLEM THIS SOLVES: action-executor.js's existing safety guard (see
// that file's guardSensitive()) only ever blocks click/type on an element
// flagged SENSITIVE -- i.e. a field carrying PII, dom-scanner.js's domain.
// It has no concept of a DESTRUCTIVE action: a "Buy Now" button, a
// "Delete account" link, a "Place Order" submit input are not PII --
// nobody's password or email lives on them -- so the existing guard lets
// an autonomous agent click them without a second thought. This module is
// the classifier half of closing that gap. Per the task brief: build the
// CLASSIFIER only; do NOT wire it into action-executor.js, that file
// belongs to another agent.
//
// ARCHITECTURE (same pattern as dom-scanner.js / element-ranker.js): a
// pure function over plain data, zero DOM/browser dependency, fully
// deterministic, unit-testable in plain Node with zero extra test
// dependencies -- there is no HTML to parse here, only strings already
// extracted from whatever DOM/DomNode-shaped object the caller has on
// hand.
//
// -----------------------------------------------------------------------
// WHY `domNode` ISN'T STRICTLY server/schemas.py::DomNode:
//   The task brief explicitly asks this classifier to look at "element
//   text, value, aria-label, name, id, and type." server/schemas.py's
//   DomNode (the shape element-ranker.js and the /analyze wire format
//   use) has `text` and `type` but no `value`/`ariaLabel`/`name`/`id`
//   fields of its own -- action-executor.js's getAccessibleText() already
//   folds value/aria-label/placeholder into DomNode.text before it ever
//   reaches that shape (see that file's getAccessibleText() docstring).
//   That's fine for a VLM reading one merged label, but it's LOSSY for
//   this classifier: an icon-only "Delete" button with
//   `id="delete-account-btn"` but no visible text and no aria-label
//   resolves to EMPTY DomNode.text, so DomNode alone would miss it
//   entirely. Since action-executor.js executes against the LIVE DOM
//   element right before dispatching an event (see that file's
//   executeAction()/resolveElement()), the most accurate call site for
//   classifyActionRisk() is from THAT live element's real attributes, not
//   the already-lossy DomNode. This module therefore accepts a plain
//   object rather than requiring a literal DomNode, so the wiring agent
//   can pass whichever is available -- passing the live element's
//   attributes directly (recommended, see "HOW TO CONSUME" below) gets
//   strictly more recall than passing only a DomNode.
//   FLAGGED FOR THE ORCHESTRATOR: if the wiring agent can only cheaply
//   get DomNode-shaped data at the call site, `name`/`id`/`ariaLabel`
//   will simply be `undefined` and are skipped, not treated as an error
//   -- reduced recall, not a crash. `text` (present on every DomNode)
//   still catches the majority of real-world cases on its own.
// -----------------------------------------------------------------------
//
// -----------------------------------------------------------------------
// BIAS TOWARD OVER-BLOCKING -- deliberate, the same reasoning
// dom-scanner.js applies to PII (see that file's header: false negatives
// are the dangerous direction):
//
//   A FALSE POSITIVE here blocks a harmless button. Whoever operates the
//   agent sees a refused action and can override it -- the equivalent of
//   action-executor.js's existing allowSensitiveTargets/onSensitiveTarget
//   override hooks is the wiring agent's job for THIS classifier's
//   output, not this file's -- and nothing is lost. Annoying, recoverable,
//   obvious.
//
//   A FALSE NEGATIVE here lets an autonomous agent complete an
//   irreversible action on a real website -- buy something, delete an
//   account, cancel a non-refundable booking -- with real money or real
//   data consequences that cannot be undone by retrying. There is no
//   "oops, let me undo that click" for a payment gateway.
//
//   Given that asymmetry, every keyword-list judgment call below resolves
//   toward recall over precision UNLESS doing so would produce a false
//   positive rate so high it breaks ordinary navigation for everyone --
//   see the bare "cancel"/"reset"/"clear"/"submit" EXCLUSIONS below. That
//   is the one place this file deliberately favors precision, and it
//   explains exactly why right there in the code.
// -----------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Destructive-intent keyword/phrase list.
//
// Longer/more-specific phrases are listed first for readability only --
// matching always prefers the LONGEST matching phrase regardless of list
// order (buildSignalMatchers() sorts candidates by word count, descending,
// before matching -- see below), so a button reading "Buy Now" reports the
// specific "buy now" reason instead of the redundant bare "buy" one.
// ---------------------------------------------------------------------------
export const DESTRUCTIVE_SIGNALS = Object.freeze([
  // --- Purchase / payment intent ---------------------------------------
  // Indian e-commerce (Flipkart/Amazon.in/Myntra-style) checkout flows
  // chain through several of these labels in a single purchase ("Proceed
  // to Buy" -> "Proceed to Pay" -> "Place Order"/"Confirm Order"), so
  // each step needs its own trigger -- a checkout isn't one button, it's
  // several, and missing any one of them is a false negative on a real
  // purchase.
  "buy", "buy now", "purchase", "order now", "place order", "place your order",
  "proceed to buy", "proceed to pay", "proceed to payment", "pay", "pay now",
  "make payment", "submit payment", "complete payment", "complete purchase",
  "complete order", "confirm order", "confirm purchase", "confirm payment",
  "confirm and pay", "confirm & pay", "checkout", "proceed to checkout",
  "complete checkout",
  // Indian-market-specific, not just US phrasing: ticket/appointment
  // booking (IRCTC/BookMyShow/flight-and-hotel-style "Book Now") and
  // mobile/utility recharge ("Recharge Now") both trigger a real, usually
  // non-refundable payment just like a product purchase -- same risk
  // class, different UI vocabulary.
  "book now", "book ticket", "book tickets", "confirm booking", "reserve now",
  "recharge", "recharge now", "top up", "topup",
  "donate", "donate now",

  // --- Account / data destruction ---------------------------------------
  "delete", "remove", "deactivate", "delete account", "deactivate account",
  "close account", "terminate account", "cancel account",
  "cancel subscription", "cancel membership", "cancel order", "cancel booking",
  "unsubscribe", "factory reset", "reset account", "erase", "empty trash",
  "permanently delete",

  // --- Generic, broad, deliberately kept despite the noise --------------
  // "confirm" and "order" alone are genuinely ambiguous ("Confirm Email",
  // "Order History" are common BENIGN uses) but the task brief names both
  // explicitly and the bias above resolves ambiguity toward flagging.
  // This is a documented false-positive cost, not an oversight -- see the
  // report back to the orchestrator and the known-gaps summary below.
  "confirm", "order",
]);

// -----------------------------------------------------------------------
// DELIBERATELY EXCLUDED, despite naming common destructive flows --
// precision-over-recall, the ONE place this file goes that direction (see
// the BIAS block above for why everywhere else goes the other way):
//
//   "cancel" (bare) -- the single most common use of a bare "Cancel"
//     button on the entire web is a modal/dialog's ABORT control: the
//     SAFE choice that lets a user back out of whatever they were about
//     to do. Flagging it would misclassify the escape hatch itself as the
//     danger, and because virtually every dialog has one, it would make
//     this classifier fire on a large fraction of ALL clicks on the
//     modern web -- not a targeted safety net, just noise that trains
//     whoever reads its refusals to ignore them. Compound phrases ARE
//     flagged ("cancel subscription", "cancel membership", "cancel
//     order", "cancel booking", "cancel account") because those
//     unambiguously name what's being cancelled.
//   "reset" (bare) -- "Reset Password" / "Reset filters" are extremely
//     common, benign, and often part of the LEGITIMATE task an agent was
//     asked to complete. "factory reset" / "reset account" ARE flagged
//     (unambiguous).
//   "clear" (bare) -- "Clear form" / "Clear filters", same reasoning.
//   "submit" (bare) -- nearly every ordinary form (contact forms,
//     feedback, profile updates) ends in a "Submit" button; flagging it
//     would block the majority of an agent's routine, harmless task
//     completions. "submit payment" (named explicitly in the task brief)
//     IS flagged.
//
// KNOWN GAP from this carve-out, reported rather than hidden: a genuinely
// destructive control whose ENTIRE accessible signal is the literal bare
// word "Cancel"/"Reset"/"Clear"/"Submit" -- e.g. a "Cancel Subscription"
// button whose text, aria-label, name, AND id are all just "Cancel", with
// no qualifying word anywhere this module can see -- will NOT be flagged.
// This module cannot see surrounding page context (a nearby heading
// reading "Cancel your Premium plan") the way a human or a multimodal
// model looking at the whole screenshot could. This is a scope boundary
// of a pure per-element text classifier, not something fixable by tuning
// this file's keyword list further -- flagged for the orchestrator.
//
// SEPARATE KNOWN GAP: an icon-only destructive control with NO textual
// signal at all available anywhere (no text, no aria-label, no name/id
// hint -- a pure CSS/SVG icon button with zero accessible name) cannot be
// classified as irreversible by this module; it has nothing to read. Out
// of scope for a DOM-text classifier; would need a visual signal.
//
// SEPARATE KNOWN GAP, scope call, not a bug: bare "subscribe" (as opposed
// to "unsubscribe") is deliberately NOT flagged. It is one of the most
// common benign CTAs on the web (newsletter signup) but can also mean
// "start a paid plan" on some sites -- genuinely ambiguous, and the task
// brief's own example list includes "unsubscribe" but not "subscribe".
// Followed literally here; revisit if real target sites are known to gate
// paid commitments behind a bare "Subscribe" button.
// -----------------------------------------------------------------------

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// camelCase / kebab-case / snake_case -> lowercase, space-separated.
// Exists specifically so `id="deleteAccountBtn"` or `name="btn_buy_now"`
// -- common code-level identifiers with no spaces at all -- decompose
// into words this module's phrase matchers can actually find ("delete
// account btn", "btn buy now"). Ordinary already-spaced text passes
// through unaffected beyond lowercasing.
function decompose(raw) {
  let s = String(raw);
  s = s.replace(/([a-z0-9])([A-Z])/g, "$1 $2"); // camelCase boundary
  s = s.replace(/[-_]+/g, " "); // kebab-case / snake_case
  return s.toLowerCase();
}

/**
 * Build {phrase, pattern} matchers from a phrase list, longest phrase
 * (most words) first so the most specific match wins -- see the comment
 * above DESTRUCTIVE_SIGNALS. Exported so a caller can build a custom
 * matcher set (options.matchers on classifyActionRisk) from an extended
 * or trimmed phrase list without forking this file.
 */
export function buildSignalMatchers(phrases = DESTRUCTIVE_SIGNALS) {
  return phrases
    .slice()
    .sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length || a.localeCompare(b))
    .map((phrase) => ({
      phrase,
      pattern: new RegExp(
        "\\b" + phrase.trim().split(/\s+/).map(escapeRegExp).join("\\s+") + "\\b",
        "i"
      ),
    }));
}

const SIGNAL_MATCHERS = buildSignalMatchers();

function matchDestructiveSignalWith(matchers, text) {
  if (!text) return null;
  const decomposed = decompose(text);
  for (const { phrase, pattern } of matchers) {
    if (pattern.test(decomposed)) return phrase;
  }
  return null;
}

/** Convenience export using the default DESTRUCTIVE_SIGNALS matcher set. */
export function matchDestructiveSignal(text) {
  return matchDestructiveSignalWith(SIGNAL_MATCHERS, text);
}

// ---------------------------------------------------------------------------
// Field extraction. Every field is optional; missing ones are simply
// skipped (never an error) -- see the "WHY domNode ISN'T STRICTLY..." note
// at the top of the file for why `value`/`name`/`id`/`ariaLabel` may not
// be present depending on what the caller had on hand.
//
// Both `ariaLabel` (camelCase, matching a plain-object convention) and the
// literal `"aria-label"` HTML attribute key are accepted, so a caller can
// pass either `el.getAttribute("aria-label")` under either key without
// having to remember which this module expects.
//
// Order below is the order fields are checked in and therefore the order
// `reasons` entries can appear in for a single call: text (what a human
// reads) first, then value (an <input type=submit>'s own visible label --
// see the file-header brief: "Cover both <button> text and
// <input type="submit" value="...">"), then ariaLabel (accessible name),
// then name/id (code-level identifiers, catch icon-only controls text
// alone misses), then type last (weakest signal -- see below).
// ---------------------------------------------------------------------------
function collectFieldSignals(node) {
  const n = node || {};
  const ariaLabel = n.ariaLabel !== undefined ? n.ariaLabel : n["aria-label"];
  return [
    { field: "text", value: n.text },
    { field: "value", value: n.value },
    { field: "ariaLabel", value: ariaLabel },
    { field: "name", value: n.name },
    { field: "id", value: n.id },
    { field: "type", value: n.type },
  ];
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ActionRiskResult
 * @property {"safe"|"irreversible"} risk
 * @property {string[]} reasons Human-readable, so a UI can explain a
 *   refusal instead of just saying "blocked" -- e.g.
 *   ["value matches destructive-intent keyword \"buy now\""].
 *   Empty when risk is "safe".
 */

/**
 * Classify whether executing `actionJson` against `domNode` would trigger
 * an irreversible/destructive action.
 *
 * @param {{tag?, type?, text?, value?, name?, id?, ariaLabel?, "aria-label"?}} domNode
 *   Permissive on purpose -- see the file-header note on why this isn't
 *   strictly server/schemas.py::DomNode. Pass whatever subset of fields
 *   is available; anything missing is simply not checked, not an error.
 * @param {{action: "click"|"type"|"scroll"|"done", targetId: string, value?: string}} actionJson
 *   Matches server/schemas.py::ActionResponse.
 * @param {{matchers?: Array<{phrase:string, pattern:RegExp}>}} [options]
 *   `options.matchers` overrides the default DESTRUCTIVE_SIGNALS matcher
 *   set (build one with buildSignalMatchers(customPhraseList)) --
 *   injectable per this repo's established style, for callers who need a
 *   tuned/extended keyword list without forking this file.
 * @returns {ActionRiskResult}
 */
export function classifyActionRisk(domNode, actionJson, options = {}) {
  const action = actionJson && actionJson.action;

  // scroll/done never write to or trigger a specific element's own
  // behaviour -- consistent with action-executor.js's own sensitive-guard
  // scoping (see that file's guardSensitive() docstring: "Scoped to
  // click/type only ... scroll/done are not gated"). Scrolling a "Delete
  // Account" button into view does not press it.
  if (action !== "click" && action !== "type") {
    return { risk: "safe", reasons: [] };
  }

  const matchers = options.matchers || SIGNAL_MATCHERS;
  const reasons = [];

  for (const { field, value } of collectFieldSignals(domNode)) {
    const hit = matchDestructiveSignalWith(matchers, value);
    if (hit) reasons.push(`${field} matches destructive-intent keyword ${JSON.stringify(hit)}`);
  }

  // Extra recall for the "type DELETE to confirm"-style destructive
  // confirmation pattern: the VALUE the agent is about to type can itself
  // carry destructive intent even when the target element's own
  // text/value/etc. is generic (a plain confirmation textbox). Scoped to
  // `type` only -- there is no "value being typed" for a click.
  if (action === "type" && actionJson && typeof actionJson.value === "string" && actionJson.value.trim() !== "") {
    const hit = matchDestructiveSignalWith(matchers, actionJson.value);
    if (hit) reasons.push(`typed value matches destructive-intent keyword ${JSON.stringify(hit)}`);
  }

  return reasons.length > 0 ? { risk: "irreversible", reasons } : { risk: "safe", reasons: [] };
}

// ---------------------------------------------------------------------------
// Exposed for testing / advanced callers -- not required for normal use.
// ---------------------------------------------------------------------------
export const _internal = {
  decompose,
  collectFieldSignals,
  matchDestructiveSignalWith,
};

// ---------------------------------------------------------------------------
// HOW TO CONSUME THIS MODULE (for whichever agent wires this into
// action-executor.js -- NOT done by this file, per the task brief):
//
//   import { classifyActionRisk } from "./action-risk.js";
//
//   Call it inside executeAction(), right where guardSensitive() already
//   runs -- action-executor.js resolves the live `el` via resolveElement()
//   before dispatching, which is the highest-fidelity point to read
//   value/name/id/aria-label straight off the real DOM element (not the
//   already-lossy domSnapshot -- see the file-header note on why):
//
//     var risk = classifyActionRisk({
//       tag: el.tagName.toLowerCase(),
//       type: el.getAttribute("type"),
//       text: getAccessibleText(el),        // action-executor.js already has this
//       value: el.value,
//       ariaLabel: el.getAttribute("aria-label"),
//       name: el.getAttribute("name"),
//       id: el.id,
//     }, actionJson);
//
//     if (risk.risk === "irreversible") {
//       throw new ActionExecutionError(
//         "IRREVERSIBLE_ACTION_BLOCKED",
//         "action blocked: " + risk.reasons.join("; "),
//         { reasons: risk.reasons }
//       );
//     }
//
//   This mirrors guardSensitive()'s existing shape/error style on purpose
//   (structured code + human-readable reasons, fail-closed by default, no
//   silent no-op) so the two guards read as one consistent safety layer,
//   not two bolted-together mechanisms.
//
//   LEFT FOR THE action-executor.js OWNER TO DECIDE, not decided silently
//   here (per the task brief -- flag, don't wire):
//     - the exact error `code` string to use (a distinct
//       IRREVERSIBLE_ACTION_BLOCKED vs reusing SENSITIVE_TARGET_BLOCKED --
//       Chief separately approved "extending that block to irreversible
//       actions", which reads as a distinct policy, so a distinct code
//       is recommended but not this file's call to make);
//     - whether an allowIrreversibleActions/onIrreversibleAction override
//       hook should mirror guardSensitive()'s existing
//       options.allowSensitiveTargets/onSensitiveTarget pattern;
//     - where in executeAction() this check runs relative to
//       guardSensitive() (recommend: after, since a sensitive-target
//       block already fails closed and there's no reason to run a second
//       check once the first has already refused);
//     - whether classifyActionRisk() runs on EVERY click/type or only
//       ones guardSensitive() didn't already block.
// ---------------------------------------------------------------------------
