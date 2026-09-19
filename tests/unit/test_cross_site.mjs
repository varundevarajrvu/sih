// Cross-site hardening: the element kinds and page shapes that real websites
// use and this project's own demo fixtures do not.
//
// Every browser verification in this project to date has run against
// demo/test-page.html, which has five actionable elements, a document that
// scrolls, and no rich-text editor anywhere. These tests cover the three
// places that gap actually bites:
//   1. contenteditable rich-text editors (Gmail, Slack, Notion, ProseMirror)
//   2. native <select>, where a model names the LABEL, not the value
//   3. pages where the window does not scroll and an inner container does
//
// Run with: node --test tests/unit/test_cross_site.mjs

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM } from "./dom-scanner-vendor/node_modules/jsdom/lib/api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  path.resolve(__dirname, "..", "..", "extension", "lib", "action-executor.js"),
  "utf-8"
);

function mount(html) {
  const dom = new JSDOM(html, { url: "https://app.example/", runScripts: "outside-only" });
  dom.window.eval(SRC);
  return { dom, window: dom.window, document: dom.window.document, AE: dom.window.ActionExecutor };
}

// ---------------------------------------------------------------------------
// 1. RICH-TEXT EDITORS
// ---------------------------------------------------------------------------

describe("cross-site: contenteditable rich-text editors", () => {
  const HTML = `<!doctype html><html><body>
    <div id="editor" contenteditable="true" role="textbox">old draft</div>
  </body></html>`;

  let window, document, AE, idMap, editor, id;

  beforeEach(() => {
    ({ window, document, AE } = mount(HTML));
    ({ idMap } = AE.buildDomSnapshot(document));
    editor = document.getElementById("editor");
    id = editor.getAttribute(AE.AGENT_ID_ATTR);
  });

  test("a contenteditable is discovered as actionable at all", () => {
    assert.ok(id, "contenteditable must get an agent id or the model can never target it");
  });

  test("fires a cancelable beforeinput carrying the text, as real typing does", () => {
    const seen = [];
    editor.addEventListener("beforeinput", (e) => {
      seen.push({ inputType: e.inputType, data: e.data, cancelable: e.cancelable });
    });

    AE.executeAction({ action: "type", targetId: id, value: "hello there" }, idMap);

    assert.equal(seen.length, 1, "exactly one beforeinput");
    assert.equal(seen[0].inputType, "insertText");
    assert.equal(seen[0].data, "hello there");
    assert.equal(seen[0].cancelable, true,
      "must be cancelable -- an editor that wants to own the change has to be able to say so");
  });

  test("🔴 when the editor CANCELS beforeinput, the DOM is left alone", () => {
    // This is what ProseMirror/Draft.js/Quill do: cancel the event, apply the
    // change to their own document model, re-render. Writing textContent here
    // would destroy the nodes their model points at.
    editor.addEventListener("beforeinput", (e) => e.preventDefault());

    AE.executeAction({ action: "type", targetId: id, value: "typed by us" }, idMap);

    assert.equal(editor.textContent, "old draft",
      "a cancelled beforeinput means the editor is handling it; we must not also write");
  });

  test("when nothing cancels, the text is actually applied", () => {
    AE.executeAction({ action: "type", targetId: id, value: "new content" }, idMap);
    assert.equal(editor.textContent, "new content");
  });

  test("replaces existing content rather than appending to it", () => {
    AE.executeAction({ action: "type", targetId: id, value: "replacement" }, idMap);
    assert.ok(!editor.textContent.includes("old draft"),
      "the previous draft must be gone, not concatenated");
  });

  test("still emits input and change afterwards, for listeners that only watch those", () => {
    const fired = [];
    editor.addEventListener("input", () => fired.push("input"));
    editor.addEventListener("change", () => fired.push("change"));
    AE.executeAction({ action: "type", targetId: id, value: "x" }, idMap);
    assert.deepEqual(fired, ["input", "change"]);
  });

  test("reports which mechanism applied the text, so a failure is diagnosable", () => {
    const res = AE.executeAction({ action: "type", targetId: id, value: "x" }, idMap);
    assert.ok(res.richText, "result should name the path taken");
  });
});

// ---------------------------------------------------------------------------
// 2. NATIVE <select>
// ---------------------------------------------------------------------------

describe("cross-site: native <select> option matching", () => {
  const HTML = `<!doctype html><html><body>
    <select id="country">
      <option value="">Choose…</option>
      <option value="IN">India</option>
      <option value="GB">United Kingdom</option>
    </select>
  </body></html>`;

  let document, AE, idMap, sel, id;

  beforeEach(() => {
    ({ document, AE } = mount(HTML));
    ({ idMap } = AE.buildDomSnapshot(document));
    sel = document.getElementById("country");
    id = sel.getAttribute(AE.AGENT_ID_ATTR);
  });

  test("🔴 matches on the VISIBLE LABEL, which is what a model names", () => {
    // The old path pushed "India" through the value setter, matched nothing,
    // and left the select on "Choose…" while reporting ok:true.
    AE.executeAction({ action: "type", targetId: id, value: "India" }, idMap);
    assert.equal(sel.value, "IN");
  });

  test("still matches on the value attribute when the model uses it", () => {
    AE.executeAction({ action: "type", targetId: id, value: "GB" }, idMap);
    assert.equal(sel.value, "GB");
  });

  test("matches case- and whitespace-insensitively", () => {
    AE.executeAction({ action: "type", targetId: id, value: "  united kingdom " }, idMap);
    assert.equal(sel.value, "GB");
  });

  test("🔴 a label that matches nothing FAILS LOUDLY instead of silently doing nothing", () => {
    assert.throws(
      () => AE.executeAction({ action: "type", targetId: id, value: "Atlantis" }, idMap),
      (err) => err.code === "SELECT_OPTION_NOT_FOUND"
    );
    assert.equal(sel.value, "", "the control must be left untouched on a miss");
  });

  test("reports the option it chose", () => {
    const res = AE.executeAction({ action: "type", targetId: id, value: "India" }, idMap);
    assert.equal(res.selectedValue, "IN");
    assert.equal(res.selectedLabel, "India");
  });

  test("fires change, which is what form frameworks bind to on a select", () => {
    let changed = false;
    sel.addEventListener("change", () => { changed = true; });
    AE.executeAction({ action: "type", targetId: id, value: "India" }, idMap);
    assert.equal(changed, true);
  });
});

// ---------------------------------------------------------------------------
// 3. PAGES WHERE THE WINDOW DOES NOT SCROLL
// ---------------------------------------------------------------------------

describe("cross-site: scrolling an inner container", () => {
  // jsdom does no layout, so every scrollHeight/clientHeight is 0. Metrics are
  // injected instead -- which is exactly why findScrollContainer takes a hook.
  const HTML = `<!doctype html><html><body>
    <div id="sidebar"></div>
    <div id="feed"></div>
    <div id="static"></div>
  </body></html>`;

  test("isScrollableMetrics requires BOTH an overflow style and real overflow", () => {
    const { AE } = mount(HTML);
    assert.equal(AE.isScrollableMetrics({ overflowY: "auto", scrollHeight: 5000, clientHeight: 800 }), true);
    assert.equal(AE.isScrollableMetrics({ overflowY: "scroll", scrollHeight: 5000, clientHeight: 800 }), true);
    // Styled scrollable but nothing to scroll.
    assert.equal(AE.isScrollableMetrics({ overflowY: "auto", scrollHeight: 810, clientHeight: 800 }), false);
    // Overflowing but not a scroller -- this is most of a normal page.
    assert.equal(AE.isScrollableMetrics({ overflowY: "visible", scrollHeight: 5000, clientHeight: 800 }), false);
    assert.equal(AE.isScrollableMetrics(null), false);
  });

  test("returns null (use the window) when the document itself scrolls", () => {
    const { window, document, AE } = mount(HTML);
    Object.defineProperty(document.documentElement, "scrollHeight", { value: 9000, configurable: true });
    Object.defineProperty(document.documentElement, "clientHeight", { value: 800, configurable: true });
    assert.equal(AE.findScrollContainer(window, {}), null,
      "an ordinary long page must keep using window.scrollBy");
  });

  test("🔴 finds the inner scroller when the document does NOT scroll", () => {
    const { window, document, AE } = mount(HTML);
    const found = AE.findScrollContainer(window, {
      getScrollMetrics: (el) => {
        if (el.id === "feed")    return { overflowY: "auto", scrollHeight: 9000, clientHeight: 800, area: 800 * 900 };
        if (el.id === "sidebar") return { overflowY: "auto", scrollHeight: 4000, clientHeight: 800, area: 200 * 800 };
        return { overflowY: "visible", scrollHeight: 0, clientHeight: 0, area: 0 };
      },
    });
    assert.equal(found && found.id, "feed", "the largest genuine scroller wins, not the first one found");
  });

  test("scroll on the page sentinel drives that container, and says so", () => {
    const { window, document, AE } = mount(HTML);
    const feed = document.getElementById("feed");
    let scrolledBy = null;
    const res = AE.executeAction(
      { action: "scroll", targetId: AE.PAGE_TARGET_ID, value: "down" },
      new Map(),
      {
        window,
        pickScrollContainer: () => feed,
        scrollElementBy: (el, px) => { scrolledBy = { id: el.id, px }; },
        scrollWindowBy: () => { throw new Error("must not fall back to the window"); },
      }
    );
    assert.equal(scrolledBy.id, "feed");
    assert.ok(scrolledBy.px > 0);
    assert.equal(res.scrolledContainer, true,
      "the summary must distinguish 'inner container moved' from 'page moved'");
  });

  test("falls back to the window when no container qualifies", () => {
    const { window, AE } = mount(HTML);
    let windowScrolled = false;
    const res = AE.executeAction(
      { action: "scroll", targetId: AE.PAGE_TARGET_ID, value: "down" },
      new Map(),
      {
        window,
        pickScrollContainer: () => null,
        scrollWindowBy: () => { windowScrolled = true; },
      }
    );
    assert.equal(windowScrolled, true);
    assert.equal(res.scrolledContainer, false);
  });
});

// ---------------------------------------------------------------------------
// 4. NO REGRESSION IN THE ORDINARY PATHS
// ---------------------------------------------------------------------------

describe("cross-site: the plain cases still behave exactly as before", () => {
  const HTML = `<!doctype html><html><body>
    <input id="name" type="text" />
    <input id="pw" type="password" data-agent-sensitive="true" />
  </body></html>`;

  test("a plain text input types through the native value setter", () => {
    const { document, AE } = mount(HTML);
    const { idMap } = AE.buildDomSnapshot(document);
    const el = document.getElementById("name");
    AE.executeAction(
      { action: "type", targetId: el.getAttribute(AE.AGENT_ID_ATTR), value: "Simon" },
      idMap
    );
    assert.equal(el.value, "Simon");
  });

  test("the sensitive guard is untouched by any of this", () => {
    const { document, AE } = mount(HTML);
    const { idMap } = AE.buildDomSnapshot(document);
    const pw = document.getElementById("pw");
    assert.throws(
      () => AE.executeAction(
        { action: "type", targetId: pw.getAttribute(AE.AGENT_ID_ATTR), value: "hunter2" },
        idMap
      ),
      (err) => err.code === "SENSITIVE_TARGET_BLOCKED"
    );
    assert.equal(pw.value, "", "a blocked type must never reach the DOM");
  });
});

// ---------------------------------------------------------------------------
// 5. KEYBOARD
// ---------------------------------------------------------------------------

describe("cross-site: press_key", () => {
  const HTML = `<!doctype html><html><body>
    <input id="search" type="search" />
    <input id="pw" type="password" data-agent-sensitive="true" />
  </body></html>`;

  let document, AE, idMap, search, id;

  beforeEach(() => {
    ({ document, AE } = mount(HTML));
    ({ idMap } = AE.buildDomSnapshot(document));
    search = document.getElementById("search");
    id = search.getAttribute(AE.AGENT_ID_ATTR);
  });

  test("fires keydown AND keyup with the right key, code and legacy keyCode", () => {
    const seen = [];
    search.addEventListener("keydown", (e) => seen.push(["keydown", e.key, e.code, e.keyCode, e.bubbles]));
    search.addEventListener("keyup", (e) => seen.push(["keyup", e.key, e.code, e.keyCode]));

    AE.executeAction({ action: "press_key", targetId: id, key: "Enter" }, idMap);

    assert.deepEqual(seen[0], ["keydown", "Enter", "Enter", 13, true]);
    assert.deepEqual(seen[1], ["keyup", "Enter", "Enter", 13]);
  });

  test("Escape and the arrow keys are dispatchable", () => {
    for (const k of ["Escape", "ArrowDown", "ArrowUp", "Tab"]) {
      let got = null;
      search.addEventListener("keydown", (e) => { got = e.key; }, { once: true });
      AE.executeAction({ action: "press_key", targetId: id, key: k }, idMap);
      assert.equal(got, k);
    }
  });

  test("🔴 a key outside the closed set is refused, not forwarded to the page", () => {
    assert.throws(
      () => AE.executeAction({ action: "press_key", targetId: id, key: "F12" }, idMap),
      (err) => err.code === "INVALID_KEY"
    );
  });

  test("reports whether the page cancelled the keydown", () => {
    search.addEventListener("keydown", (e) => e.preventDefault());
    const res = AE.executeAction({ action: "press_key", targetId: id, key: "Enter" }, idMap);
    assert.equal(res.defaultPrevented, true);
  });

  test("🔴 press_key goes through the sensitive guard like click and type", () => {
    // Otherwise it would be a way to interact with a password field that
    // sidesteps the guard entirely.
    const pw = document.getElementById("pw");
    assert.throws(
      () => AE.executeAction(
        { action: "press_key", targetId: pw.getAttribute(AE.AGENT_ID_ATTR), key: "Enter" },
        idMap
      ),
      (err) => err.code === "SENSITIVE_TARGET_BLOCKED"
    );
  });
});

// ---------------------------------------------------------------------------
// 6. SCROLL INTO VIEW + TOGGLE STATE
// ---------------------------------------------------------------------------

describe("cross-site: acting on off-screen and toggle elements", () => {
  const HTML = `<!doctype html><html><body>
    <button id="deep">Load more</button>
    <input id="terms" type="checkbox" />
    <div id="sw" role="switch" aria-checked="false">Notifications</div>
  </body></html>`;

  test("🔴 click scrolls the target into view first", () => {
    // Virtualised lists and IntersectionObserver-gated widgets only mount or
    // initialise near the viewport; clicking blind hits a placeholder.
    const { document, AE } = mount(HTML);
    const { idMap } = AE.buildDomSnapshot(document);
    const btn = document.getElementById("deep");
    let scrolled = null;
    AE.executeAction(
      { action: "click", targetId: btn.getAttribute(AE.AGENT_ID_ATTR) },
      idMap,
      { scrollElementIntoView: (el) => { scrolled = el.id; } }
    );
    assert.equal(scrolled, "deep");
  });

  test("type scrolls its target into view too", () => {
    const { document, AE } = mount(`<!doctype html><html><body><input id="f" type="text"></body></html>`);
    const { idMap } = AE.buildDomSnapshot(document);
    const f = document.getElementById("f");
    let scrolled = null;
    AE.executeAction(
      { action: "type", targetId: f.getAttribute(AE.AGENT_ID_ATTR), value: "x" },
      idMap,
      { scrollElementIntoView: (el) => { scrolled = el.id; } }
    );
    assert.equal(scrolled, "f");
  });

  test("a failing scrollIntoView never blocks the action", () => {
    const { document, AE } = mount(HTML);
    const { idMap } = AE.buildDomSnapshot(document);
    const btn = document.getElementById("deep");
    let clicked = false;
    btn.addEventListener("click", () => { clicked = true; });
    AE.executeAction(
      { action: "click", targetId: btn.getAttribute(AE.AGENT_ID_ATTR) },
      idMap,
      { scrollElementIntoView: () => { throw new Error("no layout here"); } }
    );
    assert.equal(clicked, true, "scrolling is preparation, not the action");
  });

  test("🔴 click on a checkbox reports the RESULTING checked state", () => {
    // click TOGGLES. Told to "accept the terms" on an already-ticked box, the
    // agent unticks it -- and the old result said ok:true either way.
    const { document, AE } = mount(HTML);
    const { idMap } = AE.buildDomSnapshot(document);
    const cb = document.getElementById("terms");
    const id = cb.getAttribute(AE.AGENT_ID_ATTR);

    const first = AE.executeAction({ action: "click", targetId: id }, idMap);
    assert.equal(first.checked, true);

    const second = AE.executeAction({ action: "click", targetId: id }, idMap);
    assert.equal(second.checked, false, "a second click unticks it, and says so");
  });

  test("reads aria-checked for role=switch", () => {
    const { document, AE } = mount(HTML);
    const { idMap } = AE.buildDomSnapshot(document);
    const sw = document.getElementById("sw");
    const res = AE.executeAction(
      { action: "click", targetId: sw.getAttribute(AE.AGENT_ID_ATTR) },
      idMap
    );
    assert.equal(res.checked, false, "reflects aria-checked, which the page owns");
  });

  test("a non-toggle click carries no checked field at all", () => {
    const { document, AE } = mount(HTML);
    const { idMap } = AE.buildDomSnapshot(document);
    const res = AE.executeAction(
      { action: "click", targetId: document.getElementById("deep").getAttribute(AE.AGENT_ID_ATTR) },
      idMap
    );
    assert.equal("checked" in res, false);
  });
});
