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
import { describeOutcome, describePendingAction, describePolicyReason } from "./lib/action-describe.js";
import { getProfile, setProfile } from "./lib/profile-vault.js";
import { getPipelineVersion, setPipelineVersion, PIPELINE_VERSIONS } from "./lib/pipeline-version.js";

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
const fullPageCaptureToggle = document.getElementById("fullPageCaptureToggle");
const fullPageCaptureStatusEl = document.getElementById("fullPageCaptureStatus");
const profileFullNameInput = document.getElementById("profileFullName");
const profileEmailInput = document.getElementById("profileEmail");
const profilePhoneInput = document.getElementById("profilePhone");
const saveProfileBtn = document.getElementById("saveProfile");
const profileStatusEl = document.getElementById("profileStatus");
const htmlRootEl = document.getElementById("htmlRoot") || document.documentElement;
const langEnBtn = document.getElementById("langEnBtn");
const langHiBtn = document.getElementById("langHiBtn");

const DEFAULT_SERVER_URL = "http://localhost:8000";

// =======================================================================
// English/Hindi popup localization.
//
// Default behavior (never toggled): follow the BROWSER's own locale via
// chrome.i18n.getMessage/browser.i18n.getMessage, exactly like any other
// MV3 extension -- this is what "default_locale": "en" in manifest.json
// already sets up, and it only ever resolves to "en" or "hi" since those
// are the only two _locales/ directories that exist.
//
// The language TOGGLE (EN / हिं buttons in the topbar) OVERRIDES that:
// clicking it fetches the chosen locale's messages.json directly
// (fetch(browser.runtime.getURL(...))) and remembers the choice in
// browser.storage.local under "uiLang", per this pass's brief. Every
// user-visible string in this file goes through t(key, substitutions?) --
// action-describe.js's describeOutcome()/describePendingAction()/
// describePolicyReason() take `t` itself as an optional last argument (see
// that file's own `tr()` helper) so the consent-panel sentences translate
// the same way, without action-describe.js's own extensive existing test
// suite (tests/unit/test_action_describe.mjs, which calls every one of
// those functions WITHOUT a translate argument) changing behavior at all.
//
// "Tiny fallback for tests where chrome is absent": rawMessage() below
// never throws if `browser`/`browser.i18n` don't exist (guarded by
// try/catch + typeof checks) -- it just falls through to "", and t()'s
// own last-resort is the bare key name. This file is never imported under
// node --test (it touches `document` at module scope, which does not
// exist there) so that path is exercised only defensively, not by the
// test suite -- see tests/unit/test_i18n.mjs for what IS asserted here.
// =======================================================================
let uiLang = "en";
let manualMessages = null; // non-null only once the toggle has been used at least once

async function loadManualMessages(lang) {
  try {
    const url = browser.runtime.getURL(`_locales/${lang}/messages.json`);
    const resp = await fetch(url);
    const json = await resp.json();
    const flat = {};
    for (const key in json) {
      if (json[key] && typeof json[key].message === "string") flat[key] = json[key].message;
    }
    return flat;
  } catch (_err) {
    return null;
  }
}

function rawMessage(key) {
  if (manualMessages && manualMessages[key]) return manualMessages[key];
  try {
    if (typeof browser !== "undefined" && browser.i18n && typeof browser.i18n.getMessage === "function") {
      const msg = browser.i18n.getMessage(key);
      if (msg) return msg;
    }
  } catch (_err) {
    /* chrome/browser.i18n unavailable (e.g. under a non-extension test harness) -- fall through */
  }
  return "";
}

/**
 * `t(key, substitutions?) -> string`. Substitutions are positional and
 * OWN (not chrome.i18n's named-placeholder mechanism): "$1"/"$2"/... in
 * the message text are replaced verbatim, in order -- this is what lets a
 * Hindi sentence reorder $1/$2 relative to the English word order (see
 * pending_typeWithValue's en vs hi phrasing) without any special syntax.
 */
function t(key, subs) {
  const msg = rawMessage(key);
  if (!msg) return key;
  if (!subs) return msg;
  let out = msg;
  subs.forEach((s, i) => {
    out = out.split(`$${i + 1}`).join(String(s));
  });
  return out;
}

function applyStaticI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-html]").forEach((el) => {
    el.innerHTML = t(el.getAttribute("data-i18n-html"));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
    el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria-label")));
  });
}

function updateLangToggleUI() {
  if (langEnBtn) langEnBtn.setAttribute("aria-pressed", String(uiLang === "en"));
  if (langHiBtn) langHiBtn.setAttribute("aria-pressed", String(uiLang === "hi"));
}

async function setLang(lang) {
  const normalized = lang === "hi" ? "hi" : "en";
  uiLang = normalized;
  manualMessages = await loadManualMessages(normalized);
  try {
    await browser.storage.local.set({ uiLang: normalized });
  } catch (_err) {
    /* storage unavailable -- the choice just won't persist across popup opens */
  }
  htmlRootEl.setAttribute("lang", normalized);
  applyStaticI18n();
  updateLangToggleUI();
  // Re-render whatever dynamic panels are currently on screen so a language
  // switch mid-session doesn't leave stale-language text sitting next to
  // freshly-localized static labels.
  renderPrewarmStatus(lastPrewarmState);
  refreshRunState();
}

let lastPrewarmState = null;

async function initI18n() {
  try {
    const stored = await browser.storage.local.get("uiLang");
    if (stored && (stored.uiLang === "en" || stored.uiLang === "hi")) {
      uiLang = stored.uiLang;
      manualMessages = await loadManualMessages(uiLang);
    } else {
      uiLang = "en";
      manualMessages = null; // never toggled -- follow the browser's own locale via chrome.i18n
    }
  } catch (_err) {
    uiLang = "en";
    manualMessages = null;
  }
  htmlRootEl.setAttribute("lang", uiLang);
  applyStaticI18n();
  updateLangToggleUI();
}

if (langEnBtn) langEnBtn.addEventListener("click", () => setLang("en"));
if (langHiBtn) langHiBtn.addEventListener("click", () => setLang("hi"));

// Top-level await (valid in an ES module, and popup.js is loaded as
// <script type="module">): every statement below this line runs AFTER
// messages are ready, so the very first paint is already in the right
// language instead of flashing English then Hindi.
await initI18n();

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
  lastPrewarmState = state;
  if (!state) {
    prewarmStatusEl.className = "status-pending";
    prewarmStatusEl.textContent = t("prewarmUnknown");
    return;
  }
  prewarmStatusEl.className = `status-${state.status}`;
  if (state.status === "running" || state.status === "pending") {
    prewarmStatusEl.textContent = t("prewarmWarming");
  } else if (state.status === "warm") {
    const secs = typeof state.elapsedMs === "number" ? (state.elapsedMs / 1000).toFixed(1) : "?";
    prewarmStatusEl.textContent = t("prewarmWarm", [secs]);
  } else if (state.status === "failed") {
    prewarmStatusEl.textContent = t("prewarmFailed", [state.error || "unknown error"]);
  } else {
    prewarmStatusEl.textContent = t("prewarmStatusGeneric", [state.status]);
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
  saveStatusEl.textContent = t("savingEllipsis");
  saveGoalBtn.disabled = true;
  try {
    const response = await browser.runtime.sendMessage({ type: "SET_TASK_GOAL", goal });
    if (response && response.type === "TASK_GOAL_SAVED") {
      const savedAtTime = new Date(response.savedAt).toLocaleTimeString();
      saveStatusEl.textContent = response.goal ? t("savedAt", [savedAtTime]) : t("clearedAt", [savedAtTime]);
    } else {
      saveStatusEl.textContent = t("unexpectedResponse", [JSON.stringify(response)]);
    }
  } catch (err) {
    saveStatusEl.textContent = t("failedToSave", [err.message || err]);
  } finally {
    saveGoalBtn.disabled = false;
  }
});

testDetectBtn.addEventListener("click", async () => {
  detectResultEl.textContent = t("testDetectRunning");
  testDetectBtn.disabled = true;
  try {
    const response = await browser.runtime.sendMessage({ type: "RUN_TEST_DETECTION" });
    if (response && response.type === "TEST_DETECTION_RESULT") {
      detectResultEl.textContent =
        t("testDetectOk", [response.elapsedMs.toFixed(0), response.boxes.length]) +
        "\n" +
        JSON.stringify(response.boxes, null, 2);
    } else if (response && response.type === "TEST_DETECTION_ERROR") {
      detectResultEl.textContent = t("errorPrefix", [response.error]);
    } else {
      detectResultEl.textContent = t("unexpectedResponse", [JSON.stringify(response)]);
    }
  } catch (err) {
    detectResultEl.textContent = t("failedToReachBackground", [err.message || err]);
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
  serverUrlStatusEl.textContent = t("serverUrlSaved", [result.value]);
  serverUrlStatusEl.style.color = "var(--pass)";
});

// =======================================================================
// Full-page scroll-and-stitch capture setting.
//
// chrome.storage.local["fullPageCapture"], boolean, DEFAULT FALSE --
// content.js reads this ONCE per run (see its own runAgentLoop() comment)
// so a mid-run toggle can't switch coordinate modes partway through a run
// that's already in progress; it takes effect on the NEXT "Run Agent
// Loop" click. Read/write here mirrors the Server URL setting immediately
// above it: read on popup open, written immediately on change (no
// separate "Save" button needed for a checkbox -- there's no free-text
// value to validate first, unlike the server URL).
// =======================================================================
browser.storage.local.get("fullPageCapture").then((stored) => {
  fullPageCaptureToggle.checked = stored.fullPageCapture === true;
});

fullPageCaptureToggle.addEventListener("change", async () => {
  const enabled = fullPageCaptureToggle.checked;
  try {
    await browser.storage.local.set({ fullPageCapture: enabled });
    fullPageCaptureStatusEl.textContent = enabled ? t("fullPageCaptureOn") : t("fullPageCaptureOff");
    fullPageCaptureStatusEl.style.color = "var(--text-muted)";
  } catch (err) {
    fullPageCaptureToggle.checked = !enabled; // revert the visual state -- the write didn't actually happen
    fullPageCaptureStatusEl.textContent = t("failedToSave", [err.message || err]);
    fullPageCaptureStatusEl.style.color = "var(--redact)";
  }
});

// =======================================================================
// PROFILE VAULT (fill_profile feature). See extension/lib/profile-vault.js's
// own header for the full "model names a category, this extension supplies
// the value" design -- these three fields are the ONLY place that value is
// ever typed in by a human, and getProfile()/setProfile() are the ONLY code
// path that reads/writes it. It is read here (to populate the form) and
// written here (on Save) via chrome.storage.local -- exactly the same
// direct-storage pattern this file already uses for serverUrl/
// fullPageCapture just above, no background.js relay needed (storage.local
// is shared across every extension context already).
//
// 🔴 This value is NEVER sent anywhere by this file: no
// browser.runtime.sendMessage() call in this block, no network request --
// getProfile()/setProfile() only ever talk to browser.storage.local, which
// is on-device.
// =======================================================================
getProfile(browser.storage.local).then((profile) => {
  profileFullNameInput.value = profile.full_name;
  profileEmailInput.value = profile.email;
  profilePhoneInput.value = profile.phone;
});

saveProfileBtn.addEventListener("click", async () => {
  profileStatusEl.textContent = t("savingEllipsis");
  saveProfileBtn.disabled = true;
  try {
    const saved = await setProfile(browser.storage.local, {
      full_name: profileFullNameInput.value,
      email: profileEmailInput.value,
      phone: profilePhoneInput.value,
    });
    // Reflect back the sanitized (trimmed) values -- setProfile() never
    // echoes anything ELSE back (no network response to parse, nothing
    // beyond what was just typed into this very form).
    profileFullNameInput.value = saved.full_name;
    profileEmailInput.value = saved.email;
    profilePhoneInput.value = saved.phone;
    profileStatusEl.textContent = t("profileSaved");
    profileStatusEl.style.color = "var(--pass)";
  } catch (err) {
    profileStatusEl.textContent = t("failedToSave", [err.message || err]);
    profileStatusEl.style.color = "var(--redact)";
  } finally {
    saveProfileBtn.disabled = false;
  }
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
  const stepLine = state.maxSteps ? t("stepOfTotal", [state.step || 0, state.maxSteps]) : t("stepOnly", [state.step || 0]);
  const runStateWord = state.active ? t("runStateRunning") : t("runStateFinished");
  parts.push(
    `<div class="run-status-line"><strong>${escapeHtml(runStateWord)}</strong> -- ${escapeHtml(stepLine)} -- ${escapeHtml(t("runStatusLine", [state.stage || "-"]))}</div>`
  );
  if (state.taskGoal) {
    parts.push(`<div class="run-status-line run-status-goal">${escapeHtml(t("goalLabel", [state.taskGoal]))}</div>`);
  }
  if (state.lastAction && state.lastAction.description) {
    parts.push(`<div class="run-status-line">${escapeHtml(t("lastActionLabel", [state.lastAction.description]))}</div>`);
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
      `<div class="blocked-banner"><strong>${escapeHtml(t("blockedBannerTitle", [state.lastBlock.step, state.lastBlock.code]))}</strong>` +
        `<div>${escapeHtml(reasonsText)}</div></div>`
    );
  }

  // TASK 3: readable, actionable errors -- background.js/content.js have
  // already reduced whatever failed (network, VLM backend, internal
  // safety check) to one human sentence by the time it reaches here.
  if (state.lastError) {
    const errorLabel = state.lastError.step ? t("errorWithStep", [state.lastError.step]) : t("errorNoStep");
    parts.push(
      `<div class="error-banner"><strong>${escapeHtml(errorLabel)}</strong> ${escapeHtml(state.lastError.summary || "")}</div>`
    );
  }

  if (!state.active && state.outcome) {
    const desc = describeOutcome(state.outcome, t);
    parts.push(`<div class="outcome-banner outcome-${desc.tone}"><strong>${escapeHtml(t("outcomeLabel", [desc.label]))}</strong></div>`);
  }

  runStatusEl.innerHTML = parts.join("");
}

let runStatusPollTimer = null;

// THE STOP-NEVER-ENABLES BUG, fixed. The Run click handler below calls
// refreshRunState() to "start polling immediately" -- but at that instant
// RUN_AGENT_LOOP has not been sent yet, so background.js reports
// active:false, the `active &&` guard declines to start the timer, and
// nothing ever re-queries. Stop therefore stayed disabled for the entire
// run: the button was never broken, it was never enabled.
//
// This flag says "a run is starting, keep polling even though the state
// does not show it yet". It is cleared the moment an active run is
// actually observed, and by the click handler's finally block, so a
// failed start cannot leave the timer running forever.
let expectingRunStart = false;

async function refreshRunState() {
  try {
    const resp = await browser.runtime.sendMessage({ type: "GET_RUN_STATE" });
    renderRunStatus(resp);
    const active = !!(resp && resp.state && resp.state.active);
    if (active) expectingRunStart = false;
    const shouldPoll = active || expectingRunStart;
    if (shouldPoll && !runStatusPollTimer) {
      runStatusPollTimer = setInterval(refreshRunState, 1000);
    } else if (!shouldPoll && runStatusPollTimer) {
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
  agentLoopResultEl.textContent = t("runAgentLoopRunning");
  runAgentLoopBtn.disabled = true;
  // Start polling immediately -- the big sendMessage() call below doesn't
  // resolve until the WHOLE loop finishes (could be minutes), but
  // background.js's tracked run state updates step-by-step as content.js
  // reports progress, independently of that pending promise.
  //
  // expectingRunStart is what makes "immediately" actually true: at this
  // point RUN_AGENT_LOOP has not been sent, so the state still reads
  // active:false and refreshRunState() would otherwise decline to start
  // the timer. That is precisely why Stop never became clickable.
  expectingRunStart = true;
  refreshRunState();
  try {
    const response = await browser.runtime.sendMessage({ type: "RUN_AGENT_LOOP" });
    if (response && response.type === "RUN_AGENT_LOOP_RESULT") {
      agentLoopResultEl.textContent = t("runAgentLoopFinished", [response.outcome, response.totalSteps, response.totalMs]);
    } else if (response && response.type === "RUN_AGENT_LOOP_ERROR") {
      agentLoopResultEl.textContent = t("errorPrefix", [response.error]);
    } else {
      agentLoopResultEl.textContent = t("unexpectedResponse", [JSON.stringify(response)]);
    }
  } catch (err) {
    agentLoopResultEl.textContent = t("failedToReachBackground", [err.message || err]);
  } finally {
    // The run is over (or never started). Clear the flag BEFORE the final
    // refresh so the poll timer is allowed to stop -- otherwise a run that
    // failed to start would leave it polling forever.
    expectingRunStart = false;
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
  stopAgentLoopBtn.textContent = t("stopBtnStopping");
  try {
    const resp = await browser.runtime.sendMessage({ type: "STOP_AGENT_LOOP" });
    if (!resp || resp.ok !== true) {
      agentLoopResultEl.textContent = t("stopRequestFailed", [(resp && resp.error) || "unknown error"]);
    }
  } catch (err) {
    agentLoopResultEl.textContent = t("failedToSendStop", [err.message || err]);
  } finally {
    stopAgentLoopBtn.textContent = originalLabel;
    refreshRunState();
  }
});

// ---------------------------------------------------------------------
// V4b (integration-v2, part B): real consent UI. Replaces V4a's
// window.confirm() -- NEVER alert()/confirm()/prompt() anywhere in this
// file. C4's contract is unchanged: background.js's handleRequestConsent()
// broadcasts CONSENT_REQUEST and enforces its OWN 60s deny-by-default
// timer independently of whatever this popup does (see that function's
// own comment) -- this listener is the "show a human something real"
// half, not the half that guarantees fail-closed. If the popup happens to
// be closed (or closes mid-prompt -- Chrome destroys popup.js's whole
// realm on blur) when/while a CONSENT_REQUEST is outstanding, nothing
// here runs and background.js's own timer is what actually enforces
// deny-by-default; that is correct, unchanged fail-closed behavior.
//
// PRIVACY: the panel shows only ELEMENT DESCRIPTIONS and a translated
// policy reason -- never a raw PII value, never even a raw token string.
// describePendingAction()/describePolicyReason() (extension/lib/
// action-describe.js) are the ONLY formatting path; this file never reads
// `message.action.value` directly for display.
// ---------------------------------------------------------------------
const consentPanelEl = document.getElementById("consentPanel");
const consentActionEl = document.getElementById("consentAction");
const consentReasonEl = document.getElementById("consentReason");
const consentReasonDetailEl = document.getElementById("consentReasonDetail");
const consentCountdownEl = document.getElementById("consentCountdown");
const consentApproveBtn = document.getElementById("consentApprove");
const consentDenyBtn = document.getElementById("consentDeny");

let activeConsentRequestId = null;
let consentCountdownTimer = null;
let consentPreviouslyFocusedEl = null;

function clearConsentCountdown() {
  if (consentCountdownTimer !== null) {
    clearInterval(consentCountdownTimer);
    consentCountdownTimer = null;
  }
}

function hideConsentPanel() {
  clearConsentCountdown();
  activeConsentRequestId = null;
  consentPanelEl.hidden = true;
  // Return focus to wherever it was before the panel interrupted --
  // standard alertdialog-close behavior, and the least surprising thing
  // for a keyboard user mid-task.
  if (consentPreviouslyFocusedEl && typeof consentPreviouslyFocusedEl.focus === "function") {
    try {
      consentPreviouslyFocusedEl.focus();
    } catch (_err) {
      /* the previously-focused element may no longer exist -- fine, nothing to restore to */
    }
  }
  consentPreviouslyFocusedEl = null;
}

async function respondToConsent(approved) {
  const requestId = activeConsentRequestId;
  if (!requestId) return;
  hideConsentPanel(); // hide immediately -- do not wait on the round trip
  try {
    await browser.runtime.sendMessage({ type: "RESPOND_CONSENT", requestId, approved });
  } catch (_err) {
    /* background may have already timed this request out -- nothing more to do */
  }
}

function renderConsentCountdown(remainingMs) {
  const secs = Math.max(0, Math.ceil(remainingMs / 1000));
  consentCountdownEl.textContent = t("consentCountdownText", [secs]);
}

/**
 * Shows the real consent panel for one CONSENT_REQUEST broadcast. Keyboard
 * accessible: focus moves HERE (the panel container, not a specific
 * button -- Enter/Escape are handled on the panel itself so either key
 * works regardless of which control currently has focus), aria-live
 * announces the countdown, and the whole thing is a plain DOM element,
 * never a native dialog.
 */
function showConsentPanel(message) {
  consentPreviouslyFocusedEl = document.activeElement;
  activeConsentRequestId = message.requestId;

  const actionText = describePendingAction(message.action, message.element, t);
  consentActionEl.textContent = actionText.charAt(0).toUpperCase() + actionText.slice(1) + "?";
  consentReasonEl.textContent = describePolicyReason(message.code, t);
  // `message.reason` is policy.js's own internal reason string -- always a
  // static, PII-free sentence by contract (decide()/tightenWithServer()
  // never interpolate a raw value into it; see policy.js's own comments at
  // each return site). Shown as supporting detail under the plain-English
  // headline above, not as a replacement for it.
  consentReasonDetailEl.textContent = message.reason ? t("policyDetailPrefix", [message.reason]) : "";

  const timeoutMs = typeof message.timeoutMs === "number" && message.timeoutMs > 0 ? message.timeoutMs : 60000;
  const deadlineAt = typeof message.deadlineAt === "number" ? message.deadlineAt : Date.now() + timeoutMs;

  clearConsentCountdown();
  renderConsentCountdown(deadlineAt - Date.now());
  consentCountdownTimer = setInterval(() => {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) {
      renderConsentCountdown(0);
      // Local, cosmetic auto-deny -- background.js's OWN 60s timer is what
      // actually guarantees fail-closed (it fires independently and does
      // not wait on this popup being open at all). This just keeps the
      // popup's own UI from sitting open forever showing "0s" if the human
      // never clicked anything and the popup happens to still be focused.
      respondToConsent(false);
      return;
    }
    renderConsentCountdown(remaining);
  }, 250);

  consentPanelEl.hidden = false;
  // Focus the PANEL, not a button -- Enter/Escape are handled at the panel
  // level below, so keyboard support does not depend on which control (if
  // any) the user tabs to next. aria-live="polite" on the countdown node
  // plus role="alertdialog" on the panel itself is what gets this
  // announced by a screen reader the moment it appears.
  consentPanelEl.focus();
}

consentPanelEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    respondToConsent(true);
  } else if (event.key === "Escape") {
    event.preventDefault();
    respondToConsent(false);
  }
});

consentApproveBtn.addEventListener("click", () => respondToConsent(true));
consentDenyBtn.addEventListener("click", () => respondToConsent(false));

browser.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "CONSENT_REQUEST") return undefined;
  showConsentPanel(message);
  // Deliberately does NOT resolve this listener's own promise with the
  // human's answer -- that answer travels back to background.js via its
  // OWN RESPOND_CONSENT message (respondToConsent() above), asynchronously,
  // whenever the human actually clicks something (which may be well after
  // this listener call returns). Returning `undefined` here tells the
  // messaging layer "no response coming through THIS channel", which is
  // correct -- the response comes through a separate message instead.
  return undefined;
});

// ---------------------------------------------------------------------
// C5/C2 amendment (2026-09-26): goal ask-band privacy review. SAME
// pattern as the consent panel above (real panel, never alert/confirm/
// prompt; keyboard-accessible; aria-live) but a SEPARATE panel with the
// OPPOSITE safe default -- "Keep private" here, not "Deny". At most one
// review is ever outstanding at a time: agent-loop-v2.js awaits each
// io.reviewGoalPrivacySpan() call before issuing the next one, so
// requests naturally arrive one at a time, never overlapping.
//
// PRIVACY: `message.text` is the RAW ask-band span text from the user's
// OWN taskGoal, shown here so the human can judge it -- and shown
// NOWHERE else. It is never logged past this render, never stored, and
// this file never forwards it anywhere except back to background.js's
// RESPOND_GOAL_PRIVACY_REVIEW (which does not persist it either -- see
// handleRespondGoalPrivacyReview()'s own comment).
// ---------------------------------------------------------------------
const goalPrivacyPanelEl = document.getElementById("goalPrivacyPanel");
const goalPrivacyActionEl = document.getElementById("goalPrivacyAction");
const goalPrivacyReasonEl = document.getElementById("goalPrivacyReason");
const goalPrivacyCountdownEl = document.getElementById("goalPrivacyCountdown");
const goalPrivacyKeepPrivateBtn = document.getElementById("goalPrivacyKeepPrivate");
const goalPrivacyNotPrivateBtn = document.getElementById("goalPrivacyNotPrivate");

let activeGoalPrivacyRequestId = null;
let goalPrivacyCountdownTimer = null;
let goalPrivacyPreviouslyFocusedEl = null;

function clearGoalPrivacyCountdown() {
  if (goalPrivacyCountdownTimer !== null) {
    clearInterval(goalPrivacyCountdownTimer);
    goalPrivacyCountdownTimer = null;
  }
}

function hideGoalPrivacyPanel() {
  clearGoalPrivacyCountdown();
  activeGoalPrivacyRequestId = null;
  goalPrivacyPanelEl.hidden = true;
  if (goalPrivacyPreviouslyFocusedEl && typeof goalPrivacyPreviouslyFocusedEl.focus === "function") {
    try {
      goalPrivacyPreviouslyFocusedEl.focus();
    } catch (_err) {
      /* the previously-focused element may no longer exist -- fine */
    }
  }
  goalPrivacyPreviouslyFocusedEl = null;
}

async function respondToGoalPrivacyReview(keepPrivate) {
  const requestId = activeGoalPrivacyRequestId;
  if (!requestId) return;
  hideGoalPrivacyPanel(); // hide immediately -- do not wait on the round trip
  try {
    await browser.runtime.sendMessage({ type: "RESPOND_GOAL_PRIVACY_REVIEW", requestId, keepPrivate });
  } catch (_err) {
    /* background may have already timed this request out -- nothing more to do */
  }
}

function renderGoalPrivacyCountdown(remainingMs) {
  const secs = Math.max(0, Math.ceil(remainingMs / 1000));
  goalPrivacyCountdownEl.textContent = t("goalPrivacyCountdownText", [secs]);
}

function showGoalPrivacyPanel(message) {
  goalPrivacyPreviouslyFocusedEl = document.activeElement;
  activeGoalPrivacyRequestId = message.requestId;

  // `message.text` is shown ONLY here -- see this block's own header
  // comment. Never interpolated into a log line, never stored.
  goalPrivacyActionEl.textContent = t("goalPrivacyActionText", [message.text]);
  goalPrivacyReasonEl.textContent = t("goalPrivacyReasonText");

  const timeoutMs = typeof message.timeoutMs === "number" && message.timeoutMs > 0 ? message.timeoutMs : 60000;
  const deadlineAt = typeof message.deadlineAt === "number" ? message.deadlineAt : Date.now() + timeoutMs;

  clearGoalPrivacyCountdown();
  renderGoalPrivacyCountdown(deadlineAt - Date.now());
  goalPrivacyCountdownTimer = setInterval(() => {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) {
      renderGoalPrivacyCountdown(0);
      // Local, cosmetic auto-keep-private -- background.js's OWN 60s
      // timer is what actually guarantees the safe default independent
      // of whether this popup is even open.
      respondToGoalPrivacyReview(true);
      return;
    }
    renderGoalPrivacyCountdown(remaining);
  }, 250);

  goalPrivacyPanelEl.hidden = false;
  goalPrivacyPanelEl.focus();
}

goalPrivacyPanelEl.addEventListener("keydown", (event) => {
  // Both Enter and Escape resolve to the SAFE default (keep private) --
  // unlike the consent panel above, there is no natural "this key means
  // proceed" split here, and a keyboard reflex should never be the thing
  // that declassifies text. "Not private" is reachable only via an
  // explicit click or a focused-button Space/click activation.
  if (event.key === "Enter" || event.key === "Escape") {
    event.preventDefault();
    respondToGoalPrivacyReview(true);
  }
});

goalPrivacyKeepPrivateBtn.addEventListener("click", () => respondToGoalPrivacyReview(true));
goalPrivacyNotPrivateBtn.addEventListener("click", () => respondToGoalPrivacyReview(false));

browser.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "GOAL_PRIVACY_REVIEW_REQUEST") return undefined;
  showGoalPrivacyPanel(message);
  // Same "respond via a separate message, not this listener's return
  // value" pattern as the consent panel above.
  return undefined;
});

// =======================================================================
// V4b: pipeline version toggle (v1/v2). Read on open, written immediately
// on change -- same immediate-write pattern as the full-page-capture
// toggle above. Uses pipeline-version.js's own get/set (the ONE place the
// storage key and default live, per that module's header) rather than
// re-deriving "pipelineVersion" here.
// =======================================================================
const pipelineVersionSelect = document.getElementById("pipelineVersionSelect");
const pipelineVersionStatusEl = document.getElementById("pipelineVersionStatus");

getPipelineVersion(browser.storage.local).then((version) => {
  pipelineVersionSelect.value = version;
});

pipelineVersionSelect.addEventListener("change", async () => {
  const version = pipelineVersionSelect.value;
  try {
    await setPipelineVersion(browser.storage.local, version);
    pipelineVersionStatusEl.textContent = t("pipelineSetTo", [version]);
    pipelineVersionStatusEl.style.color = "var(--pass)";
  } catch (err) {
    pipelineVersionStatusEl.textContent = t("failedToSave", [err.message || err]);
    pipelineVersionStatusEl.style.color = "var(--redact)";
  }
});

// =======================================================================
// V4b: planner backend selector (local/claude/gemini). LOCAL STORAGE ONLY
// -- this never sends anything anywhere, and never sees or stores an API
// key (keys live exclusively in the server's own environment variables,
// set via start-demo.ps1's -Planner parameter). What this DOES do:
//   1. record the operator's intent (chrome.storage.local.plannerBackend),
//      so the popup's own UI reflects and remembers which backend the demo
//      is meant to be running against;
//   2. gate Claude/Gemini behind an EXPLICIT opt-in confirmation checkbox
//      plus a one-line privacy note, satisfying "choosing Claude or Gemini
//      is an explicit opt-in" -- selecting the option alone does not save
//      it; the confirmation must be ticked too.
// It does NOT live-switch the running server process -- VLM_BACKEND_V2 is
// an env var read once at server startup (server/vlm_client.py's
// get_vlm_client_v2()), by design (C4/invariant 4: "no silent cloud
// fallback" -- a backend switch must be an explicit, visible operator
// action, not a background.js fetch call that could silently change what
// a running demo sends where). This selector is the operator-facing half
// of that same explicitness: it's what tells a human "match this to your
// -Planner flag", not a remote control for the server.
// =======================================================================
const PLANNER_BACKEND_STORAGE_KEY = "plannerBackend";
const plannerBackendSelect = document.getElementById("plannerBackendSelect");
const plannerCloudNoteEl = document.getElementById("plannerCloudNote");
const plannerCloudConfirmRow = document.getElementById("plannerCloudConfirmRow");
const plannerCloudConfirmInput = document.getElementById("plannerCloudConfirm");
const savePlannerBackendBtn = document.getElementById("savePlannerBackend");
const plannerBackendStatusEl = document.getElementById("plannerBackendStatus");

function renderPlannerOptInVisibility() {
  const isCloud = plannerBackendSelect.value === "claude" || plannerBackendSelect.value === "gemini";
  plannerCloudNoteEl.classList.toggle("hidden", !isCloud);
  plannerCloudConfirmRow.classList.toggle("hidden", !isCloud);
  if (!isCloud) plannerCloudConfirmInput.checked = false;
}

browser.storage.local.get(PLANNER_BACKEND_STORAGE_KEY).then((stored) => {
  const value = stored && stored[PLANNER_BACKEND_STORAGE_KEY];
  plannerBackendSelect.value = value === "claude" || value === "gemini" ? value : "local";
  renderPlannerOptInVisibility();
});

plannerBackendSelect.addEventListener("change", renderPlannerOptInVisibility);

savePlannerBackendBtn.addEventListener("click", async () => {
  const backend = plannerBackendSelect.value;
  const isCloud = backend === "claude" || backend === "gemini";
  if (isCloud && !plannerCloudConfirmInput.checked) {
    plannerBackendStatusEl.textContent = t("plannerConfirmRequired");
    plannerBackendStatusEl.style.color = "var(--redact)";
    return;
  }
  try {
    await browser.storage.local.set({ [PLANNER_BACKEND_STORAGE_KEY]: backend });
    plannerBackendStatusEl.textContent = isCloud ? t("plannerSavedCloud", [backend]) : t("plannerSavedLocal");
    plannerBackendStatusEl.style.color = "var(--pass)";
  } catch (err) {
    plannerBackendStatusEl.textContent = t("failedToSave", [err.message || err]);
    plannerBackendStatusEl.style.color = "var(--redact)";
  }
});
