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
// Loaded as a MODULE service worker (manifest.json's `background.type` is
// `"module"`) because this file needs `lib/*.js` -- those modules use real
// ES `export` syntax, and dynamic `import()` is DISALLOWED inside
// ServiceWorkerGlobalScope by the HTML spec (see
// https://github.com/w3c/ServiceWorker/issues/1356; Chrome throws
// "Uncaught TypeError: import() is disallowed on ServiceWorkerGlobalScope"
// at the first call site and the whole service worker fails to start).
// A classic (non-module) service worker cannot load them at all:
// importScripts() only understands classic scripts / UMD-style globals,
// not files with `export` statements, and dynamic import() -- the thing
// that would otherwise bridge the gap -- is exactly what's banned. Static
// top-level `import` is the only mechanism a service worker is allowed to
// use to pull in ES module code, so this file is a module and
// importScripts() (module workers don't have it) is replaced below with a
// static side-effect import of the vendored webextension-polyfill build.
// Everything below this line uses `browser.*` (polyfilled, promise-based,
// matches popup.js) EXCEPT chrome.offscreen and
// chrome.runtime.onInstalled/onStartup, which have no Firefox equivalent
// and are deliberately left as native `chrome.*` calls -- a clearly-marked
// branch point for the future Firefox retrofit pass (CLAUDE.md:
// "chrome.offscreen branch only if the Firefox event-page path doesn't
// pan out").
import "./vendor/browser-polyfill.js";

// Static imports for this pass's lib/*.js modules -- same libs content.js
// loads via dynamic import() (a content script is NOT a service worker, so
// dynamic import() is legitimate there; see that file's CONTRACT MISMATCH
// #1 comment). A service worker cannot use dynamic import() at all (see the
// note above), so these are ordinary static ES imports instead, bound to
// namespace objects so every existing `RunRegistry.foo()` / `ErrorMessages.
// foo()` call site below reads exactly as it did when these were populated
// by `await import(...)`. `web_accessible_resources` still lists these
// files (manifest.json) for uniformity with every other lib/*.js module --
// this privileged extension context doesn't strictly need that listing to
// import its own bundled files, content.js's foreign-page context does.
import * as RunRegistry from "./lib/run-registry.js";
import * as ActionDescribe from "./lib/action-describe.js";
import * as ErrorMessages from "./lib/error-messages.js";
import * as ServerUrlLib from "./lib/server-url.js";
// Full-page scroll-and-stitch capture: pure scroll-plan/stitch-geometry
// math -- see content.js's "FULL-PAGE SCROLL-AND-STITCH CAPTURE" block
// comment and lib/capture-plan.js's own header for the feature writeup.
import * as CapturePlanLib from "./lib/capture-plan.js";

const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
// Generous relative to Phase 0's measured 8,432ms median warm WebGPU
// inference (CLAUDE.md "PHASE 0 CLOSED") -- covers cold model load
// (first request after install/SW restart) plus normal variance, while
// still guaranteeing a caller is never left hanging indefinitely if the
// offscreen document crashes or never replies.
const DETECTION_TIMEOUT_MS = 60000;

// Tier 4 (usable-extension pass), TASK 4: the local FastAPI server URL is
// now a SETTING (extension/lib/server-url.js validates it, popup.js saves
// it to chrome.storage.local under "serverUrl"), not a hardcoded constant.
// This was Phase 4's original fixed-default design (see git history) --
// fine for a hackathon demo, not something a real extension can ship.
// DEFAULT_SERVER_URL is what a fresh install uses until the user saves a
// different value; it is also what validateServerUrl()'s own
// host_permissions check is guaranteed to accept, so a never-configured
// install behaves EXACTLY as before this pass.
const DEFAULT_SERVER_URL = "http://localhost:8000";
let serverUrl = DEFAULT_SERVER_URL;

function log(...args) {
  console.log("[background]", ...args);
}

// Loaded once at SW startup, refreshed live on every chrome.storage.local
// change so a setting saved from the popup takes effect immediately,
// without requiring a service-worker restart or extension reload.
async function loadServerUrlSetting() {
  try {
    const stored = await browser.storage.local.get("serverUrl");
    if (typeof stored.serverUrl === "string" && stored.serverUrl.trim()) {
      serverUrl = stored.serverUrl.trim();
    }
  } catch (err) {
    log("loadServerUrlSetting failed (non-fatal -- keeping default):", err?.message || err);
  }
}
loadServerUrlSetting();

if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.serverUrl) {
      const next = changes.serverUrl.newValue;
      serverUrl = typeof next === "string" && next.trim() ? next.trim() : DEFAULT_SERVER_URL;
      log("serverUrl setting updated ->", serverUrl);
    }
  });
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
// for that step; content.js's MAX_STEPS budget gives later steps
// additional chances to pick it up. This is a known, accepted race, not a
// silent gap -- documented in the report to the orchestrator.
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
// Tier 4 (usable-extension pass), TASK 1 + TASK 2: the live run-state
// registry. content.js (running in the page, not the service worker) is
// where the agent loop actually executes -- this block is background.js's
// half of making that legible/controllable from a popup that can be
// destroyed and re-created at any moment (see run-registry.js's own file
// header for the full reasoning on why background.js, not content.js or
// the popup, is the durable holder of this state).
//
// `runState` starts null (no run has happened yet this SW lifetime) and
// is only ever produced by run-registry.js's pure transition functions --
// this file never hand-builds or mutates a run-state object directly.
// ---------------------------------------------------------------------

let runState = null;

// Chrome-only API (no stable Firefox equivalent at the time of writing --
// same "branch point for the future Firefox retrofit pass" as
// chrome.offscreen/chrome.runtime.onInstalled above), feature-detected so
// a Chrome version without it degrades to in-memory-only run state (Stop/
// progress still work within one SW lifetime; only the "survives an SW
// restart mid-run" guarantee is lost) rather than throwing.
const HAS_SESSION_STORAGE = typeof chrome !== "undefined" && !!(chrome.storage && chrome.storage.session);

async function persistRunState() {
  if (!HAS_SESSION_STORAGE) return;
  try {
    await chrome.storage.session.set({ runState });
  } catch (err) {
    log("persistRunState failed (non-fatal -- in-memory state is still correct for this SW lifetime):", err?.message || err);
  }
}

// Called on demand (GET_RUN_STATE) rather than unconditionally at every SW
// startup, so a fresh SW that has never been asked about run state yet
// doesn't pay a storage read it may never need.
async function loadPersistedRunStateIfMissing() {
  if (runState || !HAS_SESSION_STORAGE) return;
  try {
    const stored = await chrome.storage.session.get("runState");
    if (stored && stored.runState) runState = stored.runState;
  } catch (err) {
    log("loadPersistedRunStateIfMissing failed (non-fatal):", err?.message || err);
  }
}

/**
 * popup.js -> background.js, on popup open AND while polling during an
 * active run (popups have no persistent memory of their own -- see
 * run-registry.js's header). Returns the best currently-known state (SW
 * memory, falling back to chrome.storage.session if this SW instance
 * hasn't seen a run yet) plus a precomputed `canStop` so the popup never
 * has to import run-registry.js just to render one boolean correctly.
 */
async function handleGetRunState() {
  await loadPersistedRunStateIfMissing();
  const state = runState || RunRegistry.createRunState();
  return { type: "RUN_STATE", state, canStop: RunRegistry.canStop(state) };
}

/**
 * content.js -> background.js, sent (fire-and-forget on content.js's side)
 * at every meaningful stage transition of a running loop -- see
 * content.js's reportProgress(). Merges `patch` into the tracked state via
 * run-registry.js's pure applyProgress(), then persists.
 *
 * Defensive bootstrap: if no run is currently tracked as active but this
 * patch is the loop's own "starting" marker, initialize one here rather
 * than dropping it -- covers the (narrow, but real) race between
 * handleRunAgentLoopFromPopup()'s own RunRegistry.startRun() call and
 * content.js's first progress report arriving first. Any OTHER patch
 * arriving with no active run tracked (e.g. a stray late update after the
 * run already finished) is acknowledged but not applied -- it must never
 * fabricate a new "active" run out of nothing.
 */
async function handleRunProgressUpdate(patch, sender) {
  const tabId = sender && sender.tab ? sender.tab.id : undefined;

  if (!runState || runState.active !== true) {
    if (patch && patch.stage === "starting") {
      runState = RunRegistry.startRun(patch.taskGoal, { tabId, maxSteps: patch.maxSteps });
    } else {
      return { ok: false, reason: "no active run to update" };
    }
  }

  runState = RunRegistry.applyProgress(runState, patch);
  await persistRunState();
  return { ok: true };
}

// Per-tab AbortController for whichever /analyze fetch is CURRENTLY in
// flight (handleAnalyze below adds/removes its own entry) -- this is what
// lets Stop interrupt a pending network request immediately rather than
// waiting for it to resolve or time out. Deliberately keyed by tabId, not
// a single module-level slot: harmless even though this codebase only
// ever runs one agent loop at a time in practice, and correct if that ever
// changes.
const activeAnalyzeAborters = new Map();

/**
 * popup.js -> background.js -> (abort any in-flight /analyze fetch for the
 * tracked tab) + relay to that tab's content script. TASK 1's Stop button.
 *
 * Ordering is deliberate and load-bearing: the fetch is aborted FIRST,
 * synchronously, before the (asynchronous, round-trip) relay to
 * content.js even begins -- this is what makes Stop interrupt a pending
 * fetch/backoff immediately rather than waiting out however many seconds
 * are left on the current attempt or its retry delay (see content.js's
 * isRetryableAnalyzeFailure()/sleep() for the other half: recognizing the
 * resulting AbortError and not retrying it, and an interruptible backoff
 * wait for the case where the abort lands between attempts rather than
 * during one).
 */
async function handleStopAgentLoop() {
  if (!runState || !RunRegistry.canStop(runState)) {
    return { type: "STOP_AGENT_LOOP_RESULT", ok: false, error: "no agent loop is currently running" };
  }

  const tabId = runState.tabId;
  runState = RunRegistry.requestStop(runState);
  await persistRunState();

  const controller = tabId != null ? activeAnalyzeAborters.get(tabId) : null;
  if (controller) {
    try {
      controller.abort();
    } catch (_err) {
      /* AbortController.abort() cannot meaningfully throw -- defensive only */
    }
  }

  if (tabId == null) {
    return { type: "STOP_AGENT_LOOP_RESULT", ok: true, note: "stop flag set; no tracked tab to relay to" };
  }

  try {
    const resp = await browser.tabs.sendMessage(tabId, { type: "STOP_AGENT_LOOP" });
    return { type: "STOP_AGENT_LOOP_RESULT", ok: true, contentAck: resp };
  } catch (err) {
    // Content script unreachable (tab closed/navigated away). The abort()
    // above already happened regardless -- the loop's own next capture/
    // analyze round trip will fail naturally if the tab is genuinely gone.
    // Report, don't crash.
    return { type: "STOP_AGENT_LOOP_RESULT", ok: false, error: err?.message || String(err) };
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
      // existing architecture. sender.tab.id is threaded through so
      // handleAnalyze can register its AbortController under the tab
      // that owns this request -- see activeAnalyzeAborters/TASK 1's Stop.
      return handleAnalyze(message.payload, sender && sender.tab ? sender.tab.id : undefined);

    case "RUN_AGENT_LOOP":
      // popup.js -> background.js -> active tab's content script. The
      // popup cannot message a content script directly; it has to go
      // through the background service worker, which knows which tab is
      // active.
      return handleRunAgentLoopFromPopup();

    case "STOP_AGENT_LOOP":
      // popup.js -> background.js -> (abort in-flight fetch) + active
      // tab's content script. TASK 1.
      return handleStopAgentLoop();

    case "GET_RUN_STATE":
      // popup.js queries this on open AND while polling during an active
      // run -- TASK 2's "state must live in the background SW ... and be
      // re-read on popup open" requirement.
      return handleGetRunState();

    case "RUN_PROGRESS_UPDATE":
      // content.js -> background.js, fire-and-forget from content.js's
      // side, at every meaningful stage transition of a running loop.
      return handleRunProgressUpdate(message.patch, sender);

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

    // ---- Full-page scroll-and-stitch capture additions below ----

    case "CAPTURE_VIEWPORT":
      // content.js's full-page driver -> background.js, once per slice.
      // Deliberately lean (JUST captureVisibleTab, no detection) -- see
      // handleCaptureViewport()'s own comment for why detection is
      // deferred to a single STITCH_AND_DETECT call at the end rather than
      // running once per slice.
      return handleCaptureViewport(sender);

    case "STITCH_AND_DETECT":
      // content.js's full-page driver -> background.js, once per step,
      // after every slice has been collected. Stitches (OffscreenCanvas +
      // createImageBitmap, both available in a service worker) then runs
      // detection ONCE on the composite image.
      return handleStitchAndDetect(message);

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
// Full-page scroll-and-stitch capture. content.js's driver (the only
// context that can scroll the page) calls CAPTURE_VIEWPORT once per slice,
// then STITCH_AND_DETECT once at the end with every slice collected. See
// content.js's own "FULL-PAGE SCROLL-AND-STITCH CAPTURE" block comment and
// lib/capture-plan.js's header for the coordinate-problem/feature writeup
// this pair of handlers is the browser-only half of.
//
// WHY DETECTION RUNS ONCE, HERE, ON THE COMPOSITE -- NOT PER SLICE:
// the whole point of this feature is "the model sees the whole page at
// once," not five separate viewport-sized detections the caller would then
// have to de-duplicate/re-project itself. Running inference once on the
// stitched image also means exactly one inference cost is paid per step
// regardless of how many slices were captured -- N captures do NOT mean N
// inferences.
// ---------------------------------------------------------------------

function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

// HAZARD 2 backstop: content.js already throttles PROACTIVELY, before each
// capture (see its own `computeThrottleDelay()` call site) -- this is the
// REACTIVE half, a last-resort retry in case that proactive margin is ever
// insufficient under real scheduling jitter (e.g. another extension also
// calling captureVisibleTab against the same tab in the same window).
// Chrome's own error string for this specific condition is
// "MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND" -- matched by substring since
// there is no typed error code for it exposed to extensions.
const CAPTURE_RATE_LIMIT_RETRY_MS = 400;
const CAPTURE_RATE_LIMIT_MAX_RETRIES = 3;

async function captureVisibleTabWithRetry(windowId) {
  let lastErr;
  for (let attempt = 0; attempt <= CAPTURE_RATE_LIMIT_MAX_RETRIES; attempt++) {
    try {
      return await browser.tabs.captureVisibleTab(windowId, { format: "png" });
    } catch (err) {
      lastErr = err;
      const message = err?.message || String(err);
      if (!/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test(message) || attempt === CAPTURE_RATE_LIMIT_MAX_RETRIES) {
        throw err; // not the rate-limit error, or retries exhausted -- surface it
      }
      log(
        `captureVisibleTab rate-limited (attempt ${attempt + 1}/${CAPTURE_RATE_LIMIT_MAX_RETRIES + 1}) -- ` +
          `retrying in ${CAPTURE_RATE_LIMIT_RETRY_MS}ms:`,
        message
      );
      await new Promise((resolve) => setTimeout(resolve, CAPTURE_RATE_LIMIT_RETRY_MS));
    }
  }
  throw lastErr; // unreachable in practice (the loop above always throws or returns) -- satisfies control-flow analysis
}

/**
 * ONE slice of a full-page capture: just the screenshot, no detection.
 * Lean and single-purpose so content.js's per-slice round trip stays as
 * fast/cheap as possible under the ~2/sec rate-limit budget.
 */
async function handleCaptureViewport(sender) {
  try {
    const windowId = sender && sender.tab ? sender.tab.windowId : undefined;
    const dataUrl = await captureVisibleTabWithRetry(windowId);
    const screenshot = stripDataUrlPrefix(dataUrl);
    return { ok: true, screenshot };
  } catch (err) {
    const message = err?.message || String(err);
    console.error("[background] CAPTURE_VIEWPORT failed:", message);
    return { ok: false, error: message };
  }
}

async function base64PngToImageBitmap(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: "image/png" });
  return createImageBitmap(blob);
}

/**
 * Stitch every collected slice into one full-page image (canvas
 * compositing, HAZARD 8: memory -- each decoded ImageBitmap is `.close()`d
 * immediately after being drawn, rather than held until the whole loop
 * finishes, to release its (often GPU-backed) memory as early as
 * possible), then run detection ONCE on the composite.
 *
 * `slices` (from content.js): `[{scrollY: number (CSS px), screenshot:
 * base64 PNG, no "data:" prefix}]`, in the order they were captured.
 * `scaleFactor`: devicePixelRatio, for placing each CSS-px `scrollY` onto
 * the device-px canvas -- see capture-plan.js's `computeStitchLayout()`.
 */
async function handleStitchAndDetect(message) {
  const tStitch0 = performance.now();
  try {
    const rawSlices = Array.isArray(message && message.slices) ? message.slices : [];
    if (rawSlices.length === 0) {
      return { type: "STITCH_AND_DETECT_ERROR", error: "STITCH_AND_DETECT called with no slices" };
    }
    const scaleFactor = isFiniteNumber(message.scaleFactor) && message.scaleFactor > 0 ? message.scaleFactor : 1;

    // Matches handleCaptureAndDetect()'s own diagnostic: check BEFORE any
    // detectObjects()/ensureOffscreenDocument() call has a chance to
    // (re)create one, so the response can truthfully report whether the
    // offscreen document already existed going into this step.
    const offscreenDocumentAlreadyExisted = await hasOffscreenDocument();

    const decoded = [];
    for (const slice of rawSlices) {
      const bitmap = await base64PngToImageBitmap(slice.screenshot);
      decoded.push({ scrollY: slice.scrollY, widthPx: bitmap.width, heightPx: bitmap.height, bitmap });
    }

    const layout = CapturePlanLib.computeStitchLayout({
      slices: decoded.map((d) => ({ scrollY: d.scrollY, widthPx: d.widthPx, heightPx: d.heightPx })),
      scaleFactor,
    });

    const canvas = new OffscreenCanvas(layout.canvasWidthPx, layout.canvasHeightPx);
    const ctx = canvas.getContext("2d");
    // Draw in the order computeStitchLayout returned placements (== capture
    // order, ascending scrollY) -- overlap correctness doesn't depend on
    // draw order (identical content in the overlap draws identical
    // pixels), this is for determinism only. Each bitmap is closed
    // immediately after drawing -- HAZARD 8 (memory): nothing holds more
    // than one decoded slice's worth of extra memory at a time beyond the
    // canvas itself.
    for (const placement of layout.placements) {
      const d = decoded[placement.index];
      ctx.drawImage(d.bitmap, placement.drawXPx, placement.drawYPx);
      d.bitmap.close();
    }

    const stitchBlob = await canvas.convertToBlob({ type: "image/png" });
    const stitchedScreenshot = await blobToBase64(stitchBlob);
    const stitchMs = performance.now() - tStitch0; // decode + draw + encode, everything before detection starts

    const tDetect0 = performance.now();
    const result = await detectObjects(stitchedScreenshot);
    const detectMs = performance.now() - tDetect0;

    log(
      `STITCH_AND_DETECT OK -- ${decoded.length} slice(s) -> ${layout.canvasWidthPx}x${layout.canvasHeightPx}px stitched image, ` +
        `stitch(decode+draw+encode) ${stitchMs.toFixed(0)}ms, detect ${detectMs.toFixed(0)}ms ` +
        `(modelLoadMs=${result.modelLoadMs.toFixed(0)}, inferenceMs=${result.inferenceMs.toFixed(0)}), ` +
        `${result.boxes.length} detection(s)`
    );

    return {
      type: "STITCH_AND_DETECT_RESULT",
      screenshot: stitchedScreenshot,
      boxes: result.boxes,
      detectMs,
      modelLoadMs: result.modelLoadMs,
      inferenceMs: result.inferenceMs,
      pipelineWasAlreadyLoaded: result.pipelineWasAlreadyLoaded,
      offscreenDocumentAlreadyExisted,
      device: result.device,
      stitchWidthPx: layout.canvasWidthPx,
      stitchHeightPx: layout.canvasHeightPx,
      stitchMs,
    };
  } catch (err) {
    const message = err?.message || String(err);
    console.error("[background] STITCH_AND_DETECT failed:", message);
    return { type: "STITCH_AND_DETECT_ERROR", error: message };
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
//
// TASK 1 (Stop) + TASK 3 (readable errors) + TASK 4 (configurable URL)
// additions, all layered onto the same function rather than three separate
// call sites:
//   - `tabId` registers this request's AbortController in
//     activeAnalyzeAborters BEFORE the fetch starts, so handleStopAgentLoop
//     can abort it from a completely separate message handler.
//   - Before ever calling fetch(), the CURRENT `serverUrl` setting is
//     checked against manifest.json's actual host_permissions
//     (ServerUrlLib.isHostAllowed) -- Chrome would otherwise block the
//     request at the network layer and surface only a generic "Failed to
//     fetch", indistinguishable from "the server just isn't running".
//     Catching it here, with the exact configured URL and the exact
//     allowed patterns in hand, is what turns that into a specific,
//     actionable sentence instead.
//   - Every ANALYZE_ERROR this function returns now also carries a
//     `humanMessage` (via error-messages.js) -- purely ADDITIVE to the
//     existing `error` shape (never replaces status/error.message), so
//     nothing that already reads `.error.message` breaks.
//
async function handleAnalyze(payload, tabId) {
  if (!payload || typeof payload !== "object") {
    return { type: "ANALYZE_ERROR", status: 0, error: { message: "ANALYZE called with no payload" } };
  }

  if (!ServerUrlLib.isHostAllowed(serverUrl)) {
    const message =
      `Server URL "${serverUrl}" is outside this extension's permitted hosts ` +
      `(${ServerUrlLib.DEFAULT_ALLOWED_HOST_PATTERNS.join(", ")}). Chrome blocks the request before it ever ` +
      "leaves the extension. Fix the Server URL in the popup's Settings, or -- for a genuinely different host " +
      "-- widen manifest.json's host_permissions and reload the extension; that is a deliberate, separate " +
      "decision this popup does not make on its own.";
    log("ANALYZE blocked before fetch -- server URL not covered by host_permissions:", serverUrl);
    const errResp = { type: "ANALYZE_ERROR", status: 0, error: { message, errorCode: "SERVER_URL_NOT_PERMITTED" } };
    errResp.humanMessage = message;
    return errResp;
  }

  const controller = new AbortController();
  if (tabId !== undefined && tabId !== null) activeAnalyzeAborters.set(tabId, controller);

  try {
    const res = await fetch(`${serverUrl}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    let body = null;
    try {
      body = await res.json();
    } catch (_parseErr) {
      body = null; // non-JSON response body -- fall through to the status-based branches below
    }
    if (!res.ok) {
      log(`ANALYZE: server returned HTTP ${res.status}`, body);
      const errResp = { type: "ANALYZE_ERROR", status: res.status, error: body || { message: `HTTP ${res.status}` } };
      errResp.humanMessage = ErrorMessages.mapAnalyzeErrorToMessage(errResp, { serverUrl }).summary;
      return errResp;
    }
    return { type: "ANALYZE_RESULT", action: body };
  } catch (err) {
    if (err && err.name === "AbortError") {
      // Deliberate abort via handleStopAgentLoop() -- NOT a real network
      // failure. errorCode:"STOPPED" lets content.js's retry loop
      // recognize this immediately (see isRetryableAnalyzeFailure()) and
      // record outcome:"stopped" instead of treating it as just another
      // retryable transient error.
      const errResp = { type: "ANALYZE_ERROR", status: 0, error: { message: "request cancelled by Stop", errorCode: "STOPPED" } };
      errResp.humanMessage = "Request was cancelled because you clicked Stop.";
      return errResp;
    }
    // Network-level failure: server not running, wrong port, CORS
    // rejection, etc. err.message here is a browser-generated string
    // ("Failed to fetch", "NetworkError when attempting to fetch
    // resource.", ...) -- never derived from `payload`.
    const message = err?.message || String(err);
    console.error("[background] ANALYZE network failure:", message);
    const errResp = { type: "ANALYZE_ERROR", status: 0, error: { message } };
    errResp.humanMessage = ErrorMessages.mapAnalyzeErrorToMessage(errResp, { serverUrl }).summary;
    return errResp;
  } finally {
    if (tabId !== undefined && tabId !== null && activeAnalyzeAborters.get(tabId) === controller) {
      activeAnalyzeAborters.delete(tabId);
    }
  }
}

// ---------------------------------------------------------------------
// Phase 4 (integration-loop): RUN_AGENT_LOOP, popup -> background ->
// active tab's content script. The popup has no direct channel to a
// content script; it must go through the background service worker,
// which can look up the active tab and use chrome.tabs.sendMessage.
//
// TASK 1 + TASK 2 additions: initializes the tracked run-state BEFORE
// relaying to content.js (so GET_RUN_STATE/canStop are correct the moment
// this function returns control to the popup's own await, not only once
// content.js's first progress report arrives -- see run-registry.js's
// requestStop()/canStop() docs for why that ordering matters), and
// finalizes it once content.js's own response comes back (content.js ALSO
// reports its own finish via a final RUN_PROGRESS_UPDATE from inside
// runAgentLoop()'s own finally block -- the two are redundant by design,
// not a bug: whichever arrives first sets active:false/outcome, the other
// is a no-op re-application of the same values).
// ---------------------------------------------------------------------
async function handleRunAgentLoopFromPopup() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || tab.id === undefined) {
    return { type: "RUN_AGENT_LOOP_ERROR", error: "no active tab found" };
  }

  let taskGoal = null;
  try {
    const stored = await browser.storage.local.get("taskGoal");
    if (typeof stored.taskGoal === "string") taskGoal = stored.taskGoal;
  } catch (_err) {
    /* fall through with taskGoal:null -- content.js's own storage read is authoritative for the actual run */
  }
  runState = RunRegistry.startRun(taskGoal, { tabId: tab.id });
  await persistRunState();

  try {
    const response = await browser.tabs.sendMessage(tab.id, { type: "RUN_AGENT_LOOP" });
    const outcome = response && typeof response.outcome === "string" ? response.outcome : "failed";
    runState = RunRegistry.finishRun(runState, outcome);
    await persistRunState();
    return response || { type: "RUN_AGENT_LOOP_ERROR", error: "content script gave no response" };
  } catch (err) {
    runState = RunRegistry.finishRun(runState, "failed");
    await persistRunState();
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
