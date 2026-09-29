"""ner/app.py -- C3 `ner-service`: a loopback-only FastAPI app exposing
POST /ner and GET /health.

    POST /ner  {"texts": string[]}   (<= 200 items, each <= 4000 chars)
            -> {"spans": PiiSpan[][]}   (source: "ner" on every span)
            -> 503 while the model is still loading

    GET  /health -> {"loaded": bool, "model": str, "labels": string[]}

Run from the repo root (see ner/README.md for the full command --
this venv is spikes/gliner/.venv, which already has torch+gliner+the
cached weights; server/.venv has neither):

    ..\\spikes\\gliner\\.venv\\Scripts\\python.exe -m uvicorn ner.app:app --host 127.0.0.1 --port 8757
"""

from __future__ import annotations

import logging
import time
from typing import Annotated, List

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from . import config
from . import labels as labels_mod
from . import model_loader
from .cache import LRUSpanCache
from .ner_engine import detect_entities

# ---------------------------------------------------------------------------
# Logging: "never logs request bodies or span text." Uvicorn's own access
# logger is disabled below (access_log=False in the __main__ uvicorn.run
# call) so its default per-request line -- which is safe on its own
# (method/path/status) but is one more thing to audit -- never runs; this
# app's own middleware (_log_request) logs ONLY method, path, status and
# duration, and never calls request.body() / inspects the response payload.
# Tested by tests/unit/test_ner_app.py: a call carrying a fixture's PII text
# must never appear, byte-for-byte, anywhere in captured log output.
# ---------------------------------------------------------------------------
logger = logging.getLogger("ner")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO)

CACHE = LRUSpanCache(max_entries=config.CACHE_MAX_ENTRIES)

app = FastAPI(title="ner-service", version="0.1.0")

# CORS: chrome-extension:// origins only, no wildcard -- same pattern as
# warden/config.py's CORS_ORIGIN_REGEX (Chrome extension ids are exactly 32
# chars from the alphabet a-p).
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^chrome-extension://[a-p]{32}$",
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

# TestClient's default ASGI scope reports its synthetic client as
# ("testclient", ...) rather than a loopback IP -- allow-listed here so the
# in-process test suite can exercise real request/response behaviour without
# spoofing a socket, while a genuine non-loopback caller is still refused.
_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "::1", "testclient"})


@app.middleware("http")
async def _refuse_non_loopback(request: Request, call_next):
    """Defense in depth for "binds 127.0.0.1:8757 only, refuses to start on
    any other host": the __main__ entry point below hardcodes the bind
    address so there is no config path to widen it, and this middleware
    additionally refuses any request whose ASGI-reported client address
    isn't loopback, in case the app is ever mounted by a different runner
    (e.g. `uvicorn ner.app:app --host 0.0.0.0` typed by mistake)."""
    client_host = request.client.host if request.client else None
    if client_host not in _LOOPBACK_HOSTS:
        return JSONResponse(status_code=403, content={"error": "loopback only"})
    return await call_next(request)


@app.middleware("http")
async def _log_request(request: Request, call_next):
    t0 = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - t0) * 1000.0
    # Method, path, status, duration ONLY -- see module docstring.
    logger.info("%s %s -> %s (%.1fms)", request.method, request.url.path, response.status_code, duration_ms)
    return response


@app.exception_handler(RequestValidationError)
async def _validation_error_handler(request: Request, exc: RequestValidationError):
    """An error path is a data egress path (this project's own established
    lesson -- CLAUDE.md Section 7 rule 5 / ARCHITECTURE.md's Phase 2c
    finding: the original PII-leak rejection echoed the offending payload
    back via Pydantic's default `input` field on every validation error).
    Strip `input`/`ctx` from every error before it leaves the process, so a
    malformed request can never cause this service to echo the text it was
    asked to scan."""
    sanitized = [{k: v for k, v in err.items() if k not in ("input", "ctx")} for err in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": sanitized})


@app.on_event("startup")
def _start_load() -> None:
    model_loader.start_background_load()


@app.get("/health")
def health():
    state = model_loader.STATE
    body = {
        "loaded": state.loaded,
        "model": config.MODEL_ID,
        "labels": list(labels_mod.GLINER_LABELS),
    }
    if state.load_error:
        body["loadError"] = state.load_error
    return body


TextItem = Annotated[str, Field(max_length=config.MAX_TEXT_CHARS)]


class NerRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    texts: List[TextItem] = Field(..., max_length=config.MAX_TEXTS_PER_REQUEST)


class PiiSpanOut(BaseModel):
    start: int
    end: int
    label: str
    score: float
    source: str


class NerResponse(BaseModel):
    spans: List[List[PiiSpanOut]]


@app.post("/ner", response_model=NerResponse)
async def ner(body: NerRequest):
    state = model_loader.STATE
    if not state.loaded:
        return JSONResponse(
            status_code=503,
            content={"error": "model not loaded yet", "loaded": False},
        )
    # CPU-bound torch inference must not block the asyncio event loop (which
    # would otherwise stall concurrent GET /health polls); run it in
    # Starlette's threadpool.
    spans = await run_in_threadpool(
        detect_entities, body.texts, state.model, CACHE, config.MODEL_BATCH_SIZE
    )
    return {"spans": spans}


if __name__ == "__main__":
    import uvicorn

    # access_log=False: see module docstring's logging section. host/port
    # are config.HOST (hardcoded "127.0.0.1") / config.PORT -- never taken
    # from argv, so there is no flag that can widen the bind address here.
    uvicorn.run(app, host=config.HOST, port=config.PORT, access_log=False)
