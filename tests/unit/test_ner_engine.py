"""Unit tests for ner/ner_engine.py -- the batch + cache + chunk
orchestration layer -- against a FAKE model (no torch, no gliner, no
110-second cold load). The fake implements GLiNER's real `.inference()`
signature and returns entity offsets LOCAL to whatever string it was
handed, exactly like the real model does per chunk, so these tests exercise
the actual offset-remapping and batching logic in ner_engine.py, not a
simplified stand-in for it.

Covers the phase-brief-mandated cases: label mapping, offset remapping
across chunks (including "no dropped spans at chunk boundaries"), and cache
hits.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from ner.cache import LRUSpanCache  # noqa: E402
from ner.ner_engine import detect_entities, detect_entities_single  # noqa: E402


class FakeModel:
    """Stand-in for GLiNER's `.inference()`. `markers` maps a substring to
    (gliner_label, score); for every input string, every configured marker
    found via str.find() becomes an entity with offsets LOCAL to that
    string -- exactly what the real model returns for a single chunk."""

    def __init__(self, markers: Dict[str, tuple]):
        self.markers = markers
        self.calls: List[List[str]] = []

    def inference(
        self,
        texts: List[str],
        labels: List[str],
        threshold: float = 0.5,
        batch_size: int = 8,
        **kwargs: Any,
    ) -> List[List[Dict[str, Any]]]:
        self.calls.append(list(texts))
        out: List[List[Dict[str, Any]]] = []
        for text in texts:
            ents: List[Dict[str, Any]] = []
            for marker, (label, score) in self.markers.items():
                if label not in labels or score < threshold:
                    continue
                idx = text.find(marker)
                if idx == -1:
                    continue
                ents.append({"start": idx, "end": idx + len(marker), "text": marker, "label": label, "score": score})
            out.append(ents)
        return out


# ---------------------------------------------------------------------------
# Label mapping + confidence floors
# ---------------------------------------------------------------------------


def test_label_is_mapped_to_c1_pii_label_and_source_is_ner():
    model = FakeModel({"Priya Sharma": ("person name", 0.95)})
    spans = detect_entities_single("Hi, I am Priya Sharma today", model)
    assert spans == [{"start": 9, "end": 21, "label": "PERSONNAME", "score": 0.95, "source": "ner"}]


def test_personname_below_060_strip_but_above_012_floor_is_still_returned():
    # Banding (strip/ask/ignore) is pii-tokenizer.js's job (C2), not this
    # service's -- the ner-service must hand back the raw score so the
    # tokenizer can band it, never pre-filter to only "confident" spans.
    model = FakeModel({"Francis Reuben R": ("person name", 0.24)})
    spans = detect_entities_single("Log in as Francis Reuben R", model)
    assert len(spans) == 1
    assert spans[0]["label"] == "PERSONNAME"
    assert spans[0]["score"] == 0.24


def test_personname_below_012_floor_is_dropped():
    model = FakeModel({"X": ("person name", 0.05)})
    spans = detect_entities_single("X marks the spot", model)
    assert spans == []


def test_non_personname_below_035_floor_is_dropped_even_if_above_012():
    model = FakeModel({"555-1234": ("phone number", 0.20)})
    spans = detect_entities_single("call 555-1234 now", model)
    assert spans == []


def test_email_and_phone_labels_map_correctly():
    model = FakeModel(
        {
            "rahul.v@example.com": ("email", 0.99),
            "+91 98450 12345": ("phone number", 0.99),
        }
    )
    spans = detect_entities_single("Contact at rahul.v@example.com or +91 98450 12345", model)
    labels_found = {s["label"] for s in spans}
    assert labels_found == {"EMAIL", "PHONE"}


def test_structural_descriptor_is_filtered_out():
    model = FakeModel({"Password": ("password", 0.98)})
    spans = detect_entities_single("Password", model)
    assert spans == []


def test_unmapped_gliner_label_falls_back_to_other_not_dropped():
    # Defensive branch: `detect_entities_single` always requests exactly
    # `labels_mod.GLINER_LABELS`, so a real model can never hand back a
    # label outside that list -- this exercises _map_and_filter directly
    # (as if some future caller widened the requested label set) to prove
    # a false negative on PII (silently dropping an unrecognised label)
    # cannot happen: it must degrade to OTHER instead.
    from ner.ner_engine import _map_and_filter

    raw = [{"start": 2, "end": 9, "text": "mystery", "label": "some new label", "score": 0.99}]
    spans = _map_and_filter(raw, offset=0)
    assert len(spans) == 1
    assert spans[0]["label"] == "OTHER"


# ---------------------------------------------------------------------------
# Offset remapping across chunks -- the phase-brief-mandated case
# ---------------------------------------------------------------------------


def test_offset_remapping_for_entity_in_a_later_chunk():
    before = " ".join(f"filler{i}" for i in range(320))  # forces >1 chunk (CHUNK_WORDS=300)
    marker = "Priya Sharma"
    text = f"{before} {marker} more words after"
    expected_start = text.find(marker)
    assert expected_start > 0

    model = FakeModel({marker: ("person name", 0.9)})
    spans = detect_entities_single(text, model)

    assert len(model.calls) == 1  # one inference() call carrying every chunk
    assert len(model.calls[0]) > 1  # text was actually split into >1 chunk
    assert spans == [{"start": expected_start, "end": expected_start + len(marker), "label": "PERSONNAME", "score": 0.9, "source": "ner"}]


def test_no_dropped_spans_at_chunk_boundary():
    """An entity positioned exactly where a non-overlapping chunker would
    cut must still survive, at the correct absolute offset, exactly once
    (not duplicated by both chunks that see it in their overlap window)."""
    from ner.chunking import chunk_text

    before = " ".join(f"filler{i}" for i in range(40))
    marker_words = ["Ananya", "Krishnan"]
    after = " ".join(f"filler{i}" for i in range(40, 80))
    text = f"{before} {' '.join(marker_words)} {after}"
    marker = " ".join(marker_words)
    expected_start = text.find(marker)

    # Use a small target word budget so the marker sits exactly at a
    # would-be non-overlapping cut boundary (word index ~40-42) -- the
    # default TARGET_GLINER_WORDS=320 wouldn't split this ~123-word text at
    # all. Then run the same map+dedupe path ner_engine.detect_entities_single
    # uses internally, driven by these boundary-triggering chunks.
    chunks = chunk_text(text, target_gliner_words=42, overlap_words=10)
    assert len(chunks) > 1

    model = FakeModel({marker: ("person name", 0.9)})
    # Exercise the same map+dedupe path the engine uses, driven by the
    # boundary-triggering chunk sizes above.
    from ner.ner_engine import _dedupe, _map_and_filter

    raw_per_chunk = model.inference([c.text for c in chunks], ["person name"], threshold=0.12, batch_size=8)
    all_spans = []
    for chunk, raw in zip(chunks, raw_per_chunk):
        all_spans.extend(_map_and_filter(raw, chunk.offset))
    spans = _dedupe(all_spans)

    assert spans == [
        {"start": expected_start, "end": expected_start + len(marker), "label": "PERSONNAME", "score": 0.9, "source": "ner"}
    ]


def test_empty_text_returns_empty_without_calling_model():
    model = FakeModel({})
    spans = detect_entities_single("", model)
    assert spans == []
    assert model.calls == []


# ---------------------------------------------------------------------------
# detect_entities() -- cache + batching across multiple texts
# ---------------------------------------------------------------------------


def test_cache_hit_serves_repeat_text_with_no_new_model_call():
    model = FakeModel({"Priya Sharma": ("person name", 0.9)})
    cache = LRUSpanCache(max_entries=8)
    texts = ["Hi, I am Priya Sharma"]

    first = detect_entities(texts, model, cache=cache)
    assert len(model.calls) == 1

    second = detect_entities(texts, model, cache=cache)
    assert len(model.calls) == 1  # no new inference() call -- served from cache
    assert second == first
    assert cache.hits == 1
    assert cache.misses == 1


def test_batch_inference_over_all_uncached_texts_in_one_model_call():
    model = FakeModel(
        {
            "Priya Sharma": ("person name", 0.9),
            "Rahul Verma": ("person name", 0.9),
        }
    )
    cache = LRUSpanCache(max_entries=8)
    texts = ["Hi, I am Priya Sharma", "Contact Rahul Verma today", "no pii here at all"]

    results = detect_entities(texts, model, cache=cache)

    assert len(model.calls) == 1  # ONE call covers every uncached text's chunks
    assert [s["label"] for s in results[0]] == ["PERSONNAME"]
    assert [s["label"] for s in results[1]] == ["PERSONNAME"]
    assert results[2] == []


def test_mixed_cached_and_uncached_texts_only_batches_the_uncached_ones():
    model = FakeModel(
        {
            "Priya Sharma": ("person name", 0.9),
            "Rahul Verma": ("person name", 0.9),
        }
    )
    cache = LRUSpanCache(max_entries=8)
    detect_entities(["Hi, I am Priya Sharma"], model, cache=cache)
    assert len(model.calls) == 1

    results = detect_entities(["Hi, I am Priya Sharma", "Contact Rahul Verma today"], model, cache=cache)
    assert len(model.calls) == 2  # second call carries ONLY the new text's chunk(s)
    assert len(model.calls[1]) == 1
    assert [s["label"] for s in results[0]] == ["PERSONNAME"]
    assert [s["label"] for s in results[1]] == ["PERSONNAME"]


def test_empty_texts_in_a_batch_never_reach_the_model():
    model = FakeModel({"Priya Sharma": ("person name", 0.9)})
    results = detect_entities(["", "Hi, I am Priya Sharma", ""], model, cache=None)
    assert results[0] == []
    assert results[2] == []
    assert len(model.calls) == 1
    assert model.calls[0] == ["Hi, I am Priya Sharma"]  # empty strings excluded from the batch


def test_no_cache_means_repeat_call_still_hits_the_model():
    model = FakeModel({"Priya Sharma": ("person name", 0.9)})
    detect_entities(["Hi, I am Priya Sharma"], model, cache=None)
    detect_entities(["Hi, I am Priya Sharma"], model, cache=None)
    assert len(model.calls) == 2
