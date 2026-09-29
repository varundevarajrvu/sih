// Bundled by esbuild into bundle.js. Runs inside a real Chromium page (via
// Playwright), driving GLiNER.js (npm package "gliner") against
// onnxruntime-web. Exposes window.runGlinerBench() for the Playwright driver
// to call.
import { Gliner } from "gliner";

const LABELS = [
  "person name",
  "address",
  "date of birth",
  "account number",
  "password",
  "email",
  "phone number",
];
const THRESHOLD = 0.3;
const WARM_RUNS = 20;

function percentile(values, pct) {
  const s = [...values].sort((a, b) => a - b);
  const k = Math.max(0, Math.min(s.length - 1, Math.round((pct / 100) * (s.length - 1))));
  return s[k];
}

window.__glinerState = { model: null, backendUsed: null, coldLoadMs: null, initError: null };

window.initGliner = async function initGliner(executionProvider) {
  const t0 = performance.now();
  try {
    const gliner = new Gliner({
      tokenizerPath: "onnx-community/gliner_multi_pii-v1",
      onnxSettings: {
        modelPath: "/models/model_int8.onnx",
        executionProvider, // "wasm" or "webgpu"
        wasmPaths: window.location.origin + "/node_modules/onnxruntime-web/dist/",
        multiThread: false,
      },
      transformersSettings: {
        allowLocalModels: false,
        useBrowserCache: true,
      },
      maxWidth: 12,
      modelType: "span-level",
    });
    await gliner.initialize();
    const t1 = performance.now();
    window.__glinerState.model = gliner;
    window.__glinerState.coldLoadMs = t1 - t0;
    window.__glinerState.backendUsed = executionProvider;
    return { ok: true, coldLoadMs: t1 - t0 };
  } catch (err) {
    window.__glinerState.initError = { message: String(err && err.message || err), stack: String(err && err.stack || "") };
    return { ok: false, error: window.__glinerState.initError };
  }
};

window.smokeTest = async function smokeTest(text) {
  const gliner = window.__glinerState.model;
  if (!gliner) throw new Error("gliner not initialized");
  const t0 = performance.now();
  const out = await gliner.inference({ texts: [text], entities: LABELS, threshold: THRESHOLD });
  const t1 = performance.now();
  return { ms: t1 - t0, spans: out[0] };
};

window.debugScores = async function debugScores(text, thresholdOverride) {
  const gliner = window.__glinerState.model;
  if (!gliner) throw new Error("gliner not initialized");
  const out = await gliner.inference({ texts: [text], entities: LABELS, threshold: thresholdOverride });
  return out[0];
};

window.runGlinerBench = async function runGlinerBench(fixtures) {
  const gliner = window.__glinerState.model;
  if (!gliner) throw new Error("gliner not initialized");

  // One throwaway warm-up call on the longest fixture, mirroring bench_python.py.
  const longest = fixtures.reduce((a, b) => (b.text.length > a.text.length ? b : a));
  await gliner.inference({ texts: [longest.text], entities: LABELS, threshold: THRESHOLD });

  const results = [];
  for (const fx of fixtures) {
    const durations = [];
    let lastSpans = null;
    for (let i = 0; i < WARM_RUNS; i++) {
      const t0 = performance.now();
      const out = await gliner.inference({ texts: [fx.text], entities: LABELS, threshold: THRESHOLD });
      const t1 = performance.now();
      durations.push(t1 - t0);
      lastSpans = out[0]; // inference() returns array-of-arrays for multi-text input
    }
    const p50 = percentile(durations, 50);
    const p95 = percentile(durations, 95);
    const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
    results.push({
      id: fx.id,
      text_len_chars: fx.text.length,
      warm_runs: WARM_RUNS,
      p50_ms: Math.round(p50 * 100) / 100,
      p95_ms: Math.round(p95 * 100) / 100,
      mean_ms: Math.round(mean * 100) / 100,
      min_ms: Math.round(Math.min(...durations) * 100) / 100,
      max_ms: Math.round(Math.max(...durations) * 100) / 100,
      spans: (lastSpans || []).map((s) => ({
        start: s.start,
        end: s.end,
        label: s.label,
        text: s.spanText,
        score: Math.round(s.score * 10000) / 10000,
      })),
    });
  }
  return {
    backendUsed: window.__glinerState.backendUsed,
    coldLoadMs: window.__glinerState.coldLoadMs,
    results,
  };
};
