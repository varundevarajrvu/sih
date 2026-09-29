// SIH 26171 v2 -- JS/Python PII regex PARITY test (orchestrator, 2026-09-24).
//
// Runs extension/lib/pii-regex.js's findRegexSpans() against
// tests/fixtures/v2/pii_parity.json and asserts its output matches each
// case's `expected` array exactly. The Python twin,
// tests/unit/test_pii_parity.py, runs server/pii_regex_v2.py's
// find_regex_spans() against the SAME fixture file -- if both pass, the
// two languages' regex-PII detection layers are PROVABLY aligned on every
// case in the fixture, not just "believed" to agree.
//
// Run:  node --test tests/unit/test_pii_parity.mjs
// (or, with everyone else:  node --test tests/unit/*.mjs)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { findRegexSpans } from "../../extension/lib/pii-regex.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, "../fixtures/v2/pii_parity.json");

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

test(`pii_parity.json has at least 60 cases (found ${fixture.cases.length})`, () => {
  assert.ok(fixture.cases.length >= 60);
});

for (const { id, text, expected } of fixture.cases) {
  test(`parity fixture :: ${id}`, () => {
    const spans = findRegexSpans(text);
    const actual = spans.map((s) => ({ label: s.label, text: text.slice(s.start, s.end) }));
    assert.deepEqual(actual, expected, `text: ${JSON.stringify(text)}`);
  });
}
