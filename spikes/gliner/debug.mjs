import { chromium } from "playwright";

const SERVER_URL = process.env.GLINER_SERVER_URL || "http://127.0.0.1:8934/";
const PROVIDER = process.env.GLINER_PROVIDER || "wasm";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("console", (msg) => console.error(`[console:${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (err) => console.error(`[pageerror] ${err.stack || err.message}`));

  await page.goto(SERVER_URL, { waitUntil: "load", timeout: 60000 });
  const initResult = await page.evaluate(async (provider) => window.initGliner(provider), PROVIDER, { timeout: 180000 });
  console.error("init:", JSON.stringify(initResult).slice(0, 300));

  const text = "Contact Rahul Verma at rahul.v@example.com or +91 98450 12345";
  const spans = await page.evaluate(async (t) => window.debugScores(t, 0.0), text, { timeout: 60000 });
  console.error("all spans (threshold 0.0) for f06:");
  // sort by score desc, print top 20
  spans.sort((a, b) => b.score - a.score);
  for (const s of spans.slice(0, 20)) {
    console.error(`  score=${s.score.toFixed(4)} label=${s.label} text=${JSON.stringify(s.spanText)}`);
  }
  console.error(`total spans returned: ${spans.length}`);

  await browser.close();
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
