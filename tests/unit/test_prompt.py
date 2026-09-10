"""Tests for build_prompt() — THE requirement the whole problem statement
hinges on (CLAUDE.md Section 4/5): the prompt sent to the VLM must
explicitly tell it that redactedRegions are intentionally hidden for
privacy, that it must not guess/speculate about their contents, and that
it should use DOM snapshot type/role info for those areas instead.

Every redacted region must be a literal, checkable presence in the
generated prompt text — not just "mentioned in spirit".
"""

from __future__ import annotations

from schemas import PAGE_TARGET_ID, BBox, DomNode, RedactedRegion
from vlm_client import build_prompt


def _sample_dom_snapshot():
    return [
        DomNode(
            agentId="agent-1",
            tag="input",
            role="textbox",
            type="password",
            text=None,
            bbox=BBox(x=10, y=100, w=200, h=30),
            sensitive=True,
        ),
        DomNode(
            agentId="agent-2",
            tag="button",
            role="button",
            type="submit",
            text="Log in",
            bbox=BBox(x=10, y=140, w=80, h=30),
            sensitive=False,
        ),
    ]


def _sample_redacted_regions():
    return [
        RedactedRegion(type="password", bbox=BBox(x=10, y=100, w=200, h=30), agentId="agent-1"),
    ]


def test_prompt_contains_privacy_notice_language():
    prompt = build_prompt("Log in", _sample_dom_snapshot(), _sample_redacted_regions())
    lower = prompt.lower()
    assert "intentionally" in lower
    assert "privacy" in lower
    assert "must not guess" in lower or "do not guess" in lower or "not guess" in lower
    assert "speculate" in lower


def test_prompt_tells_model_to_use_dom_snapshot_for_redacted_areas():
    prompt = build_prompt("Log in", _sample_dom_snapshot(), _sample_redacted_regions())
    assert "dom snapshot" in prompt.lower() or "DOM SNAPSHOT" in prompt
    assert "type" in prompt.lower()


def test_every_redacted_region_appears_in_prompt_text():
    """The load-bearing assertion: each redactedRegions entry must be
    individually traceable in the generated prompt, not just summarized.

    Note: region.type is a PiiType enum (str, Enum). Verified against
    this project's Python 3.14 interpreter that f"{enum_member}" does
    NOT give the plain value (it gives "PiiType.PASSWORD", not
    "password") — so both build_prompt() and this test explicitly use
    `.value` to avoid a silent mismatch between what's asserted and
    what's actually sent to the VLM.
    """
    regions = [
        RedactedRegion(type="password", bbox=BBox(x=10, y=100, w=200, h=30), agentId="agent-1"),
        RedactedRegion(type="aadhaar", bbox=BBox(x=50, y=300, w=180, h=25), agentId=None),
        RedactedRegion(type="email", bbox=BBox(x=5, y=5, w=150, h=20), agentId="agent-9"),
    ]
    dom_snapshot = _sample_dom_snapshot()
    prompt = build_prompt("Fill out the form", dom_snapshot, regions)

    for region in regions:
        assert f"type={region.type.value}" in prompt, f"region type {region.type.value!r} missing from prompt"
        bbox_str = f"x={region.bbox.x}, y={region.bbox.y}, w={region.bbox.w}, h={region.bbox.h}"
        assert bbox_str in prompt, f"region bbox {bbox_str!r} missing from prompt"
        if region.agentId:
            assert f"agentId={region.agentId}" in prompt, f"region agentId {region.agentId!r} missing"


def test_unknown_pii_type_degraded_to_other_still_appears_with_raw_type_in_prompt():
    """Orchestrator ruling #5: an unrecognized redactedRegions.type
    degrades to OTHER but must not lose information the VLM could use —
    the original rawType is surfaced in the prompt alongside "other"."""
    region = RedactedRegion(type="id-card", bbox=BBox(x=0, y=0, w=50, h=50), agentId="agent-5")
    assert region.type.value == "other"
    assert region.rawType == "id-card"

    prompt = build_prompt("Scan the ID", [], [region])
    assert "type=other" in prompt
    assert "rawType=id-card" in prompt


def test_page_target_id_sentinel_documented_in_prompt():
    """The prompt must tell the VLM which literal string to use for
    targetId when an action (scroll/done) doesn't target a specific
    element — otherwise it will invent its own sentinel."""
    prompt = build_prompt("Scroll down", [], [])
    assert PAGE_TARGET_ID in prompt


def test_no_redacted_regions_still_produces_valid_prompt_without_false_privacy_claim():
    prompt = build_prompt("Click submit", _sample_dom_snapshot(), [])
    assert "No regions were redacted" in prompt
    # Must not claim redaction happened when it didn't.
    assert "REDACTED REGIONS" not in prompt


def test_prompt_instructs_json_only_response_matching_action_schema():
    prompt = build_prompt("Log in", _sample_dom_snapshot(), _sample_redacted_regions())
    assert "click" in prompt and "type" in prompt and "scroll" in prompt and "done" in prompt
    assert "targetId" in prompt
    assert "JSON" in prompt


def test_task_goal_included_verbatim():
    goal = "Fill in the shipping address and submit the order"
    prompt = build_prompt(goal, [], [])
    assert goal in prompt
