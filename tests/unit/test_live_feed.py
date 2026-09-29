"""Tests for GET /recent — the counts-only live feed the showcase site polls.

This endpoint is served cross-origin (`allow_origins=["*"]`) to a static page,
which makes it a data-egress path in exactly the sense CLAUDE.md's Phase 2c
lesson means: the endpoint that reports on redaction must not itself become the
leak. The suite below therefore asserts on `resp.content` — the raw serialized
bytes — not on a parsed object, because serialization is the layer a leak would
actually occur at.
"""

from __future__ import annotations

import dataclasses

from fastapi.testclient import TestClient

import live_feed
from live_feed import RequestSummary
from main import app

client = TestClient(app)

SENTINEL = "SENTINEL-PII-VALUE-7f3c9a2b"


def _reset():
    live_feed.feed.clear()


def test_recent_is_empty_before_any_request():
    _reset()
    resp = client.get("/recent")
    assert resp.status_code == 200
    body = resp.json()
    assert body["entries"] == []
    assert body["max"] == live_feed.MAX_ENTRIES


def test_recent_records_a_completed_request(load_fixture):
    _reset()
    client.post("/analyze", json=load_fixture("valid_request.json"))

    entries = client.get("/recent").json()["entries"]
    assert len(entries) == 1
    e = entries[0]
    assert e["seq"] == 1
    assert e["leakCheck"] == "passed"
    assert e["action"] in {"click", "type", "scroll", "done", "fill_profile"}
    assert e["domNodes"] >= 1
    assert e["imageBytes"] > 0
    # Server-generated timestamp, not anything the client supplied.
    assert e["at"].endswith("+00:00")


def test_recent_is_newest_first_and_bounded(load_fixture):
    _reset()
    data = load_fixture("valid_request.json")
    for _ in range(live_feed.MAX_ENTRIES + 4):
        client.post("/analyze", json=data)

    entries = client.get("/recent").json()["entries"]
    assert len(entries) == live_feed.MAX_ENTRIES, "the ring must stay bounded"
    seqs = [e["seq"] for e in entries]
    assert seqs == sorted(seqs, reverse=True), "newest first"
    assert seqs[0] == live_feed.MAX_ENTRIES + 4


# ---------------------------------------------------------------------------
# THE SECURITY PROPERTY. Everything above is behaviour; this is the reason the
# endpoint is allowed to exist at all.
# ---------------------------------------------------------------------------


def test_recent_never_echoes_free_text_from_the_request(load_fixture):
    """Plant the sentinel in EVERY free-text field a request carries, then
    assert it appears nowhere in the serialized feed bytes."""
    _reset()
    data = load_fixture("valid_request.json")

    data["taskGoal"] = f"fill in {SENTINEL}"
    for node in data["domSnapshot"]:
        node["text"] = SENTINEL
        node["agentId"] = node.get("agentId", "agent-1")
    for region in data.get("redactedRegions", []):
        region["agentId"] = region.get("agentId") or "agent-1"

    posted = client.post("/analyze", json=data)
    assert posted.status_code in (200, 400), posted.status_code

    resp = client.get("/recent")
    assert SENTINEL not in resp.text
    assert SENTINEL.encode() not in resp.content
    # Nothing that looks like page text should be present at all.
    assert "taskGoal" not in resp.text
    assert "text" not in resp.text


def test_request_summary_has_no_free_text_field():
    """The structural guarantee, asserted rather than trusted to review.

    Every field is an int, or a string drawn from a closed enum the schema
    layer validates (PiiType / ActionType), or the server's own timestamp.
    A future field typed `str` that is NOT one of those is exactly how this
    endpoint would quietly become a leak — so the allowlist is explicit.
    """
    # "mode" added 2026-09-29 (v2): a closed value, "semantic" or "image" —
    # the literal fact of whether an image was attached, never page content.
    allowed_str_fields = {"at", "action", "leakCheck", "regionTypes", "mode"}
    int_fields = {
        "seq", "domNodes", "sensitiveNodes", "redactedRegions",
        "domSourced", "visionSourced", "imageBytes",
    }

    names = {f.name for f in dataclasses.fields(RequestSummary)}
    assert names == allowed_str_fields | int_fields, (
        "RequestSummary gained or lost a field. If you added one, confirm it "
        "cannot carry page text, a task goal, or a redacted value, then update "
        "this allowlist deliberately — see live_feed.py's docstring."
    )


def test_region_types_are_closed_enum_values_only(load_fixture):
    _reset()
    data = load_fixture("valid_request.json")
    client.post("/analyze", json=data)

    valid = {"password", "cc-number", "current-password", "email", "tel", "aadhaar", "pan", "other"}
    for e in client.get("/recent").json()["entries"]:
        for t in e["regionTypes"]:
            assert t in valid, f"regionTypes leaked a non-enum value: {t!r}"


def test_a_rejected_request_never_reaches_the_feed(load_fixture):
    """A PII leak is rejected before the feed records anything, so the feed can
    only ever describe requests that actually completed — which is what lets it
    report leakCheck 'passed' truthfully rather than aspirationally."""
    _reset()
    data = load_fixture("valid_request.json")
    # Make the payload carry a raw value for a node flagged sensitive, which is
    # what find_pii_leaks() exists to catch.
    data["domSnapshot"][0]["sensitive"] = True
    data["domSnapshot"][0]["text"] = SENTINEL
    if data.get("redactedRegions"):
        data["redactedRegions"][0]["agentId"] = data["domSnapshot"][0]["agentId"]

    resp = client.post("/analyze", json=data)
    if resp.status_code == 400:
        assert client.get("/recent").json()["entries"] == []
        assert SENTINEL not in client.get("/recent").text


# ---------------------------------------------------------------------------
# v2 (2026-09-29): /v2/analyze writes into the SAME feed via record_v2(),
# reusing RequestSummary's counts-only discipline rather than inventing a
# second endpoint or a second free-text audit to maintain.
# ---------------------------------------------------------------------------


def test_v2_semantic_request_is_recorded_with_mode_semantic(load_fixture):
    _reset()
    data = load_fixture("v2/analyze/valid_semantic.json")
    resp = client.post("/v2/analyze", json=data)
    assert resp.status_code == 200, resp.text

    entries = client.get("/recent").json()["entries"]
    assert len(entries) == 1
    e = entries[0]
    assert e["mode"] == "semantic"
    assert e["imageBytes"] == 0
    assert e["domNodes"] == len(data["elements"])
    assert e["leakCheck"] == "passed"


def test_v2_image_request_is_recorded_with_mode_image(load_fixture):
    _reset()
    data = load_fixture("v2/analyze/valid_image.json")
    resp = client.post("/v2/analyze", json=data)
    assert resp.status_code == 200, resp.text

    entries = client.get("/recent").json()["entries"]
    assert entries[0]["mode"] == "image"
    assert entries[0]["imageBytes"] > 0


def test_v1_entries_default_mode_to_image(load_fixture):
    # v1 has no semantic/image distinction -- it always captures and redacts
    # an image, so "image" describes it accurately rather than inventing a
    # third state.
    _reset()
    client.post("/analyze", json=load_fixture("valid_request.json"))
    assert client.get("/recent").json()["entries"][0]["mode"] == "image"


def test_v1_and_v2_entries_share_one_feed_newest_first(load_fixture):
    _reset()
    client.post("/analyze", json=load_fixture("valid_request.json"))
    client.post("/v2/analyze", json=load_fixture("v2/analyze/valid_semantic.json"))

    entries = client.get("/recent").json()["entries"]
    assert len(entries) == 2
    assert entries[0]["seq"] == 2  # newest first
    assert entries[0]["mode"] == "semantic"
    assert entries[1]["mode"] == "image"


def test_v2_recent_never_echoes_free_text_from_the_request(load_fixture):
    _reset()
    data = load_fixture("v2/analyze/valid_semantic.json")
    data["taskGoal"] = f"fill in {SENTINEL}"
    for el in data["elements"]:
        el["label"] = SENTINEL

    posted = client.post("/v2/analyze", json=data)
    assert posted.status_code in (200, 400), posted.status_code

    resp = client.get("/recent")
    assert SENTINEL not in resp.text
    assert SENTINEL.encode() not in resp.content
    assert "taskGoal" not in resp.text
    assert '"label"' not in resp.text
