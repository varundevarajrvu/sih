// SIH 26171 -- extension/lib/capture-hash.js tests.
//
// hashScreenshot() uses only Web Crypto's SubtleCrypto + atob(), both
// global in Node 18+ -- no jsdom needed at all (like frame-coords.js /
// capture-plan.js's own pure-math suites). readPngDimensions() is fully
// synchronous and equally dependency-free. detectDimensionMismatch() and
// detectHashRecurrence() are plain-data-in/plain-data-out, same shape as
// detectStall().
//
// Run with: node --test tests/unit/test_capture_hash.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";

import {
  hashScreenshot,
  readPngDimensions,
  detectDimensionMismatch,
  detectHashRecurrence,
  DIMENSION_MISMATCH_TOLERANCE_PX,
} from "../../extension/lib/capture-hash.js";

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

// Builds a byte buffer that is a syntactically-correct-enough PNG HEADER
// for readPngDimensions() to parse -- signature + IHDR chunk (length,
// type, width, height) + a few filler bytes (bit depth/color
// type/compression/filter/interlace + a placeholder CRC). Not a real,
// decodable image (no IDAT/IEND, no real CRC) -- deliberately, since
// readPngDimensions() only ever reads the first 24 bytes and this module
// never decodes pixel data.
function buildPngBase64({ width, height }) {
  const buf = Buffer.alloc(33);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // PNG signature
  buf.writeUInt32BE(13, 8); // IHDR chunk length (standard, unvalidated by this module)
  buf.write("IHDR", 12, "ascii"); // chunk type
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  buf.set([8, 6, 0, 0, 0], 24); // bit depth, color type, compression, filter, interlace -- arbitrary
  buf.set([0, 0, 0, 0], 29); // CRC placeholder -- arbitrary, never validated by this module
  return buf.toString("base64");
}

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
});

describe("readPngDimensions()", () => {
  test("reads width/height straight from a well-formed IHDR header", () => {
    const dims = readPngDimensions(buildPngBase64({ width: 1920, height: 1040 }));
    assert.deepEqual(dims, { width: 1920, height: 1040 });
  });

  test("works for small dimensions too (e.g. the ~265px-wide window CLAUDE.md's OPEN-bug entry names)", () => {
    const dims = readPngDimensions(buildPngBase64({ width: 265, height: 3000 }));
    assert.deepEqual(dims, { width: 265, height: 3000 });
  });

  test("does not need the full image -- a header-only prefix followed by garbage still parses correctly", () => {
    const headerB64 = buildPngBase64({ width: 800, height: 600 });
    const withTrailingGarbage = headerB64 + "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    assert.deepEqual(readPngDimensions(withTrailingGarbage), { width: 800, height: 600 });
  });

  test("throws on a non-string/empty input", () => {
    assert.throws(() => readPngDimensions(null), /non-empty base64 string/);
    assert.throws(() => readPngDimensions(undefined), /non-empty base64 string/);
    assert.throws(() => readPngDimensions(""), /non-empty base64 string/);
  });

  test("throws on an input too short to contain a PNG header", () => {
    assert.throws(() => readPngDimensions("QQ=="), /too short|not a valid PNG/);
  });

  test("throws on input that does not start with the PNG signature -- not a PNG", () => {
    const notPng = Buffer.from("this is definitely not a png file at all, just plain text padding").toString("base64");
    assert.throws(() => readPngDimensions(notPng), /PNG signature|not a PNG/);
  });

  test("throws when the first chunk is not IHDR -- garbage rather than a garbage size", () => {
    const buf = Buffer.alloc(33);
    buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // valid signature
    buf.writeUInt32BE(13, 8);
    buf.write("XXXX", 12, "ascii"); // NOT "IHDR"
    buf.writeUInt32BE(100, 16);
    buf.writeUInt32BE(100, 20);
    assert.throws(() => readPngDimensions(buf.toString("base64")), /IHDR|not a valid PNG/);
  });

  test("a JPEG (different magic signature entirely) is rejected, not silently misread", () => {
    const jpegLike = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert.throws(() => readPngDimensions(jpegLike.toString("base64")), /PNG signature|not a PNG/);
  });
});

describe("detectDimensionMismatch() -- RULING A' check 1, PRIMARY, no history needed", () => {
  test("exact match -> no verdict", () => {
    const result = detectDimensionMismatch({ expectedWidth: 1920, expectedHeight: 1040, actualWidth: 1920, actualHeight: 1040 });
    assert.equal(result, null);
  });

  test("within the default tolerance (<=2px each axis) -> no verdict", () => {
    assert.equal(
      detectDimensionMismatch({ expectedWidth: 1920, expectedHeight: 1040, actualWidth: 1921, actualHeight: 1039 }),
      null
    );
    assert.equal(
      detectDimensionMismatch({ expectedWidth: 1920, expectedHeight: 1040, actualWidth: 1922, actualHeight: 1042 }),
      null,
      "exactly at the tolerance boundary must still pass"
    );
  });

  test("beyond the default tolerance -> verdict, with expected/actual/delta all reported", () => {
    const result = detectDimensionMismatch({ expectedWidth: 1920, expectedHeight: 1040, actualWidth: 1930, actualHeight: 1040 });
    assert.ok(result, "expected a mismatch verdict");
    assert.equal(result.mismatch, true);
    assert.equal(result.expectedWidth, 1920);
    assert.equal(result.actualWidth, 1930);
    assert.equal(result.deltaWidth, 10);
    assert.equal(result.deltaHeight, 0);
  });

  test("MANDATORY: fractional devicePixelRatio 1.25 -- Chrome's own rounding must not false-positive", () => {
    // innerWidth 1013 * dpr 1.25 = 1266.25 -- genuinely non-integer expected value.
    const expectedWidth = 1013 * 1.25;
    const expectedHeight = 700 * 1.25;
    assert.equal(
      detectDimensionMismatch({ expectedWidth, expectedHeight, actualWidth: 1266, actualHeight: 875 }),
      null,
      "rounding DOWN from a fractional expected value must not fire"
    );
    assert.equal(
      detectDimensionMismatch({ expectedWidth, expectedHeight, actualWidth: 1267, actualHeight: 875 }),
      null,
      "rounding UP from a fractional expected value must not fire"
    );
  });

  test("MANDATORY: fractional devicePixelRatio 1.5 -- same requirement", () => {
    // innerWidth 1025 * dpr 1.5 = 1537.5 -- genuinely non-integer expected value.
    const expectedWidth = 1025 * 1.5;
    const expectedHeight = 900 * 1.5;
    assert.equal(
      detectDimensionMismatch({ expectedWidth, expectedHeight, actualWidth: 1537, actualHeight: 1350 }),
      null
    );
    assert.equal(
      detectDimensionMismatch({ expectedWidth, expectedHeight, actualWidth: 1538, actualHeight: 1350 }),
      null
    );
  });

  test("a REAL mismatch at a fractional DPR still fires (tolerance does not swallow a genuine difference)", () => {
    const expectedWidth = 1013 * 1.25; // 1266.25
    const expectedHeight = 700 * 1.25; // 875
    const result = detectDimensionMismatch({ expectedWidth, expectedHeight, actualWidth: 900, actualHeight: 875 });
    assert.ok(result, "a 366px-off width must still be flagged even with fractional-DPR tolerance in play");
  });

  test("uses DIMENSION_MISMATCH_TOLERANCE_PX as its default (exported constant, not a magic number re-derived by callers)", () => {
    const justOverDefault = DIMENSION_MISMATCH_TOLERANCE_PX + 1;
    const result = detectDimensionMismatch({
      expectedWidth: 1000,
      expectedHeight: 1000,
      actualWidth: 1000 + justOverDefault,
      actualHeight: 1000,
    });
    assert.ok(result);
  });

  test("a caller-supplied tolerancePx overrides the default", () => {
    assert.equal(
      detectDimensionMismatch({ expectedWidth: 1000, expectedHeight: 1000, actualWidth: 1010, actualHeight: 1000, tolerancePx: 20 }),
      null
    );
  });

  test("missing/non-finite inputs -> no verdict, never throws", () => {
    assert.equal(detectDimensionMismatch(), null);
    assert.equal(detectDimensionMismatch({}), null);
    assert.equal(
      detectDimensionMismatch({ expectedWidth: NaN, expectedHeight: 1000, actualWidth: 1000, actualHeight: 1000 }),
      null
    );
    assert.equal(
      detectDimensionMismatch({ expectedWidth: 1000, expectedHeight: 1000, actualWidth: undefined, actualHeight: 1000 }),
      null
    );
  });
});

describe("detectHashRecurrence() -- RULING A' check 2, SECONDARY, whole-run history", () => {
  test("a hash never seen before this run -> no verdict", () => {
    const seen = new Map();
    assert.equal(detectHashRecurrence(seen, { hash: "abc123", scrollY: 100 }), null);
  });

  test("the SAME hash recurring at the SAME scrollY -> NOT stale (scrolled away and back, nothing changed)", () => {
    const seen = new Map([["hash-1", 500]]);
    assert.equal(detectHashRecurrence(seen, { hash: "hash-1", scrollY: 500 }), null);
  });

  test("the SAME hash recurring at a DIFFERENT scrollY -> STALE", () => {
    const seen = new Map([["hash-1", 0]]);
    const result = detectHashRecurrence(seen, { hash: "hash-1", scrollY: 400 });
    assert.ok(result, "expected a stale verdict");
    assert.equal(result.stale, true);
    assert.equal(result.hash, "hash-1");
    assert.equal(result.firstSeenScrollY, 0);
    assert.equal(result.currentScrollY, 400);
    assert.equal(result.scrollDelta, 400);
  });

  test("does not mutate the caller's map", () => {
    const seen = new Map([["hash-1", 0]]);
    detectHashRecurrence(seen, { hash: "hash-1", scrollY: 400 });
    assert.equal(seen.size, 1);
    assert.equal(seen.get("hash-1"), 0, "first-seen value must be left untouched -- recording is the caller's job, not this function's");
  });

  test("a non-Map history -> no verdict, never throws", () => {
    assert.equal(detectHashRecurrence(null, { hash: "h", scrollY: 0 }), null);
    assert.equal(detectHashRecurrence(undefined, { hash: "h", scrollY: 0 }), null);
    assert.equal(detectHashRecurrence({}, { hash: "h", scrollY: 0 }), null);
    assert.equal(detectHashRecurrence([], { hash: "h", scrollY: 0 }), null);
  });

  test("missing/invalid hash or scrollY -> no verdict, never throws (covers full-page capture mode, which never populates a hash and so never reaches a verdict here without a separate branch)", () => {
    const seen = new Map([["hash-1", 0]]);
    assert.equal(detectHashRecurrence(seen, { hash: undefined, scrollY: 400 }), null);
    assert.equal(detectHashRecurrence(seen, { hash: "hash-1", scrollY: NaN }), null);
    assert.equal(detectHashRecurrence(seen, { hash: "hash-1", scrollY: undefined }), null);
    assert.equal(detectHashRecurrence(seen), null);
  });

  test("empty-string hash counts as missing, not as a valid lookup key", () => {
    const seen = new Map([["", 0]]);
    assert.equal(detectHashRecurrence(seen, { hash: "", scrollY: 400 }), null);
  });

  test("a second, DIFFERENT hash never seen before does not collide with an existing entry", () => {
    const seen = new Map([["hash-1", 0]]);
    assert.equal(detectHashRecurrence(seen, { hash: "hash-2", scrollY: 999 }), null);
  });
});

describe("CONSTRUCTED SCENARIO: cross-window-size staleness -- NOT a reproduction of the 2026-09-20 event (see CLAUDE.md 'RULING A WAS TOO NARROW' -> its own correction directly below it)", () => {
  // ---------------------------------------------------------------------
  // ⚠️ FRAMING CORRECTION (2026-09-20, same day, later sitting). This
  // block was originally written as "the regression test reproducing the
  // real 12:38 maximised/narrow-window miss." That framing was WRONG, and
  // the error was the orchestrator's, not this module's or this test's.
  //
  // What actually happened: window dimensions were never recorded for the
  // 12:38 run (the dimension instrumentation didn't exist yet), so "step
  // 2's hash came from an ~265px-wide window" was an INFERENCE, not a
  // measurement. Once the dimension instrumentation shipped, a LATER run
  // (13:49) recorded that exact same hash -- 832450c5...296eb0 -- with
  // `screenshotWidthPx: 1920, screenshotHeightPx: 970`. It is a
  // 1920x970 frame. The "narrow window" story was never true.
  //
  // WHAT THIS TEST ACTUALLY IS: a CONSTRUCTED scenario proving
  // detectDimensionMismatch() catches a frame captured under a genuinely
  // different window size than the one currently expected, using the
  // real hash strings from the 2026-09-20 observation only as flavour/
  // labels -- not as a claim about what those hashes' real dimensions
  // were. Cross-window-size staleness is a real failure mode and this is
  // a real, valid test of it. It does NOT reproduce the observed 12:38
  // event, and must not be cited as if it does.
  //
  // THE HONEST CONSEQUENCE, stated plainly rather than left implied by a
  // green test: if the 12:38 run was 1920x970 throughout (which the
  // 13:49 measurement now suggests), then AT STEP 2, NEITHER of Ruling
  // A''s checks would have fired -- dimensions would have matched (both
  // 1920x970), and 832450c5 had not been seen earlier IN THAT RUN (its
  // own step 1 was a different hash, 8f53565f...389593). Step 2 still
  // received a frame that did not reflect step 1's scroll-and-fill, and
  // Ruling A' does not demonstrably close that case. The only thing this
  // suite proves is that Ruling A' catches a stale frame that arrives
  // from a DIFFERENT window size, or that repeats an EARLIER hash in the
  // SAME run at a different scroll position -- not that it catches every
  // way a stale frame could arrive. A reader should take a green result
  // here as coverage of those two specific mechanisms, not as evidence
  // the underlying bug is closed.
  // ---------------------------------------------------------------------
  const HASH_A_LABEL = "8f53565f389593"; // borrowed from the 2026-09-20 observation, label only -- no claim about its real dimensions
  const HASH_B_LABEL = "832450c5296eb0"; // ditto -- this is the hash later measured at 1920x970, NOT at any "narrow" size

  test("detectHashRecurrence() does not flag two DIFFERENT hashes -- true independent of any window-size claim, and not sufficient on its own to catch every staleness shape (see the framing correction above)", () => {
    const seenThisRun = new Map([[HASH_A_LABEL, 0]]); // this run's own step 1
    const verdict = detectHashRecurrence(seenThisRun, {
      hash: HASH_B_LABEL, // step 2's hash -- different from anything seen so far THIS run
      scrollY: 0,
    });
    assert.equal(
      verdict,
      null,
      "the hash-recurrence check alone must not flag two hashes that simply differ -- it has nothing to compare against when a hash is genuinely new to this run, whatever the reason"
    );
  });

  test("detectDimensionMismatch() DOES flag a CONSTRUCTED cross-window-size case -- a real capability of the dimension check, not a reproduction of the 12:38 event (see the framing correction above)", () => {
    // Constructed "expected" side: a maximised viewport, dpr 1 for this
    // scenario (the fractional-DPR interaction is exercised separately
    // above).
    const expectedWidth = 1920;
    const expectedHeight = 970;
    // Constructed "actual" side: a frame captured under a genuinely
    // different, narrow window -- CLAUDE.md's own OPEN-bug entry names
    // this shape ("reflowed to ~3,000 px tall"). This pairing is
    // deliberately constructed to exercise the check, not measured from
    // any single real run.
    const actualWidth = 265;
    const actualHeight = 3000;

    const verdict = detectDimensionMismatch({ expectedWidth, expectedHeight, actualWidth, actualHeight });
    assert.ok(verdict, "expected the dimension check to catch a frame from an entirely different window size, with no history needed at all");
    assert.equal(verdict.mismatch, true);
    assert.equal(verdict.actualWidth, 265);
    assert.equal(verdict.expectedWidth, 1920);
  });
});
