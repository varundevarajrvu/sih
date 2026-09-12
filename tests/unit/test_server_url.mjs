// SIH 26171 -- Tier 4 (usable-extension pass), TASK 4:
// extension/lib/server-url.js tests.
//
// Pure validation module, zero DOM/chrome/network dependency -- run with
// plain Node's built-in test runner. Includes a cross-check against
// manifest.json's actual host_permissions so the two can never silently
// drift apart (see server-url.js's own header comment on
// DEFAULT_ALLOWED_HOST_PATTERNS).
//
// Run with: node --test tests/unit/test_server_url.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { isWellFormedHttpUrl, isHostAllowed, validateServerUrl, DEFAULT_ALLOWED_HOST_PATTERNS } from "../../extension/lib/server-url.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.resolve(__dirname, "..", "..", "extension", "manifest.json");

describe("DEFAULT_ALLOWED_HOST_PATTERNS matches manifest.json's host_permissions exactly", () => {
  test("no silent drift between this module's constant and the real manifest", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    assert.deepEqual(
      [...DEFAULT_ALLOWED_HOST_PATTERNS].sort(),
      [...manifest.host_permissions].sort(),
      "server-url.js's DEFAULT_ALLOWED_HOST_PATTERNS must be kept byte-for-byte in sync with manifest.json's host_permissions"
    );
  });
});

describe("isWellFormedHttpUrl", () => {
  test("accepts http/https URLs", () => {
    assert.equal(isWellFormedHttpUrl("http://localhost:8000"), true);
    assert.equal(isWellFormedHttpUrl("https://example.com"), true);
  });

  test("rejects garbage / non-URL strings", () => {
    assert.equal(isWellFormedHttpUrl("not a url"), false);
    assert.equal(isWellFormedHttpUrl(""), false);
    assert.equal(isWellFormedHttpUrl("   "), false);
  });

  test("rejects non-http(s) schemes", () => {
    assert.equal(isWellFormedHttpUrl("ftp://localhost:8000"), false);
    assert.equal(isWellFormedHttpUrl("chrome-extension://abcdef/popup.html"), false);
    assert.equal(isWellFormedHttpUrl("javascript:alert(1)"), false);
  });

  test("never throws on malformed input", () => {
    assert.doesNotThrow(() => isWellFormedHttpUrl(undefined));
    assert.doesNotThrow(() => isWellFormedHttpUrl(null));
  });
});

describe("isHostAllowed", () => {
  test("localhost, any port, is allowed", () => {
    assert.equal(isHostAllowed("http://localhost:8000"), true);
    assert.equal(isHostAllowed("http://localhost:3000"), true);
    assert.equal(isHostAllowed("http://localhost"), true);
  });

  test("127.0.0.1, any port, is allowed", () => {
    assert.equal(isHostAllowed("http://127.0.0.1:8000"), true);
  });

  test("a different host is NOT allowed, even a plausible-looking one", () => {
    assert.equal(isHostAllowed("http://example.com:8000"), false);
    assert.equal(isHostAllowed("http://192.168.1.5:8000"), false);
    assert.equal(isHostAllowed("http://0.0.0.0:8000"), false);
  });

  test("https on localhost is NOT allowed -- manifest.json only lists http://", () => {
    assert.equal(isHostAllowed("https://localhost:8000"), false);
  });

  test("a malformed URL is never 'allowed' (fails closed, does not throw)", () => {
    assert.equal(isHostAllowed("not a url"), false);
  });

  test("accepts a custom allowedPatterns list, for callers that want to check against something other than the shipped default", () => {
    assert.equal(isHostAllowed("http://example.com:8000", ["http://example.com/*"]), true);
    assert.equal(isHostAllowed("http://localhost:8000", ["http://example.com/*"]), false);
  });
});

describe("validateServerUrl", () => {
  test("empty input -> reason 'empty'", () => {
    const result = validateServerUrl("");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "empty");
  });

  test("whitespace-only input -> reason 'empty'", () => {
    const result = validateServerUrl("   ");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "empty");
  });

  test("garbage input -> reason 'malformed'", () => {
    const result = validateServerUrl("not a url at all");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "malformed");
  });

  test("a well-formed URL outside host_permissions -> reason 'host_not_permitted', with a plain explanation, never an opaque failure", () => {
    const result = validateServerUrl("http://example.com:8000");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "host_not_permitted");
    assert.match(result.message, /host_permissions/);
    assert.match(result.message, /example\.com/);
  });

  test("the CURRENT hardcoded default (http://localhost:8000) validates successfully -- a fresh install must behave identically to before this setting existed", () => {
    const result = validateServerUrl("http://localhost:8000");
    assert.equal(result.ok, true);
    assert.equal(result.value, "http://localhost:8000");
  });

  test("127.0.0.1 with a port validates successfully", () => {
    const result = validateServerUrl("http://127.0.0.1:9000");
    assert.equal(result.ok, true);
  });

  test("trims a trailing slash so stored values are consistent", () => {
    const result = validateServerUrl("http://localhost:8000/");
    assert.equal(result.ok, true);
    assert.equal(result.value, "http://localhost:8000");
  });

  test("trims surrounding whitespace before validating", () => {
    const result = validateServerUrl("  http://localhost:8000  ");
    assert.equal(result.ok, true);
    assert.equal(result.value, "http://localhost:8000");
  });

  test("never throws on any input shape", () => {
    assert.doesNotThrow(() => validateServerUrl(null));
    assert.doesNotThrow(() => validateServerUrl(undefined));
    assert.doesNotThrow(() => validateServerUrl(12345));
    assert.doesNotThrow(() => validateServerUrl({}));
  });
});
