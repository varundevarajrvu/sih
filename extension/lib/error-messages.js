// SIH 26171 -- Tier 4 (usable-extension pass), TASK 3.
//
// PROBLEM THIS SOLVES: server/main.py already distinguishes failure modes
// precisely (a 400 PII_LEAK_DETECTED is nothing like a 502
// VLM_BACKEND_CALL_FAILED, which is itself nothing like a network-level
// "the server isn't running at all"), and server/vlm_client.py already has
// named exception classes per backend (GeminiRateLimited,
// ClaudeCredentialsMissing, ...) baked into that 502's `message` text as
// `"VLM backend call failed ({ExceptionClassName})."` (see
// server/main.py's `analyze()` -- deliberately only the exception's TYPE
// NAME, never `str(exc)`, so no backend-specific detail that might echo
// request content ever reaches this far). None of that distinction
// currently reaches a human: background.js's handleAnalyze forwards the
// raw JSON body and content.js's `errorClassOf()` reduces it to a bare
// string like "http_502" for the RUN SUMMARY log. This module is the
// missing translation step -- from that same raw shape to one short,
// ACTIONABLE sentence, per the task brief's own bar: "Server not reachable
// at http://localhost:8000 -- is uvicorn running?" beats "fetch failed".
//
// ARCHITECTURE (same pattern as stall-detector.js/element-ranker.js): a
// pure function over plain data (the response object background.js's
// handleAnalyze already returns), zero DOM/chrome/network dependency,
// fully deterministic, unit-testable in plain Node against hand-built
// fixture response shapes -- no live server, no real error, required.
//
// DELIBERATELY NOT a 1:1 reimplementation of content.js's own
// errorClassOf() (used for the RUN SUMMARY's `errorClass` instrumentation
// field): that function's output strings ("network_error", "http_502",
// ...) are an established, already-relied-on shape and this pass does not
// touch content.js's RUN SUMMARY format. classifyAnalyzeError() below is
// an independent, compatible re-derivation used ONLY to select a message
// bucket -- a small amount of duplication, accepted explicitly rather than
// risking a behavior change to instrumentation content.js already emits.
// ---------------------------------------------------------------------------

/**
 * Reduce a background.js ANALYZE_ERROR-shaped response to a stable class
 * string used to pick a message bucket below. Mirrors content.js's own
 * errorClassOf() logic (see file header) without importing it, since that
 * function lives in a classic content script, not an importable module.
 *
 * @param {{status?: number, error?: {message?: string, errorCode?: string}}|null} resp
 * @returns {string}
 */
export function classifyAnalyzeError(resp) {
  if (!resp) return "no_response";
  if (resp.error && typeof resp.error === "object" && typeof resp.error.errorCode === "string") {
    return resp.error.errorCode;
  }
  if (resp.status === 0) return "network_error";
  if (typeof resp.status === "number") return `http_${resp.status}`;
  return "unknown";
}

// Substring hints matched against the 502 VLM_BACKEND_CALL_FAILED
// message's embedded exception class name (see file header) -- checked in
// order, first match wins. "RateLimited" is checked before the more
// general "APIError"/"ConnectionError" patterns would otherwise also be
// candidates for, since every *RateLimited class name also happens to
// contain neither substring, but keeping an explicit order documents the
// intent rather than relying on regex non-overlap by accident.
const BACKEND_EXCEPTION_HINTS = [
  {
    match: /RateLimited/,
    text: (backend) =>
      `${backend}'s API rate-limited the request. This is routine on free tiers -- wait a bit and try again, ` +
      "or switch VLM_BACKEND/API key on the server.",
  },
  {
    match: /CredentialsMissing/,
    text: (backend) =>
      `${backend} is selected but the server has no API key configured for it. Set the required environment ` +
      "variable (see server/README.md) and restart uvicorn.",
  },
  {
    match: /ModelNotFound/,
    text: (backend) => `${backend} rejected the configured model id. Check the *_MODEL environment variable on the server.`,
  },
  {
    match: /ConnectionError/,
    text: (backend) => `The server could not reach ${backend}'s API (a network/DNS issue on the SERVER's side, not this extension).`,
  },
  {
    match: /APIError/,
    text: (backend) => `${backend}'s API returned an error the server could not otherwise classify.`,
  },
];

function detectBackendName(rawMessage) {
  const msg = typeof rawMessage === "string" ? rawMessage : "";
  if (/Gemini/.test(msg)) return "Gemini";
  if (/Claude/.test(msg)) return "Claude";
  if (/Ollama/.test(msg)) return "Ollama";
  return "The VLM backend";
}

/**
 * Map a background.js ANALYZE_ERROR-shaped response (or a null/undefined
 * "no response at all") to one short, actionable human message plus the
 * raw detail for anyone who wants it. Never throws -- an unrecognized
 * shape degrades to a generic-but-still-worded message, never a blank
 * popup or a stack trace.
 *
 * @param {{status?: number, error?: {message?: string, errorCode?: string, violations?: *}}|null} resp
 * @param {{serverUrl?: string}} [opts]
 * @returns {{summary: string, detail: string, actionable: boolean}}
 *   `actionable` is true when there's a concrete fix a user/operator can
 *   take (start the server, set an API key, wait out a rate limit);
 *   false for failure modes that are a code/model bug, not a config gap.
 */
export function mapAnalyzeErrorToMessage(resp, opts = {}) {
  const serverUrl = opts.serverUrl || "the configured server URL";
  const cls = classifyAnalyzeError(resp);
  const rawMessage = (resp && resp.error && typeof resp.error.message === "string" && resp.error.message) || "";

  switch (cls) {
    case "no_response":
      return {
        summary: "No response came back from the extension's background service worker at all.",
        detail: rawMessage,
        actionable: false,
      };

    case "network_error":
      return {
        summary: `Server not reachable at ${serverUrl} -- is uvicorn running?`,
        detail: rawMessage || "(no further detail -- the connection attempt itself failed)",
        actionable: true,
      };

    case "SERVER_URL_NOT_PERMITTED":
      // background.js already builds a fully-worded, specific message for
      // this case (it knows the exact configured URL and the exact
      // allowed patterns) -- pass it through rather than re-deriving a
      // vaguer one here.
      return {
        summary: rawMessage || `Server URL "${serverUrl}" is outside this extension's permitted hosts.`,
        detail: rawMessage,
        actionable: true,
      };

    case "STOPPED":
      return {
        summary: "Request was cancelled because you clicked Stop.",
        detail: rawMessage,
        actionable: false,
      };

    case "PII_LEAK_DETECTED":
      return {
        summary:
          "The server refused the request because it detected unredacted PII in the payload. This should never " +
          "happen and points at a client-side sanitization bug, not something to retry.",
        detail: rawMessage,
        actionable: false,
      };

    case "VLM_BACKEND_CALL_FAILED": {
      const backend = detectBackendName(rawMessage);
      const hint = BACKEND_EXCEPTION_HINTS.find((h) => h.match.test(rawMessage));
      return {
        summary: hint ? hint.text(backend) : `${backend} call failed on the server.`,
        detail: rawMessage,
        actionable: true,
      };
    }

    case "VLM_RESPONSE_SCHEMA_INVALID":
      return {
        summary:
          "The VLM returned a response that didn't match the expected {action, targetId, value} shape -- a " +
          "model/prompt issue on the server side, not something this extension can fix by retrying.",
        detail: rawMessage,
        actionable: false,
      };

    case "http_422":
      return {
        summary: "The server rejected the request as malformed (HTTP 422) -- likely an extension/server version mismatch.",
        detail: rawMessage,
        actionable: false,
      };

    default:
      if (cls.startsWith("http_")) {
        const code = cls.slice("http_".length);
        return {
          summary: `Server returned an unexpected error (HTTP ${code}).`,
          detail: rawMessage,
          actionable: false,
        };
      }
      return {
        summary: rawMessage ? `Unrecognized error from the server: ${rawMessage}` : "An unknown error occurred while talking to the server.",
        detail: rawMessage,
        actionable: false,
      };
  }
}
