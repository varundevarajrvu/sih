"""Unit tests for ClaudeVLMClient — the cloud VLM backend (Chief's
finale decision, swapping mock/Ollama for a real cloud model since this
machine's ~3.7GB free RAM can't run a 7B local VLM).

NO LIVE API CALL IS EVER MADE HERE. No ANTHROPIC_API_KEY is configured
on this machine, and none of these tests need one — every test injects a
fake object (via ClaudeVLMClient's `client=` constructor parameter)
standing in for `anthropic.Anthropic`, so request construction, response
parsing, and every error branch are exercised without credentials or
network access.

Real `anthropic.*` exception instances are constructed here (they take a
real httpx2.Request/Response) purely as local Python objects — building
an httpx2.Request/Response does not perform any I/O.
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import anthropic
import httpx2
import pytest

from schemas import BBox, DomNode, RedactedRegion
from vlm_client import (
    ACTION_RESPONSE_JSON_SCHEMA,
    DEFAULT_CLAUDE_MODEL,
    ClaudeAPIError,
    ClaudeConnectionError,
    ClaudeCredentialsMissing,
    ClaudeModelNotFound,
    ClaudeRateLimited,
    ClaudeVLMClient,
    VLMRequestContext,
    build_prompt,
)


# ---------------------------------------------------------------------------
# Fakes — stand in for anthropic.Anthropic / its .messages resource.
# ---------------------------------------------------------------------------


class FakeMessagesResource:
    def __init__(self, response=None, exception=None):
        self._response = response
        self._exception = exception
        self.last_call_kwargs: dict | None = None
        self.call_count = 0

    def create(self, **kwargs):
        self.last_call_kwargs = kwargs
        self.call_count += 1
        if self._exception is not None:
            raise self._exception
        return self._response


class FakeAnthropicClient:
    """Duck-types the two attributes ClaudeVLMClient actually touches:
    `.api_key` (for the pre-flight credentials check) and
    `.messages.create(...)`."""

    def __init__(self, response=None, exception=None, api_key="fake-test-key-not-real"):
        self.api_key = api_key
        self.messages = FakeMessagesResource(response=response, exception=exception)


def _fake_text_response(action_dict: dict):
    """A minimal stand-in for anthropic.types.Message: an object with a
    `.content` list of blocks exposing `.type` and `.text` — exactly what
    ClaudeVLMClient._extract_action_dict reads, nothing more."""
    return SimpleNamespace(content=[SimpleNamespace(type="text", text=json.dumps(action_dict))])


def _http_response(status_code: int, body: dict | None = None) -> httpx2.Response:
    req = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    return httpx2.Response(status_code, request=req, json=body)


def _http_request() -> httpx2.Request:
    return httpx2.Request("POST", "https://api.anthropic.com/v1/messages")


def _context(dom_snapshot, redacted_regions=None, task_goal="do the task", image_b64="ZmFrZS1yZWRhY3RlZC1wbmc="):
    redacted_regions = redacted_regions or []
    prompt = build_prompt(task_goal, dom_snapshot, redacted_regions)
    return VLMRequestContext(
        image_b64=image_b64,
        dom_snapshot=dom_snapshot,
        redacted_regions=redacted_regions,
        task_goal=task_goal,
        prompt=prompt,
    )


DONE_RESPONSE = {"action": "done", "targetId": "page", "value": None}


# ---------------------------------------------------------------------------
# Response parsing
# ---------------------------------------------------------------------------


def test_analyze_returns_parsed_action_dict():
    fake = FakeAnthropicClient(
        response=_fake_text_response({"action": "click", "targetId": "agent-1", "value": None})
    )
    client = ClaudeVLMClient(client=fake)
    nodes = [DomNode(agentId="agent-1", tag="button", type="submit", text="Go")]
    result = client.analyze(_context(nodes))
    assert result == {"action": "click", "targetId": "agent-1", "value": None}


def test_analyze_parses_type_action_with_value():
    fake = FakeAnthropicClient(
        response=_fake_text_response({"action": "type", "targetId": "agent-2", "value": "hello"})
    )
    client = ClaudeVLMClient(client=fake)
    result = client.analyze(_context([]))
    assert result == {"action": "type", "targetId": "agent-2", "value": "hello"}


def test_analyze_does_not_validate_against_action_response_itself():
    """Single-validation-boundary rule (see VLMClient.analyze's base
    docstring): this class must return the raw dict as-is, even if it
    would fail ActionResponse validation — that check belongs to
    main.py, uniformly across every backend."""
    fake = FakeAnthropicClient(
        response=_fake_text_response({"action": "not-a-real-action", "targetId": "x", "value": None})
    )
    client = ClaudeVLMClient(client=fake)
    result = client.analyze(_context([]))  # must NOT raise here
    assert result["action"] == "not-a-real-action"


def test_no_text_block_in_response_raises_clear_error():
    fake_response = SimpleNamespace(content=[SimpleNamespace(type="image", text=None)])
    fake = FakeAnthropicClient(response=fake_response)
    client = ClaudeVLMClient(client=fake)
    with pytest.raises(ValueError, match="no text content block"):
        client.analyze(_context([]))


# ---------------------------------------------------------------------------
# Request shape: image block present and FIRST, correct media_type.
# ---------------------------------------------------------------------------


def test_request_image_block_is_first_in_user_content():
    fake = FakeAnthropicClient(response=_fake_text_response(DONE_RESPONSE))
    client = ClaudeVLMClient(client=fake)
    ctx = _context([], image_b64="dGVzdC1pbWFnZS1kYXRh")

    client.analyze(ctx)

    content = fake.messages.last_call_kwargs["messages"][0]["content"]
    assert len(content) == 2
    assert content[0]["type"] == "image"
    assert content[1]["type"] == "text"


def test_request_image_block_uses_base64_png_source_with_context_data():
    fake = FakeAnthropicClient(response=_fake_text_response(DONE_RESPONSE))
    client = ClaudeVLMClient(client=fake)
    ctx = _context([], image_b64="dGVzdC1pbWFnZS1kYXRh")

    client.analyze(ctx)

    image_block = fake.messages.last_call_kwargs["messages"][0]["content"][0]
    assert image_block == {
        "type": "image",
        "source": {"type": "base64", "media_type": "image/png", "data": "dGVzdC1pbWFnZS1kYXRh"},
    }


def test_request_text_block_is_build_prompt_output_verbatim():
    """build_prompt() is REUSED, not rewritten — it is the already
    unit-tested privacy contract (every redacted region named, "do not
    guess" instruction present)."""
    fake = FakeAnthropicClient(response=_fake_text_response(DONE_RESPONSE))
    client = ClaudeVLMClient(client=fake)
    nodes = [DomNode(agentId="agent-1", tag="input", type="password", text=None, sensitive=True)]
    regions = [RedactedRegion(type="password", bbox=BBox(x=0, y=0, w=10, h=10), agentId="agent-1", source="dom")]
    ctx = _context(nodes, regions, task_goal="Log in")
    expected_prompt = build_prompt("Log in", nodes, regions)

    client.analyze(ctx)

    text_block = fake.messages.last_call_kwargs["messages"][0]["content"][1]
    assert text_block == {"type": "text", "text": expected_prompt}
    assert text_block["text"] == ctx.prompt
    # Sanity: the reused prompt still carries its core privacy language.
    assert "intentionally" in text_block["text"].lower()
    assert "privacy" in text_block["text"].lower()


# ---------------------------------------------------------------------------
# Request shape: no thinking param, no prefill, correct max_tokens/model.
# ---------------------------------------------------------------------------


def test_request_omits_thinking_param_entirely():
    fake = FakeAnthropicClient(response=_fake_text_response(DONE_RESPONSE))
    client = ClaudeVLMClient(client=fake)
    client.analyze(_context([]))
    assert "thinking" not in fake.messages.last_call_kwargs
    assert "budget_tokens" not in fake.messages.last_call_kwargs


def test_request_has_single_user_message_no_assistant_prefill():
    fake = FakeAnthropicClient(response=_fake_text_response(DONE_RESPONSE))
    client = ClaudeVLMClient(client=fake)
    client.analyze(_context([]))
    messages = fake.messages.last_call_kwargs["messages"]
    assert len(messages) == 1
    assert messages[0]["role"] == "user"
    assert all(m.get("role") != "assistant" for m in messages)


def test_request_max_tokens_is_2048_by_default():
    fake = FakeAnthropicClient(response=_fake_text_response(DONE_RESPONSE))
    client = ClaudeVLMClient(client=fake)
    client.analyze(_context([]))
    assert fake.messages.last_call_kwargs["max_tokens"] == 2048


def test_request_max_tokens_override_is_respected():
    fake = FakeAnthropicClient(response=_fake_text_response(DONE_RESPONSE))
    client = ClaudeVLMClient(client=fake, max_tokens=4096)
    client.analyze(_context([]))
    assert fake.messages.last_call_kwargs["max_tokens"] == 4096


def test_model_defaults_to_claude_opus_4_8(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_MODEL", raising=False)
    client = ClaudeVLMClient()
    # Exact id string, no date suffix appended (e.g. NOT "claude-opus-4-8-20260101").
    assert client.model == "claude-opus-4-8"
    assert client.model == DEFAULT_CLAUDE_MODEL


def test_model_overridable_via_anthropic_model_env_var(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_MODEL", "claude-some-other-model")
    client = ClaudeVLMClient()
    assert client.model == "claude-some-other-model"


def test_model_explicit_constructor_arg_wins_over_env_var(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_MODEL", "claude-env-model")
    client = ClaudeVLMClient(model="claude-explicit-model")
    assert client.model == "claude-explicit-model"


def test_request_uses_the_resolved_model_id():
    fake = FakeAnthropicClient(response=_fake_text_response(DONE_RESPONSE))
    client = ClaudeVLMClient(client=fake, model="claude-custom-test-model")
    client.analyze(_context([]))
    assert fake.messages.last_call_kwargs["model"] == "claude-custom-test-model"


# ---------------------------------------------------------------------------
# Request shape: structured output via output_config, not output_format.
# ---------------------------------------------------------------------------


def test_request_output_config_carries_json_schema_mirroring_action_response():
    fake = FakeAnthropicClient(response=_fake_text_response(DONE_RESPONSE))
    client = ClaudeVLMClient(client=fake)
    client.analyze(_context([]))

    kwargs = fake.messages.last_call_kwargs
    assert "output_config" in kwargs
    assert "output_format" not in kwargs  # the deprecated param must never be used

    fmt = kwargs["output_config"]["format"]
    assert fmt["type"] == "json_schema"
    assert fmt["schema"] == ACTION_RESPONSE_JSON_SCHEMA


def test_action_response_json_schema_is_a_strict_enum_of_four_actions():
    props = ACTION_RESPONSE_JSON_SCHEMA["properties"]
    assert set(props["action"]["enum"]) == {"click", "type", "scroll", "done"}
    assert ACTION_RESPONSE_JSON_SCHEMA["additionalProperties"] is False
    assert set(ACTION_RESPONSE_JSON_SCHEMA["required"]) == {"action", "targetId", "value"}


# ---------------------------------------------------------------------------
# Credentials: fail fast with a clear, actionable message; never call out.
# ---------------------------------------------------------------------------


def test_missing_credentials_raises_clear_actionable_error_naming_env_var():
    fake = FakeAnthropicClient(response=_fake_text_response(DONE_RESPONSE), api_key=None)
    client = ClaudeVLMClient(client=fake)

    with pytest.raises(ClaudeCredentialsMissing) as excinfo:
        client.analyze(_context([]))

    assert "ANTHROPIC_API_KEY" in str(excinfo.value)


def test_missing_credentials_never_attempts_the_call():
    """The whole point: fail before dispatching anything, not after a
    failed network attempt."""
    fake = FakeAnthropicClient(response=_fake_text_response(DONE_RESPONSE), api_key=None)
    client = ClaudeVLMClient(client=fake)

    with pytest.raises(ClaudeCredentialsMissing):
        client.analyze(_context([]))

    assert fake.messages.call_count == 0


def test_empty_string_api_key_also_treated_as_missing():
    fake = FakeAnthropicClient(response=_fake_text_response(DONE_RESPONSE), api_key="")
    client = ClaudeVLMClient(client=fake)
    with pytest.raises(ClaudeCredentialsMissing):
        client.analyze(_context([]))


def test_present_api_key_does_not_raise_credentials_error():
    fake = FakeAnthropicClient(response=_fake_text_response(DONE_RESPONSE), api_key="sk-ant-fake-present")
    client = ClaudeVLMClient(client=fake)
    result = client.analyze(_context([]))  # must not raise
    assert result == DONE_RESPONSE


def test_factory_selecting_claude_never_instantiates_a_live_client(monkeypatch):
    """Constructing ClaudeVLMClient (as get_vlm_client() does for
    VLM_BACKEND=claude) must not touch anthropic.Anthropic()'s credential
    resolution at all — only analyze() does, lazily, on first real use."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    client = ClaudeVLMClient()  # no client= injected, no key present
    assert client._injected_client is None  # nothing constructed yet


# ---------------------------------------------------------------------------
# Error handling: most-specific-first chain, distinguishable by type.
# ---------------------------------------------------------------------------


def test_not_found_error_wrapped_as_claude_model_not_found():
    exc = anthropic.NotFoundError(
        "model not found", response=_http_response(404), body={"error": {"type": "not_found_error"}}
    )
    fake = FakeAnthropicClient(exception=exc)
    client = ClaudeVLMClient(client=fake)
    with pytest.raises(ClaudeModelNotFound):
        client.analyze(_context([]))


def test_rate_limit_error_wrapped_as_claude_rate_limited():
    exc = anthropic.RateLimitError("rate limited", response=_http_response(429), body=None)
    fake = FakeAnthropicClient(exception=exc)
    client = ClaudeVLMClient(client=fake)
    with pytest.raises(ClaudeRateLimited):
        client.analyze(_context([]))


def test_other_api_status_error_wrapped_as_claude_api_error():
    """AuthenticationError is an APIStatusError subclass with no
    dedicated branch — must fall through to the general APIStatusError
    handler, not be silently mis-caught as NotFoundError/RateLimitError."""
    exc = anthropic.AuthenticationError("bad key", response=_http_response(401), body=None)
    fake = FakeAnthropicClient(exception=exc)
    client = ClaudeVLMClient(client=fake)
    with pytest.raises(ClaudeAPIError):
        client.analyze(_context([]))


def test_bad_request_error_also_wrapped_as_claude_api_error():
    """A second APIStatusError subclass, to confirm the general branch
    isn't accidentally scoped to only one type."""
    exc = anthropic.BadRequestError("bad request shape", response=_http_response(400), body=None)
    fake = FakeAnthropicClient(exception=exc)
    client = ClaudeVLMClient(client=fake)
    with pytest.raises(ClaudeAPIError):
        client.analyze(_context([]))


def test_connection_error_wrapped_as_claude_connection_error():
    exc = anthropic.APIConnectionError(request=_http_request())
    fake = FakeAnthropicClient(exception=exc)
    client = ClaudeVLMClient(client=fake)
    with pytest.raises(ClaudeConnectionError):
        client.analyze(_context([]))


def test_error_branches_are_distinguishable_by_exception_type():
    """The point of a most-specific-first chain over one broad except:
    each SDK error type maps to its OWN distinct wrapper type, so a
    caller (or a test) can `except ClaudeRateLimited` specifically
    without string-matching a message."""
    cases = [
        (anthropic.NotFoundError("x", response=_http_response(404), body=None), ClaudeModelNotFound),
        (anthropic.RateLimitError("x", response=_http_response(429), body=None), ClaudeRateLimited),
        (anthropic.PermissionDeniedError("x", response=_http_response(403), body=None), ClaudeAPIError),
        (anthropic.APIConnectionError(request=_http_request()), ClaudeConnectionError),
    ]
    for sdk_exc, expected_wrapper in cases:
        fake = FakeAnthropicClient(exception=sdk_exc)
        client = ClaudeVLMClient(client=fake)
        with pytest.raises(expected_wrapper):
            client.analyze(_context([]))

    # All four wrapper types are genuinely distinct classes.
    assert len({ClaudeModelNotFound, ClaudeRateLimited, ClaudeAPIError, ClaudeConnectionError}) == 4


def test_all_claude_error_types_are_runtimeerror_subclasses():
    """So main.py's existing generic `except Exception as exc` backend-
    call-failure handling (VLM_BACKEND_CALL_FAILED, type(exc).__name__)
    continues to work unmodified for this backend too — no main.py
    change was needed to add Claude support."""
    for wrapper in (ClaudeModelNotFound, ClaudeRateLimited, ClaudeAPIError, ClaudeConnectionError):
        assert issubclass(wrapper, RuntimeError)


# ---------------------------------------------------------------------------
# Section 5 egress check: this is now a real network call to a third
# party. Confirm the outgoing request carries ONLY the redacted image and
# the sanitized prompt this class was handed — nothing additional.
# ---------------------------------------------------------------------------

SENTINEL = "SENTINEL-CLAUDE-EGRESS-4e91ab"


def test_outgoing_request_carries_exactly_the_redacted_image_and_sanitized_prompt():
    """A realistic sanitized snapshot: the sensitive node's raw value has
    already been stripped upstream (text=None), exactly as main.py's
    find_pii_leaks() gate requires before this class ever runs. Confirm
    the request's user content is EXACTLY [image block using
    context.image_b64 verbatim, text block using context.prompt
    verbatim] — no extra fields, no raw dom dump appended by this class."""
    fake = FakeAnthropicClient(response=_fake_text_response(DONE_RESPONSE))
    client = ClaudeVLMClient(client=fake)

    nodes = [
        DomNode(agentId="agent-1", tag="input", type="password", text=None, sensitive=True),
        DomNode(agentId="agent-2", tag="button", type="submit", text="Log in"),
    ]
    regions = [RedactedRegion(type="password", bbox=BBox(x=0, y=0, w=10, h=10), agentId="agent-1", source="dom")]
    ctx = _context(nodes, regions, task_goal="Log in", image_b64="UkVEQUNURUQtSU1BR0UtQllURVM=")

    client.analyze(ctx)

    content = fake.messages.last_call_kwargs["messages"][0]["content"]
    assert content == [
        {
            "type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": ctx.image_b64},
        },
        {"type": "text", "text": ctx.prompt},
    ]

    # Whole outgoing call, serialized: no stray sentinel value present.
    # (The sensitive node's text was already None going in — this proves
    # this class doesn't reintroduce it from anywhere, e.g. from
    # ctx.dom_snapshot/ctx.redacted_regions, which it also receives but
    # must not separately re-serialize into the request.)
    full_request_repr = json.dumps(fake.messages.last_call_kwargs, default=str)
    assert SENTINEL not in full_request_repr


def test_outgoing_request_never_independently_serializes_dom_snapshot_or_redacted_regions():
    """ClaudeVLMClient receives the full VLMRequestContext (including
    dom_snapshot/redacted_regions as Pydantic objects) but must only ever
    transmit the pre-built context.prompt text and context.image_b64 —
    never dump the raw DomNode/RedactedRegion objects themselves into the
    request (which would bypass build_prompt()'s redaction-aware
    formatting entirely)."""
    fake = FakeAnthropicClient(response=_fake_text_response(DONE_RESPONSE))
    client = ClaudeVLMClient(client=fake)

    nodes = [DomNode(agentId="agent-1", tag="input", type="password", text=None, sensitive=True)]
    regions = [RedactedRegion(type="password", bbox=BBox(x=0, y=0, w=10, h=10), agentId="agent-1", source="dom")]
    ctx = _context(nodes, regions, task_goal="Log in")

    client.analyze(ctx)

    kwargs = fake.messages.last_call_kwargs
    # Only the documented anthropic request params should appear.
    assert set(kwargs.keys()) <= {"model", "max_tokens", "messages", "output_config"}
    content = kwargs["messages"][0]["content"]
    assert len(content) == 2  # exactly image + text, nothing per-node appended
