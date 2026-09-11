// SIH 26171 -- real-site hardening pass: closed-shadow-root detection.
//
// THE PROBLEM: dom-scanner.js/action-executor.js cannot tell "this element
// never had a shadow root" apart from "this element has a CLOSED shadow
// root" -- element.shadowRoot reads back null in both cases, by design
// (that is the entire point of closed mode: hide the shadow tree's
// existence, not merely its content, from outside script). There is no
// public DOM API that answers this question after the fact. The ONLY way
// to observe a closed attachShadow() call at all is to intercept the call
// itself, before it happens, in the SAME JS realm the page's own script
// runs in.
//
// THE MECHANISM: this file is registered as a MAIN-WORLD content script
// (manifest.json's content_scripts[].world:"MAIN"), run_at:"document_start"
// -- it executes in the PAGE's own JavaScript realm (sharing Window/
// Element/etc. with the page's own scripts), BEFORE any of the page's own
// scripts run. That ordering guarantee is what makes this reliable: by
// the time the page's first <script> tag (inline or external) executes,
// Element.prototype.attachShadow has already been replaced by the
// wrapper below, so EVERY attachShadow() call the page ever makes --
// including ones inside bundled/minified vendor code -- goes through it.
//
// WHY MAIN WORLD, NOT THE USUAL ISOLATED WORLD: content.js and
// action-executor.js run in the ISOLATED world (Chrome's default) -- a
// separate JS realm from the page's own script, sharing only the DOM
// tree itself, not any JS object/prototype. Patching
// Element.prototype.attachShadow from the isolated world would create a
// SEPARATE Element.prototype specific to that world; the page's own
// script (running in the MAIN world) would never see the patch at all,
// and this whole mechanism would silently do nothing. This file MUST run
// in the MAIN world to intercept the page's own calls.
//
// THE HANDOFF BACK TO THE ISOLATED WORLD: once a closed shadow root is
// observed, this (MAIN-world) script marks the host element with a DOM
// attribute -- CLOSED_SHADOW_HOST_ATTR, mirrored from
// dom-scanner.js/action-executor.js's own exported/internal constant of
// the same name (kept in sync by hand; see the drift-guard tests in
// tests/unit/test_dom_scanner.mjs and test_action_executor.test.mjs).
// Setting a DOM attribute is visible across the world boundary because it
// mutates the actual, SHARED DOM tree -- unlike a JS property/variable,
// which is per-world and would NOT cross. dom-scanner.js/action-executor.js
// (running in the isolated world, as always) then simply look for that
// attribute during their normal walk -- see their SHADOW DOM SUPPORT
// blocks -- and report the host in `unscannableRegions` instead of
// silently treating it as an ordinary, checked-and-clean leaf.
//
// RELIABILITY, STATED PLAINLY RATHER THAN OVERCLAIMED: Chrome's own docs
// (developer.chrome.com/docs/extensions/reference/manifest/content-scripts)
// document `world:"MAIN"` as supported in a STATIC manifest.json
// content_scripts entry since Chrome 111 -- that is what this file relies
// on, and it requires NO additional host_permissions beyond what the
// existing declarative content_scripts entry already has (a static
// declaration is self-authorizing; this is unlike
// chrome.scripting.registerContentScripts()'s DYNAMIC registration path,
// which WOULD need broader host_permissions than this project currently
// requests -- deliberately not requested here, to avoid a permission
// escalation this pass wasn't asked to make; flagged as an open decision
// in the report). One independent community report (not an official
// Chrome bug tracker entry seen directly) claims static world:"MAIN"
// declarations are less reliable than registering the same script
// dynamically via chrome.scripting.registerContentScripts() from the
// background service worker. UNVERIFIED IN A REAL BROWSER by this pass
// (no browser available in this environment) -- Varun should confirm this
// actually fires per the manual verification steps in the report. If it
// proves unreliable, the fallback is exactly that dynamic-registration
// path, which trades this file's zero-permission-cost for a broader
// host_permissions grant.
//
// KNOWN, ACCEPTED GAPS (stated, not hidden):
//   - A shadow root attached before this patch takes effect cannot be
//     retroactively detected -- document_start is a strong but not
//     absolute guarantee against every possible page-script execution
//     path (e.g. a `<script>` with the (rare, and increasingly
//     restricted) `blocking="render"` timing hint, or an already-parsed
//     inline script Chrome executes in a way that races extension
//     injection). Not exercised or specifically defended against here.
//   - A page that captures a reference to the REAL, unpatched
//     attachShadow before this script runs (structurally only possible
//     if that capture itself also ran at/before document_start, which no
//     ordinary page script can arrange) would bypass detection. Not a
//     realistic threat model for this project (the goal is catching
//     ordinary web frameworks' Shadow DOM usage, e.g. web components
//     libraries), stated as a limitation rather than silently assumed
//     solved.
//   - This file has no automated test coverage -- MAIN-world/
//     document_start page-script interception has no jsdom equivalent
//     (jsdom does not execute arbitrary page scripts, and has no
//     multi-world concept at all). See tests/unit/test_dom_scanner.mjs's
//     "shadow DOM piercing: CLOSED shadow root" section for what IS
//     mechanically tested (the CONSUMPTION side of the marker attribute)
//     and the report to the orchestrator for manual browser verification
//     steps.
// ---------------------------------------------------------------------------

(function () {
  "use strict";

  // Mirrors dom-scanner.js's exported CLOSED_SHADOW_HOST_ATTR and
  // action-executor.js's internal constant of the same name -- see both
  // files' SHADOW DOM SUPPORT blocks. Cannot be imported here (this file
  // runs in the page's own MAIN-world realm, with no access to this
  // extension's ES module graph); kept in sync by hand.
  var CLOSED_SHADOW_HOST_ATTR = "data-sih-closed-shadow";

  if (typeof Element === "undefined" || !Element.prototype || typeof Element.prototype.attachShadow !== "function") {
    // Defensive: some non-standard/embedded contexts (or a future spec
    // change) could lack attachShadow entirely. Nothing to patch, nothing
    // to break -- exit quietly rather than throw and potentially disrupt
    // page load.
    return;
  }

  // Idempotency guard: manifest content_scripts can in principle be
  // injected more than once into the same realm (e.g. an extension
  // reload race, or -- if this is ever ALSO registered dynamically as
  // the documented fallback -- both mechanisms firing together). Patching
  // twice would double-wrap attachShadow, which is harmless functionally
  // (the marker attribute is idempotent, `setAttribute` to the same value
  // twice is a no-op) but wasteful. A non-enumerable flag on the
  // prototype itself survives across separate script-tag evaluations
  // within the same realm.
  if (Element.prototype.__sihAttachShadowPatched === true) return;

  var originalAttachShadow = Element.prototype.attachShadow;

  Element.prototype.attachShadow = function (init) {
    var mode = init && typeof init === "object" ? init.mode : undefined;
    var result = originalAttachShadow.apply(this, arguments);
    if (mode === "closed") {
      try {
        // `this` is the HOST element (attachShadow is called AS the host,
        // e.g. `hostEl.attachShadow(...)`), not the returned ShadowRoot --
        // exactly the element dom-scanner.js/action-executor.js need to
        // mark, since the ShadowRoot itself is never observable to the
        // isolated world at all in the closed case.
        this.setAttribute(CLOSED_SHADOW_HOST_ATTR, "");
      } catch (_err) {
        // A setAttribute failure here (e.g. a frozen/sealed element in
        // some exotic embedding) must never propagate out of a patched
        // built-in and break the page's own attachShadow() call --
        // that would be a far worse outcome than a missed detection.
      }
    }
    return result;
  };

  try {
    Object.defineProperty(Element.prototype, "__sihAttachShadowPatched", {
      value: true,
      enumerable: false,
      configurable: true,
      writable: false,
    });
  } catch (_err) {
    /* best-effort idempotency marker only -- a failure here is harmless */
  }
})();
