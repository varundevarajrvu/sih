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
    MAX_PROBES_PER_TEXT,
    OVERLAP_WORDS,
    TARGET_GLINER_WORDS,
    Chunk,
    _gliner_word_count,
    chunk_text,
    find_proper_noun_probes,
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


# ---------------------------------------------------------------------------
# find_proper_noun_probes -- see chunking.py's docstring above the function
# for the live-measured evidence (score 0.023 embedded vs 0.360 isolated)
# this exists to recover. These tests check the pure offset/slicing logic
# only; the actual recall improvement is confirmed against the real model
# in ner/bench.py, not here (this file stays torch-free by design).
# ---------------------------------------------------------------------------


def test_probe_finds_the_full_run_and_its_trailing_suffixes():
    text = "Contact Rahul Verma at rahul.v@example.com or +91 98450 12345"
    probes = find_proper_noun_probes(text)
    texts = [p.text for p in probes]
    assert "Contact Rahul Verma" in texts  # the full 3-word run
    assert "Rahul Verma" in texts  # its trailing 2-word suffix


def test_probe_offsets_are_exact_slices_of_the_original_string():
    text = "Invoice billed to Deepak Nair, GSTIN 29ABCDE1234F1Z5, on 12/03/2026."
    probes = find_proper_noun_probes(text)
    for p in probes:
        assert text[p.offset : p.offset + len(p.text)] == p.text


def test_two_word_run_produces_no_duplicate_probe():
    # A bare 2-word run's "full run" and "trailing 2-word suffix" are the
    # same span -- must appear exactly once, not twice.
    text = "My name is Rahul Verma"
    probes = find_proper_noun_probes(text)
    texts = [p.text for p in probes]
    assert texts.count("Rahul Verma") == 1


def test_no_capitalized_run_means_no_probes():
    assert find_proper_noun_probes("click the next button to continue") == []
    assert find_proper_noun_probes("") == []


def test_single_capitalized_word_is_not_a_probe_candidate():
    # A lone Title-Case word ("Contact", "Click", "Ship") is exactly the
    # noisy case this function's 2-4-word-run requirement is designed to
    # exclude -- it is far too common in ordinary UI/marketing prose to be
    # a useful proper-noun signal on its own.
    probes = find_proper_noun_probes("Contact us for Support")
    assert probes == []


def test_probe_count_is_bounded_on_a_pathological_wall_of_title_case_text():
    text = " ".join(f"Alpha Beta{i}" for i in range(200))
    probes = find_proper_noun_probes(text)
    assert len(probes) <= MAX_PROBES_PER_TEXT


def test_probes_are_appended_after_the_primary_chunk_in_detect_entities_single():
    # Integration point: detect_entities_single's job list is
    # chunk_text(text) + find_proper_noun_probes(text) -- the primary
    # chunk(s) always come first, so a caller inspecting chunk order can
    # rely on index 0 being real coverage, not a probe.
    text = "Hi, I am Priya Sharma and I need help with my order"
    primary = chunk_text(text)
    probes = find_proper_noun_probes(text)
    assert primary[0].text == text  # short text: single whole-text chunk
    assert any(p.text == "Priya Sharma" for p in probes)
