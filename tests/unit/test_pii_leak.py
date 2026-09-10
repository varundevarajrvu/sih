"""Direct unit tests of find_pii_leaks() — the pure function behind the
Section 5 server-side defense-in-depth check. Fixture-in (constructed
inline as Pydantic models), list-out; no FastAPI, no HTTP.
"""

from __future__ import annotations

from schemas import BBox, DomNode, RedactedRegion, find_pii_leaks


def _node(agent_id, text=None, sensitive=False, bbox=None, type_="password"):
    return DomNode(agentId=agent_id, tag="input", type=type_, text=text, sensitive=sensitive, bbox=bbox)


def _region(agent_id=None, bbox=None, type_="password"):
    return RedactedRegion(type=type_, bbox=bbox or BBox(x=0, y=0, w=100, h=30), agentId=agent_id)


def test_no_leak_when_text_stripped():
    nodes = [_node("agent-1", text=None, sensitive=True)]
    regions = [_region(agent_id="agent-1")]
    assert find_pii_leaks(nodes, regions) == []


def test_no_leak_when_no_redacted_regions_and_not_sensitive():
    nodes = [_node("agent-1", text="hello", sensitive=False, type_="text")]
    assert find_pii_leaks(nodes, []) == []


def test_leak_via_agent_id_correlation():
    nodes = [_node("agent-1", text="hunter2", sensitive=True)]
    regions = [_region(agent_id="agent-1")]
    leaks = find_pii_leaks(nodes, regions)
    assert len(leaks) >= 1
    assert "agent-1" in leaks[0]


def test_leak_via_bbox_overlap_without_agent_id():
    """A vision-only redacted region (no agentId) that geometrically sits
    on top of a DOM node with raw text should still be caught."""
    node_bbox = BBox(x=10, y=10, w=100, h=20)
    region_bbox = BBox(x=0, y=0, w=200, h=200)  # fully covers node_bbox
    nodes = [_node("agent-1", text="secret-value", sensitive=False, bbox=node_bbox)]
    regions = [_region(agent_id=None, bbox=region_bbox)]
    leaks = find_pii_leaks(nodes, regions)
    assert len(leaks) == 1
    assert "agent-1" in leaks[0]


def test_no_leak_when_bbox_barely_overlaps():
    node_bbox = BBox(x=100, y=100, w=50, h=50)
    region_bbox = BBox(x=140, y=140, w=50, h=50)  # small corner overlap only
    nodes = [_node("agent-1", text="secret", bbox=node_bbox)]
    regions = [_region(agent_id=None, bbox=region_bbox)]
    assert find_pii_leaks(nodes, regions) == []


def test_leak_via_self_declared_sensitive_flag_alone():
    """Even with zero redactedRegions, a node the client itself marked
    sensitive=true must not carry raw text."""
    nodes = [_node("agent-1", text="raw-pii", sensitive=True)]
    leaks = find_pii_leaks(nodes, [])
    assert len(leaks) == 1
    assert "agent-1" in leaks[0]


def test_node_not_flagged_twice_across_strategies():
    """A node caught by agentId correlation should not also produce a
    duplicate violation from the sensitive-flag strategy."""
    nodes = [_node("agent-1", text="hunter2", sensitive=True)]
    regions = [_region(agent_id="agent-1")]
    leaks = find_pii_leaks(nodes, regions)
    assert len(leaks) == 1


def test_multiple_nodes_multiple_leaks():
    nodes = [
        _node("agent-1", text="pw-value", sensitive=True),
        _node("agent-2", text=None, sensitive=True),  # properly stripped, no leak
        _node("agent-3", text="12345678", sensitive=False, type_="text"),
    ]
    regions = [
        _region(agent_id="agent-1"),
        _region(agent_id="agent-3", type_="aadhaar"),
    ]
    leaks = find_pii_leaks(nodes, regions)
    assert len(leaks) == 2
    joined = " ".join(leaks)
    assert "agent-1" in joined
    assert "agent-3" in joined
    assert "agent-2" not in joined


# ---------------------------------------------------------------------------
# Security regression: the rejection message must never leak the value it
# is rejecting. Added after the orchestrator caught that the original
# implementation leaked PII via Pydantic's default error serialization —
# find_pii_leaks() itself was never the leak source, but this test locks
# that guarantee down explicitly, at the pure-function level, independent
# of anything FastAPI does with the returned strings.
# ---------------------------------------------------------------------------

SENTINEL = "SENTINEL-PII-VALUE-7f3c9a2b"


def test_find_pii_leaks_message_never_contains_the_leaked_value_agent_id_strategy():
    nodes = [_node("agent-1", text=SENTINEL, sensitive=True)]
    regions = [_region(agent_id="agent-1")]
    leaks = find_pii_leaks(nodes, regions)
    assert len(leaks) == 1
    assert SENTINEL not in leaks[0]


def test_find_pii_leaks_message_never_contains_the_leaked_value_bbox_strategy():
    node_bbox = BBox(x=10, y=10, w=100, h=20)
    region_bbox = BBox(x=0, y=0, w=200, h=200)
    nodes = [_node("agent-1", text=SENTINEL, sensitive=False, bbox=node_bbox)]
    regions = [_region(agent_id=None, bbox=region_bbox)]
    leaks = find_pii_leaks(nodes, regions)
    assert len(leaks) == 1
    assert SENTINEL not in leaks[0]


def test_find_pii_leaks_message_never_contains_the_leaked_value_sensitive_flag_strategy():
    nodes = [_node("agent-1", text=SENTINEL, sensitive=True)]
    leaks = find_pii_leaks(nodes, [])
    assert len(leaks) == 1
    assert SENTINEL not in leaks[0]


def test_find_pii_leaks_message_never_contains_any_value_across_all_violations():
    """Belt and suspenders: scan every violation string produced for a
    multi-node, multi-strategy scenario and confirm none contain any of
    the planted sentinel values."""
    sentinel_a = "SENTINEL-AAAA-1111"
    sentinel_b = "SENTINEL-BBBB-2222"
    nodes = [
        _node("agent-1", text=sentinel_a, sensitive=True),
        _node("agent-2", text=sentinel_b, sensitive=False, type_="text"),
    ]
    regions = [
        _region(agent_id="agent-1"),
        _region(agent_id="agent-2", type_="email"),
    ]
    leaks = find_pii_leaks(nodes, regions)
    assert len(leaks) == 2
    joined = " ".join(leaks)
    assert sentinel_a not in joined
    assert sentinel_b not in joined
