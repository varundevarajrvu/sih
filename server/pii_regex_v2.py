r"""
v2 regex-PII detection primitives, shared by schemas_v2.py's leak re-check
and the /v2/analyze server-computed verdict (ARCHITECTURE.md contract C5).

SOURCE OF PATTERNS (per the V1d brief: "reuse/extend v1's patterns rather
than inventing new ones; the client-side JS port is being written
concurrently from the same sources"):

  - EMAIL_RE, AADHAAR_RE, PAN_RE, PHONE_PATTERNS are ported VERBATIM (semantics
    preserved, syntax translated JS->Python) from THIS repo's own
    extension/lib/dom-scanner.js — the most directly authoritative "v1
    pattern" available, since it is the actual shipped v1 detector, not a
    second-hand source. In particular AADHAAR_RE keeps dom-scanner.js's
    unconditional stance (ANY bare 12-digit number flags, no keyword gate) —
    "Aadhaar detection flags ANY bare 12-digit number ... intentional
    over-flag" per CLAUDE.md's Phase 2a ruling. False negatives on PII are
    the dangerous direction throughout this project; this module inherits
    that bias deliberately.
  - CARD_RE + luhn_valid are ported from the concurrently-cited source
    (scratchpad/sih-2026/warden/redactor.py), since dom-scanner.js has no
    card pattern at all and the brief explicitly requires "card with Luhn".

C1 UPDATE (orchestrator, 2026-09-24): PiiLabel now includes PASSPORT
(Indian passport: one letter + 7 digits). PASSPORT_RE below is ported
verbatim from warden/redactor.py's "passport" pass
(`\b[A-Za-z][0-9]{7}\b`) -- that source already had this one; it just
wasn't in the original set this module was written against.

TOKEN + COUNTRY-CODE-PREFIX INTERACTION (orchestrator, 2026-09-24): the
client puts the phone value INSIDE the token and leaves any country-code
prefix OUTSIDE it -- e.g. "+91 PHONE#1", not "PHONE#1" alone. Masking
only replaces the token span itself (_mask_tokens leaves "+91 " and
similar prefixes untouched), so "+91 TOKEN" must not itself look like a
raw phone number to PHONE, while a genuinely raw "+91 98450 12345"
still must. Verified by test_phone_token_with_country_code_prefix_is_clean
/ test_raw_phone_with_country_code_prefix_still_leaks in
tests/unit/test_v2_schemas.py -- see those for the exact fixtures.
> SUPERSEDED IN PART by the V1a PARITY PASS below: after that pass the
> WELL-FORMED client now puts the prefix INSIDE the token too (a span that
> includes "+91" gets replaced by ONE token, so a correct client emits
> "PHONE#1" alone, not "+91 PHONE#1"). The paragraph above describes the
> pre-parity-pass client and is kept because it is still an accurate
> description of what `_mask_tokens` does to "+91 PHONE#1" specifically
> (masks the token, leaves "+91 " as inert un-matchable text) and the two
> cited tests still pass unmodified -- neither asserts what a
> "well-formed" client emits, only that these two literal strings are
> handled correctly.

===============================================================================
V1A PARITY PASS (orchestrator, 2026-09-24) -- this module and
extension/lib/pii-regex.js are now provably aligned. See
tests/fixtures/v2/pii_parity.json / tests/unit/test_pii_parity.mjs /
tests/unit/test_pii_parity.py. What changed here, and why (ruling: "where
the two disagree, the BROADER pattern wins in both files -- a false
negative on PII is worse than a false positive"):

  1. UPI_RE: the known-PSP-handle ALLOWLIST is REMOVED. It was narrower
     than the client's generic "<id>@<2-64 letters>" pattern, and no
     concrete email collision justified keeping it (EMAIL_RE's domain
     always requires a literal "." that no real UPI handle contains, and
     UPI_RE's own trailing `(?!\.[A-Za-z])` is a second, independent
     guard against grabbing a truncated email domain -- see the ordering
     note below). Per the ruling: narrowing-by-allowlist goes; if a real
     collision is ever found, fix it by PASSES ordering, not by
     re-narrowing the handle.
  2. GSTIN_RE: the entity-code-suffix position required a literal "Z".
     The client's version allows any letter there (`[A-Z]`) -- broader,
     kept, ported here. (Real GSTINs always carry "Z" there per the CBIC
     spec; this pattern's job is recall-biased PII *detection*, not
     format validation, so accepting the broader match is correct.)
  3. PAN_RE: was case-sensitive (uppercase only) here; the client's port
     of dom-scanner.js's PAN_RE is case-insensitive. Case-insensitive
     wins (broader) -- this module already imported dom-scanner.js's
     PAN_RE, which WAS case-insensitive; the case-sensitivity gap was
     actually on the *client* side originally (it had ported the
     case-sensitive redactor.js PAN instead) and has been fixed there.
     Restated so it's unambiguous which direction each fix ran.
  4. AADHAAR: unchanged here (already unconditional, no keyword gate --
     this was always the BROADER of the two implementations). The
     client's separate keyword-gated bare-12-digit heuristic is REMOVED
     on the client side to match this module's unconditional stance.
  5. EMAIL_RE: merged to the UNION of this module's stricter
     dom-scanner.js-derived local-part/domain rules and the client's
     simpler redactor.js-derived rules -- broader local-part character
     class (this module's RFC-flavoured specials: !#$%&'*/=?^_`{|}~) with
     the client's simpler, less domain-label-strict shape (no 63-char/
     no-leading-hyphen-per-label enforcement, which only ever REJECTS
     otherwise-email-shaped text and is therefore the narrower choice).
  6. PHONE: this module's India-tuned 3-3-4 / 5-5 / bare-10 patterns
     never carried a country-code/trunk prefix except on ONE grouping
     (the client had the identical gap, found by the orchestrator's
     probe: "+91 98450 12345" only matched "98450 12345", losing the
     prefix). Fixed identically in both languages: all three India-tuned
     groupings now share one optional prefix
     `(?:\+91[ -]?|0091[ -]?|91[ -]|0)?` (international, ISD dial-out,
     bare country code, domestic trunk).
  7. PASSES ordering realigned to the client's ORDERED_PATTERNS sequence
     byte-for-byte: EMAIL, GSTIN, IFSC, PASSPORT, PAN, UPI, CARD,
     AADHAAR, PHONE. This module's PASSES previously ran PASSPORT BEFORE
     IFSC -- a genuine overlap hazard the client's ordering rules already
     document: a real IFSC with an all-numeric branch code (the common
     case, e.g. "HDFC0001234") embeds a passport-shaped substring
     ("C0001234") in its own tail. With PASSPORT running first that
     substring would be claimed before IFSC's own 11-character match had
     a chance, degrading the IFSC into a mislabeled PASSPORT plus stray
     unflagged letters. Not previously exercised because
     `contains_unmasked_pii` is a pure boolean OR and never cared about
     ordering -- the hazard only becomes observable once a SPAN-returning
     function exists (`find_regex_spans`, added by this same pass, for
     the parity tests -- see its own docstring). `contains_unmasked_pii`
     itself is functionally unaffected by the reorder.

FOLLOW-UP (orchestrator's cross-check, same day): both languages shared
ANOTHER false negative -- Indian LANDLINE numbers ("080-2345-6789",
"(080) 2345 6789", "022 2345 6789", "+91 80 2345 6789", "0484-2345678")
matched nothing in either file. Fixed identically: two new PHONE pass
entries (`LANDLINE_MARKER_RE`, `LANDLINE_PAREN_RE`), placed in PASSES
AFTER the three mobile PHONE_PATTERNS and BEFORE the generic
international patterns -- see their own comments, just above PASSES,
for the ordering reasoning (must not split a card/Aadhaar/mobile match).
===============================================================================
"""

from __future__ import annotations

import re

# ---------------------------------------------------------------------------
# Token grammar (C2): a regex-PII match fully inside a token like "EMAIL#1"
# must not count as a leak. Masking tokens out before scanning is simpler
# and safer than trying to make every PII pattern token-aware individually.
# ---------------------------------------------------------------------------
TOKEN_RE = re.compile(r"[A-Z][A-Z0-9]*#[0-9]+")


def _mask_tokens(text: str) -> str:
    """Replace every token-shaped substring with a fixed non-PII placeholder
    of the same rough shape, so downstream regexes can't accidentally
    re-match token remnants (e.g. a run of digits inside "ACCOUNTNUMBER#12")
    while any *raw* value elsewhere in the string is still fully exposed to
    the scan."""
    return TOKEN_RE.sub("TOKEN", text)


# ---------------------------------------------------------------------------
# Luhn checksum (ported from warden/redactor.py's luhn_valid/_card_validate)
# ---------------------------------------------------------------------------
def luhn_valid(digits: str) -> bool:
    total = 0
    double = False
    for ch in reversed(digits):
        d = ord(ch) - 48
        if double:
            d *= 2
            if d > 9:
                d -= 9
        total += d
        double = not double
    return total % 10 == 0


def _card_validate(match: str) -> bool:
    digits = re.sub(r"[ -]", "", match)
    return 13 <= len(digits) <= 19 and luhn_valid(digits)


# ---------------------------------------------------------------------------
# EMAIL -- merged per the V1A PARITY PASS (point 5 above): local part is the
# UNION of dom-scanner.js's RFC-flavoured specials and redactor.js's simpler
# set; domain is redactor.js's simpler (broader -- no per-label RFC
# enforcement) shape. Pattern STRING is now byte-for-byte identical to
# extension/lib/pii-regex.js's EMAIL pattern (only the language's regex
# literal/raw-string syntax differs) -- keep it that way; a future edit to
# one side without the other reintroduces exactly the drift this pass fixed.
# ---------------------------------------------------------------------------
EMAIL_RE = re.compile(
    r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"
)

# AADHAAR -- unconditional (no keyword gate), ported verbatim from
# dom-scanner.js. UNCHANGED by the parity pass: this was already the
# BROADER of the two implementations (see point 4 above); the client's
# keyword-gated heuristic was removed to match THIS pattern instead.
AADHAAR_RE = re.compile(r"\b\d{4}[\s-]\d{4}[\s-]\d{4}\b|\b\d{12}\b")

# PAN -- case-insensitive, ported verbatim from dom-scanner.js. UNCHANGED by
# the parity pass (this was already the broader side -- see point 3 above).
PAN_RE = re.compile(r"\b[a-z]{5}[0-9]{4}[a-z]\b", re.IGNORECASE)

# PHONE -- India-tuned groupings now carry the SAME optional country-code /
# trunk prefix as extension/lib/pii-regex.js (V1A PARITY PASS point 6 /
# CLAUDE.md's PHONE prefix fix): "+91"/"0091 "/"91-"/"91 " (international,
# ISD dial-out, bare country code with separator) or a bare leading "0"
# (domestic trunk, no separator -- conventionally written attached). Pattern
# STRINGS are byte-for-byte identical to the client's three India-tuned
# PHONE entries; keep them that way.
PHONE_PATTERNS: list[tuple["re.Pattern[str]", "callable | None"]] = [
    (re.compile(r"(?<!\d)(?:\+91[ -]?|0091[ -]?|91[ -]|0)?[6-9]\d{2}[ -]\d{3}[ -]\d{4}(?!\d)"), None),
    (re.compile(r"(?<!\d)(?:\+91[ -]?|0091[ -]?|91[ -]|0)?[6-9]\d{4}[ -]\d{5}(?!\d)"), None),
    (re.compile(r"(?<!\d)(?:\+91[ -]?|0091[ -]?|91[ -]|0)?[6-9]\d{9}(?!\d)"), None),
]


def _intl_grouped_validate(match: str) -> bool:
    return len(re.sub(r"[ -]", "", match)) >= 7


PHONE_INTL_GROUPED_RE = re.compile(r"(?<!\d)\+[1-9]\d{1,3}(?:[ -]\d{2,4}){2,5}(?!\d)")

PHONE_INTL_RE = re.compile(r"(?<!\d)\+[1-9]\d{1,3}[ -]?\d{6,14}(?!\d)")

# LANDLINE (orchestrator's cross-check, 2026-09-24 follow-up): Indian
# landlines -- "080-2345-6789", "(080) 2345 6789", "022 2345 6789",
# "+91 80 2345 6789", "0484-2345678" -- were a shared JS/Python false
# negative in the parity fixture's cross-check. STD code (2-4 digits) has
# NO leading-digit restriction (unlike mobile's 6-9), so these MUST run
# AFTER the three mobile PHONE_PATTERNS above in PASSES: a "0"+10-digit
# run that IS mobile-shaped (leading digit 6-9, matching one of mobile's
# fixed group-size shapes) is claimed by mobile FIRST, and landline only
# ever sees what mobile did not want -- that is what keeps it from ever
# splitting a mobile number. It must also run AFTER CARD/AADHAAR (already
# true in PASSES) for the exact same reason: a marker character ("0") can
# appear mid-run right after a space/hyphen separator inside an unrelated
# CARD/AADHAAR match (e.g. "4111 0234 5678 9012"), so those patterns must
# claim their full span FIRST or landline could start matching inside it.
#
# Two entries, because a parenthesized STD code ("(080)") structurally
# cannot share one regex with the bare/marker forms -- the closing paren
# sits INSIDE the STD/subscriber boundary, not before all 10 digits like
# every other marker does. Pattern STRINGS are byte-for-byte identical to
# extension/lib/pii-regex.js's two landline entries; keep them that way.

# Entry 1 (bare "0" trunk / intl markers): reuses the EXACT SAME 4-way
# marker alternation as the mobile prefix fix above, then requires
# EXACTLY 10 more digits (`\d(?:[ -]?\d){9}`) with 0-or-1 single-char
# separator between any two adjacent digits -- precise by construction
# (no validate() needed), and because separator POSITION is
# unconstrained, transparently covers every grouping convention in the
# four cited bare/marker examples without needing to know where the STD
# code actually ends.
LANDLINE_MARKER_RE = re.compile(r"(?<!\d)(?:\+91[ -]?|0091[ -]?|91[ -]|0)\d(?:[ -]?\d){9}(?!\d)")


# Entry 2 (parenthesized STD, e.g. "(080) 2345 6789"): STD-digit count
# genuinely varies WITHIN the match here (2-4 digits before the literal
# ")"), so the regex is intentionally loose (STD 2-4, then a
# generously-bounded subscriber run) and this validate() does the real
# check: strip every non-digit character (parens, spaces, hyphens) and
# confirm exactly 11 digits total, leading "0" -- the same "total
# significant digits" invariant as entry 1, just enforced after the fact
# because the regex alone can't express it when a variable-length group
# sits in the middle of the match.
def _landline_paren_validate(match: str) -> bool:
    digits = re.sub(r"[^\d]", "", match)
    return len(digits) == 11 and digits[0] == "0"


LANDLINE_PAREN_RE = re.compile(r"(?<!\d)\(0\d{2,4}\)[ -]?\d(?:[ -]?\d){3,7}(?!\d)")

# Ported from warden/redactor.py's "card" pass (dom-scanner.js has no
# equivalent at all): (?<!\d)\d(?:[ -]?\d){12,18}(?!\d), Luhn-validated.
CARD_RE = re.compile(r"(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)")

# Ported verbatim from warden/redactor.py's "passport" pass (C1 update,
# 2026-09-24 -- PiiLabel now includes PASSPORT). One letter + 7 digits.
PASSPORT_RE = re.compile(r"\b[A-Za-z][0-9]{7}\b")

# ---------------------------------------------------------------------------
# NEW -- not ported from either cited source. See module docstring.
# ---------------------------------------------------------------------------

# UPI ID: "<identifier>@<psp-handle>". V1A PARITY PASS point 1: the
# known-handle ALLOWLIST that used to live here is REMOVED -- it was
# narrower than the client's generic form and no concrete collision
# justified it. Pattern STRING is now byte-for-byte identical to
# extension/lib/pii-regex.js's UPI pattern.
UPI_RE = re.compile(r"\b[A-Za-z0-9][A-Za-z0-9.\-_]{1,255}@[A-Za-z][A-Za-z]{1,63}\b(?!\.[A-Za-z])")

# IFSC: 4 letters (bank) + literal '0' + 6 alphanumeric (branch). Standard
# published format, no ambiguity to resolve. UNCHANGED by the parity pass
# (already identical to the client's pattern).
IFSC_RE = re.compile(r"\b[A-Z]{4}0[A-Z0-9]{6}\b")

# GSTIN: 2-digit state code + 10-char PAN + 1-digit entity code + entity-type
# letter + 1 alphanumeric checksum. V1A PARITY PASS point 2: the entity-type
# position was a literal "Z" here; broadened to `[A-Z]` to match the
# client's (broader) pattern. Real GSTINs always carry "Z" there -- this
# module does PII *detection*, not format validation, so the broader match
# is the correct recall-biased choice.
GSTIN_RE = re.compile(r"\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z][A-Z\d]\b")


# ---------------------------------------------------------------------------
# Combined pass list + detectors
# ---------------------------------------------------------------------------
# (name, compiled pattern, validate-or-None). V1A PARITY PASS point 7:
# reordered to match extension/lib/pii-regex.js's ORDERED_PATTERNS
# sequence byte-for-byte -- EMAIL, GSTIN, IFSC, PASSPORT, PAN, UPI, CARD,
# AADHAAR, PHONE. This is now load-bearing for find_regex_spans() below
# (its overlap-claim algorithm is order-sensitive, exactly like the
# client's); it was previously cosmetic-only because contains_unmasked_pii
# is a pure boolean OR. See the module docstring for the concrete ordering
# hazard (IFSC-before-PASSPORT) this reorder fixes.
PASSES: list[tuple[str, "re.Pattern[str]", "callable | None"]] = [
    ("email", EMAIL_RE, None),
    ("gstin", GSTIN_RE, None),
    ("ifsc", IFSC_RE, None),
    ("passport", PASSPORT_RE, None),
    ("pan", PAN_RE, None),
    ("upi", UPI_RE, None),
    ("card", CARD_RE, _card_validate),
    ("aadhaar", AADHAAR_RE, None),
    *[("phone", pattern, validate) for pattern, validate in PHONE_PATTERNS],
    ("phone", LANDLINE_MARKER_RE, None),
    ("phone", LANDLINE_PAREN_RE, _landline_paren_validate),
    ("phone", PHONE_INTL_RE, None),
    ("phone", PHONE_INTL_GROUPED_RE, _intl_grouped_validate),
]


def contains_unmasked_pii(text: str | None) -> bool:
    """True iff `text` contains a regex-PII match that is NOT fully inside
    a token matching TOKEN_RE (C2's `[A-Z][A-Z0-9]*#[0-9]+` grammar).

    Used both directions per C5: server-side re-check of inbound request
    string fields (taskGoal, elements[].label, history[].action.value), and
    the deterministic serverVerdict check of the model's own outbound
    `value`. Never returns which pattern matched or the matched text --
    callers must only ever report location (field name / agentId / index),
    never the value itself (Section 5 / "an error path is a data egress
    path").
    """
    if not text:
        return False
    masked = _mask_tokens(text)
    for _name, pattern, validate in PASSES:
        for m in pattern.finditer(masked):
            if validate is None or validate(m.group(0)):
                return True
    return False


def find_regex_spans(text: str | None) -> list[dict]:
    """Span-returning sibling of contains_unmasked_pii(), added by the V1A
    PARITY PASS specifically so tests/unit/test_pii_parity.py can compare
    this module's actual detections against extension/lib/pii-regex.js's
    findRegexSpans() -- a pure boolean has no way to express "which label,
    which substring", which is exactly what a parity check needs.

    NOT used by any production code path (contains_unmasked_pii remains the
    one production entry point -- it is simpler and a boolean is all C5's
    leak re-check needs). Test-support only.

    Mirrors findRegexSpans()'s algorithm exactly: walk PASSES IN ORDER,
    each match that survives its `validate` predicate is claimed UNLESS it
    overlaps a span an earlier (more specific) pattern already claimed --
    see the module docstring, point 7, for why PASSES' order is now
    load-bearing here.

    Masks tokens first, same as contains_unmasked_pii -- this function
    exists to test the REAL production masking behaviour, which is a
    server-side concern the client-side findRegexSpans() does not share
    (the client only ever calls its version on raw, pre-tokenization text,
    so it has nothing to mask). This asymmetry is intentional, not drift;
    see the parity fixture's own notes on token-wrapped strings.

    Returns a list of {"start": int, "end": int, "label": str} sorted by
    start (label is the PASSES name, upper-cased to match C1's PiiLabel
    casing exactly, e.g. "email" -> "EMAIL").
    """
    if not text:
        return []
    masked = _mask_tokens(text)
    spans: list[dict] = []

    def overlaps(start: int, end: int) -> bool:
        return any(start < s["end"] and s["start"] < end for s in spans)

    for name, pattern, validate in PASSES:
        for m in pattern.finditer(masked):
            value = m.group(0)
            if validate is not None and not validate(value):
                continue
            if overlaps(m.start(), m.end()):
                continue
            spans.append({"start": m.start(), "end": m.end(), "label": name.upper()})

    spans.sort(key=lambda s: (s["start"], s["end"]))
    return spans
