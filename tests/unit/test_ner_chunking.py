"""Pure unit tests for ner/chunking.py. No torch, no gliner, no server venv
dependency -- runs in any Python with the repo on sys.path.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from ner.chunking import (  # noqa: E402
    GLINER_MAX_LEN,
    OVERLAP_WORDS,
    TARGET_GLINER_WORDS,
    _gliner_word_count,
    chunk_text,
)


def test_short_text_is_a_single_chunk_at_offset_zero():
    text = "Hi, I am Priya Sharma and I need help with my order"
    chunks = chunk_text(text)
    assert len(chunks) == 1
    assert chunks[0].text == text
    assert chunks[0].offset == 0


def test_empty_text_is_a_single_empty_chunk():
    chunks = chunk_text("")
    assert len(chunks) == 1
    assert chunks[0].text == ""
    assert chunks[0].offset == 0


def test_long_prose_text_splits_into_multiple_chunks_with_overlap():
    words = [f"word{i}" for i in range(1000)]
    text = " ".join(words)
    chunks = chunk_text(text, target_gliner_words=300, overlap_words=50)
    assert len(chunks) > 1
    for c in chunks:
        assert text[c.offset : c.offset + len(c.text)] == c.text


def test_chunks_cover_the_whole_text_with_no_gap():
    words = [f"word{i}" for i in range(1000)]
    text = " ".join(words)
    chunks = chunk_text(text, target_gliner_words=300, overlap_words=50)
    last = chunks[-1]
    assert last.offset + len(last.text) == len(text)
    for a, b in zip(chunks, chunks[1:]):
        assert b.offset <= a.offset + len(a.text)


def test_every_chunk_stays_within_gliners_real_word_budget():
    """The actual guarantee this module exists to provide: whatever the
    text's punctuation/number density, every chunk handed to the model
    must score at or under GLiNER's own word count, or GLiNER silently
    truncates it (the failure mode this module's docstring documents
    finding in production on the f10_checkout_blob fixture)."""
    dense = "Rs. 4,596 (Black, 2.4GHz) - Item #1: laptop-stand, USB-C @ 50% off! " * 40
    chunks = chunk_text(dense, target_gliner_words=320, overlap_words=50)
    assert len(chunks) > 1
    for c in chunks:
        assert _gliner_word_count(c.text) <= 320


def test_dense_punctuation_text_gets_smaller_chunks_than_plain_prose():
    prose_words = [f"word{i}" for i in range(1000)]
    prose = " ".join(prose_words)
    dense = "Rs. 4,596 (Black, 2.4GHz) - Item #1: laptop-stand, USB-C @ 50% off! " * 15

    prose_chunks = chunk_text(prose, target_gliner_words=320, overlap_words=50)
    dense_chunks = chunk_text(dense, target_gliner_words=320, overlap_words=50)

    # Dense text's GLiNER-word count grows much faster per character than
    # prose's, so its chunks (measured in characters) should be smaller.
    avg_prose_chunk_chars = sum(len(c.text) for c in prose_chunks) / len(prose_chunks)
    avg_dense_chunk_chars = sum(len(c.text) for c in dense_chunks) / len(dense_chunks)
    assert avg_dense_chunk_chars < avg_prose_chunk_chars


def test_an_entity_straddling_a_chunk_boundary_survives_in_at_least_one_chunk():
    """The phase brief's explicit case: 'no dropped spans at chunk
    boundaries.' Build a text where a short marker phrase sits exactly at
    the word index where a small, non-overlapping chunker would cut, and
    confirm the marker's full text is still contained, verbatim, within at
    least one chunk."""
    before = [f"filler{i}" for i in range(40)]
    marker = ["Francis", "Reuben", "R"]
    after = [f"filler{i}" for i in range(40, 80)]
    words = before + marker + after
    text = " ".join(words)
    marker_text = " ".join(marker)
    assert marker_text in text

    # A small target forces multiple chunks on this ~123-word text, placing
    # a naive non-overlapping cut boundary right in the middle of `marker`.
    chunks = chunk_text(text, target_gliner_words=42, overlap_words=10)
    assert len(chunks) > 1
    assert any(marker_text in c.text for c in chunks)


def test_module_constants_are_sane():
    assert TARGET_GLINER_WORDS < GLINER_MAX_LEN
    assert OVERLAP_WORDS < TARGET_GLINER_WORDS


def test_gliner_word_count_treats_punctuation_as_separate_tokens():
    # Mirrors gliner's WhitespaceTokenSplitter (r"\w+(?:[-_]\w+)*|\S"):
    # "Rs." is 2 tokens ("Rs", "."), "4,596" is 3 ("4", ",", "596").
    assert _gliner_word_count("Rs. 4,596") == 5
    # Hyphenated/underscored words stay one token.
    assert _gliner_word_count("laptop-stand") == 1
    assert _gliner_word_count("plain prose text") == 3
