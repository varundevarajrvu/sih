// Automated accessibility audit for extension/popup.html.
// Usage: node run-audit.js [--out <path>] [--lang en|hi]
//
// Serves extension/ over a throwaway local HTTP server (127.0.0.1, random
// port) and opens popup.html from it in headless Chromium (Playwright),
// then stubs window.chrome so popup.js's top-level browser.storage.* calls
// don't throw, and runs axe-core against three states:
//   1. default
//   2. #consentPanel visible
//   3. #goalPrivacyPanel visible
//
// WHY HTTP AND NOT file://, per the i18n pass (2026-09-27): popup.js's
// language toggle loads a locale's messages.json via
// fetch(browser.runtime.getURL(...)) (see popup.js's own header comment on
// this). Chromium hard-blocks fetch() from a file:// origin to another
// file:// URL ("Failed to fetch") even with a real Playwright route()
// intercept in place -- confirmed empirically, it never reaches a
// routable network event at all. A tiny static file server sidesteps that
// entirely and is what a real extension origin (chrome-extension://) is
// closest to anyway. --lang selects which locale this run boots into by
// having the storage stub report a persisted "uiLang" choice, exactly the
// shape setLang()/initI18n() in popup.js already expect from a real
// previous toggle -- default "en" is a NEW test dimension added in this
// pass, not a change to the pre-existing three-states-times-checks shape.
//
// Also does a keyboard-only pass (tab order, focus visibility, Enter/Esc),
// a WCAG 1.4.12 text-spacing check, and a 360px/200%-zoom horizontal-scroll
// check. Writes a JSON summary to stdout; the caller redirects it.

const path = require("path");
const fs = require("fs");
const http = require("http");
const { chromium } = require("playwright");
const { AxeBuilder } = require("@axe-core/playwright");

const EXTENSION_DIR = path.resolve(__dirname, "..", "..", "extension");

const CLI_LANG_ARG_INDEX = process.argv.indexOf("--lang");
const LANG = CLI_LANG_ARG_INDEX !== -1 && process.argv[CLI_LANG_ARG_INDEX + 1] === "hi" ? "hi" : "en";

const STATIC_MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".png": "image/png",
};

function startStaticServer(rootDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      const filePath = path.join(rootDir, urlPath);
      // Defensive: never serve outside rootDir (this is a test-only,
      // localhost-only server, but no reason to skip the check).
      if (!filePath.startsWith(rootDir)) {
        res.writeHead(403);
        res.end();
        return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, { "Content-Type": STATIC_MIME_TYPES[path.extname(filePath)] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

// Minimal chrome.* stub -- enough that popup.js's top-level calls
// (browser.storage.local.get/set, runtime.sendMessage, etc.) resolve
// instead of throwing. webextension-polyfill wraps whatever it finds at
// window.chrome, so this only needs to cover the callback-style shape it
// expects to promisify.
//
// storage.local.get("uiLang") answers with the CLI's --lang choice, as if
// a previous run of the real popup had already toggled it -- this is what
// drives initI18n() down its "explicit stored preference -> manual fetch"
// path (see popup.js) for BOTH "en" and "hi", rather than "en" silently
// falling back to an unstubbed chrome.i18n.getMessage() (which would
// render every string as its bare key name, not real English text).
function buildChromeStub(lang) {
  return `
(function () {
  function ok(cb, value) { if (typeof cb === "function") setTimeout(() => cb(value), 0); }
  const UI_LANG = ${JSON.stringify(lang)};
  const storageArea = (isLocal) => ({
    get: (keys, cb) => {
      if (!isLocal) return ok(cb, {});
      const wantsUiLang = keys === "uiLang" || keys === undefined || (Array.isArray(keys) && keys.includes("uiLang")) || (keys && typeof keys === "object" && "uiLang" in keys);
      ok(cb, wantsUiLang ? { uiLang: UI_LANG } : {});
    },
    set: (items, cb) => ok(cb),
    remove: (keys, cb) => ok(cb),
  });
  window.chrome = {
    runtime: {
      id: "test-extension-id",
      lastError: undefined,
      getURL: (p) => new URL(p, location.href).toString(),
      sendMessage: (msg, cb) => ok(cb, {}),
      onMessage: {
        // Real listener storage (not a no-op) so the test can dispatch a
        // synthetic CONSENT_REQUEST / GOAL_PRIVACY_REVIEW_REQUEST the same
        // way background.js would, and exercise popup.js's actual
        // showConsentPanel()/showGoalPrivacyPanel() gating instead of
        // poking the DOM directly (which skips the activeRequestId guard
        // and makes Escape/Enter look broken when they are not).
        addListener: (fn) => { (window.__msgListeners = window.__msgListeners || []).push(fn); },
        removeListener: (fn) => {
          const l = window.__msgListeners || [];
          const i = l.indexOf(fn);
          if (i >= 0) l.splice(i, 1);
        },
      },
      onStartup: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
    },
    storage: {
      local: storageArea(true),
      session: storageArea(false),
      onChanged: { addListener: () => {} },
    },
    tabs: {
      query: (q, cb) => ok(cb, [{ id: 1, url: "https://example.com/" }]),
      sendMessage: (id, msg, cb) => ok(cb, {}),
    },
  };
})();
`;
}

async function runAxe(page, label) {
  const results = await new AxeBuilder({ page }).analyze();
  return {
    state: label,
    violations: results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodeCount: v.nodes.length,
      targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
    })),
  };
}

async function main() {
  const server = await startStaticServer(EXTENSION_DIR);
  const port = server.address().port;
  const popupUrl = `http://127.0.0.1:${port}/popup.html`;

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(buildChromeStub(LANG));
  await page.goto(popupUrl, { waitUntil: "load" });
  // Let popup.js's async storage/messages.json reads settle (initI18n()'s
  // top-level await plus the manual-fetch path this pass added).
  await page.waitForTimeout(250);

  const summary = { poppedUrl: popupUrl, lang: LANG, states: [], keyboard: {}, textSpacing: {}, zoom: {} };
  // Sanity check that the requested language actually took effect --
  // otherwise an "hi" run that silently stayed English would still pass
  // every check below and no one would know. brandSub is always
  // non-empty static text (see popup.html) so it's a safe probe.
  summary.renderedBrandSub = await page.evaluate(() => {
    const el = document.querySelector(".brand-sub");
    return el ? el.textContent : null;
  });
  summary.htmlLangAttr = await page.evaluate(() => document.documentElement.getAttribute("lang"));

  // ---- State 1: default ----
  summary.states.push(await runAxe(page, "default"));

  // ---- State 2: consent panel visible ----
  await page.evaluate(() => {
    const el = document.getElementById("consentPanel");
    el.hidden = false;
    document.getElementById("consentAction").textContent = "Click the Submit button";
    document.getElementById("consentReason").textContent = "This action looks irreversible.";
    document.getElementById("consentReasonDetail").textContent = "Reason: matches destructive-intent keyword.";
    document.getElementById("consentCountdown").textContent = "Auto-deny in 45s";
  });
  summary.states.push(await runAxe(page, "consentPanel visible"));
  await page.evaluate(() => { document.getElementById("consentPanel").hidden = true; });

  // ---- State 3: goal-privacy panel visible ----
  await page.evaluate(() => {
    const el = document.getElementById("goalPrivacyPanel");
    el.hidden = false;
    document.getElementById("goalPrivacyAction").textContent = "Your goal mentions a phone number.";
    document.getElementById("goalPrivacyReason").textContent = "Keep it private, or allow it to be sent.";
    document.getElementById("goalPrivacyCountdown").textContent = "Auto-keep-private in 45s";
  });
  summary.states.push(await runAxe(page, "goalPrivacyPanel visible"));
  await page.evaluate(() => { document.getElementById("goalPrivacyPanel").hidden = true; });

  // ---- Extra (not one of the 3 required states, kept for evidence):
  // open every <details> disclosure -- this is where the pipeline
  // toggle, planner selector, and server URL input actually render,
  // since axe skips content a native <details> is hiding when closed. ----
  await page.evaluate(() => {
    document.querySelectorAll("details.disclosure").forEach((d) => { d.open = true; });
  });
  summary.states.push(await runAxe(page, "settings/profile/diagnostics disclosures open"));

  // ---- Keyboard-only pass ----
  summary.keyboard = await page.evaluate(() => {
    document.querySelectorAll("details.disclosure").forEach((d) => { d.open = true; });
    const focusables = Array.from(
      document.querySelectorAll(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => el.offsetParent !== null || el === document.activeElement);
    return {
      focusableCount: focusables.length,
      focusableIds: focusables.map((el) => el.id || el.tagName.toLowerCase()),
    };
  });

  // Tab order reaches every control; each stop is visibly focused
  // (outline via :focus-visible, or at least document.activeElement
  // actually moves).
  await page.evaluate(() => { document.body.focus(); });
  const tabStops = [];
  for (let i = 0; i < summary.keyboard.focusableCount + 3; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      return {
        id: el.id || el.tagName.toLowerCase(),
        outlineWidth: cs.outlineWidth,
        outlineStyle: cs.outlineStyle,
      };
    });
    if (info) tabStops.push(info);
  }
  summary.keyboard.tabStops = tabStops;
  summary.keyboard.reachedAllFocusable =
    new Set(tabStops.map((s) => s.id)).size >= summary.keyboard.focusableIds.length;
  summary.keyboard.allStopsHaveVisibleOutline = tabStops.every(
    (s) => s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0
  );

  // Enter/Escape on the consent panel -- dispatched as a REAL
  // CONSENT_REQUEST through the stubbed onMessage listener list, so
  // showConsentPanel() runs for real (sets activeConsentRequestId etc.)
  // instead of the panel being unhidden by direct DOM poking, which
  // bypasses the same guard respondToConsent() checks on every keypress.
  async function fireConsentRequest(requestId) {
    await page.evaluate((id) => {
      (window.__msgListeners || []).forEach((fn) =>
        fn({
          type: "CONSENT_REQUEST",
          requestId: id,
          action: { action: "click" },
          element: { label: "Submit" },
          code: "SENSITIVE_TARGET_BLOCKED",
          reason: "test fixture",
          timeoutMs: 60000,
        })
      );
    }, requestId);
  }
  async function fireGoalPrivacyRequest(requestId) {
    await page.evaluate((id) => {
      (window.__msgListeners || []).forEach((fn) =>
        fn({
          type: "GOAL_PRIVACY_REVIEW_REQUEST",
          requestId: id,
          text: "9876543210",
          timeoutMs: 60000,
        })
      );
    }, requestId);
  }

  await fireConsentRequest("kbd-escape-1");
  await page.keyboard.press("Escape");
  summary.keyboard.consentPanelEscapeCloses = await page.evaluate(
    () => document.getElementById("consentPanel").hidden === true
  );

  await fireConsentRequest("kbd-enter-1");
  await page.keyboard.press("Enter");
  summary.keyboard.consentPanelEnterCloses = await page.evaluate(
    () => document.getElementById("consentPanel").hidden === true
  );
  await page.evaluate(() => { document.getElementById("consentPanel").hidden = true; });

  // Enter/Escape on the goal-privacy panel (both resolve to the safe
  // "keep private" default per popup.js's own comment -- confirm the
  // panel actually closes on either key once a real request is active).
  await fireGoalPrivacyRequest("kbd-escape-2");
  await page.keyboard.press("Escape");
  summary.keyboard.goalPrivacyEscapeCloses = await page.evaluate(
    () => document.getElementById("goalPrivacyPanel").hidden === true
  );

  await fireGoalPrivacyRequest("kbd-enter-2");
  await page.keyboard.press("Enter");
  summary.keyboard.goalPrivacyEnterCloses = await page.evaluate(
    () => document.getElementById("goalPrivacyPanel").hidden === true
  );
  await page.evaluate(() => { document.getElementById("goalPrivacyPanel").hidden = true; });

  // ---- WCAG 1.4.12 text-spacing override: confirm nothing clips/overlaps ----
  await page.setViewportSize({ width: 400, height: 900 });
  await page.addStyleTag({
    content: `
      *:not(caption) {
        line-height: 1.5 !important;
        letter-spacing: 0.12em !important;
        word-spacing: 0.16em !important;
      }
      p, li { margin-bottom: 2em !important; }
    `,
  });
  summary.textSpacing = await page.evaluate(() => {
    document.querySelectorAll("details.disclosure").forEach((d) => { d.open = true; });
    const clipped = [];
    document.querySelectorAll("body *").forEach((el) => {
      if (!el.textContent || !el.textContent.trim()) return;
      const cs = getComputedStyle(el);
      if (cs.overflow === "hidden" || cs.overflowX === "hidden" || cs.overflowY === "hidden") {
        // overflow:auto elements (.log-pre) are fine -- scrollable, not clipped.
        if (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2) {
          clipped.push({ id: el.id || el.className || el.tagName, tag: el.tagName });
        }
      }
    });
    return {
      documentScrollWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      horizontalScrollAt400: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      clippedElements: clipped,
    };
  });

  // ---- 360px-wide viewport / 200% zoom: no horizontal scroll ----
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(100);
  await page.setViewportSize({ width: 360, height: 640 });
  summary.zoom.at360NoZoom = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    horizontalScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
  }));
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await page.waitForTimeout(100);
  summary.zoom.at360Zoom200 = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    horizontalScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
  }));

  await browser.close();
  server.close();
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error("AUDIT_FAILED", err && err.stack ? err.stack : err);
  process.exit(1);
});
