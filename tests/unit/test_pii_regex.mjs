// SIH 26171 v2 -- V1a pii-tokenizer unit tests, regex half.
// Contract: docs/v2/ARCHITECTURE.md C1. Module under test:
// extension/lib/pii-regex.js. Pure JS, no jsdom/browser dependency.
//
// Run:  node --test tests/unit/test_pii_regex.mjs
// (or, with everyone else:  node --test tests/unit/*.mjs)

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { findRegexSpans, luhnValid } from "../../extension/lib/pii-regex.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "../fixtures/v2/tokenizer");

function loadFixture(filename) {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, filename), "utf8"));
}

function assertNoOverlaps(spans) {
  const sorted = spans.slice().sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(
      sorted[i].start >= sorted[i - 1].end,
      `spans overlap: ${JSON.stringify(sorted[i - 1])} vs ${JSON.stringify(sorted[i])}`
    );
  }
}

function labelSpanValue(text, span) {
  return text.slice(span.start, span.end);
}

describe("findRegexSpans -- shape and empty inputs", () => {
  test("empty text returns []", () => {
    assert.deepEqual(findRegexSpans(""), []);
  });

  test("non-string input returns [] rather than throwing (defensive)", () => {
    assert.deepEqual(findRegexSpans(undefined), []);
    assert.deepEqual(findRegexSpans(null), []);
  });

  test("text with no PII produces zero spans", () => {
    const spans = findRegexSpans("The quick brown fox jumps over the lazy dog.");
    assert.deepEqual(spans, []);
  });

  test("every span has the C1 PiiSpan shape, source 'regex', score 1.0", () => {
    const spans = findRegexSpans("Reach me at test.user@example.com any time.");
    assert.ok(spans.length > 0);
    for (const span of spans) {
      assert.equal(typeof span.start, "number");
      assert.equal(typeof span.end, "number");
      assert.ok(span.end > span.start);
      assert.equal(typeof span.label, "string");
      assert.equal(span.score, 1.0);
      assert.equal(span.source, "regex");
    }
  });
});

describe("findRegexSpans -- overlap merge: card vs phone vs Aadhaar substrings", () => {
  const fx = loadFixture("regex_card_phone_aadhaar_overlap.json");

  test("CARD claims the whole grouped 16-digit number, suppressing the embedded Aadhaar-grouped-shaped substring", () => {
    const spans = findRegexSpans(fx.text);
    assertNoOverlaps(spans);

    const cardSpans = spans.filter((s) => s.label === "CARD");
    assert.equal(cardSpans.length, 1, "expected exactly one CARD span");
    assert.equal(labelSpanValue(fx.text, cardSpans[0]), fx.cardValue);

    const aadhaarSpans = spans.filter((s) => s.label === "AADHAAR");
    assert.equal(
      aadhaarSpans.length,
      0,
      "AADHAAR must NOT fire on the digit-grouped substring embedded inside an already-claimed CARD span"
    );
  });

  test("a separate, non-overlapping bare phone number is still detected independently", () => {
    const spans = findRegexSpans(fx.text);
    const phoneSpans = spans.filter((s) => s.label === "PHONE");
    assert.equal(phoneSpans.length, 1, "expected exactly one PHONE span");
    assert.equal(labelSpanValue(fx.text, phoneSpans[0]), fx.phoneValue);
  });

  test("exactly two spans total -- no cross-contamination between the card and the phone number", () => {
    const spans = findRegexSpans(fx.text);
    assert.equal(spans.length, 2);
  });
});

describe("findRegexSpans -- Luhn gate", () => {
  test("a Luhn-INVALID 16-digit number is not labelled CARD (nor anything else)", () => {
    const fx = loadFixture("regex_luhn_invalid_card.json");
    assert.equal(luhnValid(fx.invalidCardValue), false, "fixture setup check: this value must actually be Luhn-invalid");
    const spans = findRegexSpans(fx.text);
    assert.deepEqual(
      spans,
      [],
      "a Luhn-invalid, fully-contiguous digit run must not be claimed by CARD or by any other pattern"
    );
  });

  test("the known-valid Visa test number IS Luhn-valid (sanity check on luhnValid itself)", () => {
    assert.equal(luhnValid("4111111111111111"), true);
  });
});

describe("findRegexSpans -- AADHAAR bare-12-digit is UNCONDITIONAL (V1A/V1D parity pass, 2026-09-24)", () => {
  const fx = loadFixture("aadhaar_keyword_gating.json");

  test("a bare 12-digit number IS flagged AADHAAR when an Aadhaar keyword is present in the text", () => {
    const spans = findRegexSpans(fx.withKeyword);
    const aadhaarSpans = spans.filter((s) => s.label === "AADHAAR");
    assert.equal(aadhaarSpans.length, 1);
    assert.equal(labelSpanValue(fx.withKeyword, aadhaarSpans[0]), fx.bareTwelveDigitValue);
  });

  test("the SAME bare 12-digit number is ALSO flagged with NO Aadhaar keyword present -- the gate was removed to match server/pii_regex_v2.py's already-unconditional AADHAAR_RE (broader pattern wins in both files)", () => {
    const spans = findRegexSpans(fx.withoutKeyword);
    const aadhaarSpans = spans.filter((s) => s.label === "AADHAAR");
    assert.equal(aadhaarSpans.length, 1);
    assert.equal(labelSpanValue(fx.withoutKeyword, aadhaarSpans[0]), fx.bareTwelveDigitValue);
  });
});

describe("findRegexSpans -- newly-added patterns (UPI, IFSC, GSTIN) and GSTIN-before-PAN ordering", () => {
  const fx = loadFixture("regex_new_patterns.json");

  test("UPI VPA is detected as a single UPI span, not split into a phone digit-run plus stray text", () => {
    const spans = findRegexSpans(fx.text);
    const upiSpans = spans.filter((s) => s.label === "UPI");
    assert.equal(upiSpans.length, 1);
    assert.equal(labelSpanValue(fx.text, upiSpans[0]), fx.upiValue);

    // The numeric prefix of the UPI id must NOT also show up as a separate PHONE span.
    const phoneSpans = spans.filter((s) => s.label === "PHONE");
    assert.equal(phoneSpans.length, 0, "UPI must claim the numeric handle before PHONE can grab a substring of it");
  });

  test("IFSC is detected", () => {
    const spans = findRegexSpans(fx.text);
    const ifscSpans = spans.filter((s) => s.label === "IFSC");
    assert.equal(ifscSpans.length, 1);
    assert.equal(labelSpanValue(fx.text, ifscSpans[0]), fx.ifscValue);
  });

  test("GSTIN is detected as ONE 15-character span, not degraded into an embedded PAN span", () => {
    const spans = findRegexSpans(fx.text);
    const gstinSpans = spans.filter((s) => s.label === "GSTIN");
    assert.equal(gstinSpans.length, 1);
    assert.equal(labelSpanValue(fx.text, gstinSpans[0]), fx.gstinValue);
  });

  test("a SEPARATE, standalone PAN elsewhere in the same text is still detected on its own", () => {
    const spans = findRegexSpans(fx.text);
    const panSpans = spans.filter((s) => s.label === "PAN");
    assert.equal(panSpans.length, 1, "GSTIN-before-PAN ordering must not suppress PAN detection generally");
    assert.equal(labelSpanValue(fx.text, panSpans[0]), fx.standalonePanValue);
  });

  test("no two spans overlap across the whole mixed-pattern text", () => {
    assertNoOverlaps(findRegexSpans(fx.text));
  });

  test("PASSPORT does not spuriously fire on the IFSC's embedded 7-digit tail in this same text", () => {
    const spans = findRegexSpans(fx.text);
    assert.equal(spans.filter((s) => s.label === "PASSPORT").length, 0);
  });
});

describe("findRegexSpans -- PASSPORT (added to C1 after the initial port)", () => {
  const fx = loadFixture("regex_passport.json");

  test("a genuine passport number is detected", () => {
    const spans = findRegexSpans(fx.genuineText);
    const passportSpans = spans.filter((s) => s.label === "PASSPORT");
    assert.equal(passportSpans.length, 1);
    assert.equal(labelSpanValue(fx.genuineText, passportSpans[0]), fx.genuinePassportValue);
  });

  test("accepted false positive: an 8-character passport-shaped order ID IS tokenized (harmless -- rehydration is exact; a missed real passport is the dangerous direction, not this)", () => {
    const spans = findRegexSpans(fx.orderIdFalsePositiveText);
    const passportSpans = spans.filter((s) => s.label === "PASSPORT");
    assert.equal(passportSpans.length, 1);
    assert.equal(labelSpanValue(fx.orderIdFalsePositiveText, passportSpans[0]), fx.orderIdValue);
  });

  test("IFSC-before-PASSPORT ordering hazard: a real (all-numeric-branch-code) IFSC is claimed WHOLE by IFSC, not degraded into a PASSPORT span plus stray letters", () => {
    const spans = findRegexSpans(fx.ifscHazardText);
    const ifscSpans = spans.filter((s) => s.label === "IFSC");
    assert.equal(ifscSpans.length, 1);
    assert.equal(labelSpanValue(fx.ifscHazardText, ifscSpans[0]), fx.ifscValue);
    assert.equal(spans.filter((s) => s.label === "PASSPORT").length, 0, "PASSPORT must not claim the IFSC's embedded 7-digit tail");
    assertNoOverlaps(spans);
  });
});

describe("findRegexSpans -- PHONE country-code / trunk prefix stays INSIDE the span", () => {
  const fx = loadFixture("phone_country_prefix.json");

  test("+91, space-separated, 5-5 grouped (the exact bug repro)", () => {
    const spans = findRegexSpans(fx.plusNinetyOneText);
    const phoneSpans = spans.filter((s) => s.label === "PHONE");
    assert.equal(phoneSpans.length, 1);
    assert.equal(labelSpanValue(fx.plusNinetyOneText, phoneSpans[0]), fx.plusNinetyOneValue);
    assert.ok(!fx.plusNinetyOneText.slice(0, phoneSpans[0].start).includes("+91"), "the +91 prefix must not be left as unflagged raw text before the span");
  });

  test("0091 ISD prefix, bare 10-digit", () => {
    const spans = findRegexSpans(fx.zeroZeroNinetyOneText);
    const phoneSpans = spans.filter((s) => s.label === "PHONE");
    assert.equal(phoneSpans.length, 1);
    assert.equal(labelSpanValue(fx.zeroZeroNinetyOneText, phoneSpans[0]), fx.zeroZeroNinetyOneValue);
  });

  test("91- bare country code with hyphen, bare 10-digit", () => {
    const spans = findRegexSpans(fx.ninetyOneHyphenText);
    const phoneSpans = spans.filter((s) => s.label === "PHONE");
    assert.equal(phoneSpans.length, 1);
    assert.equal(labelSpanValue(fx.ninetyOneHyphenText, phoneSpans[0]), fx.ninetyOneHyphenValue);
  });

  test("leading 0 domestic trunk prefix, bare 10-digit, no separator", () => {
    const spans = findRegexSpans(fx.trunkZeroText);
    const phoneSpans = spans.filter((s) => s.label === "PHONE");
    assert.equal(phoneSpans.length, 1);
    assert.equal(labelSpanValue(fx.trunkZeroText, phoneSpans[0]), fx.trunkZeroValue);
  });
});
