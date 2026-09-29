"""Pytest config: put server/ on sys.path so tests can `import schemas`,
`import vlm_client`, `import main` the same way uvicorn does (server/ is
not a package — main.py itself uses bare `from schemas import ...`).

Also provides the `load_fixture` fixture for reading tests/fixtures/*.json
by filename, used across unit tests.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Callable

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SERVER_DIR = REPO_ROOT / "server"
FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"

if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))


@pytest.fixture
def load_fixture() -> Callable[[str], dict]:
    """Fixture: returns a callable that loads a JSON fixture by filename
    from tests/fixtures/."""

    def _load(name: str) -> dict:
        with open(FIXTURES_DIR / name, "r", encoding="utf-8") as f:
            return json.load(f)

    return _load


@pytest.fixture(autouse=True)
def _default_v2_backend_to_mock(monkeypatch: pytest.MonkeyPatch) -> None:
    """V3 (planner-local): vlm_client.get_vlm_client_v2()'s PRODUCTION
    default is VLM_BACKEND_V2="ollama" (a real local model, real network
    call to Ollama's HTTP API) -- correct for the running server, wrong
    for a hermetic, fast pytest run. Force every test back to the mock
    backend unless a test explicitly overrides VLM_BACKEND_V2 itself
    (monkeypatch.setenv stacks fine) or uses FastAPI's
    app.dependency_overrides[main.get_vlm_client_v2] (which bypasses this
    env var entirely -- dependency_overrides always wins).

    v1's get_vlm_client()/VLM_BACKEND is UNCHANGED and already defaults to
    "mock" with nothing set -- this fixture only touches the new v2-only
    env var, per the same "don't change v1 defaults" rule the production
    code follows.
    """
    monkeypatch.setenv("VLM_BACKEND_V2", "mock")
