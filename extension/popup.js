// SIH 26171 -- Phase 1 (extension-scaffold): popup script.
// Extended in Tier 4 (usable-extension pass) with a Stop button (TASK 1),
// a live run-status panel (TASK 2 + TASK 3), and a Server URL setting
// (TASK 4).
//
// The popup NEVER talks to chrome.tabs / chrome.offscreen directly --
// background.js owns all of that orchestration per Section 4. The popup
// only sends/awaits messages to/from background.js.
//
// Loaded as `<script type="module">` (manifest-independent -- popup.html
// is an ordinary extension page, not a content script, so MV3's
// content_scripts "no type:module" restriction that forces every lib/*.js
// file into the dynamic-import() workaround elsewhere in this codebase
// does not apply here) so this file can `import` extension/lib/*.js's
// pure, already-unit-tested helpers directly instead of duplicating their
// logic inline.

import { validateServerUrl } from "./lib/server-url.js";
import { describeOutcome } from "./lib/action-describe.js";

const taskGoalEl = document.getElementById("taskGoal");
const saveGoalBtn = document.getElementById("saveGoal");
const saveStatusEl = document.getElementById("saveStatus");
const testDetectBtn = document.getElementById("testDetect");
const detectResultEl = document.getElementById("detectResult");
const runAgentLoopBtn = document.getElementById("runAgentLoop");
const stopAgentLoopBtn = document.getElementById("stopAgentLoop");
const agentLoopResultEl = document.getElementById("agentLoopResult");
const runStatusEl = document.getElementById("runStatus");
const prewarmStatusEl = document.getElementById("prewarmStatus");
const serverUrlInput = document.getElementById("serverUrlInput");
const saveServerUrlBtn = document.getElementById("saveServerUrl");
const serverUrlStatusEl = document.getElementById("serverUrlStatus");

const DEFAULT_SERVER_URL = "http://localhost:8000";

// ---------------------------------------------------------------------
// Pre-warm legibility (coordinator finding, 2026-09-11): the model's
// first real inference after the offscreen document is created costs
// ~20s (WebGPU shader/kernel compilation happening lazily on first
// execution -- see demo/README.md for the full data and how confirmed
// vs. inferred that explanation is); every inference after that costs
// well under a second. background.js's install/startup self-test already
// pays that first cost once, before any user-visible detection needs to
// -- the only gap was that nothing told anyone whether it had actually
// finished, so clicking "Run Agent Loop" too early silently ate the same
// ~20s on step 1 with no explanation. This renders background.js's
// GET_PREWARM_STATUS so that's a fact on screen, not folklore.
// ---------------------------------------------------------------------
function renderPrewarmStatus(state) {
  if (!state) {
    prewarmStatusEl.className = "status-pending";
    prewarmStatusEl.textContent = "Model warm-up status unknown (no response from background).";
    return;
  }
  prewarmStatusEl.className = `status-${state.status}`;
  if (state.status === "running" || state.status === "pending") {
    prewarmStatusEl.textContent =
      "⏳ Model warming up (first run only, ~20s)—wait for this before Run Agent Loop, " +
      "or step 1 will silently eat the same ~20s.";
  } else if (state.status === "warm") {
    const secs = typeof state.elapsedMs === "number" ? (state.elapsedMs / 1000).toFixed(1) : "?";
    prewarmStatusEl.textContent = `✓ Model warm and ready (pre-warm took ${secs}s). Run Agent Loop will run at full speed.`;
  } else if (state.status === "failed") {
    prewarmStatusEl.textContent = `✗ Pre-warm FAILED: ${state.error || "unknown error"}. Check the background service worker console.`;
  } else {
    prewarmStatusEl.textContent = `Model status: ${state.status}`;
  }
}

let prewarmPollTimer = null;

async function refreshPrewarmStatus() {
  try {
    const state = await browser.runtime.sendMessage({ type: "GET_PREWARM_STATUS" });
    renderPrewarmStatus(state);
    // Keep polling every second while warming up, so the popup updates
    // live if left open -- stop once it settles (warm or failed), or if
    // the popup is closed (its own JS just stops, nothing to clean up).
    const stillWarming = state && (state.status === "running" || state.status === "pending");
    if (stillWarming && !prewarmPollTimer) {
      prewarmPollTimer = setInterval(refreshPrewarmStatus, 1000);
    } else if (!stillWarming && prewarmPollTimer) {
      clearInterval(prewarmPollTimer);
      prewarmPollTimer = null;
    }
  } catch (err) {
    renderPrewarmStatus(null);
  }
}

refreshPrewarmStatus();

// Restore the last-saved task goal whenever the popup is opened.
browser.storage.local.get("taskGoal").then((stored) => {
  if (typeof stored.taskGoal === "string") {
    taskGoalEl.value = stored.taskGoal;
  }
});

saveGoalBtn.addEventListener("click", async () => {
  const goal = taskGoalEl.value.trim();
  saveStatusEl.textContent = "Saving...";
  saveGoalBtn.disabled = true;
  try {
    const response = await browser.runtime.sendMessage({ type: "SET_TASK_GOAL", goal });
    if (response && response.type === "TASK_GOAL_SAVED") {
      const t = new Date(response.savedAt).toLocaleTimeString();
      saveStatusEl.textContent = response.goal ? `Saved at ${t}.` : `Cleared at ${t}.`;
    } else {
      saveStatusEl.textContent = `Unexpected response from background: ${JSON.stringify(response)}`;
    }
  } catch (err) {
    saveStatusEl.textContent = `Failed to save: ${err.message || err}`;
  } finally {
    saveGoalBtn.disabled = false;
  }
});

testDetectBtn.addEventListener("click", async () => {
  detectResultEl.textContent =
    "Capturing current tab and running on-device detection...\n" +
    "(first run loads the model -- Phase 0 measured warm WebGPU inference at 8,432ms; cold load was 14,097ms. Be patient.)";
  testDetectBtn.disabled = true;
  try {
    const response = await browser.runtime.sendMessage({ type: "RUN_TEST_DETECTION" });
    if (response && response.type === "TEST_DETECTION_RESULT") {
      detectResultEl.textContent =
        `OK in ${response.elapsedMs.toFixed(0)}ms -- ${response.boxes.length} detection(s):\n` +
        JSON.stringify(response.boxes, null, 2);
    } else if (response && response.type === "TEST_DETECTION_ERROR") {
      detectResultEl.textContent = `ERROR: ${response.error}`;
    } else {
      detectResultEl.textContent = `Unexpected response from background: ${JSON.stringify(response)}`;
    }
  } catch (err) {
    detectResultEl.textContent = `Failed to reach background service worker: ${err.message || err}`;
  } finally {
    testDetectBtn.disabled = false;
  }
});

// =======================================================================
// Tier 4 (usable-extension pass), TASK 4: Server URL setting.
// =======================================================================
browser.storage.local.get("serverUrl").then((stored) => {
  serverUrlInput.value = typeof stored.serverUrl === "string" && stored.serverUrl ? stored.serverUrl : DEFAULT_SERVER_URL;
});

saveServerUrlBtn.addEventListener("click", async () => {
  const result = validateServerUrl(serverUrlInput.value);
  if (!result.ok) {
    serverUrlStatusEl.textContent = result.message;
    // DESIGN PASS (2026-09-12): these two literals were "#a3312a"/"#2a7d2a"
    // -- dark red/green tuned for a light popup background. Against the
    // new dark "redacted briefing" theme (popup.html) they fail contrast
    // (dark-on-dark). Swapped for the theme's own --redact/--pass custom
    // properties, which resolve through the cascade exactly like a
    // stylesheet color would; the success/error branching itself is
    // unchanged. Flagged per the design brief: the only popup.js edit in
    // this pass, and it's a color value, not logic.
    serverUrlStatusEl.style.color = "var(--redact)";
    return;
  }
  await browser.storage.local.set({ serverUrl: result.value });
  serverUrlInput.value = result.value;
  serverUrlStatusEl.textContent = `Saved: ${result.value} (background.js picks this up immediately, no reload needed).`;
  serverUrlStatusEl.style.color = "var(--pass)";
});

// =======================================================================
// Tier 4 (usable-extension pass), TASK 1 (Stop) + TASK 2 (live progress) +
// TASK 3 (readable errors).
//
// Popups are destroyed every time they lose focus (Chrome's own behavior,
// not a bug) -- so this file NEVER treats its own in-memory variables as
// the source of truth for whether a run is active. Every render comes
// from GET_RUN_STATE's response, re-fetched on open and polled while a
// run is active, exactly as the task brief requires.
// =======================================================================

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderRunStatus(payload) {
  const state = payload && payload.state;
  const canStopNow = !!(payload && payload.canStop);

  stopAgentLoopBtn.disabled = !canStopNow;
  runAgentLoopBtn.disabled = !!(state && state.active);

  if (!state || (!state.active && !state.startedAt)) {
    // Never started this SW lifetime (or storage.session isn't available
    // on this Chrome version and nothing has run yet) -- nothing to show.
    runStatusEl.innerHTML = "";
    return;
  }

  const parts = [];
  const stepLine = state.maxSteps ? `Step ${state.step || 0} / ${state.maxSteps}` : `Step ${state.step || 0}`;
  parts.push(
    `<div class="run-status-line"><strong>${state.active ? "Running" : "Finished"}</strong> -- ${escapeHtml(stepLine)} -- stage: ${escapeHtml(state.stage || "-")}</div>`
  );
  if (state.taskGoal) {
    parts.push(`<div class="run-status-line run-status-goal">Goal: ${escapeHtml(state.taskGoal)}</div>`);
  }
  if (state.lastAction && state.lastAction.description) {
    parts.push(`<div class="run-status-line">Last action: ${escapeHtml(state.lastAction.description)}</div>`);
  }

  // TASK 2's explicit requirement: blocked actions PROMINENTLY, never
  // buried. Shown as its own high-contrast banner, distinct from a plain
  // error, and never silently cleared by a later successful step (see
  // run-registry.js's applyProgress()) -- it stays visible as evidence of
  // the guard having fired at all, tagged with the step it happened on so
  // it's never confused with "the CURRENT step is blocked".
  if (state.lastBlock) {
    const reasonsText = (state.lastBlock.reasons && state.lastBlock.reasons.length
      ? state.lastBlock.reasons.join("; ")
      : state.lastBlock.message) || "";
    parts.push(
      `<div class="blocked-banner"><strong>BLOCKED (step ${state.lastBlock.step}): ${escapeHtml(state.lastBlock.code)}</strong>` +
        `<div>${escapeHtml(reasonsText)}</div></div>`
    );
  }

  // TASK 3: readable, actionable errors -- background.js/content.js have
  // already reduced whatever failed (network, VLM backend, internal
  // safety check) to one human sentence by the time it reaches here.
  if (state.lastError) {
    parts.push(
      `<div class="error-banner"><strong>Error${state.lastError.step ? ` (step ${state.lastError.step})` : ""}:</strong> ${escapeHtml(state.lastError.summary || "")}</div>`
    );
  }

  if (!state.active && state.outcome) {
    const desc = describeOutcome(state.outcome);
    parts.push(`<div class="outcome-banner outcome-${desc.tone}"><strong>Outcome: ${escapeHtml(desc.label)}</strong></div>`);
  }

  runStatusEl.innerHTML = parts.join("");
}

let runStatusPollTimer = null;

async function refreshRunState() {
  try {
    const resp = await browser.runtime.sendMessage({ type: "GET_RUN_STATE" });
    renderRunStatus(resp);
    const active = !!(resp && resp.state && resp.state.active);
    if (active && !runStatusPollTimer) {
      runStatusPollTimer = setInterval(refreshRunState, 1000);
    } else if (!active && runStatusPollTimer) {
      clearInterval(runStatusPollTimer);
      runStatusPollTimer = null;
    }
  } catch (err) {
    // background unreachable -- leave whatever was last rendered rather
    // than clearing it to a confusing blank panel.
  }
}

// On every popup open: read whatever background.js currently knows,
// regardless of whether THIS popup instance was the one that started the
// run -- see this block's own header comment.
refreshRunState();

runAgentLoopBtn.addEventListener("click", async () => {
  agentLoopResultEl.textContent =
    "Running full agent loop on the current tab... (up to 25 steps; first " +
    "detection may be slow if the model hasn't pre-warmed yet). Live progress " +
    "is shown above; the page's own DevTools console has the full instrumentation.";
  runAgentLoopBtn.disabled = true;
  // Start polling immediately -- the big sendMessage() call below doesn't
  // resolve until the WHOLE loop finishes (could be minutes), but
  // background.js's tracked run state updates step-by-step as content.js
  // reports progress, independently of that pending promise.
  refreshRunState();
  try {
    const response = await browser.runtime.sendMessage({ type: "RUN_AGENT_LOOP" });
    if (response && response.type === "RUN_AGENT_LOOP_RESULT") {
      agentLoopResultEl.textContent =
        `Loop finished: outcome=${response.outcome}, steps=${response.totalSteps}, ` +
        `totalMs=${response.totalMs}.\nFull instrumentation is in the PAGE's console ` +
        `(not this popup) -- look for the "RUN SUMMARY" block.`;
    } else if (response && response.type === "RUN_AGENT_LOOP_ERROR") {
      agentLoopResultEl.textContent = `ERROR: ${response.error}`;
    } else {
      agentLoopResultEl.textContent = `Unexpected response from background: ${JSON.stringify(response)}`;
    }
  } catch (err) {
    agentLoopResultEl.textContent = `Failed to reach background service worker: ${err.message || err}`;
  } finally {
    runAgentLoopBtn.disabled = false;
    refreshRunState();
  }
});

// TASK 1: Stop. Enabled only while GET_RUN_STATE reports a stoppable run
// (see renderRunStatus() above) -- disabled immediately on click so a
// second click can't fire a redundant STOP_AGENT_LOOP while the first is
// still in flight.
stopAgentLoopBtn.addEventListener("click", async () => {
  stopAgentLoopBtn.disabled = true;
  const originalLabel = stopAgentLoopBtn.textContent;
  stopAgentLoopBtn.textContent = "Stopping...";
  try {
    const resp = await browser.runtime.sendMessage({ type: "STOP_AGENT_LOOP" });
    if (!resp || resp.ok !== true) {
      agentLoopResultEl.textContent = `Stop request failed: ${(resp && resp.error) || "unknown error"}`;
    }
  } catch (err) {
    agentLoopResultEl.textContent = `Failed to send stop request: ${err.message || err}`;
  } finally {
    stopAgentLoopBtn.textContent = originalLabel;
    refreshRunState();
  }
});
