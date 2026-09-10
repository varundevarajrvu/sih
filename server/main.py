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

Run with:
    uvicorn main:app --reload
"""

from __future__ import annotations

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from schemas import ActionResponse, AnalyzeRequest, PIILeakDetected, find_pii_leaks
from vlm_client import VLMClient, VLMRequestContext, build_prompt, get_vlm_client

app = FastAPI(title="SIH 26171 server-api", version="0.1.0")

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


async def get_validated_analyze_request(payload: AnalyzeRequest) -> AnalyzeRequest:
    """FastAPI dependency: resolves the request body as AnalyzeRequest
    (ordinary 422 structural validation happens implicitly here, before
    this function body even runs), then runs the Section 5 PII-leak
    check explicitly and raises PIILeakDetected (-> 400) if it fires.

    This is the ONE place the PII-leak check is wired for the live
    endpoint. Any future endpoint accepting AnalyzeRequest should depend
    on this function rather than the raw model, so the check can't be
    forgotten at a new call site.
    """
    leaks = find_pii_leaks(payload.domSnapshot, payload.redactedRegions)
    if leaks:
        raise PIILeakDetected(leaks)
    return payload


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


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
        return ActionResponse.model_validate(raw_action)
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
