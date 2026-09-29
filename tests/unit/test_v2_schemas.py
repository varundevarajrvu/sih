"""Unit tests for server/schemas_v2.py and server/pii_regex_v2.py --
AnalyzeRequestV2/ModelActionV2/ActionResponseV2 shape, find_v2_pii_leaks(),
and PAGE_TARGET_ID_V2. Pure model/function tests, no HTTP/TestClient (see
test_v2_analyze.py for the endpoint-level tests).
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from pii_regex_v2 import contains_unmasked_pii
from schemas import PAGE_TARGET_ID
from schemas_v2 import (
    PAGE_TARGET_ID_V2,
    SCHEMA_LITERAL_V2,
    ActionResponseV2,
    AnalyzeRequestV2,
    ModelActionV2,
    ServerVerdict,
    find_v2_pii_leaks,
)


def _base_request_dict(**overrides):
    data = {
        "schema": SCHEMA_LITERAL_V2,
        "mode": "semantic",
        "revision": "rev-1",
        "taskGoal": "do the safe thing",
        "viewport": {"w": 1280, "h": 720},
        "elements": [],
        "regions": [],
        "history": [],
    }
    data.update(overrides)
    return data


# ---------------------------------------------------------------------------
# PAGE_TARGET_ID_V2 -- corrected 2026-09-24 to reuse v1's lowercase "page"
# (ARCHITECTURE.md's earlier "PAGE" was a documentation typo).
# ---------------------------------------------------------------------------


def test_page_target_id_v2_matches_v1_lowercase():
    assert PAGE_TARGET_ID_V2 == "page"
    assert PAGE_TARGET_ID_V2 == PAGE_TARGET_ID


# ---------------------------------------------------------------------------
# AnalyzeRequestV2 structural shape
# ---------------------------------------------------------------------------


def test_valid_semantic_request_parses():
    req = AnalyzeRequestV2.model_validate(_base_request_dict())
    assert req.schema_ == SCHEMA_LITERAL_V2
    assert req.mode.value == "semantic"
    assert req.image is None


def test_valid_image_request_parses():
    req = AnalyzeRequestV2.model_validate(
        _base_request_dict(mode="image", image="aGVsbG8=")
    )
    assert req.mode.value == "image"
    assert req.image == "aGVsbG8="


def test_unknown_mode_rejected():
    with pytest.raises(ValidationError):
        AnalyzeRequestV2.model_validate(_base_request_dict(mode="visual"))


def test_extra_field_rejected():
    with pytest.raises(ValidationError):
        AnalyzeRequestV2.model_validate(_base_request_dict(bogus="nope"))


def test_history_over_ten_entries_rejected():
    history = [
        {"action": {"action": "scroll", "targetId": PAGE_TARGET_ID_V2, "value": None}, "outcome": "ok"}
        for _ in range(11)
    ]
    with pytest.raises(ValidationError):
        AnalyzeRequestV2.model_validate(_base_request_dict(history=history))


def test_history_exactly_ten_entries_accepted():
    history = [
        {"action": {"action": "scroll", "targetId": PAGE_TARGET_ID_V2, "value": None}, "outcome": "ok"}
        for _ in range(10)
    ]
    req = AnalyzeRequestV2.model_validate(_base_request_dict(history=history))
    assert len(req.history) == 10


def test_history_outcome_pattern_rejects_arbitrary_string():
    history = [
        {"action": {"action": "scroll", "targetId": PAGE_TARGET_ID_V2, "value": None}, "outcome": "whatever"}
    ]
    with pytest.raises(ValidationError):
        AnalyzeRequestV2.model_validate(_base_request_dict(history=history))


def test_history_outcome_rejected_code_pattern_accepted():
    history = [
        {
            "action": {"action": "scroll", "targetId": PAGE_TARGET_ID_V2, "value": None},
            "outcome": "rejected:UNKNOWN_TARGET",
        }
    ]
    req = AnalyzeRequestV2.model_validate(_base_request_dict(history=history))
    assert req.history[0].outcome == "rejected:UNKNOWN_TARGET"


def test_element_label_over_120_chars_rejected():
    elements = [
        {
            "agentId": "agent-1",
            "tag": "input",
            "label": "x" * 121,
            "sensitive": False,
        }
    ]
    with pytest.raises(ValidationError):
        AnalyzeRequestV2.model_validate(_base_request_dict(elements=elements))


def test_element_label_none_and_no_tier_allowed():
    elements = [{"agentId": "agent-1", "tag": "div", "sensitive": True}]
    req = AnalyzeRequestV2.model_validate(_base_request_dict(elements=elements))
    assert req.elements[0].label is None
    assert req.elements[0].tier is None


def test_region_requires_source():
    regions = [{"kind": "face", "bbox": {"x": 0, "y": 0, "w": 1, "h": 1}}]
    with pytest.raises(ValidationError):
        AnalyzeRequestV2.model_validate(_base_request_dict(regions=regions))


def test_region_unknown_kind_rejected():
    regions = [{"kind": "photo", "bbox": {"x": 0, "y": 0, "w": 1, "h": 1}, "source": "dom"}]
    with pytest.raises(ValidationError):
        AnalyzeRequestV2.model_validate(_base_request_dict(regions=regions))


# ---------------------------------------------------------------------------
# find_v2_pii_leaks -- server-side re-check (brief item 2)
# ---------------------------------------------------------------------------


def test_no_leak_on_clean_payload():
    req = AnalyzeRequestV2.model_validate(_base_request_dict())
    assert find_v2_pii_leaks(req) == []


def test_leak_in_task_goal():
    req = AnalyzeRequestV2.model_validate(
        _base_request_dict(taskGoal="email me at john@example.com please")
    )
    violations = find_v2_pii_leaks(req)
    assert len(violations) == 1
    assert "taskGoal" in violations[0]
    assert "john@example.com" not in violations[0]


def test_leak_in_element_label():
    elements = [{"agentId": "agent-7", "tag": "input", "label": "call 9876543210", "sensitive": False}]
    req = AnalyzeRequestV2.model_validate(_base_request_dict(elements=elements))
    violations = find_v2_pii_leaks(req)
    assert len(violations) == 1
    assert "agent-7" in violations[0]
    assert "9876543210" not in violations[0]


def test_leak_in_history_value():
    history = [
        {
            "action": {"action": "type", "targetId": "agent-1", "value": "aadhaar 1234 5678 9012"},
            "outcome": "ok",
        }
    ]
    req = AnalyzeRequestV2.model_validate(_base_request_dict(history=history))
    violations = find_v2_pii_leaks(req)
    assert len(violations) == 1
    assert "history[0]" in violations[0]
    assert "1234 5678 9012" not in violations[0]


def test_token_wrapped_value_does_not_leak():
    req = AnalyzeRequestV2.model_validate(
        _base_request_dict(taskGoal="use EMAIL#1 and PERSONNAME#2 to fill the form")
    )
    assert find_v2_pii_leaks(req) == []


def test_contains_unmasked_pii_directly():
    assert contains_unmasked_pii("reach me at test@example.com") is True
    assert contains_unmasked_pii("EMAIL#1 only") is False
    assert contains_unmasked_pii(None) is False
    assert contains_unmasked_pii("") is False


# ---------------------------------------------------------------------------
# C1 update (orchestrator, 2026-09-24): PASSPORT added to PiiLabel, ported
# from warden/redactor.py's "passport" pass.
# ---------------------------------------------------------------------------


def test_raw_passport_in_label_leaks():
    elements = [{"agentId": "agent-5", "tag": "input", "label": "passport M1234567", "sensitive": False}]
    req = AnalyzeRequestV2.model_validate(_base_request_dict(elements=elements))
    violations = find_v2_pii_leaks(req)
    assert len(violations) == 1
    assert "M1234567" not in violations[0]


def test_passport_token_does_not_leak():
    req = AnalyzeRequestV2.model_validate(
        _base_request_dict(taskGoal="use PASSPORT#1 to verify identity")
    )
    assert find_v2_pii_leaks(req) == []


# ---------------------------------------------------------------------------
# Token + country-code-prefix interaction (orchestrator, 2026-09-24): the
# client puts the phone value INSIDE the token and leaves the country-code
# prefix OUTSIDE it.
# ---------------------------------------------------------------------------


def test_phone_token_with_country_code_prefix_is_clean():
    req = AnalyzeRequestV2.model_validate(
        _base_request_dict(taskGoal="call the user at +91 PHONE#1 tomorrow")
    )
    assert find_v2_pii_leaks(req) == []


def test_raw_phone_with_country_code_prefix_still_leaks():
    req = AnalyzeRequestV2.model_validate(
        _base_request_dict(taskGoal="call the user at +91 98450 12345 tomorrow")
    )
    violations = find_v2_pii_leaks(req)
    assert len(violations) == 1
    assert "98450" not in violations[0]


# ---------------------------------------------------------------------------
# ModelActionV2 -- v2's DELIBERATE divergence from v1: value-on-fill_profile
# now PARSES (deferred to main.py's serverVerdict computation), unlike v1's
# hard ModelSuppliedProfileValue reject. See schemas_v2 module docstring
# point 3.
# ---------------------------------------------------------------------------


def test_model_action_click_valid():
    action = ModelActionV2.model_validate({"action": "click", "targetId": "agent-1"})
    assert action.value is None


def test_model_action_fill_profile_requires_profile_field():
    with pytest.raises(ValidationError):
        ModelActionV2.model_validate({"action": "fill_profile", "targetId": "agent-1"})


def test_model_action_fill_profile_with_value_parses_ok_deferred_to_verdict():
    """The RULE (never trust a model-supplied profile value) is unchanged
    from v1; only the enforcement point moves. See main.py's
    compute_server_verdict / test_v2_analyze.py for where this actually
    gets rejected."""
    action = ModelActionV2.model_validate(
        {"action": "fill_profile", "targetId": "agent-1", "profileField": "email", "value": "leaked"}
    )
    assert action.value == "leaked"


def test_model_action_press_key_requires_key():
    with pytest.raises(ValidationError):
        ModelActionV2.model_validate({"action": "press_key", "targetId": "agent-1"})


def test_model_action_key_forbidden_on_non_press_key():
    with pytest.raises(ValidationError):
        ModelActionV2.model_validate({"action": "click", "targetId": "agent-1", "key": "Enter"})


def test_model_action_need_visual_valid():
    action = ModelActionV2.model_validate({"action": "need_visual", "targetId": PAGE_TARGET_ID_V2})
    assert action.action.value == "need_visual"


# ---------------------------------------------------------------------------
# ActionResponseV2 -- has NO parse path for serverVerdict from a raw model
# dict; only constructible with an explicit serverVerdict kwarg.
# ---------------------------------------------------------------------------


def test_action_response_v2_requires_server_verdict():
    resp = ActionResponseV2(
        action="click",
        targetId="agent-1",
        value=None,
        revision="rev-1",
        serverVerdict=ServerVerdict.ACCEPT,
        reason="ok",
    )
    assert resp.serverVerdict == ServerVerdict.ACCEPT

    with pytest.raises(ValidationError):
        ActionResponseV2(action="click", targetId="agent-1", value=None, revision="rev-1")
