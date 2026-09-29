"""In-process FastAPI TestClient tests for ner/app.py -- no torch, no
gliner, no 110s cold load. `model_loader.STATE.model` is set directly to a
FakeModel (same shape as tests/unit/test_ner_engine.py's) rather than going
through the real load_model(), and the background-load startup hook is
neutered so lifespan startup never races a real load in against the fake.

Covers the phase-brief-mandated checks: 503 before load, host refusal, and
"never logs request bodies or span text."
"""

from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path
from typing import Any, Dict, List

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from fastapi.testclient import TestClient  # noqa: E402

import ner.app as ner_app  # noqa: E402
import ner.config as ner_config  # noqa: E402
import ner.model_loader as model_loader  # noqa: E402


class FakeModel:
    def __init__(self, markers: Dict[str, tuple]):
        self.markers = markers
        self.calls: List[List[str]] = []

    def inference(self, texts, labels, threshold=0.5, batch_size=8, **kwargs) -> List[List[Dict[str, Any]]]:
        self.calls.append(list(texts))
        out = []
        for text in texts:
            ents = []
            for marker, (label, score) in self.markers.items():
                if label not in labels or score < threshold:
                    continue
                idx = text.find(marker)
                if idx == -1:
                    continue
                ents.append({"start": idx, "end": idx + len(marker), "text": marker, "label": label, "score": score})
            out.append(ents)
        return out


@pytest.fixture(autouse=True)
def _isolate_state(monkeypatch):
    """Neuter the real background model load (so TestClient's lifespan
    startup, whichever way this Starlette version fires it, never kicks off
    a genuine ~110s GLiNER load against a fake test), reset STATE, and clear
    the shared span cache so tests don't leak into each other."""
    monkeypatch.setattr(model_loader, "start_background_load", lambda *a, **kw: None)
    model_loader.STATE.model = None
    model_loader.STATE.loading = False
    model_loader.STATE.load_error = None
    ner_app.CACHE.clear()
    yield
    model_loader.STATE.model = None
    model_loader.STATE.loading = False
    model_loader.STATE.load_error = None
    ner_app.CACHE.clear()


@pytest.fixture
def client():
    with TestClient(ner_app.app) as c:
        yield c


# ---------------------------------------------------------------------------
# GET /health
# ---------------------------------------------------------------------------


def test_health_reports_not_loaded_before_load(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["loaded"] is False
    assert body["model"] == ner_config.MODEL_ID
    assert "labels" in body and isinstance(body["labels"], list) and len(body["labels"]) == 7


def test_health_reports_loaded_true_once_model_is_set(client):
    model_loader.STATE.model = FakeModel({})
    resp = client.get("/health")
    assert resp.json()["loaded"] is True


def test_health_surfaces_load_error_when_present(client):
    model_loader.STATE.load_error = "RuntimeError: boom"
    resp = client.get("/health")
    assert resp.json()["loadError"] == "RuntimeError: boom"


# ---------------------------------------------------------------------------
# POST /ner -- 503 before load
# ---------------------------------------------------------------------------


def test_ner_503_while_model_not_loaded(client):
    resp = client.post("/ner", json={"texts": ["hello"]})
    assert resp.status_code == 503
    assert resp.json()["loaded"] is False


def test_ner_returns_spans_once_loaded(client):
    model_loader.STATE.model = FakeModel({"Priya Sharma": ("person name", 0.9)})
    resp = client.post("/ner", json={"texts": ["Hi, I am Priya Sharma"]})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["spans"]) == 1
    assert body["spans"][0][0]["label"] == "PERSONNAME"
    assert body["spans"][0][0]["source"] == "ner"


def test_repeated_call_is_a_cache_hit_no_second_model_call(client):
    model = FakeModel({"Priya Sharma": ("person name", 0.9)})
    model_loader.STATE.model = model
    payload = {"texts": ["Hi, I am Priya Sharma"]}
    r1 = client.post("/ner", json=payload)
    r2 = client.post("/ner", json=payload)
    assert r1.json() == r2.json()
    assert len(model.calls) == 1


# ---------------------------------------------------------------------------
# Request validation limits (C3: <=200 items, each <=4000 chars) and the
# "error path is a data egress path" guard
# ---------------------------------------------------------------------------


def test_text_over_4000_chars_rejected_without_echoing_it_back(client):
    model_loader.STATE.model = FakeModel({})
    long_text = "A" * 4001
    resp = client.post("/ner", json={"texts": [long_text]})
    assert resp.status_code == 422
    assert long_text not in resp.text
    for err in resp.json()["detail"]:
        assert "input" not in err
        assert "ctx" not in err


def test_more_than_200_texts_rejected(client):
    model_loader.STATE.model = FakeModel({})
    resp = client.post("/ner", json={"texts": ["x"] * 201})
    assert resp.status_code == 422


def test_unknown_extra_field_rejected():
    with TestClient(ner_app.app) as client:
        model_loader.STATE.model = FakeModel({})
        resp = client.post("/ner", json={"texts": ["hi"], "extra": "nope"})
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Host refusal middleware (unit-level: call the ASGI middleware function
# directly with a synthetic Request, since TestClient always reports its
# own synthetic client as loopback-allow-listed "testclient")
# ---------------------------------------------------------------------------


def _make_request(client_host):
    from starlette.requests import Request

    scope = {
        "type": "http",
        "method": "GET",
        "path": "/health",
        "headers": [],
        "client": (client_host, 12345) if client_host else None,
    }

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    return Request(scope, receive)


def test_refuse_non_loopback_client_is_blocked():
    request = _make_request("8.8.8.8")
    called = {"v": False}

    async def call_next(_req):
        called["v"] = True
        return "should not be reached"

    resp = asyncio.run(ner_app._refuse_non_loopback(request, call_next))
    assert resp.status_code == 403
    assert called["v"] is False


@pytest.mark.parametrize("host", ["127.0.0.1", "::1", "testclient"])
def test_refuse_non_loopback_allows_loopback_hosts(host):
    request = _make_request(host)
    sentinel = object()

    async def call_next(_req):
        return sentinel

    result = asyncio.run(ner_app._refuse_non_loopback(request, call_next))
    assert result is sentinel


def test_refuse_non_loopback_blocks_when_client_is_none():
    request = _make_request(None)

    async def call_next(_req):
        return "should not be reached"

    resp = asyncio.run(ner_app._refuse_non_loopback(request, call_next))
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# No request body / span text in logs
# ---------------------------------------------------------------------------


def test_no_request_body_or_span_text_in_logs(client, caplog):
    secret_text = "My password is Tr0ub4dor&3, my name is Priya Sharma"
    model_loader.STATE.model = FakeModel({"Priya Sharma": ("person name", 0.9)})

    with caplog.at_level(logging.DEBUG):
        resp = client.post("/ner", json={"texts": [secret_text]})
    assert resp.status_code == 200

    all_log_text = "\n".join(record.getMessage() for record in caplog.records)
    assert secret_text not in all_log_text
    assert "Priya Sharma" not in all_log_text
    assert "Tr0ub4dor" not in all_log_text
