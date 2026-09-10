"""
Pydantic request/response schemas for the /analyze endpoint.

Contract source: CLAUDE.md Section 4, Phase 2c.

    request:  { image: base64 str, domSnapshot: [...], redactedRegions: [...], taskGoal: str }
    response: { action: "click"|"type"|"scroll"|"done", targetId: str, value: str|None }

CONTRACT GAP (flagged, not invented silently — see report to orchestrator):
Section 4 leaves the element shape of `domSnapshot` and `redactedRegions`
unspecified beyond "[...]" for domSnapshot and `{type, bbox}` for
redactedRegions (per Phase 2b's `redact()` return contract). This file
defines a concrete shape for both, informed by:
  - Phase 2a's contract: sensitiveNodes carry {selector, bbox, piiType, agentId}
  - Phase 2b's contract: redactedRegions carry {type, bbox}
  - Phase 3's contract: action-executor assigns stable `data-agent-id`
    values, and the response's `targetId` must reference one of those IDs.

So: every actionable/visible node the client sends in `domSnapshot` is
assumed to carry a stable `agentId` (the Set-of-Mark grounding ID), plus
enough type/role metadata for the VLM to reason about redacted areas
without seeing pixels. `redactedRegions` gets an *optional* `agentId` on
top of the literal `{type, bbox}` contract so a redacted DOM-sourced
region can be cross-referenced back to its domSnapshot node for the
PII-leak check below; vision-only redacted boxes simply omit it.

ORCHESTRATOR RULINGS (Section 7 rule 5, recorded 2026-09-10 in CLAUDE.md
Phase 2c RESULT) — binding, implemented in this file:
  1. `DomNode` shape is APPROVED but PROVISIONAL. Phase 2a
     (`dom-pii-scanner`) is the authority on domSnapshot's true shape.
     When it lands, reconcile against its real output; if it differs,
     fix the contract in CLAUDE.md and re-delegate here — don't patch
     around a mismatch downstream.
  2. Optional `agentId` on `RedactedRegion` — APPROVED.
  3. `targetId` required even for scroll/done, using the named sentinel
     `PAGE_TARGET_ID` — APPROVED, see ActionResponse below.
  4. Status codes: PII-leak rejections are 400 + errorCode
     "PII_LEAK_DETECTED" (raised as PIILeakDetected, handled in
     main.py); ordinary schema violations stay 422. This is why the
     PII-leak check below is NOT wired as a model_validator on
     AnalyzeRequest — a model_validator can only surface as a generic
     Pydantic ValidationError (422), which would force main.py to
     sniff error message text to tell the two apart. Keeping
     find_pii_leaks() a separate explicit call (see main.py's
     get_validated_analyze_request dependency) keeps the status-code
     split unambiguous, no string-matching-prose required by Phase 4
     instrumentation.
  5. PII `type` on RedactedRegion is now a closed enum (PiiType) with
     an explicit "other" escape hatch — see below. NOT applied to
     DomNode.type: that field carries HTML input/semantic type
     ("submit", "button", "text", ...), a different and open-ended
     vocabulary that Phase 2a's enumerated PII-type set does not cover.
     Flagging this scoping read of ruling #5 for the orchestrator to
     correct if "type fields" (plural) was meant to include DomNode.type
     too.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


# ---------------------------------------------------------------------------
# Shared primitives
# ---------------------------------------------------------------------------


class BBox(BaseModel):
    """Pixel bounding box, top-left origin. Matches Phase 2a/2b's {x,y,w,h}."""

    model_config = ConfigDict(extra="forbid")

    x: float
    y: float
    w: float
    h: float

    def overlap_ratio_with(self, other: "BBox") -> float:
        """Fraction of `other`'s area covered by the intersection with self.

        Used as a fallback correlation signal between a redacted region's
        bbox and a domSnapshot node's bbox when no shared agentId is
        present. Returns 0.0 if either box has non-positive area.
        """
        if other.w <= 0 or other.h <= 0:
            return 0.0
        ix1 = max(self.x, other.x)
        iy1 = max(self.y, other.y)
        ix2 = min(self.x + self.w, other.x + other.w)
        iy2 = min(self.y + self.h, other.y + other.h)
        iw = max(0.0, ix2 - ix1)
        ih = max(0.0, iy2 - iy1)
        intersection = iw * ih
        other_area = other.w * other.h
        return intersection / other_area


# ---------------------------------------------------------------------------
# Request schema
# ---------------------------------------------------------------------------


class DomNode(BaseModel):
    """One entry in the sanitized `domSnapshot` array.

    `text` must already be stripped by the client (Phase 2b's DOM-JSON
    side) for any node considered sensitive. `sensitive` is the client's
    own declaration that this node held PII pre-sanitization; `text`
    being non-empty while `sensitive` is true, or while this node is
    referenced by a redactedRegions entry, is exactly the leak this
    module rejects server-side (Section 5 defense in depth).
    """

    model_config = ConfigDict(extra="forbid")

    agentId: str = Field(..., min_length=1)
    tag: str = Field(..., min_length=1, description="e.g. 'input', 'button', 'a', 'div'")
    role: Optional[str] = Field(default=None, description="ARIA role, if any")
    type: Optional[str] = Field(
        default=None,
        description="semantic/input type, e.g. 'password', 'email', 'text', 'button'",
    )
    text: Optional[str] = Field(
        default=None, description="visible/raw text content; must be stripped if sensitive"
    )
    bbox: Optional[BBox] = None
    sensitive: bool = Field(
        default=False,
        description="client's own declaration that this node held PII before sanitization",
    )


class PiiType(str, Enum):
    """Closed set per Phase 2a's description (autocomplete/regex PII
    categories it detects), plus OTHER as an explicit escape hatch.

    Section 5's direction is unambiguous: false negatives on PII are the
    dangerous direction. So an unrecognized `type` string arriving from
    upstream must NEVER cause a hard rejection of the whole request (that
    would make an unanticipated PII category behave like a denial of
    service against legitimate redaction) and must NEVER be silently
    dropped either. It degrades to OTHER — still flagged, still treated
    as redacted, just unclassified — with the original string preserved
    in `RedactedRegion.rawType` for observability. See the `mode="before"`
    validator on RedactedRegion below.
    """

    PASSWORD = "password"
    CC_NUMBER = "cc-number"
    CURRENT_PASSWORD = "current-password"
    EMAIL = "email"
    TEL = "tel"
    AADHAAR = "aadhaar"
    PAN = "pan"
    OTHER = "other"


class RedactedRegion(BaseModel):
    """One entry in `redactedRegions`, per Phase 2b's redact() output.

    `agentId` is an addition beyond the literal Phase 2b contract
    ({type, bbox}) to allow DOM-sourced redacted regions to be
    cross-referenced against `domSnapshot` for the leak check. Optional
    because vision-only boxes (Phase 0/2b merge) have no DOM node to
    reference.

    `type` is a closed PiiType enum (orchestrator ruling #5). `rawType`
    preserves the original string whenever the incoming value didn't
    match a known PiiType and was coerced to OTHER — never lost, just
    reclassified as unclassified-but-still-redacted.
    """

    model_config = ConfigDict(extra="forbid")

    type: PiiType
    rawType: Optional[str] = Field(
        default=None,
        description="original type string, populated only when `type` was coerced to OTHER",
    )
    bbox: BBox
    agentId: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def _degrade_unknown_type_to_other(cls, data):
        """Never hard-reject an unanticipated PII type. If `type` isn't a
        known PiiType value, coerce it to OTHER and stash the original
        string in `rawType` — degrade to flagged-but-unclassified,
        don't drop it and don't fail the whole request over it."""
        if isinstance(data, dict) and isinstance(data.get("type"), str):
            known_values = {member.value for member in PiiType}
            if data["type"] not in known_values:
                data = dict(data)
                data.setdefault("rawType", data["type"])
                data["type"] = PiiType.OTHER.value
        return data


def find_pii_leaks(dom_snapshot: list[DomNode], redacted_regions: list[RedactedRegion]) -> list[str]:
    """Pure function: detect domSnapshot nodes carrying raw values that
    redactedRegions (or the node's own `sensitive` flag) says should have
    been stripped.

    Returns a list of human-readable violation descriptions. Empty list
    means no leak detected. Independently unit-testable — fixture in,
    list out — per Section 5's invariant that PII-adjacent logic must be
    testable without spinning up the whole stack.

    Two correlation strategies, either one is sufficient to flag a leak:
      1. agentId match between a DomNode and a RedactedRegion.
      2. bbox overlap: a redacted region's box covers >50% of a
         DomNode's box (catches vision-only redacted regions that have
         no agentId but geometrically sit on top of a DOM node the
         client should have blanked).
    Independently of both: any DomNode with `sensitive=True` that still
    carries non-empty `text` is flagged, regardless of redactedRegions —
    a node the client itself labeled sensitive must never carry a raw
    value, redacted-region bookkeeping notwithstanding.

    SECURITY INVARIANT (added after orchestrator-caught defect, Section 7
    rule 5, 2026-09-10): violation strings identify the *location*
    (agentId, region type, correlation method) of a leak and MUST NEVER
    contain the offending value itself (`node.text`). These strings flow
    directly into the PII_LEAK_DETECTED HTTP response body (main.py) —
    an error path is a data egress path just like a success path. Do not
    add `node.text` (or any other raw field) to these f-strings, even for
    debugging convenience. Enforced by
    tests/unit/test_pii_leak.py::test_find_pii_leaks_message_never_contains_the_leaked_value.
    """
    violations: list[str] = []

    nodes_by_agent_id = {n.agentId: n for n in dom_snapshot}

    def _has_raw_value(node: DomNode) -> bool:
        return node.text is not None and node.text.strip() != ""

    flagged_agent_ids: set[str] = set()

    for region in redacted_regions:
        # Strategy 1: agentId correlation.
        if region.agentId is not None:
            node = nodes_by_agent_id.get(region.agentId)
            if node is not None and _has_raw_value(node) and node.agentId not in flagged_agent_ids:
                violations.append(
                    f"domSnapshot node agentId={node.agentId!r} carries raw text "
                    f"but is referenced by redactedRegions entry (type={region.type.value!r}) "
                    f"via matching agentId"
                )
                flagged_agent_ids.add(node.agentId)

        # Strategy 2: bbox overlap correlation (catches vision-only regions
        # with no agentId that geometrically sit on a DOM node).
        for node in dom_snapshot:
            if node.agentId in flagged_agent_ids:
                continue
            if node.bbox is None:
                continue
            if not _has_raw_value(node):
                continue
            if region.bbox.overlap_ratio_with(node.bbox) > 0.5:
                violations.append(
                    f"domSnapshot node agentId={node.agentId!r} carries raw text and its "
                    f"bbox overlaps >50% with redactedRegions entry (type={region.type.value!r}) "
                    f"bbox with no matching agentId declared"
                )
                flagged_agent_ids.add(node.agentId)

    # Strategy 3: self-declared sensitive nodes, independent of redactedRegions.
    for node in dom_snapshot:
        if node.agentId in flagged_agent_ids:
            continue
        if node.sensitive and _has_raw_value(node):
            violations.append(
                f"domSnapshot node agentId={node.agentId!r} is marked sensitive=true "
                f"but still carries raw text (not stripped before transmission)"
            )
            flagged_agent_ids.add(node.agentId)

    return violations


class PIILeakDetected(Exception):
    """Raised when find_pii_leaks() detects a leak. Carries only the
    payload-free `violations` strings it was given — never the offending
    value. Caught by a dedicated handler in main.py that returns 400 +
    errorCode "PII_LEAK_DETECTED", distinct from ordinary 422 schema
    errors (orchestrator ruling #4, Section 7 rule 5).

    Deliberately NOT raised from inside a Pydantic validator: a
    validator can only surface as pydantic.ValidationError, which
    FastAPI turns into a generic 422 — main.py would then have to sniff
    error message text to tell "PII leak" apart from "malformed field",
    which is exactly the string-matching-prose Phase 4 instrumentation
    was told it shouldn't need to do. Instead this is raised explicitly
    from main.py's get_validated_analyze_request dependency, called
    after AnalyzeRequest has already passed ordinary structural
    validation.
    """

    def __init__(self, violations: list[str]) -> None:
        self.violations = violations
        super().__init__("PII leak detected in request payload")


class AnalyzeRequest(BaseModel):
    """POST /analyze request body.

    Purely structural validation lives here (field presence/types). The
    PII-leak *semantic* check (domSnapshot raw values correlating with
    redactedRegions/sensitive flags) is intentionally NOT a model
    validator on this class — see PIILeakDetected's docstring for why,
    and main.py's get_validated_analyze_request for where it actually
    runs. Any new call site that constructs AnalyzeRequest from
    untrusted input MUST also call find_pii_leaks() explicitly — it is
    not automatic on construction.
    """

    model_config = ConfigDict(extra="forbid")

    image: str = Field(..., min_length=1, description="base64-encoded, already-redacted screenshot PNG")
    domSnapshot: list[DomNode] = Field(default_factory=list)
    redactedRegions: list[RedactedRegion] = Field(default_factory=list)
    taskGoal: str = Field(..., min_length=1)


# ---------------------------------------------------------------------------
# Response schema
# ---------------------------------------------------------------------------


class ActionType(str, Enum):
    """Strict enum. A VLM (or mock) returning any value outside this set
    must fail schema validation loudly, not pass through as a string."""

    CLICK = "click"
    TYPE = "type"
    SCROLL = "scroll"
    DONE = "done"


PAGE_TARGET_ID = "page"
"""Sentinel `targetId` value for actions that don't target a specific
Set-of-Mark element: a whole-page `scroll`, or `done` when task
completion isn't tied to the last-acted element.

APPROVED contract decision (orchestrator ruling #3, Section 7 rule 5,
recorded 2026-09-10): `targetId` stays required (non-Optional) for every
action per the literal Section 4 contract, but `scroll`/`done` may use
this exact string instead of a real agentId. Phase 3 (action-executor)
MUST special-case this exact constant — treat it as "act on/relative to
the page itself, not a mapped element" rather than looking it up in its
agentId map and failing to find it. Import this constant rather than
re-deriving the literal `"page"` string.
"""


class ActionResponse(BaseModel):
    """POST /analyze response body.

    `targetId` is required per the literal contract in Section 4
    (`targetId: "agent-1"`, no `?`/Optional marker) — including for
    `scroll`/`done` actions that don't target a specific element, which
    use the `PAGE_TARGET_ID` sentinel (see above) rather than an empty
    or omitted value.
    """

    model_config = ConfigDict(extra="forbid")

    action: ActionType
    targetId: str = Field(..., min_length=1)
    value: Optional[str] = None
