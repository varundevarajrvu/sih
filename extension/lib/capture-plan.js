// SIH 26171 -- full-page scroll-and-stitch capture: PURE planning/geometry
// math only. No `chrome.*`, no `window`/`document`, no canvas, no timers --
// everything that actually scrolls the page, calls captureVisibleTab, or
// draws on a canvas lives in content.js/background.js (see those files'
// own "FULL-PAGE CAPTURE" block comments for the browser-only half). This
// split mirrors frame-coords.js exactly (pure arithmetic module, unit
// tested with plain JS objects, zero browser API surface) and is why both
// are testable under plain `node --test` with no extension runtime.
//
// Loaded via dynamic `import()` from content.js/background.js (see either
// file's `loadLibModules()`/`loadHelperLibs()`), same pattern as every
// other ES-module lib file in this codebase (dom-scanner.js, redaction.js,
// frame-coords.js, element-ranker.js, action-risk.js, stall-detector.js) --
// MV3's declarative `content_scripts` array has no `type:"module"` option,
// so a classic script/service worker uses a runtime `import()` expression
// instead of a static `import` declaration. Listed in manifest.json's
// `web_accessible_resources` for the content-script side, exactly like
// its siblings.
//
// ===========================================================================
// THE COORDINATE PROBLEM THIS MODULE EXISTS TO SOLVE, STATED PRECISELY
// ===========================================================================
// Before this feature, exactly ONE screenshot existed per step
// (`chrome.tabs.captureVisibleTab`), and it was ALWAYS a capture of
// whatever the CURRENT viewport showed. `getBoundingClientRect()` is
// viewport-relative by definition -- so a viewport-relative bbox and a
// viewport screenshot were ALREADY in the same coordinate space, with zero
// document-scroll adjustment ever needed. That is why `content.js` (before
// this pass) never mentions `scrollX`/`scrollY` anywhere in its bbox
// pipeline: there was nothing to add.
//
// A STITCHED full-page image breaks that equivalence. The stitched image
// is DOCUMENT-relative (row 0 of the image is the top of the whole page,
// not the top of whatever the user happened to be scrolled to). A DOM
// scan's bboxes are still viewport-relative, exactly as before. To place a
// DOM-sourced bbox correctly on the stitched image, the page's own
// scroll position AT THE MOMENT THAT BBOX WAS MEASURED must be added to it
// -- exactly once. See `addDocumentOffset()`/`addDocumentOffsetToNodes()`
// below.
//
// THE FULL, MANDATORY TRANSFORM ORDER (binding on content.js -- see its own
// "FULL-PAGE CAPTURE" block comment for exactly where each step is applied,
// and CLAUDE.md TIER 1's pre-existing Ruling this extends):
//
//   1. FRAME OFFSET (frame-coords.js, pre-existing, UNCHANGED by this
//      module) -- subframe-local CSS px -> top-frame VIEWPORT-relative CSS
//      px. Applied ONLY to subframe-sourced nodes, once, at merge. Top-
//      frame-native nodes skip this step entirely (they're already in this
//      space).
//   2. DOCUMENT OFFSET (THIS module, NEW) -- top-frame VIEWPORT-relative
//      CSS px -> top-frame DOCUMENT-relative CSS px, by adding the TOP
//      FRAME's own {scrollX, scrollY} AS READ AT THE MOMENT THE DOM SCAN
//      RAN (never re-read later -- see content.js's `domScanScrollOffset`
//      capture point). Applied to the WHOLE merged set (subframe nodes
//      included -- after step 1 they are already top-frame-viewport-
//      relative, so ONE top-frame scroll offset covers native AND
//      subframe-merged nodes alike; there is no such thing as a
//      "subframe's own scroll offset" at this stage, only the top frame's).
//      SKIPPED ENTIRELY (mathematically: offset = {x:0,y:0}, via the
//      `NO_DOCUMENT_OFFSET` constant below) when full-page capture is OFF,
//      because a single-viewport screenshot is already viewport-relative
//      and adding anything would misplace every redaction rectangle on the
//      one configuration this project's whole existing test suite already
//      verifies pixel-for-pixel.
//   3. DEVICE PIXEL RATIO (pre-existing Ruling 2, UNCHANGED by this
//      module) -- CSS px -> image px, applied once, uniformly, to whatever
//      position value steps 1-2 produced.
//
// Steps 1 and 3 are UNTOUCHED by this pass -- this module adds exactly one
// new step, in the middle, and documents where the existing two remain.
//
// ---------------------------------------------------------------------------
// WHY THIS IS A SEPARATE STEP FROM DPR SCALING, NOT FOLDED INTO IT
// ---------------------------------------------------------------------------
// Frame offset and document offset are both POSITION-REFERENCE-FRAME
// changes (subframe viewport -> top viewport -> top document) -- pure
// addition, no scale. DPR is a SCALE change (CSS px -> device px),
// unconditional and uniform. Folding "sometimes add scrollY, always
// multiply by DPR" into one function would make it trivially easy to
// apply one but not the other, or to apply the addition AFTER the
// multiplication (which would add scrollY in the WRONG unit -- scrollY is
// read in CSS px, so it must be added before the CSS->device-px multiply,
// not after). Keeping them as two separate, single-purpose, sequentially-
// applied pure functions -- exactly the shape frame-coords.js already
// established for step 1 -- is what makes the ORDER auditable by reading
// content.js's call sites top to bottom, and what the wiring test below
// (`describe("double-application...")`) actually exercises: this module
// has no internal state that could accidentally apply itself twice, but
// content.js could still call it twice by mistake -- the test proves what
// that mistake would produce, so a reviewer (or a future edit) has a
// concrete, wrong number to compare against, not just a written warning.
//
// ---------------------------------------------------------------------------
// FAIL LOUD, NOT WRONG (same policy as frame-coords.js, restated here on
// purpose rather than only cross-referenced): `addDocumentOffset()` refuses
// a missing/non-finite offset rather than defaulting to {x:0,y:0} silently.
// Callers that mean "no offset" (viewport-only mode) must pass the
// exported `NO_DOCUMENT_OFFSET` constant EXPLICITLY -- an intentional,
// named, reviewable value, never an implicit fallback. A silently-zeroed
// offset in full-page mode would place a redaction rectangle at the wrong
// pixels while looking like it worked -- exactly the failure class this
// whole feature was commissioned to avoid, per the delegation brief:
// "Get the order or the count wrong and redaction rectangles land on the
// wrong pixels while appearing to work."
// ===========================================================================

// Default cap on total captured viewports per full-page capture pass. ~5 is
// chosen deliberately, not arbitrarily:
//   - Memory: N full-resolution PNGs (each already device-px sized, e.g.
//     ~1MB+ decoded per slice on a HiDPI laptop screen) plus one stitched
//     canvas of up to N times that height held live at once. 5 keeps peak
//     memory in the tens-of-MB range (see content.js's own instrumentation
//     for measured numbers), not hundreds.
//   - Latency: a stitched image is proportionally larger, and Phase 0's own
//     findings show this detector's inference time is sensitive to input
//     size. 5 viewports covers the overwhelming majority of realistic
//     forms/checkouts (CLAUDE.md's own 14-step Indian-checkout walkthrough
//     fits in well under 5 screen-heights on a normal display) while
//     bounding a pathological long/infinite-scroll page to a fixed,
//     predictable cost instead of an unbounded one.
//   - `captureVisibleTab`'s own ~2/sec rate limit means 5 captures already
//     costs >=2s of pure throttling before any decode/detect work -- going
//     materially higher starts to dominate a single agent-loop step's
//     total latency for diminishing coverage gain.
// Truncation past this cap is NEVER silent -- see `truncated` on
// `computeScrollTargets()`'s return value, which content.js's RUN SUMMARY
// surfaces on every step (even when false), matching element-ranker.js's
// own "report `dropped` unconditionally" precedent.
export const DEFAULT_MAX_VIEWPORTS = 5;

// The only place this module ever constructs a zero offset -- exported so
// callers use the identical named constant rather than re-deriving
// `{x:0,y:0}` inline in multiple places (mirrors frame-coords.js's
// `TOP_FRAME_OFFSET` precedent exactly). Used for viewport-only mode (the
// default, unchanged, single-screenshot path), where the screenshot is
// already viewport-relative and no document-scroll adjustment applies.
export const NO_DOCUMENT_OFFSET = Object.freeze({ x: 0, y: 0 });

// Minimum spacing enforced between successive `captureVisibleTab` calls.
// Chrome's MV3 documented limit is roughly 2 calls/second
// (`MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND` is the exact error thrown
// when it's exceeded) -- 550ms gives a >10% safety margin over the
// theoretical 500ms floor rather than shaving it exactly, since this
// module cannot know about clock jitter or other extension activity also
// consuming the same per-tab quota.
export const MIN_CAPTURE_INTERVAL_MS = 550;

function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function isPositiveFiniteNumber(n) {
  return isFiniteNumber(n) && n > 0;
}

// ===========================================================================
// 1. SCROLL-STEP PLANNING (hazards: rate limit budget, lazy-load growth,
//    truncation cap, no-infinite-loop guarantee -- see content.js's driver
//    loop for how this is invoked fresh on every iteration).
// ===========================================================================

/**
 * Compute the scrollY targets a full-page capture pass should visit, given
 * the CURRENT document height. Pure -- takes a snapshot of the world,
 * returns a plan for that snapshot. Deliberately does NOT loop or await
 * anything itself: content.js's browser-only driver calls this function
 * FRESH, with a freshly re-measured `documentHeight`, on every iteration of
 * its capture loop -- that re-invocation (not any state kept inside this
 * function) is what satisfies "re-measure between steps; if the document
 * grows, continue to the new height" without ever discarding progress
 * already made (see content.js's own comment on why `targets[i]` for
 * `i < capturedCount` never differs from what was already captured earlier
 * in the same run: it depends only on `i * viewportHeight` clamped to the
 * CURRENT bottom, and only the LAST clamped index's value can move when
 * `documentHeight` grows).
 *
 * TRUNCATION POLICY (stated explicitly, not left to be discovered): when
 * the page needs more than `maxViewports` slices to reach the bottom, this
 * function tiles TOP-DOWN and stops after `maxViewports` -- it does NOT
 * jump the last slice to the document's bottom. That means a truncated
 * full-page capture covers the page's TOP `maxViewports` screen-heights and
 * never sees anything below that boundary. This is a deliberate, simple,
 * honestly-reported choice over the alternative (bottom-anchoring the last
 * slice, which would leave an uncaptured GAP in the middle of the page
 * instead of a clean boundary at the end) -- either is defensible, but a
 * clean "we saw the top N screens and nothing below" boundary is easier to
 * reason about than a "we saw the top and the very bottom but a chunk in
 * between is missing" one. `truncated`/`viewportsNeeded` are ALWAYS
 * returned (never omitted, never only present when true) so a caller can
 * report the gap in every RUN SUMMARY, not just the ones that hit it --
 * same "report unconditionally" precedent element-ranker.js's `dropped`
 * field already established in this codebase.
 *
 * NO-INFINITE-LOOP GUARANTEE: `targets.length` is ALWAYS <= `maxViewports`,
 * by construction (the loop below never runs more than `maxViewports`
 * iterations) -- regardless of how large `documentHeight` is, including an
 * infinite-scroll page that would keep growing forever if measured again
 * and again. A caller driving a loop off `capturedCount >= targets.length`
 * is therefore bounded no matter how it re-invokes this function.
 *
 * @param {{documentHeight: number, viewportHeight: number, maxViewports?: number}} params
 *   `documentHeight`/`viewportHeight` in CSS px (e.g.
 *   `document.documentElement.scrollHeight` / `window.innerHeight`).
 * @returns {{targets: number[], truncated: boolean, viewportsNeeded: number, viewportsPlanned: number}}
 *   `targets`: scrollY values (CSS px) to visit, in top-to-bottom order.
 *   `viewportsNeeded`: how many slices WOULD be required to reach the true
 *     bottom of the CURRENT `documentHeight`, uncapped.
 *   `viewportsPlanned`: `targets.length` (kept as its own field so a caller
 *     doesn't have to re-derive it -- always equals `targets.length`).
 *   `truncated`: `viewportsNeeded > viewportsPlanned`.
 * @throws {Error} on a non-finite/non-positive `viewportHeight`, a
 *   negative/non-finite `documentHeight`, or a `maxViewports` that isn't a
 *   positive integer -- these are programmer errors (bad measurements),
 *   never silently coerced, per this module's FAIL LOUD policy.
 */
export function computeScrollTargets({ documentHeight, viewportHeight, maxViewports = DEFAULT_MAX_VIEWPORTS } = {}) {
  if (!isPositiveFiniteNumber(viewportHeight)) {
    throw new Error("capture-plan.js: computeScrollTargets() requires a positive finite viewportHeight");
  }
  if (!isFiniteNumber(documentHeight) || documentHeight < 0) {
    throw new Error("capture-plan.js: computeScrollTargets() requires a non-negative finite documentHeight");
  }
  if (!Number.isInteger(maxViewports) || maxViewports < 1) {
    throw new Error("capture-plan.js: computeScrollTargets() requires a positive integer maxViewports");
  }

  // The whole page already fits in one viewport -- a single slice at the
  // top covers everything. (Also covers documentHeight === 0, a degenerate
  // but not-invalid measurement -- e.g. a page that hasn't finished its
  // first layout pass yet.)
  if (documentHeight <= viewportHeight) {
    return { targets: [0], truncated: false, viewportsNeeded: 1, viewportsPlanned: 1 };
  }

  const viewportsNeeded = Math.ceil(documentHeight / viewportHeight);
  const viewportsPlanned = Math.min(viewportsNeeded, maxViewports);
  const truncated = viewportsNeeded > maxViewports;
  const maxScrollY = documentHeight - viewportHeight; // bottom-anchored position -- the true last tile when NOT truncated

  const targets = [];
  for (let i = 0; i < viewportsPlanned; i++) {
    const target = Math.min(i * viewportHeight, maxScrollY);
    // Defensive dedup: never emit two consecutive identical scrollY values.
    // Not expected to trigger given the clamp math above (see the file's
    // own reasoning in the accompanying unit tests), but capturing the
    // exact same slice twice would waste a throttled capture slot for zero
    // new coverage, so this is cheap insurance, not decoration.
    if (targets.length > 0 && targets[targets.length - 1] === target) continue;
    targets.push(target);
  }

  return { targets, truncated, viewportsNeeded, viewportsPlanned: targets.length };
}

// ===========================================================================
// 2. THROTTLE MATH (hazard: captureVisibleTab's ~2/sec MV3 rate limit).
// ===========================================================================

/**
 * How long (ms) the caller should wait before its NEXT `captureVisibleTab`
 * call, given when the last one fired. Pure arithmetic -- content.js is
 * responsible for actually sleeping and for making the call itself;
 * background.js additionally catches and retries the specific
 * `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND` error as a last-resort backstop
 * (see that file's own comment) in case this margin is ever insufficient
 * under real scheduling jitter -- this function is the deliberate,
 * proactive half of "throttle deliberately," not the only line of defense.
 *
 * @param {{lastCaptureAt: number|null|undefined, now: number, minIntervalMs?: number}} params
 *   `lastCaptureAt`/`now` are `performance.now()`-style timestamps (any
 *   consistent monotonic clock works; the two must share one). `null`/
 *   `undefined` `lastCaptureAt` means "no prior capture this run" -- the
 *   very first capture never waits.
 * @returns {number} milliseconds to wait, always >= 0.
 * @throws {Error} if `lastCaptureAt` is provided but not finite, or `now`/
 *   `minIntervalMs` are invalid.
 */
export function computeThrottleDelay({ lastCaptureAt, now, minIntervalMs = MIN_CAPTURE_INTERVAL_MS } = {}) {
  if (lastCaptureAt === null || lastCaptureAt === undefined) return 0;
  if (!isFiniteNumber(lastCaptureAt)) {
    throw new Error("capture-plan.js: computeThrottleDelay() received a non-finite lastCaptureAt");
  }
  if (!isFiniteNumber(now)) {
    throw new Error("capture-plan.js: computeThrottleDelay() requires a finite now");
  }
  if (!isPositiveFiniteNumber(minIntervalMs)) {
    throw new Error("capture-plan.js: computeThrottleDelay() requires a positive finite minIntervalMs");
  }
  const elapsed = now - lastCaptureAt;
  return Math.max(0, minIntervalMs - elapsed);
}

// ===========================================================================
// 3. STITCH LAYOUT (slice geometry -- where each captured slice lands on
//    the final canvas).
// ===========================================================================

/**
 * Compute the stitched canvas's dimensions and each slice's draw position,
 * given the ACTUAL scrollY each slice was captured at (not the originally
 * planned target -- a browser can clamp `window.scrollTo()` to a different
 * value than requested, e.g. if the document was shorter than expected by
 * the time the scroll actually happened; callers should pass back what
 * really happened, not what was asked for).
 *
 * Slices are placed by their DOCUMENT position (`scrollY`), not by
 * capture order or index spacing -- this is what makes overlapping slices
 * (the common case: the last slice is bottom-anchored and typically
 * overlaps the second-to-last one) self-correcting rather than something
 * this function has to explicitly crop/dedup: two slices showing the same
 * strip of the page draw the identical content at the identical canvas
 * position, so drawing both (in any order) produces the same pixels as
 * drawing either one alone. Callers should still draw in ascending
 * `scrollY` order for determinism (this function's own placements array is
 * already sorted that way whenever the input is), but overlap correctness
 * does not depend on it.
 *
 * @param {{slices: Array<{scrollY: number, widthPx: number, heightPx: number}>, scaleFactor?: number}} params
 *   `scrollY` is CSS px (the page's own scroll units); `widthPx`/`heightPx`
 *   are the CAPTURED IMAGE's own pixel dimensions -- already device px, as
 *   returned by `captureVisibleTab` -- so this function does not scale
 *   them, only the `scrollY` position each is placed at (which starts in
 *   CSS px and must become device px, via `scaleFactor`, to land at the
 *   right row of a device-px canvas).
 * @returns {{canvasWidthPx: number, canvasHeightPx: number, placements: Array<{index: number, drawXPx: number, drawYPx: number, widthPx: number, heightPx: number}>}}
 * @throws {Error} on an empty/non-array `slices`, a malformed slice, or a
 *   non-positive/non-finite `scaleFactor`.
 */
export function computeStitchLayout({ slices, scaleFactor = 1 } = {}) {
  if (!Array.isArray(slices) || slices.length === 0) {
    throw new Error("capture-plan.js: computeStitchLayout() requires a non-empty slices array");
  }
  if (!isPositiveFiniteNumber(scaleFactor)) {
    throw new Error("capture-plan.js: computeStitchLayout() requires a positive finite scaleFactor");
  }

  let canvasWidthPx = 0;
  let canvasHeightPx = 0;

  const placements = slices.map((slice, index) => {
    if (
      !slice ||
      !isFiniteNumber(slice.scrollY) ||
      !isPositiveFiniteNumber(slice.widthPx) ||
      !isPositiveFiniteNumber(slice.heightPx)
    ) {
      throw new Error(
        `capture-plan.js: computeStitchLayout() slice at index ${index} is malformed ` +
          "(requires finite scrollY and positive finite widthPx/heightPx)"
      );
    }
    const drawYPx = Math.round(slice.scrollY * scaleFactor);
    canvasWidthPx = Math.max(canvasWidthPx, slice.widthPx);
    canvasHeightPx = Math.max(canvasHeightPx, drawYPx + slice.heightPx);
    return { index, drawXPx: 0, drawYPx, widthPx: slice.widthPx, heightPx: slice.heightPx };
  });

  return { canvasWidthPx, canvasHeightPx, placements };
}

// ===========================================================================
// 4. DOCUMENT OFFSET (the coordinate-problem fix itself -- transform step 2
//    of the mandatory 3-step order documented at the top of this file).
// ===========================================================================

/**
 * Translate one {x,y,w,h} bbox from top-frame VIEWPORT-relative CSS px into
 * top-frame DOCUMENT-relative CSS px, by adding a resolved scroll offset.
 * Width/height are unaffected (only position moves) -- mirrors
 * frame-coords.js's `translateBBox()` exactly, including its FAIL LOUD
 * policy, on purpose: this is structurally the SAME kind of operation
 * (additive coordinate-frame translation) one step later in the same
 * pipeline, and reviewers already familiar with frame-coords.js's contract
 * should find this one unsurprising.
 *
 * @param {{x:number,y:number,w:number,h:number}} bbox
 * @param {{x:number,y:number}} offset - pass `NO_DOCUMENT_OFFSET` explicitly
 *   for viewport-only mode; pass `{x: window.scrollX, y: window.scrollY}`
 *   AS READ AT DOM-SCAN TIME (not re-read later) for full-page mode.
 * @returns {{x:number,y:number,w:number,h:number}}
 * @throws {Error} if bbox is malformed, or offset is missing/non-finite.
 */
export function addDocumentOffset(bbox, offset) {
  if (
    !bbox ||
    !isFiniteNumber(bbox.x) ||
    !isFiniteNumber(bbox.y) ||
    !isFiniteNumber(bbox.w) ||
    !isFiniteNumber(bbox.h)
  ) {
    throw new Error("capture-plan.js: addDocumentOffset() requires a well-formed {x,y,w,h} bbox with finite numbers");
  }
  if (!offset || !isFiniteNumber(offset.x) || !isFiniteNumber(offset.y)) {
    throw new Error(
      "capture-plan.js: addDocumentOffset() refuses to translate by an unresolved offset " +
        "(missing, null, or non-finite x/y). Pass NO_DOCUMENT_OFFSET explicitly for viewport-only " +
        "mode -- a silently-zeroed offset in full-page mode would place a redaction rectangle at the " +
        "wrong pixels while looking like it worked, which is strictly worse than throwing here."
    );
  }
  return {
    x: bbox.x + offset.x,
    y: bbox.y + offset.y,
    w: bbox.w,
    h: bbox.h,
  };
}

/**
 * Translate every `.bbox` field in an array of dom-scanner.js-shaped
 * `sensitiveNodes` / action-executor.js-shaped `domSnapshot` /
 * `unscannableRegions` entries by a single resolved offset. Pure: returns a
 * new array of new objects; never mutates input -- mirrors
 * frame-coords.js's `translateNodeBBoxes()` exactly, including tolerating
 * bbox-less entries (nothing to translate is not an error at THIS layer;
 * see that file's own note on the same point).
 *
 * content.js calls this EXACTLY ONCE per array, per step (two call sites --
 * `mergedDomSnapshot` and the redaction-input node list -- mirroring the
 * pre-existing, deliberate asymmetry in how devicePixelRatio scaling is
 * ALSO applied at two separate call sites for those same two arrays; see
 * content.js's own comment on that asymmetry). Calling it twice on the
 * SAME array would silently double-add the offset -- see this file's
 * accompanying unit test asserting exactly what that wrong result looks
 * like, so a future edit that accidentally reintroduces a second call site
 * has a concrete wrong number to catch it, not just a comment to violate.
 *
 * @param {Array<{bbox?: {x:number,y:number,w:number,h:number}}>} nodes
 * @param {{x:number,y:number}} offset
 * @returns {Array<object>}
 * @throws {Error} if offset is unresolved AND at least one node has a bbox
 *   to translate (an all-bbox-less input never throws).
 */
export function addDocumentOffsetToNodes(nodes, offset) {
  if (!Array.isArray(nodes)) return [];
  return nodes.map((node) => {
    if (!node || !node.bbox) return node;
    return { ...node, bbox: addDocumentOffset(node.bbox, offset) };
  });
}
