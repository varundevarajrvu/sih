// Phase 3 (action-executor) unit tests.
//
// Run from repo root:
//   cd tests && npm install   (one-time; installs jsdom into tests/node_modules)
//   node --test unit/test_action_executor.test.mjs
// or just: cd tests && npm test
//
// Uses Node's built-in test runner (node:test) + jsdom -- no extension or
// browser required, per CLAUDE.md's "pure, testable functions against
// fixture HTML" architecture mandate. jsdom was NOT previously a
// dependency anywhere in this repo (checked extension/, spike/, and repo
// root before adding it) -- it is installed fresh, scoped to
// tests/package.json, specifically to avoid a concurrent-write collision
// with extension/package.json while Phase 2a/2b subagents are also
// mid-flight against files in extension/. See the delegation report for
// the full reasoning.
//
// extension/lib/action-executor.js has no import/export statements (it
// must stay loadable as a classic content-script tag) -- it attaches its
// API to `globalThis.ActionExecutor` instead. Importing it for its side
// effect is exactly how a classic script would be evaluated.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";

/**
 * action-executor.js is evaluated INSIDE each jsdom window's own realm
 * (see freshDom() below) so its arrays/plain-objects/Errors are
 * constructed via that realm's own Array/Object/Error, not Node's.
 * node:assert/strict's deepEqual (deepStrictEqual) compares prototypes
 * by reference and fails on an otherwise-identical value from a
 * different realm ("Values have same structure but are not
 * reference-equal"). Round-tripping through JSON strips realm identity
 * down to plain data, which is all these assertions care about anyway.
 */
const plain = (value) => JSON.parse(JSON.stringify(value));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "..", "fixtures");
const ACTION_EXECUTOR_PATH = path.resolve(__dirname, "..", "..", "extension", "lib", "action-executor.js");

const PAGE_HTML = readFileSync(path.join(FIXTURES_DIR, "action_executor_page.html"), "utf-8");
const ACTIONS = JSON.parse(readFileSync(path.join(FIXTURES_DIR, "action_executor_actions.json"), "utf-8"));
const ACTION_EXECUTOR_SRC = readFileSync(ACTION_EXECUTOR_PATH, "utf-8");

/**
 * Build a fresh jsdom document from the fixture page and evaluate
 * action-executor.js INSIDE that jsdom window's realm (via
 * `window.eval`), exactly mirroring how a classic content-script tag
 * gets evaluated against the page's own global scope in a real browser.
 * Returns the jsdom instance; use `dom.window.ActionExecutor` for the
 * public API and `dom.window.document` as the DOM root.
 *
 * Evaluating inside the jsdom realm (rather than importing the module
 * into the Node test process and passing in a jsdom `document`) is
 * deliberate: it guarantees `MouseEvent`, `Event`, `HTMLInputElement`,
 * etc. inside action-executor.js all resolve to jsdom's own
 * constructors, matching the file's own realm-safety design (getView()
 * derives its window from `el.ownerDocument.defaultView`).
 */
function freshDom(html) {
  // omitJSDOMErrors: true -- silences jsdom's "Not implemented:
  // HTMLFormElement.prototype.requestSubmit" noise (fired because
  // clicking a type="submit" button inside a <form> tries to submit
  // it; jsdom doesn't implement real navigation/submission). That's
  // expected and irrelevant to what this module is testing (that the
  // click event itself dispatches correctly on the right element) --
  // real console.log/warn from elsewhere would still be forwarded.
  const virtualConsole = new VirtualConsole().sendTo(console, { omitJSDOMErrors: true });
  const dom = new JSDOM(html, { url: "https://fixture.example/", runScripts: "outside-only", virtualConsole });
  dom.window.eval(ACTION_EXECUTOR_SRC);
  return dom;
}

describe("assignAgentIds / buildDomSnapshot (Set-of-Mark grounding)", () => {
  let dom, window, document, AE;

  beforeEach(() => {
    dom = freshDom(PAGE_HTML);
    window = dom.window;
    document = window.document;
    AE = window.ActionExecutor;
  });

  test("scans exactly the documented actionable elements, in document order, with the expected ids", () => {
    const { domSnapshot, idMap } = AE.buildDomSnapshot(document);
    const idsInOrder = domSnapshot.map((n) => n.agentId);

    // This is the precondition the hand-written fixture action JSON
    // (action_executor_actions.json) assumes. Asserting it explicitly
    // means a future change to the fixture page or the actionable-
    // element selector fails loudly HERE, not mysteriously in a later
    // targeting test.
    assert.deepEqual(plain(idsInOrder), [
      "agent-1", // #username
      "agent-2", // #password
      "agent-3", // #login-btn
      "agent-4", // #disabled-btn
      "agent-5", // #forgot-link
      "agent-6", // #country-select
      "agent-7", // #custom-widget
    ]);
    assert.equal(idMap.get("agent-3"), document.getElementById("login-btn"));
    assert.equal(idMap.get("agent-7"), document.getElementById("custom-widget"));
  });

  test("does NOT assign an id to non-actionable elements (plain text, hidden input)", () => {
    AE.buildDomSnapshot(document);
    assert.equal(document.getElementById("plain-text").hasAttribute(AE.AGENT_ID_ATTR), false);
    assert.equal(document.getElementById("hidden-field").hasAttribute(AE.AGENT_ID_ATTR), false);
  });

  test("domSnapshot node shape matches server/schemas.py's DomNode field-for-field", () => {
    const { domSnapshot } = AE.buildDomSnapshot(document);
    const loginBtnNode = domSnapshot.find((n) => n.agentId === "agent-3");
    assert.deepEqual(
      Object.keys(loginBtnNode).sort(),
      ["agentId", "tag", "role", "type", "text", "bbox", "sensitive"].sort()
    );
    // (explicit field-by-field check, not just key names)
    assert.equal(loginBtnNode.tag, "button");
    assert.equal(loginBtnNode.role, "button");
    assert.equal(loginBtnNode.type, "submit");
    assert.equal(loginBtnNode.text, "Log in");
    assert.deepEqual(Object.keys(loginBtnNode.bbox).sort(), ["h", "w", "x", "y"]);
    assert.equal(loginBtnNode.sensitive, false);
  });

  test("sensitive is ALWAYS false from this producer, even for a field carrying a raw password value", () => {
    // This module does not classify PII (Phase 2a's job) and does not
    // strip raw values (Phase 2b's job) -- it only enumerates. Confirms
    // that scoping is real in the output, not just asserted in a
    // comment.
    const { domSnapshot } = AE.buildDomSnapshot(document);
    const passwordNode = domSnapshot.find((n) => n.agentId === "agent-2");
    assert.equal(passwordNode.type, "password");
    assert.equal(passwordNode.text, "hunter2"); // raw, not yet redacted -- by design, see file header
    assert.equal(passwordNode.sensitive, false);
  });

  test("bbox acquisition is injectable, and jsdom's real getBoundingClientRect is all-zero (documented caveat)", () => {
    const { domSnapshot: withDefault } = AE.buildDomSnapshot(document);
    const btn = withDefault.find((n) => n.agentId === "agent-3");
    assert.deepEqual(plain(btn.bbox), { x: 0, y: 0, w: 0, h: 0 }); // jsdom has no layout engine

    const fakeBBox = () => ({ x: 1, y: 2, w: 3, h: 4 });
    const { domSnapshot: withInjected } = AE.buildDomSnapshot(document, { getBBox: fakeBBox });
    assert.deepEqual(plain(withInjected.find((n) => n.agentId === "agent-3").bbox), { x: 1, y: 2, w: 3, h: 4 });
  });

  test("STABILITY: agent-1 refers to the same element across two re-scans of an unchanged page", () => {
    const first = AE.buildDomSnapshot(document);
    const second = AE.buildDomSnapshot(document);

    assert.deepEqual(
      first.domSnapshot.map((n) => n.agentId),
      second.domSnapshot.map((n) => n.agentId)
    );
    for (const [id, el] of first.idMap.entries()) {
      assert.equal(second.idMap.get(id), el, `agentId ${id} must resolve to the identical element on re-scan`);
    }
  });

  test("STABILITY under DOM mutation: existing ids never change; a newly added element gets a fresh, non-colliding id", () => {
    const before = AE.buildDomSnapshot(document);
    const loginBtnBefore = before.idMap.get("agent-3");

    const newBtn = document.createElement("button");
    newBtn.textContent = "New button";
    document.body.appendChild(newBtn);

    const after = AE.buildDomSnapshot(document);
    // Every id present before still maps to the SAME element.
    for (const [id, el] of before.idMap.entries()) {
      assert.equal(after.idMap.get(id), el, `agentId ${id} must not be reassigned after an unrelated DOM addition`);
    }
    assert.equal(after.idMap.get("agent-3"), loginBtnBefore);
    // The new element got a fresh id that didn't exist before, not a collision.
    const newId = newBtn.getAttribute(AE.AGENT_ID_ATTR);
    assert.ok(newId, "new element must receive a data-agent-id");
    assert.equal(before.idMap.has(newId), false);
    assert.equal(after.idMap.get(newId), newBtn);
  });
});

describe("executeAction: click (checkpoint -- right DOM event fires on the CORRECT element)", () => {
  let dom, window, document, AE, domSnapshot, idMap;

  beforeEach(() => {
    dom = freshDom(PAGE_HTML);
    window = dom.window;
    document = window.document;
    AE = window.ActionExecutor;
    ({ domSnapshot, idMap } = AE.buildDomSnapshot(document));
  });

  test("fixture click action fires a real click event on exactly the targeted element, and no other", () => {
    const loginBtn = document.getElementById("login-btn");
    const disabledBtn = document.getElementById("disabled-btn");

    let loginClicks = 0;
    let disabledClicks = 0;
    loginBtn.addEventListener("click", () => loginClicks++);
    disabledBtn.addEventListener("click", () => disabledClicks++);

    const result = AE.executeAction(ACTIONS.click_login_button, idMap);

    assert.equal(result.ok, true);
    assert.equal(loginClicks, 1, "the targeted element's listener must fire exactly once");
    assert.equal(disabledClicks, 0, "a sibling element's listener must NOT fire -- proves ID-based targeting, not proximity/coordinates");
  });

  test("click on a custom ARIA role=button widget (non-<button> element) also fires correctly", () => {
    const widget = document.getElementById("custom-widget");
    let clicks = 0;
    widget.addEventListener("click", () => clicks++);

    AE.executeAction(ACTIONS.click_custom_widget, idMap);
    assert.equal(clicks, 1);
  });

  test("click focuses the element before dispatching (real-interaction fidelity)", () => {
    AE.executeAction(ACTIONS.click_login_button, idMap);
    assert.equal(document.activeElement, document.getElementById("login-btn"));
  });
});

describe("executeAction: type (must fire real input events, not just set .value)", () => {
  let dom, window, document, AE, idMap;

  beforeEach(() => {
    dom = freshDom(PAGE_HTML);
    window = dom.window;
    document = window.document;
    AE = window.ActionExecutor;
    ({ idMap } = AE.buildDomSnapshot(document));
  });

  test("sets .value via the prototype setter AND dispatches input+change on the correct element only", () => {
    const usernameInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");

    const inputEvents = [];
    const changeEvents = [];
    usernameInput.addEventListener("input", (e) => inputEvents.push(e.target.id));
    usernameInput.addEventListener("change", (e) => changeEvents.push(e.target.id));
    let passwordSawEvent = false;
    passwordInput.addEventListener("input", () => (passwordSawEvent = true));

    const result = AE.executeAction(ACTIONS.type_username, idMap);

    assert.equal(result.ok, true);
    assert.equal(usernameInput.value, "varun");
    assert.deepEqual(inputEvents, ["username"]);
    assert.deepEqual(changeEvents, ["username"]);
    assert.equal(passwordSawEvent, false, "typing into one field must not fire events on a different field");
  });

  test("simulated React-style controlled input observes the change via the input event (the actual failure mode a plain .value= assignment has)", () => {
    const usernameInput = document.getElementById("username");
    // Mimic a controlled-input pattern: an 'input' listener is the ONLY
    // path this stand-in "framework" uses to learn the field changed.
    let observedValue = null;
    usernameInput.addEventListener("input", (e) => {
      observedValue = e.target.value;
    });

    AE.executeAction({ action: "type", targetId: "agent-1", value: "priya" }, idMap);

    assert.equal(observedValue, "priya", "a framework listening only to 'input' must observe the new value");
  });

  test("type on a <select> updates its value and fires input+change", () => {
    const select = document.getElementById("country-select");
    let changed = false;
    select.addEventListener("change", () => (changed = true));

    AE.executeAction({ action: "type", targetId: "agent-6", value: "in" }, idMap);

    assert.equal(select.value, "in");
    assert.equal(changed, true);
  });
});

describe("executeAction: scroll (window/element scroll actions are injectable)", () => {
  let dom, window, document, AE, idMap;

  beforeEach(() => {
    dom = freshDom(PAGE_HTML);
    window = dom.window;
    document = window.document;
    AE = window.ActionExecutor;
    ({ idMap } = AE.buildDomSnapshot(document));
  });

  test("page-level scroll (targetId=PAGE_TARGET_ID) calls the injected scrollWindowBy with the parsed amount", () => {
    const calls = [];
    const result = AE.executeAction(ACTIONS.scroll_page_down, idMap, {
      window,
      scrollWindowBy: (win, amount) => calls.push([win === window, amount]),
    });
    assert.equal(result.ok, true);
    assert.equal(result.targetId, AE.PAGE_TARGET_ID);
    assert.deepEqual(calls, [[true, 600]]);
  });

  test('scroll value "up" parses to a negative amount', () => {
    const calls = [];
    AE.executeAction({ action: "scroll", targetId: "page", value: "up" }, idMap, {
      window,
      scrollWindowBy: (win, amount) => calls.push(amount),
    });
    assert.deepEqual(calls, [-600]);
  });

  test("element-targeted scroll calls the injected scrollElementIntoView on exactly the right element", () => {
    const select = document.getElementById("country-select");
    const calls = [];
    const result = AE.executeAction(ACTIONS.scroll_into_view_select, idMap, {
      scrollElementIntoView: (el) => calls.push(el),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(calls, [select]);
  });

  test("page-level scroll with no window available fails loudly rather than silently no-op-ing", async () => {
    // NOTE ON HARNESS: action-executor.js is eval'd inside jsdom's own
    // window realm for every other test in this file (see freshDom()),
    // so its `typeof window !== "undefined"` fallback always resolves
    // to jsdom's own ambient `window` -- exactly matching real browser
    // behavior, but that also means the "no window at all" branch is
    // unreachable through that harness (a real content script always
    // has a window). To actually exercise NO_WINDOW_AVAILABLE, import
    // the module directly into the plain Node process instead, which
    // has no `window` global at all unless something defines one.
    await import(pathToFileURL(ACTION_EXECUTOR_PATH).href);
    const NodeAE = globalThis.ActionExecutor;
    // NOTE: checking `globalThis.window` explicitly, not bare `window`
    // -- this describe block's own `let ... window` (reassigned in
    // beforeEach to the jsdom instance) would otherwise shadow the real
    // global and make this precondition assert the wrong thing.
    assert.equal(typeof globalThis.window, "undefined", "precondition: plain Node has no ambient `window`");

    assert.throws(
      () => NodeAE.executeAction({ action: "scroll", targetId: "page", value: "down" }, new Map(), {}),
      (err) => err instanceof NodeAE.ActionExecutionError && err.code === "NO_WINDOW_AVAILABLE"
    );
  });
});

describe("executeAction: done", () => {
  let dom, window, document, AE, idMap;

  beforeEach(() => {
    dom = freshDom(PAGE_HTML);
    document = (window = dom.window).document;
    AE = window.ActionExecutor;
    ({ idMap } = AE.buildDomSnapshot(document));
  });

  test("done on the page sentinel succeeds without touching any element", () => {
    const result = AE.executeAction(ACTIONS.done_on_page, idMap);
    assert.equal(result.ok, true);
    assert.equal(result.targetId, "page");
  });

  test("done tied to a real element validates it still resolves", () => {
    const result = AE.executeAction(ACTIONS.done_on_element, idMap);
    assert.equal(result.ok, true);
    assert.equal(result.targetId, "agent-3");
  });
});

describe("failure handling: fail loudly, never silently no-op, never guess a different element", () => {
  let dom, window, document, AE, idMap;

  beforeEach(() => {
    dom = freshDom(PAGE_HTML);
    document = (window = dom.window).document;
    AE = window.ActionExecutor;
    ({ idMap } = AE.buildDomSnapshot(document));
  });

  test("NEGATIVE: an unknown targetId throws TARGET_NOT_FOUND and fires NO click anywhere in the document", () => {
    let anyClicks = 0;
    document.addEventListener("click", () => anyClicks++, true); // capture phase, whole document

    assert.throws(
      () => AE.executeAction(ACTIONS.negative_unknown_target, idMap),
      (err) => err instanceof AE.ActionExecutionError && err.code === "TARGET_NOT_FOUND"
    );
    assert.equal(anyClicks, 0, "a failed targetId lookup must never fall back to acting on some other element");
  });

  test("NEGATIVE: an element removed from the DOM since the last scan throws TARGET_DETACHED, not a stale click", () => {
    const loginBtn = document.getElementById("login-btn");
    let clicks = 0;
    loginBtn.addEventListener("click", () => clicks++);

    loginBtn.remove(); // simulate the page mutating between scan and action

    assert.throws(
      () => AE.executeAction(ACTIONS.click_login_button, idMap),
      (err) => err instanceof AE.ActionExecutionError && err.code === "TARGET_DETACHED"
    );
    assert.equal(clicks, 0);
  });

  test("NEGATIVE: an unrecognized action type throws UNKNOWN_ACTION", () => {
    assert.throws(
      () => AE.executeAction(ACTIONS.negative_unknown_action, idMap),
      (err) => err instanceof AE.ActionExecutionError && err.code === "UNKNOWN_ACTION"
    );
  });

  test("NEGATIVE: a missing/empty targetId throws MISSING_TARGET_ID", () => {
    assert.throws(
      () => AE.executeAction(ACTIONS.negative_missing_target_id, idMap),
      (err) => err instanceof AE.ActionExecutionError && err.code === "MISSING_TARGET_ID"
    );
  });

  test('NEGATIVE: "type" against the PAGE_TARGET_ID sentinel throws INVALID_TARGET_FOR_ACTION', () => {
    assert.throws(
      () => AE.executeAction(ACTIONS.negative_type_on_page_sentinel, idMap),
      (err) => err instanceof AE.ActionExecutionError && err.code === "INVALID_TARGET_FOR_ACTION"
    );
  });

  test("malformed action JSON (not an object) throws INVALID_ACTION_JSON rather than crashing", () => {
    assert.throws(
      () => AE.executeAction(null, idMap),
      (err) => err instanceof AE.ActionExecutionError && err.code === "INVALID_ACTION_JSON"
    );
  });
});

describe("SAFETY: sensitive-target guard hook (Section 5 -- policy is the orchestrator's call, not this module's)", () => {
  let dom, window, document, AE, idMap;

  beforeEach(() => {
    dom = freshDom(PAGE_HTML);
    document = (window = dom.window).document;
    AE = window.ActionExecutor;
    ({ idMap } = AE.buildDomSnapshot(document));
    document.getElementById("password").setAttribute(AE.SENSITIVE_ATTR, "true");
  });

  test("default behaviour is FAIL-CLOSED: typing into a flagged-sensitive element is blocked, and no input event fires", () => {
    const pw = document.getElementById("password");
    let fired = false;
    pw.addEventListener("input", () => (fired = true));

    assert.throws(
      () => AE.executeAction({ action: "type", targetId: "agent-2", value: "leaked" }, idMap),
      (err) => err instanceof AE.ActionExecutionError && err.code === "SENSITIVE_TARGET_BLOCKED"
    );
    assert.equal(fired, false);
    assert.equal(pw.value, "hunter2", "the blocked action must not have touched the field's value");
  });

  test("explicit options.allowSensitiveTargets=true overrides the default block", () => {
    const result = AE.executeAction(
      { action: "type", targetId: "agent-2", value: "override-ok" },
      idMap,
      { allowSensitiveTargets: true }
    );
    assert.equal(result.ok, true);
    assert.equal(document.getElementById("password").value, "override-ok");
  });

  test("options.onSensitiveTarget hook can allow (return true) or re-block (return false) per call", () => {
    const blocked = () =>
      AE.executeAction({ action: "type", targetId: "agent-2", value: "x" }, idMap, {
        onSensitiveTarget: () => false,
      });
    assert.throws(blocked, (err) => err.code === "SENSITIVE_TARGET_BLOCKED");

    const result = AE.executeAction({ action: "type", targetId: "agent-2", value: "x" }, idMap, {
      onSensitiveTarget: () => true,
    });
    assert.equal(result.ok, true);
  });

  test("sensitivity can also be declared out-of-band via options.sensitiveAgentIds instead of a DOM attribute", () => {
    document.getElementById("password").removeAttribute(AE.SENSITIVE_ATTR);
    assert.throws(
      () =>
        AE.executeAction({ action: "click", targetId: "agent-2" }, idMap, {
          sensitiveAgentIds: new Set(["agent-2"]),
        }),
      (err) => err.code === "SENSITIVE_TARGET_BLOCKED"
    );
  });

  test("scroll/done are NOT gated by the sensitive guard (only click/type write to or trigger the page)", () => {
    const result = AE.executeAction({ action: "scroll", targetId: "agent-2" }, idMap, {
      scrollElementIntoView: () => {},
    });
    assert.equal(result.ok, true);
  });
});
