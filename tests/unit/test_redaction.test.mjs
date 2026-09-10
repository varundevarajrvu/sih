/**
 * Unit tests for extension/lib/redaction.js (Phase 2b, redaction-engine).
 *
 * Run with: node --test tests/unit/test_redaction.test.mjs
 * (Node's built-in test runner -- zero extra test-runner dependency, and
 * this file is entirely independent of any browser/extension runtime.)
 *
 * Canvas-in-Node: image drawing/pixel-sampling here is backed by
 * @napi-rs/canvas (installed as a devDependency of extension/, see
 * extension/package.json) via tests/fixtures/redaction/fixture.mjs. The
 * module under test (extension/lib/redaction.js) has NO dependency on
 * it whatsoever -- @napi-rs/canvas is injected as `canvasFactory` /
 * `imageLoader`, exactly the dependency-injection seam the module was
 * designed around, so production code (running in a real offscreen
 * document / content script) never touches this package.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  redact,
  buildRedactedRegions,
  paintRegionsOnImage,
  sanitizeDomSnapshot,
  normalizePiiType,
  KNOWN_PII_TYPES,
} from "../../extension/lib/redaction.js";

import {
  WIDTH,
  HEIGHT,
  BACKGROUND_RGB,
  FILL_RGB,
  SCALE_FACTOR,
  DOM_NODE_PASSWORD,
  DOM_NODE_EMAIL,
  DOM_NODE_UNKNOWN_TYPE_OFFCANVAS,
  DOM_NODE_NO_BBOX,
  VISION_BOX_PHONE,
  VISION_BOX_BOOK,
  REGION_A_CORRECT,
  REGION_A_WRONG_IF_UNSCALED,
  REGION_B,
  REGION_P,
  REGION_Q,
  REGION_UNKNOWN_OFFCANVAS,
  allVisionBoxes,
  allDomNodes,
  buildFixtureScreenshotBase64,
  makeNodeCanvasAdapters,
  decodePngForSampling,
} from "../fixtures/redaction/fixture.mjs";

function expectColor(actual, expected, { tolerance = 2, label = "" } = {}) {
  const [r, g, b] = actual;
  const [er, eg, eb] = expected;
  const close = Math.abs(r - er) <= tolerance && Math.abs(g - eg) <= tolerance && Math.abs(b - eb) <= tolerance;
  assert.ok(
    close,
    `${label} pixel mismatch: expected ~[${er},${eg},${eb}], got [${r},${g},${b}]`
  );
}

function centerOf(region, inset = 4) {
  return { x: region.x + Math.max(inset, region.w / 2 - 1), y: region.y + Math.max(inset, region.h / 2 - 1) };
}

// ---------------------------------------------------------------------------
// normalizePiiType
// ---------------------------------------------------------------------------

describe("normalizePiiType", () => {
  test("known PiiType values pass through unchanged, no rawType", () => {
    for (const known of KNOWN_PII_TYPES) {
      const { type, rawType } = normalizePiiType(known);
      assert.equal(type, known);
      assert.equal(rawType, undefined);
    }
  });

  test("unknown label degrades to 'other' and preserves the original string as rawType", () => {
    const { type, rawType } = normalizePiiType("cell phone");
    assert.equal(type, "other");
    assert.equal(rawType, "cell phone");
  });

  test("null/undefined label degrades to 'other' with rawType left absent (not 'null'/'undefined' strings)", () => {
    assert.deepEqual(normalizePiiType(null), { type: "other", rawType: undefined });
    assert.deepEqual(normalizePiiType(undefined), { type: "other", rawType: undefined });
  });
});

// ---------------------------------------------------------------------------
// buildRedactedRegions -- pure merge/normalize logic, no canvas involved
// ---------------------------------------------------------------------------

describe("buildRedactedRegions (pure, no canvas)", () => {
  test("empty inputs produce an empty array", () => {
    assert.deepEqual(buildRedactedRegions([], []), []);
    assert.deepEqual(buildRedactedRegions(), []);
  });

  test("vision box: label -> type 'other' + rawType, bbox converted from xmin/ymin/xmax/ymax, no agentId key", () => {
    const [region] = buildRedactedRegions([VISION_BOX_PHONE], []);
    assert.equal(region.type, "other");
    assert.equal(region.rawType, "cell phone");
    assert.deepEqual(region.bbox, REGION_B);
    assert.equal("agentId" in region, false, "vision-only region must not invent an agentId");
  });

  test("vision box is NEVER scaled by scaleFactor, regardless of its value", () => {
    const r1 = buildRedactedRegions([VISION_BOX_PHONE], [], { scaleFactor: 1 })[0];
    const r2 = buildRedactedRegions([VISION_BOX_PHONE], [], { scaleFactor: 3 })[0];
    assert.deepEqual(r1.bbox, REGION_B);
    assert.deepEqual(r2.bbox, REGION_B);
  });

  test("DOM node with known piiType: bbox scaled by scaleFactor, agentId included, no rawType key", () => {
    const [region] = buildRedactedRegions([], [DOM_NODE_PASSWORD], { scaleFactor: SCALE_FACTOR });
    assert.equal(region.type, "password");
    assert.equal("rawType" in region, false);
    assert.equal(region.agentId, "agent-1");
    assert.deepEqual(region.bbox, REGION_A_CORRECT);
  });

  test("DEVICEPIXELRATIO REGRESSION: DOM bbox with scaleFactor=1 does NOT match the correct HiDPI-scaled location", () => {
    // If a caller forgets to pass the real scaleFactor, the region lands
    // at the raw CSS-pixel coordinates -- demonstrably NOT where it needs
    // to be on a HiDPI capture. This is the exact silent-misplacement
    // hazard flagged in redaction.js's file header.
    const [region] = buildRedactedRegions([], [DOM_NODE_PASSWORD], { scaleFactor: 1 });
    assert.deepEqual(region.bbox, REGION_A_WRONG_IF_UNSCALED);
    assert.notDeepEqual(region.bbox, REGION_A_CORRECT);
  });

  test("unknown DOM piiType degrades to 'other' + rawType, bbox still scaled correctly even off-canvas", () => {
    const [region] = buildRedactedRegions([], [DOM_NODE_UNKNOWN_TYPE_OFFCANVAS], { scaleFactor: SCALE_FACTOR });
    assert.equal(region.type, "other");
    assert.equal(region.rawType, "weird-unlisted-type");
    assert.deepEqual(region.bbox, REGION_UNKNOWN_OFFCANVAS);
  });

  test("DOM node without a usable bbox is skipped, not thrown on", () => {
    const regions = buildRedactedRegions([], [DOM_NODE_NO_BBOX]);
    assert.deepEqual(regions, []);
  });

  test("malformed vision box (missing coordinate) is skipped, not thrown on", () => {
    const regions = buildRedactedRegions([{ label: "x", xmin: 1, ymin: 1, xmax: 5 /* no ymax */ }], []);
    assert.deepEqual(regions, []);
  });

  test("invalid scaleFactor (<=0, NaN, non-number) throws rather than silently defaulting", () => {
    for (const bad of [0, -1, NaN, "2", null]) {
      assert.throws(() => buildRedactedRegions([], [DOM_NODE_PASSWORD], { scaleFactor: bad }));
    }
  });

  test("merging does not deduplicate overlapping boxes -- both are kept (over-redaction preference)", () => {
    const regions = buildRedactedRegions([VISION_BOX_BOOK], [DOM_NODE_EMAIL], { scaleFactor: SCALE_FACTOR });
    assert.equal(regions.length, 2);
  });
});

// ---------------------------------------------------------------------------
// redact() end-to-end: Section 6 checkpoint --
// "Feed it a fixture image + fixture boxes, confirm output PNG visibly
//  blacks out the right regions and redactedRegions matches."
// ---------------------------------------------------------------------------

describe("redact() checkpoint: fixture image + fixture boxes -> correct PNG + correct redactedRegions", () => {
  test("produces the right pixels and the right metadata", async () => {
    const screenshotBase64 = await buildFixtureScreenshotBase64();
    const { canvasFactory, imageLoader } = makeNodeCanvasAdapters();

    const result = await redact(screenshotBase64, allVisionBoxes(), allDomNodes(), {
      scaleFactor: SCALE_FACTOR,
      canvasFactory,
      imageLoader,
    });

    assert.equal(typeof result.redactedImage, "string");
    assert.ok(result.redactedImage.length > 0);
    assert.ok(!result.redactedImage.startsWith("data:"), "redactedImage must be raw base64, no data: prefix");

    // 5 regions expected: 2 vision (phone, book) + 3 DOM (password, email,
    // unknown-offcanvas) -- the no-bbox DOM node must be excluded.
    assert.equal(result.redactedRegions.length, 5);
    assert.ok(!result.redactedRegions.some((r) => r.agentId === "agent-4"));

    const passwordRegion = result.redactedRegions.find((r) => r.agentId === "agent-1");
    assert.deepEqual(passwordRegion.bbox, REGION_A_CORRECT);
    assert.equal(passwordRegion.type, "password");

    const phoneRegion = result.redactedRegions.find((r) => r.rawType === "cell phone");
    assert.equal(phoneRegion.type, "other");
    assert.deepEqual(phoneRegion.bbox, REGION_B);
    assert.equal("agentId" in phoneRegion, false);

    const unknownRegion = result.redactedRegions.find((r) => r.agentId === "agent-5");
    assert.equal(unknownRegion.type, "other");
    assert.equal(unknownRegion.rawType, "weird-unlisted-type");
    assert.deepEqual(unknownRegion.bbox, REGION_UNKNOWN_OFFCANVAS, "off-canvas region metadata must be reported unclamped");

    // --- Pixel verification: sample INSIDE each redacted rect ---
    const sampler = await decodePngForSampling(result.redactedImage);
    assert.equal(sampler.width, WIDTH);
    assert.equal(sampler.height, HEIGHT);

    const insideA = centerOf(REGION_A_CORRECT);
    expectColor(sampler.pixelAt(insideA.x, insideA.y), FILL_RGB, { label: "inside region A (password, scaled)" });

    const insideB = centerOf(REGION_B);
    expectColor(sampler.pixelAt(insideB.x, insideB.y), FILL_RGB, { label: "inside region B (vision, unscaled)" });

    // Overlap test: P (DOM, scaled) and Q (vision, unscaled) overlap.
    // Sample a point unique to each, plus the overlap zone -- all three
    // must be black, proving neither box was dropped/replaced by the other.
    expectColor(sampler.pixelAt(20, 130), FILL_RGB, { label: "inside P only (non-overlap)" });
    expectColor(sampler.pixelAt(90, 150), FILL_RGB, { label: "inside Q only (non-overlap)" });
    expectColor(sampler.pixelAt(60, 150), FILL_RGB, { label: "inside P and Q overlap" });

    // --- DEVICEPIXELRATIO REGRESSION CHECK (the core hazard) ---
    // If DOM bbox scaling were skipped or wrong, this point (which sits
    // inside the UNSCALED CSS-pixel interpretation of the password
    // field's box, but outside the CORRECTLY scaled one) would have been
    // wrongly painted black. It must remain background.
    expectColor(sampler.pixelAt(15, 15), BACKGROUND_RGB, {
      label: "must NOT be redacted -- proves scaleFactor was applied correctly, not skipped",
    });

    // --- Over-redaction sanity check: we did NOT paint the whole image ---
    expectColor(sampler.pixelAt(5, 5), BACKGROUND_RGB, { label: "far corner, must be untouched" });
    expectColor(sampler.pixelAt(210, 165), BACKGROUND_RGB, { label: "opposite corner, must be untouched" });
    expectColor(sampler.pixelAt(130, 90), BACKGROUND_RGB, { label: "middle background gap, must be untouched" });
  });

  test("no canvasFactory/imageLoader in a plain Node context throws a helpful, non-silent error", async () => {
    const screenshotBase64 = await buildFixtureScreenshotBase64();
    await assert.rejects(
      () => paintRegionsOnImage(screenshotBase64, [], {}),
      /canvasFactory|imageLoader|no canvas implementation|no image decoder/i
    );
  });
});

// ---------------------------------------------------------------------------
// Error paths are data egress paths -- assert on the actual message/log
// bytes, not just that something threw (lesson recorded from Phase 2c).
// ---------------------------------------------------------------------------

describe("error paths never leak sensitive/raw data", () => {
  test("corrupt image bytes: rejection message never echoes the input bytes", async () => {
    const sentinel = "TOTALLY_NOT_A_PNG_" + "X".repeat(64);
    const { canvasFactory, imageLoader } = makeNodeCanvasAdapters();

    await assert.rejects(async () => {
      try {
        await paintRegionsOnImage(sentinel, [], { canvasFactory, imageLoader });
      } catch (err) {
        assert.ok(!err.message.includes(sentinel), "error message must not echo the raw input bytes");
        assert.ok(!err.stack || !err.stack.includes(sentinel), "stack must not echo the raw input bytes");
        throw err;
      }
    });
  });

  test("a throwing canvasFactory never lets its internal error message (which might carry sensitive detail) reach the caller", async () => {
    const secret = "SECRET_MARKER_hunter2_do_not_leak";
    const screenshotBase64 = await buildFixtureScreenshotBase64();
    const { imageLoader } = makeNodeCanvasAdapters();
    const leakyCanvasFactory = async () => {
      throw new Error(`internal failure, payload was: ${secret}`);
    };

    await assert.rejects(async () => {
      try {
        await paintRegionsOnImage(screenshotBase64, [], { canvasFactory: leakyCanvasFactory, imageLoader });
      } catch (err) {
        assert.ok(!err.message.includes(secret), "canvasFactory's internal error text must not propagate");
        throw err;
      }
    });
  });

  test("a throwing imageLoader never lets its internal error message reach the caller", async () => {
    const secret = "SECRET_MARKER_aadhaar_1234_do_not_leak";
    const screenshotBase64 = await buildFixtureScreenshotBase64();
    const leakyImageLoader = async () => {
      throw new Error(`decode failed near byte containing ${secret}`);
    };

    await assert.rejects(async () => {
      try {
        await paintRegionsOnImage(screenshotBase64, [], { imageLoader: leakyImageLoader, canvasFactory: makeNodeCanvasAdapters().canvasFactory });
      } catch (err) {
        assert.ok(!err.message.includes(secret));
        throw err;
      }
    });
  });

  test("failure never resolves with a fabricated/unredacted success payload", async () => {
    const screenshotBase64 = await buildFixtureScreenshotBase64();
    let resolved = false;
    try {
      await paintRegionsOnImage(screenshotBase64, [], {
        canvasFactory: async () => {
          throw new Error("boom");
        },
        imageLoader: makeNodeCanvasAdapters().imageLoader,
      });
      resolved = true;
    } catch {
      // expected
    }
    assert.equal(resolved, false, "a failed redaction pass must reject, never resolve with any payload");
  });

  test("no console.* call during a forced failure ever contains the sensitive marker", async () => {
    const secret = "SECRET_MARKER_console_leak_check";
    const original = { log: console.log, warn: console.warn, error: console.error };
    const captured = [];
    console.log = (...args) => captured.push(args);
    console.warn = (...args) => captured.push(args);
    console.error = (...args) => captured.push(args);
    try {
      const screenshotBase64 = await buildFixtureScreenshotBase64();
      try {
        await paintRegionsOnImage(screenshotBase64, [], {
          canvasFactory: async () => {
            throw new Error(`leaky: ${secret}`);
          },
          imageLoader: makeNodeCanvasAdapters().imageLoader,
        });
      } catch {
        // expected
      }
    } finally {
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
    }
    const flat = JSON.stringify(captured);
    assert.ok(!flat.includes(secret), "no console output during the failure path may contain the sensitive marker");
  });
});

// ---------------------------------------------------------------------------
// sanitizeDomSnapshot -- DOM-JSON redaction half (strip before serialize)
// ---------------------------------------------------------------------------

describe("sanitizeDomSnapshot (DOM-JSON redaction, no canvas involved)", () => {
  const rawSnapshot = () => [
    {
      agentId: "agent-1",
      tag: "input",
      role: "textbox",
      type: "password",
      text: "hunter2",
      bbox: { x: 10, y: 100, w: 200, h: 30 },
      sensitive: true,
    },
    {
      agentId: "agent-2",
      tag: "button",
      role: "button",
      type: "submit",
      text: "Log in",
      bbox: { x: 10, y: 140, w: 80, h: 30 },
      sensitive: false,
    },
    {
      // Phase 2a "sensitiveNodes"-shaped entry: piiType present, `sensitive`
      // never explicitly set -- defense-in-depth fallback must still strip it.
      agentId: "agent-3",
      tag: "input",
      type: "email",
      piiType: "email",
      text: "someone@example.com",
      bbox: { x: 10, y: 180, w: 200, h: 30 },
    },
  ];

  test("sensitive:true node has its text stripped to null; other fields untouched", () => {
    const [out] = sanitizeDomSnapshot(rawSnapshot());
    assert.equal(out.text, null);
    assert.equal(out.sensitive, true);
    assert.equal(out.agentId, "agent-1");
    assert.equal(out.tag, "input");
    assert.equal(out.role, "textbox");
    assert.equal(out.type, "password");
    assert.deepEqual(out.bbox, { x: 10, y: 100, w: 200, h: 30 });
  });

  test("non-sensitive node passes through with equal content but is a new object (not the same reference)", () => {
    const input = rawSnapshot();
    const [, out] = sanitizeDomSnapshot(input);
    assert.deepEqual(out, input[1]);
    assert.notEqual(out, input[1]);
  });

  test("defense in depth: a node with piiType but no explicit sensitive=true is still stripped, and sensitive is forced true", () => {
    const [, , out] = sanitizeDomSnapshot(rawSnapshot());
    assert.equal(out.text, null);
    assert.equal(out.sensitive, true);
  });

  test("does not mutate the input array or its objects", () => {
    const input = rawSnapshot();
    const before = JSON.stringify(input);
    sanitizeDomSnapshot(input);
    assert.equal(JSON.stringify(input), before);
  });

  test("output never introduces a key beyond input's own keys plus `sensitive` (server DomNode schema is extra='forbid')", () => {
    // sanitizeDomNode is allowed to *add* `sensitive` when it was absent on
    // input (it's a real, optional-with-default server/schemas.py DomNode
    // field, not a foreign one) -- what it must never do is invent any
    // OTHER key that wasn't already on the input node, which would make
    // the server 422 the whole request (extra="forbid") if that leaked
    // into a real domSnapshot payload.
    const input = rawSnapshot();
    const output = sanitizeDomSnapshot(input);
    output.forEach((node, i) => {
      const allowed = new Set([...Object.keys(input[i]), "sensitive"]);
      for (const key of Object.keys(node)) {
        assert.ok(allowed.has(key), `unexpected key "${key}" on sanitized node ${i}`);
      }
    });
  });

  test("handles missing optional fields without throwing", () => {
    const out = sanitizeDomSnapshot([{ agentId: "agent-9", tag: "div", sensitive: true }]);
    assert.equal(out.length, 1);
    assert.equal(out[0].agentId, "agent-9");
  });

  test("empty array in, empty array out", () => {
    assert.deepEqual(sanitizeDomSnapshot([]), []);
    assert.deepEqual(sanitizeDomSnapshot(), []);
  });

  test("non-array input throws", () => {
    assert.throws(() => sanitizeDomSnapshot({ not: "an array" }));
  });
});
