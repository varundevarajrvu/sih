"""V3 (planner-local): tests for the tightened POST /v2/analyze Ollama
client (docs/v2/ARCHITECTURE.md contract C5, this agent's brief item 3).

All network calls are stubbed via monkeypatching `httpx.post` inside
vlm_client -- no real Ollama server is required for this file (the real,
live benchmark lives in benchmarks/bench_v3_planner.py and writes
benchmarks/results/v3-planner.json; this file only proves the CLIENT
constructs the right request and handles Ollama's response correctly).
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

import vlm_client as vlm_module
from schemas_v2 import ElementV2, SceneMode
from vlm_client import (
    DEFAULT_OLLAMA_TEXT_MODEL_V2,
    MODEL_ACTION_V2_JSON_SCHEMA,
    OllamaVLMClient,
    VLMRequestContextV2,
    build_prompt_v2,
    build_prompt_v2_concise,
    _build_ollama_action_schema,
    _element_allowed_actions,
    _estimate_ollama_num_ctx,
)


def _context(mode=SceneMode.SEMANTIC, elements=None, regions=None, history=None, image_b64=None):
    elements = elements or []
    regions = regions or []
    history = history or []
    verbose_prompt = build_prompt_v2(
        mode=mode, task_goal="do the task", elements=elements, regions=regions, history=history
    )
    return VLMRequestContextV2(
        mode=mode,
        task_goal="do the task",
        elements=elements,
        regions=regions,
        history=history,
        image_b64=image_b64,
        prompt=verbose_prompt,
    )


class _FakeResponse:
    def __init__(self, status_code: int, body: dict[str, Any]):
        self.status_code = status_code
        self._body = body
        self.request = httpx.Request("POST", "http://127.0.0.1:11434/api/generate")

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                f"status {self.status_code}", request=self.request,
                response=httpx.Response(self.status_code, request=self.request),
            )

    def json(self) -> dict[str, Any]:
        return self._body


def _ok_body(action_dict: dict[str, Any], **extra: Any) -> dict[str, Any]:
    body = {
        "response": json.dumps(action_dict),
        "prompt_eval_count": 42,
        "eval_count": 7,
        "total_duration": 1_500_000_000,
        "load_duration": 100_000_000,
    }
    body.update(extra)
    return body


# ---------------------------------------------------------------------------
# Concise prompt -- substance preserved, used instead of context.prompt
# ---------------------------------------------------------------------------


def test_concise_prompt_is_shorter_than_the_verbose_one():
    ctx = _context()
    assert len(build_prompt_v2_concise(ctx)) < len(ctx.prompt)


def test_concise_prompt_keeps_token_verbatim_instruction():
    ctx = _context()
    prompt = build_prompt_v2_concise(ctx)
    assert "VERBATIM" in prompt
    assert "TOKEN" in prompt.upper()


def test_concise_prompt_keeps_privacy_do_not_guess_instruction():
    from schemas_v2 import BBox, RegionKind, RegionSourceV2, RegionV2

    ctx = _context(regions=[RegionV2(kind=RegionKind.PASSWORD, bbox=BBox(x=1, y=2, w=3, h=4), source=RegionSourceV2.DOM)])
    prompt = build_prompt_v2_concise(ctx)
    assert "do not guess" in prompt.lower()


def test_concise_prompt_includes_need_visual_only_in_semantic_mode():
    semantic = build_prompt_v2_concise(_context(mode=SceneMode.SEMANTIC))
    image = build_prompt_v2_concise(_context(mode=SceneMode.IMAGE, image_b64="aGVsbG8="))
    assert "need_visual" in semantic
    assert "NEED_VISUAL" not in image


def test_concise_prompt_json_only_output_instruction_present():
    prompt = build_prompt_v2_concise(_context())
    assert '"action"' in prompt
    assert "press_key" in prompt


def test_concise_prompt_no_longer_offers_fill_profile():
    """V3 retry item (a): fill_profile is removed from the model-facing v2
    prompt entirely -- it is subsumed by PROFILE...#n vault tokens (C2),
    which the generic TOKENS instruction already covers. schemas_v2's
    ActionTypeV2 (the wire contract) still has the enum member for
    back-compat; only this LOCAL PLANNER prompt drops it."""
    prompt = build_prompt_v2_concise(_context())
    assert "fill_profile" not in prompt
    assert "profileField" not in prompt


def test_concise_prompt_mentions_profile_tokens_as_ordinary_tokens():
    prompt = build_prompt_v2_concise(_context())
    assert "PROFILE" in prompt


def test_concise_prompt_includes_few_shot_examples_for_type_and_click():
    prompt = build_prompt_v2_concise(_context())
    assert "EXAMPLES:" in prompt
    assert '"action":"type"' in prompt
    assert '"action":"click"' in prompt


def test_concise_prompt_few_shot_examples_are_neutral_not_personname():
    """V3 retry 2 item 3: neither example may use a PERSONNAME/EMAIL/
    PASSWORD/PROFILE-shaped token -- retry 1's benchmark showed a model
    inventing a PERSONNAME-shaped token that existed nowhere in the real
    request, most likely by pattern-copying a few-shot example. Scoped to
    the EXAMPLES section specifically -- the TOKENS instruction earlier in
    the prompt legitimately still cites PERSONNAME#2/PROFILENAME#1 as
    abstract illustrations of the token GRAMMAR, which is not the same
    thing as a copyable few-shot demonstration."""
    prompt = build_prompt_v2_concise(_context())
    examples_section = prompt.split("EXAMPLES:", 1)[1]
    for forbidden in ("PERSONNAME", "EMAIL#", "PASSWORD#", "PROFILE"):
        assert forbidden not in examples_section


def test_concise_prompt_type_example_token_appears_in_its_own_example_goal():
    """The type example's echoed token (QUERY#1) must appear in that
    SAME example's own goal text -- the lesson taught is "copy a token
    you were given," never "produce a token-shaped string on your own"."""
    prompt = build_prompt_v2_concise(_context())
    example_line = next(line for line in prompt.splitlines() if '"action":"type"' in line)
    assert "QUERY#1" in example_line


def test_concise_prompt_renders_allowed_actions_per_element():
    text_el = ElementV2(agentId="agent-1", tag="input", type="email", sensitive=False)
    button_el = ElementV2(agentId="agent-2", tag="button", sensitive=False)
    prompt = build_prompt_v2_concise(_context(elements=[text_el, button_el]))
    assert "agentId=agent-1" in prompt and "allowedActions=[type]" in prompt
    assert "agentId=agent-2" in prompt and "allowedActions=[click]" in prompt


# ---------------------------------------------------------------------------
# _element_allowed_actions -- the per-element type/click classification
# ---------------------------------------------------------------------------


def test_allowed_actions_text_like_inputs():
    for el_type in ("text", "email", "tel", "search", "password", "number", "url"):
        el = ElementV2(agentId="agent-1", tag="input", type=el_type)
        assert _element_allowed_actions(el) == ["type"]


def test_allowed_actions_textarea_and_textbox_role():
    assert _element_allowed_actions(ElementV2(agentId="a", tag="textarea")) == ["type"]
    assert _element_allowed_actions(ElementV2(agentId="a", tag="div", role="textbox")) == ["type"]


def test_allowed_actions_buttons_links_selects():
    assert _element_allowed_actions(ElementV2(agentId="a", tag="button")) == ["click"]
    assert _element_allowed_actions(ElementV2(agentId="a", tag="a")) == ["click"]
    assert _element_allowed_actions(ElementV2(agentId="a", tag="select")) == ["click"]


def test_allowed_actions_checkbox_and_submit_inputs():
    for el_type in ("checkbox", "radio", "submit", "button"):
        el = ElementV2(agentId="a", tag="input", type=el_type)
        assert _element_allowed_actions(el) == ["click"]


def test_allowed_actions_unknown_element_is_permissive():
    el = ElementV2(agentId="a", tag="custom-widget")
    assert set(_element_allowed_actions(el)) == {"click", "type"}


# ---------------------------------------------------------------------------
# num_ctx sizing
# ---------------------------------------------------------------------------


def test_num_ctx_rounds_up_and_is_never_smaller_than_the_prompt():
    short = _estimate_ollama_num_ctx("hi")
    assert short == 512

    long_prompt = "x" * 5000  # ~1250 estimated tokens + 256 headroom
    assert _estimate_ollama_num_ctx(long_prompt) >= 2048


def test_num_ctx_monotonic_in_prompt_length():
    small = _estimate_ollama_num_ctx("x" * 100)
    big = _estimate_ollama_num_ctx("x" * 100_000)
    assert big > small


# ---------------------------------------------------------------------------
# Request shape: format schema, temperature 0 default, num_ctx, keep_alive
# ---------------------------------------------------------------------------


def test_ollama_v2_sends_json_schema_format_and_temperature_zero_by_default(monkeypatch):
    captured: dict[str, Any] = {}

    def _fake_post(url, json, timeout):  # noqa: A002 - matches httpx.post's kwarg name
        captured["url"] = url
        captured["payload"] = json
        captured["timeout"] = timeout
        return _FakeResponse(200, _ok_body({"action": "done", "targetId": "page", "value": None, "profileField": None, "key": None}))

    monkeypatch.delenv("OLLAMA_TEMPERATURE", raising=False)
    monkeypatch.setattr(httpx, "post", _fake_post)

    client = OllamaVLMClient()
    result = client.analyze_v2(_context())

    assert result["action"] == "done"
    payload = captured["payload"]
    # V3 retry item (c): format is a PER-REQUEST schema now, not the
    # static MODEL_ACTION_V2_JSON_SCHEMA constant (that one stays fixed
    # for Claude/Gemini's output_config). Assert on shape/content instead
    # of identity.
    fmt = payload["format"]
    assert isinstance(fmt, dict)
    assert fmt["properties"]["action"]["enum"] == list(vlm_module._OLLAMA_MODEL_FACING_ACTIONS)
    assert "fill_profile" not in fmt["properties"]["action"]["enum"]
    assert "profileField" not in fmt["properties"]
    assert payload["options"]["temperature"] == 0.0
    assert "num_ctx" in payload["options"]
    assert payload["keep_alive"] == "10m"
    assert payload["stream"] is False
    # The CONCISE prompt was sent, not context.prompt (the verbose one).
    assert "STRUCTURE only" in payload["prompt"]


def test_ollama_v2_temperature_is_overridable(monkeypatch):
    captured: dict[str, Any] = {}

    def _fake_post(url, json, timeout):
        captured["payload"] = json
        return _FakeResponse(200, _ok_body({"action": "done", "targetId": "page", "value": None, "profileField": None, "key": None}))

    monkeypatch.setenv("OLLAMA_TEMPERATURE", "0.4")
    monkeypatch.setattr(httpx, "post", _fake_post)

    OllamaVLMClient().analyze_v2(_context())
    assert captured["payload"]["options"]["temperature"] == 0.4


def test_ollama_v2_keep_alive_is_overridable(monkeypatch):
    captured: dict[str, Any] = {}

    def _fake_post(url, json, timeout):
        captured["payload"] = json
        return _FakeResponse(200, _ok_body({"action": "done", "targetId": "page", "value": None, "profileField": None, "key": None}))

    monkeypatch.setenv("OLLAMA_KEEP_ALIVE", "30m")
    monkeypatch.setattr(httpx, "post", _fake_post)

    OllamaVLMClient().analyze_v2(_context())
    assert captured["payload"]["keep_alive"] == "30m"


def test_ollama_v2_text_model_env_and_default(monkeypatch):
    captured: dict[str, Any] = {}

    def _fake_post(url, json, timeout):
        captured["payload"] = json
        return _FakeResponse(200, _ok_body({"action": "done", "targetId": "page", "value": None, "profileField": None, "key": None}))

    monkeypatch.delenv("OLLAMA_TEXT_MODEL", raising=False)
    monkeypatch.setattr(httpx, "post", _fake_post)
    OllamaVLMClient().analyze_v2(_context(mode=SceneMode.SEMANTIC))
    assert captured["payload"]["model"] == DEFAULT_OLLAMA_TEXT_MODEL_V2

    monkeypatch.setenv("OLLAMA_TEXT_MODEL", "qwen2.5:1.5b")
    OllamaVLMClient().analyze_v2(_context(mode=SceneMode.SEMANTIC))
    assert captured["payload"]["model"] == "qwen2.5:1.5b"


def test_ollama_v2_image_mode_uses_vl_model_default_and_sends_image(monkeypatch):
    captured: dict[str, Any] = {}

    def _fake_post(url, json, timeout):
        captured["payload"] = json
        return _FakeResponse(200, _ok_body({"action": "done", "targetId": "page", "value": None, "profileField": None, "key": None}))

    monkeypatch.delenv("OLLAMA_VL_MODEL", raising=False)
    monkeypatch.setattr(httpx, "post", _fake_post)

    OllamaVLMClient().analyze_v2(_context(mode=SceneMode.IMAGE, image_b64="aGVsbG8="))
    assert captured["payload"]["model"] == "qwen2.5vl:3b"
    assert captured["payload"]["images"] == ["aGVsbG8="]


# ---------------------------------------------------------------------------
# Format fallback: 400/422 on the schema attempt -> retry with "json"
# ---------------------------------------------------------------------------


def test_ollama_v2_falls_back_to_plain_json_format_on_400(monkeypatch):
    calls: list[Any] = []

    def _fake_post(url, json, timeout):
        calls.append(json["format"])
        if json["format"] != "json":
            return _FakeResponse(400, {"error": "format not supported"})
        return _FakeResponse(200, _ok_body({"action": "done", "targetId": "page", "value": None, "profileField": None, "key": None}))

    monkeypatch.setattr(httpx, "post", _fake_post)
    result = OllamaVLMClient().analyze_v2(_context())

    assert result["action"] == "done"
    assert len(calls) == 2
    assert isinstance(calls[0], dict)  # the per-request schema, tried first
    assert calls[1] == "json"


# ---------------------------------------------------------------------------
# Per-request schema content (V3 retry item (c))
# ---------------------------------------------------------------------------


def test_ollama_action_schema_excludes_fill_profile():
    schema = _build_ollama_action_schema([])
    assert "fill_profile" not in schema["properties"]["action"]["enum"]
    assert set(schema["properties"]["action"]["enum"]) == {
        "click", "type", "scroll", "press_key", "done", "need_visual",
    }
    assert "profileField" not in schema["properties"]
    assert "profileField" not in schema["required"]


def test_ollama_action_schema_target_id_enum_matches_scene_plus_page():
    elements = [
        ElementV2(agentId="agent-1", tag="input", type="text"),
        ElementV2(agentId="agent-2", tag="button"),
    ]
    schema = _build_ollama_action_schema(elements)
    assert set(schema["properties"]["targetId"]["enum"]) == {"agent-1", "agent-2", "page"}


def test_ollama_action_schema_target_id_enum_is_page_only_for_empty_scene():
    schema = _build_ollama_action_schema([])
    assert schema["properties"]["targetId"]["enum"] == ["page"]


def test_ollama_v2_sends_scene_specific_schema(monkeypatch):
    """Confirms the schema built for a real request actually varies per
    scene (not a cached/static object) -- directly targets qwen2.5:3b's
    observed failure of hallucinating a non-existent targetId string."""
    captured: dict[str, Any] = {}

    def _fake_post(url, json, timeout):
        captured["payload"] = json
        return _FakeResponse(200, _ok_body({"action": "click", "targetId": "agent-7", "value": None, "key": None}))

    monkeypatch.setattr(httpx, "post", _fake_post)
    elements = [ElementV2(agentId="agent-7", tag="button")]
    OllamaVLMClient().analyze_v2(_context(elements=elements))

    assert captured["payload"]["format"]["properties"]["targetId"]["enum"] == ["agent-7", "page"]


def test_ollama_v2_does_not_fall_back_on_a_404(monkeypatch):
    """A 404 (unknown model) is a REAL failure, not a format-incompatibility
    signal -- must propagate, not be masked by a silent retry."""

    def _fake_post(url, json, timeout):
        return _FakeResponse(404, {"error": "model not found"})

    monkeypatch.setattr(httpx, "post", _fake_post)
    with pytest.raises(httpx.HTTPStatusError):
        OllamaVLMClient().analyze_v2(_context())


# ---------------------------------------------------------------------------
# Invariant 4: a down/unreachable Ollama raises, never falls back silently
# ---------------------------------------------------------------------------


def test_ollama_v2_connection_error_propagates_and_never_calls_cloud(monkeypatch):
    claude_spy_called: list[int] = []
    gemini_spy_called: list[int] = []

    def _forbidden_claude(self, ctx):  # pragma: no cover - must never run
        claude_spy_called.append(1)
        raise AssertionError("cloud backend must never be called when Ollama is down")

    def _forbidden_gemini(self, ctx):  # pragma: no cover - must never run
        gemini_spy_called.append(1)
        raise AssertionError("cloud backend must never be called when Ollama is down")

    monkeypatch.setattr(vlm_module.ClaudeVLMClient, "analyze_v2", _forbidden_claude)
    monkeypatch.setattr(vlm_module.GeminiVLMClient, "analyze_v2", _forbidden_gemini)

    def _raise_connect_error(url, json, timeout):
        raise httpx.ConnectError("connection refused", request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", _raise_connect_error)

    client = OllamaVLMClient(base_url="http://127.0.0.1:1")
    with pytest.raises(httpx.ConnectError):
        client.analyze_v2(_context())

    assert claude_spy_called == []
    assert gemini_spy_called == []


# ---------------------------------------------------------------------------
# Metrics logging: opt-in only, no-op by default
# ---------------------------------------------------------------------------


def test_ollama_v2_metrics_log_is_opt_in(monkeypatch, tmp_path):
    def _fake_post(url, json, timeout):
        return _FakeResponse(200, _ok_body({"action": "done", "targetId": "page", "value": None, "profileField": None, "key": None}))

    monkeypatch.setattr(httpx, "post", _fake_post)

    # Unset (default): no file activity, must not raise.
    monkeypatch.delenv("OLLAMA_METRICS_LOG_V2", raising=False)
    OllamaVLMClient().analyze_v2(_context())

    # Set: a JSON line is appended with Ollama's own token counts.
    log_path = tmp_path / "metrics.jsonl"
    monkeypatch.setenv("OLLAMA_METRICS_LOG_V2", str(log_path))
    OllamaVLMClient().analyze_v2(_context())

    lines = log_path.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1
    record = json.loads(lines[0])
    assert record["prompt_eval_count"] == 42
    assert record["eval_count"] == 7
    assert record["model"]
    assert record["used_schema_format"] is True
