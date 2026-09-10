"""Schema validation tests: request contract, response action enum
strictness, PII-type closed enum degrade behavior, and the PAGE_TARGET_ID
sentinel. The PII-leak *rejection* itself is tested at the HTTP-response
level in test_api.py (it's no longer a schema-construction failure — see
schemas.PIILeakDetected's docstring for why) and as a pure-function check
in test_pii_leak.py.

Run from repo root: server/.venv/Scripts/python.exe -m pytest tests/
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from schemas import (
    PAGE_TARGET_ID,
    ActionResponse,
    AnalyzeRequest,
    PiiType,
    RedactedRegion,
    find_pii_leaks,
)


def test_valid_request_parses(load_fixture):
    data = load_fixture("valid_request.json")
    req = AnalyzeRequest.model_validate(data)
    assert req.taskGoal == "Click the submit button"
    assert len(req.domSnapshot) == 2
    assert req.redactedRegions == []


def test_valid_request_with_redaction_parses(load_fixture):
    data = load_fixture("valid_request_with_redaction.json")
    req = AnalyzeRequest.model_validate(data)
    assert len(req.redactedRegions) == 1
    assert req.redactedRegions[0].agentId == "agent-1"
    assert req.redactedRegions[0].type == PiiType.PASSWORD
    # The redacted node's text was properly stripped by the client.
    redacted_node = next(n for n in req.domSnapshot if n.agentId == "agent-1")
    assert redacted_node.text is None


def test_malformed_request_missing_taskgoal_rejected(load_fixture):
    data = load_fixture("malformed_request_missing_field.json")
    with pytest.raises(ValidationError):
        AnalyzeRequest.model_validate(data)


def test_pii_leak_fixture_is_structurally_valid_but_flagged_by_leak_check(load_fixture):
    """PII-leak detection is a semantic/security check, not a structural
    schema constraint (orchestrator ruling #4, Section 7 rule 5): keeping
    it out of AnalyzeRequest's own validators lets main.py return a
    distinct 400 + errorCode for leaks vs. 422 for ordinary schema
    errors, without sniffing error message text. So this fixture parses
    fine at the schema level — the leak is caught explicitly by
    find_pii_leaks(), which is what main.py's
    get_validated_analyze_request dependency calls (see test_api.py for
    the end-to-end HTTP behavior)."""
    data = load_fixture("malformed_request_pii_leak.json")
    req = AnalyzeRequest.model_validate(data)  # does NOT raise
    leaks = find_pii_leaks(req.domSnapshot, req.redactedRegions)
    assert len(leaks) == 1
    assert "agent-1" in leaks[0]


def test_unknown_extra_field_rejected(load_fixture):
    """extra='forbid' on AnalyzeRequest: an unexpected field must fail
    validation, not silently pass through."""
    data = load_fixture("valid_request.json")
    data["unexpectedField"] = "should not be allowed"
    with pytest.raises(ValidationError):
        AnalyzeRequest.model_validate(data)


class TestActionResponseEnum:
    """Section 4/5 requirement: action must be a strict enum. A VLM
    returning an improvised action name must fail loudly."""

    @pytest.mark.parametrize("action", ["click", "type", "scroll", "done"])
    def test_valid_actions_accepted(self, action):
        resp = ActionResponse.model_validate({"action": action, "targetId": "agent-1", "value": None})
        assert resp.action.value == action

    def test_unknown_action_rejected(self, load_fixture):
        data = load_fixture("malformed_vlm_response.json")
        assert data["action"] == "scroll_up_fast"
        with pytest.raises(ValidationError):
            ActionResponse.model_validate(data)

    def test_missing_targetid_rejected(self):
        with pytest.raises(ValidationError):
            ActionResponse.model_validate({"action": "click", "value": None})

    def test_empty_targetid_rejected(self):
        with pytest.raises(ValidationError):
            ActionResponse.model_validate({"action": "click", "targetId": "", "value": None})


class TestPageTargetIdSentinel:
    """Orchestrator ruling #3: targetId stays required even for
    scroll/done, using a NAMED constant so Phase 3 doesn't have to
    re-derive an undocumented magic string."""

    def test_sentinel_value_is_stable(self):
        # Locks the literal value — changing it is a contract change,
        # not a refactor, since Phase 3 will hardcode this string.
        assert PAGE_TARGET_ID == "page"

    def test_sentinel_is_accepted_as_a_valid_targetid(self):
        resp = ActionResponse.model_validate(
            {"action": "scroll", "targetId": PAGE_TARGET_ID, "value": None}
        )
        assert resp.targetId == PAGE_TARGET_ID

        resp2 = ActionResponse.model_validate({"action": "done", "targetId": PAGE_TARGET_ID, "value": None})
        assert resp2.targetId == PAGE_TARGET_ID


class TestPiiTypeClosedEnum:
    """Orchestrator ruling #5: RedactedRegion.type is a closed enum with
    an explicit OTHER escape hatch. An unrecognized type string must
    degrade to flagged-but-unclassified, never a hard rejection and
    never silently dropped."""

    @pytest.mark.parametrize(
        "value", ["password", "cc-number", "current-password", "email", "tel", "aadhaar", "pan", "other"]
    )
    def test_known_types_accepted_as_is(self, value):
        region = RedactedRegion.model_validate(
            {"type": value, "bbox": {"x": 0, "y": 0, "w": 10, "h": 10}}
        )
        assert region.type.value == value
        assert region.rawType is None

    def test_unknown_type_degrades_to_other_not_rejected(self):
        """The whole point of this ruling: an unanticipated PII category
        (e.g. a vision-detected 'id-card' type Phase 2b might emit) must
        NOT cause the request to be hard-rejected."""
        region = RedactedRegion.model_validate(
            {"type": "id-card", "bbox": {"x": 0, "y": 0, "w": 10, "h": 10}}
        )
        assert region.type == PiiType.OTHER
        assert region.rawType == "id-card"  # original value preserved, not dropped

    def test_unknown_type_in_full_request_does_not_reject_the_request(self, load_fixture):
        data = load_fixture("valid_request_with_redaction.json")
        data["redactedRegions"][0]["type"] = "some-brand-new-pii-category"
        req = AnalyzeRequest.model_validate(data)  # must not raise
        assert req.redactedRegions[0].type == PiiType.OTHER
        assert req.redactedRegions[0].rawType == "some-brand-new-pii-category"


class TestRedactedRegionSource:
    """Retry 2 fix (orchestrator ruling #6, 2026-09-10): RedactedRegion
    gains `source: Optional[Literal["dom", "vision"]]`, optional for
    back-compat since no client sends it yet, with a deliberate inferred
    default when absent (see schemas.RedactedRegion docstring for the
    full rationale)."""

    def test_explicit_dom_source_is_respected(self):
        region = RedactedRegion.model_validate(
            {"type": "password", "bbox": {"x": 0, "y": 0, "w": 10, "h": 10}, "source": "dom"}
        )
        assert region.source == "dom"

    def test_explicit_vision_source_is_respected(self):
        region = RedactedRegion.model_validate(
            {"type": "other", "bbox": {"x": 0, "y": 0, "w": 10, "h": 10}, "source": "vision"}
        )
        assert region.source == "vision"

    def test_explicit_source_wins_even_when_agent_id_present(self):
        """The inference is a FALLBACK, not an override. A region that
        happens to carry an agentId but is explicitly marked
        source='vision' (e.g. a future client attaching agentId for some
        other bookkeeping reason) must not be silently reclassified as
        'dom'."""
        region = RedactedRegion.model_validate(
            {
                "type": "other",
                "bbox": {"x": 0, "y": 0, "w": 10, "h": 10},
                "agentId": "agent-1",
                "source": "vision",
            }
        )
        assert region.source == "vision"

    def test_absent_source_with_agent_id_infers_dom(self):
        """Back-compat default #1: Phase 2b currently sets agentId on
        every DOM-sourced region and omits it only for vision-only ones,
        so presence of agentId is today a reliable proxy for 'dom'."""
        region = RedactedRegion.model_validate(
            {"type": "password", "bbox": {"x": 0, "y": 0, "w": 10, "h": 10}, "agentId": "agent-1"}
        )
        assert region.source == "dom"

    def test_absent_source_without_agent_id_infers_vision(self):
        """Back-compat default #2: no agentId, no explicit source -> the
        region is treated as vision-sourced, which is what excludes it
        from the bbox-overlap PII-leak strategy (see test_pii_leak.py's
        regression suite for why that matters)."""
        region = RedactedRegion.model_validate(
            {"type": "other", "bbox": {"x": 0, "y": 0, "w": 10, "h": 10}}
        )
        assert region.source == "vision"

    def test_invalid_source_value_rejected(self):
        """Unlike PiiType's OTHER escape hatch, `source` is a strict
        closed Literal — there's no legitimate "unknown provenance"
        category the system should silently accept; an invalid value
        here is a client bug."""
        with pytest.raises(ValidationError):
            RedactedRegion.model_validate(
                {"type": "password", "bbox": {"x": 0, "y": 0, "w": 10, "h": 10}, "source": "camera"}
            )

    def test_existing_fixtures_without_source_field_still_parse(self, load_fixture):
        """The core back-compat requirement: a payload with no `source`
        field anywhere must not become a 422 for a client that doesn't
        send it yet."""
        data = load_fixture("valid_request_with_redaction.json")
        assert "source" not in data["redactedRegions"][0]  # fixture predates this field
        req = AnalyzeRequest.model_validate(data)  # must not raise
        assert req.redactedRegions[0].source == "dom"  # agentId="agent-1" present -> inferred dom
