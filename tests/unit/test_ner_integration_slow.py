"""Opt-in integration test: the REAL urchade/gliner_multi_pii-v1 model,
loaded from spikes/gliner/.hf's cache, run over the 10 real fixtures in
spikes/gliner/fixtures.json.

NOT part of the default `pytest tests -q` run: this needs torch+gliner
installed (only spikes/gliner/.venv has them; server/.venv does not) and
costs a ~110s cold load (spikes/gliner/bench_python_result.json). Guarded
two ways so it never silently makes the shared suite slower or breaks it in
an environment without torch:

  1. `pytestmark = pytest.mark.slow` -- conventional marker (no project-wide
     pytest.ini exists to register it or to default-exclude it, so this
     alone would still run under a bare `pytest`; see #2).
  2. Module-level skip unless NER_RUN_SLOW=1 is set in the environment.

Run it explicitly with the spike venv:
    NER_RUN_SLOW=1 spikes/gliner/.venv/Scripts/python.exe -m pytest \
        tests/unit/test_ner_integration_slow.py -v
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

if not os.environ.get("NER_RUN_SLOW"):
    pytest.skip(
        "opt-in only: set NER_RUN_SLOW=1 to run the real-model GLiNER integration test "
        "(needs torch+gliner, ~110s cold load)",
        allow_module_level=True,
    )

pytest.importorskip("torch")
pytest.importorskip("gliner")

pytestmark = pytest.mark.slow

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from ner import model_loader  # noqa: E402
from ner.ner_engine import detect_entities_single  # noqa: E402

FIXTURES_PATH = REPO_ROOT / "spikes" / "gliner" / "fixtures.json"


def _load_fixtures():
    return json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))["fixtures"]


@pytest.fixture(scope="module")
def loaded_model():
    state = model_loader.ModelState()
    model_loader.load_model(state)
    assert state.model is not None, f"real model failed to load: {state.load_error}"
    return state.model


def _overlaps(a_start, a_end, b_start, b_end) -> bool:
    return a_start < b_end and b_start < a_end


@pytest.mark.parametrize("fixture", _load_fixtures(), ids=lambda fx: fx["id"])
def test_fixture_expected_entities_are_found(fixture, loaded_model):
    spans = detect_entities_single(fixture["text"], loaded_model)

    if not fixture["expected"]:
        # Controls (f07/f08): the real model must not hallucinate PII on
        # plain non-PII sentences.
        assert spans == [], f"{fixture['id']}: expected zero spans, got {spans}"
        return

    for expected in fixture["expected"]:
        matches = [
            s
            for s in spans
            if s["label"] == expected["label"] and _overlaps(s["start"], s["end"], expected["start"], expected["end"])
        ]
        assert matches, (
            f"{fixture['id']}: expected {expected['label']} {expected['text']!r} "
            f"({expected['start']}-{expected['end']}) not found in {spans}"
        )


def test_imperative_name_case_reaches_at_least_the_ask_band(loaded_model):
    """docs/v2/ARCHITECTURE.md V1b checkpoint: 'imperative-name case is >=
    ask'. C2's ask band starts at PERSONNAME's floor, 0.12."""
    fixtures = {fx["id"]: fx for fx in _load_fixtures()}
    fx = fixtures["f01_imperative_name"]
    spans = detect_entities_single(fx["text"], loaded_model)
    person_spans = [s for s in spans if s["label"] == "PERSONNAME"]
    assert person_spans, f"no PERSONNAME span found at all for {fx['text']!r}"
    assert max(s["score"] for s in person_spans) >= 0.12


def test_controls_produce_zero_spans(loaded_model):
    fixtures = {fx["id"]: fx for fx in _load_fixtures()}
    for fid in ("f07_control_no_pii_a", "f08_control_no_pii_b"):
        spans = detect_entities_single(fixtures[fid]["text"], loaded_model)
        assert spans == [], f"{fid}: expected zero spans, got {spans}"
