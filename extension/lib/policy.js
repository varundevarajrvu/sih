// SIH 26171 -- v2 rebuild, Phase V1c, extension/lib/policy.js
//
// Implements contract C4 (docs/v2/ARCHITECTURE.md) exactly. This module
// SUPERSEDES the *verdict* half of action-risk.js (whether an action is
// allowed to proceed) but does NOT replace action-risk.js itself --
// classifyActionRisk()/DESTRUCTIVE_SIGNALS/matchDestructiveSignal are
// IMPORTED and reused verbatim below for the destructive tier, per this
// module's brief ("IMPORT and reuse it for the destructive tier; don't
// copy its lists"). Neither action-risk.js nor action-executor.js is
// edited by this module -- V4 (integration-v2) rewires both to call
// decide()/classifyTier() instead of action-risk.js's own verdict logic.
//
// Pure, ESM (`export`), zero DOM/browser dependency -- same pattern as
// action-risk.js/dom-scanner.js/redaction.js: fixture-in, JSON-out,
// unit-testable in plain Node with `node --test`.
//
// -----------------------------------------------------------------------
// C5 ELEMENT SHAPE consumed here (docs/v2/ARCHITECTURE.md, contract C5's
// `elements[]`):
//   { agentId, tag, role, type, label, bbox:{x,y,w,h}, sensitive, tier }
// `label` is TOKENIZED (V1a's pii-tokenizer.js has already replaced any
// PII with tokens like "EMAIL#1") -- never raw text. That is what makes
// it safe for this module to fold `element.label` into a `reason` string
// below: the label was already sanitized upstream, by construction, not
// by anything this file does.
// -----------------------------------------------------------------------
//
// PORTED FROM francisreubenr-rvu/sih-2026's warden/tiers.py and
// warden/validate.py (downloaded to
// C:\Users\varun\AppData\Local\Temp\claude\...\scratchpad\sih-2026\warden),
// per this module's brief: "Port the ideas: 4 tiers, destructive-intent
// regex on the task, intent-coherence override." Cited at each port site
// below. NOT a straight port -- see the GAP notes at the bottom of this
// file for where the deterministic port necessarily falls short of
// Project B's full validate.py (which also consults an optional local
// reasoning model this module's contract does not include).
// -----------------------------------------------------------------------

import { matchDestructiveSignal } from "./action-risk.js";

// ---------------------------------------------------------------------------
// Closed, frozen enum of codes (contract C4). Deliberately NO "other"
// escape hatch -- unlike server/schemas.py's PiiType (which degrades an
// unanticipated PII type to "other" rather than dropping it, because a
// false negative there is dangerous), every code here names a SPECIFIC
// rule that fired. There is no ambiguous policy outcome that should
// degrade into a catch-all; if a new rule is ever needed, it gets its own
// named code and this enum grows, it does not gain an escape hatch.
// ---------------------------------------------------------------------------
// SERVER_TIGHTENED (added post-review, orchestrator ruling on GAP NOTE 7):
// used ONLY by tightenWithServer() and ONLY when the server strictly
// tightens a LOCAL "accept" (code OK) to ask/reject -- i.e. no local rule
// fired at all, so there is no more specific local code to keep. Every
// other tightening (e.g. local "ask" -> server "reject") keeps the local
// decision's own code unchanged; see tightenWithServer()'s comment below.
// GOAL_TOKENS_COMPLETE (added 2026-09-28, C4 amendment "deterministic task
// completion"): used ONLY by agent-loop-v2.js's own loop-level early-exit
// (isGoalTokenComplete(), defined below) -- NEVER by decide()/
// tightenWithServer(), same non-overlap discipline as SERVER_TIGHTENED
// above. It names "the loop itself ended the run because every goal value
// token was rehydrated and the goal expresses no click intent", which is
// not a decide()-rule outcome at all (decide() is never even consulted for
// this) and must not be confused with POLICY_CODES.OK ("decide() found no
// rule to fire on THIS action") -- the run ending is a completion, not a
// policy verdict.
export const POLICY_CODES = Object.freeze({
  STALE_REVISION: "STALE_REVISION",
  UNKNOWN_TARGET: "UNKNOWN_TARGET",
  RAW_VALUE_IN_ACTION: "RAW_VALUE_IN_ACTION",
  SENSITIVE_TARGET: "SENSITIVE_TARGET",
  IRREVERSIBLE_ACTION: "IRREVERSIBLE_ACTION",
  INTENT_MISMATCH: "INTENT_MISMATCH",
  SERVER_TIGHTENED: "SERVER_TIGHTENED",
  GOAL_TOKENS_COMPLETE: "GOAL_TOKENS_COMPLETE",
  OK: "OK",
});

export const TIERS = Object.freeze(["reversible", "navigational", "state-changing", "destructive"]);

// Mirrors action-executor.js's `PAGE_TARGET_ID = "page"` sentinel exactly
// (lowercase) -- see GAP NOTE 1 at the bottom of this file: contract C5's
// own worked example spells the sentinel "PAGE" (uppercase), which
// disagrees with the shipped codebase constant. This module follows the
// shipped codebase, since the sentinel is a wire-format detail two sides
// (client and server) must agree on byte-for-byte, and only one of those
// sides -- action-executor.js, already in production -- is unambiguous.
const PAGE_TARGET_ID = "page";

// ---------------------------------------------------------------------------
// Destructive-signal detection, shared by classifyTier() and
// checkIntentCoherence(). Reuses action-risk.js's matchDestructiveSignal()
// directly against the C5 element's tokenized `label` (plus `role`/`type`/
// `tag` for completeness) and, for `type`/`fill_profile`/`press_key`
// actions, the action's own `value` -- the same "typed value carries its
// own destructive-intent signal" recall action-risk.js's
// classifyActionRisk() already implements for `type`. This module does
// NOT call classifyActionRisk() itself: that function internally scopes
// to `click`/`type` only, but tier classification also needs the check
// for `press_key` (Enter can submit a destructive form same as a click),
// so the scoping is done here instead, once, and matchDestructiveSignal()
// -- the lower-level primitive action-risk.js exports for exactly this
// kind of reuse -- is called directly.
// ---------------------------------------------------------------------------
function elementDestructiveSignal(element, action) {
  const el = element || {};
  const fields = [el.label, el.role, el.type, el.tag];
  for (const f of fields) {
    const hit = matchDestructiveSignal(f);
    if (hit) return hit;
  }
  const act = action || {};
  if ((act.action === "type" || act.action === "fill_profile" || act.action === "press_key") &&
      typeof act.value === "string" && act.value.trim() !== "") {
    const hit = matchDestructiveSignal(act.value);
    if (hit) return hit;
  }
  return null;
}

const TOGGLE_TYPES = new Set(["checkbox", "radio"]);
const TOGGLE_ROLES = new Set(["checkbox", "radio", "switch"]);
const LINK_ROLES = new Set(["link", "navigation"]);

/**
 * classifyTier(element, action) -> "reversible"|"navigational"|"state-changing"|"destructive"
 *
 * Contract C4's tiering rules, implemented in the order given in
 * ARCHITECTURE.md:
 *   - scroll/done/need_visual                              -> reversible
 *   - click on link/navigation                              -> navigational
 *   - type/fill_profile/press_key Enter in a form/
 *     checkbox toggle/submit                                -> state-changing
 *   - anything matching destructive signals                 -> destructive
 *
 * Destructive-signal matching is checked FIRST within each action branch
 * (a "Delete Account" <a> tag is destructive, not navigational; a "type
 * DELETE to confirm" textbox is destructive, not merely state-changing) --
 * the contract lists the tiers as bullets, not an explicit priority order,
 * so this ordering is a judgment call: destructive is the most specific
 * and highest-consequence signal, so it is checked before the broader
 * structural classification. See GAP NOTE 2 below.
 *
 * @param {{agentId?,tag?,role?,type?,label?,bbox?,sensitive?}} element
 *   The C5 element shape. Permissive -- every field optional.
 * @param {{action?:string,targetId?:string,value?:string|null,key?:string}} action
 *   The C5 ActionResponse shape (plus v1's `key` field for press_key,
 *   which C5's worked example omits but action-executor.js's PressKey
 *   enum requires -- see action-executor.js:851 PRESSABLE_KEYS).
 * @returns {string} one of TIERS.
 */
export function classifyTier(element, action) {
  const act = action || {};
  const kind = act.action;

  if (kind === "scroll" || kind === "done" || kind === "need_visual") return "reversible";

  if (kind === "press_key") {
    // Only Enter can submit a form / trigger a destructive control from
    // the keyboard -- Escape/Tab/Backspace/Arrow* neither write a value
    // nor trigger element behaviour (PRESSABLE_KEYS, action-executor.js).
    // Contract C4 only names "press_key Enter in a form" as
    // state-changing; the tier for the other five keys is not stated.
    // Classified "reversible" here (closest in kind to scroll/navigation
    // keys) -- see GAP NOTE 3.
    if (act.key !== "Enter") return "reversible";
    return elementDestructiveSignal(element, act) ? "destructive" : "state-changing";
  }

  if (kind === "type" || kind === "fill_profile") {
    return elementDestructiveSignal(element, act) ? "destructive" : "state-changing";
  }

  if (kind === "click") {
    if (elementDestructiveSignal(element, act)) return "destructive";
    const el = element || {};
    const type = String(el.type || "").toLowerCase();
    const role = String(el.role || "").toLowerCase();
    const tag = String(el.tag || "").toLowerCase();
    if (TOGGLE_TYPES.has(type) || TOGGLE_ROLES.has(role)) return "state-changing"; // checkbox toggle
    if (type === "submit") return "state-changing"; // submit
    if (tag === "a" || LINK_ROLES.has(role)) return "navigational"; // link/navigation
    // Conservative default for an unclassified click target -- PORTED from
    // Project B's warden/tiers.py op_tier(): "Conservative default (same
    // reasoning as op-tier.mjs's click branch): anything not proven
    // reversible stops for confirmation." See GAP NOTE 4.
    return "state-changing";
  }

  // Unrecognized/missing action kind -- not one of C5's documented action
  // types. Defensive only; conservative rather than silently reversible.
  return "state-changing";
}

// ---------------------------------------------------------------------------
// checkIntentCoherence -- PORTED from warden/tiers.py's
// DESTRUCTIVE_INTENT_RE / expresses_destructive_intent() (semantics
// unchanged, regex copied verbatim) and the spirit of
// apply_intent_coherence()'s override condition. NOT a straight port: v3/
// Project B's has_destructive_control() looks across the WHOLE scene for
// any destructive control; this module's checkIntentCoherence() signature
// per contract C4 is (taskGoalTokenized, element, action) -- scoped to the
// single action being decided, with no scene parameter. So this is the
// same regex-driven idea applied at per-action granularity: "does the
// task's destructive language agree with THIS action's own target",
// rather than "does the scene contain a destructive control somewhere".
// See GAP NOTE 5 for the probe-table row this narrower, per-action version
// cannot catch.
// ---------------------------------------------------------------------------
const DESTRUCTIVE_INTENT_RE =
  /\b(delete|remove|deactivat(?:e|ing|ed)|terminat(?:e|ing|ed)|eras(?:e|ing|ed)|destroy(?:ing|ed)?)\b|\bclose (?:my|the) account\b|\bcancel (?:my|the) (?:account|subscription)\b/i;

/** Ported verbatim (semantics unchanged) from warden/tiers.py's expresses_destructive_intent(). */
export function expressesDestructiveIntent(taskGoal) {
  return DESTRUCTIVE_INTENT_RE.test(taskGoal || "");
}

/**
 * checkIntentCoherence(taskGoalTokenized, element, action) -> { coherent: boolean, reason: string|null }
 *
 * Ported idea from warden/tiers.py's apply_intent_coherence(): when the
 * task expresses destructive intent, the action being taken should itself
 * carry a matching destructive signal -- otherwise the model is doing
 * something other than what the task asked for, which is exactly the
 * "the model wrote hunter2, not the real password" class of red flag the
 * whole architecture is built to catch, just for intent instead of PII.
 *
 * @param {string} taskGoalTokenized
 * @param {object} element C5 element shape.
 * @param {object} action C5 ActionResponse shape.
 * @returns {{coherent: boolean, reason: string|null}}
 */
export function checkIntentCoherence(taskGoalTokenized, element, action) {
  if (!expressesDestructiveIntent(taskGoalTokenized)) {
    return { coherent: true, reason: null };
  }
  if (elementDestructiveSignal(element, action)) {
    return { coherent: true, reason: null };
  }
  return {
    coherent: false,
    reason: "task goal expresses destructive intent but this action's target does not match a destructive control",
  };
}

// ---------------------------------------------------------------------------
// decide() -- the 7 ordered rules of contract C4, first match wins.
// ---------------------------------------------------------------------------

function sceneElements(scene) {
  if (Array.isArray(scene)) return scene;
  if (scene && Array.isArray(scene.elements)) return scene.elements;
  return [];
}

function targetInScene(scene, targetId) {
  if (targetId === PAGE_TARGET_ID) return true; // the page sentinel is never "in" the elements list
  return sceneElements(scene).some((el) => el && el.agentId === targetId);
}

/**
 * Rule 3 (RAW_VALUE_IN_ACTION). Contract text: "a `type` value contains
 * any raw TokenMap value". Implemented against ANY action carrying a
 * string `.value` (not scoped to `action === "type"` alone) -- a
 * deliberate widening, not a narrowing: `fill_profile`/`press_key` do not
 * normally carry a model-chosen value, but if one somehow arrived on the
 * wire with a raw PII value embedded, refusing it is strictly safer than
 * only checking `type`. Same recall-over-precision bias this codebase
 * applies everywhere else PII egress is at stake. See GAP NOTE 6.
 *
 * `reason` NEVER includes the matched raw value itself -- only that a
 * match occurred. `tokenValues` values must never appear in output.
 */
function actionCarriesRawValue(action, tokenValues) {
  const act = action || {};
  if (typeof act.value !== "string" || act.value === "") return false;
  if (!tokenValues) return false;
  for (const raw of tokenValues) {
    if (typeof raw === "string" && raw !== "" && act.value.includes(raw)) return true;
  }
  return false;
}

/**
 * decide({action, element, scene, currentRevision, taskGoal, tokenValues}) -> { verdict, code, reason }
 *
 * The 7 ordered rules of contract C4 -- first match wins:
 *   1. reject STALE_REVISION  -- action.revision !== currentRevision
 *   2. reject UNKNOWN_TARGET  -- action.targetId not present in scene
 *   3. reject RAW_VALUE_IN_ACTION -- action.value contains a raw TokenMap value
 *   4. ask    SENSITIVE_TARGET    -- element.sensitive === true
 *   5. ask    IRREVERSIBLE_ACTION -- tier === "destructive"
 *   6. ask    INTENT_MISMATCH     -- tier state-changing/destructive AND not intent-coherent
 *   7. accept
 *
 * `element` is the CALLER-RESOLVED target element (or null/undefined if
 * unresolved) -- this function does not re-derive it from `scene`; `scene`
 * is consulted only for rule 2. This matches the literal signatures given
 * in contract C4 for classifyTier(element, action) and
 * checkIntentCoherence(taskGoalTokenized, element, action), neither of
 * which takes `scene`.
 *
 * @param {object} params
 * @param {{action?:string,targetId?:string,value?:string|null,revision?:string,key?:string}} params.action
 * @param {object|null|undefined} params.element C5 element shape, or absent for a page-level action.
 * @param {Array|{elements:Array}} params.scene
 * @param {string} params.currentRevision
 * @param {string} params.taskGoal tokenized task goal string.
 * @param {Iterable<string>} [params.tokenValues] raw TokenMap values; used ONLY for rule 3, NEVER echoed.
 * @returns {{verdict: "accept"|"ask"|"reject", code: string, reason: string}}
 */
export function decide(params) {
  const { action, element, scene, currentRevision, taskGoal, tokenValues } = params || {};
  const act = action || {};

  // Rule 1 -- STALE_REVISION. A missing/mismatched revision is treated as
  // stale (fail-closed): strict equality, no special-case for `undefined`.
  if (act.revision !== currentRevision) {
    return {
      verdict: "reject",
      code: POLICY_CODES.STALE_REVISION,
      reason: "action's revision does not match the current scene revision",
    };
  }

  // Rule 2 -- UNKNOWN_TARGET.
  if (!targetInScene(scene, act.targetId)) {
    return {
      verdict: "reject",
      code: POLICY_CODES.UNKNOWN_TARGET,
      reason: "targetId is not present in the current scene",
    };
  }

  // Rule 3 -- RAW_VALUE_IN_ACTION.
  if (actionCarriesRawValue(act, tokenValues)) {
    return {
      verdict: "reject",
      code: POLICY_CODES.RAW_VALUE_IN_ACTION,
      reason: "action value contains a raw, untokenized value -- the model must reference PII exclusively via tokens",
    };
  }

  // Rule 4 -- SENSITIVE_TARGET.
  if (element && element.sensitive === true) {
    return {
      verdict: "ask",
      code: POLICY_CODES.SENSITIVE_TARGET,
      reason: "target element is flagged sensitive",
    };
  }

  const tier = classifyTier(element, act);

  // Rule 5 -- IRREVERSIBLE_ACTION.
  if (tier === "destructive") {
    return {
      verdict: "ask",
      code: POLICY_CODES.IRREVERSIBLE_ACTION,
      reason: "action tier is destructive (reuses action-risk.js DESTRUCTIVE_SIGNALS)",
    };
  }

  // Rule 6 -- INTENT_MISMATCH. Written per the contract's literal wording
  // ("tier state-changing/destructive and not intent-coherent") even
  // though `tier === "destructive"` can never reach here in practice --
  // rule 5 above already returns for every destructive tier. Kept for
  // robustness/clarity against the contract text rather than optimized
  // away, in case rule ordering is ever revisited upstream.
  if (tier === "state-changing" || tier === "destructive") {
    const coherence = checkIntentCoherence(taskGoal, element, act);
    if (!coherence.coherent) {
      return { verdict: "ask", code: POLICY_CODES.INTENT_MISMATCH, reason: coherence.reason };
    }
  }

  // Rule 7 -- accept.
  return { verdict: "accept", code: POLICY_CODES.OK, reason: "no policy rule blocked this action" };
}

// ---------------------------------------------------------------------------
// tightenWithServer(localDecision, serverVerdict) -> stricter of the two.
//
// Contract C4 / V2 invariant 3: "A server-supplied verdict can only make
// the local verdict stricter (accept -> ask, anything -> reject), never
// looser." `serverVerdict` is the C5 response's `serverVerdict` field --
// per contract C5 that is a bare string ("accept"|"ask"|"reject"), not an
// object, so that is the documented input shape; a `{verdict, reason}`
// object is also accepted defensively (its `.verdict` is read) in case a
// caller has a richer server result on hand, but this is not required by
// the contract and not exercised by the fixture table.
// ---------------------------------------------------------------------------
const VERDICT_RANK = Object.freeze({ accept: 0, ask: 1, reject: 2 });

/**
 * @param {{verdict:string,code:string,reason:string}} localDecision decide()'s own output.
 * @param {string|{verdict:string,reason?:string}} serverVerdict
 * @returns {{verdict:string,code:string,reason:string}}
 */
export function tightenWithServer(localDecision, serverVerdict) {
  const local = localDecision || { verdict: "accept", code: POLICY_CODES.OK, reason: "no local decision supplied" };
  const serverVerdictStr = typeof serverVerdict === "string" ? serverVerdict : serverVerdict && serverVerdict.verdict;

  const localRank = VERDICT_RANK[local.verdict];
  const serverRank = VERDICT_RANK[serverVerdictStr];

  // Server absent, unrecognized, or would LOOSEN the verdict -- ignored.
  // "never looser" is enforced by simply never adopting a lower-ranked
  // server verdict, not by rejecting the whole response.
  if (serverRank == null || localRank == null || serverRank <= localRank) {
    return local;
  }

  // Server strictly tightens. `code`: if the LOCAL decision was already
  // "ask" or "reject" (some rule already fired -- local was already at
  // least as strict as "ask"), that code is the most specific one
  // available and is carried over UNCHANGED, even though the server
  // tightens it further (ask -> reject). Only when local was "accept"
  // (code OK, meaning no local rule fired at all) does the server's own
  // tightening become the entire reason for the stricter verdict -- code
  // OK sitting next to a non-accept verdict would misrepresent that as
  // "no rule fired" in logs and the consent UI, so SERVER_TIGHTENED is
  // used instead (orchestrator ruling, GAP NOTE 7 -- now resolved).
  // `reason` is always extended, not replaced, so the original local
  // reasoning (or its absence) is never silently discarded.
  const code = local.verdict === "accept" ? POLICY_CODES.SERVER_TIGHTENED : local.code;

  return {
    verdict: serverVerdictStr,
    code,
    reason: local.reason + " (tightened by server verdict: " + local.verdict + " -> " + serverVerdictStr + ")",
  };
}

// ---------------------------------------------------------------------------
// GOAL-TOKEN COMPLETION -- C4 amendment "deterministic task completion"
// (docs/v2/ARCHITECTURE.md, 2026-09-28, user decision). Diagnosed root
// cause: the local planner (llama3.1:8b) acts correctly step-to-step but
// does not reliably emit `done` itself (see ARCHITECTURE.md's "V4 real
// local planner (diagnosed)" row). Rather than trust the model to notice
// its own completion, the LOOP ends the run itself, independent of the
// model, once it can prove -- from data it already collected, never from a
// model judgment -- that there is nothing left worth another round trip.
//
// This is a LOOP-level early exit, not a policy verdict: it is deliberately
// NOT folded into decide()'s 7 rules (decide() only ever runs against a
// SERVER-SUPPLIED action; nothing here is triggered by or shapes an
// action). Per the amendment's own text: "It can only END a run early,
// never trigger an action, so it cannot weaken any safety rule." Every
// export below is a pure predicate over plain data -- none of them touch
// `element`/`scene`/`tokenValues`/network/DOM, and none of them can be
// coerced into producing an action-shaped value.
// ---------------------------------------------------------------------------

// Frozen, closed list -- amendment rule 3's literal word/phrase set,
// case-insensitive, word-bounded. Multi-word phrases ("sign in", "log in")
// are matched as an exact phrase (space and all), never as two independent
// single-word hits -- a goal that merely contains "sign" or "in" elsewhere,
// unrelated to signing in, must not trip this.
export const CLICK_INTENT_WORDS = Object.freeze([
  "click", "press", "submit", "place", "order", "continue", "next", "send",
  "pay", "buy", "book", "confirm", "sign in", "log in", "login", "checkout",
]);

function escapeRegExpLiteral(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const CLICK_INTENT_RE = new RegExp(
  "\\b(?:" + CLICK_INTENT_WORDS.map(escapeRegExpLiteral).join("|") + ")\\b",
  "i"
);

/**
 * goalExpressesClickIntent(rawGoal) -> boolean
 *
 * Word-bounded, case-insensitive scan of the RAW (untokenized) task goal --
 * amendment rule 3. Deliberately reads the RAW goal, not the tokenized one:
 * click-intent words are ordinary English, never PII-shaped, so tokenizing
 * never touches them either way, but the amendment's own wording says "the
 * raw goal expresses" and this follows that literally rather than assuming
 * tokenization is a no-op here.
 *
 * @param {string} rawGoal
 * @returns {boolean}
 */
export function goalExpressesClickIntent(rawGoal) {
  return CLICK_INTENT_RE.test(String(rawGoal == null ? "" : rawGoal));
}

// Value-token shape -- same character class as pii-tokenizer.js's own
// TOKEN_PATTERN (`/^[A-Z][A-Z0-9]*#[0-9]+$/`), but deliberately NOT that
// same exported constant: TOKEN_PATTERN is anchored (`^...$`) to validate a
// single whole string, while this module needs to find every occurrence
// INSIDE a longer goal sentence ("fill the name as PERSONNAME#1"), hence
// unanchored with the global flag instead. Generic across every token
// prefix on purpose -- it matches vault-shaped tokens (PROFILENAME#1,
// PROFILEEMAIL#1, PROFILEPHONE#1) exactly as readily as PERSONNAME#1/
// EMAIL#1/etc, per the amendment's own "incl. vault tokens".
const GOAL_VALUE_TOKEN_RE = /[A-Z][A-Z0-9]*#[0-9]+/g;

/**
 * isGoalTokenComplete({tokenizedGoal, rawGoal, history}) -> boolean
 *
 * Contract C4 amendment (2026-09-28), rules 1-3, ALL required (AND, not OR):
 *   1. `tokenizedGoal` contains >= 1 value token.
 *   2. EVERY distinct such token has been rehydrated into a successful
 *      `type` action this run -- i.e. `history` (agent-loop-v2.js's own
 *      C5 HistoryEntry[]) carries at least one entry with
 *      `outcome === "ok"`, `action.action === "type"`, and
 *      `action.value` equal to that token. A token appearing only in a
 *      FAILED/REJECTED/DENIED history entry (outcome starting
 *      "rejected:"/"asked-denied") does not count -- those are
 *      recorded with a non-"ok" outcome by agent-loop-v2.js precisely so
 *      this distinction is possible. `fill_profile` history entries never
 *      carry a token in `action.value` at all (the server never supplies
 *      one for that action kind -- see agent-loop-v2.js's own history.push
 *      call sites), so a fill_profile can never satisfy this rule; that
 *      fact is structural, not special-cased here.
 *   3. `rawGoal` expresses no click/submit intent (goalExpressesClickIntent
 *      above) -- e.g. "fill all my details" or a checkout flow relies on
 *      the planner's own `done`, unaffected by this rule.
 *
 * Pure predicate: reads its three plain-data inputs, returns a boolean, and
 * has zero other effect -- it cannot construct, select, or influence an
 * action. The caller (agent-loop-v2.js) alone decides what "true" means
 * (end the run, outcome "done", code POLICY_CODES.GOAL_TOKENS_COMPLETE).
 *
 * @param {{tokenizedGoal?:string, rawGoal?:string,
 *   history?:Array<{action?:{action?:string,value?:string|null},outcome?:string}>}} args
 * @returns {boolean}
 */
export function isGoalTokenComplete({ tokenizedGoal, rawGoal, history } = {}) {
  const goal = typeof tokenizedGoal === "string" ? tokenizedGoal : "";
  const tokens = new Set(goal.match(GOAL_VALUE_TOKEN_RE) || []);
  if (tokens.size === 0) return false; // rule 1

  if (goalExpressesClickIntent(rawGoal)) return false; // rule 3 (cheap; checked before scanning history)

  const typedOk = new Set();
  for (const entry of Array.isArray(history) ? history : []) {
    if (!entry || entry.outcome !== "ok") continue;
    const act = entry.action || {};
    if (act.action !== "type") continue;
    if (typeof act.value === "string" && tokens.has(act.value)) typedOk.add(act.value);
  }
  for (const t of tokens) {
    if (!typedOk.has(t)) return false; // rule 2
  }
  return true;
}

// ---------------------------------------------------------------------------
// CONTRACT GAPS AND JUDGMENT CALLS -- per this module's brief: "If the
// contract is ambiguous or wrong, implement the unambiguous part and list
// the gap in your report -- don't invent around it." Listed here (source
// of truth) and summarized in the handback report to the orchestrator.
//
// 1. PAGE SENTINEL CASING: contract C5's worked response example spells
//    the page-level targetId "PAGE" (uppercase); action-executor.js's
//    shipped PAGE_TARGET_ID constant is "page" (lowercase). This module
//    follows the shipped lowercase constant. If C5's uppercase spelling
//    is deliberate (not a typo), this file's PAGE_TARGET_ID must change
//    to match, in lockstep with action-executor.js and server/schemas.py.
//
// 2. classifyTier()'s destructive-signal check is evaluated BEFORE the
//    structural (link/toggle/submit) checks within each action branch.
//    The contract lists tiers as bullets, not a priority order; this
//    module resolves the ambiguity toward destructive-first, since it is
//    the more specific and higher-consequence signal.
//
// 3. press_key tier for keys OTHER than Enter (Escape/Tab/Backspace/
//    Arrow*) is not stated by the contract (only "press_key Enter in a
//    form" is named state-changing). Classified "reversible" here.
//
// 4. The default tier for an unclassified `click` target (neither
//    link/navigation, submit, nor a toggle, and no destructive signal) is
//    not stated by the contract. Ported Project B's conservative default
//    from warden/tiers.py's op_tier(): "state-changing" (stop for
//    confirmation rather than silently treat as safe/reversible).
//
// 5. checkIntentCoherence()'s contract signature is per-ACTION
//    (taskGoalTokenized, element, action), not per-SCENE. Project B's
//    warden/validate.py had a probe row this narrower shape cannot catch
//    deterministically: "type a password into #password, task says
//    search for a laptop" (state-changing tier, task expresses NO
//    destructive intent by the regex, so expressesDestructiveIntent()
//    returns false and rule 6 never fires). In Project B this row was
//    caught ONLY by an optional local reasoning model explicitly out of
//    scope for this module (C4's decide() is fully deterministic; V2
//    invariant 2 says no model can override a deterministic reject, and
//    no reasoning-model parameter exists in this contract at all).
//    NOTE: in THIS module's port, that exact probe row is still caught,
//    but via a DIFFERENT rule -- rule 4 (SENSITIVE_TARGET), since a real
//    password field would carry `element.sensitive === true` from
//    dom-pii-scanner (V1a/pii-tokenizer's upstream classification), which
//    Project B's warden had no concept of at all. See
//    tests/fixtures/v2/policy/cases.json's `probePlans` entry for this
//    row, and its comment. The residual, uncaught-by-design gap is a
//    hypothetical: a state-changing action whose target is NEITHER
//    sensitive NOR destructive, but whose purpose still contradicts a
//    task goal that itself expresses no destructive intent (e.g. clicking
//    "Add to Cart" when the task says "search for a laptop and do
//    nothing else") -- undetectable by any deterministic PII/destructive
//    signal, by construction.
//
// 6. RAW_VALUE_IN_ACTION (rule 3) is checked against ANY action carrying a
//    string `.value`, not literally scoped to `action === "type"` as the
//    contract's prose says. Deliberate widening (recall over precision),
//    documented in actionCarriesRawValue()'s own comment above.
//
// 7. RESOLVED (orchestrator ruling, post-review): tightenWithServer()'s
//    output `code` when the server strictly tightens a LOCAL "accept" (no
//    local rule fired, code OK) is now the dedicated `SERVER_TIGHTENED`
//    code -- code OK next to a non-accept verdict was misleading in logs
//    and the consent UI. POLICY_CODES grew to 8 entries for this; it is
//    still closed (SERVER_TIGHTENED is a named, specific outcome, not an
//    "other" escape hatch). When local was ALREADY "ask" or "reject" (some
//    rule already fired) and the server tightens it further, the ORIGINAL
//    local code is kept unchanged -- only a local "accept" being
//    overridden purely by the server gets the new code.
// ---------------------------------------------------------------------------
