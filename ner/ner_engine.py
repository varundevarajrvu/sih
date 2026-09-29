"""ner/ner_engine.py -- C3's `detectEntities(texts) -> PiiSpan[][]`: the
batch + cache + chunk orchestration layer.

This module never imports torch or gliner itself. It is handed an
already-loaded model object exposing GLiNER's real `inference()` signature
(`inference(texts: list[str], labels: list[str], threshold: float = 0.5,
batch_size: int = 8, ...) -> list[list[dict]]` -- see
spikes/gliner/.venv/Lib/site-packages/gliner/model.py), so unit tests can
substitute a lightweight fake with the same shape and exercise
chunking/caching/offset-remapping/label-mapping without paying GLiNER's
~110s cold load or needing torch installed at all.

Pipeline per detect_entities() call, matching the phase brief's required
latency mitigations in order:
  1. cache lookup per text (sha256 key) -- a full cache hit costs one dict
     lookup, no model call.
  2. every text that missed the cache is chunked (chunking.chunk_text) to
     respect GLiNER's max_len word budget.
  3. ALL uncached chunks, across ALL uncached texts in the request, go into
     ONE model.inference() call -- "batch inference over the uncached texts
     in one model call" from the brief, not one call per text.
  4. each chunk's raw entities are remapped onto the ORIGINAL string's
     offsets, mapped from GLiNER's natural-language label to C1's
     PiiLabel, filtered by that label's own confidence floor (labels.py),
     and checked against the structural-descriptor guard.
  5. entities re-detected in more than one chunk's overlap window are
     deduped back down to one span per (start, end, label).
  6. the per-text result is cached before being returned.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Protocol

from . import config
from . import labels as labels_mod
from .cache import LRUSpanCache, text_key
from .chunking import chunk_text


class InferenceModel(Protocol):
    def inference(
        self,
        texts: List[str],
        labels: List[str],
        threshold: float = 0.5,
        batch_size: int = 8,
        **kwargs: Any,
    ) -> List[List[Dict[str, Any]]]: ...


def _map_and_filter(raw_entities: List[Dict[str, Any]], offset: int) -> List[Dict[str, Any]]:
    """Remap one chunk's raw GLiNER entities onto absolute offsets in the
    original string, translate the GLiNER label to a C1 PiiLabel, drop
    anything below that label's own confidence floor, and drop
    structural-descriptor false positives (labels.is_structural_descriptor).
    Output shape is exactly C1's PiiSpan: {start, end, label, score, source}.
    """
    out: List[Dict[str, Any]] = []
    for ent in raw_entities:
        gliner_label = ent.get("label")
        pii_label = labels_mod.LABEL_TO_PII_LABEL.get(gliner_label)
        if pii_label is None:
            # Defensive only -- GLINER_LABELS is the exhaustive, exact list
            # this service ever requests, so this branch should be
            # unreachable. False negatives on PII are the dangerous
            # direction, so an unrecognised label degrades to OTHER rather
            # than being silently discarded (mirrors C5's PiiType `other`
            # escape hatch).
            pii_label = "OTHER"
        score = float(ent.get("score", 0.0))
        if score < labels_mod.floor_for(pii_label):
            continue
        value = ent.get("text", "")
        if labels_mod.is_structural_descriptor(value):
            continue
        out.append(
            {
                "start": ent["start"] + offset,
                "end": ent["end"] + offset,
                "label": pii_label,
                "score": score,
                "source": "ner",
            }
        )
    return out


def _dedupe(spans: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Overlapping chunks independently re-detect any entity that falls
    inside their shared overlap window. Keep one instance per
    (start, end, label), preferring the higher score (ties: first seen --
    deterministic since eval-mode GLiNER is deterministic given identical
    input text, so true ties should in practice be identical detections
    anyway)."""
    best: "Dict[tuple, Dict[str, Any]]" = {}
    for span in spans:
        key = (span["start"], span["end"], span["label"])
        cur = best.get(key)
        if cur is None or span["score"] > cur["score"]:
            best[key] = span
    return sorted(best.values(), key=lambda s: (s["start"], s["end"]))


def detect_entities_single(
    text: str,
    model: InferenceModel,
    batch_size: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Run one text through chunking + the model + mapping. No cache
    involved -- callers that want caching go through detect_entities()."""
    if not text:
        return []
    if batch_size is None:
        batch_size = config.MODEL_BATCH_SIZE
    chunks = chunk_text(text)
    chunk_texts = [c.text for c in chunks]
    raw_results = model.inference(
        chunk_texts, labels_mod.GLINER_LABELS, threshold=labels_mod.PREDICT_FLOOR, batch_size=batch_size
    )
    all_spans: List[Dict[str, Any]] = []
    for chunk, raw in zip(chunks, raw_results):
        all_spans.extend(_map_and_filter(raw, chunk.offset))
    return _dedupe(all_spans)


def detect_entities(
    texts: List[str],
    model: InferenceModel,
    cache: Optional[LRUSpanCache] = None,
    batch_size: Optional[int] = None,
) -> List[List[Dict[str, Any]]]:
    """C3's `detectEntities(texts: string[]) -> PiiSpan[][]`.

    Cache-aware: every text whose sha256 is already in `cache` costs one
    dict lookup. Every text that misses is chunked, and ALL of those
    chunks -- across every uncached text in this one call -- are sent to
    the model in a single `model.inference()` call (batching), so a request
    with e.g. 40 mostly-repeat text nodes pays one model call for the
    handful that actually changed, not 40 separate calls.
    """
    if batch_size is None:
        batch_size = config.MODEL_BATCH_SIZE

    n = len(texts)
    results: List[Optional[List[Dict[str, Any]]]] = [None] * n
    keys = [text_key(t) for t in texts]

    # Empty strings never touch the model or the cache lookup machinery --
    # trivially "no entities", every time.
    for i, t in enumerate(texts):
        if not t:
            results[i] = []

    if cache is not None:
        for i, key in enumerate(keys):
            if results[i] is None:
                cached = cache.get(key)
                if cached is not None:
                    results[i] = cached

    pending_indices = [i for i in range(n) if results[i] is None]

    if pending_indices:
        job_chunks: List[str] = []
        job_owner: List[int] = []
        job_offset: List[int] = []
        for i in pending_indices:
            for c in chunk_text(texts[i]):
                job_chunks.append(c.text)
                job_owner.append(i)
                job_offset.append(c.offset)

        raw_results: List[List[Dict[str, Any]]] = (
            model.inference(
                job_chunks,
                labels_mod.GLINER_LABELS,
                threshold=labels_mod.PREDICT_FLOOR,
                batch_size=batch_size,
            )
            if job_chunks
            else []
        )

        per_text_spans: Dict[int, List[Dict[str, Any]]] = {i: [] for i in pending_indices}
        for owner, offset, raw in zip(job_owner, job_offset, raw_results):
            per_text_spans[owner].extend(_map_and_filter(raw, offset))

        for i in pending_indices:
            spans = _dedupe(per_text_spans[i])
            results[i] = spans
            if cache is not None:
                cache.put(keys[i], spans)

    return results  # type: ignore[return-value]
