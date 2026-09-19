// SIH 26171 -- capture staleness detection.
//
// PROBLEM THIS SOLVES (CLAUDE.md "OPEN -- capture can return a stale
// frame", observed 2026-09-17, mechanism NOT established): two consecutive
// agent-loop steps produced BYTE-IDENTICAL screenshots while the page had
// scrolled 2,613px between them (agent-1 bbox y: 1161.0 -> -1452.0). Step
// 2's redaction rectangles were computed against the SCROLLED DOM and
// drawn on the UNSCROLLED image, at negative y -- off-image, redacting
// nothing. This is an EXPOSURE, not a cosmetic bug: a stale image shows
// the OLD viewport's pixels while the rects are computed for the NEW
// scroll position, so whatever was on screen at the old position is
// transmitted unredacted. The one observed occurrence happened not to
// expose anything only because the sensitive fields were below the fold
// at the stale image's scroll position -- "that is luck, not design."
//
// THIS MODULE MAKES THE SYMPTOM DETECTABLE, IT DOES NOT "FIX" IT -- the
// mechanism never reproduced and is not established, and inventing one
// here would be exactly the kind of speculative mitigation this project's
// record warns against. What this module provides is a cheap,
// deterministic, pure way for content.js to notice "byte-identical bytes
// while the scroll position moved" and refuse to send that step's image --
// see detectStaleCapture()'s own doc comment for the precise discriminator
// (RULING A) and content.js's own "STALE-CAPTURE DETECTION" block comment
// for how the fail-closed skip is wired in (skip this step's send only,
// never abort the run -- the mechanism is unestablished, so aborting the
// whole run on it would be a NEW failure mode built on an unreproduced
// bug).
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
//
// WHO CALLS WHAT (RULING B, binding, do not re-derive this differently):
// background.js's handleCaptureAndDetect() owns the screenshot bytes
// immediately after capture and calls hashScreenshot() itself, returning
// the digest on CAPTURE_AND_DETECT_RESULT as `screenshotHash` --
// background already holds the bytes, so it is the one place that can
// compute this without a second copy of them crossing a message boundary.
// content.js never touches raw screenshot bytes for this purpose; it only
// ever sees the hash STRING, and correlates it against the scrollY it
// already reads at DOM-scan time using detectStaleCapture(), below.
// Splitting the work this way keeps hashing next to the bytes
// (background.js) and the staleness VERDICT next to the only place that
// knows both the previous step's data and the current scroll position
// (content.js) -- background.js has no notion of "the page's scroll
// position," and content.js should never need a second copy of the raw
// screenshot bytes just to compare two hashes.
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
// STALENESS DETECTION -- RULING A (binding, get this exactly right or this
// becomes a false-positive machine):
//
//   stale = consecutive captures are byte-identical AND the page's scroll
//           position changed between them.
//
// Byte-identical consecutive captures are the NORMAL, CORRECT case on a
// static page that did not scroll between steps -- that is not staleness,
// it is the screenshot doing exactly what it should, and flagging it would
// make every quiet step on every static page a false alarm. The
// discriminator that turns "identical bytes" from "expected" into "a leak
// that looks like success" is a MOVED scroll position: if the page's
// scrollY changed but the image did not, the image being sent this step is
// showing the WRONG viewport for the redaction rectangles computed against
// THIS step's (scrolled) DOM. Comparing hash alone would false-positive on
// every static page/step; comparing scrollY alone says nothing about what
// was actually transmitted. Requiring BOTH is the exact, narrow signature
// the 2026-09-17 observation exhibited (agent-1 bbox y: 1161.0 -> -1452.0,
// screenshot bytes unchanged) -- a static page produces zero false
// positives under this rule, by construction.
// ===========================================================================

/**
 * Pure, synchronous staleness check -- mirrors detectStall()'s shape
 * (stall-detector.js): takes plain data, returns a structured result or
 * `null`, and never throws on merely-insufficient data (e.g. the run's
 * first step, which has nothing to compare against yet -- that is "no
 * verdict yet," not a false stale positive, exactly like detectStall()'s
 * own posture on a short/empty history).
 *
 * Callers (content.js) are expected to keep exactly one {hash, scrollY}
 * pair per run, updated after EVERY step regardless of the verdict this
 * function returns (so the NEXT comparison is always against the most
 * recent capture, not a stale one of its own), and pass the PREVIOUS
 * step's pair in as `previousHash`/`previousScrollY` and the CURRENT
 * step's as `currentHash`/`currentScrollY`.
 *
 * Deliberately returns "no verdict" (`null`), rather than throwing or
 * guessing, whenever either hash is missing/not-a-string or either
 * scrollY is not a finite number -- this is what makes it safe to call
 * unconditionally every step, including full-page scroll-and-stitch
 * capture mode, which never populates a hash at all (that mode's single
 * post-restore scrollY reading does not mean the same thing this check
 * relies on -- see content.js's own note on why full-page mode is
 * scoped OUT of this check rather than silently misapplied to it).
 *
 * @param {{previousHash?: string|null, previousScrollY?: number|null, currentHash?: string|null, currentScrollY?: number|null}} [params]
 * @returns {{ stale: true, hash: string, previousScrollY: number, currentScrollY: number, scrollDelta: number } | null}
 */
export function detectStaleCapture({ previousHash, previousScrollY, currentHash, currentScrollY } = {}) {
  if (typeof previousHash !== "string" || previousHash.length === 0) return null;
  if (typeof currentHash !== "string" || currentHash.length === 0) return null;
  if (!isFiniteNumber(previousScrollY) || !isFiniteNumber(currentScrollY)) return null;

  if (previousHash !== currentHash) return null; // the common, expected case: the captured pixels changed

  const scrollDelta = currentScrollY - previousScrollY;
  if (scrollDelta === 0) return null; // RULING A: identical bytes + UNCHANGED scroll is the normal, correct static-page case

  return {
    stale: true,
    hash: currentHash,
    previousScrollY,
    currentScrollY,
    scrollDelta,
  };
}
