// SIH 26171 -- Phase 1 (extension-scaffold): popup script.
//
// Two jobs, both explicitly in Phase 1's scope (CLAUDE.md Section 4):
//   1. Plain-text task goal input, sent to the background service worker.
//   2. A diagnostic "Run Test Detection" button that exercises the full
//      captureVisibleTab -> background -> offscreen -> background -> popup
//      round trip, for Varun to verify this module's checkpoint
//      ("offscreen doc round-trips a test detection").
//
// The popup NEVER talks to chrome.tabs / chrome.offscreen directly --
// background.js owns all of that orchestration per Section 4. The popup
// only sends/awaits messages to/from background.js.

const taskGoalEl = document.getElementById("taskGoal");
const saveGoalBtn = document.getElementById("saveGoal");
const saveStatusEl = document.getElementById("saveStatus");
const testDetectBtn = document.getElementById("testDetect");
const detectResultEl = document.getElementById("detectResult");
const runAgentLoopBtn = document.getElementById("runAgentLoop");
const agentLoopResultEl = document.getElementById("agentLoopResult");

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

// Phase 4 (integration-loop): "Run Agent Loop" -- forwards to
// background.js, which relays to the active tab's content script
// (RUN_AGENT_LOOP). The popup only shows a short pointer to the real
// output; the full per-stage instrumentation and the Section 5
// payload check are logged on the PAGE's own console (content.js runs
// there, not here), which is why this button's own hint text and result
// area deliberately don't try to duplicate that detail.
runAgentLoopBtn.addEventListener("click", async () => {
  agentLoopResultEl.textContent =
    "Running full agent loop on the current tab... (up to 6 steps; first " +
    "detection may be slow if the model hasn't pre-warmed yet). Open that " +
    "tab's own DevTools console to watch it live.";
  runAgentLoopBtn.disabled = true;
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
  }
});
