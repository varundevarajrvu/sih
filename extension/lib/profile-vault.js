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
//   action-executor.js never imports this file directly (it has zero
//   import/export statements by design, see its own file header) -- it
//   only ever calls the `options.getProfileValue` function the caller
//   injected, exactly like it already does for `options.classifyActionRisk`
//   (action-risk.js). See that file's dispatchFillProfile().
// ---------------------------------------------------------------------------
