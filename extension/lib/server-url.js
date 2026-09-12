// SIH 26171 -- Tier 4 (usable-extension pass), TASK 4.
//
// PROBLEM THIS SOLVES: background.js hardcoded `SERVER_URL =
// "http://localhost:8000"` -- fine for a hackathon demo Varun runs
// himself, not something a real extension can ship. This module is the
// validation half of making it a settings field: a well-formed-URL check
// (so popup.js can reject garbage before it's ever saved), and -- the
// sharper requirement -- a check against manifest.json's actual
// `host_permissions`, since Chrome will silently drop any fetch() to a
// host outside that list REGARDLESS of what the extension's own UI thinks
// is configured. Catching that case HERE, before a network call is ever
// attempted, is what turns "opaque network error" into a plain, specific
// sentence (see background.js's handleAnalyze and error-messages.js's
// "SERVER_URL_NOT_PERMITTED" bucket, both downstream consumers of this).
//
// ARCHITECTURE (same pattern as stall-detector.js/element-ranker.js): pure
// functions over plain strings, zero DOM/chrome dependency, fully
// unit-testable in plain Node.
//
// ORCHESTRATOR-LEVEL BOUNDARY, stated explicitly rather than silently
// worked around: this module NEVER broadens what's allowed -- it only
// checks a candidate URL against DEFAULT_ALLOWED_HOST_PATTERNS, which
// mirrors manifest.json's CURRENT host_permissions. Widening
// host_permissions to cover an arbitrary user-supplied host is a real,
// visible permission escalation for a privacy-focused extension and is
// explicitly NOT this task's call to make -- see the popup's own copy for
// how that's surfaced to the user as a deliberate limitation, not a bug.
// ---------------------------------------------------------------------------

// Mirrors extension/manifest.json's `host_permissions` array EXACTLY.
// Kept as a hand-maintained constant (not parsed from manifest.json at
// import time) because this file is also loaded directly by plain Node
// tests with no chrome.* runtime available -- see
// tests/unit/test_server_url.mjs's own "matches manifest.json" test, which
// reads manifest.json's actual JSON and asserts byte-for-byte equality
// with this array, so the two can never silently drift without a failing
// test catching it.
export const DEFAULT_ALLOWED_HOST_PATTERNS = Object.freeze(["http://localhost/*", "http://127.0.0.1/*"]);

/**
 * Match one manifest-style `"<scheme>://<host>/*"` host-permission pattern
 * against a parsed URL. Deliberately minimal -- this extension's own
 * host_permissions only ever uses this exact shape (a bare host, wildcard
 * path, no port restriction since Chrome match patterns can't express one
 * -- see CLAUDE.md's Phase 4 note #4), so a general match-pattern parser
 * (which would also need to handle `*.example.com`, path prefixes, etc.)
 * is out of scope and would be unverifiable against real Chrome behavior
 * without a browser anyway.
 *
 * @param {string} pattern e.g. "http://localhost/*"
 * @param {URL} url
 * @returns {boolean}
 */
function hostPatternMatches(pattern, url) {
  const m = /^(https?):\/\/([^/]+)\/\*$/.exec(pattern);
  if (!m) return false;
  const [, scheme, host] = m;
  return url.protocol === `${scheme}:` && url.hostname === host;
}

/**
 * True if `rawUrl` parses as a well-formed http(s) URL at all (no host-
 * permission check -- see isHostAllowed() for that). This is the FIRST
 * gate validateServerUrl() applies, so a garbage string is rejected with
 * "not a valid URL" rather than a confusing "not permitted" message that
 * implies it WOULD work on a different host.
 *
 * @param {string} rawUrl
 * @returns {boolean}
 */
export function isWellFormedHttpUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_err) {
    return false;
  }
}

/**
 * True if `rawUrl` is covered by one of `allowedPatterns` (defaults to
 * this extension's actual manifest.json host_permissions). A malformed URL
 * is never "allowed" -- returns false rather than throwing.
 *
 * @param {string} rawUrl
 * @param {string[]} [allowedPatterns]
 * @returns {boolean}
 */
export function isHostAllowed(rawUrl, allowedPatterns = DEFAULT_ALLOWED_HOST_PATTERNS) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch (_err) {
    return false;
  }
  return allowedPatterns.some((pattern) => hostPatternMatches(pattern, url));
}

/**
 * Full validation for a user-supplied server URL, used by BOTH popup.js
 * (before saving to chrome.storage.local) and background.js (defensively,
 * right before every /analyze fetch -- see that file's handleAnalyze,
 * since storage can in principle hold a value that was never validated,
 * e.g. edited directly via chrome://extensions or a stale value from
 * before a manifest change narrowed host_permissions).
 *
 * Three possible outcomes, distinguished by `reason` so a caller can
 * branch without parsing `message` prose:
 *   - empty input -> reason: "empty"
 *   - not a parseable http(s) URL -> reason: "malformed"
 *   - a well-formed URL outside host_permissions -> reason: "host_not_permitted"
 *   - otherwise -> { ok: true, value: <trailing-slash-trimmed URL> }
 *
 * @param {string} rawValue
 * @param {string[]} [allowedPatterns]
 * @returns {{ok: true, value: string} | {ok: false, reason: string, message: string}}
 */
export function validateServerUrl(rawValue, allowedPatterns = DEFAULT_ALLOWED_HOST_PATTERNS) {
  const trimmed = typeof rawValue === "string" ? rawValue.trim() : "";

  if (!trimmed) {
    return { ok: false, reason: "empty", message: "Server URL cannot be empty." };
  }
  if (!isWellFormedHttpUrl(trimmed)) {
    return { ok: false, reason: "malformed", message: `"${trimmed}" is not a valid http:// or https:// URL.` };
  }

  // Trim a trailing slash so stored values are consistent regardless of
  // how the user typed it ("http://localhost:8000/" and
  // "http://localhost:8000" must behave identically -- background.js
  // always appends "/analyze" itself).
  const normalized = trimmed.replace(/\/+$/, "");

  if (!isHostAllowed(normalized, allowedPatterns)) {
    return {
      ok: false,
      reason: "host_not_permitted",
      message:
        `"${normalized}" is outside this extension's permitted hosts (${allowedPatterns.join(", ")}). ` +
        "Chrome blocks network requests to any other host at the manifest level, before this extension's own " +
        "code ever runs -- saving this value would fail silently with an opaque network error, not a helpful " +
        "one. Using a different host requires widening manifest.json's host_permissions and reloading the " +
        "extension, which is a deliberate, separate decision this settings field does not make on its own.",
    };
  }

  return { ok: true, value: normalized };
}
