import { chromium } from "playwright";

const SERVER_URL = process.env.GLINER_SERVER_URL || "http://127.0.0.1:8934/";
const PROVIDER = process.env.GLINER_PROVIDER || "wasm";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("console", (msg) => console.error(`[console:${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (err) => console.error(`[pageerror] ${err.stack || err.message}`));

  console.error("chromium version:", browser.version());
  await page.goto(SERVER_URL, { waitUntil: "load", timeout: 60000 });

  console.error(`initGliner(${PROVIDER}) starting...`);
  const t0 = Date.now();
  const initResult = await page.evaluate(async (provider) => {
    return await window.initGliner(provider);
  }, PROVIDER, { timeout: 180000 });
  console.error(`init took ${Date.now() - t0}ms:`, JSON.stringify(initResult).slice(0, 1000));

  if (initResult.ok) {
    const t1 = Date.now();
    const smoke = await page.evaluate(async () => {
      return await window.smokeTest("Log in as Francis Reuben R");
    }, { timeout: 60000 });
    console.error(`smoke inference took ${Date.now() - t1}ms (self-reported ${smoke.ms}ms):`, JSON.stringify(smoke.spans));
  }

  await browser.close();
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
