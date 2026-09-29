"""Pure unit tests for ner/cache.py -- the LRU span cache. No torch, no
gliner.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from ner.cache import LRUSpanCache, text_key  # noqa: E402


def test_text_key_is_deterministic_sha256_hex():
    k1 = text_key("hello world")
    k2 = text_key("hello world")
    assert k1 == k2
    assert len(k1) == 64
    assert all(c in "0123456789abcdef" for c in k1)


def test_text_key_differs_for_different_text():
    assert text_key("hello") != text_key("Hello")


def test_cache_miss_then_hit():
    cache = LRUSpanCache(max_entries=8)
    key = text_key("some page text")
    assert cache.get(key) is None
    assert cache.misses == 1
    cache.put(key, [{"start": 0, "end": 4, "label": "PERSONNAME", "score": 0.9, "source": "ner"}])
    hit = cache.get(key)
    assert hit == [{"start": 0, "end": 4, "label": "PERSONNAME", "score": 0.9, "source": "ner"}]
    assert cache.hits == 1


def test_cache_evicts_least_recently_used_when_over_capacity():
    cache = LRUSpanCache(max_entries=2)
    cache.put("a", [1])
    cache.put("b", [2])
    cache.put("c", [3])  # evicts "a" (least recently touched)
    assert cache.get("a") is None
    assert cache.get("b") == [2]
    assert cache.get("c") == [3]
    assert len(cache) == 2


def test_get_refreshes_recency():
    cache = LRUSpanCache(max_entries=2)
    cache.put("a", [1])
    cache.put("b", [2])
    cache.get("a")  # "a" is now most-recently-used
    cache.put("c", [3])  # evicts "b", not "a"
    assert cache.get("a") == [1]
    assert cache.get("b") is None


def test_clear_resets_store_and_counters():
    cache = LRUSpanCache(max_entries=4)
    cache.put("a", [1])
    cache.get("a")
    cache.get("missing")
    cache.clear()
    assert len(cache) == 0
    assert cache.hits == 0
    assert cache.misses == 0
    assert cache.get("a") is None  # this call itself registers a new miss
    assert cache.misses == 1
