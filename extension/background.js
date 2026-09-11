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
// Pre-warm status tracking + legibility (coordinator finding, 2026-09-11):
// live data showed the pipeline was ALREADY loaded on both measured steps
// (pipelineWasAlreadyLoaded: true), yet the FIRST real inference after the
// offscreen document is created still cost ~20s, with every inference
// after that costing under a second -- consistent with WebGPU shader/
// kernel compilation happening lazily on first EXECUTION, not at
// pipeline() load time (this is a plausible, well-reasoned explanation of
// the observed pattern, not something this codebase directly instruments
// or can independently confirm -- flagged as such, not overclaimed).
//
// runInstallSelfTest() (below) already runs a REAL inference, not just a
// pipeline load -- so it already pays the ~20s first-execution cost once,
// at install/startup, before any user-visible detection needs to. The gap
// this section closes is PURELY legibility: nothing previously told
// Varun (or a judge) whether that self-test had actually finished, so
// clicking "Run Agent Loop" before it completed would silently eat the
// full ~20s on step 1 with no visible explanation -- "an avoidable
// embarrassment," not a functional bug (the underlying detectorPromise
// singleton makes it safe either way, just slow and unexplained).
// ---------------------------------------------------------------------
let prewarmState = { status: "pending", startedAt: null, finishedAt: null, elapsedMs: null, error: null };

function setPrewarmBadge(status) {
  // chrome.action badge -- visible without opening the popup at all, so
  // "is it warm yet" doesn't require Varun to remember to check anything.
  try {
    if (status === "running") {
      chrome.action.setBadgeText({ text: "..." });
      chrome.action.setBadgeBackgroundColor({ color: "#d9a300" }); // amber: warming up
    } else if (status === "warm") {
      chrome.action.setBadgeText({ text: "" }); // clear -- no badge = ready
    } else if (status === "failed") {
      chrome.action.setBadgeText({ text: "ERR" });
      chrome.action.setBadgeBackgroundColor({ color: "#d9534f" }); // red: pre-warm failed
    }
  } catch (err) {
    // Badge API failure must never take down the actual pre-warm -- this
    // is a UX nicety, not load-bearing.
    log("setPrewarmBadge failed (non-fatal):", err?.message || err);
  }
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
// FRAME COORDINATION (real-site hardening pass): manifest.json now sets
// content_scripts[].all_frames = true, so EVERY frame on a matched page
// (the top page AND every same-origin or cross-origin iframe) gets its
// own content.js instance. Only the TOP frame runs the agent loop
// (content.js checks window.top === window.self); every subframe instead
// scans itself and reports up. This background service worker is the
// coordination point for that -- it is the one privileged context every
// frame can already reach via chrome.runtime messaging, and the one place
// that can target a SPECIFIC frame via chrome.tabs.sendMessage's
// {frameId} option.
//
// Deliberately NOT using chrome.webNavigation.getAllFrames() to build a
// parent/child frame TREE -- that would need a new "webNavigation"
// permission (a real, visible escalation for a privacy-focused extension)
// and this project's actual iframe-nesting requirement, per the
// delegation brief, is ONE level (a page's direct <iframe> children, e.g.
// a payment provider's iframe embedded directly in the checkout page --
// the realistic case, matching how Amazon/most real sites actually embed
// third-party iframes). Deeper nesting (an iframe inside an iframe) is a
// natural extension of the same mechanism -- each frame measuring and
// reporting its own direct children -- but is NOT implemented or verified
// in this pass; flagged explicitly rather than silently claimed. See
// content.js's frame-coordination notes for the full protocol, including
// why the ACTUAL PII-adjacent data (sensitiveNodes/domSnapshot) travels
// over this privileged chrome.runtime channel rather than
// window.postMessage: postMessage delivers to EVERY listener registered
// on the target window, including the page's own (potentially malicious)
// script, so it is used ONLY for a single opaque geometry-correlation
// token that carries zero PII -- see content.js's SIH_FRAME_TOKEN
// handling.
// ---------------------------------------------------------------------

// tabId -> Set<frameId>. Populated by FRAME_HELLO, the first message every
// frame instance sends on load. This is how background knows which
// frameIds exist to ask for a scan on COLLECT_FRAME_REPORTS -- there is no
// other enumeration mechanism available without the webNavigation
// permission (see note above). A frame that loads AFTER the top frame has
// already started its first agent-loop step is simply not in this set yet
// for that step; MAX_STEPS=6 gives later steps additional chances to pick
// it up. This is a known, accepted race, not a silent gap -- documented in
// the report to the orchestrator.
const knownFrames = new Map();

function registerFrame(tabId, frameId) {
  if (typeof tabId !== "number" || typeof frameId !== "number") return;
  let set = knownFrames.get(tabId);
  if (!set) {
    set = new Set();
    knownFrames.set(tabId, set);
  }
  set.add(frameId);
}

// Housekeeping: drop a closed tab's frame registry rather than leaking it
// for the lifetime of the service worker. A stale entry for a tab that
// navigated (but wasn't closed) is harmless -- collectFrameReports()
// already treats an unreachable frameId as a per-frame failure, not a
// crash, and it self-heals as soon as that frame's content script sends a
// fresh FRAME_HELLO after the navigation.
if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    knownFrames.delete(tabId);
  });
}

// Per-frame timeout for a single SCAN_THIS_FRAME/RUN_ACTION_IN_FRAME round
// trip. Generous relative to dom-scanner/action-executor's own measured
// scan times (1-16ms per CLAUDE.md/README) because the bottleneck here is
// realistically cross-process messaging + a possibly-busy subframe, not
// the scan itself -- but still bounded, so one slow/broken iframe can
// never hang the whole agent-loop step. A frame that times out is DROPPED
// from that step's results and logged loudly, never silently treated as
// "found nothing" (same fail-loud posture as the coordinate-offset logic
// in frame-coords.js).
const FRAME_ROUND_TRIP_TIMEOUT_MS = 3000;

function sendToFrameWithTimeout(tabId, frameId, message) {
  return Promise.race([
    browser.tabs.sendMessage(tabId, message, { frameId }),
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error(`frame ${frameId} did not respond within ${FRAME_ROUND_TRIP_TIMEOUT_MS}ms`)), FRAME_ROUND_TRIP_TIMEOUT_MS)
    ),
  ]);
}

/**
 * Ask every KNOWN subframe of `tabId` (i.e. every frameId that has sent at
 * least one FRAME_HELLO, EXCLUDING frameId 0, the top frame, which scans
 * itself directly rather than round-tripping through here) to scan itself
 * right now, in parallel, each independently bounded by
 * FRAME_ROUND_TRIP_TIMEOUT_MS. Never rejects -- a per-frame failure
 * (timeout, "receiving end does not exist" because that frame navigated
 * away or was never a real content-script target, or a thrown error
 * inside the frame's own scan) becomes `{ ok: false, frameId, error }` in
 * the results array rather than failing the whole batch, so one bad frame
 * can never take down coverage of the others.
 *
 * @param {number} tabId
 * @returns {Promise<{ frameReports: Array<object> }>}
 */
async function collectFrameReports(tabId) {
  const frameIds = Array.from(knownFrames.get(tabId) || []).filter((id) => id !== 0);
  const results = await Promise.all(
    frameIds.map(async (frameId) => {
      try {
        const resp = await sendToFrameWithTimeout(tabId, frameId, { type: "SCAN_THIS_FRAME" });
        if (!resp || resp.ok !== true) {
          return { ok: false, frameId, error: (resp && resp.error) || "frame returned no/invalid response" };
        }
        return { ...resp, frameId };
      } catch (err) {
        return { ok: false, frameId, error: err?.message || String(err) };
      }
    })
  );
  return { frameReports: results };
}

/**
 * Relay a click/type/scroll/done action to a SPECIFIC subframe (the one
 * that owns the targetId, identified by the frame-prefixed agentId
 * scheme -- see action-executor.js's CROSS-FRAME UNIQUENESS note and
 * content.js's frame-coordination block for how the top frame parses the
 * frameId back out of "agent-f<N>-<n>"). The target frame executes it
 * against ITS OWN cached idMap (from its most recent SCAN_THIS_FRAME call
 * -- see content.js) and its OWN sensitivity guard, exactly mirroring how
 * the top frame acts on its own elements. Never falls back to acting on a
 * different frame or a different element on ANY failure -- same
 * fail-loud posture as action-executor.js's own executeAction().
 */
async function executeActionInFrame(tabId, frameId, action) {
  try {
    const resp = await sendToFrameWithTimeout(tabId, frameId, { type: "RUN_ACTION_IN_FRAME", action });
    return resp || { ok: false, error: "frame returned no response" };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
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

    case "GET_PREWARM_STATUS":
      // popup.js queries this on open so "is the model warm yet" is
      // visible instead of folklore -- see the pre-warm legibility block
      // above runInstallSelfTest(). Synchronous state read, no promise
      // needed, but returned as one for a consistent call pattern.
      return Promise.resolve({ type: "PREWARM_STATUS", ...prewarmState });

    // ---- Real-site hardening pass (frame coordination) additions below ----

    case "FRAME_HELLO": {
      // Every frame instance (top AND every subframe) sends this once on
      // load. sender.frameId is populated by Chrome itself for any
      // message from a content script -- 0 always means the top frame,
      // every other value is a stable-for-this-navigation subframe id.
      // This is the ONLY way this extension currently learns a subframe
      // exists at all (see the "not using webNavigation" note above).
      const tabId = sender && sender.tab ? sender.tab.id : undefined;
      const frameId = typeof sender?.frameId === "number" ? sender.frameId : undefined;
      registerFrame(tabId, frameId);
      return Promise.resolve({ type: "FRAME_HELLO_ACK", frameId });
    }

    case "COLLECT_FRAME_REPORTS":
      // TOP frame's content.js -> background.js, once per agent-loop
      // step. sender.tab.id identifies which tab's known subframes to
      // poll -- see collectFrameReports().
      return sender && sender.tab
        ? collectFrameReports(sender.tab.id)
        : Promise.resolve({ frameReports: [] });

    case "EXECUTE_ACTION_IN_FRAME":
      // TOP frame's content.js -> background.js -> a SPECIFIC subframe,
      // when the server's action targets an agentId that lives in an
      // iframe rather than the top frame itself.
      return sender && sender.tab
        ? executeActionInFrame(sender.tab.id, message.frameId, message.action)
        : Promise.resolve({ ok: false, error: "no sender tab -- cannot resolve which tab's frame to target" });

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
  prewarmState = { status: "running", startedAt: Date.now(), finishedAt: null, elapsedMs: null, error: null };
  setPrewarmBadge("running");
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
        "(first run loads the model AND pays the first-execution WebGPU shader-compile " +
        "cost -- can take noticeably longer than a warm run; Phase 0 measured median warm " +
        "WebGPU inference at 8,432ms, cold load was 14,097ms -- see CLAUDE.md 'PHASE 0 CLOSED')...",
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
    prewarmState = { status: "warm", startedAt: prewarmState.startedAt, finishedAt: Date.now(), elapsedMs, error: null };
    setPrewarmBadge("warm");
    log(`PRE-WARM STATUS: warm (ready) after ${elapsedMs.toFixed(0)}ms. Run Agent Loop will no longer pay this cost.`);
  } catch (err) {
    const message = err?.message || String(err);
    console.error("[background] SELF-TEST FAILED:", message);
    console.error(err);
    prewarmState = { status: "failed", startedAt: prewarmState.startedAt, finishedAt: Date.now(), elapsedMs: null, error: message };
    setPrewarmBadge("failed");
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
