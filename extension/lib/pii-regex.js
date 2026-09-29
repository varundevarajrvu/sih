// SIH 26171 v2 -- V1a pii-tokenizer, contract C1 (regex half).
// See docs/v2/ARCHITECTURE.md "Contracts (V1+)" -- C1 (PiiSpan shape) and
// C2 ("Take from B" item 1: deterministic regex + Luhn + Aadhaar keyword
// heuristics, spans over RAW text, merged with NER afterwards).
//
// PORTED FROM (cited per this module's brief -- pattern ORDER is
// load-bearing there and preserved here):
//   Project B, extension/utils/redactor.js  (`passes` array, luhnValid(),
//     AADHAAR_KEYWORD_RE / AADHAAR_BARE_RE keyword-proximity heuristic)
//   Project B, warden/redactor.py           (`PASSES`, `regex_spans()` --
//     the SPAN-based, non-mutating form this file follows most closely;
//     `_overlaps()` is the same "an earlier/more-specific match claims its
//     span, a later overlapping match is discarded" rule this file uses)
// Both cited under this session's scratchpad checkout of
// francisreubenr-rvu/sih-2026 (see docs/v2/ARCHITECTURE.md "Why v2").
//
// findRegexSpans(text) -> PiiSpan[]
//   PiiSpan = { start, end, label, score: 1.0, source: "regex" }
// Deterministic, returned sorted by `start`, and -- the C2 requirement
// this module owns -- NO SPANS OVERLAP within this layer's own output.
// mergeSpans() (pii-tokenizer.js) still has to reconcile regex spans
// against NER spans, but it never has to reconcile a regex span against
// another regex span; that invariant is established here.
//
// PATTERN ORDER IS LOAD-BEARING. Three separate claims, not one:
//
//   1. (from the cited source, unchanged) CARD (13-19 digits, Luhn-gated)
//      must be checked before AADHAAR/PHONE, so a card number is claimed
//      whole and neither shorter pattern can later claim a digit
//      substring of it.
//
//   2. (NEW -- GSTIN/IFSC/UPI do not exist in the cited source; see the
//      NOT-PORTED / NEWLY-ADDED note below) GSTIN must be checked before
//      PAN. A GSTIN's characters 3-12 are *exactly* PAN-shaped (5 letters
//      + 4 digits + 1 letter -- GSTIN embeds a PAN by design, that's the
//      point of the format). If PAN ran first it would claim that
//      embedded 10-character span, and GSTIN's own 15-character match
//      would then be discarded as "overlaps an already-claimed span" --
//      the GSTIN would silently degrade into a bare PAN detection with
//      the surrounding state-code/entity-code/checksum characters left
//      completely unflagged. GSTIN must run first so it claims the whole
//      15 characters before PAN ever sees them.
//
//   3. (NEW) UPI must be checked before PHONE. A numeric UPI VPA
//      ("9876543210@ybl") contains a bare 10-digit phone-shaped
//      substring; if PHONE ran first it would claim just the digits and
//      leave "@ybl" as unflagged plain text -- a UPI id with its digit
//      portion torn off and separately mislabeled PHONE. EMAIL runs
//      before UPI: EMAIL's domain segment requires a literal "." that no
//      real UPI handle contains (ybl / paytm / oksbi / ibl / axl / upi /
//      okhdfcbank, ...), so in practice the two patterns don't collide,
//      but ordering EMAIL first is the safe/defensive choice regardless.
//
//   4. (NEW, found by the orchestrator's probe after PASSPORT was added
//      to C1 -- see the PASSPORT note below) IFSC must be checked before
//      PASSPORT. A real-world IFSC's 6-character branch code is
//      frequently all-numeric (e.g. "HDFC0001234"), which means the
//      IFSC's own 4th letter immediately followed by its literal "0" and
//      the 6-digit branch code forms EXACTLY a passport shape (1 letter
//      + 7 digits: "C0001234" inside "HDFC0001234"). If PASSPORT ran
//      first it would claim that embedded 8-character span, and IFSC's
//      own 11-character match would then be discarded as an overlap --
//      the IFSC would degrade into a mislabeled PASSPORT with "HDF" left
//      as stray unflagged text. IFSC must run first so it claims the
//      whole 11 characters before PASSPORT ever sees them. (No
//      equivalent hazard exists between PASSPORT and GSTIN or PAN --
//      checked directly: GSTIN's digit runs top out at 4 characters and
//      PAN's at 4 characters, neither ever reaches the 7 contiguous
//      digits PASSPORT requires, in either direction.)
//
// Full order: EMAIL, GSTIN, IFSC, PASSPORT, PAN, UPI, CARD, AADHAAR,
// PHONE (all variants). (Historical note: AADHAAR's bare-12-digit branch
// was originally gated behind an "aadhaar"/"aadhar"/"uidai" keyword
// proximity heuristic, run as a separate pass after everything else,
// mirroring the cited source. The V1A/V1D PARITY PASS below removed that
// gate -- AADHAAR is now unconditional, in ONE pattern entry at its
// normal position in this list, not a separate trailing pass.)
//
// PORTED (added by the orchestrator's C1 ruling adding PASSPORT to the
// PiiLabel enum -- previously reported as a gap and deliberately NOT
// ported, since C1 had no PASSPORT member to emit): Project B's
// "passport" pattern, `\b[A-Za-z][0-9]{7}\b`, from redactor.js/
// redactor.py, unchanged (case-insensitive by construction -- the
// character class itself allows both cases, no /i flag, matching the
// cited source exactly).
//
// ACCEPTED FALSE POSITIVE, by design, same as the cited source: this
// pattern also matches an 8-character alphanumeric order/reference ID
// shaped like a passport (e.g. "A1234567") -- there is no way to
// distinguish the two from text shape alone. Kept anyway: the span still
// gets tokenized and rehydrated back to the exact original string
// (pii-tokenizer.js), so a false-positive match is harmless (the value
// round-trips unchanged); a missed real passport number is not
// harmless -- it is exactly the PII this layer exists to catch. See
// tests/fixtures/v2/tokenizer/regex_passport.json for the fixture
// demonstrating this is accepted, not an oversight.
//
// NEWLY ADDED (not in the cited source, authored fresh to satisfy C1's
// label set, which explicitly lists UPI/IFSC/GSTIN): patterns follow the
// **published institutional formats**, not a fixture:
//   UPI VPA   -- NPCI: <handle>@<psp-handle>, e.g. "name@paytm", "9876543210@ybl".
//   IFSC      -- RBI: 4 letters (bank code) + literal "0" (reserved) + 6
//                alphanumeric (branch code) = 11 characters, e.g. "HDFC0001234".
//   GSTIN     -- CBIC: 2 digits (state code) + 10-character PAN + 1 digit
//                (entity code) + literal "Z" + 1 alphanumeric checksum =
//                15 characters, e.g. "29ABCDE1234F1Z5".
// All three stay case-sensitive / uppercase-only (real govt-issued IDs
// are canonically uppercase, and no JS/Python drift was ever found on
// this point for these three -- see the parity pass note below for the
// one label where a real case-sensitivity drift WAS found and fixed:
// PAN, which now follows dom-scanner.js's case-insensitive PAN_RE
// instead of redactor.js's case-sensitive one).
//
// This module is a PURE FUNCTION: no `document`/`window`, no imports
// beyond nothing at all. Runs unmodified in the offscreen doc, a content
// script, a background service worker, or plain Node under `node --test`.
//
// ===========================================================================
// V1A/V1D PARITY PASS (orchestrator, 2026-09-24) -- this file and
// server/pii_regex_v2.py are now provably aligned. See
// tests/fixtures/v2/pii_parity.json / tests/unit/test_pii_parity.mjs /
// tests/unit/test_pii_parity.py. Ruling: "where the two disagree, the
// BROADER pattern wins in both files -- a false negative on PII is worse
// than a false positive." Six changes landed here (mirror image of the
// six in pii_regex_v2.py's own docstring):
//
//   1. EMAIL merged to the UNION of this file's simpler redactor.js-
//      derived shape and pii_regex_v2.py's stricter dom-scanner.js-
//      derived shape: broader local-part character class (the RFC
//      specials !#$%&'*/=?^_`{|}~, which only ever ADD matches) with THIS
//      file's simpler, less domain-label-strict shape (pii_regex_v2.py's
//      per-label 63-char/no-leading-hyphen rules only ever REJECT
//      otherwise-email-shaped text, so they were the narrower side).
//   2. PAN made case-insensitive. It was case-sensitive here (following
//      redactor.js); pii_regex_v2.py's PAN (following dom-scanner.js) was
//      already case-insensitive -- broader, so this side changes.
//   3. AADHAAR: the keyword-gated bare-12-digit heuristic below is
//      REMOVED. pii_regex_v2.py's AADHAAR (ported from dom-scanner.js)
//      was already unconditional -- ANY bare 12-digit number flags, no
//      keyword needed -- which is strictly broader than "only with a
//      nearby aadhaar/aadhar/uidai keyword". This file now uses the
//      SAME single, unconditional, two-branch pattern (grouped OR bare),
//      byte-for-byte identical source to pii_regex_v2.py's AADHAAR_RE.
//   4. GSTIN's entity-type-suffix position widened from a literal
//      uppercase letter set already at `[A-Z]` here -- UNCHANGED on this
//      side; pii_regex_v2.py had a literal "Z" there and was widened to
//      match THIS file instead (this file was already the broader one).
//   5. UPI stays the generic `<id>@<2-64 letters>` form (unchanged on
//      this side) -- pii_regex_v2.py's known-handle ALLOWLIST is REMOVED
//      to match this file (no concrete email collision justified it; see
//      that file's docstring point 1 for the full reasoning).
//   6. PHONE prefix fix (already landed, see the FIXED note below) is
//      mirrored byte-for-byte into pii_regex_v2.py's three India-tuned
//      PHONE_PATTERNS.
//
// PASSES/ORDERED_PATTERNS ordering is now byte-for-byte the same LABEL
// SEQUENCE in both languages (EMAIL, GSTIN, IFSC, PASSPORT, PAN, UPI,
// CARD, AADHAAR, PHONE) -- pii_regex_v2.py's PASSES previously ran
// PASSPORT before IFSC, missing the IFSC-before-PASSPORT hazard this
// file already documents (claim #4 above); reordered there to match.
//
// FOLLOW-UP (orchestrator's cross-check, same day): both languages
// shared ANOTHER false negative -- Indian LANDLINE numbers
// ("080-2345-6789", "(080) 2345 6789", "022 2345 6789",
// "+91 80 2345 6789", "0484-2345678") matched nothing in either file.
// Fixed identically: two new PHONE entries below (see their own
// comments, right after the mobile-prefix-fix entries, for the ordering
// reasoning -- must run after mobile/CARD/AADHAAR so it cannot split
// one of those).
// ===========================================================================

// ---------------------------------------------------------------------------
// Luhn checksum -- ported verbatim (structure and comment) from
// redactor.js's luhnValid() / redactor.py's luhn_valid(). Card numbers are
// masked ONLY when they pass Luhn: digit-count alone would otherwise
// destroy arbitrary 13-19 digit strings (order IDs, barcodes, account
// numbers, timestamps) that are not actually card numbers.
// ---------------------------------------------------------------------------
function luhnValid(digits) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function cardValidate(match) {
  const digits = match.replace(/[ -]/g, "");
  return digits.length >= 13 && digits.length <= 19 && luhnValid(digits);
}

function intlGroupedValidate(match) {
  return match.replace(/[ -]/g, "").length >= 7;
}

// Indian landline (orchestrator's cross-check, 2026-09-24 follow-up): STD
// code (2-4 digits) + subscriber number (6-8 digits) always sums to
// EXACTLY 10 significant digits -- that is the real constraint (an
// Indian-numbering-plan fact, not a formatting convention); the STD/
// subscriber split itself is just how it's grouped when WRITTEN, and a
// regex has no way to require "subscriber length = 10 minus however many
// digits the greedy STD group actually consumed" without a validate()
// step, exactly like CARD's length+Luhn split above. Used only by the
// parenthesized-STD landline pattern below, where the STD digit count is
// genuinely variable *inside* the match; the bare/international-marker
// pattern avoids needing this by fixing the total at exactly 10 digits
// via a plain quantifier (see its own comment).
function landlineParenValidate(match) {
  const digits = match.replace(/[^\d]/g, "");
  return digits.length === 11 && digits[0] === "0";
}

// ---------------------------------------------------------------------------
// Pattern set -- single source of truth, in the load-bearing order
// documented above. Every regex is compiled WITHOUT the "g" flag here;
// collectSpans() below adds "g" itself when scanning, so this array can
// also be inspected/reused (e.g. by tests) without worrying about shared
// `lastIndex` state on a global regex.
// ---------------------------------------------------------------------------
const ORDERED_PATTERNS = Object.freeze([
  // MERGED per the parity pass (see header note) -- byte-for-byte the same
  // pattern source as server/pii_regex_v2.py's EMAIL_RE.
  { label: "EMAIL", re: /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },

  // NEWLY ADDED -- see header note. Must precede PAN (embeds a PAN shape).
  { label: "GSTIN", re: /\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z][A-Z\d]\b/ },
  // NEWLY ADDED -- see header note.
  { label: "IFSC", re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/ },

  // PORTED -- see header note. Must come AFTER IFSC (load-bearing claim
  // #4 above: a numeric IFSC branch code embeds a passport shape).
  { label: "PASSPORT", re: /\b[A-Za-z][0-9]{7}\b/ },

  // Case-insensitive per the parity pass (see header note) -- byte-for-byte
  // the same pattern source as server/pii_regex_v2.py's PAN_RE.
  { label: "PAN", re: /\b[a-z]{5}[0-9]{4}[a-z]\b/i },

  // NEWLY ADDED -- see header note. Must precede PHONE (numeric VPAs).
  {
    label: "UPI",
    re: /\b[A-Za-z0-9][A-Za-z0-9.\-_]{1,255}@[A-Za-z][A-Za-z]{1,63}\b(?!\.[A-Za-z])/,
  },

  // Ported verbatim from redactor.js/redactor.py.
  {
    label: "CARD",
    re: /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/,
    validate: cardValidate,
  },
  // UNCONDITIONAL per the parity pass (see header note, point 3) -- no
  // keyword gate. Byte-for-byte the same pattern source as
  // server/pii_regex_v2.py's AADHAAR_RE (itself ported from
  // dom-scanner.js). Grouped (4-4-4, any whitespace or hyphen separator)
  // OR bare 12 digits, either way bounded by \b so this cannot claim a
  // substring of a longer digit run (a longer run has no \w/\W boundary
  // in its interior -- digits and letters are both \w).
  { label: "AADHAAR", re: /\b\d{4}[\s-]\d{4}[\s-]\d{4}\b|\b\d{12}\b/ },

  // FIXED (orchestrator's probe, follow-up to the initial port): the
  // cited source's India-tuned variants only attached a country-code
  // prefix to ONE grouping (the fully-contiguous bare-10-digit case,
  // "+91[ -]?[6-9]\d{9}") -- the 3-3-4 and 5-5 grouped variants below had
  // NO prefix support at all. "call +91 98450 12345" (a 5-5 grouped
  // number) matched only "98450 12345" via the bare 5-5 pattern, leaving
  // "+91 " as unflagged raw text BEFORE the span -- rehydrate() would
  // then type only "98450 12345" into a phone field, silently dropping
  // the country code. Every India-tuned grouping below now shares the
  // SAME optional, non-capturing prefix so no grouping is left with only
  // partial prefix coverage. Forms accepted (whichever the orchestrator's
  // probe named): "+91" (international), "0091" (ISD dial-out form),
  // "91-"/"91 " (bare country code, hyphen or space), and a bare leading
  // "0" (domestic STD/trunk prefix, e.g. "09845012345") -- the trunk form
  // takes NO separator, since it is conventionally written attached
  // directly to the 10-digit number. The lookbehind `(?<!\d)` applies
  // BEFORE this whole optional prefix group, so the "not preceded by a
  // digit" guard still covers the true start of the match, prefix
  // included. When no prefix is present the group matches zero
  // characters and every pre-existing (unprefixed) fixture is unaffected.
  { label: "PHONE", re: /(?<!\d)(?:\+91[ -]?|0091[ -]?|91[ -]|0)?[6-9]\d{2}[ -]\d{3}[ -]\d{4}(?!\d)/ },
  { label: "PHONE", re: /(?<!\d)(?:\+91[ -]?|0091[ -]?|91[ -]|0)?[6-9]\d{4}[ -]\d{5}(?!\d)/ },
  { label: "PHONE", re: /(?<!\d)(?:\+91[ -]?|0091[ -]?|91[ -]|0)?[6-9]\d{9}(?!\d)/ },

  // LANDLINE (orchestrator's cross-check, 2026-09-24 follow-up): Indian
  // landlines -- "080-2345-6789", "(080) 2345 6789", "022 2345 6789",
  // "+91 80 2345 6789", "0484-2345678" -- were a shared JS/Python false
  // negative in the parity fixture's cross-check. STD code (2-4 digits)
  // has NO leading-digit restriction (unlike mobile's 6-9), so this MUST
  // run AFTER the three mobile patterns above: a "0"+10-digit run that IS
  // mobile-shaped (leading digit 6-9, matching one of mobile's fixed
  // group-size shapes) is claimed by mobile FIRST, and this pattern only
  // ever sees what mobile did not want -- that is what keeps it from
  // ever splitting a mobile number. It must also run AFTER CARD/AADHAAR
  // (already true -- both precede the whole PHONE block) for the exact
  // same reason: a marker character ("0") can appear mid-run right after
  // a space/hyphen separator inside an unrelated CARD/AADHAAR match (e.g.
  // "4111 0234 5678 9012"), so those patterns must claim their full span
  // FIRST or this one could start matching inside it.
  //
  // Two entries, because a parenthesized STD code ("(080)") structurally
  // cannot share one regex with the bare/marker forms -- the closing
  // paren sits INSIDE the STD/subscriber boundary, not before all 10
  // digits like every other marker does.
  //
  // Entry 1 (bare "0" trunk / intl markers): reuses the EXACT SAME
  // 4-way marker alternation as the mobile prefix fix above, then
  // requires EXACTLY 10 more digits (`\d(?:[ -]?\d){9}`) with 0-or-1
  // single-char separator between any two adjacent digits -- this is
  // precise by construction (no validate() needed) and, because
  // separator POSITION is unconstrained, transparently covers every
  // grouping convention in the four cited bare/marker examples (4-4,
  // 3+ungrouped-7, with or without the trunk 0) without needing to know
  // where the STD code actually ends.
  { label: "PHONE", re: /(?<!\d)(?:\+91[ -]?|0091[ -]?|91[ -]|0)\d(?:[ -]?\d){9}(?!\d)/ },
  // Entry 2 (parenthesized STD, e.g. "(080) 2345 6789"): the STD-digit
  // count genuinely varies WITHIN the match here (2-4 digits before the
  // literal ")"), so the regex is intentionally loose (STD 2-4, then a
  // generously-bounded subscriber run) and landlineParenValidate() above
  // does the real check: strip every non-digit character (parens,
  // spaces, hyphens) and confirm exactly 11 digits total, leading "0" --
  // the same "total significant digits" invariant as entry 1, just
  // enforced after the fact because the regex alone can't express it
  // when a variable-length group sits in the middle of the match.
  {
    label: "PHONE",
    re: /(?<!\d)\(0\d{2,4}\)[ -]?\d(?:[ -]?\d){3,7}(?!\d)/,
    validate: landlineParenValidate,
  },

  { label: "PHONE", re: /(?<!\d)\+[1-9]\d{1,3}[ -]?\d{6,14}(?!\d)/ },
  {
    label: "PHONE",
    re: /(?<!\d)\+[1-9]\d{1,3}(?:[ -]\d{2,4}){2,5}(?!\d)/,
    validate: intlGroupedValidate,
  },
]);

// ---------------------------------------------------------------------------
// Span collection
// ---------------------------------------------------------------------------

function asGlobal(re) {
  return re.flags.includes("g") ? re : new RegExp(re.source, re.flags + "g");
}

/**
 * @param {string} text
 * @returns {Array<{start:number,end:number,label:string,score:number,source:"regex"}>}
 */
export function findRegexSpans(text) {
  if (typeof text !== "string" || text.length === 0) return [];

  const spans = [];
  const overlapsClaimed = (start, end) =>
    spans.some((s) => start < s.end && s.start < end);

  for (const { label, re, validate } of ORDERED_PATTERNS) {
    const global = asGlobal(re);
    let match;
    while ((match = global.exec(text)) !== null) {
      const value = match[0];
      const start = match.index;
      const end = start + value.length;
      // Defensive: none of the patterns above can match a zero-length
      // string, but guard against an infinite loop if that ever changes.
      if (value.length === 0) {
        global.lastIndex += 1;
        continue;
      }
      if (validate && !validate(value)) continue; // veto (e.g. Luhn failure): leave unclaimed
      if (overlapsClaimed(start, end)) continue; // a more-specific pass already claimed this span
      spans.push({ start, end, label, score: 1.0, source: "regex" });
    }
  }

  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  return spans;
}

// Exported for tests / for callers that want to validate a card-shaped
// string independently of a full scan (e.g. constructing the
// "Luhn-invalid 16-digit number is not labelled CARD" fixture).
export { luhnValid };
