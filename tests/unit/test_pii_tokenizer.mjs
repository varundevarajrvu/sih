// SIH 26171 v2 -- V1a pii-tokenizer unit tests, tokenizer/vault half.
// Contract: docs/v2/ARCHITECTURE.md C2. Module under test:
// extension/lib/pii-tokenizer.js. Pure JS, no jsdom/browser dependency.
//
// Run:  node --test tests/unit/test_pii_tokenizer.mjs
// (or, with everyone else:  node --test tests/unit/*.mjs)

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { findRegexSpans } from "../../extension/lib/pii-regex.js";
import {
  mergeSpans,
  classifyBand,
  tokenize,
  rehydrate,
  createTokenMap,
  seedVault,
  TokenMap,
  TokenMapNotSerializableError,
  UnknownTokenError,
  TOKEN_PATTERN,
} from "../../extension/lib/pii-tokenizer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "../fixtures/v2/tokenizer");

function loadFixture(filename) {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, filename), "utf8"));
}

// ---------------------------------------------------------------------------
// classifyBand
// ---------------------------------------------------------------------------

describe("classifyBand", () => {
  test("regex spans always strip, regardless of score", () => {
    assert.equal(classifyBand({ label: "EMAIL", score: 1.0, source: "regex" }), "strip");
  });

  test("vault spans always strip", () => {
    assert.equal(classifyBand({ label: "PROFILENAME", score: 1.0, source: "vault" }), "strip");
  });

  test("NER span >= 0.60 strips", () => {
    assert.equal(classifyBand({ label: "ADDRESS", score: 0.6, source: "ner" }), "strip");
    assert.equal(classifyBand({ label: "ADDRESS", score: 0.99, source: "ner" }), "strip");
  });

  describe("PERSONNAME floor is 0.12 (not the default 0.35)", () => {
    const fx = loadFixture("ner_bands.json");

    test("0.24-score PERSONNAME -> ask", () => {
      assert.equal(
        classifyBand({ label: "PERSONNAME", score: fx.personNameAskScore, source: "ner" }),
        "ask"
      );
    });

    test("0.10-score PERSONNAME -> ignore (below the 0.12 floor)", () => {
      assert.equal(
        classifyBand({ label: "PERSONNAME", score: fx.personNameIgnoreScore, source: "ner" }),
        "ignore"
      );
    });
  });

  describe("every other label uses the default 0.35 floor", () => {
    const fx = loadFixture("ner_bands.json");

    test("0.40-score ACCOUNTNUMBER -> ask (above 0.35, below 0.60)", () => {
      assert.equal(
        classifyBand({ label: "ACCOUNTNUMBER", score: fx.accountNumberAskScore, source: "ner" }),
        "ask"
      );
    });

    test("0.20-score ACCOUNTNUMBER -> ignore (below 0.35)", () => {
      assert.equal(
        classifyBand({ label: "ACCOUNTNUMBER", score: fx.accountNumberIgnoreScore, source: "ner" }),
        "ignore"
      );
    });

    test("0.82-score ACCOUNTNUMBER -> strip", () => {
      assert.equal(
        classifyBand({ label: "ACCOUNTNUMBER", score: fx.accountNumberStripScore, source: "ner" }),
        "strip"
      );
    });
  });
});

// ---------------------------------------------------------------------------
// mergeSpans
// ---------------------------------------------------------------------------

describe("mergeSpans", () => {
  test("regex-only input (no NER spans) passes through unchanged and sorted -- card vs phone vs Aadhaar substrings", () => {
    const fx = loadFixture("regex_card_phone_aadhaar_overlap.json");
    const regexSpans = findRegexSpans(fx.text);
    const merged = mergeSpans(regexSpans, []);
    assert.deepEqual(merged, regexSpans.slice().sort((a, b) => a.start - b.start));
    assert.equal(merged.filter((s) => s.label === "AADHAAR").length, 0);
    assert.equal(merged.filter((s) => s.label === "CARD").length, 1);
    assert.equal(merged.filter((s) => s.label === "PHONE").length, 1);
  });

  test("partial overlap: an NER span that starts before and ends inside a regex span is unioned, keeping the regex label -- no raw character of either span is left untokenized", () => {
    const text = "Contact john@example.com now";
    const regexSpans = findRegexSpans(text);
    const emailSpan = regexSpans.find((s) => s.label === "EMAIL");
    assert.ok(emailSpan, "fixture text must contain a detectable email");

    // Sticks out 3 characters to the LEFT of the email span, and ends
    // partway INSIDE it -- a genuine partial overlap on one side.
    const nerSpan = {
      start: emailSpan.start - 3,
      end: emailSpan.start + 5,
      label: "PERSONNAME",
      score: 0.9,
      source: "ner",
    };
    assert.ok(nerSpan.start < emailSpan.start && nerSpan.end < emailSpan.end && nerSpan.end > emailSpan.start);

    const merged = mergeSpans([emailSpan], [nerSpan]);
    assert.equal(merged.length, 1, "the two overlapping spans must collapse into exactly one");
    const [result] = merged;
    assert.equal(result.start, nerSpan.start, "union extent must include the NER span's earlier start");
    assert.equal(result.end, emailSpan.end, "union extent must include the regex span's later end");
    assert.equal(result.label, "EMAIL", "regex label wins the overlap");
    assert.equal(result.source, "regex");
    assert.equal(result.score, 1.0);
  });

  test("a non-overlapping NER span is kept as its own separate span", () => {
    const regexSpans = [{ start: 0, end: 5, label: "EMAIL", score: 1.0, source: "regex" }];
    const nerSpans = [{ start: 20, end: 27, label: "PERSONNAME", score: 0.8, source: "ner" }];
    const merged = mergeSpans(regexSpans, nerSpans);
    assert.equal(merged.length, 2);
  });

  test("two overlapping NER spans (no regex involved) union and keep the higher-scoring label", () => {
    const nerSpans = [
      { start: 0, end: 10, label: "ADDRESS", score: 0.5, source: "ner" },
      { start: 5, end: 15, label: "PERSONNAME", score: 0.7, source: "ner" },
    ];
    const merged = mergeSpans([], nerSpans);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].start, 0);
    assert.equal(merged[0].end, 15);
    assert.equal(merged[0].label, "PERSONNAME");
    assert.equal(merged[0].score, 0.7);
  });

  test("output is always sorted by start", () => {
    const regexSpans = [{ start: 30, end: 35, label: "EMAIL", score: 1.0, source: "regex" }];
    const nerSpans = [{ start: 0, end: 5, label: "PERSONNAME", score: 0.9, source: "ner" }];
    const merged = mergeSpans(regexSpans, nerSpans);
    assert.equal(merged[0].start, 0);
    assert.equal(merged[1].start, 30);
  });
});

// ---------------------------------------------------------------------------
// tokenize / rehydrate round trip, dedup, token grammar
// ---------------------------------------------------------------------------

describe("tokenize", () => {
  test("empty text", () => {
    const tokenMap = createTokenMap();
    const result = tokenize("", [], tokenMap);
    assert.equal(result.text, "");
    assert.deepEqual(result.asked, []);
    assert.equal(tokenMap.size, 0);
  });

  test("text with no PII is returned unchanged", () => {
    const text = "The quick brown fox jumps over the lazy dog.";
    const tokenMap = createTokenMap();
    const spans = mergeSpans(findRegexSpans(text), []);
    const result = tokenize(text, spans, tokenMap);
    assert.equal(result.text, text);
    assert.equal(tokenMap.size, 0);
    assert.deepEqual(result.asked, []);
  });

  test("Luhn-invalid card number: no spans means the digits pass through untouched", () => {
    const fx = loadFixture("regex_luhn_invalid_card.json");
    const tokenMap = createTokenMap();
    const spans = mergeSpans(findRegexSpans(fx.text), []);
    const result = tokenize(fx.text, spans, tokenMap);
    assert.equal(result.text, fx.text);
    assert.ok(result.text.includes(fx.invalidCardValue));
  });

  test("same-value-same-token: an EXACT repeat of the same email mints one token, reused", () => {
    const fx = loadFixture("same_value_same_token.json");
    const tokenMap = createTokenMap();
    const spans = mergeSpans(findRegexSpans(fx.exactRepeatText), []);
    const result = tokenize(fx.exactRepeatText, spans, tokenMap);
    const matches = result.text.match(/EMAIL#\d+/g);
    assert.deepEqual(matches, ["EMAIL#1", "EMAIL#1"]);
    assert.equal(tokenMap.size, 1);
    assert.equal(tokenMap.get("EMAIL#1"), "john@example.com");
  });

  test("case-normalized email reuse: differently-cased/whitespaced occurrences of the same address dedupe to one token", () => {
    const fx = loadFixture("same_value_same_token.json");
    const tokenMap = createTokenMap();
    const spans = mergeSpans(findRegexSpans(fx.caseVariantText), []);
    const result = tokenize(fx.caseVariantText, spans, tokenMap);
    const matches = result.text.match(/EMAIL#\d+/g);
    assert.deepEqual(matches, ["EMAIL#1", "EMAIL#1"]);
    assert.equal(tokenMap.size, 1);
    // The RAW value stored is whichever occurrence was encountered FIRST
    // (case preserved as-seen) -- dedup normalizes the *lookup key* only,
    // never the stored value itself.
    assert.equal(tokenMap.get("EMAIL#1"), "John@Example.com");
  });

  test("two genuinely DIFFERENT emails mint two distinct tokens", () => {
    const fx = loadFixture("same_value_same_token.json");
    const tokenMap = createTokenMap();
    const spans = mergeSpans(findRegexSpans(fx.distinctEmailsText), []);
    const result = tokenize(fx.distinctEmailsText, spans, tokenMap);
    const matches = result.text.match(/EMAIL#\d+/g);
    assert.deepEqual(matches.sort(), ["EMAIL#1", "EMAIL#2"]);
    assert.equal(tokenMap.size, 2);
  });

  test("ask-band spans ARE tokenized (held) and also returned in `asked`", () => {
    const fx = loadFixture("ner_bands.json");
    const start = fx.text.indexOf(fx.personNameValue);
    const span = {
      start,
      end: start + fx.personNameValue.length,
      label: "PERSONNAME",
      score: fx.personNameAskScore,
      source: "ner",
    };
    const tokenMap = createTokenMap();
    const result = tokenize(fx.text, [span], tokenMap);
    assert.ok(result.text.includes("PERSONNAME#1"));
    assert.ok(!result.text.includes(fx.personNameValue));
    assert.equal(result.asked.length, 1);
    assert.equal(result.asked[0].label, "PERSONNAME");
    assert.equal(tokenMap.get("PERSONNAME#1"), fx.personNameValue);
  });

  test("ignore-band spans are left completely untouched: raw text stays, no token minted, nothing in `asked`", () => {
    const fx = loadFixture("ner_bands.json");
    const start = fx.text.indexOf(fx.personNameValue);
    const span = {
      start,
      end: start + fx.personNameValue.length,
      label: "PERSONNAME",
      score: fx.personNameIgnoreScore,
      source: "ner",
    };
    const tokenMap = createTokenMap();
    const result = tokenize(fx.text, [span], tokenMap);
    assert.equal(result.text, fx.text);
    assert.equal(tokenMap.size, 0);
    assert.deepEqual(result.asked, []);
  });

  test("token grammar: every minted token matches /[A-Z][A-Z0-9]*#[0-9]+/ and contains no underscore", () => {
    const text = "Email john@example.com, phone 9876543210, PAN BNZPM2501F.";
    const tokenMap = createTokenMap();
    const spans = mergeSpans(findRegexSpans(text), []);
    const result = tokenize(text, spans, tokenMap);
    const tokens = result.text.match(/[A-Z][A-Z0-9]*#[0-9]+/g) || [];
    assert.ok(tokens.length >= 3);
    for (const token of tokens) {
      assert.match(token, TOKEN_PATTERN);
      assert.ok(!token.includes("_"), `token "${token}" must not contain an underscore`);
    }
  });
});

// ---------------------------------------------------------------------------
// rehydrate
// ---------------------------------------------------------------------------

describe("rehydrate", () => {
  test("round-trip: tokenize then rehydrate restores the exact original raw values", () => {
    const text = "Email me at john@example.com or call 9876543210.";
    const tokenMap = createTokenMap();
    const spans = mergeSpans(findRegexSpans(text), []);
    const { text: tokenized } = tokenize(text, spans, tokenMap);
    assert.notEqual(tokenized, text);

    // Simulate a planner-composed value that references the minted tokens.
    const modelValue = "Please confirm EMAIL#1 and PHONE#1 are correct.";
    const rehydrated = rehydrate(modelValue, tokenMap);
    assert.equal(rehydrated, "Please confirm john@example.com and 9876543210 are correct.");
  });

  test("rehydrating the tokenizer's own output restores the original text byte-for-byte", () => {
    const text = "Email me at john@example.com or call 9876543210.";
    const tokenMap = createTokenMap();
    const spans = mergeSpans(findRegexSpans(text), []);
    const { text: tokenized } = tokenize(text, spans, tokenMap);
    assert.equal(rehydrate(tokenized, tokenMap), text);
  });

  test("throws UnknownTokenError (a typed error) on a token-shaped substring the TokenMap never minted", () => {
    const tokenMap = createTokenMap();
    tokenMap.getOrCreateToken("EMAIL", "a@b.com");
    assert.throws(
      () => rehydrate("Please type EMAIL#99 here", tokenMap),
      (err) => err instanceof UnknownTokenError && err.token === "EMAIL#99"
    );
  });

  test("never returns a string still containing a token-shaped substring (it throws instead)", () => {
    const tokenMap = createTokenMap();
    let threw = false;
    let result;
    try {
      result = rehydrate("PROFILEPHONE#1 is unknown", tokenMap);
    } catch (err) {
      threw = true;
      assert.ok(err instanceof UnknownTokenError);
    }
    assert.equal(threw, true);
    assert.equal(result, undefined, "no partial/leaked result should ever be assigned");
  });
});

// ---------------------------------------------------------------------------
// seedVault
// ---------------------------------------------------------------------------

describe("seedVault", () => {
  const fx = loadFixture("vault_profile.json");

  test("mints PROFILENAME#n / PROFILEEMAIL#n / PROFILEPHONE#n for a fully-populated profile", () => {
    const tokenMap = createTokenMap();
    const tokens = seedVault(tokenMap, fx.fullProfile);
    assert.equal(tokens.full_name, "PROFILENAME#1");
    assert.equal(tokens.email, "PROFILEEMAIL#1");
    assert.equal(tokens.phone, "PROFILEPHONE#1");
    assert.equal(tokenMap.get("PROFILENAME#1"), fx.fullProfile.full_name);
    assert.equal(tokenMap.get("PROFILEEMAIL#1"), fx.fullProfile.email);
    assert.equal(tokenMap.get("PROFILEPHONE#1"), fx.fullProfile.phone);
    assert.equal(tokenMap.size, 3);
  });

  test("an empty field mints no token (null, not an empty-string token)", () => {
    const tokenMap = createTokenMap();
    const tokens = seedVault(tokenMap, fx.partialProfile);
    assert.equal(tokens.full_name, "PROFILENAME#1");
    assert.equal(tokens.email, "PROFILEEMAIL#1");
    assert.equal(tokens.phone, null, "empty phone field must not mint PROFILEPHONE#1");
    assert.equal(tokenMap.size, 2);
  });

  test("null/undefined profile mints nothing and never throws", () => {
    const tokenMap = createTokenMap();
    assert.deepEqual(seedVault(tokenMap, null), { full_name: null, email: null, phone: null });
    assert.deepEqual(seedVault(tokenMap, undefined), { full_name: null, email: null, phone: null });
    assert.equal(tokenMap.size, 0);
  });

  test("vault-minted tokens are also underscore-free and grammar-valid", () => {
    const tokenMap = createTokenMap();
    const tokens = seedVault(tokenMap, fx.fullProfile);
    for (const token of Object.values(tokens)) {
      assert.match(token, TOKEN_PATTERN);
      assert.ok(!token.includes("_"));
    }
  });

  test("vault tokens rehydrate back to the exact profile values", () => {
    const tokenMap = createTokenMap();
    const tokens = seedVault(tokenMap, fx.fullProfile);
    const value = `type ${tokens.email} into the email field`;
    assert.equal(rehydrate(value, tokenMap), `type ${fx.fullProfile.email} into the email field`);
  });
});

// ---------------------------------------------------------------------------
// TokenMap.toJSON() must throw -- never silently JSON-serializable
// ---------------------------------------------------------------------------

describe("TokenMap is not JSON-serializable by accident", () => {
  test("tokenMap.toJSON() throws TokenMapNotSerializableError directly", () => {
    const tokenMap = createTokenMap();
    assert.throws(() => tokenMap.toJSON(), TokenMapNotSerializableError);
  });

  test("JSON.stringify(tokenMap) throws", () => {
    const tokenMap = createTokenMap();
    assert.throws(() => JSON.stringify(tokenMap), TokenMapNotSerializableError);
  });

  test("JSON.stringify of a payload that NESTS a TokenMap anywhere in its object graph also throws", () => {
    const tokenMap = createTokenMap();
    tokenMap.getOrCreateToken("EMAIL", "a@b.com");
    const payload = { action: "type", targetId: "agent-1", debug: { runState: { tokenMap } } };
    assert.throws(() => JSON.stringify(payload), TokenMapNotSerializableError);
  });

  test("createTokenMap() returns a real TokenMap instance", () => {
    assert.ok(createTokenMap() instanceof TokenMap);
  });
});
