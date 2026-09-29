"""SIH 26171 v2 -- JS/Python PII regex PARITY test (orchestrator, 2026-09-24).

Runs server/pii_regex_v2.py's find_regex_spans() against
tests/fixtures/v2/pii_parity.json and asserts its output matches each
case's `expected` array exactly. The JS twin, tests/unit/test_pii_parity.mjs,
runs extension/lib/pii-regex.js's findRegexSpans() against the SAME
fixture file -- if both pass, the two languages' regex-PII detection
layers are PROVABLY aligned on every case in the fixture, not just
"believed" to agree.

find_regex_spans() is a test-support-only function added to pii_regex_v2.py
specifically for this parity check (the module's one production entry
point, contains_unmasked_pii(), is a pure boolean and has no way to
express "which label, which substring" -- see that function's own
docstring).

Run:  server/.venv/Scripts/python.exe -m pytest tests/unit/test_pii_parity.py -q
(or, with everyone else:  server/.venv/Scripts/python.exe -m pytest tests -q)
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pii_regex_v2 import find_regex_spans

FIXTURE_PATH = Path(__file__).resolve().parents[1] / "fixtures" / "v2" / "pii_parity.json"

with FIXTURE_PATH.open(encoding="utf-8") as f:
    _fixture = json.load(f)

CASES = _fixture["cases"]


def test_fixture_has_at_least_60_cases():
    assert len(CASES) >= 60, f"found {len(CASES)}"


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_parity_fixture_case(case):
    text = case["text"]
    expected = [(e["label"], e["text"]) for e in case["expected"]]
    spans = find_regex_spans(text)
    actual = [(s["label"], text[s["start"]:s["end"]]) for s in spans]
    assert actual == expected, f"text: {text!r}"
