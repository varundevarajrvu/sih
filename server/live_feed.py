"""In-memory live feed of recent /analyze requests, for the showcase site.

WHY THIS EXISTS: the site can state that redaction works, and it can quote a
past run, but until now it could not SHOW the thing happening. This gives it a
real source: while the extension is running against a real page, the server
records what it actually received and the page polls it.

============================================================================
🔴 THE DESIGN CONSTRAINT — this endpoint is a data-egress path.

Everything here is served to a web page over CORS `allow_origins=["*"]`. A
summary that quietly carried a DOM node's text, or the user's task goal, would
be a Section 5 violation shipped through the front door — and it would be the
same class of mistake as Phase 2c's original error handler, which refused
leaked PII and then echoed it back in the rejection body.

So the guarantee here is STRUCTURAL, not a convention to be remembered:

  RequestSummary has NO free-text field. Every attribute is an int, or a value
  drawn from a closed enum the schema layer already validates (PiiType,
  RegionSource, ActionType). There is no attribute that a page's text, a task
  goal, an element id, or a redacted value could occupy even if a future caller
  passed the whole AnalyzeRequest in and got careless.

`summarize()` is the only constructor path, it reads only counts and enum
members off the request, and it never touches `.text`, `.taskGoal`, `.image`
or `.value`. Test coverage asserts a sentinel PII string planted in every
free-text field of a request is absent from the serialized feed bytes.
============================================================================

The buffer is in-memory and per-process: it disappears on restart, is never
written to disk, and is capped. It is a live view, not a log.
"""

from __future__ import annotations

import threading
from collections import deque
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any

# How many recent requests the feed keeps. Small on purpose — this is "what is
# happening right now", not an audit trail, and an unbounded buffer in a
# long-lived process is a slow memory leak.
MAX_ENTRIES = 12


@dataclass(frozen=True)
class RequestSummary:
    """One /analyze request, reduced to counts and closed-enum values.

    Every field here is an int or an enum value. Adding a free-text field to
    this class would silently convert a counts-only feed into a data-egress
    path — see this module's docstring before doing so.
    """

    seq: int
    at: str                      # server-generated ISO-8601 UTC, not client-supplied
    domNodes: int
    sensitiveNodes: int
    redactedRegions: int
    domSourced: int
    visionSourced: int
    regionTypes: tuple[str, ...]  # PiiType values only — a closed enum
    imageBytes: int
    action: str                   # ActionType value — a closed enum
    leakCheck: str                # always "passed"; a failure never reaches here
    # v2 addition (2026-09-29): "semantic" (no pixels at all) or "image" (a
    # redacted screenshot was attached, by explicit escalation). Defaults to
    # "image" for v1 entries, which have no semantic/image distinction — v1's
    # architecture always captures and redacts an image, so that default
    # describes v1 accurately rather than inventing a third state for it.
    mode: str = "image"


class LiveFeed:
    """Thread-safe bounded ring of RequestSummary."""

    def __init__(self, max_entries: int = MAX_ENTRIES) -> None:
        self._entries: deque[RequestSummary] = deque(maxlen=max_entries)
        self._lock = threading.Lock()
        self._seq = 0

    def record(self, request: Any, action: Any) -> RequestSummary:
        """Summarize and store one request. Returns the stored summary.

        `request` is an AnalyzeRequest and `action` an ActionResponse, but this
        function deliberately reads only counts and enum members off them — see
        the module docstring. It is typed loosely to keep this module free of a
        circular import back into schemas.
        """
        regions = list(getattr(request, "redactedRegions", []) or [])
        dom_snapshot = list(getattr(request, "domSnapshot", []) or [])

        def _val(x: Any) -> str:
            # Enum -> its .value; plain str stays a str. Both are closed sets
            # validated by the schema layer before reaching here.
            return str(getattr(x, "value", x))

        # source is Optional[Literal["dom","vision"]] and may be absent on
        # older payloads; the server already infers it the same way elsewhere.
        def _source(region: Any) -> str:
            src = getattr(region, "source", None)
            if src is not None:
                return _val(src)
            return "dom" if getattr(region, "agentId", None) else "vision"

        image = getattr(request, "image", "") or ""

        with self._lock:
            self._seq += 1
            summary = RequestSummary(
                seq=self._seq,
                at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                domNodes=len(dom_snapshot),
                sensitiveNodes=sum(1 for n in dom_snapshot if getattr(n, "sensitive", False)),
                redactedRegions=len(regions),
                domSourced=sum(1 for r in regions if _source(r) == "dom"),
                visionSourced=sum(1 for r in regions if _source(r) == "vision"),
                regionTypes=tuple(sorted({_val(getattr(r, "type", "other")) for r in regions})),
                imageBytes=len(image),
                action=_val(getattr(action, "action", "")),
                leakCheck="passed",
            )
            self._entries.append(summary)
            return summary

    def record_v2(self, request: Any, action: Any) -> RequestSummary:
        """Same discipline as record() above (counts and closed-enum values
        only — see the module docstring), shaped from a v2 AnalyzeRequestV2 /
        ActionResponseV2 pair instead of v1's AnalyzeRequest / ActionResponse.

        Reuses the SAME RequestSummary dataclass and the SAME /recent
        endpoint and showcase-site table as v1 — v2's `elements`/`regions`
        map onto v1's `domSnapshot`/`redactedRegions` concepts closely enough
        that no new frontend code is needed, and a visitor sees both
        pipelines' traffic in one place. `mode` is the one field that
        actually differs in kind: "semantic" here means literally 0 image
        bytes were in the request, which record() below always sets to
        "image" since v1 has no semantic path at all.
        """
        elements = list(getattr(request, "elements", []) or [])
        regions = list(getattr(request, "regions", []) or [])

        def _val(x: Any) -> str:
            return str(getattr(x, "value", x))

        image = getattr(request, "image", "") or ""
        mode = _val(getattr(request, "mode", "image"))

        with self._lock:
            self._seq += 1
            summary = RequestSummary(
                seq=self._seq,
                at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                domNodes=len(elements),
                sensitiveNodes=sum(1 for e in elements if getattr(e, "sensitive", False)),
                redactedRegions=len(regions),
                domSourced=sum(1 for r in regions if _val(getattr(r, "source", "")) == "dom"),
                visionSourced=sum(1 for r in regions if _val(getattr(r, "source", "")) == "vision"),
                regionTypes=tuple(sorted({_val(getattr(r, "kind", "other")) for r in regions})),
                imageBytes=len(image),
                action=_val(getattr(action, "action", "")),
                leakCheck="passed",
                mode=mode,
            )
            self._entries.append(summary)
            return summary

    def recent(self) -> list[dict[str, Any]]:
        """Newest first, as plain JSON-serializable dicts."""
        with self._lock:
            return [asdict(e) for e in reversed(self._entries)]

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()
            self._seq = 0


# Module-level instance used by main.py. A single process serves one developer's
# local extension, so one shared feed is the whole requirement.
feed = LiveFeed()
