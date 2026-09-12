// SIH 26171 -- Tier 4 (usable-extension pass), TASK 2.
//
// PROBLEM THIS SOLVES: everything the agent loop does today is legible
// only as raw JSON in the page's DevTools console (action objects,
// ActionExecutionError codes, outcome enum strings) -- a user watching the
// popup has no idea what just happened. This module turns machine shapes
// content.js already has on hand (an action JSON, a domSnapshot to look up
// the target's label in, an outcome string) into short plain-language
// sentences, e.g. "typed into Full name" / "clicked Continue" -- the exact
// phrasing the task brief itself uses as the bar to hit.
//
// ARCHITECTURE (same pattern as stall-detector.js/element-ranker.js): pure
// functions over plain data, zero DOM/chrome dependency, fully
// deterministic, unit-testable in plain Node.
//
// Deliberately NEVER includes a typed `value` in its output -- see
// describeAction()'s doc comment for why that's a safety choice, not an
// omission.
// ---------------------------------------------------------------------------

const MAX_LABEL_LENGTH = 40;

/**
 * Best-effort human label for a domSnapshot node: its visible text if any
 * (truncated so one long paragraph can't blow out the popup layout), else
 * its accessibility role, else its tag name. Never throws on a
 * missing/malformed node.
 *
 * @param {{text?: string, role?: string, tag?: string}|null|undefined} node
 * @returns {string|null}
 */
function labelForNode(node) {
  if (!node || typeof node !== "object") return null;
  const text = typeof node.text === "string" ? node.text.trim() : "";
  if (text) {
    return text.length > MAX_LABEL_LENGTH ? `${text.slice(0, MAX_LABEL_LENGTH - 3)}...` : text;
  }
  if (typeof node.role === "string" && node.role) return node.role;
  if (typeof node.tag === "string" && node.tag) return node.tag;
  return null;
}

/**
 * Plain-language description of one executed (or about-to-execute) action,
 * e.g. "typed into Full name", "clicked Continue", "scrolled the page",
 * "marked the task as done". Looks the target up in `domSnapshot` (the
 * exact array content.js sent to /analyze that step, so the label matches
 * what the model actually saw) by `action.targetId`; falls back to the raw
 * targetId string, then to a generic phrase, if no match is found (a
 * ranked-out or cross-frame node, for instance -- never throws either way).
 *
 * SAFETY NOTE, not an oversight: this function NEVER echoes `action.value`
 * (the text actually typed) into its output, even for a successful,
 * non-sensitive `type` action. The popup is meant to make the LOOP legible
 * ("it's typing into the name field"), not to become a second transcript
 * of every value that ever crossed the wire -- keeping this description
 * value-free means a screenshot of the popup, or the popup's own state
 * persisted to chrome.storage.session, can never itself become a place a
 * value leaks into that wasn't already visible on the page itself.
 *
 * @param {{action?: string, targetId?: string, value?: *}|null} action
 * @param {Array<object>} [domSnapshot] the step's own domSnapshot (post-rank,
 *   post-merge -- whatever content.js actually sent) to resolve a label from.
 * @returns {string}
 */
export function describeAction(action, domSnapshot) {
  if (!action || typeof action.action !== "string") return "performed an action";

  const node =
    Array.isArray(domSnapshot) && action.targetId
      ? domSnapshot.find((n) => n && n.agentId === action.targetId)
      : null;
  const label = labelForNode(node) || (action.targetId && action.targetId !== "page" ? action.targetId : null);

  switch (action.action) {
    case "type":
      return label ? `typed into ${label}` : "typed into a field";
    case "click":
      return label ? `clicked ${label}` : "clicked an element";
    case "scroll":
      return "scrolled the page";
    case "done":
      return "marked the task as done";
    default:
      return label ? `${action.action} on ${label}` : `performed ${action.action}`;
  }
}

// Every outcome string content.js's instrumentation can currently produce
// (createInstrumentation()/runAgentLoop() in content.js), plus "stopped"
// (TASK 1, new in this pass). Kept as an explicit map rather than a
// prettified string-transform (e.g. "act_failed" -> "Act Failed") so the
// wording can be genuinely helpful ("Blocked or failed to act") instead of
// a mechanical relabeling, and so a NEW outcome string added later fails
// visibly (falls through to the default branch below) instead of silently
// rendering something misleading.
const OUTCOME_LABELS = Object.freeze({
  done: { label: "Done", tone: "success" },
  stopped: { label: "Stopped by you", tone: "neutral" },
  stalled: { label: "Stopped: no progress detected", tone: "warning" },
  max_steps_reached: { label: "Stopped: step limit reached", tone: "warning" },
  capture_failed: { label: "Failed: could not capture/detect the page", tone: "error" },
  analyze_failed: { label: "Failed: server request failed", tone: "error" },
  act_failed: { label: "Blocked or failed to act", tone: "error" },
  section5_violation: { label: "Stopped: internal safety check failed", tone: "error" },
  // Not produced by content.js's own instrumentation directly -- this is
  // background.js's own fallback (handleRunAgentLoopFromPopup) for when
  // the content script never returned a recognizable outcome at all (e.g.
  // it threw before runAgentLoop()'s own try/finally could report one, or
  // the tab was closed mid-run).
  failed: { label: "Failed: unexpected error", tone: "error" },
});

/**
 * Human label + a "tone" hint (success/neutral/warning/error, for the
 * popup to color) for a finished run's outcome string. `outcome: null`
 * (still running, or never started) renders as a neutral "In progress".
 * An outcome string this module doesn't recognize is not swallowed -- it
 * renders using ITS OWN raw value as the label (with tone "neutral"), so a
 * future new outcome shows up as literally itself rather than as a blank
 * or a misleading canned phrase.
 *
 * @param {string|null|undefined} outcome
 * @returns {{label: string, tone: "success"|"neutral"|"warning"|"error"}}
 */
export function describeOutcome(outcome) {
  if (!outcome) return { label: "In progress", tone: "neutral" };
  return OUTCOME_LABELS[outcome] || { label: outcome, tone: "neutral" };
}
