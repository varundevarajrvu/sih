// SIH 26171 -- Tier 4 (usable-extension pass), TASK 1 + TASK 2.
//
// PROBLEM THIS SOLVES: the agent loop runs entirely inside content.js (a
// page-context content script), but the ONLY UI surface (popup.html) is
// destroyed every time it loses focus and re-created from scratch on every
// open (CLAUDE.md's own architecture note -- Chrome popups have no
// persistent memory). Something OTHER than the popup has to be the single
// source of truth for "is a run active, which tab, what step, what
// happened last" -- background.js is that something, and this module is
// the pure state-transition logic it uses to manage that state. Kept as a
// separate, DOM/chrome-free module (same pattern as stall-detector.js) so
// the transitions themselves -- not just "does clicking Stop do
// something" -- are actually unit-tested, per the task brief's explicit
// request for "stop-state transitions" coverage.
//
// ARCHITECTURE: a tiny reducer-shaped API over one plain object. Every
// function here is pure (no mutation of its input, no I/O, no chrome.*) --
// background.js owns calling these functions and persisting the result
// (in-memory + chrome.storage.session, see that file's wiring), this
// module only computes what the NEXT state should be.
//
// WHY chrome.storage.session BELONGS TO background.js, NOT HERE: an MV3
// service worker can be evicted and restarted at any point between
// messages (idle timeout, browser decision, ...). If "is a run active"
// lived ONLY in this module's in-memory return values, a SW restart mid-run
// would silently forget a run was ever started -- the Stop button would
// read as disabled (nothing to stop) even though content.js, in the page,
// is still faithfully executing steps. background.js persists every
// transition this module produces to chrome.storage.session (survives SW
// eviction, cleared only when the browser session ends -- exactly the
// right lifetime for "ephemeral, this-browser-session-only run state",
// never written to disk) precisely so a freshly-restarted SW can answer
// GET_RUN_STATE correctly the instant it wakes, without waiting for
// content.js's next progress update. This module has no opinion on WHERE
// its output is stored -- that's deliberately background.js's call, not
// baked in here.
// ---------------------------------------------------------------------------

/**
 * The full shape of one run's tracked state. `step`/`stage`/`lastAction`/
 * `lastBlock`/`lastError` are populated incrementally by applyProgress()
 * patches sent from content.js as the loop actually runs; everything else
 * is set once, at the state-transition boundaries below.
 *
 * @returns {object} a fresh, inactive run state.
 */
export function createRunState() {
  return {
    active: false,
    stopRequested: false,
    tabId: null,
    taskGoal: null,
    step: 0,
    maxSteps: null,
    stage: null,
    // { description: string, action: string, targetId: string } | null
    lastAction: null,
    // { code, reasons: string[], targetId, step, message } | null --
    // TASK 2's "blocked actions prominently" requirement. Deliberately
    // NEVER cleared by a later successful step (see applyProgress below) --
    // it is a record of the most recent refusal, which is exactly the
    // evidence this project's whole thesis rests on, not a transient toast
    // that should vanish the moment something else succeeds.
    lastBlock: null,
    // { summary: string, detail: string, step } | null
    lastError: null,
    // null while active; "done" | "stopped" | "stalled" | one of
    // content.js's existing failure-outcome strings once finished. This
    // module never invents outcome strings of its own -- it only stores
    // whatever content.js's instrumentation already decided (see
    // action-describe.js for how those strings become a human label).
    outcome: null,
    startedAt: null,
    finishedAt: null,
    updatedAt: null,
  };
}

/**
 * Transition: a new run begins. Always produces a FRESH state (never
 * carries over a previous run's step/lastAction/lastBlock/lastError) --
 * starting a new run must never show stale evidence from the last one.
 *
 * @param {string|null} taskGoal
 * @param {{tabId?: number, maxSteps?: number, now?: number}} [opts]
 */
export function startRun(taskGoal, opts = {}) {
  const now = typeof opts.now === "number" ? opts.now : Date.now();
  const state = createRunState();
  state.active = true;
  state.tabId = typeof opts.tabId === "number" ? opts.tabId : null;
  state.taskGoal = typeof taskGoal === "string" ? taskGoal : null;
  state.maxSteps = typeof opts.maxSteps === "number" ? opts.maxSteps : null;
  state.stage = "starting";
  state.startedAt = now;
  state.updatedAt = now;
  return state;
}

/**
 * Transition: merge an incremental progress patch (step/stage/lastAction/
 * lastBlock/lastError/maxSteps/taskGoal/...) sent from content.js as the
 * loop runs. A plain shallow merge -- content.js decides exactly what
 * changed and sends only that; this function has no per-field special
 * logic (including for lastBlock: whether it persists or gets overwritten
 * is entirely up to whether content.js's patch includes that key, not
 * something this reducer decides on the module's behalf).
 *
 * @param {object} state current state (never mutated).
 * @param {object} patch fields to overwrite.
 * @param {{now?: number}} [opts]
 */
export function applyProgress(state, patch, opts = {}) {
  const now = typeof opts.now === "number" ? opts.now : Date.now();
  const base = state && typeof state === "object" ? state : createRunState();
  return { ...base, ...(patch && typeof patch === "object" ? patch : {}), updatedAt: now };
}

/**
 * Transition: a Stop was requested. Idempotent (requesting stop twice is a
 * no-op the second time) and REFUSES to fabricate an active run: if
 * nothing is active, the returned state's `stopRequested` is left exactly
 * as it was (false, on a fresh/finished state) -- the caller (background.js)
 * is expected to check canStop()/`.active` itself and report "nothing to
 * stop" to the popup rather than this function silently inventing a run.
 *
 * @param {object} state
 * @param {{now?: number}} [opts]
 */
export function requestStop(state, opts = {}) {
  const now = typeof opts.now === "number" ? opts.now : Date.now();
  const base = state && typeof state === "object" ? state : createRunState();
  if (!base.active) return { ...base };
  return { ...base, stopRequested: true, updatedAt: now };
}

/**
 * Transition: the run has ended, for any reason (done, stopped, stalled,
 * or one of content.js's failure outcomes). Sets `active: false` -- this
 * is the ONE flag canStop()/isRunningForTab() key off, so a run that ended
 * for ANY reason immediately disables Stop and re-enables "Run Agent Loop".
 *
 * @param {object} state
 * @param {string} outcome
 * @param {{now?: number}} [opts]
 */
export function finishRun(state, outcome, opts = {}) {
  const now = typeof opts.now === "number" ? opts.now : Date.now();
  const base = state && typeof state === "object" ? state : createRunState();
  return { ...base, active: false, stage: "finished", outcome: outcome || base.outcome || null, finishedAt: now, updatedAt: now };
}

/**
 * Popup-facing rule for whether the Stop button should be enabled: a run
 * must be active AND not already have a stop pending (prevents a confusing
 * "double stop" state where clicking again looks like it might do
 * something different).
 *
 * @param {object} state
 * @returns {boolean}
 */
export function canStop(state) {
  return !!(state && state.active === true && state.stopRequested !== true);
}

/**
 * True if `state` represents an active run for exactly this tab. Used by
 * background.js to decide whether a STOP_AGENT_LOOP request (which always
 * targets "the currently tracked run", not an arbitrary tab) has anywhere
 * to be relayed to.
 *
 * @param {object} state
 * @param {number} tabId
 * @returns {boolean}
 */
export function isRunningForTab(state, tabId) {
  return !!(state && state.active === true && state.tabId === tabId);
}
