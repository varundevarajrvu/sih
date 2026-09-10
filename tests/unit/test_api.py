"""In-process FastAPI TestClient tests for POST /analyze, using the
default mock VLM backend (no network, no model). Complements the
hand-run curl checkpoint (Section 6) with something that runs in CI.

SECURITY REGRESSION SUITE (added after orchestrator-caught defect,
CLAUDE.md Section 7 rule 5, 2026-09-10): "an error path is a data egress
path." The original PII-leak rejection echoed the offending value back
in its own error body (Pydantic's default `input` field), and the
original test suite never caught it because every assertion checked only
THAT a request was rejected, never what the rejection body CONTAINED.
Every test below that exercises a rejection path asserts on
`resp.content` (raw serialized bytes), not `resp.json()` (a parsed
object) — the vulnerability was in serialization, so the assertion has
to be at that same layer to be meaningful.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)

# Distinctive sentinel used across this file so "does the response
# contain the leaked value" is unambiguous — no risk of the substring
# coincidentally appearing in unrelated response content (unlike e.g.
# "hunter2", which is at least plausible as an accidental match).
SENTINEL = "SENTINEL-PII-VALUE-7f3c9a2b"


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_analyze_valid_request_returns_valid_action_json(load_fixture):
    data = load_fixture("valid_request.json")
    resp = client.post("/analyze", json=data)
    assert resp.status_code == 200
    body = resp.json()
    assert body["action"] in {"click", "type", "scroll", "done"}
    assert isinstance(body["targetId"], str) and body["targetId"] != ""
    assert "value" in body


def test_analyze_valid_request_with_redaction_returns_valid_action_json(load_fixture):
    data = load_fixture("valid_request_with_redaction.json")
    resp = client.post("/analyze", json=data)
    assert resp.status_code == 200
    body = resp.json()
    assert body["action"] in {"click", "type", "scroll", "done"}
    # Mock must never target the redacted password field with a guessed value.
    assert not (body["targetId"] == "agent-1" and body["action"] == "type")


def test_analyze_malformed_missing_field_rejected_with_422(load_fixture):
    data = load_fixture("malformed_request_missing_field.json")
    resp = client.post("/analyze", json=data)
    assert resp.status_code == 422
    body = resp.json()
    # Custom handler shape: detail is a list of {type, loc, msg} only.
    assert isinstance(body["detail"], list)
    for err in body["detail"]:
        assert set(err.keys()) == {"type", "loc", "msg"}


def test_analyze_pii_leak_rejected_with_400_and_error_code(load_fixture):
    """Pins the exact contract from the orchestrator's ruling #4: PII-leak
    rejections are 400 + errorCode PII_LEAK_DETECTED, distinct from the
    422 used for ordinary schema violations (see test above)."""
    data = load_fixture("malformed_request_pii_leak.json")
    resp = client.post("/analyze", json=data)
    assert resp.status_code == 400
    body = resp.json()
    assert body["errorCode"] == "PII_LEAK_DETECTED"
    assert "agent-1" in " ".join(body["violations"])


def test_analyze_response_is_json_not_prose(load_fixture):
    """Section 6 checkpoint, encoded as an assertion: the response must be
    parseable JSON matching the action schema exactly, never freeform
    text."""
    data = load_fixture("valid_request.json")
    resp = client.post("/analyze", json=data)
    assert resp.headers["content-type"].startswith("application/json")
    body = resp.json()
    assert set(body.keys()) == {"action", "targetId", "value"}


# ---------------------------------------------------------------------------
# Byte-level serialization tests — the actual point of this retry.
# Test resp.content (raw bytes on the wire), not resp.json() (a parsed,
# already-innocent-looking dict). The defect was in what gets serialized;
# only a byte-level assertion can catch a regression of the same shape.
# ---------------------------------------------------------------------------


def test_pii_leak_response_bytes_never_contain_the_sentinel_value(load_fixture):
    data = load_fixture("malformed_request_pii_leak_sentinel.json")
    assert data["domSnapshot"][0]["text"] == SENTINEL  # sanity: fixture actually plants it

    resp = client.post("/analyze", json=data)

    assert resp.status_code == 400
    assert SENTINEL.encode() not in resp.content, (
        "PII-leak rejection echoed the sentinel value back in the response body: "
        f"{resp.content!r}"
    )
    body = resp.json()
    assert body["errorCode"] == "PII_LEAK_DETECTED"


def test_pii_leak_original_fixture_response_bytes_never_contain_hunter2(load_fixture):
    """Same assertion against the original (non-sentinel) fixture, so the
    exact defect the orchestrator reported — `"text":"hunter2"` echoed in
    the 422 body — is pinned by name, not just by the newer sentinel
    fixture."""
    data = load_fixture("malformed_request_pii_leak.json")
    assert data["domSnapshot"][0]["text"] == "hunter2"  # sanity check

    resp = client.post("/analyze", json=data)

    assert resp.status_code == 400
    assert b"hunter2" not in resp.content, f"leaked into response: {resp.content!r}"


def test_ordinary_malformed_request_response_bytes_never_echo_planted_value(load_fixture):
    """A structurally malformed (not PII-leak) request can still carry a
    PII-shaped value in a field that fails validation for an unrelated
    reason (e.g. an extra/forbidden field). FastAPI's default 422 handler
    would normally echo the whole offending sub-object — including that
    value — under `input`. Confirm the custom RequestValidationError
    handler strips it regardless of which field carries it, not just on
    the /analyze-specific PII-leak path."""
    data = load_fixture("valid_request.json")
    # extra="forbid" on DomNode: this field is rejected outright, and
    # pydantic's default error for "extra_forbidden" embeds the whole
    # containing dict (sentinel included) as `input`.
    data["domSnapshot"][0]["notAllowedField"] = SENTINEL

    resp = client.post("/analyze", json=data)

    assert resp.status_code == 422
    assert SENTINEL.encode() not in resp.content, (
        f"ordinary validation-error response echoed a planted value: {resp.content!r}"
    )


def test_vlm_response_schema_error_bytes_never_echo_backend_output(load_fixture):
    """The 502 path (VLM returned something ActionResponse rejects) uses
    the same _safe_pydantic_errors() stripping as the 422 path. Force the
    mock backend to return an invalid `action` value — the sentinel is
    placed as the failing enum value itself (the field pydantic's default
    error would echo verbatim under `input`), so this actually exercises
    the stripping logic rather than a field that happens to pass
    validation untouched."""
    import main as main_module

    class BadClient:
        def analyze(self, context):
            return {"action": SENTINEL, "targetId": "agent-1", "value": None}

    app.dependency_overrides[main_module.get_vlm_client] = lambda: BadClient()
    try:
        data = load_fixture("valid_request.json")
        resp = client.post("/analyze", json=data)
        assert resp.status_code == 502
        body = resp.json()
        assert body["detail"]["errorCode"] == "VLM_RESPONSE_SCHEMA_INVALID"
        assert SENTINEL.encode() not in resp.content, (
            f"502 response echoed the VLM's raw output: {resp.content!r}"
        )
    finally:
        app.dependency_overrides.pop(main_module.get_vlm_client, None)
