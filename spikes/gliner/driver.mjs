// Playwright driver for the Path A (in-browser) GLiNER benchmark.
// Loads index.html in real Chromium, drives window.initGliner /
// window.runGlinerBench (defined in entry.js, bundled to bundle.js), and
// writes bench_browser_result.json. Also records which ORT execution
// provider actually ran (browsers silently fall back).
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_URL = process.env.GLINER_SERVER_URL || "http://127.0.0.1:8934/";
const REQUESTED_PROVIDER = process.env.GLINER_PROVIDER || "wasm";

async function main() {
  const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures.json"), "utf8")).fixtures
    .map((f) => ({ id: f.id, text: f.text }));

  const browser = await chromium.launch({
    args: [
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan",
      "--ignore-gpu-blocklist",
    ],
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleLines = [];
  page.on("console", (msg) => consoleLines.push(`[console:${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (err) => consoleLines.push(`[pageerror] ${err.stack || err.message}`));

  const versionInfo = browser.version();
  console.error(`[driver] Chromium version: ${versionInfo}`);

  console.error(`[driver] navigating to ${SERVER_URL}`);
  await page.goto(SERVER_URL, { waitUntil: "load", timeout: 60000 });

  console.error(`[driver] initializing GLiNER with executionProvider=${REQUESTED_PROVIDER}`);
  let initResult;
  try {
    initResult = await page.evaluate(async (provider) => {
      return await window.initGliner(provider);
    }, REQUESTED_PROVIDER, { timeout: 120000 });
  } catch (err) {
    initResult = { ok: false, error: { message: String(err) } };
  }

  console.error(`[driver] init result: ${JSON.stringify(initResult).slice(0, 500)}`);

  let benchResult = null;
  let benchError = null;
  if (initResult && initResult.ok) {
    try {
      benchResult = await page.evaluate(async (fx) => {
        return await window.runGlinerBench(fx);
      }, fixtures, { timeout: 300000 });
    } catch (err) {
      benchError = { message: String(err), stack: err.stack };
    }
  }

  const output = {
    path: "A_browser_onnxruntime_web",
    requestededExecutionProvider: REQUESTED_PROVIDER,
    chromiumVersion: versionInfo,
    initResult,
    benchResult,
    benchError,
    consoleLines: consoleLines.slice(-200), // keep tail only, avoid megabytes of ORT logging
  };

  fs.writeFileSync(
    path.join(__dirname, `bench_browser_result_${REQUESTED_PROVIDER}.json`),
    JSON.stringify(output, null, 2)
  );
  console.error(`[driver] wrote bench_browser_result_${REQUESTED_PROVIDER}.json`);

  await browser.close();

  if (!initResult || !initResult.ok) {
    console.error("[driver] INIT FAILED — see bench_browser_result_*.json for details");
    process.exitCode = 1;
  } else if (benchError) {
    console.error("[driver] BENCH FAILED — see bench_browser_result_*.json for details");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[driver] fatal:", err);
  process.exitCode = 1;
});
