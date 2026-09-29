"""
Pydantic request/response schemas for POST /v2/analyze.

Contract source: docs/v2/ARCHITECTURE.md, contract C5 ("Scene + /analyze
v2") and the server half of C6 (egress assertion). This module implements
the server side ONLY -- the client-side tokenizer/regex/policy ports are
being written concurrently by other V1 subagents (pii-tokenizer.js,
pii-regex.js, policy.js) and are out of this module's scope.

DOES NOT TOUCH v1. `schemas.py` / v1 `/analyze` are unchanged; this is an
additive module, imported by main.py alongside (not instead of) schemas.py.

---------------------------------------------------------------------------
DESIGN DECISIONS AND CONTRACT GAPS -- read before extending this module.
---------------------------------------------------------------------------

1. TARGET ID SENTINEL IS v1's "page" (lowercase), reused directly.
   ARCHITECTURE.md's C5 response example originally read `"targetId":
   "agent-4" | "PAGE"` (uppercase); this was a documentation typo,
   corrected by the orchestrator after this module's first draft used the
   literal uppercase value -- extension/lib/policy.js was already built
   against lowercase "page", matching v1. `PAGE_TARGET_ID_V2` below is
   `schemas.PAGE_TARGET_ID` itself, not an independently-defined literal,
   so the two constants cannot drift apart. Import and use
   `PAGE_TARGET_ID_V2` (or `schemas.PAGE_TARGET_ID` directly) rather than
   re-deriving the string "page" anywhere new.

2. `serverVerdict` is a NEW field the model may NEVER supply -- same
   structural-enforcement idea as v1's ModelSuppliedProfileValue, but
   pushed one step further: the model-facing schema (`ModelActionV2`)
   simply has no field named `serverVerdict` at all, so there is no
   parse path by which a backend's raw dict could populate it. The final
   `ActionResponseV2` sent to the client is assembled by main.py from
   (validated ModelActionV2 fields) + (server-computed revision +
   serverVerdict + reason) -- never from a single `model_validate()` of
   the backend's raw output.

3. BEHAVIORAL CONTRACT CHANGE vs v1, DELIBERATE, per this agent's brief
   item 3 ("value on fill_profile -> reject as v1 does"): the RULE is
   unchanged (a model must never supply a value for fill_profile), but
   the ENFORCEMENT MECHANISM is different. v1 hard-fails via
   ModelSuppliedProfileValue -> HTTP 502, no ActionResponse is ever
   returned. v2 treats this as one of three deterministic serverVerdict
   checks (see main.py's compute_server_verdict) -- the endpoint still
   returns 200 with `serverVerdict: "reject"` and a `reason`, matching
   C4's `decide() -> {verdict, code, reason}` shape (verdicts are data,
   not exceptions, throughout C4/C5). This is intentional, not a
   loosening: v1's ActionResponse (and ModelSuppliedProfileValue) are
   untouched; ModelActionV2 below does NOT raise on value-for-fill_profile
   at the schema layer -- it is allowed to parse, and is caught
   deterministically afterward. It is still visible in `reason` as
   "FILL_PROFILE_VALUE_SUPPLIED".

4. `serverVerdict` enum includes "ask", but this module's deterministic
   check (item 3 of the brief) only ever computes "accept" or "reject" --
   "ask" requires client-side sensitivity/tier/consent context this
   endpoint does not have (that's C4's policy-engine, extension-side).
   The enum stays open to "ask" for forward compatibility / schema
   symmetry with C4, but no code path in this module emits it. Documented
   here rather than silently narrowing the enum.

5. MODE_VIOLATION covers BOTH directions of the mode/image mismatch
   (image present when mode=="semantic" AND image absent/None when
   mode=="image"), same errorCode both ways. The brief's prose describes
   only the semantic+image case as needing the "PII_LEAK_DETECTED-class
   egress" treatment (it's the actual privacy-relevant direction: raw
   pixels reaching the server when the contract promised none), but the
   brief's own required test list includes "missing image in image mode
   -> 400" as well -- so both directions raise the same ModeViolationV2
   exception via the same dependency check, for one coherent contract
   rule ("image present" XOR "mode==image" is false) rather than two
   separately-numbered error paths.

6. `elements[].label` and `.tier` are treated as OPTIONAL (default None),
   mirroring v1 DomNode.text's optionality: not every element in a scene
   is a text-labeled, tier-classified actionable target (a flagged PII
   text node from the scanner, for instance, may have neither). The C5
   example shows both populated but nothing marks either required. Noted
   as an interpretation, not escalated as a blocking gap.

7. Server-side leak re-check (item 2 of the brief) scans exactly:
   taskGoal, every elements[].label, and every history[].action.value --
   the fields the brief names ("taskGoal, labels, history values").
   region kind/bbox/source are not free text and are not scanned.
   Reuses pii_regex_v2.contains_unmasked_pii() -- see that module's
   docstring for the pattern-source gap (UPI/IFSC/GSTIN are new, not
   ported from any cited source).
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from pii_regex_v2 import contains_unmasked_pii
from schemas import PAGE_TARGET_ID

SCHEMA_LITERAL_V2 = "dhristi-scene-v2"

PAGE_TARGET_ID_V2 = PAGE_TARGET_ID
"""v2 whole-page/no-specific-element sentinel -- SAME value as v1's
PAGE_TARGET_ID ("page"), sourced from that constant directly so the two
can never drift apart. See module docstring point 1: ARCHITECTURE.md
originally showed uppercase "PAGE"; that was a documentation typo, fixed
by the orchestrator."""


# ---------------------------------------------------------------------------
# Closed enums (mode / kind / source / tier / action / serverVerdict)
# ---------------------------------------------------------------------------


class SceneMode(str, Enum):
    SEMANTIC = "semantic"
    IMAGE = "image"


class RegionKind(str, Enum):
    FACE = "face"
    PASSWORD = "password"
    FIELD = "field"
    TEXT_PII = "text-pii"
    FRAME = "frame"
    MEDIA = "media"


class RegionSourceV2(str, Enum):
    DOM = "dom"
    VISION = "vision"


class TierV2(str, Enum):
    REVERSIBLE = "reversible"
    NAVIGATIONAL = "navigational"
    STATE_CHANGING = "state-changing"
    DESTRUCTIVE = "destructive"


class ActionTypeV2(str, Enum):
    CLICK = "click"
    TYPE = "type"
    SCROLL = "scroll"
    PRESS_KEY = "press_key"
    DONE = "done"
    NEED_VISUAL = "need_visual"
    FILL_PROFILE = "fill_profile"


class ProfileFieldV2(str, Enum):
    """Kept for fill_profile back-compat (C2: "fill_profile stays accepted
    on the wire for back-compat through V4"). Same closed set as v1."""

    FULL_NAME = "full_name"
    EMAIL = "email"
    PHONE = "phone"


class PressKeyV2(str, Enum):
    """Same closed set as v1's PressKey."""

    ENTER = "Enter"
    ESCAPE = "Escape"
    TAB = "Tab"
    BACKSPACE = "Backspace"
    ARROW_UP = "ArrowUp"
    ARROW_DOWN = "ArrowDown"
    ARROW_LEFT = "ArrowLeft"
    ARROW_RIGHT = "ArrowRight"


class ServerVerdict(str, Enum):
    ACCEPT = "accept"
    ASK = "ask"
    REJECT = "reject"


# ---------------------------------------------------------------------------
# Shared primitives
# ---------------------------------------------------------------------------


class BBox(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: float
    y: float
    w: float
    h: float


class Viewport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    w: float
    h: float


# ---------------------------------------------------------------------------
# Request schema
# ---------------------------------------------------------------------------


class ElementV2(BaseModel):
    """One entry in `elements` -- v2's analog of v1's DomNode, extended
    with `label` (renamed from `text`, capped at 120 chars per C5) and
    `tier` (C4's classifyTier() output, computed client-side)."""

    model_config = ConfigDict(extra="forbid")

    agentId: str = Field(..., min_length=1)
    tag: str = Field(..., min_length=1)
    role: Optional[str] = None
    type: Optional[str] = None
    label: Optional[str] = Field(default=None, max_length=120)
    bbox: Optional[BBox] = None
    sensitive: bool = False
    tier: Optional[TierV2] = None


class RegionV2(BaseModel):
    """One entry in `regions` -- redaction/PII-region metadata for the
    prompt's "do not guess" instruction. No `agentId` field per the C5
    example (unlike v1's RedactedRegion) -- v2's primary leak defense is
    tokenization (C2), not bbox/agentId correlation, so this module's
    leak re-check does not need to cross-reference regions at all (see
    module docstring point 7)."""

    model_config = ConfigDict(extra="forbid")

    kind: RegionKind
    bbox: BBox
    source: RegionSourceV2


class HistoryAction(BaseModel):
    """Trimmed action echo inside a history entry -- same shape as the
    model-facing action fields (ModelActionV2 below), minus profileField/
    key, which are not relevant to summarizing prior-step history for
    stall/repetition context."""

    model_config = ConfigDict(extra="forbid")

    action: ActionTypeV2
    targetId: str = Field(..., min_length=1)
    value: Optional[str] = None


class HistoryEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: HistoryAction
    outcome: str = Field(..., pattern=r"^(ok|asked-denied|rejected:[A-Za-z0-9_]+)$")


class VaultEntry(BaseModel):
    """One entry in `vault` (C5/C2 amendment, 2026-09-26): announces that a
    `PROFILE...#n` token exists and names its CATEGORY only -- never a
    value. This is what lets a real planner (which cannot invent this
    token on its own) legitimately echo it back in a `type` action's
    `value`, and what lets compute_server_verdict()'s UNKNOWN_TOKEN check
    treat it as a KNOWN token without needing to see it anywhere else in
    the request (taskGoal/labels/history).

    `token` is constrained to C2's TOKEN_PATTERN grammar at the schema
    layer (`[A-Z][A-Z0-9]*#[0-9]+`, anchored) -- a vault entry carrying
    anything else is a 422, per this amendment's own required test case,
    not a deterministic-verdict rejection this module would otherwise have
    to write by hand.
    """

    model_config = ConfigDict(extra="forbid")

    token: str = Field(..., pattern=r"^[A-Z][A-Z0-9]*#[0-9]+$")
    field: ProfileFieldV2


class AnalyzeRequestV2(BaseModel):
    """POST /v2/analyze request body -- pure structural validation only.

    Mode/image cross-field validation and the PII-leak re-check are
    deliberately NOT model_validators here -- see get_validated_analyze_request_v2
    in main.py and module docstring points 3/5 for why (mirrors v1's
    schemas.PIILeakDetected design: those checks need to surface as 400
    with a distinct errorCode, not a generic 422, so they run explicitly
    in a dependency function after this model has already validated).
    """

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    schema_: str = Field(..., alias="schema")
    mode: SceneMode
    revision: str = Field(..., min_length=1)
    taskGoal: str = Field(..., min_length=1)
    viewport: Viewport
    elements: list[ElementV2] = Field(default_factory=list)
    regions: list[RegionV2] = Field(default_factory=list)
    history: list[HistoryEntry] = Field(default_factory=list, max_length=10)
    image: Optional[str] = Field(default=None, min_length=1)
    # C5/C2 amendment (2026-09-26): tokens + categories only, never values.
    # Omitted (empty list) when the run's vault is empty -- see VaultEntry's
    # own docstring for why this exists at all.
    vault: list[VaultEntry] = Field(default_factory=list)


class ModeViolationV2(Exception):
    """Raised when `image` presence doesn't match `mode` (module docstring
    point 5). Carries only a fixed, static message -- no request content
    interpolated (same "error path is a data egress path" posture as
    v1's PIILeakDetected/ModelSuppliedProfileValue)."""

    def __init__(self, detail: str) -> None:
        self.detail = detail
        super().__init__(detail)


class PIILeakDetectedV2(Exception):
    """Raised when the v2 server-side re-check (module docstring point 7)
    finds an untokenized PII-shaped match in taskGoal / an element label /
    a history value. Carries only payload-free location strings -- never
    the offending value. Distinct class from v1's schemas.PIILeakDetected
    so v1 and v2 stay fully decoupled; main.py maps both to the same
    errorCode "PII_LEAK_DETECTED" for external consistency."""

    def __init__(self, violations: list[str]) -> None:
        self.violations = violations
        super().__init__("PII leak detected in v2 request payload")


def find_v2_pii_leaks(request: AnalyzeRequestV2) -> list[str]:
    """Pure function: scan taskGoal, every elements[].label, and every
    history[].action.value for an untokenized PII-shaped regex match.
    Returns payload-free violation-location strings; empty list means no
    leak. See pii_regex_v2.contains_unmasked_pii for the matching rule
    (a match fully inside an `[A-Z][A-Z0-9]*#[0-9]+` token doesn't count).
    """
    violations: list[str] = []

    if contains_unmasked_pii(request.taskGoal):
        violations.append("taskGoal contains an untokenized PII-shaped value")

    for el in request.elements:
        if contains_unmasked_pii(el.label):
            violations.append(
                f"elements[agentId={el.agentId!r}].label contains an untokenized PII-shaped value"
            )

    for i, h in enumerate(request.history):
        if contains_unmasked_pii(h.action.value):
            violations.append(
                f"history[{i}].action.value contains an untokenized PII-shaped value"
            )

    return violations


# ---------------------------------------------------------------------------
# Response schema
# ---------------------------------------------------------------------------


class ModelActionV2(BaseModel):
    """The model-facing subset of the v2 action response -- what a VLM
    backend must return. Deliberately has NO `revision` or `serverVerdict`
    field (module docstring point 2): main.py computes both and assembles
    the final ActionResponseV2 itself, so there is no parse path by which
    a backend could supply either.

    Unlike v1's ActionResponse, this model does NOT hard-reject a non-null
    `value` on `fill_profile` (module docstring point 3) -- that specific
    case is deferred to main.py's deterministic serverVerdict computation.
    Structural shape rules that ARE enforced here (profileField required
    iff fill_profile; key required iff press_key) are ordinary malformed-
    response cases, same posture as v1.
    """

    model_config = ConfigDict(extra="forbid")

    action: ActionTypeV2
    targetId: str = Field(..., min_length=1)
    value: Optional[str] = None
    profileField: Optional[ProfileFieldV2] = None
    key: Optional[PressKeyV2] = None

    @model_validator(mode="after")
    def _enforce_shape(self) -> "ModelActionV2":
        if self.action == ActionTypeV2.FILL_PROFILE:
            if self.profileField is None:
                raise ValueError("fill_profile action requires a non-null profileField")
        elif self.profileField is not None:
            raise ValueError("profileField must be null/absent unless action is 'fill_profile'")

        if self.action == ActionTypeV2.PRESS_KEY:
            if self.key is None:
                raise ValueError("press_key action requires a non-null key")
        elif self.key is not None:
            raise ValueError("key must be null/absent unless action is 'press_key'")
        return self


class ActionResponseV2(BaseModel):
    """POST /v2/analyze response body -- assembled by main.py from a
    validated ModelActionV2 plus server-computed revision/serverVerdict/
    reason. Never constructed directly from a backend's raw dict."""

    model_config = ConfigDict(extra="forbid")

    action: ActionTypeV2
    targetId: str = Field(..., min_length=1)
    value: Optional[str] = None
    profileField: Optional[ProfileFieldV2] = None
    key: Optional[PressKeyV2] = None
    revision: str = Field(..., min_length=1)
    serverVerdict: ServerVerdict
    reason: Optional[str] = None
