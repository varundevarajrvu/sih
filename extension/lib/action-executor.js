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

  // PROFILE-VAULT FEATURE: mirrors profile-vault.js's exported
  // PROFILE_FIELDS array exactly -- duplicated, not imported, for the same
  // classic-script reason as CLOSED_SHADOW_HOST_ATTR below (this file has
  // zero import/export statements by design; profile-vault.js is an ES
  // module). Keep in sync if the field set ever changes; a drift-guard
  // test in tests/unit/test_action_executor.test.mjs checks this against
  // profile-vault.js's own export, same pattern as the existing
  // CLOSED_SHADOW_HOST_ATTR guard.
  var PROFILE_FIELDS = { full_name: true, email: true, phone: true };

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
   * SENSITIVE_TARGET_BLOCKED, IRREVERSIBLE_ACTION_BLOCKED,
   * NO_WINDOW_AVAILABLE, INVALID_ACTION_JSON. PROFILE-VAULT FEATURE adds:
   * INVALID_PROFILE_FIELD (fill_profile's profileField is missing or not
   * one of the closed PROFILE_FIELDS), PROFILE_VAULT_UNAVAILABLE (caller
   * never wired in options.getProfileValue), PROFILE_FIELD_EMPTY (the
   * vault has nothing saved for the requested category -- see
   * dispatchFillProfile()).
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

  var VALID_ACTIONS = { click: true, type: true, scroll: true, done: true, fill_profile: true };

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
   *
   * WIRING PASS ADDITION (CLAUDE.md TIER 2 ORCHESTRATOR RULING #3):
   * "guardSensitive() runs FIRST, then classifyActionRisk(). When an
   * element trips BOTH, report SENSITIVE_TARGET_BLOCKED but INCLUDE the
   * reasons from both." This function still runs, checks, and throws
   * first -- untouched in shape -- but when it is ABOUT to throw, it now
   * also asks classifyIrreversible() (a no-op returning risk:"safe" if
   * options.classifyActionRisk was never wired in by the caller -- see
   * that function) whether this SAME element+action also matches a
   * destructive-intent signal, and folds those reasons into the thrown
   * error's message/details if so. When nothing irreversible-flagged is
   * found (the overwhelming common case, and every pre-existing call site
   * that never passes options.classifyActionRisk), the thrown message is
   * byte-for-byte identical to before this pass -- see
   * buildSensitiveBlockedError() below.
   */
  function guardSensitive(el, actionJson, options) {
    var opts = options || {};

    // 🔴 PROFILE-VAULT FEATURE CARVE-OUT -- read this before "fixing" it.
    // `fill_profile` is EXEMPT from this guard, deliberately, and this is
    // the ONLY exemption in this function. THE REASONING DOES NOT
    // GENERALIZE TO `type` -- do not be tempted to relax this guard for
    // `type` too, ever:
    //
    //   This guard exists to stop a MODEL-CHOSEN value from being written
    //   into a field the client itself has flagged as holding PII. The
    //   model has no legitimate way to know what belongs in a
    //   password/email/ID field it was never shown the contents of, so ANY
    //   value it supplies for such a field is untrusted by construction --
    //   that is exactly what `type`'s guard blocks below, and that block
    //   is UNCHANGED by this carve-out: a model-supplied `type` value into
    //   a sensitive field is still blocked, unconditionally, every time.
    //
    //   `fill_profile` cannot violate that invariant because it
    //   structurally never carries a model-chosen value at all. The model
    //   only ever names a CATEGORY (actionJson.profileField, one of
    //   "full_name"/"email"/"phone") -- dispatchFillProfile() below
    //   resolves the actual string from LOCAL chrome.storage.local (via
    //   the caller-injected options.getProfileValue) and never once reads
    //   actionJson.value. There is nothing here for this guard to protect
    //   against: the value that ends up in the field was never sent to,
    //   seen by, or chosen by the model in the first place -- it is
    //   client-local data flowing into a client-local field. Blocking it
    //   here would just prevent the feature from doing the one thing it
    //   exists to do (autofill a profile field the field-level guard would
    //   otherwise, correctly, refuse a MODEL-supplied value for).
    if (actionJson && actionJson.action === "fill_profile") return;

    var isSensitive = opts.isSensitive || defaultIsSensitive;
    if (!isSensitive(el, opts)) return;

    if (typeof opts.onSensitiveTarget === "function") {
      var decision = opts.onSensitiveTarget(el, actionJson);
      if (decision === true) return;
      throw buildSensitiveBlockedError(
        el,
        actionJson,
        opts,
        "action blocked: target element is flagged sensitive; onSensitiveTarget hook declined to override"
      );
    }
    if (opts.allowSensitiveTargets === true) return;

    throw buildSensitiveBlockedError(
      el,
      actionJson,
      opts,
      "action blocked: target element is flagged sensitive (data-agent-sensitive or sensitiveAgentIds). " +
        "Acting on it is a policy decision this module will not make silently -- pass " +
        "options.allowSensitiveTargets=true or an options.onSensitiveTarget(el, actionJson) hook that " +
        "returns true to explicitly authorize it."
    );
  }

  /**
   * Builds the SENSITIVE_TARGET_BLOCKED error guardSensitive() throws,
   * merging in classifyActionRisk() reasons when the SAME element+action
   * also trips the irreversible-action classifier (RULING #3 -- see
   * guardSensitive()'s doc comment). `baseMessage` is returned completely
   * unchanged when there is nothing to merge (classifyActionRisk not
   * wired at this call site, or it returned risk:"safe") -- this is what
   * keeps every pre-existing SENSITIVE_TARGET_BLOCKED assertion (tests,
   * demo/README.md's documented console line) byte-for-byte intact.
   */
  function buildSensitiveBlockedError(el, actionJson, opts, baseMessage) {
    var risk = classifyIrreversible(el, actionJson, opts);
    var alsoIrreversible = risk.risk === "irreversible" && risk.reasons.length > 0;
    var message = alsoIrreversible
      ? baseMessage + " ALSO matches irreversible-action signal(s): " + risk.reasons.join("; ") + "."
      : baseMessage;
    return new ActionExecutionError("SENSITIVE_TARGET_BLOCKED", message, {
      targetId: actionJson.targetId,
      reasons: ["target flagged sensitive"].concat(alsoIrreversible ? risk.reasons : []),
    });
  }

  /**
   * Default field extraction for classifyActionRisk(), read off the LIVE
   * DOM element right before dispatch -- see action-risk.js's file-header
   * "WHY domNode ISN'T STRICTLY server/schemas.py::DomNode" note and its
   * "HOW TO CONSUME" block: the live element carries text/attributes
   * (value, aria-label, name, id) the already-lossy domSnapshot may have
   * dropped, and recall matters here (a false negative lets an
   * autonomous agent complete a destructive action; a false positive is
   * a recoverable, explained refusal).
   */
  function collectDomNodeFieldsForRisk(el) {
    return {
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type"),
      text: getAccessibleText(el),
      value: el.value,
      ariaLabel: el.getAttribute("aria-label"),
      name: el.getAttribute("name"),
      id: el.id,
    };
  }

  /**
   * Runs action-risk.js's classifyActionRisk() against the live element,
   * if (and only if) the caller wired it in via `options.classifyActionRisk`
   * -- this file has ZERO import/export statements by design (see file
   * header), so it cannot itself `import` an ES module; action-risk.js is
   * an ES module (see that file's own header), so it can only ever be
   * INJECTED here by whichever caller loaded it (content.js dynamically
   * imports it exactly like dom-scanner.js/redaction.js -- see that
   * file's loadLibModules()). When it hasn't been wired in, this degrades
   * to risk:"safe" rather than throwing or skipping the action guard
   * entirely -- mirrors defaultIsSensitive()'s own posture toward an
   * absent signal, and is what keeps every pre-existing call site (none
   * of which know this classifier exists yet) behaviourally unchanged.
   *
   * @returns {{risk: "safe"|"irreversible", reasons: string[]}}
   */
  function classifyIrreversible(el, actionJson, opts) {
    var classify = opts.classifyActionRisk;
    if (typeof classify !== "function") {
      return { risk: "safe", reasons: [] };
    }
    var getFields = opts.getRiskFields || collectDomNodeFieldsForRisk;
    var fields = getFields(el);
    var result = classify(fields, actionJson, opts.classifyActionRiskOptions);
    if (result && result.risk === "irreversible") {
      return { risk: "irreversible", reasons: Array.isArray(result.reasons) ? result.reasons : [] };
    }
    return { risk: "safe", reasons: [] };
  }

  /**
   * SECOND SAFETY GUARD (CLAUDE.md TIER 2 ORCHESTRATOR RULINGS, wiring
   * pass): blocks click/type against an element classifyActionRisk()
   * flags as "irreversible" (a "Buy Now"/"Place Order"/"Delete Account"
   * -style destructive control -- not PII, so guardSensitive() above has
   * nothing to say about it). Deliberately mirrors guardSensitive()'s own
   * shape: FAIL-CLOSED by default, with an `options.allowIrreversibleActions
   * === true` escape hatch and an `options.onIrreversibleAction(el,
   * actionJson, riskResult)` override hook that returns `true` to
   * authorize -- both DISABLED unless a caller explicitly wires them in,
   * same reasoning as the sensitive guard's own hooks: a real product
   * needs a consent path, a demo that silently auto-approves proves
   * nothing.
   *
   * Runs AFTER guardSensitive() (RULING #3 -- see that function and
   * executeAction()'s click/type branch for the call order) and is a
   * complete no-op (never throws) when options.classifyActionRisk was
   * never wired in -- see classifyIrreversible() above.
   */
  function guardIrreversible(el, actionJson, options) {
    var opts = options || {};
    var risk = classifyIrreversible(el, actionJson, opts);
    if (risk.risk !== "irreversible") return;

    if (typeof opts.onIrreversibleAction === "function") {
      var decision = opts.onIrreversibleAction(el, actionJson, risk);
      if (decision === true) return;
      throw new ActionExecutionError(
        "IRREVERSIBLE_ACTION_BLOCKED",
        "action blocked: " + risk.reasons.join("; ") + "; onIrreversibleAction hook declined to override",
        { targetId: actionJson.targetId, reasons: risk.reasons }
      );
    }
    if (opts.allowIrreversibleActions === true) return;

    throw new ActionExecutionError(
      "IRREVERSIBLE_ACTION_BLOCKED",
      "action blocked: " + risk.reasons.join("; ") + ". Acting on it is a policy decision this module will not " +
        "make silently -- pass options.allowIrreversibleActions=true or an options.onIrreversibleAction(el, " +
        "actionJson, riskResult) hook that returns true to explicitly authorize it.",
      { targetId: actionJson.targetId, reasons: risk.reasons }
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

  // -------------------------------------------------------------------
  // PROFILE-VAULT FEATURE: fill_profile.
  // -------------------------------------------------------------------

  /**
   * Structural validation ONLY -- does not touch the vault, does not
   * resolve `el`. Checked as early as possible (before resolveElement())
   * so a malformed profileField fails loudly before anything else runs,
   * same "fail fast, fail loud" posture as MISSING_TARGET_ID above.
   */
  function validateProfileFieldOrThrow(actionJson) {
    var field = actionJson.profileField;
    if (typeof field !== "string" || !PROFILE_FIELDS[field]) {
      throw new ActionExecutionError(
        "INVALID_PROFILE_FIELD",
        "fill_profile requires a valid profileField (one of " +
          Object.keys(PROFILE_FIELDS).join(", ") +
          "); got " +
          JSON.stringify(field),
        { targetId: actionJson.targetId, profileField: field }
      );
    }
  }

  /**
   * Fills `el` with a value looked up from the LOCAL profile vault --
   * never from `actionJson.value` (this function doesn't even accept an
   * actionJson/value parameter, structurally: there is nothing to
   * "accidentally" read). `profileField` is the CATEGORY the model named
   * ("full_name"|"email"|"phone", already validated by
   * validateProfileFieldOrThrow() before this runs); the caller
   * (content.js) is the only thing that knows how to turn that category
   * into a real string, via `options.getProfileValue` -- injected exactly
   * like `options.classifyActionRisk` is (see that option's own doc
   * comment) because this file has zero import/export statements and
   * cannot itself `import` profile-vault.js (an ES module).
   *
   * Reuses the SAME native-setter + real-event dispatch dispatchType()
   * uses (setNativeValue() + input/change Events) so a React-style
   * controlled field observes a vault fill exactly like it would observe
   * a real user keystroke or a model-driven `type` -- see setNativeValue()'s
   * own doc comment for why a plain `.value =` assignment isn't enough.
   *
   * FAILS CLEANLY, never silently: PROFILE_VAULT_UNAVAILABLE if the caller
   * never wired in options.getProfileValue at all (a wiring bug, not a
   * user-facing state); PROFILE_FIELD_EMPTY if the vault genuinely has
   * nothing saved for this category. Neither path types an empty string
   * or falls back to guessing some other value -- an untouched field that
   * visibly failed is recoverable; a silently-typed empty string looks
   * like success and could get "submitted" downstream with the rest of a
   * form.
   *
   * 🔴 THE RETURNED RESULT DELIBERATELY OMITS `value` -- unlike
   * dispatchType()'s result (which echoes back the MODEL's own
   * already-known string, safe for local caller logging/the RUN SUMMARY).
   * This function's value came from the vault and must never surface in a
   * log line, an error message, or content.js's RUN SUMMARY -- see this
   * file's PROFILE-VAULT FEATURE header and profile-vault.js's own "vault
   * must never leave the client" note. `profileField` (the CATEGORY name,
   * e.g. "email") is not sensitive on its own and is safe to include --
   * it is what action-describe.js's "filled email from your profile"
   * phrasing reads back out.
   */
  function dispatchFillProfile(el, profileField, options) {
    var opts = options || {};
    var getProfileValue = opts.getProfileValue;
    if (typeof getProfileValue !== "function") {
      throw new ActionExecutionError(
        "PROFILE_VAULT_UNAVAILABLE",
        "fill_profile requires options.getProfileValue to be wired in by the caller (content.js loads " +
          "profile-vault.js and injects a synchronous lookup closure) -- refusing to guess or fall back to any " +
          "other value source",
        { targetId: el.getAttribute(AGENT_ID_ATTR), profileField: profileField }
      );
    }

    var value = getProfileValue(profileField);
    if (typeof value !== "string" || value.trim() === "") {
      throw new ActionExecutionError(
        "PROFILE_FIELD_EMPTY",
        'fill_profile: no value saved in your local profile for "' +
          profileField +
          '" -- refusing to type an empty string or fall back to the model\'s own value',
        { targetId: el.getAttribute(AGENT_ID_ATTR), profileField: profileField }
      );
    }

    var view = getView(el);
    if (typeof el.focus === "function") {
      try {
        el.focus();
      } catch (e) {
        /* not fatal */
      }
    }
    if (el.isContentEditable) {
      el.textContent = value;
    } else {
      setNativeValue(el, value);
    }
    el.dispatchEvent(new view.Event("input", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new view.Event("change", { bubbles: true, cancelable: true }));

    return {
      ok: true,
      action: "fill_profile",
      targetId: el.getAttribute(AGENT_ID_ATTR),
      profileField: profileField,
      // NO `value` field -- see this function's doc comment above.
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
   * @param {{action: "click"|"type"|"scroll"|"done"|"fill_profile", targetId: string, value?: string|null, profileField?: "full_name"|"email"|"phone"|null}} actionJson
   *   `profileField` is required iff `action === "fill_profile"`; `value`
   *   is ignored entirely for that action (see dispatchFillProfile()) --
   *   this file never reads it for fill_profile, by construction, not just
   *   by convention.
   * @param {Map<string, Element>} idMap from buildDomSnapshot/assignAgentIds
   * @param {{
   *   isSensitive?: function(Element, object): boolean,
   *   allowSensitiveTargets?: boolean,
   *   onSensitiveTarget?: function(Element, object): boolean,
   *   sensitiveAgentIds?: Set<string>,
   *   classifyActionRisk?: function(object, object, object=): {risk: string, reasons: string[]},
   *   getRiskFields?: function(Element): object,
   *   classifyActionRiskOptions?: object,
   *   allowIrreversibleActions?: boolean,
   *   onIrreversibleAction?: function(Element, object, {risk:string,reasons:string[]}): boolean,
   *   getProfileValue?: function(string): string|null,
   *   window?: Window,
   *   scrollWindowBy?: function(Window, number): void,
   *   scrollElementIntoView?: function(Element): void,
   * }} [options]
   *   `classifyActionRisk` (wiring-pass addition): action-risk.js's
   *   exported `classifyActionRisk` function, injected by the caller --
   *   this file has zero import/export statements by design and cannot
   *   import that ES module itself (see classifyIrreversible()'s doc
   *   comment). Omitted entirely, the irreversible-action guard below is
   *   a no-op, matching every pre-existing call site's behaviour exactly.
   *   `allowIrreversibleActions`/`onIrreversibleAction` mirror
   *   `allowSensitiveTargets`/`onSensitiveTarget` and are DISABLED unless
   *   explicitly set, same fail-closed-by-default posture.
   *   `getProfileValue` (PROFILE-VAULT FEATURE): a synchronous
   *   `profileField -> string|null` lookup, injected by the caller
   *   (content.js, after dynamically importing profile-vault.js and
   *   fetching the profile ONCE -- see that file's "HOW TO CONSUME" block
   *   for why this must be synchronous). Required for `fill_profile` to
   *   succeed; its absence throws PROFILE_VAULT_UNAVAILABLE rather than
   *   silently no-op-ing. Irrelevant to every other action.
   * @returns {object} a small result-description object. Never the raw
   *   value for a MODEL-supplied `type` beyond what was already
   *   known/sent by the model itself (kept for local caller logging, per
   *   Section 5's "an error path is a data egress path" lesson -- see
   *   dispatchType()). For `fill_profile` this goes further: the result
   *   NEVER includes the vault-sourced value at all, under any
   *   circumstances -- see dispatchFillProfile()'s own doc comment. Only
   *   `profileField` (the category name, not the value) is included.
   * @throws {ActionExecutionError} on any of: unrecognized action,
   *   missing targetId, PAGE_TARGET_ID used with click/type/fill_profile,
   *   unknown targetId, a removed/detached target element, a blocked
   *   sensitive-target guard, an invalid/missing profileField, a missing
   *   options.getProfileValue, or an empty vault field for fill_profile.
   *   NEVER silently no-ops and NEVER falls back to acting on a different
   *   element or a different value source.
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

    if (action === "click" || action === "type" || action === "fill_profile") {
      if (targetId === PAGE_TARGET_ID) {
        throw new ActionExecutionError(
          "INVALID_TARGET_FOR_ACTION",
          '"' + action + '" requires a real element targetId, not the page sentinel',
          { action: action, targetId: targetId }
        );
      }
      // PROFILE-VAULT FEATURE: structural validation only (profileField
      // shape), before resolveElement() -- see validateProfileFieldOrThrow()'s
      // own doc comment for why this runs this early.
      if (action === "fill_profile") {
        validateProfileFieldOrThrow(actionJson);
      }
      var el = resolveElement(idMap, targetId);
      // RULING #3: guardSensitive() (the project's core, more specific
      // invariant) runs FIRST and, if it blocks, has already folded in
      // classifyActionRisk()'s reasons for this same element (see
      // buildSensitiveBlockedError()). guardIrreversible() only ever
      // gets a turn when guardSensitive() did NOT throw -- i.e. the
      // element isn't sensitive at all, a sensitive-target override
      // explicitly authorized acting on it anyway, or (PROFILE-VAULT
      // FEATURE) this is a fill_profile action, which guardSensitive()
      // exempts unconditionally -- see that function's FILL_PROFILE
      // CARVE-OUT comment for exactly why that's safe. guardIrreversible()
      // is UNCHANGED and still runs for fill_profile exactly like it does
      // for click/type -- action-risk.js's classifyActionRisk() itself
      // only evaluates click/type, so this is a defense-in-depth call, not
      // a behavior change to that module.
      guardSensitive(el, actionJson, options);
      guardIrreversible(el, actionJson, options);
      if (action === "click") return dispatchClick(el);
      if (action === "type") return dispatchType(el, value);
      return dispatchFillProfile(el, actionJson.profileField, options);
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
    PROFILE_FIELDS: PROFILE_FIELDS,
    ActionExecutionError: ActionExecutionError,

    assignAgentIds: assignAgentIds,
    buildDomSnapshot: buildDomSnapshot,
    executeAction: executeAction,

    // Exposed for advanced callers / tests; not required for normal use.
    defaultGetBBox: defaultGetBBox,
    defaultIsSensitive: defaultIsSensitive,
    defaultGetRiskFields: collectDomNodeFieldsForRisk,
    getAccessibleText: getAccessibleText,
    getImplicitRole: getImplicitRole,
    getSemanticType: getSemanticType,
    setNativeValue: setNativeValue,
    parseScrollAmount: parseScrollAmount,
  };
})();
