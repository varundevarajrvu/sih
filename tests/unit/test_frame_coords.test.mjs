// SIH 26171 -- real-site hardening pass: extension/lib/frame-coords.js tests.
//
// Pure arithmetic module, zero DOM/browser dependency -- run with plain
// Node's built-in test runner, no jsdom needed at all (unlike the
// dom-scanner/action-executor suites, which need jsdom for a Document to
// walk). This is deliberate: the coordinate-translation math itself doesn't
// need a DOM, only plain {x,y,w,h} objects, so it's tested at that level.
//
// Run with: node --test tests/unit/test_frame_coords.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  isResolvedOffset,
  TOP_FRAME_OFFSET,
  translateBBox,
  translateNodeBBoxes,
  translateFrameReport,
} from "../../extension/lib/frame-coords.js";

describe("isResolvedOffset", () => {
  test("a well-formed finite {x,y} offset is resolved", () => {
    assert.equal(isResolvedOffset({ x: 10, y: 20 }), true);
    assert.equal(isResolvedOffset({ x: 0, y: 0 }), true);
    assert.equal(isResolvedOffset({ x: -5, y: 3.5 }), true);
  });

  test("null/undefined/missing offset is NOT resolved", () => {
    assert.equal(isResolvedOffset(null), false);
    assert.equal(isResolvedOffset(undefined), false);
    assert.equal(isResolvedOffset({}), false);
  });

  test("non-finite x/y (NaN, Infinity, non-number) is NOT resolved", () => {
    assert.equal(isResolvedOffset({ x: NaN, y: 0 }), false);
    assert.equal(isResolvedOffset({ x: 0, y: Infinity }), false);
    assert.equal(isResolvedOffset({ x: "10", y: 20 }), false);
  });
});

describe("TOP_FRAME_OFFSET", () => {
  test("is exactly {x:0, y:0} and is itself a resolved offset", () => {
    assert.deepEqual(TOP_FRAME_OFFSET, { x: 0, y: 0 });
    assert.equal(isResolvedOffset(TOP_FRAME_OFFSET), true);
  });
});

describe("translateBBox", () => {
  test("adds offset.x/offset.y to bbox.x/bbox.y; width/height unaffected", () => {
    const bbox = { x: 100, y: 200, w: 50, h: 30 };
    const offset = { x: 15, y: -5 };
    assert.deepEqual(translateBBox(bbox, offset), { x: 115, y: 195, w: 50, h: 30 });
  });

  test("translating by TOP_FRAME_OFFSET is a no-op (identity)", () => {
    const bbox = { x: 42, y: 7, w: 10, h: 10 };
    assert.deepEqual(translateBBox(bbox, TOP_FRAME_OFFSET), bbox);
  });

  test("does NOT mutate the input bbox", () => {
    const bbox = { x: 1, y: 1, w: 1, h: 1 };
    const copy = { ...bbox };
    translateBBox(bbox, { x: 100, y: 100 });
    assert.deepEqual(bbox, copy);
  });

  describe("FAIL LOUD, NOT WRONG -- the load-bearing safety property of this module", () => {
    test("throws on a missing/unresolved offset -- NEVER silently substitutes {x:0,y:0}", () => {
      const bbox = { x: 10, y: 10, w: 5, h: 5 };
      assert.throws(() => translateBBox(bbox, null), /unresolved offset/);
      assert.throws(() => translateBBox(bbox, undefined), /unresolved offset/);
      assert.throws(() => translateBBox(bbox, {}), /unresolved offset/);
      assert.throws(() => translateBBox(bbox, { x: NaN, y: 0 }), /unresolved offset/);
    });

    test("a wrong-but-present offset value is still USED (this module only refuses UNRESOLVED, not merely 'possibly stale')", () => {
      // Documents the boundary of this module's responsibility: it cannot
      // know whether an offset value is *correct*, only whether it is
      // well-formed. Correctness (measuring the right iframe at the right
      // moment) is content.js's job -- see its frame-coordination notes.
      const bbox = { x: 0, y: 0, w: 1, h: 1 };
      assert.deepEqual(translateBBox(bbox, { x: 999, y: -999 }), { x: 999, y: -999, w: 1, h: 1 });
    });

    test("throws on a malformed bbox (missing/non-finite fields)", () => {
      const offset = { x: 1, y: 1 };
      assert.throws(() => translateBBox(null, offset), /well-formed/);
      assert.throws(() => translateBBox({ x: 1, y: 1, w: 1 }, offset), /well-formed/); // missing h
      assert.throws(() => translateBBox({ x: "1", y: 1, w: 1, h: 1 }, offset), /well-formed/);
    });
  });
});

describe("translateNodeBBoxes", () => {
  test("translates every node's .bbox by the same offset, preserving other fields", () => {
    const nodes = [
      { agentId: "agent-f7-1", piiType: "password", bbox: { x: 0, y: 0, w: 10, h: 10 } },
      { agentId: "agent-f7-2", piiType: "email", bbox: { x: 20, y: 20, w: 5, h: 5 } },
    ];
    const offset = { x: 100, y: 200 };
    const result = translateNodeBBoxes(nodes, offset);
    assert.deepEqual(result, [
      { agentId: "agent-f7-1", piiType: "password", bbox: { x: 100, y: 200, w: 10, h: 10 } },
      { agentId: "agent-f7-2", piiType: "email", bbox: { x: 120, y: 220, w: 5, h: 5 } },
    ]);
  });

  test("does not mutate the input array or its objects", () => {
    const nodes = [{ agentId: "a", bbox: { x: 0, y: 0, w: 1, h: 1 } }];
    const snapshot = JSON.parse(JSON.stringify(nodes));
    translateNodeBBoxes(nodes, { x: 50, y: 50 });
    assert.deepEqual(nodes, snapshot);
  });

  test("a node with no bbox is passed through unchanged, not thrown on", () => {
    const nodes = [{ agentId: "a", note: "no bbox here" }];
    assert.deepEqual(translateNodeBBoxes(nodes, { x: 1, y: 1 }), nodes);
  });

  test("non-array input degrades to an empty array rather than throwing", () => {
    assert.deepEqual(translateNodeBBoxes(null, { x: 0, y: 0 }), []);
    assert.deepEqual(translateNodeBBoxes(undefined, { x: 0, y: 0 }), []);
  });

  test("throws (FAIL LOUD) if any node HAS a bbox but the offset is unresolved", () => {
    const nodes = [{ agentId: "a", bbox: { x: 0, y: 0, w: 1, h: 1 } }];
    assert.throws(() => translateNodeBBoxes(nodes, null), /unresolved offset/);
  });

  test("an all-bbox-less array never throws, even with an unresolved offset -- nothing would be translated anyway", () => {
    const nodes = [{ agentId: "a" }, { agentId: "b" }];
    assert.deepEqual(translateNodeBBoxes(nodes, null), nodes);
  });
});

describe("translateFrameReport", () => {
  test("translates sensitiveNodes, domSnapshot, and unscannableRegions together by one offset", () => {
    const report = {
      sensitiveNodes: [{ agentId: "agent-f3-1", piiType: "password", bbox: { x: 1, y: 1, w: 1, h: 1 } }],
      domSnapshot: [{ agentId: "agent-f3-2", tag: "button", bbox: { x: 2, y: 2, w: 2, h: 2 } }],
      unscannableRegions: [{ agentId: null, tag: "custom-widget", bbox: { x: 3, y: 3, w: 3, h: 3 }, reason: "closed-shadow-root" }],
    };
    const offset = { x: 10, y: 10 };
    const result = translateFrameReport(report, offset);
    assert.deepEqual(result.sensitiveNodes[0].bbox, { x: 11, y: 11, w: 1, h: 1 });
    assert.deepEqual(result.domSnapshot[0].bbox, { x: 12, y: 12, w: 2, h: 2 });
    assert.deepEqual(result.unscannableRegions[0].bbox, { x: 13, y: 13, w: 3, h: 3 });
  });

  test("missing arrays on the report default to empty, not a throw", () => {
    const result = translateFrameReport({}, { x: 0, y: 0 });
    assert.deepEqual(result, { sensitiveNodes: [], domSnapshot: [], unscannableRegions: [] });
  });

  test("a null/undefined report is treated as fully empty", () => {
    assert.deepEqual(translateFrameReport(null, { x: 0, y: 0 }), {
      sensitiveNodes: [],
      domSnapshot: [],
      unscannableRegions: [],
    });
  });
});
