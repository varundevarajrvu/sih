"""ner/cache.py -- thread-safe LRU span cache keyed by sha256(text).

Page text barely changes between an agent's loop steps
(docs/v2/ARCHITECTURE.md, V0a gliner-spike phase result: "cache spans per
text node across steps... if a warm 2 KB page p95 is still > 1.5 s,
evaluate a smaller GLiNER"), so a repeat call for the exact same string must
cost close to nothing -- that's the single biggest lever this service has
against NER being the pipeline's latency bottleneck.

Keyed on the text's sha256 digest, not the text itself: the dict key that a
debugger repr, a crash dump, or an accidental log of the cache object would
show is a hex digest, never the PII-bearing string. (The VALUES stored are
the extracted PiiSpan lists plus the input text's byte length implicitly via
span offsets -- never the raw text itself.)
"""

from __future__ import annotations

import hashlib
import threading
from collections import OrderedDict
from typing import Any, Optional


def text_key(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class LRUSpanCache:
    """A bounded, thread-safe least-recently-used cache. `hits`/`misses`
    are exposed for the bench script and for /health-adjacent diagnostics;
    they are counts only, never content."""

    def __init__(self, max_entries: int = 512) -> None:
        self._max_entries = max_entries
        self._store: "OrderedDict[str, Any]" = OrderedDict()
        self._lock = threading.Lock()
        self.hits = 0
        self.misses = 0

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            if key not in self._store:
                self.misses += 1
                return None
            self._store.move_to_end(key)
            self.hits += 1
            return self._store[key]

    def put(self, key: str, value: Any) -> None:
        with self._lock:
            self._store[key] = value
            self._store.move_to_end(key)
            while len(self._store) > self._max_entries:
                self._store.popitem(last=False)

    def __len__(self) -> int:
        with self._lock:
            return len(self._store)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()
            self.hits = 0
            self.misses = 0
