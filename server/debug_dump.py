"""
Debug dump for POST /analyze — OFF by default, opt-in via DEBUG_DUMP_DIR.

WHY THIS EXISTS: redaction happens on the captured screenshot, not the
live page, so there was previously no practical way to confirm a black
bar actually landed on the right pixels (e.g. an iframe's password
field after the frame-offset math). Counters like `framesMerged: 1`
look identical whether the offset is right or wrong — only looking at
the actual bytes that were sent settles it. This module makes that a
one-env-var operation instead of a DevTools → Network → copy-a-base64-
blob routine.

============================================================================
🔴 SAFETY POINT — READ BEFORE ENABLING THIS.

A dump can contain UNREDACTED PII precisely when it is most useful. The
whole reason to turn this on is to investigate a SUSPECTED REDACTION
FAILURE — which means the images this writes are exactly the ones that
might have a readable password, email, or face in them. This inverts
the usual "it's fine, it's already redacted" reasoning that holds
everywhere else in this codebase (Section 5 of CLAUDE.md). Treat every
file this writes as if it might contain a real credential, because it
might.

Consequences, enforced here and documented in server/README.md:
  - Default is OFF. Unset DEBUG_DUMP_DIR -> zero behaviour change: no
    directory is created, nothing is written, this module does nothing.
  - When it IS enabled, `warn_if_enabled()` logs a loud, named warning
    at server startup so it is never silently on.
  - The dump directory must be .gitignore'd (see repo-root .gitignore)
    — a leaked debug dump in a public repo would be a genuinely bad
    outcome for a privacy project.
  - Delete dumps after you're done with them. NEVER enable this for a
    live demo.
============================================================================

A write failure here (bad path, permissions, disk full, corrupt base64)
must NEVER break /analyze — this is a debugging aid bolted onto a real
endpoint, not a feature the endpoint depends on. Every failure is
caught, logged, and swallowed; callers get no signal that anything
happened either way.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from schemas import AnalyzeRequest

logger = logging.getLogger("server.debug_dump")

ENV_VAR = "DEBUG_DUMP_DIR"


def _dump_dir() -> Optional[Path]:
    """Return the configured dump directory, or None if dumping is off.

    Read fresh from the environment on every call rather than cached at
    import time, so the setting can be toggled at test time (or in a
    long-lived process, in principle) without restarting the server.
    Unset or empty/whitespace-only -> None -> OFF. This is the single
    gate everything else in this module goes through.
    """
    raw = os.environ.get(ENV_VAR, "").strip()
    return Path(raw) if raw else None


def warn_if_enabled() -> None:
    """Call once at server startup (see main.py's lifespan handler).

    Logs an unmissable warning naming the directory when DEBUG_DUMP_DIR
    is set, so debug dumping is never silently on. Does nothing (no log
    line at all) when it's unset — a disabled debugging aid should be
    invisible, not noisy.
    """
    dump_dir = _dump_dir()
    if dump_dir is not None:
        logger.warning(
            "DEBUG DUMP IS ENABLED (%s=%s) -- every /analyze request will "
            "be written to this directory as a PNG + JSON pair. THESE "
            "DUMPS CAN CONTAIN UNREDACTED PII: that is exactly what makes "
            "them useful for debugging a suspected redaction failure, and "
            "exactly why they must be deleted after use and NEVER enabled "
            "for a live demo. Unset %s to turn this off.",
            ENV_VAR,
            str(dump_dir),
            ENV_VAR,
        )


def _timestamp_slug() -> str:
    """Sortable, filesystem-safe UTC timestamp: 2026-09-14T10-22-31-123Z.
    Colons are illegal in Windows filenames, hence the hyphenated form
    instead of literal ISO-8601."""
    now = datetime.now(timezone.utc)
    millis = now.microsecond // 1000
    return now.strftime("%Y-%m-%dT%H-%M-%S") + f"-{millis:03d}Z"


def dump_request(payload: AnalyzeRequest) -> None:
    """Best-effort debug dump of one /analyze request. No-op unless
    DEBUG_DUMP_DIR is set.

    Writes two files per request, sharing a common timestamp+random
    prefix so they sort together and correlate at a glance:
      - "<prefix>-image.png"   the decoded screenshot, as bytes on disk
      - "<prefix>-payload.json" the request payload, MINUS the base64
        `image` field (it's redundant with the .png above, and inlining
        a multi-KB base64 blob makes the JSON unreadable)

    NEVER raises. Every failure mode (missing/invalid base64, an
    unwritable directory, a path that collides with an existing file,
    disk full, ...) is caught and logged; the caller — /analyze's
    request-validation dependency — proceeds exactly as if this
    function had not been called at all.
    """
    dump_dir = _dump_dir()
    if dump_dir is None:
        return

    try:
        dump_dir.mkdir(parents=True, exist_ok=True)

        prefix = f"{_timestamp_slug()}-{uuid.uuid4().hex[:6]}"
        image_path = dump_dir / f"{prefix}-image.png"
        payload_path = dump_dir / f"{prefix}-payload.json"

        image_bytes = base64.b64decode(payload.image, validate=False)
        image_path.write_bytes(image_bytes)

        # model_dump(mode="json") gives a plain JSON-serializable dict
        # (enums -> their .value, nested models -> nested dicts) without
        # re-running AnalyzeRequest's extra="forbid" validation, which
        # would reject the extra "_dump" bookkeeping key added below.
        payload_dict = payload.model_dump(mode="json")
        payload_dict.pop("image", None)
        payload_dict["_dump"] = {
            "imageFile": image_path.name,
            "warning": (
                "This dump may contain UNREDACTED PII. Delete after use. "
                "See server/README.md."
            ),
        }
        payload_path.write_text(
            json.dumps(payload_dict, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
    except Exception:  # noqa: BLE001 — a debug aid must never take down /analyze
        logger.exception(
            "debug dump failed for a /analyze request (dir=%r); request "
            "processing continues normally",
            str(dump_dir),
        )
