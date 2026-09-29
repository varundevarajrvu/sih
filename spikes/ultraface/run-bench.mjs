// V0b ultraface-spike: Playwright driver. Assumes server.mjs is already
// serving spikes/ultraface at http://127.0.0.1:8990 (started separately, in
// the background). Every browser call is wrapped with an explicit timeout
// so a hung page.evaluate cannot stall the run silently, and results are
// written to disk in a finally block so a crash partway through still
// leaves a debuggable JSON + console log behind instead of nothing.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PORT = 8990;
const BASE = `http://127.0.0.1:${PORT}`;
const SCALES = [40, 60, 80, 96, 120, 200];
const FP_FILES = ["no-face-testpage.png", "no-face-wikipedia.png", "no-face-loginform.png"];

function percentile(arr, p) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function countPersons(detections) {
  return (detections || []).filter((d) => d.label === "person").length;
}

function countFaces(detections) {
  return (detections || []).length;
}

const results = {
  spike: "v0b-ultraface",
  date: new Date().toISOString(),
  machine: {},
  chrome: {},
  gpu: {},
  yolos: {},
  ultraface: {},
  notes: [],
  consoleLog: [],
  crashed: false,
};

let browser = null;
const consoleLines = [];

function writeResults() {
  results.consoleLog = consoleLines.slice(-200);
  const outDir = path.join(REPO_ROOT, "benchmarks", "results");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "v0b-ultraface.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log("WROTE", outPath);
}

async function main() {
  results.machine = {
    platform: os.platform(),
    osRelease: os.release(),
    cpuModel: os.cpus()[0]?.model || null,
    cpuCount: os.cpus().length,
    totalMemGB: +(os.totalmem() / 1e9).toFixed(1),
  };

  browser = await withTimeout(
    chromium.launch({
      headless: true,
      args: ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=swiftshader"],
    }),
    30000,
    "chromium.launch",
  );
  results.chrome.playwrightReportedVersion = browser.version();
  try {
    results.chrome.chromeExeVersion = execSync(
      'reg query "HKCU\\Software\\Google\\Chrome\\BLBeacon" /v version',
      { timeout: 5000 },
    ).toString();
  } catch {
    results.chrome.chromeExeVersion = "n/a (playwright-bundled chromium, not system Chrome)";
  }

  // ---------------- false-positive fixtures (need a real page) ----------------
  const fpPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  try {
    // DIAGNOSED (diag.mjs, one-off): doc height 1345px, viewport 720px, so
    // maxScroll is only 625px -- scrolling DOWN to (or past) that maximum
    // actually brings #idCard's face image (top=721,bottom=819 at natural
    // scroll 0) UP INTO the viewport (top=~96 at maxScroll), the opposite
    // of "out of view". An earlier version of this fixture scrolled down
    // and both models correctly detected the now-visible face -- that was
    // a broken fixture producing a true positive mislabeled as a false
    // positive, not a real finding. The face image is fully below the
    // fold (top=721 > viewport 720) at the page's own NATURAL, unscrolled
    // position, so no scrolling is needed or performed here.
    const demoPath = path.join(REPO_ROOT, "demo", "test-page.html").replace(/\\/g, "/");
    await withTimeout(fpPage.goto("file:///" + demoPath), 15000, "goto demo/test-page.html");
    const imgRect = await fpPage.evaluate(() => {
      const img = document.querySelector("#idCard img");
      if (!img) return null;
      const r = img.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, scrollY: window.scrollY };
    });
    await fpPage.screenshot({ path: path.join(__dirname, "fixtures", "no-face-testpage.png") });
    const outOfView = imgRect && (imgRect.bottom <= 0 || imgRect.top >= 720);
    results.notes.push(`no-face fixture 1 (demo/test-page.html, natural scroll=0): id-card face img rect=${JSON.stringify(imgRect)}, fully out of viewport=${outOfView}`);
  } catch (err) {
    results.notes.push(`no-face fixture 1 FAILED: ${err.message}`);
  }

  try {
    await withTimeout(
      fpPage.goto("https://en.wikipedia.org/wiki/Bengaluru", { waitUntil: "domcontentloaded" }),
      20000,
      "goto wikipedia",
    );
    await fpPage.screenshot({ path: path.join(__dirname, "fixtures", "no-face-wikipedia.png") });
    results.notes.push("no-face fixture 2 (wikipedia/Bengaluru top): live fetch succeeded");
  } catch (err) {
    results.notes.push(`no-face fixture 2 (wikipedia) FAILED -- ${err.message}`);
  }

  try {
    await withTimeout(fpPage.goto(`${BASE}/fixtures/login-form.html`), 10000, "goto login-form.html");
    await fpPage.screenshot({ path: path.join(__dirname, "fixtures", "no-face-loginform.png") });
    results.notes.push("no-face fixture 3 (hand-written login form): OK");
  } catch (err) {
    results.notes.push(`no-face fixture 3 FAILED: ${err.message}`);
  }
  await fpPage.close();
  writeResults(); // checkpoint -- fixtures alone are worth persisting

  // ---------------- harness page ----------------
  const page = await browser.newPage();
  // This headless Chromium session has NO WebGPU adapter (confirmed by an
  // earlier run: navigator.gpu.requestAdapter() rejects). Left unstubbed,
  // @huggingface/transformers' bundled jsep-enabled onnxruntime-web build
  // hard-fails pipeline() load for BOTH device:"webgpu" AND device:"wasm"
  // with the same "Failed to get GPU adapter" error -- see
  // run1-no-gpu-stub-yolos-hardfail.json, preserved as evidence. Stubbing
  // navigator.gpu to undefined makes transformers.js's own device-detection
  // skip the webgpu path entirely and go straight to a real WASM run, which
  // is what this "WASM floor" comparison needs. Applied to BOTH models for
  // consistency, which also makes UltraFace's "webgpu-requested" arm an
  // honest wasm-fallback measurement instead of an ambiguous one.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true });
  });
  page.on("console", (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (err) => consoleLines.push(`[pageerror] ${err.message}`));

  await withTimeout(page.goto(`${BASE}/harness.html`), 15000, "goto harness.html");
  await withTimeout(page.waitForFunction(() => !!window.__bench), 10000, "wait for window.__bench");

  results.gpu = await withTimeout(page.evaluate(() => window.__bench.gpuInfo()), 10000, "gpuInfo");
  results.notes.push(`navigator.gpu adapter in this headless session: ${JSON.stringify(results.gpu)}`);
  console.log("gpuInfo:", JSON.stringify(results.gpu));
  writeResults();

  const detectYolos = (url) => withTimeout(page.evaluate((u) => window.__bench.detectYolos(u), url), 30000, `detectYolos(${url})`);
  const detectUF = (url) => withTimeout(page.evaluate((u) => window.__bench.detectUltraFace(u), url), 30000, `detectUltraFace(${url})`);

  async function runModelSuite(detectFn) {
    const suite = {};
    suite.demoFace = await detectFn(`${BASE}/fixtures/demo-face.jpg`);
    suite.scaleLadder = {};
    for (const h of SCALES) {
      suite.scaleLadder[h] = await detectFn(`${BASE}/fixtures/face-${h}px.png`);
    }
    suite.falsePositives = {};
    for (const name of FP_FILES) {
      const fp = path.join(__dirname, "fixtures", name);
      if (!fs.existsSync(fp)) {
        suite.falsePositives[name] = { skipped: true, reason: "fixture not generated" };
        continue;
      }
      suite.falsePositives[name] = await detectFn(`${BASE}/fixtures/${name}`);
    }
    await detectFn(`${BASE}/fixtures/latency-input.png`); // warm-up, discarded
    const times = [];
    for (let i = 0; i < 20; i++) {
      const r = await detectFn(`${BASE}/fixtures/latency-input.png`);
      times.push(r.ms);
    }
    suite.latency = { samples: times, p50: percentile(times, 50), p95: percentile(times, 95) };
    return suite;
  }

  // ---- YOLOS: production config first (webgpu, fallback wasm on error) ----
  results.yolos.productionLoad = await withTimeout(page.evaluate(() => window.__bench.loadYolos("webgpu")), 60000, "loadYolos(webgpu)");
  if (!results.yolos.productionLoad.ok) {
    console.log("yolos webgpu load FAILED:", results.yolos.productionLoad.error);
    results.notes.push(`yolos webgpu load failed (${results.yolos.productionLoad.error}) -- falling back to wasm, matching offscreen.entry.js's own fallback behaviour`);
    results.yolos.productionLoad = await withTimeout(page.evaluate(() => window.__bench.loadYolos("wasm")), 60000, "loadYolos(wasm fallback)");
  }
  if (!results.yolos.productionLoad.ok) {
    console.log("yolos wasm load ALSO FAILED:", results.yolos.productionLoad.error);
    results.notes.push(`yolos wasm load ALSO failed (${results.yolos.productionLoad.error}) -- yolos cannot be benchmarked`);
  } else {
    console.log(`yolos loaded on ${results.yolos.productionLoad.device} in ${results.yolos.productionLoad.loadMs.toFixed(1)}ms`);
    results.yolos.production = await runModelSuite(detectYolos);
    results.yolos.production.device = results.yolos.productionLoad.device;
    results.yolos.production.coldLoadMs = results.yolos.productionLoad.loadMs;
    writeResults();

    const yolosWasmLoad = await withTimeout(page.evaluate(() => window.__bench.loadYolos("wasm")), 60000, "loadYolos(wasm, forced)");
    if (yolosWasmLoad.ok) {
      console.log(`yolos forced-wasm loaded in ${yolosWasmLoad.loadMs.toFixed(1)}ms`);
      results.yolos.wasmForced = { ...(await runModelSuite(detectYolos)), device: yolosWasmLoad.device, coldLoadMs: yolosWasmLoad.loadMs };
    } else {
      console.log("yolos forced-wasm load FAILED:", yolosWasmLoad.error);
      results.yolos.wasmForced = { error: yolosWasmLoad.error };
    }
    writeResults();
  }

  // ---------------- ULTRAFACE: wasm (Project B's shipped config) ----------------
  const ufWasmLoad = await withTimeout(page.evaluate(() => window.__bench.loadUltraFace("wasm")), 30000, "loadUltraFace(wasm)");
  if (ufWasmLoad.ok) {
    console.log(`ultraface wasm loaded in ${ufWasmLoad.loadMs.toFixed(1)}ms`);
    results.ultraface.wasm = { ...(await runModelSuite(detectUF)), backend: "wasm", coldLoadMs: ufWasmLoad.loadMs };
  } else {
    console.log("ultraface wasm load FAILED:", ufWasmLoad.error);
    results.ultraface.wasm = { error: ufWasmLoad.error };
    results.notes.push(`ultraface wasm load FAILED: ${ufWasmLoad.error}`);
  }
  writeResults();

  // ---------------- ULTRAFACE: webgpu attempt ----------------
  try {
    const ufGpuLoad = await withTimeout(page.evaluate(() => window.__bench.loadUltraFace("webgpu")), 30000, "loadUltraFace(webgpu)");
    if (ufGpuLoad.ok) {
      console.log(`ultraface webgpu-requested loaded in ${ufGpuLoad.loadMs.toFixed(1)}ms`);
      results.ultraface.webgpu = { ...(await runModelSuite(detectUF)), backend: "webgpu-requested", coldLoadMs: ufGpuLoad.loadMs };
    } else {
      console.log("ultraface webgpu load FAILED:", ufGpuLoad.error);
      results.ultraface.webgpu = { error: ufGpuLoad.error };
      results.notes.push(`ultraface webgpu session creation FAILED: ${ufGpuLoad.error}`);
    }
  } catch (err) {
    console.log("ultraface webgpu attempt threw:", err.message);
    results.ultraface.webgpu = { error: err.message };
    results.notes.push(`ultraface webgpu attempt threw: ${err.message}`);
  }

  console.log("\n=== SUMMARY ===");
  console.log("gpu:", JSON.stringify(results.gpu));
  console.log("yolos demoFace persons:", countPersons(results.yolos.production?.demoFace?.detections));
  console.log("ultraface(wasm) demoFace faces:", countFaces(results.ultraface.wasm?.demoFace?.detections));
  console.log("yolos production p50/p95:", results.yolos.production?.latency?.p50, results.yolos.production?.latency?.p95, results.yolos.production?.device);
  console.log("ultraface wasm p50/p95:", results.ultraface.wasm?.latency?.p50, results.ultraface.wasm?.latency?.p95);
}

main()
  .catch((err) => {
    results.crashed = true;
    results.notes.push(`BENCH CRASHED: ${err.stack || err.message}`);
    console.error("BENCH FAILED:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    writeResults();
    if (browser) {
      try {
        await withTimeout(browser.close(), 10000, "browser.close");
      } catch (err) {
        console.error("browser.close failed:", err.message);
      }
    }
  });
