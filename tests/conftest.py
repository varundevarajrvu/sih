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
