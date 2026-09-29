"""V4b (integration-v2, part B) evidence-run helper -- NOT a change to server/.

Extends v4a_server_launcher.py's ScenarioVLMClient (same file, same
docstring reasoning: server/vlm_client.py's real MockVLMClient.analyze_v2()
is structurally safety-conscious -- it never targets a sensitive element at
all -- so it cannot express S3/S7 (refuse a sensitive field) or exercise S6's
multi-token fill without help. This file adds exactly two behaviours the
unmodified mock cannot express, per this phase's own brief ("extending mock
fixtures minimally"):

  S6 (shipping address, two fields, one goal): once the name field is filled,
     find an ADDRESS-prefixed token in the (already-tokenized) taskGoal and
     type it into the shipping ADDRESS field specifically (not just "the
     next empty text field", since the order of `elements` is not guaranteed
     to put the address field second).

  S7 (ask, driven through the real consent panel): identical mechanism to
     v4a's own email branch (a naive planner that doesn't know "sensitive"
     means anything, and targets the flagged field directly once nothing
     safe is left) -- kept here VERBATIM rather than re-derived, because it
     is already exactly the fixture S7 needs: something that names the
     (sensitive) email field so decide() asks, and the evidence run answers
     that ask via the real consent panel (Approve in one pass, Deny in
     another), not via window.confirm() dismissal (V4a's stopgap, now gone).

server/main.py and server/vlm_client.py are NOT edited by this file --
everything below lives in benchmarks/, exactly like v4a_server_launcher.py.

Usage:
    server\\.venv\\Scripts\\python.exe benchmarks\\v4b_server_launcher.py [--port 8000]

Captures every VLMRequestContextV2 this process's analyze_v2() is called
with to benchmarks/results/v4b-captured-contexts.jsonl (one JSON line per
call, flushed immediately -- same reasoning as v4a's capture file: Windows'
signal handling for a forcibly-stopped process is not reliable enough to
trust a shutdown-time dump).
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
os.chdir(SERVER_DIR)

CAPTURE_PATH = REPO_ROOT / "benchmarks" / "results" / "v4b-captured-contexts.jsonl"
CAPTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
CAPTURE_PATH.write_text("", encoding="utf-8")

os.environ.setdefault("VLM_BACKEND_V2", "mock")
os.environ.setdefault("VLM_BACKEND", "mock")

import main  # noqa: E402
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


class ScenarioVLMClientV4b(VLMClient):
    """See module docstring. Deterministic, stateless across calls."""

    def analyze(self, context: Any) -> dict[str, Any]:
        return {"action": "done", "targetId": "page", "value": None}

    def analyze_v2(self, context: Any) -> dict[str, Any]:
        _append_capture(context)

        goal_tokens = TOKEN_RE.findall(context.task_goal)
        name_token = next((t for t in goal_tokens if t.startswith("PERSONNAME")), None)
        email_token = next((t for t in goal_tokens if t.startswith("EMAIL")), None)
        address_token = next((t for t in goal_tokens if t.startswith("ADDRESS")), None)
        # LIVE FINDING (not anticipated when this branch was first written):
        # the real NER service tags "hunter2" itself as PASSWORD-shaped
        # inside the goal sentence "...the value hunter2" (GLiNER's own
        # "password" label, unprompted -- see ner/app.py's /health labels
        # list) -- so by the time taskGoal reaches THIS function it already
        # reads "...the value PASSWORD#1", and the literal string "hunter2"
        # is gone from what any real backend could ever see, having been
        # tokenized OUT OF THE GOAL ITSELF, not just out of page content.
        # v1's famous "the model wrote hunter2, guessed from the
        # instruction" demo beat cannot be reproduced verbatim in v2 for
        # exactly this reason -- the instruction never reaches a real
        # backend un-redacted either. Echoing the TOKEN (mirroring every
        # other branch here) is what a real backend's own only-ever-sees-
        # tokens view could legitimately do.
        password_token = next((t for t in goal_tokens if t.startswith("PASSWORD")), None)

        # S4 (checkout / IRREVERSIBLE_ACTION): click whatever the page's own
        # markup calls "Place Order" -- no PII token involved at all. Text
        # match is deliberately on the RAW label: "Place Order" carries no
        # PII signal, so C1/C2's regex+NER pipeline never touches it and it
        # survives into el.label unchanged (unlike password_token above).
        # Checked before the generic non-sensitive-fallback branch further
        # down so this scenario's own specific goal always finds its own
        # specific control, rather than an incidental non-sensitive field
        # elsewhere on the page.
        for el in context.elements:
            if not el.sensitive and el.label and "place order" in el.label.lower():
                return {"action": "click", "targetId": el.agentId, "value": None}

        # Profile autofill ("fill all my details"): gated on the goal's own
        # wording (never fires for an unrelated goal that merely happens to
        # share a page with a profile-shaped field -- see S4's checkout
        # button collision risk this guards against symmetrically).
        #
        # C5/C2 amendment (2026-09-26): PREFERRED mechanism is now `type` +
        # a VAULT token, mirroring server/vlm_client.py's REAL
        # MockVLMClient.analyze_v2()'s own updated behaviour (that file's
        # own amendment comment has the full "why" -- fill_profile stays
        # accepted on the wire for v1 back-compat only; the v2 planner
        # uses type + a vault token). `_profile_field_for_v2`-equivalent
        # matching (type email/tel needs to be EMPTY; a name-shaped label
        # needs the word "name" but not "user") is inlined here rather
        # than imported, since this file has no dependency on server/'s
        # own private helper.
        vault_by_field = {entry.field.value: entry.token for entry in context.vault}
        if vault_by_field and ("my details" in context.task_goal.lower() or "all my" in context.task_goal.lower()):
            for el in context.elements:
                if el.sensitive:
                    continue
                if el.type in ("email", "tel") and not (el.label or "").strip():
                    field = "email" if el.type == "email" else "phone"
                    token = vault_by_field.get(field)
                    if token:
                        return {"action": "type", "targetId": el.agentId, "value": token}
            for el in context.elements:
                if el.sensitive:
                    continue
                label = (el.label or "").strip().lower()
                if label and "name" in label.split() and "user" not in label:
                    token = vault_by_field.get("full_name")
                    if token:
                        return {"action": "type", "targetId": el.agentId, "value": token}

        # S6: an element shaped like the shipping ADDRESS field specifically
        # (agentId/tag/type alone can't distinguish "name" from "address" --
        # both are input[type=text] -- so this looks at the element's own
        # tokenized `label`, which for an UNFILLED field is its placeholder
        # text, same "label is placeholder until filled" property v4a's own
        # comment already documents for the name field). Checked BEFORE the
        # generic name branch below so a page with BOTH an empty name field
        # and an empty address field doesn't route the address token into
        # the name field just because it happens to iterate first.
        if address_token:
            for el in context.elements:
                if el.sensitive:
                    continue
                label = (el.label or "").lower()
                if el.type == "text" and "address" in label and address_token not in label:
                    return {"action": "type", "targetId": el.agentId, "value": address_token}

        # S1/S3/S6 (name half): first NON-sensitive text field whose label
        # doesn't already carry the name token -- verbatim from v4a's own
        # ScenarioVLMClient (see that file's comment for why "label is
        # empty" is the wrong check here).
        if name_token:
            for el in context.elements:
                if el.sensitive:
                    continue
                if el.type == "text" and name_token not in (el.label or ""):
                    return {"action": "type", "targetId": el.agentId, "value": name_token}

        # S3/S7: nothing safe left. If the goal named an email, act like a
        # naive planner that doesn't know "sensitive" means anything --
        # target the (flagged) email field directly. One of two branches
        # that ever touch a sensitive element, by design -- exists to prove
        # decide()'s SENSITIVE_TARGET rule fires and the consent flow (deny
        # -> blocked, approve -> executed) gates it, not to simulate good
        # planning. Identical to v4a's own email branch.
        for el in context.elements:
            if el.sensitive and el.type == "email" and email_token:
                return {"action": "type", "targetId": el.agentId, "value": email_token}

        # S2: a password ask. See the password_token comment above for why
        # this echoes the TOKEN, not a literal string -- same mechanism as
        # the email/name/address branches, just for a password-type field.
        # decide()'s rule 4 (SENSITIVE_TARGET) is what asks here.
        if password_token:
            for el in context.elements:
                if el.sensitive and el.type == "password":
                    return {"action": "type", "targetId": el.agentId, "value": password_token}

        return {"action": "done", "targetId": "page", "value": None}


main.app.dependency_overrides[main.get_vlm_client_v2] = lambda: ScenarioVLMClientV4b()


if __name__ == "__main__":
    import uvicorn

    port = 8000
    if "--port" in sys.argv:
        port = int(sys.argv[sys.argv.index("--port") + 1])

    print(f"V4b scenario server starting on 127.0.0.1:{port} (get_vlm_client_v2 overridden -- see module docstring)", flush=True)
    print(f"Per-call captures append live to {CAPTURE_PATH}", flush=True)
    uvicorn.run(main.app, host="127.0.0.1", port=port, log_level="info")
