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

// Phase 4 (integration-loop): local FastAPI server, per CLAUDE.md Section
// 4 Phase 2c. Fixed dev default (uvicorn's own default bind). Not made
// configurable via storage/UI -- this is a hackathon demo against a
// server Varun starts himself on his own machine, and a fixed constant
// keeps the demo/README.md steps unambiguous. Change this one line (and
// restart the extension) if the server is run on a different port.
const SERVER_URL = "http://localhost:8000";

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
 * document and resolves with the full matching DETECTION_RESULT message
 * (not just `boxes` -- see Phase 4 diagnostic note below), or rejects on
 * DETECTION_ERROR / timeout / delivery failure. Never hangs forever --
 * every path (explicit error reply, timeout, or a sendMessage() that
 * fails outright because the offscreen doc isn't up yet) settles the
 * returned promise.
 *
 * Phase 4 diagnostic addition (2026-09-11): previously resolved with just
 * `message.boxes`. Now resolves with the whole message object, which
 * offscreen.entry.js additionally populates with `modelLoadMs`,
 * `inferenceMs`, `pipelineWasAlreadyLoaded`, and `device` -- fields that
 * ONLY the offscreen document's own module state can produce (see that
 * file's runDetection() comment). Additive: every existing caller has
 * been updated to read `.boxes` off the resolved object.
 *
 * @param {string} imageData raw base64 (no `data:` prefix -- see
 *   extension/README.md's "Message contract" section for why).
 * @returns {Promise<{boxes:Array<{label:string,score:number,xmin:number,ymin:number,xmax:number,ymax:number}>, modelLoadMs:number, inferenceMs:number, pipelineWasAlreadyLoaded:boolean, device:string}>}
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

browser.runtime.onMessage.addListener((message, sender) => {
  if (!message || typeof message.type !== "string") return; // not for us

  switch (message.type) {
    case "DETECTION_RESULT":
    case "DETECTION_ERROR": {
      const pending = pendingDetections.get(message.requestId);
      if (!pending) return; // stale/unknown requestId (e.g. its timeout already fired) -- ignore, do not respond
      clearTimeout(pending.timeoutId);
      pendingDetections.delete(message.requestId);
      if (message.type === "DETECTION_RESULT") {
        pending.resolve(message); // full message -- see detectObjects()'s updated JSDoc
      } else {
        pending.reject(new Error(message.error?.message || "detection failed (no error message provided)"));
      }
      return; // fire-and-forget from the offscreen doc's side -- no reply expected back to it
    }

    case "SET_TASK_GOAL":
      return handleSetTaskGoal(message.goal);

    case "RUN_TEST_DETECTION":
      return handleRunTestDetection();

    // ---- Phase 4 (integration-loop) additions below ----

    case "CAPTURE_AND_DETECT":
      // content.js -> background.js. sender.tab is populated because this
      // message always originates from a content script (never the
      // popup), so its windowId is a reliable capture target.
      return handleCaptureAndDetect(sender);

    case "ANALYZE":
      // content.js -> background.js -> local FastAPI /analyze. Routed
      // through the background service worker (a privileged extension
      // context covered by manifest.json's host_permissions), not fetched
      // directly from the content script, for the same reason
      // captureVisibleTab is already background-owned: least-surprise,
      // one place that talks to the network, consistent with Phase 1's
      // existing architecture.
      return handleAnalyze(message.payload);

    case "RUN_AGENT_LOOP":
      // popup.js -> background.js -> active tab's content script. The
      // popup cannot message a content script directly; it has to go
      // through the background service worker, which knows which tab is
      // active.
      return handleRunAgentLoopFromPopup();

    default:
      // Not recognized -- ignore rather than throw (matches this
      // listener's existing behaviour for any unrecognized message type).
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
    const result = await detectObjects(imageData);
    const elapsedMs = performance.now() - t0;
    log(`test detection OK in ${elapsedMs.toFixed(0)}ms:`, result.boxes);
    return { type: "TEST_DETECTION_RESULT", boxes: result.boxes, elapsedMs };
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

// ---------------------------------------------------------------------
// Phase 4 (integration-loop): CAPTURE_AND_DETECT. Combines a tab capture
// and a detection round trip into one content<->background message (fewer
// hops than splitting them), but times each half SEPARATELY server-side
// of that message boundary so content.js's instrumentation gets real
// per-stage numbers instead of one lump sum that also includes messaging
// overhead.
//
// LATENCY DIAGNOSTIC (2026-09-11): a live multi-step run measured `detect`
// at ~17-21s PER STEP (not just the first), vs. an earlier single-shot
// measurement of ~800ms -- the coordinator's hypothesis was that MV3 SW
// eviction tears down the offscreen document (and its loaded model)
// between steps, so every step pays a full cold load. This handler now
// checks hasOffscreenDocument() explicitly, BEFORE ensureOffscreenDocument()
// has a chance to (re)create one, so the response can report whether the
// document already existed -- the other half of offscreen.entry.js's own
// `pipelineWasAlreadyLoaded` signal. Together the two answer the question
// directly instead of guessing from wall-clock time alone.
// ---------------------------------------------------------------------
async function handleCaptureAndDetect(sender) {
  try {
    const windowId = sender && sender.tab ? sender.tab.windowId : undefined;

    const offscreenDocumentAlreadyExisted = await hasOffscreenDocument();

    const tCapture0 = performance.now();
    const dataUrl = await browser.tabs.captureVisibleTab(windowId, { format: "png" });
    const captureMs = performance.now() - tCapture0;
    const screenshot = stripDataUrlPrefix(dataUrl);

    const tDetect0 = performance.now();
    const result = await detectObjects(screenshot);
    const detectMs = performance.now() - tDetect0;

    log(
      `CAPTURE_AND_DETECT OK -- capture ${captureMs.toFixed(0)}ms, detect ${detectMs.toFixed(0)}ms total ` +
        `(modelLoadMs=${result.modelLoadMs.toFixed(0)}, inferenceMs=${result.inferenceMs.toFixed(0)}, ` +
        `offscreenDocumentAlreadyExisted=${offscreenDocumentAlreadyExisted}, ` +
        `pipelineWasAlreadyLoaded=${result.pipelineWasAlreadyLoaded}), ${result.boxes.length} detection(s)`,
    );
    return {
      type: "CAPTURE_AND_DETECT_RESULT",
      screenshot,
      boxes: result.boxes,
      captureMs,
      detectMs,
      // Phase 4 diagnostic additions -- see comment above.
      modelLoadMs: result.modelLoadMs,
      inferenceMs: result.inferenceMs,
      pipelineWasAlreadyLoaded: result.pipelineWasAlreadyLoaded,
      offscreenDocumentAlreadyExisted,
      device: result.device,
    };
  } catch (err) {
    const message = err?.message || String(err);
    console.error("[background] CAPTURE_AND_DETECT FAILED:", message);
    return { type: "CAPTURE_AND_DETECT_ERROR", error: message };
  }
}

// ---------------------------------------------------------------------
// Phase 4 (integration-loop): ANALYZE. POSTs the already-redacted payload
// (built and Section-5-checked by content.js) to the local FastAPI
// server's /analyze endpoint.
//
// "An error path is a data egress path" (CLAUDE.md Section 7 rule 5):
// neither failure branch below echoes `payload` (the request body --
// contains the redacted image + sanitized DOM JSON, which is not raw PII
// by the time it gets here, but is still not this function's business to
// log). The network-failure branch surfaces only fetch()'s own error
// message, which is a fixed string like "Failed to fetch" and structurally
// cannot embed the request body. The HTTP-error branch surfaces only the
// SERVER's response body -- which server/main.py already scrubs to
// type/loc/msg (422), errorCode+violations with no raw value (400 PII
// leak), or errorCode+message (502) -- never re-serializes what was sent.
// ---------------------------------------------------------------------
async function handleAnalyze(payload) {
  if (!payload || typeof payload !== "object") {
    return { type: "ANALYZE_ERROR", status: 0, error: { message: "ANALYZE called with no payload" } };
  }
  try {
    const res = await fetch(`${SERVER_URL}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let body = null;
    try {
      body = await res.json();
    } catch (_parseErr) {
      body = null; // non-JSON response body -- fall through to the status-based branches below
    }
    if (!res.ok) {
      log(`ANALYZE: server returned HTTP ${res.status}`, body);
      return { type: "ANALYZE_ERROR", status: res.status, error: body || { message: `HTTP ${res.status}` } };
    }
    return { type: "ANALYZE_RESULT", action: body };
  } catch (err) {
    // Network-level failure: server not running, wrong port, CORS
    // rejection, etc. err.message here is a browser-generated string
    // ("Failed to fetch", "NetworkError when attempting to fetch
    // resource.", ...) -- never derived from `payload`.
    const message = err?.message || String(err);
    console.error("[background] ANALYZE network failure:", message);
    return { type: "ANALYZE_ERROR", status: 0, error: { message } };
  }
}

// ---------------------------------------------------------------------
// Phase 4 (integration-loop): RUN_AGENT_LOOP, popup -> background ->
// active tab's content script. The popup has no direct channel to a
// content script; it must go through the background service worker,
// which can look up the active tab and use chrome.tabs.sendMessage.
// ---------------------------------------------------------------------
async function handleRunAgentLoopFromPopup() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || tab.id === undefined) {
    return { type: "RUN_AGENT_LOOP_ERROR", error: "no active tab found" };
  }
  try {
    const response = await browser.tabs.sendMessage(tab.id, { type: "RUN_AGENT_LOOP" });
    return response || { type: "RUN_AGENT_LOOP_ERROR", error: "content script gave no response" };
  } catch (err) {
    // Most common cause: the content script isn't loaded on this tab
    // (e.g. a chrome:// page, or the tab predates the extension being
    // installed/reloaded -- content scripts only auto-inject on
    // navigation). err.message here is a fixed browser-generated string,
    // never page content.
    return { type: "RUN_AGENT_LOOP_ERROR", error: err?.message || String(err) };
  }
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
    const result = await detectObjects(imageData);
    const elapsedMs = performance.now() - t0;
    log(
      `SELF-TEST PASSED in ${elapsedMs.toFixed(0)}ms -- ${result.boxes.length} detection(s) ` +
        `(modelLoadMs=${result.modelLoadMs.toFixed(0)}, inferenceMs=${result.inferenceMs.toFixed(0)}, ` +
        `pipelineWasAlreadyLoaded=${result.pipelineWasAlreadyLoaded}, device=${result.device}):`,
    );
    log(JSON.stringify(result.boxes, null, 2));
  } catch (err) {
    console.error("[background] SELF-TEST FAILED:", err?.message || err);
    console.error(err);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  log("onInstalled -- setting up offscreen document and running self-test.");
  runInstallSelfTest();
});

// RULING 5 (pre-warm), CLAUDE.md Phase 1 RESULT: cold model load measured
// 19,407ms vs ~8,432ms warm. runInstallSelfTest() already fires a
// throwaway inference (this WAS Phase 1's pre-warm mechanism, built before
// Phase 4 existed -- it satisfies this ruling as-is for the "install"
// half). This call extends the same warm-up to "startup": onInstalled
// only fires once, at install time, but a full browser restart tears down
// the offscreen document and its loaded model with it, so a fresh browser
// session needs its own warm-up too, not just a re-check that the
// (now-empty) offscreen document exists. Without this, the FIRST
// detection after a browser restart -- which in a live demo is very
// likely to be the one Varun watches -- pays the full ~19s cold cost
// instead of a pre-warmed ~8.4s.
chrome.runtime.onStartup.addListener(() => {
  log("onStartup -- ensuring offscreen document exists and pre-warming inference.");
  runInstallSelfTest();
});
