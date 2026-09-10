"""Tests for the VLMClient interface: MockVLMClient determinism and the
VLM_BACKEND factory selection. OllamaVLMClient is imported (proving it's
importable / doesn't crash the module) but never executed against a real
server — no vision model is installed in this environment.
"""

from __future__ import annotations

import pytest

from schemas import PAGE_TARGET_ID, BBox, DomNode, RedactedRegion
from vlm_client import (
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
    nodes = [
        DomNode(agentId="agent-1", tag="input", type="email", text=""),
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


def test_factory_rejects_unknown_backend(monkeypatch):
    monkeypatch.setenv("VLM_BACKEND", "not-a-real-backend")
    with pytest.raises(ValueError):
        get_vlm_client()
