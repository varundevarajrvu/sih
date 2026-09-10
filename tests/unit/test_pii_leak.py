"""Direct unit tests of find_pii_leaks() — the pure function behind the
Section 5 server-side defense-in-depth check. Fixture-in (constructed
inline as Pydantic models), list-out; no FastAPI, no HTTP.
"""

from __future__ import annotations

from schemas import BBox, DomNode, RedactedRegion, find_pii_leaks


def _node(agent_id, text=None, sensitive=False, bbox=None, type_="password"):
    return DomNode(agentId=agent_id, tag="input", type=type_, text=text, sensitive=sensitive, bbox=bbox)


def _region(agent_id=None, bbox=None, type_="password", source=None):
    return RedactedRegion(type=type_, bbox=bbox or BBox(x=0, y=0, w=100, h=30), agentId=agent_id, source=source)


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


def test_leak_via_bbox_overlap_for_dom_sourced_region_without_agent_id():
    """A DOM-sourced redacted region (source='dom') that lost/never had
    an agentId but geometrically sits on top of a DOM node with raw text
    must still be caught — strategy 2 stays strict for genuine DOM
    provenance (orchestrator ruling #6, retry 2)."""
    node_bbox = BBox(x=10, y=10, w=100, h=20)
    region_bbox = BBox(x=0, y=0, w=200, h=200)  # fully covers node_bbox
    nodes = [_node("agent-1", text="secret-value", sensitive=False, bbox=node_bbox)]
    regions = [_region(agent_id=None, bbox=region_bbox, source="dom")]
    leaks = find_pii_leaks(nodes, regions)
    assert len(leaks) == 1
    assert "agent-1" in leaks[0]


def test_no_leak_when_bbox_barely_overlaps_even_for_dom_source():
    node_bbox = BBox(x=100, y=100, w=50, h=50)
    region_bbox = BBox(x=140, y=140, w=50, h=50)  # small corner overlap only
    nodes = [_node("agent-1", text="secret", bbox=node_bbox)]
    regions = [_region(agent_id=None, bbox=region_bbox, source="dom")]
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
# RETRY 2 REGRESSION SUITE: vision-sourced bbox overlap is not a PII signal.
#
# Reported failure, live Phase 4 browser run: a vision-detected object box
# (no agentId, type="other" — e.g. a `book`/`laptop`/`person` detection)
# overlapped a "Continue" button's bbox by >50%. Strategy 2 flagged the
# button's raw text "Continue" as a PII leak, halting the agent loop. Root
# cause: after ruling #2 (Phase 2b sets agentId on every DOM-sourced
# region, omits it only for vision-only ones), "redactedRegions entry with
# no matching agentId" became EXACTLY EQUIVALENT to "this came from the
# vision model" — so strategy 2 only ever ran on regions where spatial
# overlap carries zero information about DOM-node sensitivity.
# ---------------------------------------------------------------------------


def _continue_button_node():
    """The exact node shape from the reported failure: a benign button
    with ordinary UI text, not PII by any definition."""
    return DomNode(
        agentId="agent-5",
        tag="button",
        type="submit",
        text="Continue",
        sensitive=False,
        bbox=BBox(x=100, y=200, w=80, h=30),
    )


def _overlapping_vision_box():
    """A vision detection box geometrically covering the button — e.g. a
    `book`/`laptop`/`person` COCO detection rendered nearby, merged in by
    Phase 2b with type='other' and (per ruling #2) no agentId."""
    return BBox(x=90, y=190, w=200, h=200)


def test_vision_sourced_region_overlapping_benign_button_is_not_flagged():
    """THE regression test for the reported bug. No `source` sent (the
    real-world case today — no client sends it yet) and no agentId (the
    real-world vision-only case) -> inferred source='vision' -> strategy 2
    must skip it. A "Continue" button is not PII."""
    nodes = [_continue_button_node()]
    regions = [_region(agent_id=None, bbox=_overlapping_vision_box(), type_="other")]
    assert find_pii_leaks(nodes, regions) == []


def test_vision_sourced_region_explicit_source_overlapping_benign_button_is_not_flagged():
    """Same geometry, but with `source="vision"` sent explicitly (the
    future state once Phase 2b populates it) rather than relying on
    inference — confirms the fix works on the explicit signal too, not
    only the inferred one."""
    nodes = [_continue_button_node()]
    regions = [
        _region(agent_id=None, bbox=_overlapping_vision_box(), type_="other", source="vision")
    ]
    assert find_pii_leaks(nodes, regions) == []


def test_dom_sourced_region_same_geometry_still_flags_raw_text():
    """Contrast test proving the fix discriminates on `source`, not on
    content or geometry: the IDENTICAL overlap, but the region is
    DOM-sourced (source='dom') -> strategy 2 must still fire. A
    DOM-sourced region overlapping a raw-text node remains a genuine
    leak candidate."""
    nodes = [_continue_button_node()]
    regions = [
        _region(agent_id=None, bbox=_overlapping_vision_box(), type_="other", source="dom")
    ]
    leaks = find_pii_leaks(nodes, regions)
    assert len(leaks) == 1
    assert "agent-5" in leaks[0]


def test_sensitive_flag_still_flags_regardless_of_unrelated_vision_regions():
    """Strategy 3 (self-declared sensitive) must keep firing unchanged by
    this fix, even in the presence of vision-sourced regions that don't
    correlate with the sensitive node at all."""
    nodes = [
        _continue_button_node(),  # benign, must stay unflagged
        _node("agent-1", text="raw-pii-value", sensitive=True),  # must still flag
    ]
    regions = [_region(agent_id=None, bbox=_overlapping_vision_box(), type_="other")]  # vision, unrelated
    leaks = find_pii_leaks(nodes, regions)
    assert len(leaks) == 1
    assert "agent-1" in leaks[0]
    assert "agent-5" not in " ".join(leaks)


# ---------------------------------------------------------------------------
# Back-compat: no `source` field at all (today's real-world payloads).
# ---------------------------------------------------------------------------


def test_backcompat_no_source_with_agent_id_infers_dom():
    region = _region(agent_id="agent-1")  # source not passed -> None on the wire
    assert region.source == "dom"


def test_backcompat_no_source_without_agent_id_infers_vision():
    region = _region(agent_id=None)  # source not passed -> None on the wire
    assert region.source == "vision"


def test_backcompat_inferred_dom_source_still_supports_bbox_fallback():
    """An older client that sends agentId but no `source`: inferred
    source='dom' should still let strategy 2 catch a DIFFERENT node whose
    bbox overlaps, even though the region's own agentId doesn't match
    anything (e.g. it references an element the client didn't include in
    this snapshot)."""
    node_bbox = BBox(x=10, y=10, w=100, h=20)
    region_bbox = BBox(x=0, y=0, w=200, h=200)
    nodes = [_node("agent-2", text="raw-value", sensitive=False, bbox=node_bbox)]
    # agentId references a node NOT present in this snapshot; source is
    # inferred 'dom' purely from agentId being present on the region.
    regions = [_region(agent_id="agent-nonexistent", bbox=region_bbox)]
    leaks = find_pii_leaks(nodes, regions)
    assert len(leaks) == 1
    assert "agent-2" in leaks[0]


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
    regions = [_region(agent_id=None, bbox=region_bbox, source="dom")]
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
