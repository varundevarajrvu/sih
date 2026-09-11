// SIH 26171 -- Phase 3 (`action-executor`).
//
// Two responsibilities, per CLAUDE.md Section 4 Phase 3 and the Phase 1
// RESULT's CONTRACT RULING ("Phase 3 is the producer of `domSnapshot`"):
//
//   1. Set-of-Mark grounding: walk actionable elements, assign each a
//      STABLE `data-agent-id`, and build the ID -> element map that
//      `domSnapshot` (server/schemas.py's `DomNode[]`) is derived from.
//   2. Action execution: accept the server's action JSON
//      ({ action, targetId, value }, server/schemas.py's ActionResponse)
//      and dispatch a REAL DOM event on the mapped element -- never on
//      raw pixel coordinates.
//
// ---------------------------------------------------------------------
// Deliberately written with NO `import`/`export` statements.
//
// content.js (Phase 1's stub) and vendor/browser-polyfill.js are loaded
// as CLASSIC (non-module) scripts via manifest.json's content_scripts.js
// array -- `import`/`export` syntax is a parse error in that context.
// This file follows the same pattern: it attaches its public API to
// `globalThis.ActionExecutor` instead of using ES module syntax. That
// makes it:
//   - loadable as a plain <script> / content_scripts entry in the
//     browser (Phase 4 just adds "lib/action-executor.js" to the
//     manifest's content_scripts.js array, in front of content.js), and
//   - importable for side effects from a Node ESM test file
//     (`import "../../extension/lib/action-executor.js"`), since a
//     script with zero import/export statements parses fine as a
//     (trivial) ES module too. Either way `globalThis.ActionExecutor`
//     ends up populated.
//
// ARCHITECTURE NOTE: every function here is a pure(ish) function over an
// explicit `root`/`element`/`idMap` argument -- no module-level mutable
// state, no implicit dependency on a global `document` except as a
// last-resort default. This is what makes it unit-testable with jsdom
// fixture HTML with zero extension/browser runtime involved (per
// CLAUDE.md Section 5: "every module that touches PII detection or
// redaction must be independently testable... fixture-in, JSON-out" --
// this module isn't PII/redaction, but the same testability bar is
// applied here since Section 6's checkpoint demands it explicitly).
//
// BBOX CAVEAT (flagged plainly, not silently): jsdom's
// `Element.getBoundingClientRect()` always returns all-zero geometry --
// jsdom does not run a layout engine. `defaultGetBBox` below is exactly
// that zero-returning call, so every bbox in a jsdom-produced
// `domSnapshot` is `{x:0,y:0,w:0,h:0}` by construction, NOT a bug in
// this file. Real pixel geometry is therefore UNVERIFIED outside a real
// browser. `bbox` acquisition is injectable (`options.getBBox`) for
// exactly this reason -- Phase 4, wiring this into the live content
// script, can pass the real `getBoundingClientRect`-based reader (which
// is in fact the default, so no override is even required in-browser;
// the override exists so tests can assert on deterministic fixture
// geometry instead of zeros if desired).
// ---------------------------------------------------------------------

(function () {
  "use strict";

  // -------------------------------------------------------------------
  // Shared constants
  // -------------------------------------------------------------------

  // Mirrors server/schemas.py's `PAGE_TARGET_ID = "page"` sentinel.
  // Cannot literally `import` a Python constant into JS -- this is the
  // cross-language equivalent of "import/mirror the constant, don't
  // re-derive the literal string": every use of the page sentinel in
  // this file goes through this one binding, never a second inline
  // `"page"` string, so an orchestrator-directed rename only touches
  // one line.
  var PAGE_TARGET_ID = "page";

  var AGENT_ID_ATTR = "data-agent-id";
  var AGENT_ID_PATTERN = /^agent-(\d+)$/;
  var SENSITIVE_ATTR = "data-agent-sensitive";

  // Mirrors dom-scanner.js's exported CLOSED_SHADOW_HOST_ATTR constant --
  // duplicated, not imported, because this file has zero import/export
  // statements by design (see file header). Keep the literal string in
  // sync if it ever changes; a drift-guard test in
  // tests/unit/test_action_executor.test.mjs checks this against
  // dom-scanner.js's own export.
  var CLOSED_SHADOW_HOST_ATTR = "data-sih-closed-shadow";

  // Actionable-element selector for Set-of-Mark grounding: form controls,
  // links, buttons, and anything wearing an interactive ARIA role or
  // explicit interactivity signal (onclick/tabindex/contenteditable).
  // input[type=hidden] is deliberately excluded (never visible, never
  // actionable by a vision+DOM agent).
  var ACTIONABLE_SELECTOR = [
    "a[href]",
    "button",
    "input:not([type=hidden])",
    "select",
    "textarea",
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="menuitem"]',
    '[role="tab"]',
    '[role="option"]',
    '[role="textbox"]',
    '[role="combobox"]',
    '[contenteditable="true"]',
    "[onclick]",
    "[tabindex]",
  ].join(",");

  var DEFAULT_SCROLL_PX = 600;

  // -------------------------------------------------------------------
  // Error type
  // -------------------------------------------------------------------

  /**
   * Structured failure for action execution. Every failure path in this
   * module throws one of these (never silently no-ops, never falls back
   * to guessing a different element) -- see CLAUDE.md Section 4 Phase 3
   * and Section 5's safety framing. `code` is a stable machine-checkable
   * string so callers (Phase 4's integration loop) can branch on it
   * without parsing `message` prose.
   *
   * Codes in use: UNKNOWN_ACTION, MISSING_TARGET_ID,
   * INVALID_TARGET_FOR_ACTION, TARGET_NOT_FOUND, TARGET_DETACHED,
   * SENSITIVE_TARGET_BLOCKED, NO_WINDOW_AVAILABLE, INVALID_ACTION_JSON.
   */
  function ActionExecutionError(code, message, details) {
    var err = new Error(message);
    err.name = "ActionExecutionError";
    err.code = code;
    err.details = details || {};
    // Restore correct prototype chain so `err instanceof ActionExecutionError`
    // works (Error subclassing via plain function, not `class`, for
    // maximum compatibility with the classic-script constraint above).
    Object.setPrototypeOf(err, ActionExecutionError.prototype);
    return err;
  }
  ActionExecutionError.prototype = Object.create(Error.prototype);
  ActionExecutionError.prototype.constructor = ActionExecutionError;

  // -------------------------------------------------------------------
  // Set-of-Mark grounding: agentId assignment
  // -------------------------------------------------------------------

  // -------------------------------------------------------------------
  // SHADOW DOM SUPPORT (real-site hardening pass). Mirrors
  // dom-scanner.js's collectShadowPiercingRoots()/CLOSED_SHADOW_HOST_ATTR
  // handling exactly -- see that file's SHADOW DOM SUPPORT block for the
  // full reasoning on why a closed shadow root is genuinely undetectable
  // by a pure function on its own, and why this module reports rather
  // than silently skips one when an external signal marks it. Duplicated
  // here (not shared via import) for the same classic-script reason as
  // CLOSED_SHADOW_HOST_ATTR above.
  //
  // Deliberately does NOT reach into <iframe>.contentDocument -- see
  // dom-scanner.js's identical note. Each frame gets its own
  // content-script instance calling buildDomSnapshot() with ITS OWN
  // document (manifest.json's all_frames:true); this function never
  // crosses a frame boundary itself.
  // -------------------------------------------------------------------
  function collectShadowPiercingRoots(root) {
    var roots = [root];
    var closedShadowHosts = [];
    var queue = [root];
    while (queue.length > 0) {
      var current = queue.shift();
      if (!current || typeof current.querySelectorAll !== "function") continue;
      var all;
      try {
        all = current.querySelectorAll("*");
      } catch (e) {
        continue; // a malformed/detached root must not crash the whole scan
      }
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (el.shadowRoot) {
          roots.push(el.shadowRoot);
          queue.push(el.shadowRoot);
        } else if (el.hasAttribute && el.hasAttribute(CLOSED_SHADOW_HOST_ATTR)) {
          closedShadowHosts.push(el);
        }
      }
    }
    return { roots: roots, closedShadowHosts: closedShadowHosts };
  }

  /**
   * Walk `root` AND every open shadow root reachable from it, collecting
   * actionable elements from each. Returns them concatenated in the order
   * each root was discovered (root itself first, exactly matching the
   * original single-root behavior when there is no shadow content at all
   * -- this is what keeps every pre-existing fixture/test byte-for-byte
   * unaffected), plus every element confirmed to host a closed
   * (unreachable) shadow root.
   *
   * @param {Document|Element} root
   * @returns {{ elements: Element[], closedShadowHosts: Element[] }}
   */
  function queryActionableElements(root) {
    if (!root || typeof root.querySelectorAll !== "function") {
      throw new ActionExecutionError(
        "INVALID_ROOT",
        "root must be a Document or Element with querySelectorAll()"
      );
    }
    var found = [];
    var allClosedShadowHosts = [];
    var piercing = collectShadowPiercingRoots(root);
    for (var r = 0; r < piercing.roots.length; r++) {
      var sub = piercing.roots[r];
      var matched;
      try {
        matched = sub.querySelectorAll(ACTIONABLE_SELECTOR);
      } catch (e) {
        continue;
      }
      for (var i = 0; i < matched.length; i++) found.push(matched[i]);
    }
    allClosedShadowHosts = piercing.closedShadowHosts;
    return { elements: found, closedShadowHosts: allClosedShadowHosts };
  }

  // Builds an id-recognition pattern for a given (possibly empty) frame
  // prefix. Default (no prefix) is EXACTLY the original
  // `/^agent-(\d+)$/` -- byte-for-byte unchanged behavior for every
  // existing caller that never passes options.idPrefix.
  function buildAgentIdPattern(idPrefix) {
    if (!idPrefix) return AGENT_ID_PATTERN;
    var escaped = String(idPrefix).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("^agent-" + escaped + "(\\d+)$");
  }

  /**
   * Walk actionable elements under `root` (piercing open shadow roots --
   * see SHADOW DOM SUPPORT above) and assign each a stable
   * `data-agent-id`, returning `{ idMap, closedShadowHosts }`.
   *
   * STABILITY: an element that already carries `data-agent-id` (from a
   * prior scan) keeps that exact id -- the attribute lives on the DOM
   * node itself, so `agent-1` refers to the same element across
   * re-scans of an unchanged page by construction, with no separate
   * cache to keep in sync. New elements (added since the last scan)
   * receive ids beyond the current highest-numbered id in the tree, so
   * they can never collide with an id already handed out. This does NOT
   * guarantee dense/reused numbering after elements are removed -- it
   * only guarantees existing elements never change id and new elements
   * never collide, which is the actual bar CLAUDE.md sets ("agent-1
   * must refer to the same element across re-scans of an unchanged
   * page").
   *
   * CROSS-FRAME UNIQUENESS (real-site hardening pass): with
   * manifest.json's all_frames:true, every frame (top page + every
   * iframe, same-origin or cross-origin) runs its OWN instance of this
   * module against its OWN document, each independently counting
   * "agent-1, agent-2, ..." from scratch. Left alone, a subframe's
   * "agent-1" would collide with the top frame's "agent-1" once
   * content.js merges their reports into one payload -- silently
   * corrupting the agentId->element correlation the whole Section 5
   * check and the sensitive-target guard depend on. `options.idPrefix`
   * (e.g. "f7-", one per Chrome frameId) is content.js's fix: every id
   * this frame mints is "agent-" + idPrefix + n instead of bare
   * "agent-" + n, and the recognition pattern used for RE-SCAN
   * stability is prefix-aware too, so a previously-stamped
   * "agent-f7-3" is correctly recognized as already-valid (not
   * reassigned) on the next scan. The TOP frame passes no idPrefix at
   * all (empty string), so its own ids stay bare "agent-<n>" exactly as
   * before -- 100% backward compatible for every existing caller/test,
   * none of which know frames exist.
   *
   * @param {Document|Element} root
   * @param {{ idPrefix?: string }} [options]
   * @returns {{ idMap: Map<string, Element>, closedShadowHosts: Element[] }}
   */
  function assignAgentIds(root, options) {
    var opts = options || {};
    var idPrefix = typeof opts.idPrefix === "string" ? opts.idPrefix : "";
    var pattern = buildAgentIdPattern(idPrefix);

    var queried = queryActionableElements(root);
    var elements = queried.elements;

    var maxIndex = 0;
    for (var i = 0; i < elements.length; i++) {
      var existing = elements[i].getAttribute(AGENT_ID_ATTR);
      if (existing) {
        var m = pattern.exec(existing);
        if (m) {
          var n = parseInt(m[1], 10);
          if (n > maxIndex) maxIndex = n;
        }
      }
    }

    var counter = maxIndex;
    var idMap = new Map();
    for (var j = 0; j < elements.length; j++) {
      var el = elements[j];
      var id = el.getAttribute(AGENT_ID_ATTR);
      if (!id || !pattern.test(id)) {
        counter += 1;
        id = "agent-" + idPrefix + counter;
        el.setAttribute(AGENT_ID_ATTR, id);
      }
      idMap.set(id, el);
    }
    return { idMap: idMap, closedShadowHosts: queried.closedShadowHosts };
  }

  // -------------------------------------------------------------------
  // domSnapshot production (server/schemas.py's DomNode)
  // -------------------------------------------------------------------

  var IMPLICIT_ROLE_BY_TAG = {
    button: "button",
    select: "combobox",
    textarea: "textbox",
  };

  var IMPLICIT_ROLE_BY_INPUT_TYPE = {
    checkbox: "checkbox",
    radio: "radio",
    button: "button",
    submit: "button",
    reset: "button",
    range: "slider",
    search: "searchbox",
  };

  /**
   * Best-effort implicit ARIA role when the element has none declared.
   * Heuristic, not a full HTML-AAM implementation -- good enough to give
   * the VLM a `role` hint per DomNode's "ARIA role, if any" field.
   */
  function getImplicitRole(el) {
    var explicit = el.getAttribute("role");
    if (explicit) return explicit;

    var tag = el.tagName.toLowerCase();
    if (tag === "a") return el.hasAttribute("href") ? "link" : null;
    if (tag === "input") {
      var type = (el.getAttribute("type") || "text").toLowerCase();
      return IMPLICIT_ROLE_BY_INPUT_TYPE[type] || "textbox";
    }
    return IMPLICIT_ROLE_BY_TAG[tag] || null;
  }

  /** DomNode.type: semantic/input type per schemas.py's field docstring. */
  function getSemanticType(el) {
    var tag = el.tagName.toLowerCase();
    if (tag === "input") return (el.getAttribute("type") || "text").toLowerCase();
    if (tag === "button") return (el.getAttribute("type") || "button").toLowerCase();
    return null;
  }

  /**
   * DomNode.text: best-effort visible/accessible text.
   *
   * IMPORTANT ORDERING NOTE for downstream modules: this is the RAW,
   * pre-redaction value (e.g. a password input's actual `.value`, if
   * one is present in the live DOM). That is intentional and correct
   * for this module's scope -- Phase 2a classifies which nodes are
   * sensitive and Phase 2b is the one that strips raw values out of the
   * DOM JSON before it is ever serialized for the network (CLAUDE.md
   * Section 4, Phase 2b: "strip flagged node values before that JSON is
   * ever serialized"). This module runs upstream of that stripping step
   * and must not pre-emptively guess at redaction -- doing so would be
   * duplicating 2a's classification work, which the delegation brief
   * explicitly says not to do. `sensitive` is always `false` here (see
   * buildDomSnapshot below) as the visible signal of this scoping.
   */
  function getAccessibleText(el) {
    var tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea") {
      if (typeof el.value === "string" && el.value !== "") return el.value;
      var ariaLabel = el.getAttribute("aria-label");
      if (ariaLabel) return ariaLabel;
      var placeholder = el.getAttribute("placeholder");
      if (placeholder) return placeholder;
      return "";
    }
    if (tag === "select") {
      var selected = el.options && el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;
      return selected ? String(selected.text).trim() : "";
    }
    var aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    return (el.textContent || "").trim();
  }

  /**
   * Default bbox reader. Real geometry in a browser; all-zero in jsdom
   * (see file-level BBOX CAVEAT). Injectable via options.getBBox.
   */
  function defaultGetBBox(el) {
    var r = el.getBoundingClientRect();
    return { x: r.x || 0, y: r.y || 0, w: r.width || 0, h: r.height || 0 };
  }

  /**
   * Build the `domSnapshot` array server/schemas.py's `DomNode[]`
   * expects, plus the id->element map action execution resolves
   * `targetId` through.
   *
   * Field-for-field match against schemas.py's DomNode:
   *   { agentId, tag, role, type, text, bbox:{x,y,w,h}, sensitive }
   *
   * `sensitive` is ALWAYS `false` here -- this module does not classify
   * PII (that is Phase 2a's job; Phase 4 merges 2a's `sensitiveNodes` in
   * to set each node's real `sensitive`/`piiType` after the fact, per
   * the Phase 1 RESULT's CONTRACT RULING: "2a classifies, 3
   * enumerates.")
   *
   * @param {Document|Element} [root] defaults to global `document` if
   *   available (browser content-script context); pass explicitly in
   *   tests (a jsdom document, or a container element).
   * @param {{getBBox?: function, idPrefix?: string}} [options]
   *   `idPrefix`: see assignAgentIds()'s CROSS-FRAME UNIQUENESS note --
   *   passed straight through, empty by default (bare "agent-<n>" ids,
   *   100% unchanged from before this option existed).
   * @returns {{
   *   domSnapshot: object[],
   *   idMap: Map<string, Element>,
   *   unscannableRegions: Array<{agentId: string|null, tag: string, bbox: object, reason: string}>
   * }}
   *   `unscannableRegions` (CONTRACT ADDITION, real-site hardening pass):
   *   elements confirmed to host a CLOSED shadow root this walk could not
   *   see into -- reported explicitly, always present (possibly empty).
   *   `agentId` is the HOST element's own id if it happened to also be
   *   independently actionable (e.g. a custom element with role="button"
   *   that also has a closed shadow root); the shadow TREE's own content
   *   was never enumerable in the first place, so there is nothing to
   *   assign an id to there -- only the host is identifiable.
   */
  function buildDomSnapshot(root, options) {
    var opts = options || {};
    var resolvedRoot = root || (typeof document !== "undefined" ? document : undefined);
    if (!resolvedRoot) {
      throw new ActionExecutionError(
        "INVALID_ROOT",
        "buildDomSnapshot: no root Document/Element provided and no global `document` is available"
      );
    }
    var getBBox = opts.getBBox || defaultGetBBox;

    var assigned = assignAgentIds(resolvedRoot, { idPrefix: opts.idPrefix });
    var idMap = assigned.idMap;
    var domSnapshot = [];
    idMap.forEach(function (el, agentId) {
      domSnapshot.push({
        agentId: agentId,
        tag: el.tagName.toLowerCase(),
        role: getImplicitRole(el),
        type: getSemanticType(el),
        text: getAccessibleText(el),
        bbox: getBBox(el),
        sensitive: false,
      });
    });

    var unscannableRegions = assigned.closedShadowHosts.map(function (el) {
      return {
        agentId: el.getAttribute(AGENT_ID_ATTR) || null,
        tag: el.tagName.toLowerCase(),
        bbox: getBBox(el),
        reason: "closed-shadow-root",
      };
    });

    return { domSnapshot: domSnapshot, idMap: idMap, unscannableRegions: unscannableRegions };
  }

  // -------------------------------------------------------------------
  // Action execution
  // -------------------------------------------------------------------

  var VALID_ACTIONS = { click: true, type: true, scroll: true, done: true };

  function resolveElement(idMap, targetId) {
    var el = idMap.get(targetId);
    if (!el) {
      throw new ActionExecutionError(
        "TARGET_NOT_FOUND",
        "no element mapped for targetId " + JSON.stringify(targetId) + " -- refusing to guess a different element",
        { targetId: targetId }
      );
    }
    if (el.isConnected === false) {
      throw new ActionExecutionError(
        "TARGET_DETACHED",
        "element for targetId " + JSON.stringify(targetId) + " has been removed from the DOM since the last scan",
        { targetId: targetId }
      );
    }
    return el;
  }

  /**
   * Default sensitivity check: an element is sensitive if its
   * `data-agent-sensitive` attribute is exactly the string "true", OR
   * its agentId is present in `options.sensitiveAgentIds` (a Set/Map,
   * if the caller prefers to pass sensitivity out-of-band rather than
   * mutating the DOM). Phase 4's merge step (CONTRACT RULING: "Phase 4
   * merges 2a's sensitiveNodes in") is expected to set one of these two
   * signals after combining this module's domSnapshot with 2a's
   * sensitiveNodes -- this module itself never sets either.
   */
  function defaultIsSensitive(el, options) {
    if (el.getAttribute(SENSITIVE_ATTR) === "true") return true;
    var set = options && options.sensitiveAgentIds;
    if (set) {
      var agentId = el.getAttribute(AGENT_ID_ATTR);
      if (typeof set.has === "function" && set.has(agentId)) return true;
    }
    return false;
  }

  /**
   * SAFETY GUARD HOOK (CLAUDE.md Section 5): whether to act on a
   * sensitive-flagged element is an orchestrator policy decision, not
   * something this module chooses silently. Default behaviour is
   * FAIL-CLOSED -- block click/type on any element `isSensitive` flags,
   * unless the caller explicitly opts in via `options.allowSensitiveTargets
   * === true` or a `options.onSensitiveTarget(el, actionJson)` callback
   * that returns `true`. This default was chosen (not left for the
   * orchestrator to pick blind) because blocking is the reversible,
   * safe failure mode -- a caller who wants the opposite policy must say
   * so explicitly, in code, at the call site. See the report back to the
   * orchestrator for the explicit open question this represents.
   *
   * Scoped to click/type only (the actions that actually write to or
   * trigger a page) -- `scroll`/`done` are not gated, since bringing a
   * sensitive element into view or marking task completion doesn't
   * itself read or transmit its contents.
   */
  function guardSensitive(el, actionJson, options) {
    var opts = options || {};
    var isSensitive = opts.isSensitive || defaultIsSensitive;
    if (!isSensitive(el, opts)) return;

    if (typeof opts.onSensitiveTarget === "function") {
      var decision = opts.onSensitiveTarget(el, actionJson);
      if (decision === true) return;
      throw new ActionExecutionError(
        "SENSITIVE_TARGET_BLOCKED",
        "action blocked: target element is flagged sensitive; onSensitiveTarget hook declined to override",
        { targetId: actionJson.targetId }
      );
    }
    if (opts.allowSensitiveTargets === true) return;

    throw new ActionExecutionError(
      "SENSITIVE_TARGET_BLOCKED",
      "action blocked: target element is flagged sensitive (data-agent-sensitive or sensitiveAgentIds). " +
        "Acting on it is a policy decision this module will not make silently -- pass " +
        "options.allowSensitiveTargets=true or an options.onSensitiveTarget(el, actionJson) hook that " +
        "returns true to explicitly authorize it.",
      { targetId: actionJson.targetId }
    );
  }

  function getView(el) {
    if (el.ownerDocument && el.ownerDocument.defaultView) return el.ownerDocument.defaultView;
    if (typeof window !== "undefined") return window;
    throw new ActionExecutionError(
      "NO_WINDOW_AVAILABLE",
      "cannot resolve a window/realm to construct DOM events from this element"
    );
  }

  function dispatchClick(el) {
    var view = getView(el);
    if (typeof el.focus === "function") {
      try {
        el.focus();
      } catch (e) {
        /* not all elements are focusable; not fatal */
      }
    }
    var evt = new view.MouseEvent("click", { bubbles: true, cancelable: true, composed: true, view: view });
    var notCancelled = el.dispatchEvent(evt);
    return {
      ok: true,
      action: "click",
      targetId: el.getAttribute(AGENT_ID_ATTR),
      defaultPrevented: !notCancelled,
    };
  }

  /**
   * Sets a form control's value through the PROTOTYPE'S value setter
   * (not the instance), then fires real `input`/`change` events.
   *
   * WHY: React (and similar frameworks) patch the native
   * HTMLInputElement/HTMLTextAreaElement `value` setter to track the
   * "last known value" so it can tell a genuine user edit apart from a
   * programmatic `el.value = x` assignment (which it deliberately
   * ignores, precisely to avoid an infinite render loop). Calling the
   * value setter found by walking the element's OWN prototype chain --
   * rather than a hardcoded global `HTMLInputElement.prototype`, which
   * may be the wrong realm in a jsdom/iframe context -- reproduces what
   * a real user's keystroke does at the DOM level, and the subsequent
   * `dispatchEvent(new Event("input", {bubbles:true}))` is what React's
   * root-level delegated listener actually observes. Setting `.value`
   * directly (without this) is exactly the "just set .value" failure
   * mode the delegation brief calls out.
   */
  function setNativeValue(el, value) {
    var proto = Object.getPrototypeOf(el);
    var descriptor;
    while (proto && !descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(proto, "value");
      proto = Object.getPrototypeOf(proto);
    }
    if (descriptor && typeof descriptor.set === "function") {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
  }

  function dispatchType(el, value) {
    var text = value === null || value === undefined ? "" : String(value);
    var view = getView(el);
    if (typeof el.focus === "function") {
      try {
        el.focus();
      } catch (e) {
        /* not fatal */
      }
    }
    if (el.isContentEditable) {
      el.textContent = text;
    } else {
      setNativeValue(el, text);
    }
    el.dispatchEvent(new view.Event("input", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new view.Event("change", { bubbles: true, cancelable: true }));
    return {
      ok: true,
      action: "type",
      targetId: el.getAttribute(AGENT_ID_ATTR),
      value: text,
    };
  }

  /**
   * Interprets the action JSON's optional `value` for a page-level
   * scroll. NOT specified by CLAUDE.md's `{action, targetId, value}`
   * contract beyond "value: optional string" -- this is a Phase 3
   * execution-detail choice, not a contract deviation (the server never
   * has to know how scroll amounts are encoded client-side). Accepts:
   * "up"/"down" (one DEFAULT_SCROLL_PX step), "top"/"bottom", a numeric
   * pixel amount (string or number), or nothing (defaults to a
   * DEFAULT_SCROLL_PX step downward). Unrecognized strings fall back to
   * the default rather than throwing -- scroll is low-risk/reversible,
   * so failing loud here (unlike click/type) isn't worth the brittleness.
   */
  function parseScrollAmount(value) {
    if (value === null || value === undefined || value === "") return DEFAULT_SCROLL_PX;
    var s = String(value).trim().toLowerCase();
    if (s === "up") return -DEFAULT_SCROLL_PX;
    if (s === "down") return DEFAULT_SCROLL_PX;
    if (s === "top") return -Number.MAX_SAFE_INTEGER;
    if (s === "bottom") return Number.MAX_SAFE_INTEGER;
    var n = Number(s);
    if (!Number.isNaN(n)) return n;
    return DEFAULT_SCROLL_PX;
  }

  function defaultScrollWindowBy(win, amountPx) {
    win.scrollBy(0, amountPx);
  }

  function defaultScrollElementIntoView(el) {
    if (typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "auto", block: "center" });
    }
  }

  function dispatchPageScroll(value, options) {
    var opts = options || {};
    var win = opts.window || (typeof window !== "undefined" ? window : undefined);
    if (!win) {
      throw new ActionExecutionError(
        "NO_WINDOW_AVAILABLE",
        "page-level scroll (targetId=" + JSON.stringify(PAGE_TARGET_ID) + ") requires options.window " +
          "(or a global `window`) -- pass jsdom's `dom.window` in tests"
      );
    }
    var amount = parseScrollAmount(value);
    var scrollFn = opts.scrollWindowBy || defaultScrollWindowBy;
    scrollFn(win, amount);
    return { ok: true, action: "scroll", targetId: PAGE_TARGET_ID, amountPx: amount };
  }

  function dispatchElementScroll(el, options) {
    var opts = options || {};
    var scrollFn = opts.scrollElementIntoView || defaultScrollElementIntoView;
    scrollFn(el);
    return { ok: true, action: "scroll", targetId: el.getAttribute(AGENT_ID_ATTR) };
  }

  /**
   * Execute server/schemas.py's ActionResponse against a live DOM,
   * resolved ONLY through `idMap` (never raw pixel coordinates -- that
   * is the entire point of Set-of-Mark grounding).
   *
   * @param {{action: "click"|"type"|"scroll"|"done", targetId: string, value?: string}} actionJson
   * @param {Map<string, Element>} idMap from buildDomSnapshot/assignAgentIds
   * @param {{
   *   isSensitive?: function(Element, object): boolean,
   *   allowSensitiveTargets?: boolean,
   *   onSensitiveTarget?: function(Element, object): boolean,
   *   sensitiveAgentIds?: Set<string>,
   *   window?: Window,
   *   scrollWindowBy?: function(Window, number): void,
   *   scrollElementIntoView?: function(Element): void,
   * }} [options]
   * @returns {object} a small result-description object (never the raw
   *   value being typed, for consistency with Section 5's "an error path
   *   is a data egress path" lesson -- results here are for local
   *   caller logging, not network transmission, but keeping them value-
   *   light costs nothing and avoids a footgun if that assumption ever
   *   changes).
   * @throws {ActionExecutionError} on any of: unrecognized action,
   *   missing targetId, PAGE_TARGET_ID used with click/type, unknown
   *   targetId, a removed/detached target element, or a blocked
   *   sensitive-target guard. NEVER silently no-ops and NEVER falls back
   *   to acting on a different element.
   */
  function executeAction(actionJson, idMap, options) {
    if (!actionJson || typeof actionJson !== "object") {
      throw new ActionExecutionError("INVALID_ACTION_JSON", "action JSON must be an object");
    }
    if (!idMap || typeof idMap.get !== "function") {
      throw new ActionExecutionError("INVALID_ID_MAP", "idMap must be a Map<string, Element> from buildDomSnapshot/assignAgentIds");
    }

    var action = actionJson.action;
    var targetId = actionJson.targetId;
    var value = actionJson.value;

    if (!VALID_ACTIONS[action]) {
      throw new ActionExecutionError(
        "UNKNOWN_ACTION",
        "unrecognized action type: " + JSON.stringify(action),
        { action: action }
      );
    }
    if (typeof targetId !== "string" || targetId.length === 0) {
      throw new ActionExecutionError(
        "MISSING_TARGET_ID",
        "targetId is required for every action (use the PAGE_TARGET_ID sentinel for a whole-page scroll/done)",
        { action: action }
      );
    }

    if (action === "click" || action === "type") {
      if (targetId === PAGE_TARGET_ID) {
        throw new ActionExecutionError(
          "INVALID_TARGET_FOR_ACTION",
          '"' + action + '" requires a real element targetId, not the page sentinel',
          { action: action, targetId: targetId }
        );
      }
      var el = resolveElement(idMap, targetId);
      guardSensitive(el, actionJson, options);
      return action === "click" ? dispatchClick(el) : dispatchType(el, value);
    }

    if (action === "scroll") {
      if (targetId === PAGE_TARGET_ID) {
        return dispatchPageScroll(value, options);
      }
      var scrollEl = resolveElement(idMap, targetId);
      return dispatchElementScroll(scrollEl, options);
    }

    // action === "done"
    if (targetId === PAGE_TARGET_ID) {
      return { ok: true, action: "done", targetId: PAGE_TARGET_ID };
    }
    var doneEl = resolveElement(idMap, targetId);
    return { ok: true, action: "done", targetId: doneEl.getAttribute(AGENT_ID_ATTR) };
  }

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------

  globalThis.ActionExecutor = {
    PAGE_TARGET_ID: PAGE_TARGET_ID,
    ACTIONABLE_SELECTOR: ACTIONABLE_SELECTOR,
    AGENT_ID_ATTR: AGENT_ID_ATTR,
    SENSITIVE_ATTR: SENSITIVE_ATTR,
    CLOSED_SHADOW_HOST_ATTR: CLOSED_SHADOW_HOST_ATTR,
    ActionExecutionError: ActionExecutionError,

    assignAgentIds: assignAgentIds,
    buildDomSnapshot: buildDomSnapshot,
    executeAction: executeAction,

    // Exposed for advanced callers / tests; not required for normal use.
    defaultGetBBox: defaultGetBBox,
    defaultIsSensitive: defaultIsSensitive,
    getAccessibleText: getAccessibleText,
    getImplicitRole: getImplicitRole,
    getSemanticType: getSemanticType,
    setNativeValue: setNativeValue,
    parseScrollAmount: parseScrollAmount,
  };
})();
