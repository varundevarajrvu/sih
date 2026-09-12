// SIH 26171 -- Tier 4 (usable-extension pass), TASK 3:
// extension/lib/error-messages.js tests.
//
// Pure formatting module, zero DOM/chrome/network dependency -- run with
// plain Node's built-in test runner against hand-built fixture response
// shapes (exactly what background.js's handleAnalyze actually returns for
// each failure mode -- see that file and server/main.py's own documented
// error bodies, e.g. `"VLM backend call failed (GeminiRateLimited)."`).
//
// Run with: node --test tests/unit/test_error_messages.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { classifyAnalyzeError, mapAnalyzeErrorToMessage } from "../../extension/lib/error-messages.js";

describe("classifyAnalyzeError", () => {
  test("no response at all -> 'no_response'", () => {
    assert.equal(classifyAnalyzeError(null), "no_response");
    assert.equal(classifyAnalyzeError(undefined), "no_response");
  });

  test("status 0 with no errorCode -> 'network_error'", () => {
    assert.equal(classifyAnalyzeError({ status: 0, error: { message: "Failed to fetch" } }), "network_error");
  });

  test("an explicit errorCode always wins over the numeric status", () => {
    assert.equal(classifyAnalyzeError({ status: 400, error: { errorCode: "PII_LEAK_DETECTED" } }), "PII_LEAK_DETECTED");
    assert.equal(classifyAnalyzeError({ status: 502, error: { errorCode: "VLM_BACKEND_CALL_FAILED" } }), "VLM_BACKEND_CALL_FAILED");
  });

  test("a bare HTTP status with no errorCode -> 'http_<status>'", () => {
    assert.equal(classifyAnalyzeError({ status: 502, error: { message: "HTTP 502" } }), "http_502");
    assert.equal(classifyAnalyzeError({ status: 422, error: { message: "HTTP 422" } }), "http_422");
  });
});

describe("mapAnalyzeErrorToMessage -- 'server not reachable' (task brief's own bar)", () => {
  test("beats 'fetch failed' with a specific, actionable sentence naming the server URL", () => {
    const resp = { status: 0, error: { message: "Failed to fetch" } };
    const result = mapAnalyzeErrorToMessage(resp, { serverUrl: "http://localhost:8000" });
    assert.equal(result.summary, "Server not reachable at http://localhost:8000 -- is uvicorn running?");
    assert.equal(result.actionable, true);
    assert.ok(!result.summary.includes("fetch failed"), "must not just relay the raw browser error string as the summary");
  });

  test("falls back to a generic server URL phrase when none is given", () => {
    const result = mapAnalyzeErrorToMessage({ status: 0, error: { message: "Failed to fetch" } });
    assert.match(result.summary, /Server not reachable at .+ -- is uvicorn running\?/);
  });
});

describe("mapAnalyzeErrorToMessage -- VLM_BACKEND_CALL_FAILED, distinguished by embedded exception class name", () => {
  test("GeminiRateLimited -> names Gemini and explains it's a routine rate limit", () => {
    const resp = {
      status: 502,
      error: { errorCode: "VLM_BACKEND_CALL_FAILED", message: "VLM backend call failed (GeminiRateLimited)." },
    };
    const result = mapAnalyzeErrorToMessage(resp);
    assert.match(result.summary, /Gemini/);
    assert.match(result.summary, /rate/i);
    assert.equal(result.actionable, true);
  });

  test("ClaudeCredentialsMissing -> names Claude and points at the missing API key / restart", () => {
    const resp = {
      status: 502,
      error: { errorCode: "VLM_BACKEND_CALL_FAILED", message: "VLM backend call failed (ClaudeCredentialsMissing)." },
    };
    const result = mapAnalyzeErrorToMessage(resp);
    assert.match(result.summary, /Claude/);
    assert.match(result.summary, /API key/i);
  });

  test("GeminiModelNotFound -> names Gemini and points at the model env var", () => {
    const resp = {
      status: 502,
      error: { errorCode: "VLM_BACKEND_CALL_FAILED", message: "VLM backend call failed (GeminiModelNotFound)." },
    };
    const result = mapAnalyzeErrorToMessage(resp);
    assert.match(result.summary, /Gemini/);
    assert.match(result.summary, /model/i);
  });

  test("ClaudeConnectionError -> explains it's a SERVER-side network issue, not this extension's", () => {
    const resp = {
      status: 502,
      error: { errorCode: "VLM_BACKEND_CALL_FAILED", message: "VLM backend call failed (ClaudeConnectionError)." },
    };
    const result = mapAnalyzeErrorToMessage(resp);
    assert.match(result.summary, /Claude/);
    assert.match(result.summary, /server/i);
  });

  test("an unrecognized backend exception class name still names the detected backend and doesn't crash", () => {
    const resp = {
      status: 502,
      error: { errorCode: "VLM_BACKEND_CALL_FAILED", message: "VLM backend call failed (SomeNewGeminiException)." },
    };
    const result = mapAnalyzeErrorToMessage(resp);
    assert.match(result.summary, /Gemini/);
  });

  test("no backend name detectable at all -> generic 'The VLM backend' phrasing, never blank", () => {
    const resp = { status: 502, error: { errorCode: "VLM_BACKEND_CALL_FAILED", message: "VLM backend call failed (RuntimeError)." } };
    const result = mapAnalyzeErrorToMessage(resp);
    assert.match(result.summary, /VLM backend/);
  });
});

describe("mapAnalyzeErrorToMessage -- other server-distinguished failure modes", () => {
  test("PII_LEAK_DETECTED -> flags it as a client bug, not something to retry, and is NOT actionable by the user", () => {
    const resp = { status: 400, error: { errorCode: "PII_LEAK_DETECTED", message: "Request rejected...", violations: ["agent-1"] } };
    const result = mapAnalyzeErrorToMessage(resp);
    assert.match(result.summary, /PII/);
    assert.equal(result.actionable, false);
  });

  test("VLM_RESPONSE_SCHEMA_INVALID -> a model/prompt issue, not retryable by the extension", () => {
    const resp = { status: 502, error: { errorCode: "VLM_RESPONSE_SCHEMA_INVALID", message: "..." } };
    const result = mapAnalyzeErrorToMessage(resp);
    assert.match(result.summary, /shape|schema/i);
    assert.equal(result.actionable, false);
  });

  test("SERVER_URL_NOT_PERMITTED passes through background.js's own already-specific message verbatim", () => {
    const specificMessage = 'Server URL "http://example.com:8000" is outside this extension\'s permitted hosts (http://localhost/*, http://127.0.0.1/*).';
    const resp = { status: 0, error: { errorCode: "SERVER_URL_NOT_PERMITTED", message: specificMessage } };
    const result = mapAnalyzeErrorToMessage(resp);
    assert.equal(result.summary, specificMessage);
    assert.equal(result.actionable, true);
  });

  test("STOPPED reads as a deliberate user action, not an error to worry about", () => {
    const resp = { status: 0, error: { errorCode: "STOPPED", message: "request cancelled by Stop" } };
    const result = mapAnalyzeErrorToMessage(resp);
    assert.match(result.summary, /Stop/);
    assert.equal(result.actionable, false);
  });

  test("http_422 -> flags a version mismatch, not a transient issue", () => {
    const resp = { status: 422, error: { message: "..." } };
    const result = mapAnalyzeErrorToMessage(resp);
    assert.match(result.summary, /422/);
  });

  test("an arbitrary unmapped HTTP status still renders a coherent sentence naming the status code", () => {
    const resp = { status: 503, error: { message: "..." } };
    const result = mapAnalyzeErrorToMessage(resp);
    assert.match(result.summary, /503/);
  });

  test("no_response (background.js gave back nothing at all) never throws and never renders blank", () => {
    const result = mapAnalyzeErrorToMessage(null);
    assert.ok(result.summary && result.summary.length > 0);
  });

  test("completely malformed input degrades to a generic message rather than throwing", () => {
    assert.doesNotThrow(() => mapAnalyzeErrorToMessage({}));
    assert.doesNotThrow(() => mapAnalyzeErrorToMessage({ error: "not an object" }));
  });
});
