"""
Swappable VLM client behind one interface.

Two implementations:
  - MockVLMClient:   deterministic, no network, no model. Used by all tests
                      and the default runtime backend (Chief's decision:
                      build mock-first, don't pull a model, don't run Ollama).
  - OllamaVLMClient:  real integration targeting qwen2.5vl:7b, written but
                      NOT executed anywhere in this module's test suite or
                      startup path — no vision model is installed on this
                      machine. It only runs if VLM_BACKEND=ollama is set
                      AND something actually calls .analyze() against a
                      live Ollama server.

Selection is via the VLM_BACKEND env var (defaults to "mock") through
get_vlm_client(). The interface (VLMClient.analyze) never mentions Ollama
in its signature or docstring contract — Section 4 requires this be
swappable to a cloud VLM later without touching main.py.
"""

from __future__ import annotations

import json
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

from schemas import PAGE_TARGET_ID, DomNode, RedactedRegion


# ---------------------------------------------------------------------------
# Prompt construction — the one thing the whole problem statement hinges on.
# ---------------------------------------------------------------------------


def build_prompt(task_goal: str, dom_snapshot: list[DomNode], redacted_regions: list[RedactedRegion]) -> str:
    """Construct the text prompt sent to the VLM alongside the (already
    redacted) screenshot.

    Hard requirement (CLAUDE.md Section 4 Phase 2c, Section 5): the prompt
    must EXPLICITLY tell the VLM that every region in `redacted_regions`
    is intentionally hidden for privacy, that it must not guess or
    speculate about what's under it, and that it should fall back to the
    DOM snapshot's type/role metadata for those areas instead.

    Kept as its own pure function (no network, no client instance) so it
    is directly unit-testable: every redacted region's identifying info
    must be a literal substring of the returned prompt text.
    """
    lines: list[str] = []

    lines.append(
        "You are a browser automation agent. You are given a screenshot of the "
        "current page and a structured snapshot of its DOM elements. Decide the "
        "single next action needed to accomplish the task goal below."
    )
    lines.append("")
    lines.append(f"TASK GOAL: {task_goal}")
    lines.append("")

    if redacted_regions:
        lines.append(
            "PRIVACY NOTICE — READ CAREFULLY: The regions listed below have been "
            "intentionally blacked out / blurred in the screenshot you are given, "
            "for user privacy. This is deliberate redaction, not a rendering error "
            "or missing content. You MUST NOT guess, infer, speculate about, or "
            "attempt to reconstruct what text, numbers, or images were under any "
            "of these regions. Do not describe their hidden contents in any form. "
            "For any of these regions, rely ONLY on the corresponding node's "
            "`type`/`role` metadata in the DOM SNAPSHOT section below to decide "
            "what kind of action is appropriate (e.g. a redacted region whose DOM "
            "node has type='password' is a password field you may target for a "
            "'type' action, but you must never guess or state its value or the "
            "value of any other redacted field)."
        )
        lines.append("")
        lines.append(f"REDACTED REGIONS ({len(redacted_regions)} total, do not guess their contents):")
        for region in redacted_regions:
            # region.type is a PiiType enum member; .value gives the plain
            # string ("password", not "PiiType.PASSWORD" — Python's (str,
            # Enum) mixin does NOT give you the plain value under str()/
            # f-string formatting, verified against this project's Python
            # 3.14 interpreter).
            agent_id_part = f", agentId={region.agentId}" if region.agentId else ""
            raw_type_part = f" (rawType={region.rawType})" if region.rawType else ""
            lines.append(
                f"  - type={region.type.value}{raw_type_part}{agent_id_part}, "
                f"bbox=(x={region.bbox.x}, y={region.bbox.y}, w={region.bbox.w}, h={region.bbox.h})"
            )
        lines.append("")
    else:
        lines.append("No regions were redacted in this screenshot.")
        lines.append("")

    lines.append(f"DOM SNAPSHOT ({len(dom_snapshot)} nodes):")
    if dom_snapshot:
        for node in dom_snapshot:
            role_part = f", role={node.role}" if node.role else ""
            type_part = f", type={node.type}" if node.type else ""
            text_part = f", text={node.text!r}" if node.text else ""
            sensitive_part = ", sensitive=true" if node.sensitive else ""
            lines.append(
                f"  - agentId={node.agentId}, tag={node.tag}{role_part}{type_part}"
                f"{text_part}{sensitive_part}"
            )
    else:
        lines.append("  (empty)")
    lines.append("")

    lines.append(
        "Respond with ONLY a single JSON object, no prose, no markdown fences, "
        'matching exactly this shape: {"action": "click"|"type"|"scroll"|"done", '
        '"targetId": "<agentId from the DOM snapshot above>", "value": "<string or null>"}. '
        "Use 'type' only for text-entry actions and include the text to type in "
        "`value` (never a guessed/redacted value). `targetId` is always required, even "
        f"for 'scroll' or 'done' — if the action does not target a specific element, use "
        f'the exact string "{PAGE_TARGET_ID}" as targetId. Use \'done\' once the task '
        "goal is complete."
    )

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Interface
# ---------------------------------------------------------------------------


@dataclass
class VLMRequestContext:
    """Everything a VLM implementation needs to produce an action.

    `prompt` is pre-built by build_prompt() so every implementation sends
    identical instructions/redaction context — implementations differ only
    in *how* they transmit (prompt, image) to a model and parse the reply.
    """

    image_b64: str
    dom_snapshot: list[DomNode]
    redacted_regions: list[RedactedRegion]
    task_goal: str
    prompt: str


class VLMClient(ABC):
    """One interface, swappable implementations. No implementation-specific
    details (Ollama, cloud provider, etc.) may appear in this contract."""

    @abstractmethod
    def analyze(self, context: VLMRequestContext) -> dict[str, Any]:
        """Return a raw dict shaped like the action response contract:
        {"action": str, "targetId": str, "value": str | None}.

        Implementations must NOT validate against ActionResponse
        themselves — that validation happens once, at the boundary in
        main.py, so a malformed/improvised action from any backend fails
        loudly and consistently regardless of which backend produced it.
        """
        raise NotImplementedError


# ---------------------------------------------------------------------------
# Mock implementation — deterministic, no network. Default and test backend.
# ---------------------------------------------------------------------------


class MockVLMClient(VLMClient):
    """Deterministic mock. Never touches the network or an LLM.

    Decision rule (purely structural, not NLP on the prompt text — the
    mock is a stand-in for grounding+action-selection behavior, not for
    language understanding):
      1. If domSnapshot is empty -> {"action": "done", "targetId": PAGE_TARGET_ID, "value": None}
      2. Else if the first non-sensitive node with type in
         {"text","email","tel","search","password"} exists -> "type" on it,
         with a canned non-PII placeholder value (never the node's own
         text, and never a value for a redacted node).
      3. Else -> "click" on the first node's agentId.
    This is intentionally simple: the mock's job is to prove the
    request/response contract and prompt-construction path end-to-end, not
    to simulate real visual reasoning.
    """

    PLACEHOLDER_VALUE = "mock-input"

    def analyze(self, context: VLMRequestContext) -> dict[str, Any]:
        redacted_agent_ids = {r.agentId for r in context.redacted_regions if r.agentId}

        if not context.dom_snapshot:
            return {"action": "done", "targetId": PAGE_TARGET_ID, "value": None}

        def _is_redacted_or_sensitive(node: DomNode) -> bool:
            return node.agentId in redacted_agent_ids or node.sensitive

        for node in context.dom_snapshot:
            if _is_redacted_or_sensitive(node):
                continue
            if node.type in {"text", "email", "tel", "search", "password"}:
                return {"action": "type", "targetId": node.agentId, "value": self.PLACEHOLDER_VALUE}

        # No safe typeable node — fall back to clicking the first node that
        # is NOT redacted/sensitive. Must never target a redacted/sensitive
        # node in either branch (that would defeat the whole point of
        # sending redactedRegions in the first place).
        for node in context.dom_snapshot:
            if not _is_redacted_or_sensitive(node):
                return {"action": "click", "targetId": node.agentId, "value": None}

        # Every node in the snapshot is redacted/sensitive — nothing safe
        # to act on.
        return {"action": "done", "targetId": PAGE_TARGET_ID, "value": None}


# ---------------------------------------------------------------------------
# Ollama implementation — written, NOT executed by this codebase's tests.
# ---------------------------------------------------------------------------


class OllamaVLMClient(VLMClient):
    """Real integration targeting qwen2.5vl:7b via Ollama's local HTTP API.

    NOT executed as part of this module's build/test — no vision model is
    pulled on this machine (only text-only llama3.1:8b, qwen2.5:3b,
    qwen2.5:1.5b are present; qwen2.5vl:7b is not). This class is
    write-only validated: it imports cleanly and is exercised by unit
    tests only with the HTTP call itself mocked/stubbed, never against a
    live Ollama server.

    Uses raw HTTP (httpx) against Ollama's /api/generate rather than the
    `ollama` pip package, to avoid an extra dependency for a path that
    isn't run in this environment.
    """

    def __init__(
        self,
        model: str = "qwen2.5vl:7b",
        base_url: str | None = None,
        timeout_s: float = 60.0,
    ) -> None:
        self.model = model
        self.base_url = base_url or os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
        self.timeout_s = timeout_s

    def analyze(self, context: VLMRequestContext) -> dict[str, Any]:
        import httpx  # local import: keep this dependency optional for mock-only runs

        payload = {
            "model": self.model,
            "prompt": context.prompt,
            "images": [context.image_b64],
            "stream": False,
            "format": "json",
        }
        response = httpx.post(
            f"{self.base_url}/api/generate",
            json=payload,
            timeout=self.timeout_s,
        )
        response.raise_for_status()
        body = response.json()
        raw_text = body.get("response", "")
        try:
            return json.loads(raw_text)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Ollama response was not valid JSON: {raw_text!r}") from exc


# ---------------------------------------------------------------------------
# Factory — env-var selection, defaulting to mock.
# ---------------------------------------------------------------------------


def get_vlm_client() -> VLMClient:
    """Select a VLMClient implementation via the VLM_BACKEND env var.

    Defaults to "mock" (Chief's decision: build mock-first, no model pull,
    no Ollama execution). Set VLM_BACKEND=ollama to switch, once a vision
    model is actually installed.
    """
    backend = os.environ.get("VLM_BACKEND", "mock").strip().lower()
    if backend == "mock":
        return MockVLMClient()
    if backend == "ollama":
        return OllamaVLMClient()
    raise ValueError(f"Unknown VLM_BACKEND: {backend!r} (expected 'mock' or 'ollama')")
