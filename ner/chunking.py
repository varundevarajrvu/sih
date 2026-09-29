"""ner/chunking.py -- pure, dependency-free text chunking for GLiNER's
max_len (a WORD budget counted by GLiNER's OWN tokenizer, not a char budget
and NOT a simple whitespace-run word count -- see the correction below,
found empirically by ner/bench.py, not assumed).

`urchade/gliner_multi_pii-v1` was trained with max_len=384
(spikes/gliner/.hf/hub/models--urchade--gliner_multi_pii-v1/snapshots/*/
gliner_config.json). C3's `texts[]` items may be up to 4000 chars, so long
inputs are chunked here, each chunk run independently, and the resulting
entity offsets remapped back onto the ORIGINAL string by ner_engine.py.

CORRECTION (found running ner/bench.py against the real model on the
f10_checkout_blob fixture, spikes/gliner/fixtures.json -- an early version
of this module estimated GLiNER's word budget with plain
`re.finditer(r"\\S+")`, i.e. whitespace-run counting, with what looked like
generous headroom under max_len=384. In production this still triggered
GLiNER's OWN internal truncation ("Sentence of length 424 has been
truncated to 384") on a chunk this module had sized at exactly 300
whitespace-run words. Root cause: GLiNER does not tokenize by whitespace
run. Its default splitter (spikes/gliner/.venv/Lib/site-packages/gliner/
data_processing/tokenizer.py, `WhitespaceTokenSplitter`) uses the regex
`r"\\w+(?:[-_]\\w+)*|\\S"` -- every punctuation character that isn't part of
a hyphenated/underscored word (each `.`, `,`, `(`, `)`, `:`, `&`, ...) is
its OWN token. Prose is close to 1:1 with a whitespace-run count; a
number/punctuation-dense checkout blob ("Rs. 799", "(Black, 2.4GHz)",
"4,596") is not -- that fixture measured a 424/300 = ~1.41x expansion over
plain whitespace-run counting.

Fix: `_GLINER_WORD_RE` below is that exact regex, copied (not imported --
importing `gliner` pulls in `torch` at module import time, which would
defeat this module's only real requirement: staying importable without
torch, see ner/model_loader.py's docstring for why that matters) so this
module can count words the way GLiNER actually will. `chunk_text()` uses
that count to decide IF a text needs splitting, then estimates a
`\\S+`-word chunk size from the text's OWN measured expansion ratio
(punctuation-light prose gets bigger chunks; dense text gets smaller
ones), and VERIFIES every resulting chunk's real GLiNER-word count against
the target before returning -- shrinking and re-slicing (bounded retries)
if any chunk still comes in over budget, rather than trusting the ratio
estimate blindly. This is what "no dropped spans at chunk boundaries" is
actually being tested against (tests/unit/test_ner_chunking.py).

Chunks are still built on `\\S+` word boundaries (never mid-word), and
OVERLAP_WORDS is sized to comfortably contain any single PII entity even
when it straddles a chunk boundary -- the longest entity in the fixture set
is the ~10-word f10 address, so 50 words of overlap is generous, not a
tight fit.
"""

from __future__ import annotations

import re
from typing import List, NamedTuple, Tuple

# GLiNER's real word budget for this model (gliner_config.json's max_len).
# TARGET_GLINER_WORDS sits well under it -- ~17% headroom -- because the
# module docstring's correction showed a fixed headroom over a NAIVE word
# count is not safe; this module verifies against the real count per chunk
# rather than trusting the margin alone.
GLINER_MAX_LEN = 384
TARGET_GLINER_WORDS = 320
OVERLAP_WORDS = 50

_WORD_RE = re.compile(r"\S+")
# Mirrors gliner's WhitespaceTokenSplitter exactly -- see module docstring.
_GLINER_WORD_RE = re.compile(r"\w+(?:[-_]\w+)*|\S")

_MAX_SHRINK_ATTEMPTS = 6
_SHRINK_FACTOR = 0.75


class Chunk(NamedTuple):
    text: str
    offset: int  # char offset of `text` within the original string


def _gliner_word_count(text: str) -> int:
    return len(_GLINER_WORD_RE.findall(text))


def _slice_by_words(
    text: str,
    words: List[Tuple[int, int]],
    chunk_words: int,
    overlap_words: int,
) -> List[Chunk]:
    chunk_words = max(1, chunk_words)
    overlap_words = max(0, min(overlap_words, chunk_words - 1))
    stride = max(1, chunk_words - overlap_words)

    chunks: List[Chunk] = []
    i = 0
    n = len(words)
    while i < n:
        j = min(i + chunk_words, n)
        start_char = words[i][0]
        end_char = words[j - 1][1]
        chunks.append(Chunk(text=text[start_char:end_char], offset=start_char))
        if j >= n:
            break
        i += stride
    return chunks


def chunk_text(
    text: str,
    target_gliner_words: int = TARGET_GLINER_WORDS,
    overlap_words: int = OVERLAP_WORDS,
) -> List[Chunk]:
    """Split `text` into overlapping, word-bounded chunks, each verified to
    stay under GLiNER's real per-chunk word count (see module docstring).

    Returns a single chunk covering the whole string (offset 0) when it
    already fits -- the common case, since most page-text calls are well
    under the budget -- so the fast path never pays the chunking machinery
    any real cost.
    """
    if not text:
        return [Chunk(text="", offset=0)]

    total_gliner_words = _gliner_word_count(text)
    if total_gliner_words <= target_gliner_words:
        return [Chunk(text=text, offset=0)]

    words = [(m.start(), m.end()) for m in _WORD_RE.finditer(text)]
    if not words:
        return [Chunk(text=text, offset=0)]

    # Estimate a `\S+`-word chunk size from THIS text's own measured
    # expansion ratio (GLiNER-words / whitespace-run-words), so dense text
    # gets smaller chunks than plain prose rather than one fixed guess.
    expansion_ratio = total_gliner_words / len(words)
    chunk_words = max(1, int(target_gliner_words / expansion_ratio))

    chunks = _slice_by_words(text, words, chunk_words, overlap_words)
    for _ in range(_MAX_SHRINK_ATTEMPTS):
        worst = max((_gliner_word_count(c.text) for c in chunks), default=0)
        if worst <= target_gliner_words or chunk_words <= 1:
            break
        chunk_words = max(1, int(chunk_words * _SHRINK_FACTOR))
        chunks = _slice_by_words(text, words, chunk_words, overlap_words)

    return chunks
