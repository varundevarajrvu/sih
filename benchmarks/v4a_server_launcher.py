"""V4a (integration-v2) evidence-run helper -- NOT a change to server/.

server/'s own MockVLMClient.analyze_v2() (server/vlm_client.py, ~line 911)
is structurally safety-conscious by design: every branch skips a sensitive
element outright ("Else if the first non-sensitive node ..."), so it can
never target a field flagged sensitive at all. That is the right behaviour
for CI/tests (VLM_BACKEND_V2=mock's whole point is "never accidentally
act on something"), but it also means the unmodified mock literally
cannot express scenario 3 from DEMO-SCRIPT.md ("fills the name, refuses
the email -- in one task") -- there is no way to observe the policy engine
REFUSING a targeted write if the backend never targets the sensitive field
in the first place.

CLAUDE.md's V4a brief anticipates exactly this: "If the mock backend
cannot express a scenario, extend its v2 fixtures minimally and say so."
This file is that minimal extension, done the way server/'s OWN test
suite already does it (tests/unit/test_v2_analyze.py's `_FixedActionClient`
+ `app.dependency_overrides[main.get_vlm_client_v2]` -- an officially
established pattern in this codebase for reaching a path "the real
MockVLMClient can't reach on its own"), applied to a REAL uvicorn process
instead of an in-process TestClient so a real browser can hit it over the
network. server/main.py and server/vlm_client.py are NOT edited by this
file -- ScenarioVLMClient lives entirely here, in benchmarks/, and is
deleted/ignored once the evidence run is done.

ScenarioVLMClient is a small, deterministic, goal-token-driven fake
planner -- NOT an NLP model. It reads the tokenized taskGoal it was
handed (e.g. "fill the name as PERSONNAME#1"), finds the first goal token
by label prefix, and either types it into the first empty, non-sensitive,
plausibly-matching field (this is what proves rehydrate() + the "type"
path), or -- once nothing non-sensitive is left to fill and the goal names
an EMAIL token -- targets the (sensitive) email field the way a naive real
model would (it has no notion of "sensitive"; it just sees a matching
empty field). That second branch is what proves the policy engine, not the
planner, is what refuses PII fields.

Usage:
    server\\.venv\\Scripts\\python.exe benchmarks\\v4a_server_launcher.py

Captures EVERY VLMRequestContextV2 this process's analyze_v2() is called
with (i.e. every request that passed C5 structural validation AND the
server's own PII-leak re-check) by APPENDING one JSON line per call to
benchmarks/results/v4a-captured-contexts.jsonl, flushed immediately --
so the evidence run's privacy audit has the server-side view of exactly
what reached /v2/analyze, not just the client's own claim. Appending
per-call (rather than batching at shutdown) is deliberate: Windows'
signal handling for a forcibly-stopped process is unreliable enough that
a shutdown-time dump cannot be trusted to run at all.

Usage:
    server\\.venv\\Scripts\\python.exe benchmarks\\v4a_server_launcher.py
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
SERVER_DIR = REPO_ROOT / "server"
sys.path.insert(0, str(SERVER_DIR))
os.chdir(SERVER_DIR)  # server/main.py's debug_dump etc. write relative to cwd

CAPTURE_PATH = REPO_ROOT / "benchmarks" / "results" / "v4a-captured-contexts.jsonl"
CAPTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
# Fresh file per launch -- a stale capture from an earlier run must never
# be silently mixed into this run's evidence.
CAPTURE_PATH.write_text("", encoding="utf-8")

# VLM_BACKEND_V2=mock is still set so the module-level default (used by any
# request this override does NOT intercept, if ever run without the
# override) matches the letter of the V4a brief ("Start the server on port
# 8000 with VLM_BACKEND_V2=mock"). The dependency_override below replaces
# it for actual traffic; see the module docstring for why.
os.environ.setdefault("VLM_BACKEND_V2", "mock")
os.environ.setdefault("VLM_BACKEND", "mock")

import main  # noqa: E402  (after sys.path/cwd setup, matches uvicorn's own resolution)
from vlm_client import VLMClient  # noqa: E402

TOKEN_RE = re.compile(r"[A-Z][A-Z0-9]*#[0-9]+")


def _context_to_jsonable(context: Any) -> dict[str, Any]:
    return {
        "mode": getattr(context.mode, "value", str(context.mode)),
        "taskGoal": context.task_goal,
        "elements": [el.model_dump(mode="json") for el in context.elements],
        "regions": [r.model_dump(mode="json") for r in context.regions],
        "history": [h.model_dump(mode="json") for h in context.history],
        "hasImage": context.image_b64 is not None,
    }


def _append_capture(context: Any) -> None:
    with CAPTURE_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(_context_to_jsonable(context)))
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())


class ScenarioVLMClient(VLMClient):
    """See module docstring. Deterministic, stateless across calls -- each
    call only ever looks at the CURRENT context it is handed."""

    def analyze(self, context: Any) -> dict[str, Any]:
        return {"action": "done", "targetId": "page", "value": None}

    def analyze_v2(self, context: Any) -> dict[str, Any]:
        _append_capture(context)

        goal_tokens = TOKEN_RE.findall(context.task_goal)
        name_token = next((t for t in goal_tokens if t.startswith("PERSONNAME")), None)
        email_token = next((t for t in goal_tokens if t.startswith("EMAIL")), None)

        # Prefer a safe write: the first NON-sensitive, text-typed element
        # that doesn't ALREADY carry the goal's own PERSONNAME token,
        # naming that token as the value. A real model cannot know the raw
        # name -- it can only ever have seen "PERSONNAME#1" in the
        # tokenized taskGoal, so this mirrors the one thing a real backend
        # COULD legitimately do here.
        #
        # NOT "label is empty": action-executor.js's getAccessibleText()
        # deliberately falls back to an input's PLACEHOLDER text when it
        # has no value (v1's own documented, accepted scope limit -- C5's
        # `label` cannot distinguish "empty, showing a placeholder" from
        # "has real content", by design). demo/test-page.html's own
        # fullName field has placeholder="Enter your full name", so
        # `not label.strip()` is FALSE even when nothing has been typed
        # yet -- checked live in this run's first pass, which is why this
        # reads the token's ABSENCE from the label instead. Once typed,
        # agent-loop-v2.js's actedAgentIds excludes the field from every
        # later step's elements[] entirely, so this check only ever needs
        # to fire once per field regardless.
        for el in context.elements:
            if el.sensitive:
                continue
            if el.type == "text" and name_token and name_token not in (el.label or ""):
                return {"action": "type", "targetId": el.agentId, "value": name_token}

        # Nothing safe left to fill. If the goal also named an email, act
        # like a naive planner that doesn't know "sensitive" means
        # anything -- target the (flagged) email field directly. This is
        # deliberately the ONLY branch that ever touches a sensitive
        # element: it exists to prove decide()'s SENSITIVE_TARGET rule
        # fires and the consent-denied path blocks it, not to simulate
        # good planning.
        for el in context.elements:
            if el.sensitive and el.type == "email" and email_token:
                return {"action": "type", "targetId": el.agentId, "value": email_token}

        return {"action": "done", "targetId": "page", "value": None}


main.app.dependency_overrides[main.get_vlm_client_v2] = lambda: ScenarioVLMClient()


if __name__ == "__main__":
    import uvicorn

    print("V4a scenario server starting on 127.0.0.1:8000 (get_vlm_client_v2 overridden -- see module docstring)", flush=True)
    print(f"Per-call captures append live to {CAPTURE_PATH}", flush=True)
    uvicorn.run(main.app, host="127.0.0.1", port=8000, log_level="info")
