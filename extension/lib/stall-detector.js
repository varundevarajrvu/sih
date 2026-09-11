// SIH 26171 -- Phase 4 wiring pass, TASK 3: stall detection.
//
// PROBLEM THIS SOLVES: raising MAX_STEPS from 6 to a realistic budget
// (see content.js) means a misbehaving/looping VLM response can now spin
// for many more steps before the budget alone stops it -- e.g. the model
// re-selecting the same already-filled field over and over, or oscillating
// between clicking two elements that toggle each other with no forward
// progress. A higher ceiling without a stuck-loop detector just means a
// slower, later timeout with the exact same failure mode. This module is
// the detector half of that fix: content.js's own job (not this file's) is
// to record each step's executed action and stop the loop when this module
// says to.
//
// ARCHITECTURE (mirrors this repo's established pure-module pattern --
// element-ranker.js/action-risk.js/frame-coords.js): a pure function over
// plain data, zero DOM/browser dependency, fully deterministic, unit
// testable in plain Node with no extra test dependencies.
//
// WHAT COUNTS AS A STALL, precisely: the tail of the action-signature
// history consists of a short repeating unit (length 1, 2, or 3) repeated
// back-to-back enough times to rule out coincidence -- this covers BOTH
// forms the task brief names:
//   - "the same action on the same target repeatedly" -> a period-1
//     repeat (the same signature N times in a row).
//   - "a cycle of states with no progress" -> a period-2 or period-3
//     repeat (A,B,A,B,... or A,B,C,A,B,C,...), e.g. two elements that each
//     undo what the other one just did.
// Longer/irregular cycles (period > 3, or a cycle that also drifts slightly
// each lap) are NOT detected -- a scope boundary of a cheap, deterministic
// tail-repetition check, not an attempt at general loop/progress
// inference. Flagged rather than silently claimed as exhaustive; MAX_STEPS
// remains the final backstop for exactly this reason.
// ---------------------------------------------------------------------------

/**
 * Build a comparable signature for one executed action, used as the unit
 * this module looks for repetition/cycles across. Deliberately includes
 * `value` (not just action+targetId): two `type` actions on the same field
 * with DIFFERENT values are real progress (e.g. correcting a typo), not a
 * stall, and must not collapse to the same signature.
 *
 * @param {{action?: string, targetId?: string, value?: *}} action
 * @returns {string}
 */
export function actionSignature(action) {
  if (!action || typeof action !== "object") return "invalid";
  const value = action.value === undefined || action.value === null ? "" : String(action.value);
  return [String(action.action), String(action.targetId), value].join(":");
}

// Longest repeating unit this module looks for. 3 covers every cycle shape
// named in the task brief (repeat, ping-pong, 3-way cycle) without
// searching an unbounded space on every step.
export const DEFAULT_STALL_MAX_PERIOD = 3;

// How many back-to-back repeats of a period-p unit are required before
// it counts as a stall, keyed by period. A period-1 repeat (the literal
// same action twice) is legitimate often enough (e.g. paging through a
// "Load more" button) that it needs a 3rd repeat to rule out coincidence;
// an oscillating 2- or 3-cycle has no legitimate everyday equivalent, so
// two full laps are enough to call it.
export const DEFAULT_STALL_MIN_REPEATS_BY_PERIOD = Object.freeze({ 1: 3, 2: 2, 3: 2 });

/**
 * Look at the TAIL of `history` (oldest-first array of action signatures,
 * e.g. built with actionSignature() and pushed once per executed step) and
 * report whether it ends in a repeating unit long/frequent enough to call
 * a stall. Checks the shortest period first (1, then 2, then 3) so a
 * literal immediate repeat is reported as period 1, not misread as a
 * longer coincidental cycle.
 *
 * Pure and stateless -- callers own the history array and decide what to
 * do with the result (content.js: stop the loop, record a distinct
 * "stalled" outcome). This function never mutates its input and never
 * throws on a short/empty history -- it simply reports "no stall found
 * (yet)".
 *
 * @param {string[]} history oldest-first action signatures.
 * @param {{maxPeriod?: number, minRepeatsByPeriod?: Record<number, number>}} [options]
 * @returns {{ period: number, pattern: string[], repeats: number, windowSize: number } | null}
 */
export function detectStall(history, options = {}) {
  if (!Array.isArray(history) || history.length === 0) return null;

  const maxPeriod = Number.isInteger(options.maxPeriod) && options.maxPeriod > 0
    ? options.maxPeriod
    : DEFAULT_STALL_MAX_PERIOD;
  const minRepeatsByPeriod = options.minRepeatsByPeriod || DEFAULT_STALL_MIN_REPEATS_BY_PERIOD;

  for (let period = 1; period <= maxPeriod; period++) {
    const minRepeats = minRepeatsByPeriod[period] || 2;
    const windowSize = period * minRepeats;
    if (history.length < windowSize) continue;

    const tail = history.slice(history.length - windowSize);
    const unit = tail.slice(0, period);
    let matches = true;
    for (let i = period; i < windowSize; i++) {
      if (tail[i] !== unit[i % period]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return { period, pattern: unit, repeats: minRepeats, windowSize };
    }
  }
  return null;
}
