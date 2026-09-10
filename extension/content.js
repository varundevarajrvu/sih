// SIH 26171 -- Phase 1 (extension-scaffold): content script SKELETON.
//
// STUB ONLY, per Section 4 Phase 1's scope. This file intentionally does
// nothing beyond proving the messaging plumbing is wired: it loads on
// every page (see manifest.json's content_scripts entry, which also
// loads vendor/browser-polyfill.js first so `browser.*` is available
// here), and logs any extension-internal message it receives. It does
// NOT scan the DOM, does NOT flag PII, and does NOT execute actions --
// implementing any of that here would be scope creep into phases that
// don't exist yet.
//
// ------------------------------------------------------------------
// PLUG-IN POINT 1 -- Phase 2a (dom-pii-scanner), CLAUDE.md Section 4:
//   Walk the DOM and flag input[type=password], autocomplete values
//   (cc-number, current-password, email, tel, ...), and regex-matched
//   visible text nodes (email / phone / 12-digit Aadhaar-shaped /
//   PAN-shaped). Produce:
//     { sensitiveNodes: [{ selector, bbox: {x,y,w,h}, piiType, agentId }] }
//   Write the walker as a pure function importable/testable outside the
//   content-script context (fixture HTML in, JSON out) -- don't inline
//   it only here.
//
// PLUG-IN POINT 2 -- Phase 3 (action-executor), CLAUDE.md Section 4:
//   Walk actionable elements (inputs, buttons, links) and assign each a
//   stable `data-agent-id` (Set-of-Mark grounding -- the server refers to
//   elements by this stable ID, never by raw pixel coordinates), keeping
//   an id -> element map. Accept the server's action JSON
//     { action: "click"|"type"|"scroll"|"done", targetId, value }
//   (server/schemas.py's ActionResponse -- targetId is REQUIRED even for
//   scroll/done, using the PAGE_TARGET_ID sentinel "page" for those) and
//   dispatch the corresponding real DOM event on the mapped element.
//
// Neither module exists yet (CLAUDE.md: "Phases 2a, 2b, 3, 4 DO NOT
// EXIST"). This listener's only job is to prove the content script loads
// and is reachable from background.js -- nothing more.
// ------------------------------------------------------------------

console.log("[content] stub loaded on", location.href);

browser.runtime.onMessage.addListener((message) => {
  if (!message || typeof message.type !== "string") return undefined; // not for us

  // PHASE 2a / PHASE 3 PLUG-IN POINT: real handling of scan-request /
  // execute-action style messages goes here once those modules exist.
  // For now, every message type reaching this listener is logged and
  // otherwise ignored -- this stub is not a participant in the
  // DETECT_OBJECTS contract (that's background<->offscreen only) or any
  // other contract yet.
  console.log("[content] received message (stub, no handler implemented yet):", message.type, message);

  return undefined; // explicitly: no response, no async work started
});
