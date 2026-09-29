// SIH 26171 -- Tier 4 (usable-extension pass), TASK 2.
//
// PROBLEM THIS SOLVES: everything the agent loop does today is legible
// only as raw JSON in the page's DevTools console (action objects,
// ActionExecutionError codes, outcome enum strings) -- a user watching the
// popup has no idea what just happened. This module turns machine shapes
// content.js already has on hand (an action JSON, a domSnapshot to look up
// the target's label in, an outcome string) into short plain-language
// sentences, e.g. "typed into Full name" / "clicked Continue" -- the exact
// phrasing the task brief itself uses as the bar to hit.
//
// ARCHITECTURE (same pattern as stall-detector.js/element-ranker.js): pure
// functions over plain data, zero DOM/chrome dependency, fully
// deterministic, unit-testable in plain Node.
//
// Deliberately NEVER includes a typed `value` in its output -- see
// describeAction()'s doc comment for why that's a safety choice, not an
// omission.
// ---------------------------------------------------------------------------

const MAX_LABEL_LENGTH = 40;

// ---------------------------------------------------------------------------
// i18n plumbing (English/Hindi popup pass). `translate`, when supplied, is
// popup.js's own `t(key, substitutions?) -> string` -- backed by either
// chrome.i18n.getMessage or a manually-fetched _locales/<lang>/messages.json
// (see popup.js's language toggle). It is OPTIONAL and additive everywhere
// in this file: every function below still defaults to the original,
// byte-identical English string when `translate` is omitted, which is what
// keeps every pre-existing caller (content.js/background.js, and this
// file's own existing test suite) working unchanged with zero risk of
// silently regressing a safety-facing sentence. `tr()` is the one place
// that "use the translation if we got one, else fall back" decision lives.
// ---------------------------------------------------------------------------
function tr(translate, key, subs, fallback) {
  if (typeof translate === "function") {
    const msg = translate(key, subs);
    if (msg) return msg;
  }
  return fallback;
}

// PROFILE-VAULT FEATURE: turns a closed profileField category
// ("full_name"|"email"|"phone") into the phrase action-describe.js reads
// back to the user -- "filled email from your profile", never "filled
// someone@example.com from your profile". The category name itself is not
// sensitive (it's one of three fixed strings, not user data) and is safe
// to show; the actual vault value never reaches this file at all -- see
// describeAction()'s own SAFETY NOTE below and profile-vault.js's "vault
// must never leave the client" header.
const PROFILE_FIELD_PHRASES = Object.freeze({
  full_name: { key: "profileField_fullName", fallback: "full name" },
  email: { key: "profileField_email", fallback: "email" },
  phone: { key: "profileField_phone", fallback: "phone" },
});

function humanizeProfileField(field, translate) {
  if (typeof field !== "string") return tr(translate, "profileField_generic", null, "a field");
  const entry = PROFILE_FIELD_PHRASES[field];
  if (!entry) return field.replace(/_/g, " ");
  return tr(translate, entry.key, null, entry.fallback);
}

/**
 * Best-effort human label for a domSnapshot node: its visible text if any
 * (truncated so one long paragraph can't blow out the popup layout), else
 * its accessibility role, else its tag name. Never throws on a
 * missing/malformed node.
 *
 * @param {{text?: string, role?: string, tag?: string}|null|undefined} node
 * @returns {string|null}
 */
function labelForNode(node) {
  if (!node || typeof node !== "object") return null;
  const text = typeof node.text === "string" ? node.text.trim() : "";
  if (text) {
    return text.length > MAX_LABEL_LENGTH ? `${text.slice(0, MAX_LABEL_LENGTH - 3)}...` : text;
  }
  if (typeof node.role === "string" && node.role) return node.role;
  if (typeof node.tag === "string" && node.tag) return node.tag;
  return null;
}

/**
 * Plain-language description of one executed (or about-to-execute) action,
 * e.g. "typed into Full name", "clicked Continue", "scrolled the page",
 * "marked the task as done". Looks the target up in `domSnapshot` (the
 * exact array content.js sent to /analyze that step, so the label matches
 * what the model actually saw) by `action.targetId`; falls back to the raw
 * targetId string, then to a generic phrase, if no match is found (a
 * ranked-out or cross-frame node, for instance -- never throws either way).
 *
 * SAFETY NOTE, not an oversight: this function NEVER echoes `action.value`
 * (the text actually typed) into its output, even for a successful,
 * non-sensitive `type` action. The popup is meant to make the LOOP legible
 * ("it's typing into the name field"), not to become a second transcript
 * of every value that ever crossed the wire -- keeping this description
 * value-free means a screenshot of the popup, or the popup's own state
 * persisted to chrome.storage.session, can never itself become a place a
 * value leaks into that wasn't already visible on the page itself.
 *
 * This applies with EXTRA force to `fill_profile` (PROFILE-VAULT FEATURE):
 * that action's value comes from the user's own locally-saved profile, not
 * from the page or the model, so a leak here would be this popup itself
 * disclosing local vault data. `action.value` for fill_profile is null by
 * contract anyway (see server/schemas.py's ActionResponse and
 * action-executor.js's dispatchFillProfile(), which never even reads it),
 * but this function does not rely on that -- it only ever reads
 * `action.profileField` (a category name, e.g. "email" -- one of three
 * fixed, non-sensitive strings) for this action, never `action.value`.
 *
 * @param {{action?: string, targetId?: string, value?: *, profileField?: string}|null} action
 * @param {Array<object>} [domSnapshot] the step's own domSnapshot (post-rank,
 *   post-merge -- whatever content.js actually sent) to resolve a label from.
 * @returns {string}
 */
export function describeAction(action, domSnapshot) {
  if (!action || typeof action.action !== "string") return "performed an action";

  const node =
    Array.isArray(domSnapshot) && action.targetId
      ? domSnapshot.find((n) => n && n.agentId === action.targetId)
      : null;
  const label = labelForNode(node) || (action.targetId && action.targetId !== "page" ? action.targetId : null);

  switch (action.action) {
    case "type":
      return label ? `typed into ${label}` : "typed into a field";
    case "fill_profile":
      // Deliberately ignores `label`/domSnapshot entirely -- the category
      // name (action.profileField) is the whole story here, and is
      // consistent regardless of what the target field happens to be
      // labeled on the page. See the SAFETY NOTE above.
      return `filled ${humanizeProfileField(action.profileField)} from your profile`;
    case "click":
      return label ? `clicked ${label}` : "clicked an element";
    case "press_key":
      // The key name is safe to show: it is a member of a closed enum, never
      // page content and never anything the user typed.
      return label
        ? `pressed ${action.key || "a key"} on ${label}`
        : `pressed ${action.key || "a key"}`;
    case "scroll":
      return "scrolled the page";
    case "done":
      return "marked the task as done";
    default:
      return label ? `${action.action} on ${label}` : `performed ${action.action}`;
  }
}

// Every outcome string content.js's instrumentation can currently produce
// (createInstrumentation()/runAgentLoop() in content.js), plus "stopped"
// (TASK 1, new in this pass). Kept as an explicit map rather than a
// prettified string-transform (e.g. "act_failed" -> "Act Failed") so the
// wording can be genuinely helpful ("Blocked or failed to act") instead of
// a mechanical relabeling, and so a NEW outcome string added later fails
// visibly (falls through to the default branch below) instead of silently
// rendering something misleading.
const OUTCOME_LABELS = Object.freeze({
  done: { key: "outcome_done", label: "Done", tone: "success" },
  stopped: { key: "outcome_stopped", label: "Stopped by you", tone: "neutral" },
  // REPORTING FIX (coordinator, 2026-09-13): a guard deliberately refusing
  // an action (SENSITIVE_TARGET_BLOCKED / IRREVERSIBLE_ACTION_BLOCKED) is
  // this product's safeguard working, not a failure -- content.js now
  // records this as its own outcome, "blocked", decided on the error CODE
  // alone (never on message text, per CLAUDE.md's error-code ruling), so
  // it can never again be lumped in with a genuine execution failure under
  // "act_failed". Tone "success" is deliberate, not a placeholder: the run
  // did exactly what it should. Never say "failed" here.
  blocked: { key: "outcome_blocked", label: "Stopped safely -- refused an unsafe action", tone: "success" },
  stalled: { key: "outcome_stalled", label: "Stopped: no progress detected", tone: "warning" },
  max_steps_reached: { key: "outcome_maxStepsReached", label: "Stopped: step limit reached", tone: "warning" },
  capture_failed: { key: "outcome_captureFailed", label: "Failed: could not capture/detect the page", tone: "error" },
  analyze_failed: { key: "outcome_analyzeFailed", label: "Failed: server request failed", tone: "error" },
  // act_failed is now reserved EXCLUSIVELY for a genuine execution failure
  // (target element vanished, dispatch threw, a cross-frame relay errored,
  // ...) -- a deliberate guard refusal is "blocked", above, never this.
  act_failed: { key: "outcome_actFailed", label: "Failed: could not complete the action", tone: "error" },
  section5_violation: { key: "outcome_section5Violation", label: "Stopped: internal safety check failed", tone: "error" },
  // Not produced by content.js's own instrumentation directly -- this is
  // background.js's own fallback (handleRunAgentLoopFromPopup) for when
  // the content script never returned a recognizable outcome at all (e.g.
  // it threw before runAgentLoop()'s own try/finally could report one, or
  // the tab was closed mid-run).
  failed: { key: "outcome_failed", label: "Failed: unexpected error", tone: "error" },
});

/**
 * Human label + a "tone" hint (success/neutral/warning/error, for the
 * popup to color) for a finished run's outcome string. `outcome: null`
 * (still running, or never started) renders as a neutral "In progress".
 * An outcome string this module doesn't recognize is not swallowed -- it
 * renders using ITS OWN raw value as the label (with tone "neutral"), so a
 * future new outcome shows up as literally itself rather than as a blank
 * or a misleading canned phrase.
 *
 * @param {string|null|undefined} outcome
 * @param {(key: string, subs?: Array<string>) => string} [translate] popup.js's
 *   `t()` -- optional; omitted (or returning falsy) keeps the original
 *   hardcoded English label, unchanged from every prior release.
 * @returns {{label: string, tone: "success"|"neutral"|"warning"|"error"}}
 */
export function describeOutcome(outcome, translate) {
  if (!outcome) return { label: tr(translate, "outcome_inProgress", null, "In progress"), tone: "neutral" };
  const entry = OUTCOME_LABELS[outcome];
  if (!entry) return { label: outcome, tone: "neutral" };
  return { label: tr(translate, entry.key, null, entry.label), tone: entry.tone };
}

// ---------------------------------------------------------------------------
// V4b (integration-v2, part B): real consent UI. Two NEW exports added here
// rather than in a separate file, per this pass's brief ("use
// lib/action-describe.js") -- describeAction()/describeOutcome() above are
// UNCHANGED (still v1's/V4a's own consumers, byte-identical behaviour).
//
// C5's `elements[].label` is already TOKENIZED (pii-tokenizer.js) by the
// time it reaches here -- a PII-shaped value never survives as plain text.
// But a token is still not something a human should have to read ("type
// EMAIL#1 into 'Email'" is legible to an engineer, not a user asked to
// approve a consent prompt in ten seconds) -- describePendingAction() below
// translates a known token PREFIX into a plain-language category phrase
// ("your saved email" / "a previously-seen name") and otherwise never
// prints `action.value` at all, matching this pass's brief exactly: "a type
// action into a sensitive field says 'type your saved email into
// <Email>', never the value."
// ---------------------------------------------------------------------------

// C2's token grammar: /[A-Z][A-Z0-9]*#[0-9]+/. PROFILE... prefixes are
// vault-seeded (pii-tokenizer.js's seedVault(), C2) -- everything else is a
// regex/NER-minted PiiLabel (docs/v2/ARCHITECTURE.md contract C1).
const TOKEN_VALUE_RE = /^([A-Z][A-Z0-9]*)#\d+$/;

const TOKEN_PREFIX_PHRASES = Object.freeze({
  PROFILENAME: { key: "tokenPhrase_profileName", fallback: "your saved name" },
  PROFILEEMAIL: { key: "tokenPhrase_profileEmail", fallback: "your saved email" },
  PROFILEPHONE: { key: "tokenPhrase_profilePhone", fallback: "your saved phone number" },
  EMAIL: { key: "tokenPhrase_email", fallback: "a previously-seen email address" },
  PHONE: { key: "tokenPhrase_phone", fallback: "a previously-seen phone number" },
  AADHAAR: { key: "tokenPhrase_aadhaar", fallback: "a previously-seen Aadhaar-shaped number" },
  PAN: { key: "tokenPhrase_pan", fallback: "a previously-seen PAN-shaped ID" },
  CARD: { key: "tokenPhrase_card", fallback: "a previously-seen card number" },
  UPI: { key: "tokenPhrase_upi", fallback: "a previously-seen UPI ID" },
  IFSC: { key: "tokenPhrase_ifsc", fallback: "a previously-seen bank IFSC code" },
  GSTIN: { key: "tokenPhrase_gstin", fallback: "a previously-seen GSTIN" },
  PASSPORT: { key: "tokenPhrase_passport", fallback: "a previously-seen passport-shaped ID" },
  PERSONNAME: { key: "tokenPhrase_personName", fallback: "a previously-seen name" },
  ADDRESS: { key: "tokenPhrase_address", fallback: "a previously-seen address" },
  DOB: { key: "tokenPhrase_dob", fallback: "a previously-seen date of birth" },
  ACCOUNTNUMBER: { key: "tokenPhrase_accountNumber", fallback: "a previously-seen account number" },
  PASSWORD: { key: "tokenPhrase_password", fallback: "a previously-seen password" },
  OTHER: { key: "tokenPhrase_other", fallback: "a previously-seen sensitive value" },
});

/**
 * Translate a C5 action `value` into a safe plain-language phrase -- NEVER
 * the value itself, token or otherwise. Returns null for a value that isn't
 * token-shaped at all (ordinary non-PII text a planner composed itself,
 * e.g. a search query) -- callers must treat null as "say nothing about the
 * value", never fall back to printing it.
 *
 * @param {*} value
 * @param {(key: string, subs?: Array<string>) => string} [translate]
 * @returns {string|null}
 */
export function phraseForValueToken(value, translate) {
  if (typeof value !== "string") return null;
  const m = TOKEN_VALUE_RE.exec(value.trim());
  if (!m) return null;
  const entry = TOKEN_PREFIX_PHRASES[m[1]];
  if (!entry) return tr(translate, "tokenPhrase_genericFallback", null, "a previously-seen value");
  return tr(translate, entry.key, null, entry.fallback);
}

/**
 * Plain-language description of a NOT-YET-EXECUTED C5 action, for the
 * consent panel ("type your saved email into 'Email'", "click 'Place
 * Order'"). Distinct from describeAction() above (which describes an
 * ALREADY-executed v1-shaped action against a v1 domSnapshot): this takes a
 * C5 action ({action, targetId, value, profileField, key}) and a single C5
 * `element` ({agentId, tag, role, type, label, ...}) already resolved by
 * the caller (agent-loop-v2.js's own `resolvedElement`) -- no snapshot
 * array to search, since the consent hook only ever concerns ONE element.
 *
 * SAFETY: `action.value` is NEVER printed directly -- only through
 * phraseForValueToken() above, which either names a safe category or
 * returns null (silently omitted). This holds even for a non-sensitive,
 * non-token value (e.g. ordinary typed text) -- the whole point of a
 * confirmation prompt is trust-but-verify, not "trust the field is safe so
 * showing the value is fine".
 *
 * @param {{action?:string,targetId?:string,value?:string|null,profileField?:string,key?:string}|null} action
 * @param {{agentId?:string,tag?:string,role?:string,type?:string,label?:string|null}|null} element
 *   null/undefined for a page-level action (targetId === "page").
 * @param {(key: string, subs?: Array<string>) => string} [translate] popup.js's
 *   `t()` -- optional; every branch below still falls back to the original
 *   hardcoded English sentence when omitted, so existing callers/tests are
 *   byte-identical without it.
 * @returns {string}
 */
export function describePendingAction(action, element, translate) {
  if (!action || typeof action.action !== "string") return tr(translate, "pending_performAction", null, "perform an action");

  const label = element ? element.label || element.tag || element.agentId : null;
  const valuePhrase = phraseForValueToken(action.value, translate);
  const aKeyFallback = tr(translate, "pending_aKey", null, "a key");

  switch (action.action) {
    case "type":
      if (valuePhrase) {
        return label
          ? tr(translate, "pending_typeWithValue", [valuePhrase, label], `type ${valuePhrase} into '${label}'`)
          : tr(translate, "pending_typeValueOnly", [valuePhrase], `type ${valuePhrase}`);
      }
      return label
        ? tr(translate, "pending_typeIntoLabel", [label], `type into '${label}'`)
        : tr(translate, "pending_typeIntoField", null, "type into a field");
    case "fill_profile": {
      // Deliberately ignores `label` -- same reasoning as describeAction()'s
      // own fill_profile branch: the category is the whole story.
      const targetLabel = label || tr(translate, "pending_fieldFallback", null, "a field");
      const genericFieldWord = tr(translate, "profileField_generic", null, "a field");
      const category = humanizeProfileField(action.profileField, translate);
      return category === genericFieldWord
        ? tr(translate, "pending_fillProfileGeneric", [targetLabel], `fill '${targetLabel}' with your saved profile info`)
        : tr(translate, "pending_fillProfileCategory", [targetLabel, category], `fill '${targetLabel}' with your saved ${category}`);
    }
    case "click":
      return label
        ? tr(translate, "pending_click", [label], `click '${label}'`)
        : tr(translate, "pending_clickElement", null, "click an element");
    case "press_key":
      return label
        ? tr(translate, "pending_pressKeyOn", [action.key || aKeyFallback, label], `press ${action.key || "a key"} on '${label}'`)
        : tr(translate, "pending_pressKey", [action.key || aKeyFallback], `press ${action.key || "a key"}`);
    case "scroll":
      return tr(translate, "pending_scroll", null, "scroll the page");
    case "done":
      return tr(translate, "pending_done", null, "mark the task as done");
    default:
      return label
        ? tr(translate, "pending_genericOn", [action.action, label], `${action.action} on '${label}'`)
        : tr(translate, "pending_genericAction", [action.action], `perform ${action.action}`);
  }
}

// C4 POLICY_CODES (extension/lib/policy.js) that can ever reach an "ask"
// verdict -- SENSITIVE_TARGET, IRREVERSIBLE_ACTION, INTENT_MISMATCH,
// SERVER_TIGHTENED (see that module's own POLICY_CODES/decide()/
// tightenWithServer() for the full, closed set; only these four ever
// produce verdict "ask", per decide()'s rules 4/5/6 and
// tightenWithServer()'s server-strictly-tightens-a-local-accept case).
const POLICY_REASON_PHRASES = Object.freeze({
  SENSITIVE_TARGET: {
    key: "policyReason_sensitiveTarget",
    fallback: "This field is flagged as sensitive (for example a password, ID number, or contact field).",
  },
  IRREVERSIBLE_ACTION: {
    key: "policyReason_irreversibleAction",
    fallback: "This action may be hard to undo (for example a purchase, deletion, or account change).",
  },
  INTENT_MISMATCH: {
    key: "policyReason_intentMismatch",
    fallback: "This action doesn't clearly match what you asked the agent to do.",
  },
  SERVER_TIGHTENED: {
    key: "policyReason_serverTightened",
    fallback: "The server flagged this action as needing your confirmation.",
  },
});

/**
 * Plain-English reason for a consent prompt, keyed off C4's closed
 * POLICY_CODES. An unrecognized code (defensive only -- POLICY_CODES is a
 * closed enum) still renders a safe, generic sentence rather than the raw
 * code string or nothing at all.
 *
 * @param {string|null|undefined} code
 * @param {(key: string, subs?: Array<string>) => string} [translate]
 * @returns {string}
 */
export function describePolicyReason(code, translate) {
  const entry = POLICY_REASON_PHRASES[code];
  if (!entry) return tr(translate, "policyReason_generic", null, "The agent's safety policy wants your confirmation before doing this.");
  return tr(translate, entry.key, null, entry.fallback);
}
