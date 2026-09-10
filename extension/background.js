// SIH 26171 -- Phase 1 (extension-scaffold): background service worker.
//
// Responsibilities (CLAUDE.md Section 4, Phase 1):
//   - Create/manage the offscreen document, idempotently (MV3 service
//     workers are killed and restarted on idle -- this must tolerate
//     being called repeatedly across restarts without ever trying to
//     create a second offscreen document).
//   - Orchestrate chrome.tabs.captureVisibleTab and messaging between the
//     popup and the offscreen document.
//   - Own the DETECT_OBJECTS <-> DETECTION_RESULT/DETECTION_ERROR request
//     correlation by requestId (concurrent requests are supported, not
//     assumed away).
//
// Loaded as a CLASSIC (non-module) service worker on purpose, so it can
// use importScripts() to load the vendored webextension-polyfill build
// -- see extension/README.md "Why importScripts instead of bundling"
// for the reasoning. Everything below this line uses `browser.*`
// (polyfilled, promise-based, matches popup.js) EXCEPT chrome.offscreen
// and chrome.runtime.onInstalled/onStartup, which have no Firefox
// equivalent and are deliberately left as native `chrome.*` calls -- a
// clearly-marked branch point for the future Firefox retrofit pass
// (CLAUDE.md: "chrome.offscreen branch only if the Firefox event-page
// path doesn't pan out").
importScripts("vendor/browser-polyfill.js");

const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
// Generous relative to Phase 0's measured 8,432ms median warm WebGPU
// inference (CLAUDE.md "PHASE 0 CLOSED") -- covers cold model load
// (first request after install/SW restart) plus normal variance, while
// still guaranteeing a caller is never left hanging indefinitely if the
// offscreen document crashes or never replies.
const DETECTION_TIMEOUT_MS = 60000;

function log(...args) {
  console.log("[background]", ...args);
}

// ---------------------------------------------------------------------
// Offscreen document lifecycle -- idempotent by construction.
// ---------------------------------------------------------------------

// In-flight creation promise, so concurrent callers within the SAME
// service-worker lifetime await the same creation instead of racing two
// createDocument() calls. Reset to null once settled (does NOT persist
// across an SW restart -- deliberately: a fresh SW has no memory of this,
// which is exactly why hasOffscreenDocument() below re-checks reality
// rather than trusting in-memory state).
let creatingOffscreenDocument = null;

async function hasOffscreenDocument() {
  // chrome.runtime.getContexts is the documented Chrome (116+) way to
  // check for an existing offscreen document without provoking the
  // "Only a single offscreen document may be created" error. Feature
  // detected: on older Chrome without it, this returns false and
  // ensureOffscreenDocument() falls back to the try/catch approach the
  // Phase 0 spike already proved works (spike/chrome-harness/background.js).
  if (typeof chrome.runtime.getContexts === "function") {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
    });
    return contexts.length > 0;
  }
  return false;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;

  if (creatingOffscreenDocument) {
    await creatingOffscreenDocument;
    return;
  }

  creatingOffscreenDocument = chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ["WORKERS"],
    justification:
      "Run ONNX/WASM/WebGPU object-detection model inference (Xenova/yolos-tiny via @huggingface/transformers) off the visible extension pages.",
  });

  try {
    await creatingOffscreenDocument;
    log("offscreen document created.");
  } catch (err) {
    if (String(err).includes("single offscreen")) {
      log("offscreen document already exists (race across concurrent callers) -- not an error.");
    } else {
      throw err;
    }
  } finally {
    creatingOffscreenDocument = null;
  }
}

// ---------------------------------------------------------------------
// DETECT_OBJECTS request/response correlation.
// requestId -> { resolve, reject, timeoutId }. A Map, not a single slot
// -- callers must NOT assume one in-flight request at a time (e.g. the
// install self-test and a popup-triggered test could overlap).
// ---------------------------------------------------------------------

const pendingDetections = new Map();

function makeRequestId() {
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Sends { type: "DETECT_OBJECTS", requestId, imageData } to the offscreen
 * document and resolves with `boxes` from the matching DETECTION_RESULT,
 * or rejects on DETECTION_ERROR / timeout / delivery failure. Never hangs
 * forever -- every path (explicit error reply, timeout, or a
 * sendMessage() that fails outright because the offscreen doc isn't up
 * yet) settles the returned promise.
 *
 * @param {string} imageData raw base64 (no `data:` prefix -- see
 *   extension/README.md's "Message contract" section for why).
 * @returns {Promise<Array<{label:string,score:number,xmin:number,ymin:number,xmax:number,ymax:number}>>}
 */
async function detectObjects(imageData) {
  await ensureOffscreenDocument();
  const requestId = makeRequestId();

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingDetections.delete(requestId);
      reject(
        new Error(
          `DETECT_OBJECTS ${requestId} timed out after ${DETECTION_TIMEOUT_MS}ms (offscreen document did not respond -- check its console via chrome://extensions -> Inspect views: offscreen.html)`,
        ),
      );
    }, DETECTION_TIMEOUT_MS);

    pendingDetections.set(requestId, { resolve, reject, timeoutId });

    browser.runtime.sendMessage({ type: "DETECT_OBJECTS", requestId, imageData }).catch((err) => {
      // sendMessage itself failed synchronously (e.g. no listener
      // registered yet) -- fail this specific request instead of
      // leaving it to rely solely on the timeout.
      const pending = pendingDetections.get(requestId);
      if (pending) {
        clearTimeout(pending.timeoutId);
        pendingDetections.delete(requestId);
        pending.reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

// ---------------------------------------------------------------------
// Message router. Single listener, dispatches by message.type. Receives
// broadcasts from BOTH the offscreen document (DETECTION_RESULT /
// DETECTION_ERROR, sent via plain chrome.runtime.sendMessage) and the
// popup (SET_TASK_GOAL / RUN_TEST_DETECTION, sent via polyfilled
// browser.runtime.sendMessage) -- both land on this same event.
// ---------------------------------------------------------------------

browser.runtime.onMessage.addListener((message) => {
  if (!message || typeof message.type !== "string") return; // not for us

  switch (message.type) {
    case "DETECTION_RESULT":
    case "DETECTION_ERROR": {
      const pending = pendingDetections.get(message.requestId);
      if (!pending) return; // stale/unknown requestId (e.g. its timeout already fired) -- ignore, do not respond
      clearTimeout(pending.timeoutId);
      pendingDetections.delete(message.requestId);
      if (message.type === "DETECTION_RESULT") {
        pending.resolve(message.boxes);
      } else {
        pending.reject(new Error(message.error?.message || "detection failed (no error message provided)"));
      }
      return; // fire-and-forget from the offscreen doc's side -- no reply expected back to it
    }

    case "SET_TASK_GOAL":
      return handleSetTaskGoal(message.goal);

    case "RUN_TEST_DETECTION":
      return handleRunTestDetection();

    default:
      // Not recognized yet -- e.g. a future Phase 2a/3 message type
      // arriving before those modules land. Ignore rather than throw.
      return;
  }
});

async function handleSetTaskGoal(goal) {
  const value = typeof goal === "string" ? goal.trim() : "";
  await browser.storage.local.set({ taskGoal: value });
  log("task goal saved:", JSON.stringify(value));
  return { type: "TASK_GOAL_SAVED", goal: value, savedAt: Date.now() };
}

async function handleRunTestDetection() {
  try {
    const dataUrl = await browser.tabs.captureVisibleTab(undefined, { format: "png" });
    const imageData = stripDataUrlPrefix(dataUrl);
    const t0 = performance.now();
    const boxes = await detectObjects(imageData);
    const elapsedMs = performance.now() - t0;
    log(`test detection OK in ${elapsedMs.toFixed(0)}ms:`, boxes);
    return { type: "TEST_DETECTION_RESULT", boxes, elapsedMs };
  } catch (err) {
    const message = err?.message || String(err);
    console.error("[background] test detection FAILED:", message);
    return { type: "TEST_DETECTION_ERROR", error: message };
  }
}

function stripDataUrlPrefix(dataUrl) {
  const commaIdx = dataUrl.indexOf(",");
  return commaIdx === -1 ? dataUrl : dataUrl.slice(commaIdx + 1);
}

async function blobToBase64(blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// ---------------------------------------------------------------------
// Install-time self-test. Uses the bundled assets/test-image.jpg (no
// real tab capture, no user interaction) so the ENTIRE background<->
// offscreen DETECT_OBJECTS round trip can be proven from the service
// worker's own console alone -- this is the primary evidence for this
// module's checkpoint ("offscreen doc round-trips a test detection").
// ---------------------------------------------------------------------

async function runInstallSelfTest() {
  log("self-test: ensuring offscreen document...");
  try {
    await ensureOffscreenDocument();
    const testImageUrl = chrome.runtime.getURL("assets/test-image.jpg");
    const res = await fetch(testImageUrl);
    if (!res.ok) throw new Error(`could not fetch bundled test image: HTTP ${res.status}`);
    const blob = await res.blob();
    const imageData = await blobToBase64(blob);

    log(
      "self-test: bundled test image loaded, requesting detection " +
        "(first run loads the model -- can take noticeably longer than a warm run; " +
        "Phase 0 measured median warm WebGPU inference at 8,432ms, cold load was 14,097ms -- see CLAUDE.md 'PHASE 0 CLOSED')...",
    );
    const t0 = performance.now();
    const boxes = await detectObjects(imageData);
    const elapsedMs = performance.now() - t0;
    log(`SELF-TEST PASSED in ${elapsedMs.toFixed(0)}ms -- ${boxes.length} detection(s):`);
    log(JSON.stringify(boxes, null, 2));
  } catch (err) {
    console.error("[background] SELF-TEST FAILED:", err?.message || err);
    console.error(err);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  log("onInstalled -- setting up offscreen document and running self-test.");
  runInstallSelfTest();
});

chrome.runtime.onStartup.addListener(() => {
  log("onStartup -- ensuring offscreen document exists.");
  ensureOffscreenDocument().catch((err) => console.error("[background] onStartup ensureOffscreenDocument failed:", err));
});
