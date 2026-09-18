// SIH 26171 -- profile-vault.js: the local-only user profile the
// `fill_profile` action fills FROM, never a value the model supplies.
//
// THE IDEA (see CLAUDE.md's guard ruling this feature depends on): the
// existing sensitive-target guard (action-executor.js's guardSensitive())
// blocks `type` into a flagged field because the MODEL chose that value and
// the model is untrusted -- it could be hallucinating, or worse, attempting
// exfiltration via a value it invents and asks the extension to type
// somewhere observable. `fill_profile` sidesteps that trust problem
// entirely, at the category level: the model names WHICH category a field
// wants ("full_name" / "email" / "phone"), and this extension fills the
// value FROM LOCAL STORAGE -- the model never sees, supplies, or influences
// the actual string. See action-executor.js's dispatchFillProfile() and its
// guardSensitive() FILL_PROFILE CARVE-OUT comment for the client-side half
// of this contract.
//
// 🔴 THE VAULT MUST NEVER LEAVE THE CLIENT. It is never added to
// domSnapshot, never sent to /analyze, never logged, never included in the
// RUN SUMMARY, and never echoed in an error message. This file's own
// functions are the ONLY code path that reads a saved value back out of
// storage -- everything downstream of that (action-executor.js's
// dispatchFillProfile, action-describe.js's describeAction) is written to
// consume it exactly once, type it into the DOM, and then forget it. See
// tests/unit/test_profile_vault.mjs's "vault value never reaches the
// outgoing payload" test -- the same class of assertion
// content.js's assertNoRawPii() makes for page-sourced PII, applied here to
// vault-sourced PII instead.
//
// ARCHITECTURE: an ES module (top-level `export`, like dom-scanner.js/
// redaction.js/element-ranker.js/action-risk.js -- see content.js's
// CONTRACT MISMATCH #1 note for why lib/*.js files split into "classic
// script" vs "ES module" camps). content.js loads this the same
// dynamic-`import()` way it loads every other ES-module lib file; popup.js
// (already `<script type="module">`) can `import` it directly. Pure
// functions wherever possible; the actual chrome.storage.local calls are
// isolated to getProfile()/setProfile() below, which take an INJECTED
// storage object (mirrors { get, set } of chrome.storage.local /
// browser.storage.local) so this whole file is unit-testable in plain Node
// with an in-memory fake -- no browser, no chrome.* global required.
// ---------------------------------------------------------------------------

// Single storage key. The whole profile lives under one key as one object
// (not three separate keys) -- simpler to reason about atomically (a save
// either writes the whole profile or doesn't) and keeps every read/write
// site naming exactly one literal instead of three that could drift apart.
export const PROFILE_VAULT_STORAGE_KEY = "agentProfile";

// Closed field set. Deliberately closed (not open-ended/user-extensible):
// the contract pinned by the orchestrator names exactly these three
// categories ("full_name"|"email"|"phone"), and a closed set is what lets
// every consumer (action-executor.js's PROFILE_FIELDS mirror, the server's
// own enum) validate a `profileField` string with a simple membership
// check rather than trusting an arbitrary key name into chrome.storage.
export const PROFILE_FIELDS = Object.freeze(["full_name", "email", "phone"]);

const PROFILE_FIELD_SET = new Set(PROFILE_FIELDS);

// Human-readable labels for the popup UI and for action-describe.js's
// "filled <label> from your profile" phrasing -- kept here, next to the
// field list itself, so a future field addition only has to update one
// file instead of drifting between this list and whatever prose strings
// popup.html/action-describe.js would otherwise hardcode separately.
export const PROFILE_FIELD_LABELS = Object.freeze({
  full_name: "full name",
  email: "email",
  phone: "phone",
});

/**
 * @param {*} field
 * @returns {boolean} true iff `field` is one of the closed PROFILE_FIELDS.
 */
export function isValidProfileField(field) {
  return typeof field === "string" && PROFILE_FIELD_SET.has(field);
}

/**
 * Normalize/validate an arbitrary input into the closed profile shape.
 * NEVER throws -- malformed input (not an object, unexpected extra keys,
 * non-string values) degrades to empty fields rather than corrupting what
 * gets written to storage or crashing a caller. Unknown keys on `raw` are
 * silently dropped (the closed field set is enforced by construction: the
 * returned object can only ever have exactly PROFILE_FIELDS' three keys).
 * Every value is trimmed; an all-whitespace input normalizes to "".
 *
 * @param {*} raw
 * @returns {{full_name: string, email: string, phone: string}}
 */
export function sanitizeProfile(raw) {
  const profile = { full_name: "", email: "", phone: "" };
  if (raw && typeof raw === "object") {
    for (const field of PROFILE_FIELDS) {
      const value = raw[field];
      if (typeof value === "string") profile[field] = value.trim();
    }
  }
  return profile;
}

/**
 * Pure lookup: profile + field -> string|null. Returns null (never "",
 * never undefined) for an invalid field OR a field with nothing saved --
 * one falsy shape a caller can check with a single `!== null` test. NEVER
 * throws, NEVER guesses a different field, NEVER falls back to anything
 * else -- action-executor.js's dispatchFillProfile() (and its
 * PROFILE_FIELD_EMPTY error) depends on this exact "null means truly
 * nothing usable" contract to fail cleanly instead of typing an empty
 * string.
 *
 * @param {{full_name?: string, email?: string, phone?: string}|null|undefined} profile
 * @param {string} field
 * @returns {string|null}
 */
export function getProfileFieldValue(profile, field) {
  if (!isValidProfileField(field)) return null;
  const raw = profile && typeof profile === "object" ? profile[field] : undefined;
  const value = typeof raw === "string" ? raw.trim() : "";
  return value === "" ? null : value;
}

/**
 * Read the saved profile out of `storage` (an injected chrome.storage.local
 * / browser.storage.local -shaped object: `{ get(key) => Promise<object> }`
 * -- both extension storage APIs resolve `get("someKey")` to
 * `{ someKey: <value or undefined> }`, which is exactly what this function
 * expects). Always resolves to a fully-shaped, sanitized profile -- never
 * throws, never resolves `undefined`/partial -- so every caller can read
 * `profile.email` etc. unconditionally without a null-check.
 *
 * @param {{get: function(string): Promise<Object>}} storage
 * @returns {Promise<{full_name: string, email: string, phone: string}>}
 */
export async function getProfile(storage) {
  if (!storage || typeof storage.get !== "function") {
    throw new TypeError("profile-vault.js: getProfile(storage) requires a storage object exposing get(key)");
  }
  const stored = await storage.get(PROFILE_VAULT_STORAGE_KEY);
  return sanitizeProfile(stored && stored[PROFILE_VAULT_STORAGE_KEY]);
}

/**
 * Sanitize `profile` and persist it to `storage` under the one vault key.
 * Returns the sanitized object actually written (so a caller, e.g.
 * popup.js, can immediately reflect the normalized/trimmed values back
 * into its form fields without a redundant read-back).
 *
 * @param {{set: function(Object): Promise<void>}} storage
 * @param {*} profile
 * @returns {Promise<{full_name: string, email: string, phone: string}>}
 */
export async function setProfile(storage, profile) {
  if (!storage || typeof storage.set !== "function") {
    throw new TypeError("profile-vault.js: setProfile(storage, profile) requires a storage object exposing set(items)");
  }
  const sanitized = sanitizeProfile(profile);
  await storage.set({ [PROFILE_VAULT_STORAGE_KEY]: sanitized });
  return sanitized;
}

// ---------------------------------------------------------------------------
// PII-LEAK FIX (confirmed leak, see CLAUDE.md): a vault-filled node has NO
// regex/autocomplete signature dom-scanner.js can catch on its own -- a
// bare name has no PII pattern at all, unlike email/phone which dom-scanner
// already flags independently via autocomplete/regex. Once fill_profile
// writes a vault value into a field, that field's raw `.value` comes back
// on the VERY NEXT scan (getAccessibleText() reads `.value`, by design --
// see action-executor.js's own doc comment on that function), and with no
// classifier watching for it, a bare name survives all the way into the
// outgoing /analyze payload.
//
// The fix: content.js records every agentId a fill_profile action
// successfully wrote to (a run-scoped Map<agentId, profileField>, kept
// SEPARATE from actedAgentIds -- see that variable's own comment in
// content.js for why merging the two would only close half the leak), and
// on every subsequent step synthesizes sensitiveNode-shaped entries for
// them via buildProfileVaultSensitiveNodes() below. Those entries are
// concatenated into content.js's own `allSensitiveNodes` and get IDENTICAL
// treatment to a page-sourced PII node from that point on -- stripped from
// the DOM JSON (redaction.js's sanitizeDomSnapshot) AND blacked out on the
// screenshot (redaction.js's redact()) -- with ZERO changes required to
// either of those two existing, already-tested consumers.
// ---------------------------------------------------------------------------

/**
 * Closed profileField -> PiiType mapping (server/schemas.py's PiiType is a
 * CLOSED enum -- inventing a new member is a hard 422, never an option).
 * "full_name" has no dedicated PiiType member, so it deliberately maps to
 * "other", the enum's own explicit escape hatch (still flagged, still
 * redacted, just unclassified -- see PiiType's own docstring). "email" and
 * "phone" map to the same PiiType values dom-scanner.js already uses for
 * autocomplete/regex-detected email/tel fields, so a vault-filled field of
 * either kind reads identically to a page-sourced one downstream.
 */
export const PROFILE_FIELD_TO_PII_TYPE = Object.freeze({
  full_name: "other",
  email: "email",
  phone: "tel",
});

/**
 * Default bbox reader -- same shape/behavior as dom-scanner.js's own
 * defaultGetBBox and action-executor.js's own defaultGetBBox (kept as a
 * third, independent copy rather than importing either: this file has
 * stayed free of any lib/*.js -> lib/*.js dependency so far, and a single
 * three-line function isn't worth introducing one). Real geometry in a
 * browser; all-zero under jsdom (no layout engine) -- inject
 * `options.getBBox` in tests that need to assert on real geometry.
 */
function defaultGetBBox(el) {
  if (!el || typeof el.getBoundingClientRect !== "function") {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  const rect = el.getBoundingClientRect();
  return {
    x: rect.x ?? rect.left ?? 0,
    y: rect.y ?? rect.top ?? 0,
    w: rect.width ?? 0,
    h: rect.height ?? 0,
  };
}

/**
 * Default selector -- deliberately NOT dom-scanner.js's own computeSelector
 * (importing it would create the same new lib/*.js -> lib/*.js edge noted
 * above, purely for what dom-scanner.js's own header already calls an
 * "informational/debug field", never the actual re-location mechanism).
 * content.js already has DomScanner loaded and should inject
 * `options.computeSelector: DomScanner.computeSelector` for a richer
 * selector; this fallback is a plain `data-agent-id` attribute selector,
 * always resolvable since every entry here comes from a live `idMap`.
 */
function defaultComputeSelector(el) {
  if (!el || typeof el.getAttribute !== "function") return "";
  const agentId = el.getAttribute("data-agent-id");
  return agentId ? `[data-agent-id="${agentId}"]` : "";
}

/**
 * Build sensitiveNode-shaped entries ({selector, bbox, piiType, agentId} --
 * byte-for-byte the same shape dom-scanner.js's scanForPii() emits) for
 * every agentId a fill_profile action successfully wrote a vault value
 * into, so far this run.
 *
 * @param {Map<string, string>} filledProfileAgentIds agentId -> profileField,
 *   recorded by content.js on every SUCCESSFUL fill_profile act this run.
 * @param {Map<string, Element>} idMap THIS STEP's live agentId -> Element
 *   map (action-executor.buildDomSnapshot()'s own idMap) -- used both to
 *   confirm the element is still resolvable and to measure bbox.
 * @param {Set<string>|Array<string>} alreadyFlaggedAgentIds agentIds
 *   dom-scanner (top frame + merged subframe reports) already flagged
 *   THIS step -- deduped against so an autocomplete="email"/"tel" field
 *   the vault just filled, which dom-scanner independently flags on its
 *   own, is never double-added under a second entry.
 * @param {{getBBox?: function(Element): {x:number,y:number,w:number,h:number},
 *          computeSelector?: function(Element): string}} [options]
 *   Both injectable (mirrors dom-scanner.js's own DI pattern) for unit
 *   tests that need to assert on real geometry/selector without a browser.
 * @returns {Array<{selector:string, bbox:{x:number,y:number,w:number,h:number}, piiType:string, agentId:string}>}
 *   `bbox` is measured FRESH on every call, from whatever `idMap` is
 *   passed for THIS step -- never cache and reuse a bbox from the step the
 *   fill actually happened on. The page can scroll between steps, and a
 *   stale bbox would put the black bar in the wrong place on THIS step's
 *   screenshot -- a wrong bbox is a leak that looks like success.
 */
export function buildProfileVaultSensitiveNodes(filledProfileAgentIds, idMap, alreadyFlaggedAgentIds, options = {}) {
  const out = [];
  if (!filledProfileAgentIds || typeof filledProfileAgentIds.forEach !== "function") return out;

  const getBBox = options.getBBox || defaultGetBBox;
  const computeSelector = options.computeSelector || defaultComputeSelector;
  const flagged =
    alreadyFlaggedAgentIds instanceof Set ? alreadyFlaggedAgentIds : new Set(alreadyFlaggedAgentIds || []);

  for (const [agentId, profileField] of filledProfileAgentIds) {
    if (flagged.has(agentId)) continue; // dom-scanner already independently flagged this element (e.g. autocomplete="email") -- do not double-add
    const el = idMap && typeof idMap.get === "function" ? idMap.get(agentId) : undefined;
    if (!el) continue; // element no longer resolvable this step (removed/replaced since the fill) -- nothing left on the page to redact
    out.push({
      selector: computeSelector(el),
      bbox: getBBox(el),
      piiType: PROFILE_FIELD_TO_PII_TYPE[profileField] || "other",
      agentId,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// HOW TO CONSUME THIS MODULE:
//
//   popup.js (already `<script type="module">`, imports ES modules
//   directly -- no dynamic-import() workaround needed there):
//     import { getProfile, setProfile, PROFILE_FIELDS } from "./lib/profile-vault.js";
//     const profile = await getProfile(browser.storage.local);
//     await setProfile(browser.storage.local, { full_name, email, phone });
//
//   content.js (classic content script, dynamic-import() like every other
//   ES-module lib file -- see that file's loadLibModules()):
//     ProfileVault = await import(browser.runtime.getURL("lib/profile-vault.js"));
//     const profile = await ProfileVault.getProfile(browser.storage.local);
//     // action-executor.js's executeAction() is SYNCHRONOUS (dispatchType/
//     // dispatchClick/etc. are all sync DOM calls) and has zero import/
//     // export statements, so it cannot itself await a chrome.storage.local
//     // read. Fetch the profile ONCE (mirrors how taskGoal/
//     // fullPageCaptureEnabled are each read once per run, not once per
//     // step) and inject a plain SYNCHRONOUS getter closure instead:
//     const getProfileValue = (field) => ProfileVault.getProfileFieldValue(profile, field);
//     ActionExecutor.executeAction(action, idMap, { ..., getProfileValue });
//
//   content.js, PII-LEAK FIX -- after a SUCCESSFUL fill_profile act, record
//   the target once in a run-scoped Map (never actedAgentIds -- see that
//   variable's own comment):
//     filledProfileAgentIds.set(actResult.targetId, action.profileField);
//   Then, every step, at/after building `allSensitiveNodes`:
//     const vaultNodes = ProfileVault.buildProfileVaultSensitiveNodes(
//       filledProfileAgentIds, idMap, new Set(allSensitiveNodes.map((n) => n.agentId)),
//       { computeSelector: DomScanner.computeSelector }
//     );
//     allSensitiveNodes = allSensitiveNodes.concat(vaultNodes);
//
//   action-executor.js never imports this file directly (it has zero
//   import/export statements by design, see its own file header) -- it
//   only ever calls the `options.getProfileValue` function the caller
//   injected, exactly like it already does for `options.classifyActionRisk`
//   (action-risk.js). See that file's dispatchFillProfile().
// ---------------------------------------------------------------------------
