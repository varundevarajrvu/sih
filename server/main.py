"""
FastAPI app for Phase 2c (server-api). One endpoint: POST /analyze.

Error-path design (rewritten after an orchestrator-caught defect,
CLAUDE.md Section 7 rule 5, 2026-09-10 — "an error path is a data egress
path"):

  - Ordinary structural violations (missing/mistyped fields) -> 422, via
    a CUSTOM RequestValidationError handler below. FastAPI's default
    handler embeds the raw offending request value under `input` (and
    pydantic `ctx`) in every error entry — which means a malformed
    request that happens to carry PII in the wrong field gets that PII
    echoed straight back into the response, uvicorn logs, error
    trackers, and the browser network panel. The handler below strips to
    `type`/`loc`/`msg` only, for ALL validation errors on this app, not
    just the /analyze endpoint.

  - The Section 5 PII-leak check (domSnapshot raw values correlating
    with redactedRegions/sensitive flags) -> 400 with a stable
    `errorCode: "PII_LEAK_DETECTED"`, via the PIILeakDetected exception
    and its handler below. Kept deliberately separate from the generic
    422 path (see schemas.PIILeakDetected's docstring) so Phase 4
    instrumentation can count these by errorCode, not by sniffing error
    message text. The handler returns only find_pii_leaks()'s
    payload-free violation strings — never domSnapshot/redactedRegions
    content itself.

  - A VLM response that fails ActionResponse validation (e.g. an
    improvised action name) -> 502, with the same type/loc/msg-only
    error shape as the 422 path, for the same reason: pydantic's default
    ValidationError string repr embeds `input_value=...`, which could
    echo content the VLM derived from the prompt/image back to the
    caller.

  - A `fill_profile` action carrying a non-null `value` (schemas.py
    ruling #7, 2026-09-14 — the "model names a category, never sees or
    supplies the value" design) -> 502 with its OWN stable errorCode
    "MODEL_SUPPLIED_PROFILE_VALUE", via the schemas.ModelSuppliedProfileValue
    exception and its handler below. Kept separate from the generic
    "VLM_RESPONSE_SCHEMA_INVALID" 502 for the same reason PIILeakDetected
    is kept separate from ordinary 422s: this is a security-relevant
    event (a misbehaving model or a page trying to smuggle data back out
    through the action channel), not an ordinary malformed response, and
    Phase 4 instrumentation should be able to count it distinctly by
    errorCode. The handler's message is a fixed, static string — it
    interpolates nothing from the request or the VLM's output, because
    ModelSuppliedProfileValue itself carries no payload to interpolate
    (see its docstring).

Run with:
    uvicorn main:app --reload
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError

import debug_dump
import live_feed
from schemas import ActionResponse, AnalyzeRequest, ModelSuppliedProfileValue, PIILeakDetected, find_pii_leaks
from schemas_v2 import (
    PAGE_TARGET_ID_V2,
    ActionResponseV2,
    AnalyzeRequestV2,
    ActionTypeV2,
    ModeViolationV2,
    ModelActionV2,
    PIILeakDetectedV2,
    ServerVerdict,
    find_v2_pii_leaks,
)
from pii_regex_v2 import TOKEN_RE, contains_unmasked_pii
from vlm_client import (
    VLMClient,
    VLMRequestContext,
    VLMRequestContextV2,
    build_prompt,
    build_prompt_v2,
    get_vlm_client,
    get_vlm_client_v2,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # See debug_dump.py's module docstring for the full safety rationale.
    # This is the ONE place the startup warning fires — if DEBUG_DUMP_DIR
    # is set, every /analyze request gets written to disk, including any
    # unredacted PII a failed redaction might contain, so this must never
    # be silently on.
    debug_dump.warn_if_enabled()
    yield


app = FastAPI(title="SIH 26171 server-api", version="0.1.0", lifespan=lifespan)

# Phase 4 (integration-loop) MINIMAL addition: the extension's background
# service worker POSTs here from a chrome-extension:// origin. Chrome
# extension host_permissions already let a privileged extension context
# (background.js) bypass CORS entirely for a cross-origin fetch, so this
# is defense-in-depth / dev-convenience rather than strictly load-bearing
# for that one call path -- but it's needed for anyone hitting this
# endpoint from a plain browser tab (e.g. Varun sanity-checking with a
# local HTML page, or curl-from-browser debugging) and costs nothing for
# a local-only dev server with no cookies/auth to protect
# (allow_credentials stays at its default False, so wildcard origins are
# spec-valid). No other change made to this file.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _safe_pydantic_errors(errors: list[dict]) -> list[dict]:
    """Strip a pydantic errors() list down to type/loc/msg only.

    pydantic's raw error dicts include `input` (the offending value,
    verbatim) and `ctx` (may embed the input again inside nested
    context). Both are payload data and must never be echoed back to
    the caller. type/loc/msg are sufficient to debug a shape mismatch
    and are structurally incapable of carrying payload content — `loc`
    is a field path (e.g. ("body", "domSnapshot", 0, "text")), not a
    value.
    """
    return [{"type": e.get("type"), "loc": e.get("loc"), "msg": e.get("msg")} for e in errors]


@app.exception_handler(RequestValidationError)
async def handle_request_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Overrides FastAPI's default 422 handler app-wide. See module
    docstring — this closes the leak for ANY endpoint's malformed
    request, not only /analyze, since a wrongly-shaped field on any
    route could carry PII-shaped content."""
    return JSONResponse(status_code=422, content={"detail": _safe_pydantic_errors(exc.errors())})


@app.exception_handler(PIILeakDetected)
async def handle_pii_leak(request: Request, exc: PIILeakDetected) -> JSONResponse:
    """400 + stable errorCode, per orchestrator ruling #4. `violations`
    contains only find_pii_leaks()'s payload-free descriptions (agentId,
    region type, correlation method) — never the offending value."""
    return JSONResponse(
        status_code=400,
        content={
            "errorCode": "PII_LEAK_DETECTED",
            "message": (
                "Request rejected: domSnapshot contains raw values for one or more "
                "nodes that redactedRegions (or the node's own sensitive flag) marks "
                "as sensitive. This is a client-side sanitization bug, not a problem "
                "with any specific value — no offending values are included in this "
                "response. See `violations` for which agentIds are affected."
            ),
            "violations": exc.violations,
        },
    )


@app.exception_handler(ModelSuppliedProfileValue)
async def handle_model_supplied_profile_value(
    request: Request, exc: ModelSuppliedProfileValue
) -> JSONResponse:
    """502 + stable errorCode "MODEL_SUPPLIED_PROFILE_VALUE" — the
    fill_profile security boundary (schemas.py ruling #7). Registered
    the same way as handle_pii_leak above: ModelSuppliedProfileValue is
    raised from inside ActionResponse's own model_validator, deliberately
    as a plain Exception subclass rather than a ValueError (see that
    validator's and the exception's own docstrings for why pydantic-core
    does NOT swallow it into a generic ValidationError) — so it
    propagates straight out of `ActionResponse.model_validate(raw_action)`
    in analyze() below, past that function's own `except ValidationError`,
    to this app-wide handler.

    The message below is a FIXED, static string. It interpolates nothing
    from the request, the VLM's raw output, or the exception instance
    (which carries no payload to interpolate in the first place — see
    ModelSuppliedProfileValue's docstring). An error path is a data
    egress path, and this is precisely the path the fill_profile design
    exists to close off, so it must not become the leak itself.
    """
    return JSONResponse(
        status_code=502,
        content={
            "errorCode": "MODEL_SUPPLIED_PROFILE_VALUE",
            "message": (
                "VLM backend returned a fill_profile action carrying a "
                "non-null value. Rejected: fill_profile must name a "
                "profileField category only (full_name/email/phone) — the "
                "actual value is filled in locally by the extension from "
                "the user's own profile, never supplied by the model. This "
                "is either a misbehaving model or a page attempting to "
                "smuggle data back out through the action channel. No "
                "value is echoed in this response."
            ),
        },
    )


async def get_validated_analyze_request(payload: AnalyzeRequest) -> AnalyzeRequest:
    """FastAPI dependency: resolves the request body as AnalyzeRequest
    (ordinary 422 structural validation happens implicitly here, before
    this function body even runs), then runs the Section 5 PII-leak
    check explicitly and raises PIILeakDetected (-> 400) if it fires.

    This is the ONE place the PII-leak check is wired for the live
    endpoint. Any future endpoint accepting AnalyzeRequest should depend
    on this function rather than the raw model, so the check can't be
    forgotten at a new call site.

    debug_dump.dump_request() runs FIRST, before the leak check —
    deliberately, so a request that trips PII_LEAK_DETECTED still gets
    dumped (it's a legitimate debugging target too: seeing exactly what
    leaked is useful). It is a complete no-op unless DEBUG_DUMP_DIR is
    set, and cannot raise, so this adds no behaviour change when the
    debug dump is (as it is by default) off.
    """
    debug_dump.dump_request(payload)

    leaks = find_pii_leaks(payload.domSnapshot, payload.redactedRegions)
    if leaks:
        raise PIILeakDetected(leaks)
    return payload


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/recent")
def recent() -> dict[str, Any]:
    """Counts-only live feed of recent /analyze requests, for the showcase site.

    Served cross-origin to a static page, so read live_feed.py's docstring
    before adding a field: RequestSummary is free-text-free BY CONSTRUCTION,
    and that is the only thing making this endpoint safe to expose at all.
    """
    return {"entries": live_feed.feed.recent(), "max": live_feed.MAX_ENTRIES}


@app.post("/analyze", response_model=ActionResponse)
def analyze(
    request: AnalyzeRequest = Depends(get_validated_analyze_request),
    vlm_client: VLMClient = Depends(get_vlm_client),
) -> ActionResponse:
    prompt = build_prompt(
        task_goal=request.taskGoal,
        dom_snapshot=request.domSnapshot,
        redacted_regions=request.redactedRegions,
    )

    context = VLMRequestContext(
        image_b64=request.image,
        dom_snapshot=request.domSnapshot,
        redacted_regions=request.redactedRegions,
        task_goal=request.taskGoal,
        prompt=prompt,
    )

    try:
        raw_action = vlm_client.analyze(context)
    except Exception as exc:  # noqa: BLE001 — any backend failure becomes a 502
        # Deliberately NOT embedding str(exc) here: a future VLM backend's
        # exception message is not audited for what it might echo (e.g. a
        # timeout error that includes the request body). Only the
        # exception's type name is surfaced; full detail goes to server
        # logs only (and even there, no payload is logged — see audit
        # note in the module docstring / report).
        raise HTTPException(
            status_code=502,
            detail={
                "errorCode": "VLM_BACKEND_CALL_FAILED",
                "message": f"VLM backend call failed ({type(exc).__name__}).",
            },
        ) from exc

    try:
        action = ActionResponse.model_validate(raw_action)
        # Recorded only after the payload cleared find_pii_leaks() and the
        # action cleared schema validation, so the feed can only ever describe
        # requests that actually completed. Counts and closed-enum values only
        # — see live_feed.py's docstring for why that is structural here.
        live_feed.feed.record(request, action)
        return action
    except ValidationError as exc:
        # The VLM (or mock) returned something that doesn't match the
        # strict action schema — e.g. an improvised action name. Fail
        # loudly rather than passing malformed output through to the
        # extension, per Section 4/5's "reject unknown actions at the
        # schema boundary" requirement. Errors are stripped the same way
        # as the request-validation path — see _safe_pydantic_errors.
        raise HTTPException(
            status_code=502,
            detail={
                "errorCode": "VLM_RESPONSE_SCHEMA_INVALID",
                "message": "VLM backend returned a response that failed action-schema validation.",
                "errors": _safe_pydantic_errors(exc.errors()),
            },
        ) from exc


# =============================================================================
# v2 — POST /v2/analyze (docs/v2/ARCHITECTURE.md contract C5, V1d).
#
# ADDITIVE ONLY: everything above this line (v1's /analyze, its schemas, its
# exception handlers) is UNCHANGED. v1 stays mounted per C5's explicit
# instruction ("/analyze v1 stays mounted, unchanged, until V4 passes") and
# its 220 pre-existing tests must stay green — verified by this agent's
# report, not asserted here.
# =============================================================================


@app.exception_handler(ModeViolationV2)
async def handle_mode_violation_v2(request: Request, exc: ModeViolationV2) -> JSONResponse:
    """400 + errorCode "MODE_VIOLATION" — schemas_v2.ModeViolationV2's
    docstring point 5: covers both directions of the mode/image mismatch
    (image present in semantic mode is the privacy-relevant direction —
    raw pixels reaching the server when the contract promised none — hence
    the same PII_LEAK_DETECTED-class 400 treatment rather than a generic
    422; image absent in image mode shares the same errorCode for one
    coherent contract rule rather than two). Message is fixed/static plus
    exc.detail, which is itself a static string set at the raise site
    (schemas_v2 never interpolates request content into it)."""
    return JSONResponse(
        status_code=400,
        content={
            "errorCode": "MODE_VIOLATION",
            "message": exc.detail,
        },
    )


@app.exception_handler(PIILeakDetectedV2)
async def handle_pii_leak_v2(request: Request, exc: PIILeakDetectedV2) -> JSONResponse:
    """400 + errorCode "PII_LEAK_DETECTED" — same errorCode string as v1's
    handler (different exception class, same external identity) so
    instrumentation counting by errorCode doesn't need to know which
    schema version fired. `violations` is payload-free — see
    schemas_v2.find_v2_pii_leaks / PIILeakDetectedV2 docstrings."""
    return JSONResponse(
        status_code=400,
        content={
            "errorCode": "PII_LEAK_DETECTED",
            "message": (
                "Request rejected: taskGoal, an element label, or a history "
                "value contains a PII-shaped value that is not wrapped in a "
                "token. This is a client-side tokenization bug, not a "
                "problem with any specific value — no offending values are "
                "included in this response. See `violations` for locations."
            ),
            "violations": exc.violations,
        },
    )


async def get_validated_analyze_request_v2(payload: AnalyzeRequestV2) -> AnalyzeRequestV2:
    """FastAPI dependency: ordinary structural 422 validation already
    happened by the time this function body runs (AnalyzeRequestV2 is
    resolved from the request body first). This function then explicitly
    runs, in order:

      1. The mode/image contract check -> ModeViolationV2 (400
         MODE_VIOLATION) if `image` presence doesn't match `mode`.
      2. The C5 server-side leak re-check -> PIILeakDetectedV2 (400
         PII_LEAK_DETECTED) if any string field carries an untokenized
         PII-shaped value.

    Mirrors v1's get_validated_analyze_request in spirit (explicit
    dependency-time checks, not model_validators, so each gets its own
    distinct status/errorCode rather than collapsing into a generic 422 —
    see schemas_v2 module docstring points 3/5 for why this can't live
    inside AnalyzeRequestV2 itself).
    """
    has_image = payload.image is not None
    wants_image = payload.mode.value == "image"
    if has_image != wants_image:
        if has_image:
            detail = (
                "AnalyzeRequestV2 carried an `image` while mode=='semantic'. "
                "Semantic mode must carry no pixels at all (C5's "
                "semantic-first egress default) — sending an image anyway "
                "is a privacy-contract violation, not merely a shape "
                "mismatch."
            )
        else:
            detail = (
                "AnalyzeRequestV2 had mode=='image' but no `image` field. "
                "Image mode requires the redacted render to be present."
            )
        raise ModeViolationV2(detail)

    leaks = find_v2_pii_leaks(payload)
    if leaks:
        raise PIILeakDetectedV2(leaks)

    return payload


def _known_tokens_in_request(request: AnalyzeRequestV2) -> set[str]:
    """V3 retry 2 (CLAUDE.md §7, item 2): every token-shaped substring
    (TOKEN_RE: `[A-Z][A-Z0-9]*#[0-9]+`) that genuinely appears somewhere
    in THIS request — taskGoal, every element's label, every history
    value. A model may only ever echo a token it was actually given;
    anything else is invented, and C2's whole tokenization guarantee
    (the extension substitutes the real value only for a token it
    itself minted) is void for a token the extension never issued.

    C5/C2 amendment (2026-09-26): vault tokens (`request.vault`) are ALSO
    known, even though they never appear in taskGoal/labels/history —
    that absence is exactly the bug this amendment fixes. Before this, a
    real (non-scripted) planner had no legitimate way to learn a
    `PROFILE...#n` token exists at all, so it could only ever reach a
    profile value by guessing a token shape and getting UNKNOWN_TOKEN-
    rejected. `request.vault` is the ANNOUNCEMENT of the token's existence
    (token + category only, never a value — VaultEntry's own docstring),
    so trusting it here is exactly as safe as trusting a token seen in
    taskGoal: both are things the CLIENT put in the request, never
    something the model asserted about itself.
    """
    known: set[str] = set(TOKEN_RE.findall(request.taskGoal))
    for el in request.elements:
        if el.label:
            known.update(TOKEN_RE.findall(el.label))
    for h in request.history:
        if h.action.value:
            known.update(TOKEN_RE.findall(h.action.value))
    known.update(v.token for v in request.vault)
    return known


def compute_server_verdict(action: ModelActionV2, request: AnalyzeRequestV2) -> tuple[ServerVerdict, str]:
    """Deterministic serverVerdict computation (C5 / this agent's brief
    item 3, extended by V3 retry 2 item 2). The model may NEVER supply
    serverVerdict itself — there is no field for it to supply
    (ModelActionV2 has none); this function is the ONLY place a v2
    serverVerdict is produced.

    First match wins:
      1. unknown targetId (not the PAGE sentinel, not a known element) -> reject
      2. `value` present on a `fill_profile` action -> reject (same RULE as
         v1's ModelSuppliedProfileValue, different MECHANISM — see
         schemas_v2 module docstring point 3: this is a verdict, not an
         exception, so the endpoint still returns 200)
      3. `value` contains a token-shaped substring that does not appear
         ANYWHERE in this request (taskGoal / any element label / any
         history value) -> reject UNKNOWN_TOKEN, value never echoed.
         Added after V3's retry-1 benchmark showed llama3.1:8b typing a
         token that existed nowhere in the request (invented, most
         likely by pattern-copying the prompt's own few-shot examples) —
         a deterministic backstop for exactly that failure mode, since a
         hallucinated token is exactly as dangerous as a raw PII value:
         the extension would try to rehydrate it and either throw or,
         worse, silently resolve to the wrong stored value.
      4. `value` containing an untokenized PII-shaped regex match -> reject
         RAW_VALUE_IN_ACTION. Checked only when rule 3 didn't already
         reject — a value containing an unknown token has no raw PII of
         its own to additionally flag (the token IS the whole reason
         contains_unmasked_pii's token-masking would otherwise pass it).
      otherwise -> accept

    Deliberately narrower than C4's full decide(): this never returns
    "ask" (module docstring point 4 in schemas_v2.py) — "ask" needs
    client-side sensitivity/tier/consent context this endpoint doesn't
    have. That's extension-side policy.js's job (C4), not this server's.
    """
    known_ids = {el.agentId for el in request.elements}
    if action.targetId != PAGE_TARGET_ID_V2 and action.targetId not in known_ids:
        return ServerVerdict.REJECT, "UNKNOWN_TARGET"

    if action.action == ActionTypeV2.FILL_PROFILE and action.value is not None:
        return ServerVerdict.REJECT, "FILL_PROFILE_VALUE_SUPPLIED"

    if action.value:
        tokens_in_value = set(TOKEN_RE.findall(action.value))
        if tokens_in_value and not tokens_in_value.issubset(_known_tokens_in_request(request)):
            return ServerVerdict.REJECT, "UNKNOWN_TOKEN"

    if contains_unmasked_pii(action.value):
        return ServerVerdict.REJECT, "RAW_VALUE_IN_ACTION"

    return ServerVerdict.ACCEPT, "ok"


@app.post("/v2/analyze", response_model=ActionResponseV2)
def analyze_v2(
    request: AnalyzeRequestV2 = Depends(get_validated_analyze_request_v2),
    # get_vlm_client_v2 (VLM_BACKEND_V2, default "ollama") -- DELIBERATELY
    # separate from v1's get_vlm_client (VLM_BACKEND, default "mock").
    # V3 brief item 6: "Do not change v1 /analyze defaults." See
    # vlm_client.get_vlm_client_v2's docstring.
    vlm_client: VLMClient = Depends(get_vlm_client_v2),
) -> ActionResponseV2:
    prompt = build_prompt_v2(
        mode=request.mode,
        task_goal=request.taskGoal,
        elements=request.elements,
        regions=request.regions,
        history=request.history,
        vault=request.vault,
    )

    context = VLMRequestContextV2(
        mode=request.mode,
        task_goal=request.taskGoal,
        elements=request.elements,
        regions=request.regions,
        history=request.history,
        vault=request.vault,
        image_b64=request.image,
        prompt=prompt,
    )

    try:
        raw_action = vlm_client.analyze_v2(context)
    except NotImplementedError as exc:
        # A v2-unwired backend (Claude/Gemini today — see vlm_client.py's
        # VLMClient.analyze_v2 default). Distinct from VLM_BACKEND_CALL_FAILED
        # so instrumentation can tell "this backend can't do v2 yet" apart
        # from "the backend call itself failed".
        raise HTTPException(
            status_code=502,
            detail={
                "errorCode": "VLM_BACKEND_V2_NOT_IMPLEMENTED",
                "message": str(exc),
            },
        ) from exc
    except Exception as exc:  # noqa: BLE001 — any other backend failure becomes a 502
        raise HTTPException(
            status_code=502,
            detail={
                "errorCode": "VLM_BACKEND_CALL_FAILED",
                "message": f"VLM backend call failed ({type(exc).__name__}).",
            },
        ) from exc

    try:
        model_action = ModelActionV2.model_validate(raw_action)
    except ValidationError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "errorCode": "VLM_RESPONSE_SCHEMA_INVALID",
                "message": "VLM backend returned a response that failed v2 action-schema validation.",
                "errors": _safe_pydantic_errors(exc.errors()),
            },
        ) from exc

    verdict, reason = compute_server_verdict(model_action, request)

    # SECURITY: never echo `value` on a non-accept verdict. `value` is
    # backend/model-controlled content (and, per ModelSuppliedProfileValue's
    # precedent in v1, potentially a prompt-injected page trying to smuggle
    # data back out through this exact response channel). A reject already
    # means the action won't be acted on — reflecting the attempted value
    # back into the response body would be the same "error path is a data
    # egress path" mistake this project has fixed twice before (Phase 2c's
    # original PII-leak echo; ModelSuppliedProfileValue's payload-free
    # design). This applies uniformly to all three reject reasons
    # (UNKNOWN_TARGET / FILL_PROFILE_VALUE_SUPPLIED / RAW_VALUE_IN_ACTION),
    # not just the PII one — value is never trustworthy once verdict says
    # don't act on it.
    safe_value = model_action.value if verdict == ServerVerdict.ACCEPT else None

    response = ActionResponseV2(
        action=model_action.action,
        targetId=model_action.targetId,
        value=safe_value,
        profileField=model_action.profileField,
        key=model_action.key,
        revision=request.revision,
        serverVerdict=verdict,
        reason=reason,
    )
    # Recorded only after the payload cleared C6's leak re-check and the
    # action cleared schema validation — same placement rule as v1's
    # live_feed.feed.record() above. Counts and closed-enum values only.
    live_feed.feed.record_v2(request, response)
    return response
