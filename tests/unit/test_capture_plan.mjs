// SIH 26171 -- full-page scroll-and-stitch capture: extension/lib/capture-plan.js tests.
//
// Pure arithmetic/planning module, zero DOM/browser dependency -- run with
// plain Node's built-in test runner, no jsdom needed (same reasoning as
// tests/unit/test_frame_coords.test.mjs, which this file's structure
// deliberately mirrors: this module is the SAME kind of thing one
// transform step later in the same pipeline).
//
// Run with: node --test tests/unit/test_capture_plan.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MAX_VIEWPORTS,
  NO_DOCUMENT_OFFSET,
  MIN_CAPTURE_INTERVAL_MS,
  computeScrollTargets,
  computeThrottleDelay,
  computeStitchLayout,
  addDocumentOffset,
  addDocumentOffsetToNodes,
} from "../../extension/lib/capture-plan.js";

// ===========================================================================
// 1. computeScrollTargets -- scroll-step planning, truncation, dedup.
// ===========================================================================

describe("computeScrollTargets: page fits in a single viewport", () => {
  test("documentHeight <= viewportHeight -> exactly one target at 0, never truncated", () => {
    const result = computeScrollTargets({ documentHeight: 600, viewportHeight: 800 });
    assert.deepEqual(result, { targets: [0], truncated: false, viewportsNeeded: 1, viewportsPlanned: 1 });
  });

  test("documentHeight === viewportHeight exactly -> still one target, not two", () => {
    const result = computeScrollTargets({ documentHeight: 800, viewportHeight: 800 });
    assert.deepEqual(result.targets, [0]);
    assert.equal(result.viewportsNeeded, 1);
  });

  test("documentHeight === 0 (degenerate but not invalid) -> one target at 0", () => {
    const result = computeScrollTargets({ documentHeight: 0, viewportHeight: 800 });
    assert.deepEqual(result.targets, [0]);
  });
});

describe("computeScrollTargets: multi-slice tiling, exact and non-exact multiples", () => {
  test("exact multiple (2400 / 800 = 3) -> 3 targets, evenly tiled, last one bottom-anchored trivially", () => {
    const result = computeScrollTargets({ documentHeight: 2400, viewportHeight: 800, maxViewports: 5 });
    assert.deepEqual(result.targets, [0, 800, 1600]);
    assert.equal(result.truncated, false);
    assert.equal(result.viewportsNeeded, 3);
  });

  test("non-exact multiple (2500 / 800 -> needs 4, last tile bottom-anchored, OVERLAPS the third)", () => {
    const result = computeScrollTargets({ documentHeight: 2500, viewportHeight: 800, maxViewports: 5 });
    // naive tiling would be [0, 800, 1600, 2400] but 2400+800=3200 > 2500,
    // so the last slice must clamp to maxScrollY = 2500-800 = 1700 to reach
    // the true bottom -- which overlaps the third slice's [1600,2400] range.
    assert.deepEqual(result.targets, [0, 800, 1600, 1700]);
    assert.equal(result.viewportsNeeded, 4);
    assert.equal(result.truncated, false);
  });

  test("the last target in a non-truncated plan always exactly reaches documentHeight - viewportHeight", () => {
    const documentHeight = 3333;
    const viewportHeight = 777;
    const result = computeScrollTargets({ documentHeight, viewportHeight, maxViewports: 20 });
    assert.equal(result.truncated, false);
    const last = result.targets[result.targets.length - 1];
    assert.equal(last, documentHeight - viewportHeight);
    assert.equal(last + viewportHeight, documentHeight, "the last slice's bottom edge must exactly reach the page's true bottom, no gap");
  });

  test("no two consecutive targets are ever identical (dedup guard)", () => {
    // A battery of shapes, including ones deliberately close to clamp
    // boundaries where a naive implementation could double-emit.
    const cases = [
      { documentHeight: 1600, viewportHeight: 800 },
      { documentHeight: 1601, viewportHeight: 800 },
      { documentHeight: 800.0001, viewportHeight: 800 },
      { documentHeight: 4000, viewportHeight: 800, maxViewports: 5 },
    ];
    for (const c of cases) {
      const { targets } = computeScrollTargets(c);
      for (let i = 1; i < targets.length; i++) {
        assert.notEqual(targets[i], targets[i - 1], `duplicate consecutive target in ${JSON.stringify(c)}: ${JSON.stringify(targets)}`);
      }
    }
  });

  test("targets are always non-decreasing (top-to-bottom order)", () => {
    const { targets } = computeScrollTargets({ documentHeight: 9000, viewportHeight: 750, maxViewports: 5 });
    for (let i = 1; i < targets.length; i++) {
      assert.ok(targets[i] >= targets[i - 1]);
    }
  });
});

describe("computeScrollTargets: the truncation cap -- 'do not produce a 30,000px image'", () => {
  test("a page needing more than maxViewports slices is truncated, reports the real shortfall, and NEVER exceeds the cap", () => {
    const result = computeScrollTargets({ documentHeight: 100000, viewportHeight: 800, maxViewports: 5 });
    assert.equal(result.targets.length, 5);
    assert.equal(result.viewportsPlanned, 5);
    assert.equal(result.viewportsNeeded, Math.ceil(100000 / 800));
    assert.equal(result.truncated, true);
  });

  test("truncated capture tiles TOP-DOWN and does NOT jump the last slice to the document's true bottom", () => {
    const result = computeScrollTargets({ documentHeight: 100000, viewportHeight: 800, maxViewports: 5 });
    assert.deepEqual(result.targets, [0, 800, 1600, 2400, 3200]);
    assert.notEqual(result.targets[result.targets.length - 1], 100000 - 800, "a truncated plan must not silently bottom-anchor -- that would misreport how much of the page was actually seen");
  });

  test("`truncated` is reported as false, explicitly, on every non-truncated call -- never merely absent", () => {
    const result = computeScrollTargets({ documentHeight: 1000, viewportHeight: 800 });
    assert.equal(typeof result.truncated, "boolean");
    assert.equal(result.truncated, false);
  });

  test("an infinite-scroll page (documentHeight kept re-measured ever larger) is STILL bounded to maxViewports every single time", () => {
    let documentHeight = 2000;
    for (let i = 0; i < 20; i++) {
      const result = computeScrollTargets({ documentHeight, viewportHeight: 800, maxViewports: DEFAULT_MAX_VIEWPORTS });
      assert.ok(result.targets.length <= DEFAULT_MAX_VIEWPORTS, `iteration ${i}: targets.length=${result.targets.length} exceeded the cap`);
      documentHeight *= 2; // simulate lazy-loaded content doubling the page every "re-measurement"
    }
  });

  test("DEFAULT_MAX_VIEWPORTS is exactly 5 and is used when maxViewports is omitted", () => {
    assert.equal(DEFAULT_MAX_VIEWPORTS, 5);
    const withDefault = computeScrollTargets({ documentHeight: 100000, viewportHeight: 800 });
    const withExplicit5 = computeScrollTargets({ documentHeight: 100000, viewportHeight: 800, maxViewports: 5 });
    assert.deepEqual(withDefault, withExplicit5);
  });
});

describe("computeScrollTargets: lazy-load growth reconciliation (re-measure between steps)", () => {
  test("targets already captured (indices before the growth-affected one) are stable across a fresh re-measurement", () => {
    const before = computeScrollTargets({ documentHeight: 2400, viewportHeight: 800, maxViewports: 5 });
    // page grows (lazy-loaded content) before the NEXT capture -- re-plan
    // from the fresh height, as content.js's driver loop does every
    // iteration.
    const after = computeScrollTargets({ documentHeight: 6000, viewportHeight: 800, maxViewports: 5 });
    // Indices 0 and 1 were already captured under `before` at targets[0]=0,
    // targets[1]=800 -- both must still read identically after growth, or
    // a slice already captured would need to be re-taken at a different
    // position to stay consistent (it can't be, it already happened).
    assert.equal(after.targets[0], before.targets[0]);
    assert.equal(after.targets[1], before.targets[1]);
  });

  test("growth extends how far DOWN the plan reaches, without exceeding the overall cap", () => {
    const small = computeScrollTargets({ documentHeight: 1600, viewportHeight: 800, maxViewports: 5 });
    assert.equal(small.viewportsNeeded, 2);
    const grown = computeScrollTargets({ documentHeight: 20000, viewportHeight: 800, maxViewports: 5 });
    assert.equal(grown.viewportsNeeded, 25);
    assert.equal(grown.targets.length, 5); // still capped -- growth buys reach, never extra budget
    assert.equal(grown.truncated, true);
  });

  test("a driver loop reading targets[capturedCount] fresh every iteration terminates (simulated end-to-end)", () => {
    // Simulates content.js's actual loop shape: capturedCount only
    // advances on a successful capture; documentHeight can change (grow)
    // between iterations; the loop must still terminate.
    let documentHeight = 1000;
    let capturedCount = 0;
    const capturedAt = [];
    let iterations = 0;
    while (iterations < 1000) { // safety valve for the TEST itself, not the algorithm
      iterations++;
      const plan = computeScrollTargets({ documentHeight, viewportHeight: 800, maxViewports: 5 });
      if (capturedCount >= plan.targets.length) break;
      capturedAt.push(plan.targets[capturedCount]);
      capturedCount++;
      documentHeight += 500; // grows a little every "step", simulating lazy-load
    }
    assert.ok(iterations < 1000, "the loop must terminate well before the test's own outer safety valve");
    assert.ok(capturedAt.length <= DEFAULT_MAX_VIEWPORTS);
  });
});

describe("computeScrollTargets: input validation (FAIL LOUD)", () => {
  test("throws on non-positive/non-finite viewportHeight", () => {
    assert.throws(() => computeScrollTargets({ documentHeight: 1000, viewportHeight: 0 }));
    assert.throws(() => computeScrollTargets({ documentHeight: 1000, viewportHeight: -100 }));
    assert.throws(() => computeScrollTargets({ documentHeight: 1000, viewportHeight: NaN }));
    assert.throws(() => computeScrollTargets({ documentHeight: 1000, viewportHeight: "800" }));
  });

  test("throws on negative/non-finite documentHeight", () => {
    assert.throws(() => computeScrollTargets({ documentHeight: -1, viewportHeight: 800 }));
    assert.throws(() => computeScrollTargets({ documentHeight: Infinity, viewportHeight: 800 }));
  });

  test("throws on a non-positive-integer maxViewports", () => {
    assert.throws(() => computeScrollTargets({ documentHeight: 1000, viewportHeight: 800, maxViewports: 0 }));
    assert.throws(() => computeScrollTargets({ documentHeight: 1000, viewportHeight: 800, maxViewports: 2.5 }));
    assert.throws(() => computeScrollTargets({ documentHeight: 1000, viewportHeight: 800, maxViewports: -3 }));
  });
});

// ===========================================================================
// 2. computeThrottleDelay -- captureVisibleTab rate-limit math.
// ===========================================================================

describe("computeThrottleDelay", () => {
  test("no prior capture (null/undefined lastCaptureAt) never waits", () => {
    assert.equal(computeThrottleDelay({ lastCaptureAt: null, now: 1000 }), 0);
    assert.equal(computeThrottleDelay({ lastCaptureAt: undefined, now: 1000 }), 0);
  });

  test("enough time has already elapsed -> 0 wait, never negative", () => {
    const delay = computeThrottleDelay({ lastCaptureAt: 0, now: 10000, minIntervalMs: 550 });
    assert.equal(delay, 0);
  });

  test("not enough time has elapsed -> waits exactly the remainder", () => {
    const delay = computeThrottleDelay({ lastCaptureAt: 1000, now: 1200, minIntervalMs: 550 });
    assert.equal(delay, 350);
  });

  test("exactly at the boundary -> 0 wait", () => {
    const delay = computeThrottleDelay({ lastCaptureAt: 1000, now: 1550, minIntervalMs: 550 });
    assert.equal(delay, 0);
  });

  test("MIN_CAPTURE_INTERVAL_MS is used when minIntervalMs is omitted, and is >500ms (a real safety margin over the ~2/sec limit)", () => {
    assert.ok(MIN_CAPTURE_INTERVAL_MS > 500);
    const delay = computeThrottleDelay({ lastCaptureAt: 0, now: 0 });
    assert.equal(delay, MIN_CAPTURE_INTERVAL_MS);
  });

  test("throws on non-finite now/minIntervalMs, or a non-finite (but provided) lastCaptureAt", () => {
    assert.throws(() => computeThrottleDelay({ lastCaptureAt: NaN, now: 100 }));
    assert.throws(() => computeThrottleDelay({ lastCaptureAt: 0, now: NaN }));
    assert.throws(() => computeThrottleDelay({ lastCaptureAt: 0, now: 100, minIntervalMs: 0 }));
  });
});

// ===========================================================================
// 3. computeStitchLayout -- slice geometry.
// ===========================================================================

describe("computeStitchLayout", () => {
  test("a single slice -> canvas exactly matches that slice, drawn at (0,0)", () => {
    const result = computeStitchLayout({ slices: [{ scrollY: 0, widthPx: 1280, heightPx: 900 }] });
    assert.equal(result.canvasWidthPx, 1280);
    assert.equal(result.canvasHeightPx, 900);
    assert.deepEqual(result.placements, [{ index: 0, drawXPx: 0, drawYPx: 0, widthPx: 1280, heightPx: 900 }]);
  });

  test("non-overlapping slices stack top-to-bottom, canvas height sums them", () => {
    const result = computeStitchLayout({
      slices: [
        { scrollY: 0, widthPx: 1280, heightPx: 900 },
        { scrollY: 900, widthPx: 1280, heightPx: 900 },
      ],
    });
    assert.equal(result.canvasHeightPx, 1800);
    assert.equal(result.placements[0].drawYPx, 0);
    assert.equal(result.placements[1].drawYPx, 900);
  });

  test("overlapping slices (last slice bottom-anchored) place by scrollY, not by stacking -- canvas height is the true max, not a naive sum", () => {
    // Second slice overlaps the first by 100px (scrollY=800 < 900=first's bottom).
    const result = computeStitchLayout({
      slices: [
        { scrollY: 0, widthPx: 1280, heightPx: 900 },
        { scrollY: 800, widthPx: 1280, heightPx: 900 },
      ],
    });
    assert.equal(result.placements[1].drawYPx, 800);
    assert.equal(result.canvasHeightPx, 1700, "must be max(0+900, 800+900)=1700, NOT a naive sum of 1800");
  });

  test("scaleFactor (devicePixelRatio) converts scrollY (CSS px) to device px for placement -- widthPx/heightPx are NOT re-scaled (already device px)", () => {
    const result = computeStitchLayout({
      slices: [
        { scrollY: 0, widthPx: 2560, heightPx: 1800 }, // e.g. a 2x DPR capture
        { scrollY: 900, widthPx: 2560, heightPx: 1800 }, // scrollY in CSS px, viewportHeight=900 CSS px
      ],
      scaleFactor: 2,
    });
    assert.equal(result.placements[0].drawYPx, 0);
    assert.equal(result.placements[1].drawYPx, 1800); // 900 * 2, not 900
    assert.equal(result.placements[1].widthPx, 2560); // unchanged
    assert.equal(result.canvasHeightPx, 3600);
  });

  test("canvas width is the max width across slices (robust to a slice that came back a different width)", () => {
    const result = computeStitchLayout({
      slices: [
        { scrollY: 0, widthPx: 1280, heightPx: 900 },
        { scrollY: 900, widthPx: 1270, heightPx: 900 }, // scrollbar disappearing on the last page, e.g.
      ],
    });
    assert.equal(result.canvasWidthPx, 1280);
  });

  test("throws on empty/non-array slices", () => {
    assert.throws(() => computeStitchLayout({ slices: [] }));
    assert.throws(() => computeStitchLayout({ slices: null }));
  });

  test("throws on a malformed slice (missing/non-finite fields)", () => {
    assert.throws(() => computeStitchLayout({ slices: [{ scrollY: 0, widthPx: 100 }] })); // missing heightPx
    assert.throws(() => computeStitchLayout({ slices: [{ scrollY: NaN, widthPx: 100, heightPx: 100 }] }));
    assert.throws(() => computeStitchLayout({ slices: [{ scrollY: 0, widthPx: 0, heightPx: 100 }] })); // width must be > 0
  });

  test("throws on non-positive/non-finite scaleFactor", () => {
    assert.throws(() => computeStitchLayout({ slices: [{ scrollY: 0, widthPx: 10, heightPx: 10 }], scaleFactor: 0 }));
    assert.throws(() => computeStitchLayout({ slices: [{ scrollY: 0, widthPx: 10, heightPx: 10 }], scaleFactor: NaN }));
  });
});

// ===========================================================================
// 4. addDocumentOffset / addDocumentOffsetToNodes -- THE coordinate-problem
//    fix, and the double-application hazard the delegation brief calls out
//    by name.
// ===========================================================================

describe("addDocumentOffset", () => {
  test("adds offset.x/offset.y to bbox.x/bbox.y; width/height unaffected -- mirrors frame-coords.js's translateBBox shape exactly", () => {
    const bbox = { x: 100, y: 200, w: 50, h: 30 };
    const offset = { x: 0, y: 1500 }; // e.g. window.scrollY at DOM-scan time
    assert.deepEqual(addDocumentOffset(bbox, offset), { x: 100, y: 1700, w: 50, h: 30 });
  });

  test("NO_DOCUMENT_OFFSET is exactly {x:0,y:0} and applying it is a true no-op (viewport-only mode, byte-identical to pre-feature behavior)", () => {
    assert.deepEqual(NO_DOCUMENT_OFFSET, { x: 0, y: 0 });
    const bbox = { x: 42, y: 7, w: 10, h: 10 };
    assert.deepEqual(addDocumentOffset(bbox, NO_DOCUMENT_OFFSET), bbox);
  });

  test("throws on a malformed bbox", () => {
    assert.throws(() => addDocumentOffset(null, { x: 0, y: 0 }));
    assert.throws(() => addDocumentOffset({ x: 1, y: 2, w: 3 }, { x: 0, y: 0 })); // missing h
    assert.throws(() => addDocumentOffset({ x: NaN, y: 2, w: 3, h: 4 }, { x: 0, y: 0 }));
  });

  test("throws on a missing/non-finite offset -- refuses to silently default to zero", () => {
    assert.throws(() => addDocumentOffset({ x: 1, y: 2, w: 3, h: 4 }, null));
    assert.throws(() => addDocumentOffset({ x: 1, y: 2, w: 3, h: 4 }, undefined));
    assert.throws(() => addDocumentOffset({ x: 1, y: 2, w: 3, h: 4 }, { x: NaN, y: 0 }));
    assert.throws(() => addDocumentOffset({ x: 1, y: 2, w: 3, h: 4 }, {}));
  });

  test("THE DOUBLE-APPLICATION HAZARD: applying the offset twice silently produces a bbox shifted by 2x the true scroll offset, not the correct 1x", () => {
    // This is the exact failure class the delegation brief calls out by
    // name: "Get the order or the count wrong and redaction rectangles
    // land on the wrong pixels while appearing to work." This test does
    // not (and cannot) prevent content.js from calling this function
    // twice by mistake -- it proves what that mistake looks like in
    // concrete numbers, so a reviewer auditing content.js's call sites (or
    // a future diff that adds a second call site) has a wrong answer to
    // compare against instead of only a comment to trust.
    const bbox = { x: 100, y: 200, w: 50, h: 30 };
    const scrollOffset = { x: 0, y: 1500 };

    const correct = addDocumentOffset(bbox, scrollOffset);
    assert.deepEqual(correct, { x: 100, y: 1700, w: 50, h: 30 });

    const doubled = addDocumentOffset(correct, scrollOffset); // the bug: calling it again
    assert.deepEqual(doubled, { x: 100, y: 3200, w: 50, h: 30 });

    assert.notEqual(doubled.y, correct.y, "a double-applied offset must produce a DIFFERENT (wrong) y than the correct single application");
    assert.equal(doubled.y - bbox.y, 2 * scrollOffset.y, "the double-applied result is measurably off by exactly one extra scrollOffset -- the fingerprint of this specific bug");
  });
});

describe("addDocumentOffsetToNodes", () => {
  test("translates every node's bbox by the same offset; non-bbox fields pass through unchanged", () => {
    const nodes = [
      { agentId: "agent-1", piiType: "password", bbox: { x: 10, y: 20, w: 5, h: 5 } },
      { agentId: "agent-2", piiType: "email", bbox: { x: 0, y: 0, w: 100, h: 20 } },
    ];
    const offset = { x: 0, y: 1000 };
    const result = addDocumentOffsetToNodes(nodes, offset);
    assert.equal(result[0].agentId, "agent-1");
    assert.equal(result[0].piiType, "password");
    assert.deepEqual(result[0].bbox, { x: 10, y: 1020, w: 5, h: 5 });
    assert.deepEqual(result[1].bbox, { x: 0, y: 1000, w: 100, h: 20 });
  });

  test("is pure -- never mutates the input array or its bbox objects", () => {
    const original = { agentId: "agent-1", bbox: { x: 10, y: 20, w: 5, h: 5 } };
    const nodes = [original];
    const frozenBboxSnapshot = { ...original.bbox };
    addDocumentOffsetToNodes(nodes, { x: 0, y: 500 });
    assert.deepEqual(original.bbox, frozenBboxSnapshot, "the original node's bbox must be untouched");
  });

  test("a node with no bbox passes through unchanged rather than throwing (matches frame-coords.js's translateNodeBBoxes precedent)", () => {
    const nodes = [{ agentId: "agent-1", bbox: null }, { agentId: "agent-2" }];
    const result = addDocumentOffsetToNodes(nodes, { x: 0, y: 0 });
    assert.deepEqual(result, nodes);
  });

  test("non-array input returns an empty array rather than throwing", () => {
    assert.deepEqual(addDocumentOffsetToNodes(null, { x: 0, y: 0 }), []);
    assert.deepEqual(addDocumentOffsetToNodes(undefined, { x: 0, y: 0 }), []);
  });

  test("an all-bbox-less input never throws even with an unresolved offset (nothing would have been translated anyway)", () => {
    const nodes = [{ agentId: "agent-1" }, { agentId: "agent-2", bbox: null }];
    assert.doesNotThrow(() => addDocumentOffsetToNodes(nodes, null));
  });

  test("DOUBLE-APPLICATION at the array level: calling this twice on the same array is measurably distinguishable from calling it once", () => {
    const nodes = [{ agentId: "agent-1", bbox: { x: 10, y: 20, w: 5, h: 5 } }];
    const offset = { x: 0, y: 1500 };
    const once = addDocumentOffsetToNodes(nodes, offset);
    const twice = addDocumentOffsetToNodes(once, offset);
    assert.equal(once[0].bbox.y, 1520);
    assert.equal(twice[0].bbox.y, 3020);
    assert.notEqual(twice[0].bbox.y, once[0].bbox.y);
  });
});

// ===========================================================================
// 5. Integration-shaped check: the full 3-step order produces the SAME
//    result regardless of whether document offset is "skipped" via
//    NO_DOCUMENT_OFFSET (viewport-only) vs a real offset (full-page),
//    proving the two modes are the SAME code path with one input, not two
//    diverging implementations.
// ===========================================================================

describe("transform order: frame-offset-shaped input -> document offset -> DPR (content.js's mandated sequence)", () => {
  test("viewport-only mode (NO_DOCUMENT_OFFSET) leaves a bbox's position exactly as DPR-scaling alone would -- byte-identical to pre-feature behavior", () => {
    const bbox = { x: 50, y: 60, w: 20, h: 10 };
    const scaleFactor = 2;
    const afterDocOffset = addDocumentOffset(bbox, NO_DOCUMENT_OFFSET);
    const afterDpr = { x: afterDocOffset.x * scaleFactor, y: afterDocOffset.y * scaleFactor, w: afterDocOffset.w * scaleFactor, h: afterDocOffset.h * scaleFactor };
    const directDpr = { x: bbox.x * scaleFactor, y: bbox.y * scaleFactor, w: bbox.w * scaleFactor, h: bbox.h * scaleFactor };
    assert.deepEqual(afterDpr, directDpr);
  });

  test("full-page mode applies document offset BEFORE DPR scaling, in CSS px, not after (order matters -- adding post-DPR would be adding CSS-px scroll units to a device-px value)", () => {
    const bbox = { x: 50, y: 60, w: 20, h: 10 };
    const scrollOffset = { x: 0, y: 1000 }; // CSS px
    const scaleFactor = 2;

    // CORRECT order: offset (CSS px) then scale.
    const afterDocOffset = addDocumentOffset(bbox, scrollOffset);
    const correct = { x: afterDocOffset.x * scaleFactor, y: afterDocOffset.y * scaleFactor, w: afterDocOffset.w * scaleFactor, h: afterDocOffset.h * scaleFactor };
    assert.deepEqual(correct, { x: 100, y: 2120, w: 40, h: 20 });

    // WRONG order (scale first, then add CSS-px scrollY to a device-px
    // value): demonstrates why this module's own doc comment insists on
    // offset-before-scale, with a concrete divergent number.
    const scaledFirst = { x: bbox.x * scaleFactor, y: bbox.y * scaleFactor, w: bbox.w * scaleFactor, h: bbox.h * scaleFactor };
    const wrong = { ...scaledFirst, y: scaledFirst.y + scrollOffset.y };
    assert.notEqual(wrong.y, correct.y, "scaling before offsetting must NOT coincidentally match the correct order's result");
  });
});
