"""In-process FastAPI TestClient tests for POST /v2/analyze (default mock
VLM backend). Mirrors test_api.py's style and its "an error path is a data
egress path" discipline: every rejection-path assertion checks raw
`resp.content` bytes for absence of the sentinel, not just the status code.

Also includes one v1-still-fine sanity check per the brief's required test
list ("v1 /analyze still fine") -- the fuller v1 regression suite lives in
test_api.py and is untouched by this module.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

import main
from main import app
from schemas_v2 import SCHEMA_LITERAL_V2, PAGE_TARGET_ID_V2
from vlm_client import VLMClient, VLMRequestContext

client = TestClient(app)

SENTINEL = "SENTINEL-PII-V2-9d4e1a7c"


def _base_request(**overrides: Any) -> dict[str, Any]:
    data: dict[str, Any] = {
        "schema": SCHEMA_LITERAL_V2,
        "mode": "semantic",
        "revision": "rev-abc",
        "taskGoal": "click the submit button",
        "viewport": {"w": 1280, "h": 720},
        "elements": [
            {
                "agentId": "agent-1",
                "tag": "button",
                "role": "button",
                "type": "submit",
                "label": "Submit",
                "bbox": {"x": 10, "y": 20, "w": 80, "h": 30},
                "sensitive": False,
                "tier": "navigational",
            }
        ],
        "regions": [],
        "history": [],
    }
    data.update(overrides)
    return data


class _FixedActionClient(VLMClient):
    """Test double: returns a fixed raw action dict for both v1/v2 analyze
    calls, regardless of context. Used to exercise serverVerdict paths the
    real MockVLMClient can't reach on its own (it only ever targets a real
    element from context.elements)."""

    def __init__(self, action: dict[str, Any]) -> None:
        self._action = action

    def analyze(self, context: VLMRequestContext) -> dict[str, Any]:
        return self._action

    def analyze_v2(self, context) -> dict[str, Any]:
        return self._action


def _override_vlm_client(action: dict[str, Any]):
    fake = _FixedActionClient(action)
    # get_vlm_client_v2, NOT get_vlm_client -- /v2/analyze depends on the
    # v2-only factory (V3: VLM_BACKEND_V2, default "ollama") since the V3
    # planner-local pass, separate from v1's /analyze (VLM_BACKEND,
    # default "mock", unchanged). See vlm_client.get_vlm_client_v2 and
    # conftest.py's _default_v2_backend_to_mock fixture.
    app.dependency_overrides[main.get_vlm_client_v2] = lambda: fake
    return fake


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Valid payloads
# ---------------------------------------------------------------------------


def test_v2_analyze_valid_semantic_request(load_fixture):
    data = load_fixture("v2/analyze/valid_semantic.json")
    resp = client.post("/v2/analyze", json=data)
    assert resp.status_code == 200
    body = resp.json()
    assert body["revision"] == data["revision"]
    assert body["serverVerdict"] in {"accept", "ask", "reject"}
    assert body["action"] in {
        "click", "type", "scroll", "press_key", "done", "need_visual", "fill_profile",
    }
    # mock must never target the sensitive password field (agent-2)
    assert not (body["targetId"] == "agent-2" and body["action"] == "type")


def test_v2_analyze_valid_image_request(load_fixture):
    data = load_fixture("v2/analyze/valid_image.json")
    resp = client.post("/v2/analyze", json=data)
    assert resp.status_code == 200
    body = resp.json()
    assert body["revision"] == data["revision"]
    assert body["serverVerdict"] == "accept"


def test_v2_analyze_token_wrapped_value_passes(load_fixture):
    """taskGoal/history carry token references (EMAIL#1, PERSONNAME#2), not
    raw values -- must NOT trip the leak re-check."""
    data = load_fixture("v2/analyze/token_wrapped_history.json")
    resp = client.post("/v2/analyze", json=data)
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Leak in label -> 400, no echo
# ---------------------------------------------------------------------------


def test_v2_analyze_leak_in_label_rejected_no_echo():
    data = _base_request(
        elements=[
            {
                "agentId": "agent-1",
                "tag": "input",
                "type": "text",
                "label": f"contact {SENTINEL}@example.com",
                "sensitive": False,
            }
        ]
    )
    resp = client.post("/v2/analyze", json=data)
    assert resp.status_code == 400
    assert resp.json()["errorCode"] == "PII_LEAK_DETECTED"
    assert SENTINEL.encode() not in resp.content
    assert b"@example.com" not in resp.content


def test_v2_analyze_leak_in_task_goal_rejected_no_echo():
    data = _base_request(taskGoal=f"send it to {SENTINEL} at phone 9876543210")
    resp = client.post("/v2/analyze", json=data)
    assert resp.status_code == 400
    assert resp.json()["errorCode"] == "PII_LEAK_DETECTED"
    assert SENTINEL.encode() not in resp.content


def test_v2_analyze_leak_in_history_value_rejected_no_echo():
    data = _base_request(
        history=[
            {
                "action": {"action": "type", "targetId": "agent-1", "value": f"{SENTINEL}@leak.com"},
                "outcome": "ok",
            }
        ]
    )
    resp = client.post("/v2/analyze", json=data)
    assert resp.status_code == 400
    assert resp.json()["errorCode"] == "PII_LEAK_DETECTED"
    assert SENTINEL.encode() not in resp.content


# ---------------------------------------------------------------------------
# Mode/image contract -> 400 MODE_VIOLATION, both directions
# ---------------------------------------------------------------------------


def test_v2_analyze_image_in_semantic_mode_rejected():
    data = _base_request(mode="semantic", image="aGVsbG8=")
    resp = client.post("/v2/analyze", json=data)
    assert resp.status_code == 400
    assert resp.json()["errorCode"] == "MODE_VIOLATION"


def test_v2_analyze_missing_image_in_image_mode_rejected():
    data = _base_request(mode="image")
    data.pop("image", None)
    resp = client.post("/v2/analyze", json=data)
    assert resp.status_code == 400
    assert resp.json()["errorCode"] == "MODE_VIOLATION"


# ---------------------------------------------------------------------------
# Deterministic serverVerdict checks (brief item 3)
# ---------------------------------------------------------------------------


def test_v2_analyze_unknown_target_rejected_via_server_verdict():
    _override_vlm_client({"action": "click", "targetId": "agent-does-not-exist", "value": None})
    data = _base_request()
    resp = client.post("/v2/analyze", json=data)
    assert resp.status_code == 200
    body = resp.json()
    assert body["serverVerdict"] == "reject"
    assert body["reason"] == "UNKNOWN_TARGET"


def test_v2_analyze_fill_profile_with_value_rejected_via_server_verdict_no_echo():
    _override_vlm_client(
        {
            "action": "fill_profile",
            "targetId": "agent-1",
            "value": SENTINEL,
            "profileField": "email",
        }
    )
    data = _base_request()
    resp = client.post("/v2/analyze", json=data)
    assert resp.status_code == 200
    body = resp.json()
    assert body["serverVerdict"] == "reject"
    assert body["reason"] == "FILL_PROFILE_VALUE_SUPPLIED"
    assert body["value"] is None
    assert SENTINEL.encode() not in resp.content


def test_v2_analyze_raw_pii_in_value_rejected_via_server_verdict_no_echo():
    _override_vlm_client(
        {"action": "type", "targetId": "agent-1", "value": f"{SENTINEL}@raw-leak.com"}
    )
    data = _base_request()
    resp = client.post("/v2/analyze", json=data)
    assert resp.status_code == 200
    body = resp.json()
    assert body["serverVerdict"] == "reject"
    assert body["reason"] == "RAW_VALUE_IN_ACTION"
    assert body["value"] is None
    assert SENTINEL.encode() not in resp.content


def test_v2_analyze_token_value_accepted_via_server_verdict():
    """Retry 2: a token the model echoes must actually appear somewhere
    in the request (here, taskGoal) to be accepted — see
    test_v2_analyze_unknown_token_rejected below for the negative case."""
    _override_vlm_client({"action": "type", "targetId": "agent-1", "value": "EMAIL#1"})
    data = _base_request(taskGoal="fill the email as EMAIL#1")
    resp = client.post("/v2/analyze", json=data)
    assert resp.status_code == 200
    body = resp.json()
    assert body["serverVerdict"] == "accept"
    assert body["value"] == "EMAIL#1"


def test_v2_analyze_token_value_accepted_when_known_via_element_label():
    _override_vlm_client({"action": "type", "targetId": "agent-1", "value": "EMAIL#1"})
    data = _base_request(
        elements=[
            {
                "agentId": "agent-1", "tag": "input", "type": "email",
                "label": "EMAIL#1", "sensitive": False,
            }
        ]
    )
    resp = client.post("/v2/analyze", json=data)
    assert resp.status_code == 200
    assert resp.json()["serverVerdict"] == "accept"


def test_v2_analyze_unknown_token_rejected_via_server_verdict_no_echo():
    """V3 retry 2 item 2: a token-shaped value that appears nowhere in
    the request (taskGoal/labels/history) is a hallucinated token — the
    exact failure mode retry-1's benchmark caught (llama3.1:8b typing
    'PERSONNAME#2', which existed nowhere in that request). Must reject
    UNKNOWN_TOKEN and never echo the invented token."""
    _override_vlm_client({"action": "type", "targetId": "agent-1", "value": "PERSONNAME#2"})
    data = _base_request(taskGoal="click the submit button")  # no PERSONNAME#2 anywhere
    resp = client.post("/v2/analyze", json=data)
    assert resp.status_code == 200
    body = resp.json()
    assert body["serverVerdict"] == "reject"
    assert body["reason"] == "UNKNOWN_TOKEN"
    assert body["value"] is None
    assert b"PERSONNAME#2" not in resp.content


def test_v2_analyze_unknown_token_takes_priority_over_raw_pii_check():
    """A value carrying BOTH an unknown token and raw PII text is caught
    by the token check first -- it doesn't matter which reason fires as
    long as it's a reject with no echo, but the ordering is deliberate
    (see compute_server_verdict's docstring) and worth pinning down."""
    _override_vlm_client(
        {"action": "type", "targetId": "agent-1", "value": f"PERSONNAME#9 {SENTINEL}@leak.com"}
    )
    data = _base_request(taskGoal="click the submit button")
    resp = client.post("/v2/analyze", json=data)
    assert resp.status_code == 200
    body = resp.json()
    assert body["serverVerdict"] == "reject"
    assert body["reason"] == "UNKNOWN_TOKEN"
    assert SENTINEL.encode() not in resp.content


# ---------------------------------------------------------------------------
# C5/C2 amendment (2026-09-26): `vault` -- tokens + categories only, never
# values. See docs/v2/ARCHITECTURE.md's "C5/C2 amendment" section.
# ---------------------------------------------------------------------------


def test_v2_analyze_vault_token_in_value_accepted():
    """A vault token echoed back in `value` must be accepted even though
    it appears NOWHERE else in the request (not in taskGoal, not in any
    element label, not in history) -- that absence is exactly the bug
    this amendment fixes. Before the fix this was indistinguishable from
    test_v2_analyze_unknown_token_rejected above and would reject."""
    _override_vlm_client({"action": "type", "targetId": "agent-1", "value": "PROFILENAME#1"})
    data = _base_request(
        taskGoal="fill all my details",  # carries no token at all
        vault=[{"token": "PROFILENAME#1", "field": "full_name"}],
    )
    resp = client.post("/v2/analyze", json=data)
    assert resp.status_code == 200
    body = resp.json()
    assert body["serverVerdict"] == "accept"
    assert body["value"] == "PROFILENAME#1"


def test_v2_analyze_unlisted_profile_token_still_rejected():
    """A PROFILE...#n-shaped token that is NOT in `vault` (nor anywhere
    else in the request) must still be rejected -- the vault is an
    allow-list, not a blanket exemption for anything PROFILE-shaped."""
    _override_vlm_client({"action": "type", "targetId": "agent-1", "value": "PROFILEEMAIL#1"})
    data = _base_request(
        taskGoal="fill all my details",
        vault=[{"token": "PROFILENAME#1", "field": "full_name"}],  # a DIFFERENT token
    )
    resp = client.post("/v2/analyze", json=data)
    assert resp.status_code == 200
    body = resp.json()
    assert body["serverVerdict"] == "reject"
    assert body["reason"] == "UNKNOWN_TOKEN"
    assert body["value"] is None


def test_v2_analyze_vault_entry_with_non_token_value_rejected_422():
    """VaultEntry.token is pattern-constrained to C2's TOKEN_PATTERN grammar
    at the schema layer -- a vault entry carrying anything else (a raw
    value, an empty string, a malformed token) is a plain 422, never a
    deterministic-verdict path this module would otherwise have to
    special-case."""
    data = _base_request(vault=[{"token": "not-a-token", "field": "full_name"}])
    resp = client.post("/v2/analyze", json=data)
    assert resp.status_code == 422


def test_v2_analyze_vault_entry_with_raw_value_rejected_422_no_echo():
    """The concrete privacy-relevant case: someone accidentally puts a raw
    vault VALUE (not a token) in `vault[].token`. Must still be a 422, and
    the raw value must never be echoed back in the error body."""
    data = _base_request(vault=[{"token": f"{SENTINEL}@leak.com", "field": "email"}])
    resp = client.post("/v2/analyze", json=data)
    assert resp.status_code == 422
    assert SENTINEL.encode() not in resp.content


def test_v2_analyze_vault_entry_with_unknown_field_rejected_422():
    data = _base_request(vault=[{"token": "PROFILENAME#1", "field": "not_a_real_category"}])
    resp = client.post("/v2/analyze", json=data)
    assert resp.status_code == 422


def test_v2_analyze_empty_vault_omitted_still_valid():
    """`vault` is optional/omittable per the amendment ("omitted when the
    vault is empty") -- a request with no `vault` key at all must still
    validate (default empty list), not 422 on a missing field."""
    data = _base_request()
    assert "vault" not in data
    resp = client.post("/v2/analyze", json=data)
    assert resp.status_code == 200


def test_v2_analyze_page_sentinel_target_accepted():
    _override_vlm_client({"action": "done", "targetId": PAGE_TARGET_ID_V2, "value": None})
    data = _base_request()
    resp = client.post("/v2/analyze", json=data)
    assert resp.status_code == 200
    body = resp.json()
    assert body["serverVerdict"] == "accept"
    assert body["targetId"] == "page"


def test_v2_analyze_revision_is_echoed_not_model_supplied():
    _override_vlm_client({"action": "click", "targetId": "agent-1", "value": None})
    data = _base_request(revision="rev-specific-12345")
    resp = client.post("/v2/analyze", json=data)
    assert resp.status_code == 200
    assert resp.json()["revision"] == "rev-specific-12345"


def test_v2_analyze_model_cannot_supply_server_verdict():
    """ModelActionV2 has no `serverVerdict` field at all -- a backend
    trying to supply one is silently ignored at the schema boundary
    (extra="forbid" on ModelActionV2 would actually reject it outright if
    it appeared; either way the server's own computed value is what's
    returned)."""
    _override_vlm_client(
        {"action": "click", "targetId": "agent-1", "value": None, "serverVerdict": "accept"}
    )
    data = _base_request()
    resp = client.post("/v2/analyze", json=data)
    # extra="forbid" on ModelActionV2 rejects the unexpected field outright.
    # Uses HTTPException (like v1's VLM_RESPONSE_SCHEMA_INVALID path), so
    # the body nests under "detail" -- not a dedicated exception_handler
    # like PII_LEAK_DETECTED/MODE_VIOLATION above.
    assert resp.status_code == 502
    assert resp.json()["detail"]["errorCode"] == "VLM_RESPONSE_SCHEMA_INVALID"


# ---------------------------------------------------------------------------
# History > 10 -> 422 (ordinary structural violation, not a 400)
# ---------------------------------------------------------------------------


def test_v2_analyze_history_over_ten_rejected_with_422():
    history = [
        {"action": {"action": "scroll", "targetId": PAGE_TARGET_ID_V2, "value": None}, "outcome": "ok"}
        for _ in range(11)
    ]
    data = _base_request(history=history)
    resp = client.post("/v2/analyze", json=data)
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Backend not wired for v2 -> clean 502, not a crash
# ---------------------------------------------------------------------------


def test_v2_analyze_unwired_backend_returns_clean_502():
    """As of the V3 (planner-local) pass, ClaudeVLMClient/GeminiVLMClient
    DO implement analyze_v2 (opt-in, see test_claude_vlm_client.py /
    test_gemini_vlm_client.py for their own v2 coverage) -- but with no
    ANTHROPIC_API_KEY configured, this still exercises a real failure
    path end-to-end: credentials-missing is an ordinary Exception the
    generic `except Exception` handler in analyze_v2() maps to a clean
    502 VLM_BACKEND_CALL_FAILED, never a crash and never a silent
    fallback to another backend."""
    from vlm_client import ClaudeVLMClient

    app.dependency_overrides[main.get_vlm_client_v2] = lambda: ClaudeVLMClient()
    data = _base_request()
    resp = client.post("/v2/analyze", json=data)
    assert resp.status_code == 502
    assert resp.json()["detail"]["errorCode"] == "VLM_BACKEND_CALL_FAILED"


def test_v2_analyze_ollama_down_returns_clean_502_never_falls_back_to_cloud(monkeypatch):
    """Invariant 4 (docs/v2/ARCHITECTURE.md): 'No silent cloud fallback. A
    local backend being down is an error, not a reason to call a cloud
    API.' Wires the REAL get_vlm_client_v2() factory path (VLM_BACKEND_V2
    env var, not a dependency override) so this exercises main.py's actual
    selection logic, points OllamaVLMClient at a closed port, and spies on
    Claude/Gemini's analyze_v2 to prove neither is ever touched."""
    import vlm_client as vlm_module

    claude_spy = MagicMock(side_effect=AssertionError("cloud backend must never be called"))
    gemini_spy = MagicMock(side_effect=AssertionError("cloud backend must never be called"))
    monkeypatch.setattr(vlm_module.ClaudeVLMClient, "analyze_v2", claude_spy)
    monkeypatch.setattr(vlm_module.GeminiVLMClient, "analyze_v2", gemini_spy)

    monkeypatch.setenv("VLM_BACKEND_V2", "ollama")
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://127.0.0.1:1")  # nothing listens here

    data = _base_request()
    resp = client.post("/v2/analyze", json=data)

    assert resp.status_code == 502
    assert resp.json()["detail"]["errorCode"] == "VLM_BACKEND_CALL_FAILED"
    claude_spy.assert_not_called()
    gemini_spy.assert_not_called()


# ---------------------------------------------------------------------------
# v1 sanity check -- /analyze must still work unchanged (brief item: "v1
# /analyze still fine"). Full v1 regression suite lives in test_api.py.
# ---------------------------------------------------------------------------


def test_v1_analyze_still_works_unaffected_by_v2_additions(load_fixture):
    data = load_fixture("valid_request.json")
    resp = client.post("/analyze", json=data)
    assert resp.status_code == 200
    body = resp.json()
    assert body["action"] in {"click", "type", "scroll", "done", "fill_profile"}
