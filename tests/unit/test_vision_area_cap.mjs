// SIH 26171 -- regression tests for a REAL bug found from a live dumped
// image: a real `redactedRegions` capture on a 959x4862 full-page
// screenshot contained TWO vision boxes, both `rawType: "tv"`, one of
// them {x:63,y:45,w:873,h:4706} -- ~88-97% of the entire image. Varun
// opened the dumped PNG: "mostly black with some little white as border."
//
// ROOT CAUSE (see content.js's own comment above PRIVACY_RELEVANT_LABELS
// for the full account): the model's input IS a screenshot of a screen,
// so a COCO detector's "tv"/"tvmonitor"/"laptop"/"cell phone" classes
// structurally match the page itself (or any screen-shaped region in it)
// -- not an occasional tuning miss, a category mismatch with this
// project's own input distribution. The consequence is not cosmetic: a
// fully-blacked screenshot means the vision half of the pipeline
// contributes NOTHING while the run still reports success.
//
// THE FIX, exercised here, two independent parts:
//   1. Class-list change: PRIVACY_RELEVANT_LABELS now keeps ONLY
//      "person" and "book" (real photographed subjects vision alone can
//      catch) and drops "tv"/"tvmonitor"/"laptop"/"cell phone" (screen-
//      shaped rectangles that fire on the input itself).
//   2. Area sanity cap (filterBoxesByAreaCap): independent defense in
//      depth -- rejects any box (regardless of class) whose area, alone
//      or combined with other surviving boxes, exceeds a sane fraction of
//      the total screenshot area. Every rejection is logged.
//
// Neither redaction.js (painting logic) nor demo/ is touched or exercised
// by this file -- these are pure-function tests of content.js's own
// filterPrivacyRelevantBoxes()/filterBoxesByAreaCap(), evaluated via the
// SAME jsdom `window.eval(CONTENT_JS_SRC)` pattern test_frame_handshake.mjs
// already established for exercising content.js's real, unmodified,
// top-level function declarations (which attach to the eval'd window as
// plain properties in non-strict-mode indirect eval) without needing a
// real browser or a real extension runtime.
//
// Run with: node --test tests/unit/test_vision_area_cap.mjs

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIR = path.resolve(__dirname, "..", "..", "extension");
const CONTENT_JS_SRC = readFileSync(path.join(EXTENSION_DIR, "content.js"), "utf-8");

/**
 * Minimal browser.* mock -- just enough for content.js's top-level code to
 * evaluate without throwing (FRAME_HELLO round trip + onMessage.addListener
 * registration, the only two top-level browser.* calls in the file; see
 * test_frame_handshake.mjs's installBrowserMock() for the same pattern).
 * Nothing under test here ever exercises chrome.storage/tabs/etc., so
 * those are deliberately left unmocked.
 */
function installBrowserMock(window) {
  window.browser = {
    runtime: {
      sendMessage: (msg) => {
        if (msg && msg.type === "FRAME_HELLO") {
          return Promise.resolve({ type: "FRAME_HELLO_ACK", frameId: 0 });
        }
        return Promise.resolve(undefined);
      },
      onMessage: { addListener: () => {} },
      getURL: (p) => pathToFileURL(path.join(EXTENSION_DIR, p)).href,
    },
  };
}

function freshWindow() {
  const virtualConsole = new VirtualConsole().sendTo(console, { omitJSDOMErrors: true });
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://fixture.example/",
    runScripts: "outside-only",
    virtualConsole,
  });
  installBrowserMock(dom.window);
  dom.window.eval(CONTENT_JS_SRC);
  return dom.window;
}

/** Build a vision-box fixture in the {label, score, xmin, ymin, xmax, ymax} contract shape. */
function box(label, xmin, ymin, xmax, ymax, score = 0.9) {
  return { label, score, xmin, ymin, xmax, ymax };
}

// ===========================================================================
// 1. Class-list change: PRIVACY_RELEVANT_LABELS keeps person/book only.
// ===========================================================================
describe("filterPrivacyRelevantBoxes(): class-list change (drop tv/tvmonitor/laptop/cell phone, keep person/book)", () => {
  let window;
  beforeEach(() => {
    window = freshWindow();
  });

  test("person is kept -- this is what makes the ID-card demo fire", () => {
    const boxes = [box("person", 100, 100, 200, 300)];
    const result = window.filterPrivacyRelevantBoxes(boxes);
    assert.equal(result.length, 1);
    assert.equal(result[0].label, "person");
  });

  test("book is kept", () => {
    const boxes = [box("book", 50, 50, 150, 250)];
    const result = window.filterPrivacyRelevantBoxes(boxes);
    assert.equal(result.length, 1);
  });

  test("case-insensitive matching still applies to the surviving classes", () => {
    const boxes = [box("Person", 0, 0, 10, 10), box("BOOK", 0, 0, 10, 10)];
    const result = window.filterPrivacyRelevantBoxes(boxes);
    assert.equal(result.length, 2);
  });

  test("tv is DROPPED -- the real bug's exact rawType", () => {
    const boxes = [box("tv", 63, 45, 936, 4751)];
    assert.deepEqual(window.filterPrivacyRelevantBoxes(boxes), []);
  });

  test("tvmonitor is DROPPED (the class-name-trap alias for a different candidate model)", () => {
    const boxes = [box("tvmonitor", 0, 0, 500, 500)];
    assert.deepEqual(window.filterPrivacyRelevantBoxes(boxes), []);
  });

  test("laptop is DROPPED", () => {
    const boxes = [box("laptop", 0, 0, 500, 500)];
    assert.deepEqual(window.filterPrivacyRelevantBoxes(boxes), []);
  });

  test("cell phone is DROPPED", () => {
    const boxes = [box("cell phone", 0, 0, 100, 200)];
    assert.deepEqual(window.filterPrivacyRelevantBoxes(boxes), []);
  });

  test("an unrelated COCO class (couch) was never included and stays excluded", () => {
    const boxes = [box("couch", 0, 0, 500, 500)];
    assert.deepEqual(window.filterPrivacyRelevantBoxes(boxes), []);
  });

  test("a mixed batch keeps only person/book, dropping tv/laptop/cell phone/couch", () => {
    const boxes = [
      box("tv", 0, 0, 900, 900),
      box("person", 100, 100, 200, 300),
      box("laptop", 10, 10, 400, 300),
      box("book", 500, 500, 600, 650),
      box("cell phone", 20, 20, 80, 150),
      box("couch", 0, 0, 900, 400),
    ];
    const result = window.filterPrivacyRelevantBoxes(boxes);
    assert.deepEqual(
      result.map((b) => b.label),
      ["person", "book"]
    );
  });
});

// ===========================================================================
// 2. Area sanity cap.
// ===========================================================================
describe("filterBoxesByAreaCap(): single-box cap", () => {
  let window;
  beforeEach(() => {
    window = freshWindow();
  });

  test("REGRESSION: the real bug's exact box (959x4862 image, box covering ~88% of it) is REJECTED", () => {
    // Real evidence from CLAUDE.md / the bug report: bbox {x:63,y:45,w:873,h:4706}
    // on a 959x4862 image -> xmax = 63+873 = 936, ymax = 45+4706 = 4751.
    const boxes = [box("tv", 63, 45, 936, 4751)];
    const result = window.filterBoxesByAreaCap(boxes, { width: 959, height: 4862 });
    assert.deepEqual(result, [], "a box covering ~88% of the image must be rejected by the 50% single-box cap");
  });

  test("REGRESSION: the real bug's second box ({x:90,y:41,w:838,h:2801}) is also REJECTED", () => {
    const boxes = [box("tv", 90, 41, 928, 2842)];
    const result = window.filterBoxesByAreaCap(boxes, { width: 959, height: 4862 });
    assert.deepEqual(result, []);
  });

  test("a normal-sized box (ID-card-shaped, ~10% of a 1000x1000 image) is KEPT", () => {
    const boxes = [box("person", 100, 100, 400, 400)]; // 300x300 = 90,000 / 1,000,000 = 9%
    const result = window.filterBoxesByAreaCap(boxes, { width: 1000, height: 1000 });
    assert.equal(result.length, 1);
    assert.equal(result[0], boxes[0]);
  });

  test("a box at exactly the 50% boundary is KEPT (strictly-greater-than rejection, not >=)", () => {
    const boxes = [box("person", 0, 0, 500, 1000)]; // 500,000 / 1,000,000 = exactly 50%
    const result = window.filterBoxesByAreaCap(boxes, { width: 1000, height: 1000 });
    assert.equal(result.length, 1);
  });

  test("a box just over 50% is REJECTED", () => {
    const boxes = [box("person", 0, 0, 501, 1000)]; // 501,000 / 1,000,000 = 50.1%
    const result = window.filterBoxesByAreaCap(boxes, { width: 1000, height: 1000 });
    assert.deepEqual(result, []);
  });

  test("rejection is logged with the offending box's label/score/fraction (never silent)", () => {
    const originalWarn = window.console.warn;
    const calls = [];
    window.console.warn = (...args) => calls.push(args);
    try {
      const boxes = [box("tv", 0, 0, 900, 900, 0.77)];
      window.filterBoxesByAreaCap(boxes, { width: 1000, height: 1000 });
    } finally {
      window.console.warn = originalWarn;
    }
    assert.equal(calls.length, 1, "exactly one rejection must produce exactly one console.warn call");
    const [message, loggedBox] = calls[0];
    assert.match(message, /REJECTED vision box/);
    assert.match(message, /label=tv/);
    assert.match(message, /score=0\.77/);
    assert.match(message, /81\.0%/); // 810,000 / 1,000,000
    assert.equal(loggedBox.label, "tv");
  });
});

describe("filterBoxesByAreaCap(): combined-area cap", () => {
  let window;
  beforeEach(() => {
    window = freshWindow();
  });

  test("three boxes, each individually under the 50% single cap, whose SUM exceeds the 65% combined cap -- the smallest survive, the largest is rejected", () => {
    // 1000x1000 image (area 1,000,000). A=30%, B=32%, C=34%. Each is under
    // the 50% single-box cap on its own. Smallest-first: A(30)+B(32)=62%
    // <=65% -- both kept. Adding C would make 62+34=96% > 65% -- rejected.
    const A = box("person", 0, 0, 300, 1000, 0.9); // 300,000 = 30%
    const B = box("person", 0, 0, 320, 1000, 0.9); // 320,000 = 32%
    const C = box("person", 0, 0, 340, 1000, 0.9); // 340,000 = 34%
    const result = window.filterBoxesByAreaCap([A, B, C], { width: 1000, height: 1000 });
    assert.deepEqual(result, [A, B], "A and B (the two smaller boxes) survive; C (the largest) is rejected");
  });

  test("original relative order is preserved among survivors, even though selection is computed smallest-first internally", () => {
    // Same three boxes as above, but passed in a DIFFERENT input order --
    // the survivors must come back in THEIR ORIGINAL order (C, A, B minus
    // the rejected C -> [A, B]), never reshuffled to size order.
    const A = box("person", 0, 0, 300, 1000, 0.9);
    const B = box("person", 0, 0, 320, 1000, 0.9);
    const C = box("person", 0, 0, 340, 1000, 0.9);
    const result = window.filterBoxesByAreaCap([C, A, B], { width: 1000, height: 1000 });
    assert.deepEqual(result, [A, B]);
  });

  test("combined rejection is ALSO logged, distinctly from a single-box-cap rejection", () => {
    const A = box("person", 0, 0, 300, 1000, 0.9);
    const B = box("person", 0, 0, 320, 1000, 0.9);
    const C = box("person", 0, 0, 340, 1000, 0.9);
    const calls = [];
    const originalWarn = window.console.warn;
    window.console.warn = (...args) => calls.push(args);
    try {
      window.filterBoxesByAreaCap([A, B, C], { width: 1000, height: 1000 });
    } finally {
      window.console.warn = originalWarn;
    }
    assert.equal(calls.length, 1, "only C should be rejected -- exactly one warning");
    assert.match(calls[0][0], /COMBINED redacted area/);
  });

  test("boxes that together stay at/under 65% are ALL kept (no over-eager rejection)", () => {
    const A = box("person", 0, 0, 300, 1000); // 30%
    const B = box("book", 0, 0, 350, 1000); // 35% -> combined 65%, exactly at the cap
    const result = window.filterBoxesByAreaCap([A, B], { width: 1000, height: 1000 });
    assert.deepEqual(result, [A, B]);
  });
});

describe("filterBoxesByAreaCap(): degenerate inputs never crash and never over-reject", () => {
  let window;
  beforeEach(() => {
    window = freshWindow();
  });

  test("empty box list returns empty, no image-dims lookup needed", () => {
    assert.deepEqual(window.filterBoxesByAreaCap([], { width: 1000, height: 1000 }), []);
  });

  test("missing/invalid image dimensions degrade to 'keep everything' (never silently reject due to a missing input that isn't the detector's fault)", () => {
    const boxes = [box("person", 0, 0, 900, 900)];
    assert.deepEqual(window.filterBoxesByAreaCap(boxes, null), boxes);
    assert.deepEqual(window.filterBoxesByAreaCap(boxes, { width: 0, height: 1000 }), boxes);
    assert.deepEqual(window.filterBoxesByAreaCap(boxes, { width: NaN, height: 1000 }), boxes);
    assert.deepEqual(window.filterBoxesByAreaCap(boxes, undefined), boxes);
  });

  test("a box with non-finite coordinates is treated as zero-area (never wrongly rejected by this cap; buildRedactedRegions()'s own isUsableVisionBox() is the real gate for malformed boxes)", () => {
    const malformed = { label: "person", score: 0.9, xmin: 0, ymin: 0, xmax: NaN, ymax: 100 };
    const result = window.filterBoxesByAreaCap([malformed], { width: 1000, height: 1000 });
    assert.deepEqual(result, [malformed]);
  });
});

// ===========================================================================
// 3. End-to-end (within this file's scope): class filter THEN area cap,
// mirroring the exact call-site order in runAgentLoop() -- proves the two
// independent fixes compose correctly and that a small, legitimate
// "person" detection (standing in for the ID-card demo) survives both.
// ===========================================================================
describe("class filter + area cap composed, in the same order content.js's runAgentLoop() calls them", () => {
  let window;
  beforeEach(() => {
    window = freshWindow();
  });

  test("the real bug's page-covering 'tv' box is caught TWICE over (dropped by class filter alone, and would also fail the area cap)", () => {
    const pageWideTvBox = box("tv", 63, 45, 936, 4751);
    const classFiltered = window.filterPrivacyRelevantBoxes([pageWideTvBox]);
    assert.deepEqual(classFiltered, [], "class filter alone already removes it");
    // Belt-and-suspenders: even if some future change put "tv" back on the
    // allowlist, the area cap independently rejects this exact box.
    const areaFiltered = window.filterBoxesByAreaCap([pageWideTvBox], { width: 959, height: 4862 });
    assert.deepEqual(areaFiltered, []);
  });

  test("an ID-card-shaped 'person' box (small area, well within a viewport) survives BOTH filters -- the headline vision demo keeps working", () => {
    // Stands in for demo/test-page.html's ID-card face: a small person-shaped
    // box within a normal 1280x800-ish viewport screenshot.
    const idCardFace = box("person", 550, 300, 650, 430, 0.93); // 100x130 = 13,000 / (1280*800=1,024,000) ~= 1.3%
    const imageDims = { width: 1280, height: 800 };
    const classFiltered = window.filterPrivacyRelevantBoxes([idCardFace]);
    assert.equal(classFiltered.length, 1);
    const areaFiltered = window.filterBoxesByAreaCap(classFiltered, imageDims);
    assert.deepEqual(areaFiltered, [idCardFace]);
  });

  test("a 'laptop' box roughly the size of the ID-card face is dropped by the CLASS filter alone, before area is ever considered", () => {
    const laptopBox = box("laptop", 550, 300, 650, 430, 0.8);
    const classFiltered = window.filterPrivacyRelevantBoxes([laptopBox]);
    assert.deepEqual(classFiltered, [], "laptop is off the allowlist regardless of size");
  });
});
