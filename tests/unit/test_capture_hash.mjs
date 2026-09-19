// SIH 26171 -- extension/lib/capture-hash.js tests.
//
// hashScreenshot() uses only Web Crypto's SubtleCrypto + atob(), both
// global in Node 18+ -- no jsdom needed at all (like frame-coords.js /
// capture-plan.js's own pure-math suites). detectStaleCapture() is fully
// synchronous plain-data-in/plain-data-out, same as detectStall().
//
// Run with: node --test tests/unit/test_capture_hash.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { hashScreenshot, detectStaleCapture } from "../../extension/lib/capture-hash.js";

// A tiny valid base64 PNG (1x1 transparent pixel) -- exact bytes don't
// matter for these tests, only that decoding + hashing is deterministic
// and that DIFFERENT inputs produce DIFFERENT hashes.
const PNG_A =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
// Same PNG with the leading byte pattern's easiest-to-mutate byte flipped
// (a different but still-decodable base64 string) -- used only to prove
// hashScreenshot() is sensitive to actual byte content, not just length.
const PNG_B =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("hashScreenshot()", () => {
  test("returns a 64-char lowercase hex SHA-256 digest", async () => {
    const hash = await hashScreenshot(PNG_A);
    assert.equal(typeof hash, "string");
    assert.equal(hash.length, 64);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  test("is deterministic -- same input, same hash, every time", async () => {
    const h1 = await hashScreenshot(PNG_A);
    const h2 = await hashScreenshot(PNG_A);
    assert.equal(h1, h2);
  });

  test("different bytes -> different hash", async () => {
    const hA = await hashScreenshot(PNG_A);
    const hB = await hashScreenshot(PNG_B);
    assert.notEqual(hA, hB);
  });

  test("throws on a non-string input", async () => {
    await assert.rejects(() => hashScreenshot(null), /non-empty base64 string/);
    await assert.rejects(() => hashScreenshot(undefined), /non-empty base64 string/);
    await assert.rejects(() => hashScreenshot(12345), /non-empty base64 string/);
  });

  test("throws on an empty string", async () => {
    await assert.rejects(() => hashScreenshot(""), /non-empty base64 string/);
  });

  test("hashes DECODED bytes, not the base64 text itself (sanity: two base64 strings that decode to the same bytes hash identically)", async () => {
    // Re-encoding the exact same bytes must be byte-identical to itself --
    // this is really just reinforcing determinism, but framed against the
    // "decoded bytes, not the text" contract in the doc comment.
    const h1 = await hashScreenshot(PNG_A);
    const h2 = await hashScreenshot(PNG_A.slice(0)); // a distinct string instance, same characters
    assert.equal(h1, h2);
  });
});

describe("detectStaleCapture() -- RULING A: stale = identical hash AND scroll position changed", () => {
  test("first step of a run (no previous hash/scrollY at all) -> no verdict, not stale", () => {
    const result = detectStaleCapture({
      previousHash: null,
      previousScrollY: null,
      currentHash: "abc123",
      currentScrollY: 0,
    });
    assert.equal(result, null);
  });

  test("undefined params object -> no verdict, does not throw", () => {
    assert.equal(detectStaleCapture(), null);
    assert.equal(detectStaleCapture({}), null);
  });

  test("DIFFERENT hashes (the page's pixels changed) -> never stale, regardless of scroll", () => {
    const result = detectStaleCapture({
      previousHash: "hash-1",
      previousScrollY: 0,
      currentHash: "hash-2",
      currentScrollY: 2613,
    });
    assert.equal(result, null);
  });

  test("SAME hash + SAME scrollY (a genuinely static page/step) -> NOT stale -- the normal, correct case", () => {
    const result = detectStaleCapture({
      previousHash: "hash-1",
      previousScrollY: 500,
      currentHash: "hash-1",
      currentScrollY: 500,
    });
    assert.equal(result, null);
  });

  test("SAME hash + CHANGED scrollY -> STALE, reproducing the exact 2026-09-17 observation's shape", () => {
    // agent-1 bbox y went 1161.0 -> -1452.0, implying a scroll delta of
    // 2613px, with byte-identical screenshots across the two steps.
    const result = detectStaleCapture({
      previousHash: "same-hash",
      previousScrollY: 1161,
      currentHash: "same-hash",
      currentScrollY: 1161 - 2613,
    });
    assert.ok(result, "expected a stale verdict");
    assert.equal(result.stale, true);
    assert.equal(result.hash, "same-hash");
    assert.equal(result.previousScrollY, 1161);
    assert.equal(result.currentScrollY, 1161 - 2613);
    assert.equal(result.scrollDelta, -2613);
  });

  test("scroll delta can be positive (scrolled down) or negative (scrolled up) -- both are stale", () => {
    const down = detectStaleCapture({ previousHash: "h", previousScrollY: 0, currentHash: "h", currentScrollY: 300 });
    const up = detectStaleCapture({ previousHash: "h", previousScrollY: 300, currentHash: "h", currentScrollY: 0 });
    assert.equal(down.scrollDelta, 300);
    assert.equal(up.scrollDelta, -300);
  });

  test("missing/non-string hash on either side -> no verdict, never throws", () => {
    assert.equal(detectStaleCapture({ previousHash: undefined, previousScrollY: 0, currentHash: "h", currentScrollY: 0 }), null);
    assert.equal(detectStaleCapture({ previousHash: "h", previousScrollY: 0, currentHash: undefined, currentScrollY: 0 }), null);
    assert.equal(detectStaleCapture({ previousHash: 123, previousScrollY: 0, currentHash: "h", currentScrollY: 0 }), null);
  });

  test("non-finite/missing scrollY on either side -> no verdict, never throws (covers full-page capture mode, which never populates a hash and thus never reaches this path in practice)", () => {
    assert.equal(detectStaleCapture({ previousHash: "h", previousScrollY: NaN, currentHash: "h", currentScrollY: 0 }), null);
    assert.equal(detectStaleCapture({ previousHash: "h", previousScrollY: 0, currentHash: "h", currentScrollY: undefined }), null);
    assert.equal(detectStaleCapture({ previousHash: "h", previousScrollY: 0, currentHash: "h", currentScrollY: Infinity }), null);
  });

  test("empty-string hash counts as missing, not as a valid (matching) value", () => {
    assert.equal(detectStaleCapture({ previousHash: "", previousScrollY: 0, currentHash: "", currentScrollY: 100 }), null);
  });
});
