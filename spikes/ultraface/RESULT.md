# V0b spike result: UltraFace RFB-320 vs Xenova/yolos-tiny for face redaction

**Question:** should UltraFace RFB-320 (ONNX, `onnxruntime-web`) replace `Xenova/yolos-tiny` (COCO `person`
class, via `@huggingface/transformers`) for face redaction?

**Decision: REPLACE `yolos-tiny` with UltraFace RFB-320.** All three legs of the pre-registered rule
(ARCHITECTURE.md Phase V0b) are satisfied — see "Decision rule applied" below.

Raw numbers: [`benchmarks/results/v0b-ultraface.json`](../../benchmarks/results/v0b-ultraface.json).
Machine: 13th Gen Intel Core i5-1334U (12 logical cores), 16.8 GB RAM, Intel(R) UHD Graphics (integrated,
driver 32.0.101.7085), Windows 11 (10.0.26200). Browser: Playwright-bundled Chromium 153.0.8010.12,
**headless, no WebGPU adapter** (`navigator.gpu.requestAdapter()` resolves to none) — every browser number
below is on the WASM floor, consistent with this project's "WebGPU is a speed optimization, never a
dependency" invariant. Date: 2026-09-24.

## ⚠️ Environment finding: yolos-tiny could not be run in a browser here at all

`Xenova/yolos-tiny` via `@huggingface/transformers ^3.0.0`'s `pipeline()` **hard-failed to load on both
`device:"webgpu"` and `device:"wasm"`**, with the same underlying error either way:

```
no available backend found. ERR: [webgpu] Error: Failed to get GPU adapter. You may need to enable
flag "--enable-unsafe-webgpu" if you are using Chrome.
```

Reproduced 3 times across 2 browser sessions, including one where `navigator.gpu` was stubbed to
`undefined` before any page script ran (to force the library's own device-detection to skip WebGPU
entirely) — which only changed the error text (`"WebGPU is not supported in current environment"`), not
the outcome. **Root cause assessed, not just observed:** `@huggingface/transformers ^3.0.0` bundles
*only* the jsep-enabled `onnxruntime-web` WASM build (`dist/ort-wasm-simd-threaded.jsep.mjs/.wasm` — no
plain non-jsep alternative ships in that package). That single binary appears to perform WebGPU
adapter/capability negotiation at pipeline-load time **regardless of the requested `device`**, and
hard-fails when no adapter exists — even for an explicit `device:"wasm"` request.

This is an **environment limitation** (this sandbox's headless Chromium has zero WebGPU adapter), not a
finding about yolos-tiny's architecture — this repo's own `CLAUDE.md` documents yolos-tiny loading and
running successfully on `webgpu` in a real, non-headless Chrome session. It is, however, a real
**operational** data point: raw `onnxruntime-web` (used directly for UltraFace, not wrapped by
transformers.js) tolerated the same missing adapter gracefully and fell back internally — so this is
specifically a `transformers.js`/jsep-bundle fragility, not a Chromium or ONNX Runtime one. Evidence:
`spikes/ultraface/run1-no-gpu-stub-yolos-hardfail.json`.

**Consequence for this report:** UltraFace's numbers below are fresh, real, browser-measured (WASM).
Yolos's **recall** numbers (does it detect a face at all) come from `@huggingface/transformers`' Node
backend (`onnxruntime-node`, CPU, fp32 — the same local weights and same `threshold=0.5`/
`percentage=false` as `extension/src/offscreen.entry.js`) run directly on the same fixture files —
detection correctness doesn't depend on which CPU/GPU backend ran the model, only latency does. Yolos's
**latency** comes instead from this project's own already-published, JSON-backed production measurements
(`CLAUDE.md`), per ARCHITECTURE.md's own suggested baseline ("current published yolos warm: ~2,350–2,700
ms") — not re-measured here because it could not be run in this environment's browser at all. Every
number is labeled with its actual source below; nothing is invented.

## 1. Demo face (`site/assets/id-card-face.jpg`, 500×333, tight face crop)

| Model | Detected? | Score/confidence | Box |
|---|---|---|---|
| **UltraFace** (browser, wasm) | ✅ yes | 0.999999881 | x:83.0, y:0.4, w:283.3, h:332.6 (tight face box) |
| **yolos-tiny** `person` (Node CPU) | ✅ yes | 0.98793 | x:0,y:0 – x:499,y:331 (whole-image box — COCO `person`, not a face box) |

Both detect the demo face. UltraFace also returned a `tie` at 0.55/0.52 (irrelevant, filtered by our
person-only comparison).

## 2. Face-scale ladder (demo face pasted at N px height, centered on a 1280×720 white canvas)

| Height | UltraFace (wasm) detected | confidence | yolos `person` (Node CPU) detected | score |
|---|---|---|---|---|
| 40px | ❌ no | — | ❌ no | — |
| 60px | ❌ no | — | ❌ no | — |
| **80px** | ✅ **yes** | 0.9226 | ❌ no | — |
| 96px | ✅ yes | 0.9852 | ✅ yes | 0.6198 |
| **120px** | ✅ **yes** | 0.9906 | ❌ **no** | — |
| 200px | ✅ yes | 0.9993 | ✅ yes | 0.9180 |

**UltraFace detects every face ≥80px, with zero gaps.** yolos-tiny is **non-monotonic** — it hits 96px and
200px but misses both 80px and 120px, which makes it an unreliable size signal, not merely a less
sensitive one. Fixture PNGs: `spikes/ultraface/fixtures/face-{40,60,80,96,120,200}px.png`.

## 3. False positives (3× 1280×720, no face)

| Fixture | UltraFace (wasm) detections | yolos `person` detections (Node CPU) |
|---|---|---|
| `demo/test-page.html`, natural scroll (id-card face image confirmed fully below the fold — see caveat) | 0 | 0 |
| `en.wikipedia.org/wiki/Bengaluru`, top of page (live fetch) | 0 | 0 |
| Hand-written login form (`fixtures/login-form.html`) | 0 | 0 |

**Zero false positives for both models**, on the final, corrected fixture set.

**Caveat worth recording — a broken fixture, caught and fixed.** The first attempt scrolled
`demo/test-page.html` *down* to push the ID card out of view, following the literal instruction. That
page is only 1345px tall against a 720px viewport (max scroll 625px), so scrolling to the bottom actually
brought the card's face image (which sits at y:708–832 at natural, unscrolled position — already almost
entirely below the fold) **up into** the viewport instead. Both models correctly "detected" the now-visible
face (UltraFace 0.981, yolos 0.985) — a true positive on a mislabeled fixture, not a real finding. Fixed by
using the page's natural, unscrolled position, where the face image (`getBoundingClientRect()`:
top=721, bottom=819) is confirmed **fully below** the 720px fold. Diagnosis and fix are in `run-bench.mjs`.
Separately, an early yolos run flagged two borderline `car` detections (score 0.55/0.64) on the Wikipedia
screenshot; they did not reproduce on a later run against the same PNG (CPU-threading float
non-associativity right at the margin) — not `person`, not PII-relevant either way.

## 4. Latency (WASM, 20 warm runs, 1280×720 input; resize-to-320×240 included in UltraFace's timing)

| | UltraFace RFB-320 (wasm) | UltraFace RFB-320 (webgpu-requested†) | yolos-tiny (published, production, webgpu) |
|---|---|---|---|
| Cold load | 1,064 ms | 1,696 ms | not re-measured here; v1 CLAUDE.md: cold-start-after-SW-eviction 18,430 / 19,407 ms |
| Warm p50 | **50.5 ms** | 52.6 ms | — |
| Warm p95 | **61.0 ms** | 58.1 ms | — |
| Warm reference (published) | — | — | best case: 784/817/860/881 ms (2026-09-11); most recently reproduced: 2,650/2,692/2,700 ms (2026-09-20) |

† `webgpu-requested` almost certainly executed on the `wasm` execution provider internally (no adapter in
this session; session *creation* succeeded, unlike yolos's hard failure above), and is slightly *slower*
to load and run than the explicit `wasm` session — consistent with wasted EP-negotiation overhead, not
real GPU execution. Not used in the decision.

**UltraFace's warm p95 (61.0 ms) is ~13× lower than yolos's best-ever published number (881 ms) and
~44× lower than yolos's most recently reproduced number (2,700 ms).** Since yolos-tiny could not be run
in this environment's browser at all, its own cold-load number also can't be re-measured here; v1's
already-published cold-start figures (18.4–19.4s after service-worker eviction) are cited for scale, not
as a like-for-like comparison.

## 5. Decision rule applied

> *ARCHITECTURE.md, pre-registered: replace yolos-tiny iff UltraFace detects the demo face and every
> ≥80px face, AND its warm p95 is lower. Keep yolos available only if it catches something UltraFace
> cannot that is PII-relevant.*

| Condition | Result |
|---|---|
| UltraFace detects the demo face | ✅ true (0.9999999) |
| UltraFace detects every face ≥80px | ✅ true (80/96/120/200px all hit) |
| UltraFace warm p95 < yolos warm | ✅ true (61.0 ms < 881 ms best-case, < 2,700 ms most-recent) |
| **→ Decision** | **REPLACE yolos-tiny with UltraFace RFB-320 for face redaction** |
| Does yolos catch anything PII-relevant UltraFace misses? | **No, not observed.** Every scale where yolos-`person` fired (96px, 200px), UltraFace also fired — and UltraFace additionally caught 80px and 120px, where yolos missed. |

**Design-level caveat, stated but not measured here:** all fixtures in this spike are forward-facing face
crops. yolos's COCO `person` class detects full-body/torso silhouettes and could in principle fire on a
person whose face is occluded, turned away, or too small to resolve as a face — something a face-only
detector structurally cannot do. No fixture here exercises that case; it's a real gap in this spike's
coverage, not a resolved question.

## Surprises

1. **The biggest one wasn't UltraFace vs yolos — it was that yolos couldn't run in this environment's
   browser at all**, on either backend, for a library/environment reason unrelated to which detector is
   architecturally better (see section above).
2. **UltraFace's `webgpu`-requested session was slower than its `wasm` session**, not faster — a small
   but clean illustration of the same "don't assume WebGPU is the fast path" lesson v1's Phase 0 already
   learned with yolos-tiny, this time from the *negotiation overhead* side rather than graph-splitting.
3. **yolos's face-scale recall is non-monotonic** (hits 96px, misses 120px) — worse than "less sensitive",
   it's unpredictable, which matters more than a simple threshold gap for a redaction guarantee.
4. **A fixture bug produced a "true positive" that looked like a false positive for both models
   simultaneously** — worth flagging because it would have been easy to record as a real finding
   ("both models over-trigger on this page") when the actual bug was the test harness pushing a hidden
   face into view. Caught by diagnosing the page's actual layout rather than trusting the first result.

## The exact pre/post-processing recipe that worked (for V2 to build from)

UltraFace RFB-320, reproduced from Project B's `Prototype/shared/vision.mjs` (copied verbatim into
`spikes/ultraface/lib/vision.mjs` — not reimplemented, to avoid silently diverging from the verified
recipe):

1. **Input:** resize source image to exactly **320×240** (width×height) via `canvas.drawImage`.
2. **Normalization:** RGBA → NCHW float32, **drop alpha**, per-channel `(value - 127) / 128`:
   ```js
   out[i] = (r - 127) / 128; out[n+i] = (g - 127) / 128; out[2*n+i] = (b - 127) / 128;
   ```
3. **Tensor shape:** `[1, 3, 240, 320]` (NCHW — batch, channels, height, width).
4. **Session:** `onnxruntime-web`, `executionProviders: ["wasm"]`, single-thread
   (`env.wasm.numThreads = 1`), `proxy: false`, `graphOptimizationLevel: "all"`.
5. **Output tensors:** identify by shape, not name — `scores` is the tensor whose last dim is `2`,
   `boxes` is the tensor whose last dim is `4`.
6. **Decode:** for each candidate, keep if `scores[i*2+1] >= threshold` (default `0.7` in Project B's
   code; this spike also validated at the model's natural output, no threshold override needed to hit the
   confidences above). Box coords are **normalized 0–1**, scale by `width`/`height` to get pixels:
   `x = boxes[i*4]*width`, `y = boxes[i*4+1]*height`, `right = boxes[i*4+2]*width`,
   `bottom = boxes[i*4+3]*height`.
7. **NMS:** sort by confidence descending, greedy-keep while `IoU < 0.3` against all already-kept boxes,
   cap 100.
8. **Model file:** `models/ultraface-rfb320.onnx` (1,257,907 bytes, MIT license — `ULTRAFACE-LICENSE.txt`
   alongside it). ~1.2 MB total.

This full recipe (`rgbaToNchw` + `decodeFaces`) is reused unmodified in `harness.src.js`; only session
creation is parameterized there (to test `wasm` vs `webgpu` as execution providers), since
`vision.mjs` itself hardcodes `wasm`.

## Files

- `spikes/ultraface/RESULT.md` — this file.
- `spikes/ultraface/lib/vision.mjs` — Project B's pre/post-processing, copied verbatim.
- `spikes/ultraface/harness.src.js` — browser test harness (esbuild-bundled to `public/harness.bundle.js`,
  gitignored — rebuild with `npm run build`).
- `spikes/ultraface/server.mjs` — static file server for the harness (no framework dep).
- `spikes/ultraface/run-bench.mjs` — Playwright driver; writes `benchmarks/results/v0b-ultraface.json`.
- `spikes/ultraface/node-yolos-recall.mjs` — yolos recall fallback (onnxruntime-node CPU), writes
  `node-yolos-recall-result.json`.
- `spikes/ultraface/finalize-result.mjs` — one-off merge script that produced the final JSON.
- `spikes/ultraface/make-fixtures.mjs` — generates the face-scale-ladder PNGs (`sharp`).
- `spikes/ultraface/fixtures/` — all generated/captured fixture images.
- `spikes/ultraface/run1-no-gpu-stub-yolos-hardfail.json` — preserved evidence of the yolos browser-load
  failure before the `navigator.gpu` stub (kept as a distinct artifact from the final result).
- `spikes/ultraface/models/` — UltraFace ONNX + license, yolos-tiny weights (copied from
  `extension/models/Xenova/yolos-tiny/`), and 3 separate `onnxruntime-web`/`transformers.js` runtime
  bundles (plain wasm, webgpu-capable, and the jsep build transformers.js itself bundles).
- `benchmarks/results/v0b-ultraface.json` — raw numbers, machine info, decision.
