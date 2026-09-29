"""Regression test for the V3/V4 integration gap found 2026-09-27
(docs/v2/ARCHITECTURE.md's "V4 real local planner (first live run)" row).

Root causes found, both fixed here / in server/vlm_client.py:

1. `DEFAULT_OLLAMA_TEXT_MODEL_V2` (server/vlm_client.py) was left at V3
   run 1's flagged, non-passing "highest scorer, 4/15" pick
   (`qwen2.5:1.5b`) through retry 1 and retry 2, even after retry 2
   PASSED the gate with `llama3.1:8b` 15/15 (`chosen_default_model` in
   benchmarks/results/v3-planner-retry2.json). `start-demo.ps1 -Planner
   local` never sets `OLLAMA_TEXT_MODEL`, so every live run silently
   fell back to the worst-scoring model instead of the one the gate
   actually validated -- confirmed live via Ollama's own `GET /api/ps`
   reporting `qwen2.5:1.5b` loaded during a run whose own logging
   claimed `llama3.1:8b`. This is what turned V3's validated `type
   agent-4 PERSONNAME#1` into the live run's `click agent-4`.
2. The real extension's request body was diffed against the hand-written
   V3 fixture (tests/fixtures/v2/planner/scenario-1-fill-name.json) --
   NOT the cause of the above; the two are structurally near-identical
   (see the live-captured fixture's own `_fixture_notes`). This test
   exists so that future drift between "what the extension actually
   sends" and "what the benchmark/fixtures assume" is caught by
   `node --test`/pytest, not discovered by a live Ollama run again.

Test 1 pins the config: DEFAULT_OLLAMA_TEXT_MODEL_V2 must track V3's own
gate result file, not silently drift again. Test 2 pushes a REAL,
extension-captured request body (not a hand-authored approximation)
through AnalyzeRequestV2 validation + the exact prompt/schema path
OllamaVLMClient.analyze_v2 uses, end to end with httpx stubbed --
proving the live request shape parses and plans correctly through the
same code the fixture-based V3 benchmark exercised.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import pytest

from schemas_v2 import AnalyzeRequestV2
from vlm_client import (
    DEFAULT_OLLAMA_TEXT_MODEL_V2,
    OllamaVLMClient,
    VLMRequestContextV2,
    build_prompt_v2_concise,
)

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
V3_RETRY2_RESULTS = REPO_ROOT / "benchmarks" / "results" / "v3-planner-retry2.json"
LIVE_FIXTURE = "v2/planner/scenario-1-fill-name-live-captured.json"


def test_default_ollama_text_model_matches_v3s_own_chosen_default():
    """The regression guard for the actual bug: DEFAULT_OLLAMA_TEXT_MODEL_V2
    must equal whatever benchmarks/results/v3-planner-retry2.json (the
    pre-registered, gate-passing benchmark) recorded as
    `chosen_default_model`. If V3 is ever re-run and a different model
    passes the gate, THIS constant must move with it -- a silent
    mismatch here is exactly the bug this test file is named for."""
    assert V3_RETRY2_RESULTS.exists(), (
        f"{V3_RETRY2_RESULTS} is missing -- V3's gate result is the single "
        "source of truth DEFAULT_OLLAMA_TEXT_MODEL_V2 must track."
    )
    data = json.loads(V3_RETRY2_RESULTS.read_text(encoding="utf-8"))
    assert data["gate_passed"] is True, "V3's retry-2 gate is recorded as failed -- nothing should be defaulted from it"
    assert DEFAULT_OLLAMA_TEXT_MODEL_V2 == data["chosen_default_model"]


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


def test_live_captured_request_flows_through_the_same_prompt_path_as_the_fixture(load_fixture, monkeypatch):
    """The real extension's step-1 request body (captured via the
    temporary V2_CAPTURE_DIR hook during the live-bench investigation,
    not hand-written) must: (a) validate as AnalyzeRequestV2 exactly like
    the hand-written fixture does, (b) build a prompt via
    build_prompt_v2_concise carrying the tokenized goal and every real
    agentId, and (c) drive OllamaVLMClient.analyze_v2 to call Ollama with
    model == DEFAULT_OLLAMA_TEXT_MODEL_V2 when OLLAMA_TEXT_MODEL is unset
    -- the exact call shape the V3 benchmark validated, now proven
    against a real captured payload instead of only a hand-written one.
    """
    raw = load_fixture(LIVE_FIXTURE)
    body = {k: v for k, v in raw.items() if k not in ("expected", "_fixture_notes")}

    # (a) the real extension's payload still validates against the
    # current AnalyzeRequestV2 schema -- a schema/element-shape drift
    # would fail here first, not as a live 422 during a demo.
    request = AnalyzeRequestV2.model_validate(body)
    assert [el.agentId for el in request.elements] == ["agent-1", "agent-2", "agent-3", "agent-4", "agent-5"]
    assert request.taskGoal == "fill the name as PERSONNAME#1"

    # (b) same prompt builder the OllamaVLMClient backend actually uses.
    ctx = VLMRequestContextV2(
        mode=request.mode, task_goal=request.taskGoal, elements=request.elements,
        regions=request.regions, history=request.history, vault=request.vault,
        image_b64=request.image, prompt="",
    )
    prompt = build_prompt_v2_concise(ctx)
    assert "PERSONNAME#1" in prompt
    assert "agent-4" in prompt
    assert "'Enter your full name'" in prompt

    # (c) end to end through the real client, network stubbed -- proves
    # this exact live-shaped context drives the right model selection.
    captured: dict[str, Any] = {}

    def _fake_post(url, json, timeout):
        captured["payload"] = json
        return _FakeResponse(200, {
            "response": '{"action":"type","targetId":"agent-4","value":"PERSONNAME#1","key":null}',
            "prompt_eval_count": 1, "eval_count": 1,
        })

    monkeypatch.delenv("OLLAMA_TEXT_MODEL", raising=False)
    monkeypatch.setattr(httpx, "post", _fake_post)

    result = OllamaVLMClient().analyze_v2(ctx)

    assert captured["payload"]["model"] == DEFAULT_OLLAMA_TEXT_MODEL_V2
    assert result == {"action": "type", "targetId": "agent-4", "value": "PERSONNAME#1", "key": None}
