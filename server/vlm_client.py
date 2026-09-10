"""
Swappable VLM client behind one interface.

Four implementations:
  - MockVLMClient:   deterministic, no network, no model. DEFAULT backend —
                      used by all tests and every current runtime path
                      unless VLM_BACKEND is set otherwise.
  - OllamaVLMClient:  real integration targeting qwen2.5vl:7b via raw HTTP
                      (no official Ollama SDK exists, so httpx is the
                      correct pattern there). Written but NOT executed
                      anywhere in this module's test suite — no vision
                      model is installed on the dev machine.
  - ClaudeVLMClient:  real integration targeting a cloud Claude model via
                      the OFFICIAL `anthropic` Python SDK (an SDK exists
                      here, so — unlike Ollama — raw httpx would be the
                      WRONG pattern). Chief's decision: swap the
                      mock/Ollama dev path for a cloud model for the
                      finale, since this machine's ~3.7GB free RAM can't
                      run a 7B local VLM. Written but NOT executed against
                      a live API — no ANTHROPIC_API_KEY is configured on
                      this machine; validated entirely with a stubbed/
                      injected fake client (tests/unit/test_claude_vlm_client.py).
  - GeminiVLMClient:  real integration targeting a cloud Gemini model via
                      the OFFICIAL `google-genai` SDK (imported as
                      `from google import genai` — NOT the deprecated
                      `google-generativeai` package, and NOT raw HTTP).
                      Chief's second decision: add a FREE backend, since
                      the Anthropic API is pay-as-you-go and a hackathon
                      demo shouldn't need a paid key. Written but NOT
                      executed against a live API — no GEMINI_API_KEY /
                      GOOGLE_API_KEY is configured on this machine;
                      validated entirely with a stubbed/injected fake
                      client (tests/unit/test_gemini_vlm_client.py). Its
                      request/response shapes and exception hierarchy are
                      genuinely different from Claude's SDK, verified
                      independently against the installed package source
                      rather than assumed to mirror it — see the class
                      docstring below for the specific differences found.

Selection is via the VLM_BACKEND env var (defaults to "mock") through
get_vlm_client(). The interface (VLMClient.analyze) never mentions Ollama,
Claude, Gemini, or any other backend in its signature or docstring
contract — Section 4 requires this be swappable between backends without
touching main.py, and two swaps have now happened (mock -> Claude,
mock -> Gemini) with zero main.py changes either time.
"""

from __future__ import annotations

import base64
import json
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

from schemas import PAGE_TARGET_ID, ActionType, DomNode, RedactedRegion


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
# Claude implementation — written, NOT executed against a live API. No
# ANTHROPIC_API_KEY is configured on this machine; validated entirely
# against a stubbed/injected fake client (see
# tests/unit/test_claude_vlm_client.py).
# ---------------------------------------------------------------------------

DEFAULT_CLAUDE_MODEL = "claude-opus-4-8"
"""Exact model id string per Chief's instruction — no date suffix appended."""

ACTION_RESPONSE_JSON_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "action": {"type": "string", "enum": [a.value for a in ActionType]},
        "targetId": {"type": "string"},
        "value": {"type": ["string", "null"]},
    },
    "required": ["action", "targetId", "value"],
    "additionalProperties": False,
}
"""Mirrors schemas.ActionResponse, sent to Claude via `output_config` so
the model is CONSTRAINED at generation time to this exact shape — this is
the structured-output requirement the whole integration hinges on: a
model returning prose instead of {action, targetId, value} breaks the
agent loop. `action`'s enum is derived from schemas.ActionType (single
source of truth, not a hand-copied duplicate list). `value` is a nullable
string rather than an "optional" key because JSON-schema structured-
output modes generally require every property listed in `required` once
additionalProperties is locked down — there's no separate "optional
property" concept to reach for."""


class ClaudeCredentialsMissing(Exception):
    """Raised by ClaudeVLMClient.analyze() when the Anthropic SDK client
    has no resolved API key at call time.

    Deliberately a pre-flight check on the SDK client's own `.api_key`
    attribute (set during `anthropic.Anthropic()`'s own credential
    resolution — this class never reads ANTHROPIC_API_KEY itself), rather
    than catching-and-string-matching the SDK's internal TypeError from
    header validation. That TypeError fires deep inside request
    preparation and its message text is not a stable public contract to
    depend on; inspecting the client's already-resolved `.api_key` is a
    directly testable, version-stable signal instead.
    """


class ClaudeModelNotFound(RuntimeError):
    """Wraps anthropic.NotFoundError — bad/unavailable ANTHROPIC_MODEL. Not retryable."""


class ClaudeRateLimited(RuntimeError):
    """Wraps anthropic.RateLimitError (HTTP 429). Retryable in principle — this
    class does not retry itself, but callers can distinguish this from a hard failure."""


class ClaudeAPIError(RuntimeError):
    """Wraps any other anthropic.APIStatusError (4xx/5xx) not already handled above."""


class ClaudeConnectionError(RuntimeError):
    """Wraps anthropic.APIConnectionError — no HTTP response at all (DNS/timeout/network)."""


class ClaudeVLMClient(VLMClient):
    """Real integration targeting a cloud Claude model via the OFFICIAL
    `anthropic` Python SDK — not raw httpx. (Raw httpx is the correct
    pattern for OllamaVLMClient above because no official Ollama SDK
    exists; here one does, so using it is the correct pattern, not an
    inconsistency between the two implementations.)

    SECTION 5 / PRIVACY NOTE: sending redacted data to a cloud model is
    exactly the scenario this project exists to make safe, not a weakening
    of the invariant. The invariant is "nothing leaves the client except
    the redacted image and sanitized DOM JSON" — this class sends exactly
    that (`context.image_b64` and `context.prompt`, both already
    constructed upstream from the already-redacted/sanitized
    VLMRequestContext; see the request-shape tests in
    test_claude_vlm_client.py that assert on this directly). Nothing about
    swapping mock/Ollama for a cloud backend changes what data the
    client-side pipeline is allowed to produce in the first place.

    NOT executed live: no ANTHROPIC_API_KEY is configured on this
    machine. Every code path here is exercised via a fake object injected
    through the `client=` constructor parameter, standing in for
    `anthropic.Anthropic` — request shape, response parsing, and each
    error branch are all unit-tested without credentials or network
    access.
    """

    def __init__(
        self,
        model: str | None = None,
        max_tokens: int = 2048,
        client: Any = None,
    ) -> None:
        self.model = model or os.environ.get("ANTHROPIC_MODEL", DEFAULT_CLAUDE_MODEL)
        self.max_tokens = max_tokens
        # Dependency-injection point for tests: a fake object exposing
        # `.api_key` and `.messages.create(...)`. When None (the real
        # runtime path), a bare `anthropic.Anthropic()` is constructed
        # lazily on first use in analyze() — never here — so merely
        # SELECTING this backend (VLM_BACKEND=claude, i.e. constructing
        # this class via get_vlm_client()) never touches the SDK's
        # credential resolution or makes any network call.
        self._injected_client = client

    def _get_client(self) -> Any:
        if self._injected_client is not None:
            return self._injected_client
        import anthropic  # local import: keep this dependency optional for mock-only runs

        # Bare constructor — per Chief's instruction, let the SDK resolve
        # credentials itself (env var, credential files, etc.). This
        # class does not hardcode or read the key itself.
        return anthropic.Anthropic()

    def analyze(self, context: VLMRequestContext) -> dict[str, Any]:
        import anthropic  # local import: keep this dependency optional for mock-only runs

        client = self._get_client()

        if not getattr(client, "api_key", None):
            raise ClaudeCredentialsMissing(
                "Claude backend selected (VLM_BACKEND=claude) but no API key is "
                "configured — set the ANTHROPIC_API_KEY environment variable "
                "before starting the server."
            )

        messages = [
            {
                "role": "user",
                "content": [
                    # Image block BEFORE the text block — per Chief's
                    # explicit instruction on vision content ordering.
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": context.image_b64,
                        },
                    },
                    # build_prompt() REUSED VERBATIM (already built into
                    # context.prompt upstream) — it is the already
                    # unit-tested privacy contract: every redacted region
                    # named, "do not guess" instruction present. Not
                    # rewritten or paraphrased here.
                    {"type": "text", "text": context.prompt},
                ],
            }
            # Exactly one user turn. No assistant-role message is ever
            # added here — assistant prefill is removed on this model
            # family and returns a 400.
        ]

        try:
            response = client.messages.create(
                model=self.model,
                max_tokens=self.max_tokens,
                messages=messages,
                output_config={
                    "format": {"type": "json_schema", "schema": ACTION_RESPONSE_JSON_SCHEMA}
                },
                # No `thinking` kwarg at all (not thinking=None or
                # thinking=False — simply absent). Omitting it is what
                # makes Opus 4.8 run without thinking, which a real-time
                # agent loop wants. Do NOT add budget_tokens — it is
                # fully removed on 4.8 and returns a 400.
            )
        except anthropic.NotFoundError as exc:
            raise ClaudeModelNotFound(
                f"Claude model {self.model!r} not found or unavailable "
                f"(check ANTHROPIC_MODEL if you set it)."
            ) from exc
        except anthropic.RateLimitError as exc:
            raise ClaudeRateLimited("Claude API rate limit exceeded (HTTP 429).") from exc
        except anthropic.APIStatusError as exc:
            raise ClaudeAPIError(
                f"Claude API returned an error status (HTTP {exc.status_code})."
            ) from exc
        except anthropic.APIConnectionError as exc:
            raise ClaudeConnectionError("Could not connect to the Claude API.") from exc

        return self._extract_action_dict(response)

    @staticmethod
    def _extract_action_dict(response: Any) -> dict[str, Any]:
        """Pull the structured JSON out of the response's text content
        block.

        Deliberately does NOT validate against ActionResponse here — same
        single-validation-boundary rule as every VLMClient implementation
        (see the base class's analyze() docstring): main.py is the one
        place a malformed/improvised action gets rejected, regardless of
        which backend produced it.

        Uses raw `messages.create()` + manual JSON parsing rather than
        `messages.parse()`'s `output_format=<PydanticModel>` convenience:
        that path does its own SDK-internal validation via
        pydantic.TypeAdapter before returning, which would be a second,
        backend-specific validation path living outside main.py's single
        boundary — exactly what this codebase's architecture rules out.
        `output_config={"format": {...}}` (used above) is the correct,
        SDK-confirmed way to pass a raw JSON schema dict without pulling
        in that second path; `output_format` was explicitly avoided per
        instruction.
        """
        for block in response.content:
            if getattr(block, "type", None) == "text":
                return json.loads(block.text)
        raise ValueError("Claude response contained no text content block to parse as JSON.")


# ---------------------------------------------------------------------------
# Gemini implementation — written, NOT executed against a live API. No
# GEMINI_API_KEY / GOOGLE_API_KEY is configured on this machine; validated
# entirely against a stubbed/injected fake client (see
# tests/unit/test_gemini_vlm_client.py).
#
# Everything below was verified against the installed `google-genai`
# v2.22.0 package's own source (client.py, _api_client.py, types.py,
# errors.py, _transformers.py) — not recalled from training data. Where it
# genuinely differs from ClaudeVLMClient's design, that's because the two
# SDKs are actually built differently, confirmed by reading both, not an
# inconsistency between the two implementations:
#   - google-genai's Client() raises ValueError SYNCHRONOUSLY AT
#     CONSTRUCTION when no API key resolves (anthropic.Anthropic() defers
#     that failure to the first request).
#   - google-genai's error hierarchy is FLAT: only APIError -> ClientError
#     (any 4xx) / ServerError (any 5xx), no dedicated NotFoundError /
#     RateLimitError classes to catch by type. Distinguishing "rate
#     limited" from "model not found" requires inspecting the caught
#     ClientError's `.code` (int HTTP status) and `.status` (Google's own
#     string error code, e.g. "RESOURCE_EXHAUSTED", "NOT_FOUND") — there
#     is no other way to do this with this SDK's actual exception design.
#   - google-genai does not wrap network-level failures at all; a DNS/
#     timeout/connection failure propagates as a raw httpx.HTTPError
#     subclass straight from the underlying transport.
#   - Structured output uses `response_mime_type` + `response_json_schema`
#     on GenerateContentConfig (confirmed: response_json_schema accepts a
#     raw JSON Schema dict directly — the exact ACTION_RESPONSE_JSON_SCHEMA
#     already built for Claude is reused here unmodified).
#   - Image parts take RAW BYTES (`Part.from_bytes(data=<bytes>, ...)`),
#     not a base64 string — unlike Claude's wire format, which takes the
#     base64 string directly. context.image_b64 must be decoded first.
# ---------------------------------------------------------------------------

DEFAULT_GEMINI_MODEL = "gemini-2.0-flash"
"""NOT verified against a live API call — no credentials are configured on
this machine, and guessing a model id from training-data recall was
explicitly ruled out (Gemini's model lineup and id strings are exactly
the kind of thing that goes stale). This value was instead read directly
out of the INSTALLED google-genai v2.22.0 SDK's own bundled source code:
it is the consistent illustrative example across client.py, models.py,
chats.py, batches.py, live.py, and types.py (40+ occurrences), including
literally being cited in a parameter docstring as: "The Gemini model ID,
for example: 'gemini-2.0-flash'". That is meaningfully stronger evidence
than recalled training data — it is what the SDK's own authors chose as
their canonical safe example as of this SDK release — but it is still
NOT a live confirmation that this id is currently servable, especially
on the free tier specifically. Override with GEMINI_MODEL if it's wrong;
list_gemini_models() / the GeminiModelNotFound error message below both
point at how to discover a currently-valid id instead of guessing again.
"""


class GeminiCredentialsMissing(Exception):
    """Raised by GeminiVLMClient.analyze() when no API key can be resolved.

    Structurally different from ClaudeCredentialsMissing by necessity, not
    by choice: anthropic.Anthropic() constructs successfully even with no
    key (the failure is deferred to request time, so there's a live client
    object whose `.api_key` attribute can be inspected first). google-genai's
    Client() does NOT get that far — confirmed in _api_client.py's
    BaseApiClient.__init__: on the plain Gemini Developer API path (no
    vertexai/enterprise/project/location args, which is all this class ever
    passes), it raises `ValueError('No API key was provided...')`
    SYNCHRONOUSLY, inside the constructor itself. There is no
    post-construction object to inspect. So this class catches that
    specific ValueError at construction time (see _get_client()) and
    re-raises with a clear, actionable message — still never reading
    GEMINI_API_KEY/GOOGLE_API_KEY itself; it only reacts to the SDK's own
    resolution failing, exactly like the Claude client does, just at a
    different point in the call sequence because the two SDKs fail
    differently.
    """


class GeminiModelNotFound(RuntimeError):
    """The configured GEMINI_MODEL was rejected (HTTP 404 / Google status
    "NOT_FOUND"). Not retryable with the same model id — see
    list_gemini_models() to discover a valid one."""


class GeminiRateLimited(RuntimeError):
    """HTTP 429 / Google status "RESOURCE_EXHAUSTED". The Gemini free tier
    is aggressively rate-limited — this is an expected, routine failure
    mode for this backend, not a rare edge case, which is why it gets its
    own distinguishable type rather than folding into a generic API-error
    branch."""


class GeminiAPIError(RuntimeError):
    """Any other Gemini APIError (ClientError or ServerError) not covered
    by the more specific branches above."""


class GeminiConnectionError(RuntimeError):
    """No HTTP response at all — DNS/timeout/network failure. google-genai
    does not wrap these itself (confirmed: no try/except around the
    underlying httpx send call in _api_client.py); they propagate as raw
    httpx.HTTPError subclasses, caught and re-wrapped here so all three
    real backends (Ollama, Claude, Gemini) expose a consistent
    "connection failed" exception shape."""


def list_gemini_models(client: Any = None) -> list[str]:
    """Discover currently-valid Gemini model ids. This is the safety net
    DEFAULT_GEMINI_MODEL's docstring promises: since that default could
    not be verified live, this function (and the equivalent inline
    one-liner below) is how a caller finds out what actually works.

    Equivalent one-liner, if you'd rather run it directly in a shell:

        python -c "from google import genai; [print(m.name) for m in genai.Client().models.list()]"

    Requires GEMINI_API_KEY or GOOGLE_API_KEY to be set — this makes a
    real (lightweight) API call, which is exactly why this function is
    NOT exercised by this module's test suite (no credentials on this
    machine). `client` accepts an injected fake for testing that it wires
    through correctly, without requiring a live call.
    """
    if client is None:
        from google import genai  # local import: keep this dependency optional for mock-only runs

        client = genai.Client()
    return [m.name for m in client.models.list() if getattr(m, "name", None)]


class GeminiVLMClient(VLMClient):
    """Real integration targeting a cloud Gemini model via the OFFICIAL
    `google-genai` SDK (`from google import genai`) — not the deprecated
    `google-generativeai` package, and not raw HTTP (an official SDK
    exists, so, same reasoning as ClaudeVLMClient, using it is correct).

    Chief's second cloud-backend decision: the Gemini API has a free tier
    (unlike Anthropic's pay-as-you-go pricing), which matters for a
    hackathon demo that shouldn't need a paid key to run. Section 5 note
    carries over unchanged from ClaudeVLMClient: sending already-redacted
    data to ANY cloud model, free or paid, is the scenario this project
    exists to make safe, not an exception to the invariant.

    NOT executed live: no GEMINI_API_KEY/GOOGLE_API_KEY is configured on
    this machine. Every code path here is exercised via a fake object
    injected through the `client=` constructor parameter, standing in for
    `google.genai.Client` — request shape, response parsing, and each
    error branch are all unit-tested without credentials or network
    access.
    """

    def __init__(
        self,
        model: str | None = None,
        max_output_tokens: int = 2048,
        client: Any = None,
    ) -> None:
        self.model = model or os.environ.get("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)
        self.max_output_tokens = max_output_tokens
        # Dependency-injection point for tests — see ClaudeVLMClient's
        # identical pattern. Constructing this class never touches the
        # network or resolves credentials; only _get_client() does, lazily.
        self._injected_client = client

    def _get_client(self) -> Any:
        if self._injected_client is not None:
            return self._injected_client
        from google import genai  # local import: keep this dependency optional for mock-only runs

        try:
            # Bare constructor — the SDK resolves GOOGLE_API_KEY (priority)
            # or GEMINI_API_KEY (fallback) itself; this class does not read
            # either env var directly. On the plain Gemini Developer API
            # path (no vertexai/project/location passed here), a missing
            # key raises ValueError synchronously — see
            # GeminiCredentialsMissing's docstring for why this differs
            # from the Claude client's post-construction check.
            return genai.Client()
        except ValueError as exc:
            raise GeminiCredentialsMissing(
                "Gemini backend selected (VLM_BACKEND=gemini) but no API key is "
                "configured. Set the GEMINI_API_KEY environment variable "
                "(GOOGLE_API_KEY is also accepted, and takes priority if both are "
                "set) before starting the server. Get a free key at "
                "https://aistudio.google.com/apikey."
            ) from exc

    def analyze(self, context: VLMRequestContext) -> dict[str, Any]:
        from google.genai import errors, types
        import httpx  # transport-level exceptions surface raw from this SDK

        client = self._get_client()

        image_bytes = base64.b64decode(context.image_b64)

        contents = [
            # Image part BEFORE the text part — per Chief's explicit
            # instruction, same ordering rationale as the Claude client.
            # Part.from_bytes() requires raw bytes, not a base64 string
            # (confirmed: types.Blob.data is typed `bytes`) — hence the
            # decode above.
            types.Part.from_bytes(data=image_bytes, mime_type="image/png"),
            # build_prompt() REUSED VERBATIM (already built into
            # context.prompt upstream) — the already unit-tested privacy
            # contract, not rewritten or paraphrased here.
            types.Part.from_text(text=context.prompt),
        ]

        config = types.GenerateContentConfig(
            max_output_tokens=self.max_output_tokens,
            # Structured output is load-bearing here exactly as for
            # Claude: response_json_schema accepts a raw JSON Schema dict
            # (confirmed against types.py's GenerateContentConfig
            # docstring) and reuses ACTION_RESPONSE_JSON_SCHEMA verbatim —
            # one source of truth for the action enum, not a hand-copied
            # duplicate.
            response_mime_type="application/json",
            response_json_schema=ACTION_RESPONSE_JSON_SCHEMA,
            # No thinking_config is set. Some Gemini model families default
            # to enabled "thinking" with a model-dependent budget/latency
            # cost (ThinkingConfig.thinking_budget: "-1 is AUTOMATIC...
            # default values and allowed ranges are model dependent," per
            # the SDK's own docstring) — but forcing thinking_budget=0
            # unconditionally risks a 400 on a model that doesn't support
            # thinking at all, on top of an already-unverified model id.
            # Left as a documented, deliberate omission rather than a
            # second unverified guess stacked on the first.
        )

        try:
            response = client.models.generate_content(
                model=self.model,
                contents=contents,
                config=config,
            )
        except errors.ClientError as exc:
            # google-genai's error hierarchy has no dedicated RateLimitError/
            # NotFoundError types (confirmed in errors.py) — every 4xx is a
            # ClientError, distinguished only by `.code` / `.status`.
            if exc.code == 429 or exc.status == "RESOURCE_EXHAUSTED":
                raise GeminiRateLimited(
                    "Gemini API rate limit exceeded — the free tier is "
                    f"aggressively rate-limited ({exc.status or exc.code})."
                ) from exc
            if exc.code == 404 or exc.status == "NOT_FOUND":
                raise GeminiModelNotFound(
                    f"Gemini model {self.model!r} not found or unavailable. Run "
                    "list_gemini_models() (or `python -c \"from google import genai; "
                    "[print(m.name) for m in genai.Client().models.list()]\"`) to "
                    "discover currently-valid ids, then set GEMINI_MODEL."
                ) from exc
            raise GeminiAPIError(
                f"Gemini API returned a client error (HTTP {exc.code}, status={exc.status})."
            ) from exc
        except errors.ServerError as exc:
            raise GeminiAPIError(
                f"Gemini API returned a server error (HTTP {exc.code})."
            ) from exc
        except httpx.HTTPError as exc:
            raise GeminiConnectionError("Could not connect to the Gemini API.") from exc

        return self._extract_action_dict(response)

    @staticmethod
    def _extract_action_dict(response: Any) -> dict[str, Any]:
        """Pull the structured JSON out of response.text.

        Deliberately does NOT validate against ActionResponse here — same
        single-validation-boundary rule as every VLMClient implementation
        (see the base class's analyze() docstring): main.py is the one
        place a malformed/improvised action gets rejected, regardless of
        which backend produced it.

        `response.text` is the SDK's own convenience property (confirmed
        in types.py's GenerateContentResponse: "Returns the concatenation
        of all text parts... from only the first [candidate]") — used
        instead of manually walking response.candidates[0].content.parts,
        which is equivalent but more brittle across SDK versions.
        """
        text = getattr(response, "text", None)
        if not text:
            raise ValueError("Gemini response contained no text to parse as JSON.")
        return json.loads(text)


# ---------------------------------------------------------------------------
# Factory — env-var selection, defaulting to mock.
# ---------------------------------------------------------------------------


def get_vlm_client() -> VLMClient:
    """Select a VLMClient implementation via the VLM_BACKEND env var.

    Defaults to "mock" — nothing currently working breaks by adding a new
    backend option. "ollama" targets a local qwen2.5vl:7b (untested, no
    model installed here). "claude" targets a cloud Claude model via the
    official SDK (Chief's cloud decision) — untested live, no
    ANTHROPIC_API_KEY on this machine, but fully unit-tested against a
    stubbed client. "gemini" targets a cloud Gemini model via the official
    google-genai SDK (Chief's FREE-tier decision, additive to Claude, not
    a replacement) — same story: untested live (no GEMINI_API_KEY/
    GOOGLE_API_KEY here), fully unit-tested against a stubbed client.
    Constructing any of these four does NOT itself touch a network or
    resolve credentials — that only happens inside .analyze(), on first
    real use.
    """
    backend = os.environ.get("VLM_BACKEND", "mock").strip().lower()
    if backend == "mock":
        return MockVLMClient()
    if backend == "ollama":
        return OllamaVLMClient()
    if backend == "claude":
        return ClaudeVLMClient()
    if backend == "gemini":
        return GeminiVLMClient()
    raise ValueError(
        f"Unknown VLM_BACKEND: {backend!r} (expected 'mock', 'ollama', 'claude', or 'gemini')"
    )
