# `ner/` -- V1b `ner-service` (contract C3)

A separate, loopback-only FastAPI app providing GLiNER-based free-text PII
detection (person names, addresses, DOB, account numbers, plus email/phone
as a recall backstop to `server/pii_regex_v2.py`) for the Dhristi v2
privacy pipeline. Implements `docs/v2/ARCHITECTURE.md` contract C3's
`detectEntities(texts: string[]) -> PiiSpan[][]`, chosen as a **local
process** (not in-browser ONNX) per the V0a `gliner-spike` phase result:
browser recall was 0/3 vs Python's 3/3 on the same fixtures, and the
browser path failed all four legs of the pre-registered decision rule.

This service never shares a process with `server/` (which may talk to a
cloud VLM) and makes **no outbound network calls** once its model is
cached (`HF_HUB_OFFLINE=1` / `TRANSFORMERS_OFFLINE=1` are set before torch
or gliner are ever imported, in `ner/config.py`).

## Run it

Uses `spikes/gliner/.venv` -- the working venv from the V0a spike that
already has CPU torch 2.14 + gliner + the cached
`urchade/gliner_multi_pii-v1` weights (1.1 GB at `spikes/gliner/.hf`).
`fastapi`/`uvicorn`/`httpx`/`pytest`/`pytest-timeout` were added to this
same venv rather than creating a second one, to avoid a second torch
install and to reuse the cached weights without re-downloading them.
`server/.venv` has fastapi/uvicorn/pytest but **not** torch/gliner, so it
cannot run this service (see "Why two venvs" below).

From the repo root:

```powershell
spikes\gliner\.venv\Scripts\python.exe -m uvicorn ner.app:app --host 127.0.0.1 --port 8757
```

or equivalently:

```powershell
spikes\gliner\.venv\Scripts\python.exe -m ner.app
```

Both hardcode `host="127.0.0.1"` (`ner/config.py`'s `HOST` constant, never
read from argv or the environment) -- there is no flag that widens the
bind address. If you want to add this to `start-demo.ps1` (not done here --
that script belongs to a different, currently-in-flight phase; do not edit
it as part of V1b), the equivalent line, following that script's existing
`Wait-ForUrl`/`Test-Port` pattern, is:

```powershell
$nerPython = Join-Path $root "spikes\gliner\.venv\Scripts\python.exe"
Start-Process -FilePath $nerPython -ArgumentList "-m","uvicorn","ner.app:app","--host","127.0.0.1","--port","8757" -WindowStyle Hidden
Wait-ForUrl -Url "http://127.0.0.1:8757/health" -TimeoutSec 130   # cold load measured 20-110s depending on CPU contention
```

## Endpoints

```
GET  /health
  -> {"loaded": bool, "model": "urchade/gliner_multi_pii-v1", "labels": [...7 labels]}
  -> "loadError" key present (string) if the background load failed
  -> always 200; never reports loaded:true before the model actually is

POST /ner
  body: {"texts": string[]}   <= 200 items, each <= 4000 chars, no extra fields
  -> 200 {"spans": PiiSpan[][]}   one array per input text, in order
       PiiSpan = {start, end, label, score, source: "ner"}
       label in {PERSONNAME, ADDRESS, DOB, ACCOUNTNUMBER, PASSWORD, EMAIL, PHONE, OTHER}
  -> 503 {"error": "...", "loaded": false}   while the model is still loading
  -> 422 {"detail": [...]}   on a malformed request (input/ctx stripped, see below)
```

CORS: `chrome-extension://` origins only (`^chrome-extension://[a-p]{32}$`),
no wildcard.

## Guarantees, and how each is enforced/tested

- **Loopback only.** `ner/config.py`'s `HOST` is hardcoded `"127.0.0.1"`
  and never read from config/argv (`ner/app.py`'s `__main__`). Defense in
  depth: `_refuse_non_loopback` middleware 403s any request whose
  ASGI-reported client isn't `127.0.0.1`/`::1` (plus TestClient's synthetic
  `"testclient"` host, allow-listed for the in-process test suite only).
  Tested directly (`tests/unit/test_ner_app.py::test_refuse_non_loopback_*`)
  by constructing synthetic `Request` objects with spoofed client
  addresses, since `TestClient` itself can't be made to present a
  non-loopback client.
- **Never logs request bodies or span text.** `ner/app.py`'s own request
  logger logs only `method path -> status (duration)`; uvicorn's own access
  log is disabled (`access_log=False`) in the `__main__` entry point.
  Tested: `test_no_request_body_or_span_text_in_logs` sends a request
  carrying a password and a name through `POST /ner` with `caplog` at
  `DEBUG` and asserts neither substring appears anywhere in captured log
  output.
- **No outbound network calls.** `HF_HUB_OFFLINE=1` / `TRANSFORMERS_OFFLINE=1`
  set in `ner/config.py`, imported first by every other module, before
  torch/gliner/transformers are ever imported in the process.
- **Never 200-ready before the model has loaded.** `GET /health`'s
  `loaded` field reads `model_loader.STATE.loaded` directly (`model is not
  None`), no separate "ready" flag that could drift from it. `POST /ner`
  checks the same state and 503s otherwise.
- **An error path is a data egress path.** `RequestValidationError` is
  caught and `input`/`ctx` are stripped from every error entry before the
  422 response is serialized -- a request whose `texts` item exceeds 4000
  chars never gets that string echoed back. Ported lesson from this
  project's own Phase 2c finding (CLAUDE.md Section 7 rule 5): the
  original `/analyze` PII-leak rejection echoed the offending payload back
  via Pydantic's default `input` field, and the test suite that existed
  then only checked rejection status, never response content. Tested here:
  `test_text_over_4000_chars_rejected_without_echoing_it_back`.
- **Never fails PII recall silently.** Every latency mitigation
  (cache/chunking/threading) leaves the confidence-band logic untouched --
  the service always returns the raw score for a span down to its label's
  floor (PERSONNAME 0.12, everything else 0.35, matching C2's bands
  exactly); banding into strip/ask/ignore is `pii-tokenizer.js`'s job
  (C2), not this service's. See `ner/labels.py`.

## Latency mitigations (all required by the phase brief; see `ner/*.py` module docstrings for the "why")

1. **Preload at startup, in a background thread** (`ner/model_loader.py`,
   ported from `warden/entities.py`'s `ModelState`/`load_model` pattern) --
   `GET /health` answers immediately with `loaded:false` instead of the
   socket blocking on a ~20-110s cold load.
2. **LRU span cache keyed by `sha256(text)`** (`ner/cache.py`) -- a repeat
   call for byte-identical text costs one dict lookup. Measured live (curl,
   real model): first call on 3 fixtures 1,490 ms, repeat call 107 ms.
3. **Batch inference over uncached texts in one model call**
   (`ner/ner_engine.py::detect_entities`) -- every uncached text's chunks,
   across the whole request, go into a single `model.inference()` call,
   not one call per text.
4. **Torch threads tuned for this machine**
   (`ner/model_loader.py::_configure_torch_threads`, `NER_TORCH_THREADS`,
   default 6 of the i5-1334U's 12 logical threads -- leaves headroom for
   whatever else is running).
5. **Per-label thresholds matching C2's bands exactly** (`ner/labels.py`):
   request GLiNER down to the lowest floor any label uses (0.12, for
   PERSONNAME), then re-filter each span against its own label's floor, so
   a genuinely low-confidence name is never discarded before the tokenizer
   gets to band it.
6. **Long-text chunking with overlap and offset remapping**
   (`ner/chunking.py`) -- see the "chunking correction" note below; this
   was found to have a real bug during benchmarking and was fixed before
   this report, not left as a known gap.

### Chunking correction (found running `ner/bench.py`, fixed before this report)

An early version sized chunks by counting plain whitespace-run words
(`re.finditer(r"\S+")`) against a 300-word budget, assumed to have ~22%
headroom under GLiNER's `max_len=384`. In production this still triggered
GLiNER's own internal truncation (`"Sentence of length 424 has been
truncated to 384"`) on the `f10_checkout_blob` fixture. Root cause:
GLiNER's real word-splitter
(`gliner/data_processing/tokenizer.py::WhitespaceTokenSplitter`, regex
`r"\w+(?:[-_]\w+)*|\S"`) counts every punctuation character that isn't
part of a hyphenated word as its own token -- a number/punctuation-dense
checkout blob ("Rs. 4,596", "(Black, 2.4GHz)") measured a 424/300 = ~1.41x
expansion over plain whitespace-run counting. `ner/chunking.py` now copies
that exact regex (not importing `gliner` itself, to keep this module
importable without torch), sizes chunks from the text's own measured
expansion ratio, and **verifies every resulting chunk's real word count
before returning**, shrinking and re-slicing (bounded retries) if a
punctuation-dense chunk still comes in over budget. Re-running the
benchmark after the fix shows the truncation warning is gone; the two
pre-existing recall misses (see below) are unaffected by it, confirming
they were never a truncation artifact.

## Tests

`tests/unit/test_ner_{chunking,labels,cache,engine,app}.py` -- 52 tests,
all fixture-in/JSON-out or `FakeModel`-mocked (no torch, no gliner, no
110s cold load). Run from **either** venv (this package's torch/gliner
imports are deferred into functions specifically so it stays importable
without them -- see `ner/model_loader.py`'s docstring):

```powershell
server\.venv\Scripts\python.exe -m pytest tests/unit/test_ner_*.py -q
# or
spikes\gliner\.venv\Scripts\python.exe -m pytest tests/unit/test_ner_*.py -q
```

Both were run for this report; both are green (50 passed + 1 opt-in-skipped
before the chunking fix, 52 passed after -- see "measured numbers" below).
Confirmed the fix doesn't break the shared baseline: `server\.venv\...
pytest tests -q` (the whole repo's suite, all phases) collects and passes
with these files present.

Covers: label mapping to C1's `PiiLabel` enum, per-label confidence floors,
the structural-descriptor false-positive guard (ported from
`warden/entities.py`), offset remapping across chunks (including an
explicit "entity straddles a would-be non-overlapping cut boundary"
case), cache hit/miss/eviction, batching (one `model.inference()` call
covers every uncached text in a request), 503-before-load, host refusal,
no-body-in-logs, and the 422 sanitization.

`tests/unit/test_ner_integration_slow.py`: **opt-in only**, real model on
all 10 `spikes/gliner/fixtures.json` fixtures. No project-wide
`pytest.ini` exists to register a `slow` marker or default-exclude it, so
this is gated by an explicit environment variable (not the marker alone),
to guarantee the default `pytest tests -q` run never silently pays a 110s
cold load:

```powershell
$env:NER_RUN_SLOW="1"; spikes\gliner\.venv\Scripts\python.exe -m pytest tests/unit/test_ner_integration_slow.py -v
```

## Measured numbers (`benchmarks/results/v1b-ner.json`)

All measured on this machine (i5-1334U, 12 logical threads, Windows 11),
via `ner/bench.py`, which exercises `ner_engine.py` directly (in-process,
not through the HTTP layer -- loopback HTTP overhead is negligible and
this isolates the number the phase brief's 1.5s rule is actually about).
CPU load read via `Get-CimInstance Win32_Processor LoadPercentage`
immediately before the timed section and recorded in the JSON regardless
of outcome.

| Metric | Value | CPU load at measurement |
|---|---|---|
| Cold load | 20.2 s | 33-43% (polled, proceeded per the bounded-retry policy) |
| Warm, UNCACHED, 2 KB blob (f10), p50 / p95 | 4,207.9 / 4,736.5 ms | 2% (uncontended) |
| 10-step simulated run, step 0 (cold cache, all 10 texts) | 6,782.6 ms | 2% |
| 10-step simulated run, steps 1-9 (~90% repeat, cache ON), p50 / p95 | 292.0 / 343.4 ms | 2% |
| Recall on 10 fixtures | 11/13 expected entities matched | -- |

**The 1,500 ms pre-registered rule TRIGGERED** (4,736.5 ms uncontended p95
> 1,500 ms). Per the rule, `spikes/gliner/bench_alt_model.py` was written to
benchmark `vicgalle/gliner-small-pii` (~0.2B params, PII-fine-tuned, vs. the
production model's ~278M-param mdeberta-v3-base backbone) on the exact same
fixture and chunking/mapping code. **This benchmark did NOT complete** --
see `benchmarks/results/v1b-ner.json`'s `alt_model_benchmark` key for the
full attempt log. Summary: the repo is a raw training-checkpoint dump
(`optimizer.pt` alone is 1.27 GB, never needed for inference, plus a
redundant duplicate of the weights in both `.bin` and `.safetensors`
formats); a trimmed prefetch (skipping those) completed cleanly in 2m36s on
retry, confirming earlier stalls were transient network issues, not a
file-specific problem -- but `GLiNER.from_pretrained(local_files_only=True)`
then refused to load from that trimmed cache, because it validates against
the repo's full original file manifest rather than only the files
inference actually reads. Four attempts total; stopped rather than
continuing to loop, per instruction. **This does not affect the production
service** -- `ner/app.py` never imports or depends on this script, and the
shipping model (`urchade/gliner_multi_pii-v1`) was never touched. The
JSON's `alt_model_benchmark.note` records two ways to finish this: allow
one more full untrimmed download with a longer time budget, or load GLiNER
directly from the local snapshot directory path instead of the repo id
(bypassing the manifest-completeness check entirely).

**Caching is the load-bearing mitigation, not raw model speed:** the
~90%-repeat simulated run (the realistic shape of an agent loop, where
page text barely changes between steps) lands at 292-343 ms p50/p95 --
comfortably under any reasonable per-step budget -- even though a single
uncached 2 KB call costs ~4.2-4.7 s on this model. The two numbers answer
different questions: uncached p95 is "how bad is the first look at a new
page," cached p95 is "how bad is every step after that."

### Recall gaps (both pre-existing in the V0a baseline, not introduced here)

1. `f06_multi_entity`: "Contact Rahul Verma at ..." -- `Rahul Verma` is not
   detected as PERSONNAME even down to the 0.12 floor. **Already present**
   in `spikes/gliner/bench_python_result.json`'s original V0a measurement
   of this exact fixture at threshold 0.3 -- this is the model's own
   behavior on this phrasing, not a regression from this phase's chunking
   or threshold changes.
2. `f10_checkout_blob`: the ADDRESS span (`"Flat 302, Sunshine Residency,
   ..."`) is not detected. Confirmed NOT a truncation artifact: the model's
   output on this exact call includes a span at char offset 1767 (near the
   end of the ~2,000-char blob), well past the truncation boundary an
   under-sized chunk would have cut at, and the chunking-correction fix
   removed the truncation warning entirely without changing this result --
   it is a genuine scoring miss for this address in this surrounding
   context, below the 0.35 floor.

Neither gap is new: both were reproducible before AND after the chunking
fix, and the first is visible in the original V0a spike's own raw output.
Flagged, not silently worked around -- per this project's "false negatives
on PII are the dangerous direction, never paper over them" stance
(CLAUDE.md Section 5 / `docs/v2/ARCHITECTURE.md`'s V2 invariants).

## Why two venvs (and why that's fine)

`server/.venv` has `fastapi`/`uvicorn`/`httpx`/`pytest` but not
`torch`/`gliner` (confirmed by `pip list` before this phase started).
Rather than installing a second ~1.5 GB torch/gliner stack into
`server/.venv`, or re-downloading the 1.1 GB cached weights into a new
venv, this phase installed the (much lighter) `fastapi`/`uvicorn`/`httpx`/
`pytest`/`pytest-timeout` into `spikes/gliner/.venv`, which already had
torch+gliner+the cache from the V0a spike. Every `ner/*.py` module defers
its torch/gliner import into a function body (never at module top), so the
package -- and all 52 non-slow tests -- import and run correctly from
**either** venv; only actually loading the real model requires the spike
venv.
