// SIH 26171 -- Tier 2, element-ranker.js
//
// rankElements(domSnapshot, taskGoal, options?) -> { selected, dropped, scores }
//
// PROBLEM THIS SOLVES: the pipeline documented in CLAUDE.md (Phases 1-4)
// was built and demoed against a 5-element page. A real site's
// `domSnapshot` (built by extension/lib/action-executor.js's
// buildDomSnapshot() -- Phase 3, READ-ONLY reference for this file, not
// touched here) commonly has hundreds of actionable/flagged nodes.
// Sending all of them to /analyze on every single step: (a) balloons the
// JSON payload sent over the wire on every step of the agent loop, (b)
// burns VLM input tokens on elements the current task goal has nothing to
// do with, and (c) forces the model to pick one agentId out of a
// haystack, which plausibly hurts targeting accuracy on top of raw cost.
// rankElements() is a budget-aware filter meant to sit between the
// sensitive-flag merge step and the POST /analyze call in whichever
// module owns that loop (Phase 4 territory -- NOT this file. See "HOW TO
// CONSUME THIS MODULE" at the bottom).
//
// ARCHITECTURE (mirrors dom-scanner.js's and action-executor.js's
// pattern, per this repo's established style):
//   - rankElements() is a PURE FUNCTION: (DomNode[], string, options) ->
//     { selected, dropped, scores }. It never reads `document`/`window`,
//     never imports a DOM-parsing library (it doesn't need one -- the
//     input is already plain JSON, not HTML), and is fully deterministic:
//     no Math.random anywhere in this file. Ties in the ranking are
//     broken by original array index, not by relying on
//     Array.prototype.sort's stability guarantee -- so behaviour doesn't
//     depend on which JS engine runs it.
//   - Every tunable (maxElements, weights, viewport) is an injectable
//     option with a documented, justified default, exactly like
//     dom-scanner.js's getBBox/getAgentId and action-executor.js's
//     isSensitive/scrollWindowBy injection pattern.
//   - Input shape matches server/schemas.py's DomNode field-for-field:
//     { agentId, tag, role, type, text, bbox:{x,y,w,h}, sensitive } --
//     the exact shape action-executor.js's buildDomSnapshot() produces
//     once Phase 4's merge step has stamped real `sensitive` values in
//     (see CLAUDE.md's Phase 1 RESULT, "2a classifies, 3 enumerates", and
//     the Phase 4 RESULT's merge-step wiring). This module trusts
//     `sensitive` completely and never re-derives PII classification
//     itself -- that is dom-scanner.js's job, not this file's.
//   - Needs ZERO test dependencies: unlike dom-scanner.js/action-executor.js,
//     there is no HTML to parse here, so tests/unit/test_element_ranker.mjs
//     does not need jsdom at all.
//
// -----------------------------------------------------------------------
// THE ONE RULE THIS FILE MUST NEVER BREAK (task brief, verbatim):
//   Nodes with `sensitive: true` MUST ALWAYS be retained in the output,
//   regardless of score, regardless of budget. They are not candidate
//   targets to be ranked against everything else -- they are load-bearing
//   for two mechanisms outside this file: server/schemas.py's
//   find_pii_leaks() (needs every sensitive node present in domSnapshot to
//   correlate a leak against redactedRegions) and action-executor.js's
//   sensitive-target guard (needs to see `sensitive: true` -- or the
//   `data-agent-sensitive` attribute it's mirrored from -- on a node to
//   know to refuse acting on it; see that file's guardSensitive() /
//   defaultIsSensitive()). Silently dropping a sensitive node to stay
//   under a token budget would raise no error anywhere downstream -- the
//   guard would simply never learn the node exists and would have nothing
//   to block, and the server-side correlation would have nothing to
//   correlate against. That is a SILENT PRIVACY REGRESSION, not a
//   performance trade-off, and every test written against the wrong
//   assumption would still pass. See the safety override applied in
//   rankElements() below, and
//   tests/unit/test_element_ranker.mjs's "sensitive nodes survive at the
//   lowest possible score and the tightest possible budget" test -- that
//   test is the actual guarantee, this comment is not.
// -----------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Defaults.
// ---------------------------------------------------------------------------

// 40 was chosen as "enough to cover essentially every field of a realistic
// multi-step form plus primary navigation/CTAs, while keeping the /analyze
// payload roughly bounded" -- a DomNode averages well under 200 bytes of
// JSON, so 40 of them is a few KB, not a page-scale payload. Real sites
// with "hundreds" of actionable elements (the brief's own framing) are
// exactly the case this default exists to cut down; a 5-element demo page
// never triggers it at all (see the "under budget -> unchanged" branch in
// rankElements()). Override via options.maxElements when a caller has
// measured its own token budget more precisely.
export const DEFAULT_MAX_ELEMENTS = 40;

// A reasonable desktop-viewport fallback for options.viewport when the
// caller doesn't pass real chrome.tabs-measured dimensions. Only affects
// the viewport-position signal's accuracy, never crashes or throws when
// absent -- see viewportScore()'s NEUTRAL fallback for bbox-less nodes.
export const DEFAULT_VIEWPORT = Object.freeze({ width: 1280, height: 800 });

// ---------------------------------------------------------------------------
// SCORING WEIGHTS -- justified, not just asserted.
//
//   text       0.40  Task-goal term overlap is the single strongest
//                     predictor of "does the VLM actually need this
//                     element to complete THIS task." A page can have 200
//                     actionable elements and only 3 that mention "email"
//                     when the goal is "fill in my email" -- this is the
//                     exact signal the whole module exists to act on, so
//                     it gets the largest single weight: larger than all
//                     four structural signals below would sum to even if
//                     every one of them maxed out.
//   kind       0.25  Among elements that are roughly equally relevant by
//                     text, form controls and buttons are overwhelmingly
//                     more likely to be the actual next target than a
//                     plain navigational <a> -- an agent executing a task
//                     interacts with inputs/buttons far more often than it
//                     follows an arbitrary link. Second-largest weight
//                     because it's a strong but coarser signal than text
//                     overlap (it knows inputs beat links in general, not
//                     WHICH input matters for this specific goal).
//   viewport   0.15  An element the vision half of the pipeline can't see
//                     this step (below the fold -- see CLAUDE.md's
//                     documented captureVisibleTab viewport-only
//                     limitation) has no visual grounding in the
//                     screenshot the VLM is looking at right now. Real
//                     signal, but weighted below kind/text: a currently
//                     off-screen field the task goal explicitly names
//                     (e.g. a submit button one scroll away) can still be
//                     exactly what's needed next, so scoring it near-zero
//                     instead of merely de-prioritized would fight the
//                     agent's own upcoming scroll action rather than help
//                     it.
//   size       0.10  Vanishingly small elements (1x1 tracking pixels,
//                     collapsed/hidden spacers that still technically
//                     match action-executor.js's ACTIONABLE_SELECTOR) are
//                     almost never real interaction targets. Real but weak
//                     signal on its own -- plenty of legitimate targets
//                     are small (icon-only close/menu buttons), so it
//                     isn't allowed to dominate; it mainly exists to sink
//                     junk elements that would otherwise score
//                     respectably on kind alone (e.g. a 0x0 <button>).
//   proximity  0.10  An element sitting near another high-scoring element
//                     is often part of the same functional cluster (a
//                     label beside its input, a quantity stepper beside an
//                     "Add to cart" button) -- a weak positive correlation,
//                     not a certainty, so it gets the smallest weight and
//                     acts mainly as a tie-breaker / cluster nudge rather
//                     than a primary ranking signal.
//
// Weights sum to 1.0; every component score below is normalized to
// roughly [0, 1] (see each score function's own comments for its specific
// floor/neutral value), so the combined score is directly comparable
// across nodes regardless of which signals fired for each of them.
// ---------------------------------------------------------------------------
export const DEFAULT_WEIGHTS = Object.freeze({
  text: 0.40,
  kind: 0.25,
  viewport: 0.15,
  size: 0.10,
  proximity: 0.10,
});

// Neutral/floor constants used across the score functions below. Pulled
// out to one place so the relative ordering between "no data" (neutral),
// "known bad" (low), and "known good" is visible at a glance rather than
// buried as magic numbers scattered through each function.
const NEUTRAL_TEXT_SCORE = 0.5; // no taskGoal terms to compare against
const NEUTRAL_VIEWPORT_SCORE = 0.4; // no bbox geometry available at all
const NEUTRAL_SIZE_SCORE = 0.5; // no bbox geometry available at all
const NEUTRAL_PROXIMITY_SCORE = 0.4; // no bbox geometry available at all
const COLLAPSED_ELEMENT_VIEWPORT_SCORE = 0.05; // bbox present but zero-area (display:none-ish)
const OFFSCREEN_ELEMENT_VIEWPORT_SCORE = 0.1; // real geometry, but currently outside the viewport
const LOW_VALUE_KIND_SCORE = 0.35; // generic actionable element, not a form control/button/link

// ~6400px^2: a normal single-line <input> or <button> at common web
// font/padding sizes (e.g. ~40px tall x ~160px wide). Used as the "this is
// a typical, plausible interaction target" reference point for sizeScore().
const TYPICAL_ELEMENT_AREA_PX2 = 40 * 160;

// "Nearby" scale for proximityScoreFor(): a label+input pair or adjacent
// toolbar buttons are typically well under this many CSS pixels apart;
// unrelated sections of a page are typically well beyond it.
const PROXIMITY_RADIUS_PX = 150;

// Anchor set for the proximity pass: the top ANCHOR_FRACTION of
// candidates by base score (never fewer than MIN_ANCHORS, capped at the
// candidate count). See selectAnchors() for why anchors are computed from
// PRE-proximity scores only.
const ANCHOR_FRACTION = 0.2;
const MIN_ANCHORS = 3;

// ---------------------------------------------------------------------------
// Text relevance.
// ---------------------------------------------------------------------------

// Small, deliberately conservative stopword list: common English function
// words plus a handful of verbs/fillers that show up constantly in
// taskGoal phrasing ("fill", "enter", "set", "please", "as", "field",
// "value", "into") which would otherwise inflate goalTermSet with terms
// that match almost every node and dilute the real signal. Node-side text
// is filtered through the same list for symmetry -- otherwise a node
// containing the literal word "field" would get free credit against a
// goal that also happens to contain it for unrelated reasons.
const STOPWORDS = new Set([
  "a", "an", "the", "to", "of", "in", "on", "for", "with", "and", "or",
  "is", "are", "this", "that", "it", "its", "your", "you", "i", "my", "me",
  "please", "enter", "fill", "set", "as", "field", "value", "into", "from",
]);

function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Task-goal term overlap for one node. `goalTermSet` is precomputed once
 * per rankElements() call (tokenizing the same taskGoal string per node
 * would be wasted, non-deterministic-feeling work at scale).
 *
 * Exact token matches count fully; a substring match between a goal term
 * and a node term counts as half credit -- this catches near-misses exact
 * tokenization alone can't (plural/singular drift like "password" vs
 * "passwords", or a longer compound term containing the goal term) without
 * inflating the score as much as an exact hit would.
 */
function textRelevanceScore(node, goalTermSet) {
  if (goalTermSet.size === 0) return NEUTRAL_TEXT_SCORE;
  const surface = [node && node.text, node && node.role, node && node.type]
    .filter(Boolean)
    .join(" ");
  const nodeTerms = new Set(tokenize(surface));
  if (nodeTerms.size === 0) return 0;

  let hits = 0;
  for (const goalTerm of goalTermSet) {
    if (nodeTerms.has(goalTerm)) {
      hits += 1;
      continue;
    }
    for (const nodeTerm of nodeTerms) {
      if (
        nodeTerm.length > 2 &&
        goalTerm.length > 2 &&
        (nodeTerm.includes(goalTerm) || goalTerm.includes(nodeTerm))
      ) {
        hits += 0.5;
        break;
      }
    }
  }
  return Math.min(1, hits / goalTermSet.size);
}

// ---------------------------------------------------------------------------
// Element kind.
// ---------------------------------------------------------------------------

const KIND_SCORE_BY_TAG = Object.freeze({
  input: 1.0,
  textarea: 1.0,
  select: 1.0,
  button: 1.0,
});

// Mirrors action-executor.js's ACTIONABLE_SELECTOR role list -- these are
// interactive-by-declaration even when the underlying tag is generic
// (e.g. a <div role="button">).
const HIGH_VALUE_ROLES = new Set([
  "button", "checkbox", "radio", "switch", "textbox", "combobox",
  "menuitem", "option", "tab", "slider", "searchbox",
]);

function elementKindScore(node) {
  const tag = ((node && node.tag) || "").toLowerCase();
  if (Object.prototype.hasOwnProperty.call(KIND_SCORE_BY_TAG, tag)) {
    return KIND_SCORE_BY_TAG[tag];
  }
  const role = ((node && node.role) || "").toLowerCase();
  if (HIGH_VALUE_ROLES.has(role)) return 0.9;
  if (tag === "a" || role === "link") return 0.5;
  // Generic actionable element: [onclick]/[tabindex]/[contenteditable]
  // per action-executor.js's ACTIONABLE_SELECTOR catch-all.
  return LOW_VALUE_KIND_SCORE;
}

// ---------------------------------------------------------------------------
// Viewport position / visibility.
// ---------------------------------------------------------------------------

/**
 * `viewport` is `{width, height}` in the SAME pixel space as `node.bbox`
 * (CSS px is the natural choice, matching getBoundingClientRect() and
 * action-executor.js's defaultGetBBox() -- see the "HOW TO CONSUME"
 * section at the bottom for why this module doesn't care which pixel
 * space is used as long as it's consistent).
 */
function viewportScore(node, viewport) {
  const bbox = node && node.bbox;
  if (!bbox || typeof bbox.x !== "number" || typeof bbox.y !== "number") {
    // No geometry at all (e.g. a non-browser test fixture, or a bbox that
    // was never populated) -- don't punish or reward, we simply don't know.
    return NEUTRAL_VIEWPORT_SCORE;
  }
  const w = typeof bbox.w === "number" ? bbox.w : 0;
  const h = typeof bbox.h === "number" ? bbox.h : 0;
  if (w <= 0 || h <= 0) {
    // Zero-area boxes are almost always display:none/collapsed elements
    // that still happen to match the actionable-element selector, not a
    // real on-screen target this step.
    return COLLAPSED_ELEMENT_VIEWPORT_SCORE;
  }

  const vw = (viewport && viewport.width) || DEFAULT_VIEWPORT.width;
  const vh = (viewport && viewport.height) || DEFAULT_VIEWPORT.height;
  const overlapW = Math.max(0, Math.min(bbox.x + w, vw) - Math.max(bbox.x, 0));
  const overlapH = Math.max(0, Math.min(bbox.y + h, vh) - Math.max(bbox.y, 0));
  const overlapArea = overlapW * overlapH;
  if (overlapArea <= 0) {
    // Below/above/beside the fold right now. Not scored to zero: the same
    // MAX_STEPS loop (CLAUDE.md Phase 4) can scroll next step, and an
    // element the task goal explicitly names shouldn't be discarded just
    // because it isn't visible on THIS particular capture.
    return OFFSCREEN_ELEMENT_VIEWPORT_SCORE;
  }
  const nodeArea = w * h;
  const visibleFraction = Math.min(1, overlapArea / nodeArea);
  return 0.2 + 0.8 * visibleFraction;
}

// ---------------------------------------------------------------------------
// Element size.
// ---------------------------------------------------------------------------

function sizeScore(node) {
  const bbox = node && node.bbox;
  if (!bbox || typeof bbox.w !== "number" || typeof bbox.h !== "number") {
    return NEUTRAL_SIZE_SCORE;
  }
  const area = Math.max(0, bbox.w) * Math.max(0, bbox.h);
  if (area <= 0) return 0;
  // sqrt rather than linear: a typical-sized element (ratio 1) maxes the
  // score, and shrinking below typical size degrades gently rather than
  // punishing legitimately-small-but-real targets (icon-only buttons) as
  // harshly as a linear falloff would. Elements well above typical size
  // (large banners, background containers that happen to be actionable)
  // clamp at 1 rather than being rewarded for being big.
  const ratio = area / TYPICAL_ELEMENT_AREA_PX2;
  return Math.max(0, Math.min(1, Math.sqrt(ratio)));
}

// ---------------------------------------------------------------------------
// Proximity to other high-scoring elements.
// ---------------------------------------------------------------------------

function bboxCenter(node) {
  const bbox = node && node.bbox;
  if (!bbox || typeof bbox.x !== "number" || typeof bbox.y !== "number") return null;
  const w = typeof bbox.w === "number" ? bbox.w : 0;
  const h = typeof bbox.h === "number" ? bbox.h : 0;
  return { x: bbox.x + w / 2, y: bbox.y + h / 2 };
}

/**
 * Anchors are chosen from PRE-proximity ("base") scores only, on purpose:
 * if a node's own proximity term fed back into who counts as an anchor,
 * the anchor set would be circular/unstable (node A is an anchor because
 * it's near B, which is an anchor because it's near A) for no accuracy
 * benefit -- proximity is meant to be a small nudge derived from
 * genuinely-independent relevance signals, not a self-reinforcing loop.
 */
function selectAnchors(entries) {
  if (entries.length === 0) return [];
  const sorted = entries.slice().sort((a, b) => {
    if (b.base !== a.base) return b.base - a.base;
    return a.index - b.index; // deterministic tie-break
  });
  const count = Math.min(sorted.length, Math.max(MIN_ANCHORS, Math.ceil(sorted.length * ANCHOR_FRACTION)));
  return sorted.slice(0, count);
}

function proximityScoreFor(node, index, anchors) {
  const center = bboxCenter(node);
  if (!center) return NEUTRAL_PROXIMITY_SCORE;
  let best = 0;
  for (const anchor of anchors) {
    if (anchor.index === index) continue; // a node can't anchor itself
    const anchorCenter = bboxCenter(anchor.node);
    if (!anchorCenter) continue;
    const d = Math.hypot(center.x - anchorCenter.x, center.y - anchorCenter.y);
    const contribution = 1 / (1 + d / PROXIMITY_RADIUS_PX);
    if (contribution > best) best = contribution;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------

function normalizeMaxElements(value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return DEFAULT_MAX_ELEMENTS;
}

function round(n, decimals) {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} DomNode
 * @property {string} agentId
 * @property {string} tag
 * @property {?string} role
 * @property {?string} type
 * @property {?string} text
 * @property {?{x:number,y:number,w:number,h:number}} bbox
 * @property {boolean} sensitive
 */

/**
 * Score and select the most task-relevant subset of a domSnapshot.
 *
 * @param {DomNode[]} domSnapshot
 * @param {string} taskGoal
 * @param {{
 *   maxElements?: number,
 *   viewport?: {width:number, height:number},
 *   weights?: Partial<typeof DEFAULT_WEIGHTS>,
 * }} [options]
 * @returns {{
 *   selected: DomNode[],
 *   dropped: number,
 *   scores?: Array<{agentId: string, score: number, sensitive: boolean, kept: boolean}>,
 * }}
 *   `scores` is present whenever ranking actually ran (i.e. the snapshot
 *   was over budget); it is omitted on the unchanged/under-budget
 *   passthrough since nothing was scored. Sorted by score descending.
 *   `dropped` is domSnapshot.length - selected.length -- log it; a caller
 *   that silently truncates and never reports this number reads as "the
 *   agent covered the whole page" when it didn't.
 */
export function rankElements(domSnapshot, taskGoal, options = {}) {
  if (!Array.isArray(domSnapshot)) {
    throw new TypeError(
      "rankElements(domSnapshot, taskGoal, options): domSnapshot must be an array of DomNode-shaped objects"
    );
  }

  const maxElements = normalizeMaxElements(options.maxElements);

  // Already under budget -- return unchanged. No scoring work is wasted,
  // and (as important) no caller can be misled into thinking anything was
  // dropped or reordered when nothing was.
  if (domSnapshot.length <= maxElements) {
    return { selected: domSnapshot.slice(), dropped: 0 };
  }

  const weights = { ...DEFAULT_WEIGHTS, ...(options.weights || {}) };
  const viewport = { ...DEFAULT_VIEWPORT, ...(options.viewport || {}) };
  const goalTermSet = new Set(tokenize(taskGoal));

  // Pass 1: every per-node component score, plus a "base" score that
  // excludes proximity (proximity needs a fixed anchor set derived from
  // this pass -- see selectAnchors()).
  const entries = domSnapshot.map((node, index) => {
    const textS = textRelevanceScore(node, goalTermSet);
    const kindS = elementKindScore(node);
    const viewportS = viewportScore(node, viewport);
    const sizeS = sizeScore(node);
    const base =
      weights.text * textS +
      weights.kind * kindS +
      weights.viewport * viewportS +
      weights.size * sizeS;
    return { node, index, textS, kindS, viewportS, sizeS, base };
  });

  // Pass 2: proximity boost using an anchor set fixed from pass 1.
  const anchors = selectAnchors(entries);
  for (const entry of entries) {
    entry.proximityS = proximityScoreFor(entry.node, entry.index, anchors);
    entry.score = entry.base + weights.proximity * entry.proximityS;
  }

  // ---------------------------------------------------------------------
  // SAFETY OVERRIDE -- see the file-header rule. Sensitive nodes are
  // scored above (purely for observability: it lets the caller's logs
  // show "this sensitive node scored lowest in the whole set and was kept
  // anyway", which is a direct, checkable demonstration of the guarantee
  // rather than an assertion about it) but their inclusion in `selected`
  // is NOT a function of that score. They are partitioned out BEFORE the
  // budget is applied to the remaining candidates, and unioned back in
  // unconditionally afterward.
  // ---------------------------------------------------------------------
  const sensitiveEntries = entries.filter((e) => e.node && e.node.sensitive === true);
  const candidateEntries = entries.filter((e) => !(e.node && e.node.sensitive === true));

  candidateEntries.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index; // deterministic tie-break, independent of sort stability
  });

  // If there are more sensitive nodes than the whole budget, ALL of them
  // still ship -- `selected.length` can exceed `maxElements` in that case.
  // That is intentional: the safety rule overrides the budget, not the
  // other way around. remainingBudget is clamped at 0, never negative.
  const remainingBudget = Math.max(0, maxElements - sensitiveEntries.length);
  const selectedCandidateEntries = candidateEntries.slice(0, remainingBudget);

  const selectedIndexSet = new Set([
    ...sensitiveEntries.map((e) => e.index),
    ...selectedCandidateEntries.map((e) => e.index),
  ]);

  // Preserve original domSnapshot order in the output (easier to diff
  // against the input, and downstream consumers iterate naturally).
  const selected = domSnapshot.filter((_, i) => selectedIndexSet.has(i));
  const dropped = domSnapshot.length - selected.length;

  const scores = entries
    .map((e) => ({
      agentId: e.node && e.node.agentId,
      score: round(e.score, 4),
      sensitive: !!(e.node && e.node.sensitive),
      kept: selectedIndexSet.has(e.index),
    }))
    .sort((a, b) => b.score - a.score);

  return { selected, dropped, scores };
}

// ---------------------------------------------------------------------------
// Exposed for testing / advanced callers -- not required for normal use.
// ---------------------------------------------------------------------------
export const _internal = {
  tokenize,
  textRelevanceScore,
  elementKindScore,
  viewportScore,
  sizeScore,
  bboxCenter,
  selectAnchors,
  proximityScoreFor,
};

// ---------------------------------------------------------------------------
// HOW TO CONSUME THIS MODULE (for whichever agent wires content.js / the
// agent loop -- not done by this file):
//
//   import { rankElements } from "./element-ranker.js";
//   // or, if this repo's dynamic-import-for-ES-module-libs pattern
//   // (CLAUDE.md's Phase 4 RESULT #1 -- dom-scanner.js/redaction.js are
//   // loaded this way, since MV3's declarative content_scripts array has
//   // no `type:"module"` option on any Chrome version) applies here too:
//   const { rankElements } = await import(chrome.runtime.getURL("lib/element-ranker.js"));
//
//   Call this AFTER the sensitive-flag merge step -- domSnapshot nodes
//   must already carry real `sensitive` values (this module trusts that
//   flag completely and never re-derives PII classification) -- and
//   BEFORE POSTing the payload to /analyze:
//
//     const { selected, dropped, scores } = rankElements(domSnapshot, taskGoal, {
//       maxElements: 40,                                        // optional
//       viewport: { width: window.innerWidth, height: window.innerHeight }, // optional, recommended
//     });
//     if (dropped > 0) {
//       console.log(`[element-ranker] dropped ${dropped} of ${domSnapshot.length} elements`, scores);
//     }
//     // send `selected` as the domSnapshot in the /analyze request body,
//     // in place of the full array.
//
//   Pixel space: this module doesn't care whether bboxes are CSS px or
//   screenshot px (scoring is relative/comparative, not absolute) AS LONG
//   AS `options.viewport` is given in the SAME units as the bboxes you
//   pass. CLAUDE.md's Phase 2b ruling says every bbox crossing a module
//   boundary to the SERVER must be screenshot-px (devicePixelRatio-scaled)
//   -- this module can run either before or after that scaling step; just
//   don't mix scaled bboxes with an unscaled viewport or vice versa.
//
//   `scores` is for logging/debugging only -- never part of
//   server/schemas.py's AnalyzeRequest and should not be sent to
//   /analyze.
// ---------------------------------------------------------------------------
