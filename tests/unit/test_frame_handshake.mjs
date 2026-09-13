// SIH 26171 -- real-site hardening pass, follow-up: regression test for the
// PRIVACY BUG found in a real browser run on demo/frames-test.html:
//
//   framesReported: 2, framesMerged: 0, framesDropped: 2 -- identical on
//   every step, never self-healing.
//
// ROOT CAUSE (see content.js's own updated comments at the SIH_FRAME_TOKEN
// announce site and collectAndMergeSubframeReports() for the full account):
// a subframe announces its geometry-correlation token to its parent via
// `window.parent.postMessage(...)` EXACTLY ONCE, synchronously, the moment
// its own content.js finishes evaluating. postMessage delivery is NOT
// queued for a "message" listener that doesn't exist yet -- if the TOP
// frame's own content.js (which registers that listener) hasn't reached
// that line yet at the exact moment the child's message is dispatched, the
// message is delivered into a frame with zero listeners and is gone
// forever. There is no cross-frame ordering guarantee between two
// different documents' own `document_idle` timings, so a heavier top page
// (more inline script, e.g. demo/frames-test.html's ruler-building code)
// can easily still be initializing while a lighter iframe has already
// fired its one and only announcement. Nothing ever resent it, so the
// resulting drop was PERMANENT for the rest of that page load -- exactly
// matching the real run's evidence (identical numbers on every step, not a
// transient race that a later step would self-heal).
//
// WHY THIS CANNOT BE A frame-coords.js UNIT TEST: that module's own 19
// tests (test_frame_coords.test.mjs) are pure {x,y,w,h} arithmetic -- the
// bug never reaches translateBBox() at all. collectAndMergeSubframeReports()
// drops the report BEFORE calling into frame-coords.js (see the `if
// (!iframeEl)` branch). The defect is a TIMING/ORDERING hazard between two
// genuinely separate window realms -- only a test that constructs two real
// realms and controls the relative timing of "child announces" vs "parent
// starts listening" can see it. This file builds exactly that.
//
// HOW: a jsdom PARENT document with a REAL nested <iframe> (jsdom does
// implement working parent/child Window references -- verified separately;
// `iframe.contentWindow.parent === outerWindow` and
// `iframe.contentWindow.top === outerWindow` both hold). content.js's OWN,
// UNMODIFIED source is evaluated into BOTH realms via `window.eval()`,
// exactly like test_action_executor.test.mjs evaluates action-executor.js
// inside a jsdom window's own realm -- this runs the real shipped code,
// not a reimplementation.
//
// jsdom's own cross-window postMessage() does not populate
// MessageEvent.source (verified: it delivers `null` there) -- a jsdom
// limitation, not a defect in the code under test (CLAUDE.md's own TIER 1
// notes call `MessageEvent.source` "a browser-guaranteed, unspoofable
// WindowProxy reference" -- real Chrome gets this right; jsdom does not).
// Both realms' `postMessage` are patched to deliver an equivalent,
// correctly-sourced MessageEvent, still asynchronously (setTimeout 0, same
// task-queue semantics) so the actual thing under test -- retry/ordering
// timing -- is unaffected; only jsdom's missing `.source` field is
// corrected so content.js's REAL `f.contentWindow === event.source`
// matching logic can be exercised faithfully.
//
// Run with: node --test tests/unit/test_frame_handshake.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIR = path.resolve(__dirname, "..", "..", "extension");
const CONTENT_JS_SRC = readFileSync(path.join(EXTENSION_DIR, "content.js"), "utf-8");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Patch `targetWindow.postMessage` so cross-window delivery produces a
 * correctly-sourced MessageEvent (see file header for why this is needed
 * to work around a jsdom limitation, not a code-under-test one). Records
 * every send (before the async dispatch) into `sentLog` for assertions.
 */
function patchPostMessage(targetWindow, getSourceWindow, sentLog) {
  targetWindow.postMessage = function (data) {
    sentLog.push({ data, at: Date.now() });
    setTimeout(() => {
      const ev = new targetWindow.MessageEvent("message", { data, source: getSourceWindow() });
      targetWindow.dispatchEvent(ev);
    }, 0);
  };
}

/**
 * Minimal browser.runtime mock. `getURL` resolves to REAL file:// URLs
 * pointing at the actual extension/lib/*.js modules (verified separately
 * that dynamic `import()` of a real file:// URL works inside a jsdom
 * `window.eval()`'d classic script under Node's `vm` module) -- so
 * `loadLibModules()` loads the REAL, unmodified frame-coords.js/
 * dom-scanner.js/etc., not stubs, wherever this test lets it run.
 */
function installBrowserMock(window, { frameId, onCollectFrameReports } = {}) {
  window.browser = {
    runtime: {
      sendMessage: (msg) => {
        if (msg && msg.type === "FRAME_HELLO") {
          return Promise.resolve({ type: "FRAME_HELLO_ACK", frameId: typeof frameId === "number" ? frameId : 0 });
        }
        if (msg && msg.type === "COLLECT_FRAME_REPORTS") {
          return Promise.resolve(onCollectFrameReports ? onCollectFrameReports() : { frameReports: [] });
        }
        return Promise.resolve(undefined);
      },
      onMessage: { addListener: () => {} },
      getURL: (p) => pathToFileURL(path.join(EXTENSION_DIR, p)).href,
    },
  };
}

function freshVirtualConsole() {
  // omitJSDOMErrors: true -- same rationale as test_action_executor.test.mjs's
  // freshDom(): silences jsdom's "not implemented" noise unrelated to what
  // this file tests; real console.log/warn/error from content.js itself
  // still comes through (and this suite deliberately reads some of it).
  return new VirtualConsole().sendTo(console, { omitJSDOMErrors: true });
}

/**
 * jsdom does not implement real CSS layout -- every element's
 * getBoundingClientRect() returns all zeros unconditionally. content.js's
 * defensive-redaction fallback deliberately skips a {width<=0 || height<=0}
 * rect (nothing rendered, nothing to leak -- see its own comment), which is
 * correct in a real browser but would make EVERY jsdom-based test of that
 * path silently no-op. Stub a realistic, non-zero rect on the element under
 * test, exactly the shape a real `<iframe>` on screen would report.
 */
function stubRect(el, { x, y, w, h }) {
  el.getBoundingClientRect = () => ({
    x,
    y,
    left: x,
    top: y,
    width: w,
    height: h,
    right: x + w,
    bottom: y + h,
    toJSON() {
      return this;
    },
  });
}

/** Realm-safe length/shape check for an array built inside a jsdom window's
 * own realm -- assert.deepEqual against a Node-realm `[]` literal fails on
 * prototype identity even when both are structurally empty (same issue
 * test_action_executor.test.mjs's own `plain()` helper works around). */
function assertEmptyArray(arr, message) {
  assert.ok(Array.isArray(arr), message + " (not even an array)");
  assert.equal(arr.length, 0, message);
}

// ===========================================================================
// 1. THE ACTUAL REGRESSION: a delayed parent listener must not permanently
//    lose the child's geometry-correlation token.
// ===========================================================================
describe("SIH_FRAME_TOKEN handshake survives a delayed parent listener (the real bug)", () => {
  test("child retries until the parent (which starts listening LATE) acks -- and then stops retrying", async () => {
    const dom = new JSDOM(`<!doctype html><html><body><iframe id="child" src="about:blank"></iframe></body></html>`, {
      url: "https://parent.example/",
      runScripts: "dangerously",
      resources: "usable",
      pretendToBeVisual: true,
      virtualConsole: freshVirtualConsole(),
    });
    const parentWindow = dom.window;
    await wait(50); // let the iframe's about:blank document settle so contentWindow is live
    const iframeEl = parentWindow.document.getElementById("child");
    const childWindow = iframeEl.contentWindow;

    // patchPostMessage(X, ..., log) replaces X.postMessage -- i.e. it
    // records every message SENT *TO* X (since a sender always calls
    // `otherWindow.postMessage(...)`). The CHILD sends its announcement
    // via `window.parent.postMessage(...)` == `parentWindow.postMessage`,
    // so announcements land in `sentToParent`. The PARENT's ack is sent
    // via `event.source.postMessage(...)` == `childWindow.postMessage`
    // (event.source is the child window), so acks land in `sentToChild`.
    const sentToParent = []; // the child's announcements
    const sentToChild = []; // the parent's ack(s)
    patchPostMessage(parentWindow, () => childWindow, sentToParent);
    patchPostMessage(childWindow, () => parentWindow, sentToChild);

    installBrowserMock(childWindow, { frameId: 7 });
    installBrowserMock(parentWindow, { frameId: 0 });

    // ---- Evaluate the CHILD's content.js FIRST. This immediately starts
    // the announce-retry loop (an immediate send, then one every 200ms --
    // see content.js's ANNOUNCE_RETRY_MS). The parent has NO "message"
    // listener registered yet at this point -- its own content.js hasn't
    // been evaluated at all -- so this first send is dispatched into a
    // frame with zero listeners and is lost. This is deliberately what
    // reproduces the real bug's precondition. ----
    childWindow.eval(CONTENT_JS_SRC);
    assert.equal(sentToParent.length, 1, "child should have sent its first announcement immediately on load");

    await wait(20); // let that first (unheard) dispatch actually fire and vanish
    assert.equal(sentToChild.length, 0, "sanity check: nothing has been acked yet -- the parent isn't listening at all yet");

    // ---- NOW evaluate the PARENT's content.js -- simulating a top page
    // that took a real, measurable amount of time to finish its own
    // document_idle init (this is the exact scenario CLAUDE.md/the bug
    // report describes: demo/frames-test.html's own ruler-building code
    // is heavier than the plain iframe it embeds). This registers the
    // "message" listener AFTER the child's first attempt already fired. ----
    parentWindow.eval(CONTENT_JS_SRC);

    // The OLD (buggy) code sent its token exactly once and never again --
    // under this exact timing, it would NEVER be correlated, for the rest
    // of the page's life (matching the real run: identical framesDropped
    // on every subsequent step). The FIX retries -- wait for at least one
    // more retry tick (200ms) to land now that the parent is listening.
    await wait(350);

    const acks = sentToChild.filter((s) => s.data && s.data.type === "SIH_FRAME_TOKEN_ACK");
    assert.equal(acks.length, 1, "parent should have acked exactly once, after correlating the child's (retried) token to the <iframe> element");

    assert.ok(
      sentToParent.length >= 2,
      "child must have sent more than its one original (lost) announcement -- this is the actual fix: retrying instead of a single fire-and-forget postMessage"
    );

    // ---- The retry loop must STOP once acked (no indefinite spam). ----
    const countAtAck = sentToParent.length;
    await wait(500);
    assert.equal(sentToParent.length, countAtAck, "child must stop retrying once it receives the ack -- no indefinite postMessage spam after correlation succeeds");
  });

  test("token and ack round-trip carry only the opaque token -- no PII-shaped fields", async () => {
    const dom = new JSDOM(`<!doctype html><html><body><iframe id="child" src="about:blank"></iframe></body></html>`, {
      url: "https://parent.example/",
      runScripts: "dangerously",
      resources: "usable",
      pretendToBeVisual: true,
      virtualConsole: freshVirtualConsole(),
    });
    const parentWindow = dom.window;
    await wait(50);
    const iframeEl = parentWindow.document.getElementById("child");
    const childWindow = iframeEl.contentWindow;

    const sentToParent = []; // the child's announcements
    const sentToChild = []; // the parent's ack(s)
    patchPostMessage(parentWindow, () => childWindow, sentToParent);
    patchPostMessage(childWindow, () => parentWindow, sentToChild);
    installBrowserMock(childWindow, { frameId: 3 });
    installBrowserMock(parentWindow, { frameId: 0 });

    parentWindow.eval(CONTENT_JS_SRC); // parent ready FIRST this time -- the common, non-buggy ordering
    childWindow.eval(CONTENT_JS_SRC);
    await wait(50);

    assert.ok(sentToParent.length >= 1, "the child should have announced at least once");
    assert.ok(sentToChild.length >= 1, "the parent should have acked at least once");
    for (const { data } of sentToParent) {
      assert.deepEqual(Object.keys(data).sort(), ["token", "type"], "every child->parent message must carry ONLY {type, token} -- see content.js's own security note on why nothing else may cross via postMessage");
      assert.equal(data.type, "SIH_FRAME_TOKEN");
      assert.equal(typeof data.token, "string");
    }
    for (const { data } of sentToChild) {
      assert.deepEqual(Object.keys(data).sort(), ["token", "type"], "every parent->child (ack) message must carry ONLY {type, token}");
      assert.equal(data.type, "SIH_FRAME_TOKEN_ACK");
      assert.equal(typeof data.token, "string");
    }
  });
});

// ===========================================================================
// 2. collectAndMergeSubframeReports(): a report that cannot be merged must
//    defensively redact the WHOLE <iframe> region, never just log-and-drop.
// ===========================================================================
describe("collectAndMergeSubframeReports(): unmerged iframes are defensively redacted, never silently dropped", () => {
  function buildTopFrameWithOneIframe() {
    const dom = new JSDOM(
      `<!doctype html><html><body><div style="margin:0;padding:0;"><iframe id="lonely" style="position:absolute;left:37px;top:1234px;width:300px;height:150px;border:0;"></iframe></div></body></html>`,
      { url: "https://top.example/", runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole: freshVirtualConsole() }
    );
    // jsdom does no real layout -- see stubRect()'s own doc comment.
    stubRect(dom.window.document.getElementById("lonely"), { x: 37, y: 1234, w: 300, h: 150 });
    return dom;
  }

  test("signature A shape (framesReported: 0 -- iframe present, nothing reported yet) still redacts the iframe's full rect", async () => {
    const dom = buildTopFrameWithOneIframe();
    const window = dom.window;
    installBrowserMock(window, { frameId: 0, onCollectFrameReports: () => ({ frameReports: [] }) });
    window.eval(CONTENT_JS_SRC);

    const result = await window.collectAndMergeSubframeReports();
    assert.equal(result.framesReported, 0);
    assert.equal(result.framesMerged, 0);
    assert.equal(result.defensivelyRedactedIframeCount, 1, "the one <iframe> in the document, never reported, must be defensively redacted");
    assert.equal(result.unscannableRegions.length, 1);
    const region = result.unscannableRegions[0];
    assert.equal(region.reason, "subframe-report-unmerged-this-step");
    // jsdom's layout engine doesn't compute real CSS geometry, so this
    // asserts SHAPE (a real, non-degenerate bbox object was produced from
    // getBoundingClientRect()), not exact pixel values -- pixel-accuracy
    // for a RESOLVED offset is frame-coords.js's own job and is already
    // covered by its 19 tests.
    for (const k of ["x", "y", "w", "h"]) assert.equal(typeof region.bbox[k], "number");
  });

  test("signature B shape (framesReported: 1, framesMerged: 0 -- report arrived but token never correlated) still redacts the iframe's full rect", async () => {
    const dom = buildTopFrameWithOneIframe();
    const window = dom.window;
    installBrowserMock(window, {
      frameId: 0,
      onCollectFrameReports: () => ({
        frameReports: [
          {
            ok: true,
            frameId: 9,
            token: "some-token-the-parent-never-correlated",
            sensitiveNodes: [{ agentId: "agent-f9-1", piiType: "password", bbox: { x: 1, y: 1, w: 2, h: 2 } }],
            domSnapshot: [],
            unscannableRegions: [],
          },
        ],
      }),
    });
    window.eval(CONTENT_JS_SRC);

    const result = await window.collectAndMergeSubframeReports();
    assert.equal(result.framesReported, 1);
    assert.equal(result.framesMerged, 0);
    assert.equal(result.droppedFrames.length, 1);
    assert.match(result.droppedFrames[0].reason, /offset unresolved/);
    // THE ACTUAL BUG: before this fix, a dropped report meant NOTHING
    // redacted the iframe's region -- the sensitive password node above
    // never reached sensitiveNodes/domSnapshot (correctly dropped, per
    // FAIL LOUD), but nothing replaced it with a defensive region either,
    // so the iframe rendered unredacted in the screenshot. This is the
    // assertion that would have FAILED against the pre-fix code.
    assert.equal(result.defensivelyRedactedIframeCount, 1);
    assert.equal(result.unscannableRegions.length, 1);
    assert.equal(result.unscannableRegions[0].reason, "subframe-report-unmerged-this-step");
  });

  test("a report that DOES correlate is merged normally and does NOT get defensively redacted on top", async () => {
    const dom = buildTopFrameWithOneIframe();
    const window = dom.window;
    const iframeEl = window.document.getElementById("lonely");

    installBrowserMock(window, {
      frameId: 0,
      onCollectFrameReports: () => ({
        frameReports: [
          {
            ok: true,
            frameId: 9,
            token: "tok-correlated",
            sensitiveNodes: [{ agentId: "agent-f9-1", piiType: "password", bbox: { x: 5, y: 5, w: 10, h: 10 } }],
            domSnapshot: [{ agentId: "agent-f9-1", tag: "input", bbox: { x: 5, y: 5, w: 10, h: 10 } }],
            unscannableRegions: [],
          },
        ],
      }),
    });
    window.eval(CONTENT_JS_SRC);

    // Simulate a successful handshake having already happened: dispatch a
    // real SIH_FRAME_TOKEN "message" event with the correct .source so the
    // parent's own listener (registered by the eval above) correlates it
    // exactly as it would from a real child frame.
    const ev = new window.MessageEvent("message", { data: { type: "SIH_FRAME_TOKEN", token: "tok-correlated" }, source: iframeEl.contentWindow });
    window.dispatchEvent(ev);
    await wait(10);

    const result = await window.collectAndMergeSubframeReports();
    assert.equal(result.framesReported, 1);
    assert.equal(result.framesMerged, 1);
    assert.equal(result.droppedFrames.length, 0);
    assert.equal(result.defensivelyRedactedIframeCount, 0, "a correctly-merged iframe must NOT ALSO get a defensive whole-iframe region -- that would double-redact and could mis-signal coverage");
    assert.equal(result.sensitiveNodes.length, 1);
  });

  test("a stale tokenToIframeElement entry pointing at a DETACHED iframe is treated as unresolved, not trusted", async () => {
    const dom = buildTopFrameWithOneIframe();
    const window = dom.window;
    const iframeEl = window.document.getElementById("lonely");

    installBrowserMock(window, {
      frameId: 0,
      onCollectFrameReports: () => ({
        frameReports: [
          {
            ok: true,
            frameId: 9,
            token: "tok-stale",
            sensitiveNodes: [{ agentId: "agent-f9-1", piiType: "email", bbox: { x: 1, y: 1, w: 1, h: 1 } }],
            domSnapshot: [],
            unscannableRegions: [],
          },
        ],
      }),
    });
    window.eval(CONTENT_JS_SRC);

    // Correlate normally first...
    const ev = new window.MessageEvent("message", { data: { type: "SIH_FRAME_TOKEN", token: "tok-stale" }, source: iframeEl.contentWindow });
    window.dispatchEvent(ev);
    await wait(10);

    // ...then simulate the page having reloaded that iframe out from under
    // the (never-pruned) mapping: the element is removed from the DOM, but
    // background.js/content.js's own maps don't know that yet.
    iframeEl.remove();

    const result = await window.collectAndMergeSubframeReports();
    assert.equal(result.framesMerged, 0, "a detached element's rect must never be trusted as a resolved offset -- that would produce a wrong-but-present bbox that LOOKS like success");
    assert.equal(result.droppedFrames.length, 1);
    assert.match(result.droppedFrames[0].reason, /no longer connected/);
    // The iframe element itself is gone from the document now, so
    // document.querySelectorAll("iframe") finds nothing to defensively
    // redact either -- correct: there is nothing left on screen to leak.
    assert.equal(result.defensivelyRedactedIframeCount, 0);
  });

  test("no iframes at all -> no defensive regions, no false positives", async () => {
    const dom = new JSDOM(`<!doctype html><html><body><p>no frames here</p></body></html>`, {
      url: "https://top.example/",
      runScripts: "dangerously",
      resources: "usable",
      pretendToBeVisual: true,
      virtualConsole: freshVirtualConsole(),
    });
    const window = dom.window;
    installBrowserMock(window, { frameId: 0, onCollectFrameReports: () => ({ frameReports: [] }) });
    window.eval(CONTENT_JS_SRC);

    const result = await window.collectAndMergeSubframeReports();
    assert.equal(result.framesReported, 0);
    assert.equal(result.defensivelyRedactedIframeCount, 0);
    assertEmptyArray(result.unscannableRegions, "no iframes exist, so there is nothing to defensively redact");
  });

  test("COLLECT_FRAME_REPORTS itself failing (e.g. background.js unreachable) still defensively redacts any live iframe", async () => {
    const dom = buildTopFrameWithOneIframe();
    const window = dom.window;
    window.browser = {
      runtime: {
        sendMessage: (msg) => {
          if (msg && msg.type === "FRAME_HELLO") return Promise.resolve({ type: "FRAME_HELLO_ACK", frameId: 0 });
          if (msg && msg.type === "COLLECT_FRAME_REPORTS") return Promise.reject(new Error("simulated: extension context invalidated"));
          return Promise.resolve(undefined);
        },
        onMessage: { addListener: () => {} },
        getURL: (p) => pathToFileURL(path.join(EXTENSION_DIR, p)).href,
      },
    };
    window.eval(CONTENT_JS_SRC);

    const result = await window.collectAndMergeSubframeReports();
    assert.equal(result.defensivelyRedactedIframeCount, 1, "even a total COLLECT_FRAME_REPORTS failure must not leave a live iframe unredacted");
  });
});
