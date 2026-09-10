"""Unit tests for GeminiVLMClient — the free-tier cloud VLM backend
(Chief's second decision, additive to ClaudeVLMClient, not a replacement).

NO LIVE API CALL IS EVER MADE HERE. No GEMINI_API_KEY / GOOGLE_API_KEY is
configured on this machine. Every request-shape/response-parsing/error-
branch test injects a fake object (via GeminiVLMClient's `client=`
constructor parameter) standing in for `google.genai.Client`.

ONE exception: the missing-credentials tests below construct a REAL
`google.genai.Client()` (no injected client) with both env vars removed.
This is still network-free — verified against the installed SDK's own
source (_api_client.py) that constructing `genai.Client()` with no
resolvable API key raises `ValueError` SYNCHRONOUSLY, inside `__init__`,
before any HTTP request is ever built or sent. That is a genuine
behavioral difference from the `anthropic` SDK (whose client constructs
successfully either way and only fails at request time) — see
GeminiCredentialsMissing's docstring in vlm_client.py.

Real `google.genai.errors.ClientError` / `ServerError` instances are
constructed directly here — confirmed they take a plain
`(code: int, response_json: dict)` and need no httpx response object at
all, unlike anthropic's exceptions.
"""

from __future__ import annotations

import json

import httpx
import pytest
from google.genai import errors as genai_errors

from schemas import BBox, DomNode, RedactedRegion
from vlm_client import (
    ACTION_RESPONSE_JSON_SCHEMA,
    DEFAULT_GEMINI_MODEL,
    GeminiAPIError,
    GeminiConnectionError,
    GeminiCredentialsMissing,
    GeminiModelNotFound,
    GeminiRateLimited,
    GeminiVLMClient,
    VLMRequestContext,
    build_prompt,
    list_gemini_models,
)


# ---------------------------------------------------------------------------
# Fakes — stand in for google.genai.Client / its .models resource.
# ---------------------------------------------------------------------------


class FakeModelsResource:
    def __init__(self, response=None, exception=None, models=None):
        self._response = response
        self._exception = exception
        self._models = models or []
        self.last_call_kwargs: dict | None = None
        self.call_count = 0

    def generate_content(self, **kwargs):
        self.last_call_kwargs = kwargs
        self.call_count += 1
        if self._exception is not None:
            raise self._exception
        return self._response

    def list(self, **kwargs):
        return self._models


class FakeGeminiClient:
    """Duck-types the one attribute GeminiVLMClient actually touches:
    `.models.generate_content(...)` (and `.models.list()` for the model-
    discovery helper). Unlike FakeAnthropicClient, there is no `.api_key`
    to fake here — see the module docstring for why credentials-missing
    is tested differently for this backend."""

    def __init__(self, response=None, exception=None, models=None):
        self.models = FakeModelsResource(response=response, exception=exception, models=models)


class FakeResponseText:
    """Stand-in for GenerateContentResponse: only needs a `.text`
    attribute, matching what _extract_action_dict actually reads."""

    def __init__(self, text):
        self.text = text


def _fake_text_response(action_dict: dict) -> FakeResponseText:
    return FakeResponseText(json.dumps(action_dict))


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
    fake = FakeGeminiClient(
        response=_fake_text_response({"action": "click", "targetId": "agent-1", "value": None})
    )
    client = GeminiVLMClient(client=fake)
    nodes = [DomNode(agentId="agent-1", tag="button", type="submit", text="Go")]
    result = client.analyze(_context(nodes))
    assert result == {"action": "click", "targetId": "agent-1", "value": None}


def test_analyze_parses_type_action_with_value():
    fake = FakeGeminiClient(
        response=_fake_text_response({"action": "type", "targetId": "agent-2", "value": "hello"})
    )
    client = GeminiVLMClient(client=fake)
    result = client.analyze(_context([]))
    assert result == {"action": "type", "targetId": "agent-2", "value": "hello"}


def test_analyze_does_not_validate_against_action_response_itself():
    """Single-validation-boundary rule (see VLMClient.analyze's base
    docstring): this class must return the raw dict as-is, even if it
    would fail ActionResponse validation — that check belongs to
    main.py, uniformly across every backend."""
    fake = FakeGeminiClient(
        response=_fake_text_response({"action": "not-a-real-action", "targetId": "x", "value": None})
    )
    client = GeminiVLMClient(client=fake)
    result = client.analyze(_context([]))  # must NOT raise here
    assert result["action"] == "not-a-real-action"


def test_empty_response_text_raises_clear_error():
    fake = FakeGeminiClient(response=FakeResponseText(None))
    client = GeminiVLMClient(client=fake)
    with pytest.raises(ValueError, match="no text"):
        client.analyze(_context([]))


def test_blank_string_response_text_also_raises():
    fake = FakeGeminiClient(response=FakeResponseText(""))
    client = GeminiVLMClient(client=fake)
    with pytest.raises(ValueError, match="no text"):
        client.analyze(_context([]))


# ---------------------------------------------------------------------------
# Request shape: image part present and FIRST, correct mime type.
# ---------------------------------------------------------------------------


def test_request_image_part_is_first_and_text_part_second():
    fake = FakeGeminiClient(response=_fake_text_response(DONE_RESPONSE))
    client = GeminiVLMClient(client=fake)
    ctx = _context([], image_b64="dGVzdC1pbWFnZS1kYXRh")

    client.analyze(ctx)

    contents = fake.models.last_call_kwargs["contents"]
    assert len(contents) == 2
    image_part, text_part = contents
    # google-genai Parts have no explicit "type" discriminator field (unlike
    # Anthropic's content blocks) — which field is populated IS the type.
    assert image_part.inline_data is not None
    assert image_part.text is None
    assert text_part.text is not None
    assert text_part.inline_data is None


def test_request_image_part_uses_png_mime_type_and_decoded_bytes():
    """context.image_b64 is a base64 STRING (the project-wide contract);
    google-genai's Part.from_bytes requires RAW BYTES (confirmed:
    types.Blob.data is typed `bytes`, not str) — so this class must
    decode before constructing the part."""
    import base64

    fake = FakeGeminiClient(response=_fake_text_response(DONE_RESPONSE))
    client = GeminiVLMClient(client=fake)
    ctx = _context([], image_b64="dGVzdC1pbWFnZS1kYXRh")

    client.analyze(ctx)

    image_part = fake.models.last_call_kwargs["contents"][0]
    assert image_part.inline_data.mime_type == "image/png"
    assert image_part.inline_data.data == base64.b64decode("dGVzdC1pbWFnZS1kYXRh")


def test_request_text_part_is_build_prompt_output_verbatim():
    """build_prompt() is REUSED, not rewritten — it is the already
    unit-tested privacy contract (every redacted region named, "do not
    guess" instruction present)."""
    fake = FakeGeminiClient(response=_fake_text_response(DONE_RESPONSE))
    client = GeminiVLMClient(client=fake)
    nodes = [DomNode(agentId="agent-1", tag="input", type="password", text=None, sensitive=True)]
    regions = [RedactedRegion(type="password", bbox=BBox(x=0, y=0, w=10, h=10), agentId="agent-1", source="dom")]
    ctx = _context(nodes, regions, task_goal="Log in")
    expected_prompt = build_prompt("Log in", nodes, regions)

    client.analyze(ctx)

    text_part = fake.models.last_call_kwargs["contents"][1]
    assert text_part.text == expected_prompt
    assert text_part.text == ctx.prompt
    assert "intentionally" in text_part.text.lower()
    assert "privacy" in text_part.text.lower()


# ---------------------------------------------------------------------------
# Request shape: structured output config, no forced thinking, tokens/model.
# ---------------------------------------------------------------------------


def test_request_config_carries_json_schema_mirroring_action_response():
    fake = FakeGeminiClient(response=_fake_text_response(DONE_RESPONSE))
    client = GeminiVLMClient(client=fake)
    client.analyze(_context([]))

    config = fake.models.last_call_kwargs["config"]
    assert config.response_mime_type == "application/json"
    assert config.response_json_schema == ACTION_RESPONSE_JSON_SCHEMA


def test_action_response_json_schema_is_shared_single_source_of_truth():
    """The exact same schema object/content used for the Claude backend
    is reused here — not hand-duplicated."""
    from vlm_client import ACTION_RESPONSE_JSON_SCHEMA as SCHEMA_REF

    assert SCHEMA_REF is ACTION_RESPONSE_JSON_SCHEMA
    assert set(ACTION_RESPONSE_JSON_SCHEMA["properties"]["action"]["enum"]) == {
        "click",
        "type",
        "scroll",
        "done",
    }


def test_request_does_not_set_thinking_config():
    """Deliberately omitted (see the code comment in analyze()): forcing
    thinking_budget=0 unconditionally risks a 400 on a model that doesn't
    support thinking at all, stacked on top of an already-unverified
    model id."""
    fake = FakeGeminiClient(response=_fake_text_response(DONE_RESPONSE))
    client = GeminiVLMClient(client=fake)
    client.analyze(_context([]))
    config = fake.models.last_call_kwargs["config"]
    assert config.thinking_config is None


def test_request_max_output_tokens_is_2048_by_default():
    fake = FakeGeminiClient(response=_fake_text_response(DONE_RESPONSE))
    client = GeminiVLMClient(client=fake)
    client.analyze(_context([]))
    config = fake.models.last_call_kwargs["config"]
    assert config.max_output_tokens == 2048


def test_request_max_output_tokens_override_is_respected():
    fake = FakeGeminiClient(response=_fake_text_response(DONE_RESPONSE))
    client = GeminiVLMClient(client=fake, max_output_tokens=4096)
    client.analyze(_context([]))
    config = fake.models.last_call_kwargs["config"]
    assert config.max_output_tokens == 4096


def test_model_defaults_to_gemini_2_0_flash(monkeypatch):
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    client = GeminiVLMClient()
    assert client.model == "gemini-2.0-flash"
    assert client.model == DEFAULT_GEMINI_MODEL


def test_model_overridable_via_gemini_model_env_var(monkeypatch):
    monkeypatch.setenv("GEMINI_MODEL", "gemini-some-other-model")
    client = GeminiVLMClient()
    assert client.model == "gemini-some-other-model"


def test_model_explicit_constructor_arg_wins_over_env_var(monkeypatch):
    monkeypatch.setenv("GEMINI_MODEL", "gemini-env-model")
    client = GeminiVLMClient(model="gemini-explicit-model")
    assert client.model == "gemini-explicit-model"


def test_request_uses_the_resolved_model_id():
    fake = FakeGeminiClient(response=_fake_text_response(DONE_RESPONSE))
    client = GeminiVLMClient(client=fake, model="gemini-custom-test-model")
    client.analyze(_context([]))
    assert fake.models.last_call_kwargs["model"] == "gemini-custom-test-model"


# ---------------------------------------------------------------------------
# Credentials: fail BEFORE any call, clear + actionable, naming the env var.
#
# These tests do NOT inject a fake client — they exercise the real
# genai.Client() construction path with both env vars removed. This is
# still network-free (verified: the SDK raises ValueError synchronously,
# client-side, before any request is built) — see the module docstring.
# ---------------------------------------------------------------------------


def test_missing_credentials_raises_clear_actionable_error_naming_env_var(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    client = GeminiVLMClient()  # no injected client — real genai.Client() path

    with pytest.raises(GeminiCredentialsMissing) as excinfo:
        client.analyze(_context([]))

    assert "GEMINI_API_KEY" in str(excinfo.value)


def test_missing_credentials_never_makes_it_past_construction(monkeypatch):
    """No injected client means no way to count "calls" the way the
    Claude fake does — the assertion here IS the exception itself: if
    construction had somehow succeeded and a network call were attempted,
    it would hang or fail very differently (DNS/connection error) rather
    than raising this specific, fast, clearly-worded exception."""
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    client = GeminiVLMClient()

    with pytest.raises(GeminiCredentialsMissing):
        client.analyze(_context([]))


def test_present_api_key_lets_construction_succeed(monkeypatch):
    """Confirms the credentials check is specifically about ABSENCE, not
    a blanket failure — a syntactically-present (fake) key must let
    genai.Client() construct without raising GeminiCredentialsMissing.
    (It will still fail later for other reasons if actually used over the
    network with a fake key — that's a ClientError/AuthenticationError-
    shaped failure, not a credentials-missing one, and is out of scope
    for this offline test.)

    Note: `.api_key` lives on the Client's internal `_api_client`
    (confirmed empirically), not as a public top-level attribute — so
    this test checks that construction plainly succeeds and returns a
    real genai.Client, rather than reaching into a private attribute."""
    from google import genai

    monkeypatch.setenv("GEMINI_API_KEY", "fake-key-for-construction-only")
    client = GeminiVLMClient()
    real_client = client._get_client()  # must not raise GeminiCredentialsMissing
    assert isinstance(real_client, genai.Client)
    assert real_client._api_client.api_key == "fake-key-for-construction-only"


def test_factory_selecting_gemini_never_instantiates_a_live_client(monkeypatch):
    """Constructing GeminiVLMClient (as get_vlm_client() does for
    VLM_BACKEND=gemini) must not touch genai.Client()'s credential
    resolution at all — only analyze() does, lazily, on first real use."""
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    client = GeminiVLMClient()  # must not raise, even with no key present
    assert client._injected_client is None  # nothing constructed yet


# ---------------------------------------------------------------------------
# Error handling: ClientError/.code/.status dispatch, ServerError, and raw
# httpx.HTTPError for connection failures — google-genai's ACTUAL (flat)
# exception hierarchy, not a copy of Claude's class-per-error-type design.
# ---------------------------------------------------------------------------


def test_rate_limit_client_error_wrapped_as_gemini_rate_limited():
    exc = genai_errors.ClientError(429, {"code": 429, "status": "RESOURCE_EXHAUSTED", "message": "quota"})
    fake = FakeGeminiClient(exception=exc)
    client = GeminiVLMClient(client=fake)
    with pytest.raises(GeminiRateLimited, match="free tier"):
        client.analyze(_context([]))


def test_rate_limit_detected_by_code_even_without_status_string():
    """Distinguish by .code as a fallback in case .status isn't populated
    (e.g. a non-JSON or unexpected error body)."""
    exc = genai_errors.ClientError(429, {"code": 429, "message": "quota exceeded"})
    fake = FakeGeminiClient(exception=exc)
    client = GeminiVLMClient(client=fake)
    with pytest.raises(GeminiRateLimited):
        client.analyze(_context([]))


def test_not_found_client_error_wrapped_as_gemini_model_not_found():
    exc = genai_errors.ClientError(404, {"code": 404, "status": "NOT_FOUND", "message": "model not found"})
    fake = FakeGeminiClient(exception=exc)
    client = GeminiVLMClient(client=fake)
    with pytest.raises(GeminiModelNotFound, match="list_gemini_models"):
        client.analyze(_context([]))


def test_other_client_error_wrapped_as_gemini_api_error():
    """403 PERMISSION_DENIED is neither rate-limit nor not-found — must
    fall through to the general branch, not be silently mis-caught."""
    exc = genai_errors.ClientError(403, {"code": 403, "status": "PERMISSION_DENIED", "message": "denied"})
    fake = FakeGeminiClient(exception=exc)
    client = GeminiVLMClient(client=fake)
    with pytest.raises(GeminiAPIError):
        client.analyze(_context([]))


def test_server_error_wrapped_as_gemini_api_error():
    exc = genai_errors.ServerError(500, {"code": 500, "status": "INTERNAL", "message": "internal error"})
    fake = FakeGeminiClient(exception=exc)
    client = GeminiVLMClient(client=fake)
    with pytest.raises(GeminiAPIError):
        client.analyze(_context([]))


def test_connection_error_wrapped_as_gemini_connection_error():
    """google-genai does not wrap transport-level failures — they
    propagate as raw httpx.HTTPError subclasses straight from the
    underlying send() call."""
    exc = httpx.ConnectError("Connection refused")
    fake = FakeGeminiClient(exception=exc)
    client = GeminiVLMClient(client=fake)
    with pytest.raises(GeminiConnectionError):
        client.analyze(_context([]))


def test_timeout_error_also_wrapped_as_gemini_connection_error():
    exc = httpx.ReadTimeout("Read timed out")
    fake = FakeGeminiClient(exception=exc)
    client = GeminiVLMClient(client=fake)
    with pytest.raises(GeminiConnectionError):
        client.analyze(_context([]))


def test_error_branches_are_distinguishable_by_exception_type():
    cases = [
        (genai_errors.ClientError(429, {"code": 429, "status": "RESOURCE_EXHAUSTED"}), GeminiRateLimited),
        (genai_errors.ClientError(404, {"code": 404, "status": "NOT_FOUND"}), GeminiModelNotFound),
        (genai_errors.ClientError(403, {"code": 403, "status": "PERMISSION_DENIED"}), GeminiAPIError),
        (genai_errors.ServerError(503, {"code": 503, "status": "UNAVAILABLE"}), GeminiAPIError),
        (httpx.ConnectError("refused"), GeminiConnectionError),
    ]
    for sdk_exc, expected_wrapper in cases:
        fake = FakeGeminiClient(exception=sdk_exc)
        client = GeminiVLMClient(client=fake)
        with pytest.raises(expected_wrapper):
            client.analyze(_context([]))

    assert len({GeminiRateLimited, GeminiModelNotFound, GeminiAPIError, GeminiConnectionError}) == 4


def test_all_gemini_error_types_are_runtimeerror_subclasses():
    """So main.py's existing generic `except Exception as exc`
    backend-call-failure handling continues to work unmodified for this
    backend too — no main.py change was needed to add Gemini support."""
    for wrapper in (GeminiModelNotFound, GeminiRateLimited, GeminiAPIError, GeminiConnectionError):
        assert issubclass(wrapper, RuntimeError)


# ---------------------------------------------------------------------------
# Model-discovery helper (the safety net for an unverified default model id)
# ---------------------------------------------------------------------------


def test_list_gemini_models_uses_injected_client_without_network():
    class FakeModel:
        def __init__(self, name):
            self.name = name

    fake = FakeGeminiClient(models=[FakeModel("models/gemini-2.0-flash"), FakeModel("models/gemini-9-ultra")])
    names = list_gemini_models(client=fake)
    assert names == ["models/gemini-2.0-flash", "models/gemini-9-ultra"]


def test_list_gemini_models_skips_unnamed_entries():
    class FakeModel:
        def __init__(self, name):
            self.name = name

    fake = FakeGeminiClient(models=[FakeModel(None), FakeModel("models/gemini-2.0-flash")])
    assert list_gemini_models(client=fake) == ["models/gemini-2.0-flash"]


def test_gemini_model_not_found_message_points_at_the_discovery_helper():
    """The whole point of this requirement: a wrong hardcoded model id must not
    fail opaquely — the error has to say how to find a real one."""
    exc = genai_errors.ClientError(404, {"code": 404, "status": "NOT_FOUND"})
    fake = FakeGeminiClient(exception=exc)
    client = GeminiVLMClient(client=fake)
    with pytest.raises(GeminiModelNotFound) as excinfo:
        client.analyze(_context([]))
    message = str(excinfo.value)
    assert "list_gemini_models" in message
    assert "GEMINI_MODEL" in message


# ---------------------------------------------------------------------------
# Section 5 egress check: this is now a real network call to a third
# party. Confirm the outgoing request carries ONLY the redacted image and
# the sanitized prompt this class was handed — nothing additional.
# ---------------------------------------------------------------------------

SENTINEL = "SENTINEL-GEMINI-EGRESS-2c8b17"


def test_outgoing_request_carries_exactly_the_redacted_image_and_sanitized_prompt():
    """A realistic sanitized snapshot: the sensitive node's raw value has
    already been stripped upstream (text=None), exactly as main.py's
    find_pii_leaks() gate requires before this class ever runs. Confirm
    the request's contents are EXACTLY [image part built from
    context.image_b64 verbatim, text part built from context.prompt
    verbatim] — no extra fields, no raw dom dump appended by this class."""
    import base64

    fake = FakeGeminiClient(response=_fake_text_response(DONE_RESPONSE))
    client = GeminiVLMClient(client=fake)

    nodes = [
        DomNode(agentId="agent-1", tag="input", type="password", text=None, sensitive=True),
        DomNode(agentId="agent-2", tag="button", type="submit", text="Log in"),
    ]
    regions = [RedactedRegion(type="password", bbox=BBox(x=0, y=0, w=10, h=10), agentId="agent-1", source="dom")]
    ctx = _context(nodes, regions, task_goal="Log in", image_b64="UkVEQUNURUQtSU1BR0UtQllURVM=")

    client.analyze(ctx)

    contents = fake.models.last_call_kwargs["contents"]
    assert len(contents) == 2
    assert contents[0].inline_data.data == base64.b64decode(ctx.image_b64)
    assert contents[0].inline_data.mime_type == "image/png"
    assert contents[1].text == ctx.prompt

    # Whole outgoing call, serialized: no stray sentinel value present.
    full_request_repr = json.dumps(
        {
            "model": fake.models.last_call_kwargs["model"],
            "text_part": contents[1].text,
            "image_len": len(contents[0].inline_data.data),
            "config": fake.models.last_call_kwargs["config"].model_dump(mode="json"),
        },
        default=str,
    )
    assert SENTINEL not in full_request_repr


def test_outgoing_request_never_independently_serializes_dom_snapshot_or_redacted_regions():
    """GeminiVLMClient receives the full VLMRequestContext (including
    dom_snapshot/redacted_regions as Pydantic objects) but must only ever
    transmit the pre-built context.prompt text and context.image_b64 —
    never dump the raw DomNode/RedactedRegion objects themselves into the
    request (which would bypass build_prompt()'s redaction-aware
    formatting entirely)."""
    fake = FakeGeminiClient(response=_fake_text_response(DONE_RESPONSE))
    client = GeminiVLMClient(client=fake)

    nodes = [DomNode(agentId="agent-1", tag="input", type="password", text=None, sensitive=True)]
    regions = [RedactedRegion(type="password", bbox=BBox(x=0, y=0, w=10, h=10), agentId="agent-1", source="dom")]
    ctx = _context(nodes, regions, task_goal="Log in")

    client.analyze(ctx)

    kwargs = fake.models.last_call_kwargs
    assert set(kwargs.keys()) <= {"model", "contents", "config"}
    assert len(kwargs["contents"]) == 2  # exactly image + text, nothing per-node appended
