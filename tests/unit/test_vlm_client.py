"""Tests for the VLMClient interface: MockVLMClient determinism and the
VLM_BACKEND factory selection. OllamaVLMClient is imported (proving it's
importable / doesn't crash the module) but never executed against a real
server — no vision model is installed in this environment.
"""

from __future__ import annotations

import pytest

from schemas import PAGE_TARGET_ID, BBox, DomNode, RedactedRegion
from vlm_client import (
    DEFAULT_GEMINI_MODEL,
    ClaudeVLMClient,
    GeminiVLMClient,
    MockVLMClient,
    OllamaVLMClient,
    VLMRequestContext,
    build_prompt,
    get_vlm_client,
)


def _context(dom_snapshot, redacted_regions=None, task_goal="do the task"):
    redacted_regions = redacted_regions or []
    prompt = build_prompt(task_goal, dom_snapshot, redacted_regions)
    return VLMRequestContext(
        image_b64="dGVzdA==",
        dom_snapshot=dom_snapshot,
        redacted_regions=redacted_regions,
        task_goal=task_goal,
        prompt=prompt,
    )


def test_mock_client_done_on_empty_dom():
    client = MockVLMClient()
    result = client.analyze(_context([]))
    assert result == {"action": "done", "targetId": PAGE_TARGET_ID, "value": None}


def test_mock_client_types_into_first_typeable_non_redacted_node():
    """Uses type='search' deliberately, NOT 'email' — an empty email
    field is now routed to fill_profile instead (2026-09-14, ruling #7;
    see the fill_profile-specific tests below). 'search' stays in the
    ordinary typeable set but is never profile-shaped, so this still
    exercises the original generic-typing fallback path unchanged."""
    nodes = [
        DomNode(agentId="agent-1", tag="input", type="search", text=""),
        DomNode(agentId="agent-2", tag="button", type="submit", text="Go"),
    ]
    client = MockVLMClient()
    result = client.analyze(_context(nodes))
    assert result["action"] == "type"
    assert result["targetId"] == "agent-1"
    assert result["value"] == MockVLMClient.PLACEHOLDER_VALUE


def test_mock_client_skips_redacted_or_sensitive_typeable_nodes():
    """The mock must never emit a 'type' targeting a redacted/sensitive
    node with a guessed value — it should fall through to the next
    candidate or click instead."""
    nodes = [
        DomNode(agentId="agent-1", tag="input", type="password", text=None, sensitive=True),
        DomNode(agentId="agent-2", tag="button", type="submit", text="Go"),
    ]
    regions = [RedactedRegion(type="password", bbox=BBox(x=0, y=0, w=10, h=10), agentId="agent-1")]
    client = MockVLMClient()
    result = client.analyze(_context(nodes, regions))
    assert result["targetId"] != "agent-1"


def test_mock_client_never_clicks_a_redacted_node_as_fallback():
    """Regression test: the click-fallback branch must skip
    redacted/sensitive nodes too, not just the type-selection branch."""
    nodes = [
        DomNode(agentId="agent-1", tag="input", type="password", text=None, sensitive=True),
        DomNode(agentId="agent-2", tag="div", type=None, text="decorative"),
    ]
    regions = [RedactedRegion(type="password", bbox=BBox(x=0, y=0, w=10, h=10), agentId="agent-1")]
    client = MockVLMClient()
    result = client.analyze(_context(nodes, regions))
    assert result["targetId"] != "agent-1"
    assert result["targetId"] == "agent-2"


def test_mock_client_done_when_every_node_is_redacted_or_sensitive():
    nodes = [DomNode(agentId="agent-1", tag="input", type="password", text=None, sensitive=True)]
    regions = [RedactedRegion(type="password", bbox=BBox(x=0, y=0, w=10, h=10), agentId="agent-1")]
    client = MockVLMClient()
    result = client.analyze(_context(nodes, regions))
    assert result == {"action": "done", "targetId": PAGE_TARGET_ID, "value": None}


def test_mock_client_clicks_when_no_typeable_node():
    nodes = [DomNode(agentId="agent-1", tag="button", type="submit", text="Go")]
    client = MockVLMClient()
    result = client.analyze(_context(nodes))
    assert result == {"action": "click", "targetId": "agent-1", "value": None}


# ---------------------------------------------------------------------------
# fill_profile emission (2026-09-14, ruling #7): "the model says which
# category a field wants -> the extension fills it from local storage."
# MockVLMClient emits this deterministically so the fill_profile contract
# is exercisable end-to-end with no API key — every demo/CI path, and the
# extension side's own testing.
# ---------------------------------------------------------------------------


def test_mock_client_emits_fill_profile_for_empty_email_field():
    nodes = [
        DomNode(agentId="agent-1", tag="input", type="email", text=""),
        DomNode(agentId="agent-2", tag="button", type="submit", text="Go"),
    ]
    client = MockVLMClient()
    result = client.analyze(_context(nodes))
    assert result == {
        "action": "fill_profile",
        "targetId": "agent-1",
        "value": None,
        "profileField": "email",
    }


def test_mock_client_emits_fill_profile_for_empty_tel_field():
    nodes = [DomNode(agentId="agent-1", tag="input", type="tel", text=None)]
    client = MockVLMClient()
    result = client.analyze(_context(nodes))
    assert result == {
        "action": "fill_profile",
        "targetId": "agent-1",
        "value": None,
        "profileField": "phone",
    }


def test_mock_client_emits_fill_profile_for_name_ish_placeholder_label():
    """An empty text input whose only visible content is a 'Full Name'-
    shaped placeholder is treated as profile-shaped even though its
    `type` is the generic 'text', per the mock's structural label check."""
    nodes = [DomNode(agentId="agent-1", tag="input", type="text", text="Full Name")]
    client = MockVLMClient()
    result = client.analyze(_context(nodes))
    assert result == {
        "action": "fill_profile",
        "targetId": "agent-1",
        "value": None,
        "profileField": "full_name",
    }


def test_mock_client_does_not_treat_username_label_as_full_name():
    """'Username' contains the substring 'name' but is NOT the user's
    full name — the mock's name-ish check must exclude it explicitly,
    not fire on a naive substring match. Falls through to the ordinary
    typeable branch instead."""
    nodes = [DomNode(agentId="agent-1", tag="input", type="text", text="Username")]
    client = MockVLMClient()
    result = client.analyze(_context(nodes))
    assert result["action"] == "type"
    assert result["targetId"] == "agent-1"


def test_mock_client_fill_profile_value_is_always_null():
    """THE non-negotiable part of the contract, asserted directly: the
    mock must never put anything but None in `value` for fill_profile,
    regardless of which profile-shaped node triggered it."""
    for node in [
        DomNode(agentId="agent-1", tag="input", type="email", text=""),
        DomNode(agentId="agent-1", tag="input", type="tel", text=""),
        DomNode(agentId="agent-1", tag="input", type="text", text="Your Name"),
    ]:
        result = MockVLMClient().analyze(_context([node]))
        assert result["action"] == "fill_profile"
        assert result["value"] is None


def test_mock_client_does_not_emit_fill_profile_for_already_filled_email_field():
    """Only an EMPTY profile-shaped field routes to fill_profile — a
    field that already carries a value isn't a fill target, it falls
    through to the ordinary typeable branch (unchanged pre-existing
    behavior for a non-empty node)."""
    nodes = [DomNode(agentId="agent-1", tag="input", type="email", text="already-has-a-value")]
    client = MockVLMClient()
    result = client.analyze(_context(nodes))
    assert result["action"] == "type"
    assert result["targetId"] == "agent-1"


def test_mock_client_skips_redacted_profile_shaped_node():
    """The fill_profile branch must respect the same redacted/sensitive
    exclusion as every other branch — a redacted email field must never
    become a fill_profile target either."""
    nodes = [
        DomNode(agentId="agent-1", tag="input", type="email", text="", sensitive=True),
        DomNode(agentId="agent-2", tag="input", type="tel", text=""),
    ]
    regions = [RedactedRegion(type="email", bbox=BBox(x=0, y=0, w=10, h=10), agentId="agent-1")]
    client = MockVLMClient()
    result = client.analyze(_context(nodes, regions))
    assert result["targetId"] != "agent-1"
    assert result == {
        "action": "fill_profile",
        "targetId": "agent-2",
        "value": None,
        "profileField": "phone",
    }


def test_mock_client_is_deterministic():
    nodes = [
        DomNode(agentId="agent-1", tag="input", type="text", text=""),
        DomNode(agentId="agent-2", tag="button", type="submit", text="Go"),
    ]
    client = MockVLMClient()
    r1 = client.analyze(_context(nodes))
    r2 = client.analyze(_context(nodes))
    assert r1 == r2


def test_factory_defaults_to_mock(monkeypatch):
    monkeypatch.delenv("VLM_BACKEND", raising=False)
    client = get_vlm_client()
    assert isinstance(client, MockVLMClient)


def test_factory_selects_mock_explicitly(monkeypatch):
    monkeypatch.setenv("VLM_BACKEND", "mock")
    assert isinstance(get_vlm_client(), MockVLMClient)


def test_factory_selects_ollama_without_calling_it(monkeypatch):
    """OllamaVLMClient must be constructible (imports cleanly, no network
    call on __init__) even though it is never executed in this suite."""
    monkeypatch.setenv("VLM_BACKEND", "ollama")
    client = get_vlm_client()
    assert isinstance(client, OllamaVLMClient)
    assert client.model == "qwen2.5vl:7b"


def test_factory_selects_claude_without_calling_it(monkeypatch):
    """ClaudeVLMClient must be constructible (imports cleanly, no network
    call and no credential resolution on __init__) even though it is
    never executed against a live API in this suite — mirrors
    test_factory_selects_ollama_without_calling_it above. Deliberately
    does NOT set ANTHROPIC_API_KEY: constructing the client must not
    require it (only analyze() does, and only at call time)."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("VLM_BACKEND", "claude")
    client = get_vlm_client()
    assert isinstance(client, ClaudeVLMClient)
    assert client.model == "claude-opus-4-8"


def test_factory_selects_gemini_without_calling_it(monkeypatch):
    """GeminiVLMClient must be constructible (imports cleanly, no network
    call and no credential resolution on __init__) even though it is
    never executed against a live API in this suite — mirrors
    test_factory_selects_claude_without_calling_it above. Deliberately
    does NOT set GEMINI_API_KEY/GOOGLE_API_KEY: constructing the client
    must not require it (only analyze() does, and only at call time)."""
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.setenv("VLM_BACKEND", "gemini")
    client = get_vlm_client()
    assert isinstance(client, GeminiVLMClient)
    # Assert against the constant, not a literal — the default is a live-
    # verified model id that will need updating again as models retire.
    assert client.model == DEFAULT_GEMINI_MODEL


def test_factory_rejects_unknown_backend(monkeypatch):
    monkeypatch.setenv("VLM_BACKEND", "not-a-real-backend")
    with pytest.raises(ValueError):
        get_vlm_client()
