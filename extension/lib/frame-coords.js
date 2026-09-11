// SIH 26171 -- real-site hardening pass: iframe coordinate-space translation.
//
// ---------------------------------------------------------------------------
// THE PROBLEM (see CLAUDE.md / the delegation brief for the full framing):
//
// getBoundingClientRect() inside an iframe returns coordinates relative to
// THAT FRAME's OWN viewport, not the top-level page's. The screenshot
// content.js sends for redaction is a capture of the TOP-LEVEL viewport
// (chrome.tabs.captureVisibleTab always captures the whole visible tab, not
// a single frame). So a bbox produced by dom-scanner.js/action-executor.js
// running inside an iframe's content-script instance is in the WRONG
// coordinate space for redaction/server transmission until it is offset by
// that iframe's own position within the top-level page.
//
// - Same-origin iframe: the PARENT frame can read the iframe element's own
//   getBoundingClientRect() directly (the <iframe> tag itself is part of
//   the parent's DOM regardless of what's inside it) -- trivial.
// - Cross-origin iframe: the CHILD frame's script cannot read its own
//   position in the parent (window.frameElement is null cross-origin;
//   there is no cross-origin-accessible geometry property on Window at
//   all -- this is a hard Same-Origin-Policy constraint, not a missing
//   API). The offset can ONLY be known by the PARENT (who can see the
//   <iframe> element) and must be COMMUNICATED to/via some channel that
//   works across the origin boundary. content.js implements that channel
//   (window.postMessage for a single opaque geometry-correlation token,
//   privileged chrome.runtime messaging for the actual PII-adjacent
//   metadata -- see content.js's FRAME COORDINATION block for the full
//   protocol and why the split).
//
// THIS MODULE is the PURE arithmetic half of that fix: given a bbox in a
// child frame's local coordinate space and that frame's known offset within
// its parent's viewport, produce the corrected bbox. It has ZERO knowledge
// of postMessage, chrome.runtime, or any browser API -- it is unit-testable
// with plain JS objects, exactly like dom-scanner.js and action-executor.js.
//
// FAIL LOUD, NOT WRONG (the brief's explicit instruction): a bbox silently
// translated by a missing/invalid/unresolved offset is worse than dropping
// it -- it looks like a correctly-placed redaction and isn't. Every
// translation function here THROWS on a non-finite/missing offset rather
// than defaulting to {x:0,y:0}, which would be indistinguishable from "this
// frame is not offset at all" (true only for the top frame itself).
// ---------------------------------------------------------------------------

/**
 * @typedef {{x:number, y:number}} FrameOffset
 *   A child frame's position within its immediate parent's viewport, in the
 *   parent's own CSS pixels (i.e. exactly what the parent's
 *   `iframeElement.getBoundingClientRect()` reports for `.left`/`.top`).
 */

function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * True only for a well-formed, finite {x, y} offset. `null`/`undefined`
 * (offset genuinely never resolved -- see content.js) and a malformed
 * object both fail this check identically; callers must treat "not
 * resolved" and "resolved but wrong-shaped" the same way: refuse to use it.
 */
export function isResolvedOffset(offset) {
  return !!offset && isFiniteNumber(offset.x) && isFiniteNumber(offset.y);
}

/** The zero offset -- the ONLY place this module ever constructs one. Used
 * exclusively for the top frame itself (which is not nested in anything),
 * never as a fallback for an unresolved child-frame offset. Exported so
 * content.js can use the identical constant rather than re-deriving
 * `{x:0,y:0}` inline in multiple places. */
export const TOP_FRAME_OFFSET = Object.freeze({ x: 0, y: 0 });

/**
 * Translate one {x,y,w,h} bbox from a child frame's local coordinate space
 * into its parent's, by adding a resolved offset. Width/height are
 * unaffected by translation (only position moves) -- CSS pixel scale is
 * assumed identical between a frame and its parent, which holds for the
 * overwhelming majority of real iframes (no CSS `zoom`/`transform: scale`
 * on the <iframe> element itself); a frame under a CSS transform-scale is a
 * known, documented residual limitation, not silently mishandled -- see
 * content.js's frame-coordination notes.
 *
 * @param {{x:number,y:number,w:number,h:number}} bbox
 * @param {FrameOffset} offset
 * @returns {{x:number,y:number,w:number,h:number}}
 * @throws {Error} if bbox is malformed, or offset is missing/non-finite --
 *   deliberately, per this module's FAIL LOUD, NOT WRONG policy.
 */
export function translateBBox(bbox, offset) {
  if (
    !bbox ||
    !isFiniteNumber(bbox.x) ||
    !isFiniteNumber(bbox.y) ||
    !isFiniteNumber(bbox.w) ||
    !isFiniteNumber(bbox.h)
  ) {
    throw new Error(
      "frame-coords.js: translateBBox() requires a well-formed {x,y,w,h} bbox with finite numbers"
    );
  }
  if (!isResolvedOffset(offset)) {
    throw new Error(
      "frame-coords.js: translateBBox() refuses to translate by an unresolved offset " +
        "(missing, null, or non-finite x/y). A silently-zeroed offset would place a " +
        "redaction rectangle at the WRONG pixels while looking like it worked -- that is " +
        "strictly worse than dropping this region and reporting it as unresolved. " +
        "Callers must check isResolvedOffset() first and handle the unresolved case " +
        "explicitly (drop + log), never call this with a fallback zero offset."
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
 * `sensitiveNodes` (or action-executor.js-shaped `unscannableRegions`)
 * entries by a single resolved offset. Pure: returns a new array of new
 * objects; never mutates input. Entries missing a usable bbox are passed
 * through unchanged rather than thrown on -- a bbox-less entry has nothing
 * to translate, which is a pre-existing, unrelated condition (e.g.
 * redaction.js already tolerates a missing/invalid bbox by skipping the
 * draw step) -- this function's job is coordinate translation only, not
 * bbox validation.
 *
 * @param {Array<{bbox?: {x:number,y:number,w:number,h:number}}>} nodes
 * @param {FrameOffset} offset
 * @returns {Array<object>}
 * @throws {Error} if offset is unresolved AND at least one node has a bbox
 *   to translate -- see translateBBox()'s FAIL LOUD note. An all-bbox-less
 *   input never throws (nothing would have been translated anyway).
 */
export function translateNodeBBoxes(nodes, offset) {
  if (!Array.isArray(nodes)) return [];
  return nodes.map((node) => {
    if (!node || !node.bbox) return node;
    return { ...node, bbox: translateBBox(node.bbox, offset) };
  });
}

/**
 * Convenience wrapper used by content.js when merging one subframe's
 * report into the top frame's aggregate state. Bundles the three arrays a
 * frame report carries (sensitiveNodes, domSnapshot, unscannableRegions)
 * through translateNodeBBoxes with one offset, and re-prefixes nothing
 * (agentId prefixing is action-executor.js/dom-scanner.js's job at scan
 * time, not this module's).
 *
 * @param {{sensitiveNodes?: Array, domSnapshot?: Array, unscannableRegions?: Array}} report
 * @param {FrameOffset} offset
 * @returns {{sensitiveNodes: Array, domSnapshot: Array, unscannableRegions: Array}}
 */
export function translateFrameReport(report, offset) {
  const r = report || {};
  return {
    sensitiveNodes: translateNodeBBoxes(r.sensitiveNodes || [], offset),
    domSnapshot: translateNodeBBoxes(r.domSnapshot || [], offset),
    unscannableRegions: translateNodeBBoxes(r.unscannableRegions || [], offset),
  };
}
