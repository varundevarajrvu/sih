// SIH 26171 -- capture staleness detection.
//
// PROBLEM THIS SOLVES (CLAUDE.md "STILL OPEN -- capture can return a stale
// frame", first observed 2026-09-17, REPRODUCED AND CAUGHT 2026-09-20,
// mechanism NOT established): a step's screenshot can come back showing the
// WRONG viewport for the redaction rectangles computed against THAT step's
// (correctly current) DOM scan -- so whatever was on screen at the STALE
// position is transmitted, unredacted, dressed up as if it were redacted
// for the current one. The 2026-09-17 occurrence exposed nothing only
// because the sensitive fields happened to be below the fold at the stale
// image's scroll position -- "that is luck, not design."
//
// THIS MODULE MAKES THE SYMPTOM DETECTABLE, IT DOES NOT "FIX" IT -- the
// mechanism has been probed twice now (a compositor-occlusion hypothesis
// and, separately, a >57-minute-old cached frame resurfacing after a
// correct one) and NEITHER survived scrutiny. Inventing a third here would
// be exactly the kind of speculative mitigation this project's record
// warns against. What this module provides is a cheap, deterministic way
// for content.js to notice the SYMPTOM and refuse to send that step's
// image -- detect, refuse, report; never explain, never "fix the capture."
//
// ===========================================================================
// RULING A' -- TWO INDEPENDENT CHECKS, NOT ONE (amended 2026-09-20)
// ===========================================================================
// The original rule (RULING A, "stale = consecutive captures byte-identical
// AND the page's scroll position changed between them") shipped, caught a
// real occurrence in its first browser outing, and ALSO missed one the same
// day: a maximised-window run's step 2 silently received a ~265px-window
// frame from a run that had ended ~57 minutes earlier. Ruling A only ever
// compared against the IMMEDIATELY PREVIOUS capture -- `8f53565f... !=
// 832450c5...` (this run's own fresh step 1), so it reported no verdict
// while transmitting an hour-old frame. `staleCaptureCount: 0` on that run
// was a FALSE NEGATIVE. This was an orchestrator specification error, not
// an implementation defect -- the module did exactly what Ruling A said.
//
// The amendment is two INDEPENDENT checks, either of which is sufficient to
// refuse a step's send (see content.js's own "STALE-CAPTURE DETECTION"
// block for how both verdicts are combined):
//
//   1. DIMENSION CHECK (readPngDimensions() + detectDimensionMismatch(),
//      PRIMARY, definitive rather than heuristic): the captured PNG's own
//      pixel dimensions must match the current viewport x
//      devicePixelRatio. A frame captured under ANY other window state
//      fails this outright, with NO comparison history needed -- this
//      alone would have caught the maximised/narrow-window miss instantly,
//      on step 2, the moment it happened.
//   2. HASH RECURRENCE CHECK (detectHashRecurrence(), SECONDARY): extends
//      the original immediate-previous-only comparison to "does this exact
//      hash match ANY capture seen earlier in this run" -- a hash -> the
//      scrollY it was FIRST seen at, kept for the whole run. Still governed
//      by Ruling A's original discriminator: a hash recurring at the SAME
//      scroll position is the ordinary "scrolled away and back, nothing
//      changed" case and must NOT flag -- only a DIFFERENT scroll position
//      does.
//
// Both checks report a structured verdict or `null` -- never a merged
// boolean -- specifically so a caller can say WHICH one fired. Losing that
// distinction is exactly what let Ruling A's own blind spot go unnoticed
// for as long as it did.
//
// ARCHITECTURE: mirrors this repo's established pure-module pattern
// (element-ranker.js / action-risk.js / stall-detector.js /
// capture-plan.js) -- deterministic pure functions over plain data.
// hashScreenshot() is the one function here that isn't fully
// synchronous/DOM-free in the strictest sense (crypto.subtle.digest() is
// async by spec), but it has ZERO browser-only dependency: SubtleCrypto
// and atob() both exist, identically, in a Chrome MV3 service worker AND
// in Node 18+ -- no jsdom, no `window`/`document`, no extension runtime --
// which is exactly what makes it unit-testable under plain `node --test`.
// readPngDimensions() is fully synchronous and equally dependency-free.
//
// WHO CALLS WHAT (RULING B, unchanged by this amendment, binding, do not
// re-derive this differently): background.js's handleCaptureAndDetect()
// owns the screenshot bytes immediately after capture and calls both
// hashScreenshot() AND readPngDimensions() itself, returning
// `screenshotHash`/`screenshotWidthPx`/`screenshotHeightPx` on
// CAPTURE_AND_DETECT_RESULT -- background already holds the bytes, so
// nothing needs to cross the message boundary twice just to measure them.
// content.js never touches raw screenshot bytes for this purpose; it only
// ever sees the measurements, and owns BOTH verdicts, since it is the only
// context that also knows the page's scroll position and
// innerWidth/innerHeight/devicePixelRatio.
// ===========================================================================

function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function bytesToHex(bytes) {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * SHA-256 hex digest of the DECODED bytes of a base64 PNG screenshot (no
 * "data:" prefix -- same convention as every other screenshot value that
 * crosses this codebase's content<->background message boundary; see
 * background.js's stripDataUrlPrefix()). Uses SubtleCrypto deliberately
 * (an exact cryptographic hash, no collision concerns) rather than a
 * cheap non-crypto hash -- this repo's whole thesis is a privacy
 * guarantee, and "cheap but no correctness guarantee" is the wrong trade
 * for the one check whose entire job is proving two images are (or are
 * not) byte-for-byte identical.
 *
 * @param {string} base64Png raw base64, no "data:image/png;base64," prefix.
 * @returns {Promise<string>} lowercase hex SHA-256 digest of the decoded bytes.
 * @throws {Error} on a non-string/empty input, or if atob()/crypto.subtle
 *   are unavailable in the calling context (both are asserted, not
 *   silently worked around -- see this file's own header on why this must
 *   run identically in the MV3 service worker and under plain Node).
 */
export async function hashScreenshot(base64Png) {
  if (typeof base64Png !== "string" || base64Png.length === 0) {
    throw new Error("capture-hash.js: hashScreenshot() requires a non-empty base64 string");
  }
  if (typeof atob !== "function") {
    throw new Error(
      "capture-hash.js: hashScreenshot() requires a global atob() -- available in both a Chrome MV3 " +
        "service worker and Node 18+, so its absence here means this is running somewhere unexpected"
    );
  }
  if (typeof crypto === "undefined" || !crypto.subtle || typeof crypto.subtle.digest !== "function") {
    throw new Error(
      "capture-hash.js: hashScreenshot() requires SubtleCrypto (crypto.subtle.digest) -- available in " +
        "both a Chrome MV3 service worker and Node 18+, so its absence here means this is running " +
        "somewhere unexpected"
    );
  }

  const binary = atob(base64Png);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const digestBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digestBuffer));
}

// ===========================================================================
// 1. PNG DIMENSION PARSING -- read straight out of the IHDR header, fixed
//    byte offsets, no decode. See the module header (RULING A', check 1)
//    for why this is the PRIMARY check.
// ===========================================================================

// PNG's fixed 8-byte magic signature -- the file-format spec's own
// constant. Every valid PNG starts with exactly these bytes.
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// ASCII "IHDR" -- the PNG spec REQUIRES the image header to be the FIRST
// chunk, immediately after the signature, so this is always at a fixed
// offset in any valid PNG, not something that needs to be searched for.
const IHDR_CHUNK_TYPE = [0x49, 0x48, 0x44, 0x52];
// signature(8) + chunk-length(4) + chunk-type(4) + width(4) + height(4).
// The chunk-length/CRC fields are skipped over, not validated -- this
// module only needs to KNOW it is looking at an IHDR chunk (checked via
// the type bytes below) and read two fixed-offset fields from it.
const PNG_HEADER_BYTES_NEEDED = 24;
// base64 packs 3 bytes per 4 characters; 24 bytes needs exactly
// ceil(24/3)*4 = 32 characters, itself a multiple of 4 -- a clean,
// paddingless base64 "block" boundary. Slicing the FULL base64 string at
// this length and decoding ONLY that prefix therefore yields exactly 24
// real bytes with no partial-group ambiguity, regardless of how large the
// rest of the image is -- this is what makes the read zero decode cost,
// in sharp contrast to createImageBitmap()/canvas, which must decode the
// ENTIRE image just to answer "how big is it."
const PNG_HEADER_BASE64_CHARS_NEEDED = 32;

// binaryString is the plain "binary string" atob() returns (one char code
// per byte, 0-255) -- reads 4 bytes at `offset` as a big-endian uint32.
function readUint32BE(binaryString, offset) {
  return (
    ((binaryString.charCodeAt(offset) << 24) |
      (binaryString.charCodeAt(offset + 1) << 16) |
      (binaryString.charCodeAt(offset + 2) << 8) |
      binaryString.charCodeAt(offset + 3)) >>>
    0 // unsigned -- a byte with the high bit set would otherwise sign-extend through << 24
  );
}

/**
 * Width/height of a PNG, read straight from its IHDR chunk (big-endian
 * uint32s at fixed byte offsets 16-23) WITHOUT decoding the image.
 *
 * @param {string} base64Png raw base64, no "data:image/png;base64," prefix.
 * @returns {{width: number, height: number}}
 * @throws {Error} on a non-string/empty/too-short input, or on anything
 *   that isn't a PNG (wrong signature, or the first chunk isn't IHDR) --
 *   this THROWS rather than returning a garbage size: a caller silently
 *   trusting a bogus width/height would be worse than one that gets a
 *   clear, loud failure.
 */
export function readPngDimensions(base64Png) {
  if (typeof base64Png !== "string" || base64Png.length === 0) {
    throw new Error("capture-hash.js: readPngDimensions() requires a non-empty base64 string");
  }
  if (typeof atob !== "function") {
    throw new Error(
      "capture-hash.js: readPngDimensions() requires a global atob() -- available in both a Chrome MV3 " +
        "service worker and Node 18+, so its absence here means this is running somewhere unexpected"
    );
  }
  if (base64Png.length < PNG_HEADER_BASE64_CHARS_NEEDED) {
    throw new Error("capture-hash.js: readPngDimensions() input is too short to contain a PNG header -- not a valid PNG");
  }

  let header;
  try {
    header = atob(base64Png.slice(0, PNG_HEADER_BASE64_CHARS_NEEDED));
  } catch (err) {
    throw new Error(
      `capture-hash.js: readPngDimensions() could not base64-decode the header prefix -- not a valid PNG (${err?.message || err})`
    );
  }
  if (header.length < PNG_HEADER_BYTES_NEEDED) {
    throw new Error("capture-hash.js: readPngDimensions() decoded header is shorter than expected -- not a valid PNG");
  }

  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (header.charCodeAt(i) !== PNG_SIGNATURE[i]) {
      throw new Error("capture-hash.js: readPngDimensions() input does not start with the PNG signature -- not a PNG");
    }
  }
  for (let i = 0; i < IHDR_CHUNK_TYPE.length; i++) {
    if (header.charCodeAt(12 + i) !== IHDR_CHUNK_TYPE[i]) {
      throw new Error(
        "capture-hash.js: readPngDimensions() first chunk is not IHDR -- not a valid PNG (or a non-standard " +
          "PNG variant this module doesn't support)"
      );
    }
  }

  return {
    width: readUint32BE(header, 16),
    height: readUint32BE(header, 20),
  };
}

// ===========================================================================
// 2. DIMENSION MISMATCH -- PRIMARY check (RULING A', check 1). Pure,
//    stateless, no comparison history needed: a frame captured under a
//    different window state simply cannot match the CURRENT viewport, full
//    stop.
// ===========================================================================

// Absolute per-axis tolerance, in device px. MANDATORY -- do not remove or
// zero this. `devicePixelRatio` is commonly FRACTIONAL under Windows
// display scaling (1.25 / 1.5 / 1.75), so `innerWidth * dpr` is frequently
// NOT an integer and Chrome's own internal rounding will not agree with a
// naive `===`. An exact-equality implementation is a false-positive
// machine on the exact hardware this runs on -- see this file's own test
// suite for explicit fractional-DPR cases (1.25, 1.5) proving the default
// tolerance absorbs Chrome's rounding without absorbing a real mismatch.
export const DIMENSION_MISMATCH_TOLERANCE_PX = 2;

/**
 * Pure, synchronous, stateless -- compares a captured PNG's ACTUAL pixel
 * dimensions against the EXPECTED dimensions for the current viewport
 * (`innerWidth * devicePixelRatio`, `innerHeight * devicePixelRatio`).
 * Returns a structured verdict or `null`, exactly like this module's other
 * detectors; never throws on merely-insufficient data.
 *
 * @param {{expectedWidth?: number, expectedHeight?: number, actualWidth?: number, actualHeight?: number, tolerancePx?: number}} [params]
 * @returns {{ mismatch: true, expectedWidth: number, expectedHeight: number, actualWidth: number, actualHeight: number, deltaWidth: number, deltaHeight: number } | null}
 */
export function detectDimensionMismatch({
  expectedWidth,
  expectedHeight,
  actualWidth,
  actualHeight,
  tolerancePx = DIMENSION_MISMATCH_TOLERANCE_PX,
} = {}) {
  if (
    !isFiniteNumber(expectedWidth) ||
    !isFiniteNumber(expectedHeight) ||
    !isFiniteNumber(actualWidth) ||
    !isFiniteNumber(actualHeight) ||
    !isFiniteNumber(tolerancePx)
  ) {
    return null; // insufficient/malformed data -- no verdict, never a thrown exception here
  }

  const deltaWidth = actualWidth - expectedWidth;
  const deltaHeight = actualHeight - expectedHeight;
  if (Math.abs(deltaWidth) <= tolerancePx && Math.abs(deltaHeight) <= tolerancePx) return null;

  return {
    mismatch: true,
    expectedWidth,
    expectedHeight,
    actualWidth,
    actualHeight,
    deltaWidth,
    deltaHeight,
  };
}

// ===========================================================================
// 3. HASH RECURRENCE -- SECONDARY check (RULING A', check 2). Extends the
//    original Ruling A discriminator from "the immediately previous
//    capture" to "any capture seen earlier in this run".
//
//    stale = this exact hash was already seen earlier THIS RUN, at a
//            DIFFERENT scroll position.
//
// A hash recurring at the SAME scroll position is still the ordinary,
// correct "scrolled away and back, nothing changed" case and must NOT
// flag -- Ruling A's zero-false-positive property on a static page is
// preserved exactly, just evaluated against the whole run's history
// instead of a single previous sample.
// ===========================================================================

/**
 * Pure, synchronous -- takes the CALLER-OWNED history map (hash -> the
 * scrollY it was FIRST seen at, this run) and the current capture's
 * {hash, scrollY}, and returns a structured verdict or `null`.
 *
 * This function NEVER mutates `seenHashScrollY` -- recording a hash's
 * first-seen scrollY is the caller's job (content.js), done AFTER calling
 * this function, and ONLY when the hash is not already present (the map's
 * whole point is "first seen", so a later step must never overwrite an
 * earlier entry with a newer scrollY -- that would silently narrow the
 * window this check can catch a stale frame in).
 *
 * Deliberately returns "no verdict" (`null`) whenever `seenHashScrollY`
 * isn't a Map, `hash` is missing/not-a-string, `scrollY` isn't a finite
 * number, or the hash has never been seen before -- this is what makes it
 * safe to call unconditionally every step, including full-page
 * scroll-and-stitch capture mode, which never populates a hash at all
 * (background.js only computes one for the viewport-only path -- see that
 * function's own comment) and therefore never reaches a verdict here,
 * without a separate branch to scope it out.
 *
 * @param {Map<string, number>} seenHashScrollY
 * @param {{hash?: string|null, scrollY?: number|null}} [current]
 * @returns {{ stale: true, hash: string, firstSeenScrollY: number, currentScrollY: number, scrollDelta: number } | null}
 */
export function detectHashRecurrence(seenHashScrollY, { hash, scrollY } = {}) {
  if (!(seenHashScrollY instanceof Map)) return null;
  if (typeof hash !== "string" || hash.length === 0) return null;
  if (!isFiniteNumber(scrollY)) return null;
  if (!seenHashScrollY.has(hash)) return null; // never seen this hash before this run -- nothing to compare against

  const firstSeenScrollY = seenHashScrollY.get(hash);
  if (!isFiniteNumber(firstSeenScrollY)) return null;
  if (firstSeenScrollY === scrollY) return null; // RULING A: same hash at the SAME scroll position is the normal case

  return {
    stale: true,
    hash,
    firstSeenScrollY,
    currentScrollY: scrollY,
    scrollDelta: scrollY - firstSeenScrollY,
  };
}
