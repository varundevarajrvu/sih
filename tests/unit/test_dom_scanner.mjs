// SIH 26171 -- Phase 2a (dom-pii-scanner) unit tests.
//
// Runs under plain Node (no browser, no extension loaded) per this
// module's architecture requirement: extension/lib/dom-scanner.js is a
// pure function, fed a jsdom-parsed Document here and a real content-script
// `document` once Phase 4 wires it in.
//
// DEPENDENCY NOTE: jsdom was NOT already available anywhere in this repo
// (no root package.json, extension/node_modules has no jsdom, no global
// npm jsdom install). It is added here, scoped to
// tests/unit/dom-scanner-vendor/package.json -- a directory private to
// this test file, deliberately NOT extension/package.json or a
// repo-root package.json, to avoid an `npm install` race with the
// redaction-engine and action-executor subagents building concurrently in
// the same repo (own file ownership: CLAUDE.md's Phase 2a delegation is
// explicit that three agents are editing this repo at once). See the
// Phase 2a report for the full reasoning.
//
// Run with:  node --test tests/unit/test_dom_scanner.mjs
// (Node's built-in test runner + assert -- no extra test-runner dependency
// needed beyond jsdom itself.)

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { JSDOM } from "./dom-scanner-vendor/node_modules/jsdom/lib/api.js";
import { scanForPii, PII_TYPES, computeSelector } from "../../extension/lib/dom-scanner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");

function loadFixtureDocument(filename) {
  const html = readFileSync(path.join(FIXTURES_DIR, filename), "utf8");
  const dom = new JSDOM(html);
  return dom.window.document;
}

function findBySelector(sensitiveNodes, selector) {
  return sensitiveNodes.filter((n) => n.selector === selector);
}

function piiTypesFor(sensitiveNodes, selector) {
  return findBySelector(sensitiveNodes, selector)
    .map((n) => n.piiType)
    .sort();
}

// ---------------------------------------------------------------------------
// Vocabulary drift guard -- keep byte-for-byte in sync with
// server/schemas.py::PiiType. If this test fails, either dom-scanner.js's
// PII_TYPES or schemas.py's PiiType enum changed without updating the other.
// ---------------------------------------------------------------------------
describe("PII_TYPES vocabulary matches server/schemas.py::PiiType exactly", () => {
  test("closed vocabulary is exactly the 8 values from schemas.py", () => {
    const expected = [
      "password",
      "cc-number",
      "current-password",
      "email",
      "tel",
      "aadhaar",
      "pan",
      "other",
    ].sort();
    assert.deepEqual(Object.values(PII_TYPES).sort(), expected);
  });
});

// ---------------------------------------------------------------------------
// CLAUDE.md Section 6 checkpoint -- the three mandatory fixtures.
// ---------------------------------------------------------------------------
describe("Phase 2a checkpoint (CLAUDE.md Section 6): 3 mandatory fixtures", () => {
  test("fixture 1: one password field -> flagged as password, nothing else", () => {
    const doc = loadFixtureDocument("dom_scanner_password_field.html");
    const { sensitiveNodes } = scanForPii(doc);
    assert.equal(sensitiveNodes.length, 1);
    assert.equal(sensitiveNodes[0].selector, "#pw");
    assert.equal(sensitiveNodes[0].piiType, PII_TYPES.PASSWORD);
    assert.equal(sensitiveNodes[0].agentId, "agent-1");
    assert.deepEqual(Object.keys(sensitiveNodes[0].bbox).sort(), ["h", "w", "x", "y"]);
  });

  test("fixture 2: plain text -> nothing flagged", () => {
    const doc = loadFixtureDocument("dom_scanner_plain_text.html");
    const { sensitiveNodes } = scanForPii(doc);
    assert.deepEqual(sensitiveNodes, []);
  });

  test("fixture 3: Aadhaar-like 12-digit number in a <p> -> flagged as aadhaar", () => {
    const doc = loadFixtureDocument("dom_scanner_aadhaar_like.html");
    const { sensitiveNodes } = scanForPii(doc);
    assert.equal(sensitiveNodes.length, 1);
    assert.equal(sensitiveNodes[0].piiType, PII_TYPES.AADHAAR);
    // No id on this <p> -> full ancestor-anchored structural selector.
    assert.equal(sensitiveNodes[0].selector, "body > p");
  });
});

// ---------------------------------------------------------------------------
// "Go further" fixtures explicitly requested by the task brief.
// ---------------------------------------------------------------------------
describe("false-positive trap: 12-digit order number", () => {
  test("is flagged as aadhaar too -- documented over-flag, not a bug", () => {
    const doc = loadFixtureDocument("dom_scanner_order_id_trap.html");
    const { sensitiveNodes } = scanForPii(doc);
    // Intentional: the heuristic cannot distinguish a 12-digit order ID
    // from a 12-digit Aadhaar number. This test documents/locks in that
    // known trade-off rather than hiding it -- see dom-scanner.js's header
    // comment ("KNOWN WEAKNESSES") and the Phase 2a report.
    assert.equal(sensitiveNodes.length, 1);
    assert.equal(sensitiveNodes[0].piiType, PII_TYPES.AADHAAR);
  });
});

describe("autocomplete-tagged field without type=password/email/tel", () => {
  test("autocomplete=cc-number on a type=text input is flagged as cc-number", () => {
    const doc = loadFixtureDocument("dom_scanner_autocomplete_cc_number.html");
    const { sensitiveNodes } = scanForPii(doc);
    assert.equal(sensitiveNodes.length, 1);
    assert.equal(sensitiveNodes[0].selector, "#card");
    assert.equal(sensitiveNodes[0].piiType, PII_TYPES.CC_NUMBER);
  });
});

describe("email address in visible text", () => {
  test("is flagged as email, selector points at the containing <p>", () => {
    const doc = loadFixtureDocument("dom_scanner_email_in_text.html");
    const { sensitiveNodes } = scanForPii(doc);
    assert.equal(sensitiveNodes.length, 1);
    assert.equal(sensitiveNodes[0].piiType, PII_TYPES.EMAIL);
    assert.equal(sensitiveNodes[0].selector, "body > p");
  });
});

describe("PAN-shaped alphanumeric in visible text", () => {
  test("5 letters + 4 digits + 1 letter is flagged as pan", () => {
    const doc = loadFixtureDocument("dom_scanner_pan_in_text.html");
    const { sensitiveNodes } = scanForPii(doc);
    assert.equal(sensitiveNodes.length, 1);
    assert.equal(sensitiveNodes[0].piiType, PII_TYPES.PAN);
  });
});

describe("current-password vs new-password autocomplete", () => {
  test("current-password maps exactly; bare new-password degrades to other (enum gap)", () => {
    const doc = loadFixtureDocument("dom_scanner_password_autocomplete_variants.html");
    const { sensitiveNodes } = scanForPii(doc);
    assert.equal(sensitiveNodes.length, 3);
    assert.equal(piiTypesFor(sensitiveNodes, "#cur")[0], PII_TYPES.CURRENT_PASSWORD);
    // "new-password" is not a member of server/schemas.py::PiiType. When it
    // is the ONLY signal (no type=password alongside it), it is NEVER
    // silently dropped and NEVER silently relabeled "password" -- it
    // degrades to the explicit OTHER escape hatch: still flagged, still
    // redacted, just unclassified. See dom-scanner.js CONTRACT NOTE.
    assert.equal(piiTypesFor(sensitiveNodes, "#new-alone")[0], PII_TYPES.OTHER);
  });

  test("new-password co-located WITH type=password resolves to password, not other", () => {
    const doc = loadFixtureDocument("dom_scanner_password_autocomplete_variants.html");
    const { sensitiveNodes } = scanForPii(doc);
    // type=password is an independently-certain signal and wins over the
    // unmapped autocomplete token -- see classifyField()'s priority rule.
    assert.equal(piiTypesFor(sensitiveNodes, "#new-and-type")[0], PII_TYPES.PASSWORD);
  });
});

describe("visibility gate on text-node regex matching", () => {
  test("display:none text is skipped; visible text is flagged", () => {
    const doc = loadFixtureDocument("dom_scanner_hidden_text.html");
    const { sensitiveNodes } = scanForPii(doc);
    assert.equal(sensitiveNodes.length, 1);
    assert.equal(sensitiveNodes[0].piiType, PII_TYPES.EMAIL);
    // Only the visible <p> (second one) should be selected -- confirm via
    // nth-of-type since neither <p> has an id.
    assert.equal(sensitiveNodes[0].selector, "body > p:nth-of-type(2)");
  });
});

describe("form fields are NOT visibility-gated (unlike text nodes)", () => {
  test("a display:none password field is still flagged", () => {
    const doc = loadFixtureDocument("dom_scanner_hidden_password_field.html");
    const { sensitiveNodes } = scanForPii(doc);
    assert.equal(sensitiveNodes.length, 1);
    assert.equal(sensitiveNodes[0].piiType, PII_TYPES.PASSWORD);
    assert.equal(sensitiveNodes[0].selector, "#hiddenpw");
  });
});

describe("type=hidden input is not conflated with sensitive", () => {
  test("a CSRF-style hidden input with no PII signal is not flagged", () => {
    const doc = loadFixtureDocument("dom_scanner_type_hidden_input.html");
    const { sensitiveNodes } = scanForPii(doc);
    assert.deepEqual(sensitiveNodes, []);
  });
});

describe("script/style content is never regex-scanned as visible text", () => {
  test("an email-shaped string inside <script> is not flagged", () => {
    const doc = loadFixtureDocument("dom_scanner_script_not_scanned.html");
    const { sensitiveNodes } = scanForPii(doc);
    assert.deepEqual(sensitiveNodes, []);
  });
});

describe("multiple PII categories inside one element", () => {
  test("email + phone in one <p> produce two entries, same selector", () => {
    const doc = loadFixtureDocument("dom_scanner_multi_pii_paragraph.html");
    const { sensitiveNodes } = scanForPii(doc);
    assert.equal(sensitiveNodes.length, 2);
    assert.equal(sensitiveNodes[0].selector, "body > p");
    assert.equal(sensitiveNodes[1].selector, "body > p");
    assert.deepEqual(
      piiTypesFor(sensitiveNodes, "body > p"),
      [PII_TYPES.EMAIL, PII_TYPES.TEL].sort()
    );
  });
});

describe("existing data-agent-id is reused, not overwritten", () => {
  test("an element already stamped by action-executor keeps its agentId", () => {
    const doc = loadFixtureDocument("dom_scanner_existing_agent_id.html");
    const { sensitiveNodes } = scanForPii(doc);
    assert.equal(sensitiveNodes.length, 1);
    assert.equal(sensitiveNodes[0].agentId, "agent-42");
  });
});

describe("composite page: ordering, dedup, and mixed detection sources", () => {
  test("password/email fields + text-node email + text-node aadhaar-like number all detected", () => {
    const doc = loadFixtureDocument("dom_scanner_mixed_page.html");
    const { sensitiveNodes } = scanForPii(doc);

    const bySelector = new Map(sensitiveNodes.map((n) => [n.selector, n]));
    assert.equal(bySelector.get("#mail").piiType, PII_TYPES.EMAIL);
    // autocomplete="current-password" beats the plain type=password signal
    // on the same element -- more specific wins (see classifyField()).
    assert.equal(bySelector.get("#pw3").piiType, PII_TYPES.CURRENT_PASSWORD);
    // Plain username field: no PII signal at all.
    assert.ok(!bySelector.has("#uname"));

    const textFlags = sensitiveNodes.filter((n) => !n.selector.startsWith("#"));
    const textTypes = textFlags.map((n) => n.piiType).sort();
    assert.deepEqual(textTypes, [PII_TYPES.AADHAAR, PII_TYPES.EMAIL].sort());

    // agentId must be unique across every entry in one scan pass.
    const agentIds = sensitiveNodes.map((n) => n.agentId);
    assert.equal(new Set(agentIds).size, agentIds.length);
  });
});

// ---------------------------------------------------------------------------
// bbox injectability -- real getBoundingClientRect() is unverified outside
// a browser (jsdom always returns zeros); confirm the injection seam works
// so a future browser/integration test can supply real geometry.
// ---------------------------------------------------------------------------
describe("bbox acquisition is injectable (real geometry unverified outside a browser)", () => {
  test("jsdom's default getBoundingClientRect is all zeros", () => {
    const doc = loadFixtureDocument("dom_scanner_password_field.html");
    const { sensitiveNodes } = scanForPii(doc);
    assert.deepEqual(sensitiveNodes[0].bbox, { x: 0, y: 0, w: 0, h: 0 });
  });

  test("a custom getBBox is used instead of getBoundingClientRect when provided", () => {
    const doc = loadFixtureDocument("dom_scanner_password_field.html");
    const stubBBox = { x: 10, y: 20, w: 100, h: 30 };
    const { sensitiveNodes } = scanForPii(doc, { getBBox: () => stubBBox });
    assert.deepEqual(sensitiveNodes[0].bbox, stubBBox);
  });
});

describe("agentId acquisition is injectable", () => {
  test("a custom getAgentId overrides the default agent-<n> scheme", () => {
    const doc = loadFixtureDocument("dom_scanner_password_field.html");
    const { sensitiveNodes } = scanForPii(doc, {
      getAgentId: (_el, ordinal) => `custom-${ordinal}`,
    });
    assert.equal(sensitiveNodes[0].agentId, "custom-1");
  });
});

// ---------------------------------------------------------------------------
// computeSelector() unit coverage (exported for direct testing).
// ---------------------------------------------------------------------------
describe("computeSelector", () => {
  test("prefers #id when present", () => {
    const doc = loadFixtureDocument("dom_scanner_password_field.html");
    const el = doc.getElementById("pw");
    assert.equal(computeSelector(el), "#pw");
  });

  test("falls back to structural nth-of-type path when no id", () => {
    const doc = loadFixtureDocument("dom_scanner_hidden_text.html");
    const paragraphs = doc.querySelectorAll("p");
    assert.equal(computeSelector(paragraphs[0]), "body > p:nth-of-type(1)");
    assert.equal(computeSelector(paragraphs[1]), "body > p:nth-of-type(2)");
  });
});

// ---------------------------------------------------------------------------
// Output shape sanity: the top-level contract is exactly { sensitiveNodes }.
// ---------------------------------------------------------------------------
describe("output shape matches the CLAUDE.md Section 4 contract", () => {
  test("scanForPii returns { sensitiveNodes: [...] } with the exact field set per entry", () => {
    const doc = loadFixtureDocument("dom_scanner_password_field.html");
    const result = scanForPii(doc);
    assert.deepEqual(Object.keys(result), ["sensitiveNodes"]);
    const entry = result.sensitiveNodes[0];
    assert.deepEqual(Object.keys(entry).sort(), ["agentId", "bbox", "piiType", "selector"].sort());
  });
});
