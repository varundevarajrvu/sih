// SIH 26171 -- Phase 4 (integration-loop): content script.
//
// This is the module that actually closes the loop CLAUDE.md Section 4
// Phase 4 describes: capture -> detect -> scan -> redact -> send -> act ->
// repeat. It is also the module that makes Section 5's invariant
// ("nothing leaves the client except the redacted image and the sanitized
// DOM JSON") literally true or false, since it is the code that builds and
// hands off the outgoing payload. See assertNoRawPii() below.
//
// ---------------------------------------------------------------------
// CONTRACT MISMATCH #1, found and fixed here (report this to the
// orchestrator, don't just quietly work around it): the Phase 4 brief and
// CLAUDE.md's Phase 3 RESULT both describe "lib/*.js" as classic scripts
// that attach to `globalThis`, matching action-executor.js exactly. That
// is true for action-executor.js (Phase 3) -- it has zero import/export
// statements by design. It is NOT true for dom-scanner.js (Phase 2a) or
// redaction.js (Phase 2b): both use top-level `export` statements (ES
// module syntax), which is a hard SyntaxError if loaded as a classic
// script -- confirmed against Chrome's actual constraint here: MV3's
// declarative `content_scripts[].js` array has NO `type: "module"` field
// and cannot load ES modules directly (there is no manifest-level escape
// hatch for this, on any Chrome version). Rewriting dom-scanner.js/
// redaction.js to drop `export` would break the 56 passing Node tests
// that import them as ES modules (`import { scanForPii } from
// "extension/lib/dom-scanner.js"`), so that path was rejected as
// unnecessarily risky for a checkpoint-mechanical-verification-only phase.
//
// FIX: dom-scanner.js and redaction.js are loaded via dynamic `import()`
// instead of a static manifest content_scripts entry. Dynamic import() is
// a runtime *expression*, not a module-context-requiring declaration, so
// it works from inside this classic (non-module) content script -- this
// is the standard, Chrome-documented workaround for using ES module code
// in a content script. It requires the target files to be listed in
// manifest.json's `web_accessible_resources` (added for this phase:
// "lib/dom-scanner.js", "lib/redaction.js") -- without that, Chrome
// refuses the cross-context fetch with a console error that looks
// unrelated to the manifest at first glance.
//
// action-executor.js, by contrast, IS added to content_scripts.js (before
// this file) exactly as the brief describes, since it has no export
// statements and parses fine as a classic script.
// ---------------------------------------------------------------------

console.log("[content] Phase 4 agent-loop content script loaded on", location.href);

let DomScanner = null;
let Redaction = null;
let FrameCoords = null;

async function loadLibModules() {
  if (!DomScanner) {
    DomScanner = await import(browser.runtime.getURL("lib/dom-scanner.js"));
  }
  if (!Redaction) {
    Redaction = await import(browser.runtime.getURL("lib/redaction.js"));
  }
  if (!FrameCoords) {
    FrameCoords = await import(browser.runtime.getURL("lib/frame-coords.js"));
  }
}

// =======================================================================
// FRAME COORDINATION (real-site hardening pass).
//
// manifest.json's content_scripts[].all_frames is now true, so this exact
// file is evaluated once per frame on a matched page -- the top page AND
// every <iframe>, same-origin or cross-origin. Before this, PII inside an
// iframe (Amazon's payment iframe, an embedded auth widget, ...) was
// simply never scanned: nothing ever ran a content script inside it at
// all. That silent gap -- Section 5 still reporting PASSED because it
// only checks nodes the scanner found -- is the bug this pass fixes.
//
// ARCHITECTURE: only the TOP frame runs the agent loop end to end. Every
// subframe instead: (1) scans ITSELF (shadow-DOM-piercing dom-scanner.js +
// action-executor.js, exactly as before -- neither module has ANY
// frame-specific code; "am I in an iframe" is meaningless to a pure
// function handed a document), (2) reports its findings to the top frame
// via background.js, and (3) executes an action on ITS OWN elements when
// the top frame relays one. The top frame aggregates every subframe's
// report into its own per-step scan before redacting/sending.
//
// THE HARD PART -- COORDINATE SPACES: getBoundingClientRect() inside an
// iframe is relative to THAT FRAME's own viewport, not the top-level
// page's. The screenshot content.js sends for redaction is a capture of
// the TOP-LEVEL viewport (chrome.tabs.captureVisibleTab always captures
// the whole visible tab). So every bbox a subframe reports must be
// offset by that iframe's own position within its parent before it means
// anything to redact() or the server -- see extension/lib/frame-coords.js
// for the pure translation math, and below for how the offset itself is
// discovered.
//
//   - SAME-ORIGIN iframe: trivial in principle (the parent could read
//     iframe.getBoundingClientRect() directly) -- but this codebase does
//     NOT special-case that; see below, the SAME mechanism is used for
//     both same- and cross-origin children, on purpose (one code path,
//     not two, and no origin-sniffing to get subtly wrong).
//   - CROSS-ORIGIN iframe: the CHILD cannot read its own position in the
//     parent. This is a hard Same-Origin-Policy constraint, not a missing
//     API -- window.frameElement is null cross-origin, and there is no
//     cross-origin-accessible geometry property on Window at all. Only
//     the PARENT can measure the offset (it can always read its OWN
//     <iframe> element's getBoundingClientRect(), regardless of what's
//     inside it) -- but the parent needs to know WHICH of its (possibly
//     several) <iframe> elements a given report came from.
//
// THE STANDARD WORKAROUND, implemented below: window.postMessage's
// MessageEvent.source is a browser-guaranteed, unspoofable reference to
// the exact WindowProxy that sent the message -- this works identically
// cross-origin (that is the whole point of postMessage). Every subframe,
// once, sends its PARENT a single opaque random token via
// `window.parent.postMessage({type:"SIH_FRAME_TOKEN", token}, "*")`. The
// parent's listener finds `Array.from(document.querySelectorAll("iframe"))
// .find(f => f.contentWindow === event.source)` -- an EXACT, unspoofable
// match regardless of cross-origin-ness -- and remembers `token ->
// thatIframeElement`. At merge time, the top frame re-measures
// `iframeElement.getBoundingClientRect()` fresh (not a cached value, so a
// scroll/layout change between steps is reflected) to get the offset.
//
// WHY THE TOKEN CARRIES *ONLY* AN OPAQUE STRING, NEVER PII: postMessage
// delivers to EVERY "message" listener registered on the target window --
// including the page's OWN script, if the page happens to register one.
// Even with a specific targetOrigin, postMessage has no concept of
// "only my own extension's listener may read this." Putting real PII
// metadata (bboxes are fine -- see below -- but text content would not
// be) on that channel would be a NEW, self-inflicted leak surface this
// project exists to prevent. So the token is the ONLY thing that ever
// crosses via postMessage; the actual sensitiveNodes/domSnapshot data
// crosses via chrome.runtime messaging instead (background.js's
// COLLECT_FRAME_REPORTS/SCAN_THIS_FRAME), which is NOT observable by page
// script at all -- it is Chrome's own privileged extension-messaging
// channel. (bbox NUMBERS alone, with no accompanying text, are judged
// low-sensitivity -- they reveal roughly where an input sits on a page --
// but even so they do not travel over postMessage in this design; only
// the token does.)
//
// FAIL LOUD, NOT WRONG: if a subframe's report arrives before its token
// has been correlated to an iframe element (a startup race -- the report
// round-trips through background.js and could in principle arrive before
// the postMessage does), or a token never resolves at all (e.g. the
// iframe was removed from the DOM between sending its token and this
// step), that frame's findings are DROPPED for this step and logged
// loudly -- NEVER merged with a fabricated {x:0,y:0} offset. A wrong bbox
// is a leak that looks like success; a dropped-and-logged region is an
// honest, visible gap. See frame-coords.js's translateBBox()/
// translateNodeBBoxes() for where this is actually enforced (they THROW
// on an unresolved offset rather than defaulting one).
//
// SCOPE BOUNDARY, stated explicitly rather than silently assumed: this
// mechanism handles ONE level of iframe nesting (the top page's direct
// <iframe> children) -- the realistic case for how real sites actually
// embed third-party content (a payment provider's iframe sits directly in
// the checkout page, not three iframes deep). An iframe nested inside
// another iframe is a natural extension of the exact same
// measure-your-direct-children-and-report-up pattern, applied
// recursively, but is NOT implemented or verified here. Flagged for the
// orchestrator rather than silently claimed as general.
// =======================================================================

const IS_TOP_FRAME = window.top === window.self;

// Chrome's frameId for this frame's content-script instance (0 = top,
// stable for this navigation otherwise). Learned via FRAME_HELLO's round
// trip to background.js, which is the only context that can read
// MessageSender.frameId -- a content script has no direct way to ask
// "what is my own frameId". Every frame sends this once on load,
// including the top frame (so background.js's registry -- and future
// debugging -- sees every frame uniformly), though the top frame never
// uses the returned id itself (it mints unprefixed "agent-<n>" ids, same
// as before this pass existed).
let myFrameId = null;
const frameHelloPromise = browser.runtime
  .sendMessage({ type: "FRAME_HELLO" })
  .then((resp) => {
    myFrameId = typeof resp?.frameId === "number" ? resp.frameId : null;
    return myFrameId;
  })
  .catch((err) => {
    console.error("[content] FRAME_HELLO failed (non-fatal -- this frame just won't be coordinated):", err?.message || err);
    return null;
  });

// This frame's own id-minting prefix, per action-executor.js's
// CROSS-FRAME UNIQUENESS scheme: "" for the top frame (unprefixed
// "agent-<n>", byte-identical to every pre-existing test/behavior), "f<N>-"
// for every subframe. Computed once frameHelloPromise resolves.
async function getIdPrefix() {
  if (IS_TOP_FRAME) return "";
  const frameId = await frameHelloPromise;
  return typeof frameId === "number" ? `f${frameId}-` : "f?-"; // "f?-" only if the handshake itself failed -- still collision-safe against the top frame's bare ids, just not disambiguated from another failed handshake in a DIFFERENT frame (a real, if rare, residual risk -- see the report to the orchestrator).
}

// Regex to recover which frame owns a given prefixed agentId, e.g.
// "agent-f7-3" -> frameId 7. Mirrors action-executor.js's own
// AGENT_ID_PATTERN-with-prefix scheme; kept here (not exported from
// action-executor.js) because it is a content.js-level ROUTING concern
// (which frame do I relay this action to), not something the pure module
// itself needs to know about.
const PREFIXED_AGENT_ID_RE = /^agent-f(\d+)-\d+$/;

function frameIdForAgentId(agentId) {
  const m = typeof agentId === "string" ? PREFIXED_AGENT_ID_RE.exec(agentId) : null;
  return m ? parseInt(m[1], 10) : null;
}

// ---- SUBFRAME-ONLY state and wiring ----
// Populated by this frame's own SCAN_THIS_FRAME handler, consumed by its
// own RUN_ACTION_IN_FRAME handler -- lets a relayed action resolve
// against THIS frame's live idMap without re-scanning (the idMap from the
// most recent scan is what the top frame's merged report was actually
// built from; re-scanning here could in principle produce different
// agentIds if the page mutated between scan and act, which would be
// silently wrong -- reusing the cached map is the correct, and cheaper,
// choice).
let lastFrameScan = null; // { idMap, sensitiveAgentIds }

if (!IS_TOP_FRAME) {
  // One opaque, random, PII-free token, announced to the immediate parent
  // exactly once. See the FRAME COORDINATION block comment above for why
  // this is the ONLY thing that ever crosses via postMessage.
  const frameToken =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `tok-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  try {
    window.parent.postMessage({ type: "SIH_FRAME_TOKEN", token: frameToken }, "*");
  } catch (err) {
    // Should not happen (postMessage to window.parent is always legal,
    // same- or cross-origin) but must never crash this frame's content
    // script if it somehow does.
    console.error("[content] failed to announce SIH_FRAME_TOKEN to parent (non-fatal):", err?.message || err);
  }

  /**
   * Scan THIS frame's own document and return a report shaped for the
   * top frame to merge. Mirrors runAgentLoop()'s own scan step (RULING 1:
   * action-executor first to stamp ids, dom-scanner second to reuse
   * them) exactly, but scoped to this one frame's document and prefixed
   * ids.
   *
   * SECTION 5 APPLIES HERE TOO, NOT JUST AT THE TOP FRAME: this frame's
   * domSnapshot is sanitized (sensitive text stripped) AND
   * leak-asserted against its OWN live elements BEFORE it is ever handed
   * to chrome.runtime.sendMessage -- i.e. before it leaves this frame's
   * isolated world at all. The top frame's own assertNoRawPii (later,
   * right before the network send) cannot re-verify a raw value against
   * THIS frame's live DOM -- it has no reference into another frame's
   * document, cross-frame element references are not a thing -- so this
   * frame is the ONLY place that can make that specific guarantee for
   * its own elements. Skipping this here would silently narrow Section
   * 5's coverage back down exactly where this whole pass is trying to
   * widen it.
   */
  async function scanThisFrame() {
    await loadLibModules();
    const idPrefix = await getIdPrefix();

    const { domSnapshot, idMap, unscannableRegions: actionableUnscannable } = ActionExecutor.buildDomSnapshot(document, {
      idPrefix,
    });
    const maxIndex = computeMaxAgentIndex(idMap);
    let nextFallbackIndex = maxIndex;
    const { sensitiveNodes, unscannableRegions: scannerUnscannable } = DomScanner.scanForPii(document, {
      getAgentId: () => `agent-${idPrefix}${++nextFallbackIndex}`,
    });

    const sensitiveByAgentId = new Map(sensitiveNodes.map((n) => [n.agentId, n]));
    for (const node of sensitiveNodes) {
      const el = idMap.get(node.agentId);
      if (el) el.setAttribute(ActionExecutor.SENSITIVE_ATTR, "true");
    }
    const sensitiveAgentIds = new Set(sensitiveNodes.map((n) => n.agentId));
    const mergedDomSnapshot = domSnapshot.map((node) => {
      const s = sensitiveByAgentId.get(node.agentId);
      return s ? { ...node, sensitive: true } : node;
    });

    // Sanitize BEFORE this ever leaves the frame (see doc comment above).
    const sanitizedDomSnapshot = Redaction.sanitizeDomSnapshot(mergedDomSnapshot);

    // Local Section 5 check against THIS frame's own live elements. If it
    // fails, do NOT send the report at all -- fail closed, exactly like
    // the top frame's own retry loop does for the final network send.
    try {
      assertNoRawPii({ domSnapshot: sanitizedDomSnapshot }, sensitiveNodes, idMap);
    } catch (err) {
      console.error("[content][subframe] Section 5 check FAILED for this frame -- report withheld, not sent:", err.message);
      lastFrameScan = { idMap, sensitiveAgentIds };
      return { ok: false, error: "section5_invariant_violation_in_subframe: " + err.message };
    }

    lastFrameScan = { idMap, sensitiveAgentIds };

    return {
      ok: true,
      token: frameToken,
      sensitiveNodes, // RAW CSS-px bboxes, no text -- mirrors what the top frame passes to redact() for its own nodes
      domSnapshot: sanitizedDomSnapshot,
      unscannableRegions: [...actionableUnscannable, ...scannerUnscannable],
    };
  }

  browser.runtime.onMessage.addListener((message) => {
    if (!message || typeof message.type !== "string") return undefined;

    if (message.type === "SCAN_THIS_FRAME") {
      return scanThisFrame().catch((err) => ({ ok: false, error: err?.message || String(err) }));
    }

    if (message.type === "RUN_ACTION_IN_FRAME") {
      if (!lastFrameScan) {
        return Promise.resolve({
          ok: false,
          error: "RUN_ACTION_IN_FRAME received before this frame ever completed a SCAN_THIS_FRAME -- refusing to guess an idMap",
        });
      }
      try {
        const result = ActionExecutor.executeAction(message.action, lastFrameScan.idMap, {
          sensitiveAgentIds: lastFrameScan.sensitiveAgentIds,
        });
        return Promise.resolve({ ok: true, result });
      } catch (err) {
        return Promise.resolve({ ok: false, error: err?.message || String(err), code: err?.code });
      }
    }

    return undefined; // not our message type -- ignore (RUN_AGENT_LOOP included: a subframe never runs the loop)
  });
}

// ---- TOP-FRAME-ONLY state and wiring ----
// token -> the specific <iframe> Element that announced it (found via
// MessageEvent.source matching -- see block comment above). Offsets are
// re-measured fresh from this element at merge time, never cached as a
// number, so a scroll/layout shift between steps is picked up correctly.
const tokenToIframeElement = new Map();

if (IS_TOP_FRAME) {
  window.addEventListener("message", (event) => {
    const data = event && event.data;
    if (!data || data.type !== "SIH_FRAME_TOKEN" || typeof data.token !== "string") return;
    const iframes = Array.from(document.querySelectorAll("iframe"));
    const match = iframes.find((f) => {
      try {
        return f.contentWindow === event.source;
      } catch (_err) {
        return false; // a detached/exotic iframe's contentWindow access should never crash this listener
      }
    });
    if (match) {
      tokenToIframeElement.set(data.token, match);
    }
    // No match: either a stray/unrelated postMessage, or the iframe was
    // removed between sending its token and this event -- ignored, not
    // an error. The corresponding frame report (if one ever arrives)
    // will simply fail to resolve an offset and get dropped + logged --
    // see collectAndMergeSubframeReports() below.
  });
}

/**
 * TOP FRAME ONLY. Ask background.js for every known subframe's current
 * scan, translate each into top-level page coordinates via
 * frame-coords.js, and return one merged bundle ready to fold into this
 * step's own sensitiveNodes/domSnapshot/unscannableRegions arrays.
 *
 * FAIL LOUD, NOT WRONG: a report whose token never resolved to a known
 * iframe element is DROPPED from the merge and logged loudly (via the
 * returned `droppedFrames` list, which runAgentLoop() surfaces in the
 * instrumentation) -- never merged with a fabricated offset.
 *
 * @returns {Promise<{sensitiveNodes: Array, domSnapshot: Array, unscannableRegions: Array, framesReported: number, framesMerged: number, droppedFrames: Array}>}
 */
async function collectAndMergeSubframeReports() {
  await loadLibModules();
  const empty = { sensitiveNodes: [], domSnapshot: [], unscannableRegions: [], framesReported: 0, framesMerged: 0, droppedFrames: [] };

  let collectResp;
  try {
    collectResp = await browser.runtime.sendMessage({ type: "COLLECT_FRAME_REPORTS" });
  } catch (err) {
    console.error("[content] COLLECT_FRAME_REPORTS failed (non-fatal -- proceeding with top-frame-only coverage this step):", err?.message || err);
    return empty;
  }
  const reports = (collectResp && collectResp.frameReports) || [];

  const merged = { sensitiveNodes: [], domSnapshot: [], unscannableRegions: [] };
  const droppedFrames = [];

  for (const report of reports) {
    if (!report || report.ok !== true) {
      droppedFrames.push({ frameId: report && report.frameId, reason: (report && report.error) || "unknown failure" });
      continue;
    }
    const iframeEl = tokenToIframeElement.get(report.token);
    if (!iframeEl) {
      droppedFrames.push({ frameId: report.frameId, reason: "offset unresolved (token not yet correlated to an <iframe> element)" });
      continue;
    }
    const rect = iframeEl.getBoundingClientRect();
    const offset = { x: rect.left, y: rect.top };
    let translated;
    try {
      translated = FrameCoords.translateFrameReport(report, offset);
    } catch (err) {
      // Should be unreachable (offset is always resolved here -- both
      // fields are always finite numbers from getBoundingClientRect()),
      // but frame-coords.js's FAIL LOUD design means a malformed report
      // from a compromised/misbehaving frame throws rather than silently
      // mis-translating -- caught here so ONE bad subframe can't take
      // down the whole step.
      droppedFrames.push({ frameId: report.frameId, reason: "translateFrameReport threw: " + (err?.message || err) });
      continue;
    }
    merged.sensitiveNodes.push(...translated.sensitiveNodes);
    merged.domSnapshot.push(...translated.domSnapshot);
    merged.unscannableRegions.push(...translated.unscannableRegions);
  }

  if (droppedFrames.length > 0) {
    console.warn(
      `[agent-loop] ${droppedFrames.length} subframe report(s) DROPPED this step (not merged -- see frame-coords.js's FAIL LOUD policy):`,
      droppedFrames
    );
  }

  return { ...merged, framesReported: reports.length, framesMerged: reports.length - droppedFrames.length, droppedFrames };
}

// ---------------------------------------------------------------------
// RULING 3 -- filter vision boxes to a privacy-relevant subset before
// they ever reach redaction.js. redaction.js redacts every box it is
// handed, unconditionally, by design (Phase 2b's own contract) -- Phase 0's
// detector is general COCO-80, so handing it every detection would black
// out couches and remotes and destroy the screenshot for no privacy
// benefit.
//
// NOTE on "map via id2label, never literal-match class names": by the
// time a detection reaches this file, it has already been through
// offscreen.entry.js's flattenDetections(), which takes `r.label` --
// itself produced by the @huggingface/transformers pipeline internally
// mapping the model's numeric class index through Xenova/yolos-tiny's own
// id2label table (extension/models/Xenova/yolos-tiny/config.json). There
// is no raw numeric class id available at this layer to map ourselves --
// only the already-resolved label STRING. This allowlist matches against
// that resolved string, case-insensitively, and deliberately includes
// BOTH "tv" (this model's actual id2label value, confirmed against
// config.json) and "tvmonitor" (a different candidate model's label for
// the same concept, per CLAUDE.md's "class-name trap" note) so a future
// detector swap that changes label spelling doesn't silently stop
// filtering that class in or out.
// ---------------------------------------------------------------------
const PRIVACY_RELEVANT_LABELS = new Set(["person", "tv", "tvmonitor", "laptop", "cell phone", "book"]);

function filterPrivacyRelevantBoxes(boxes) {
  if (!Array.isArray(boxes)) return [];
  return boxes.filter((b) => b && typeof b.label === "string" && PRIVACY_RELEVANT_LABELS.has(b.label.toLowerCase()));
}

// ---------------------------------------------------------------------
// RULING 2 -- bbox unit-space normalization, ONE point, owned here.
//
// Vision boxes (from DETECT_OBJECTS) are already in screenshot-pixel
// space -- detection ran directly on the captured screenshot image. They
// are never scaled, anywhere in this file.
//
// domNodes bboxes (dom-scanner's sensitiveNodes, and action-executor's
// domSnapshot) come from getBoundingClientRect(), which reports CSS
// pixels. redaction.js's buildRedactedRegions() ALREADY takes an
// injectable `scaleFactor` and applies it internally, exactly once, to
// whatever it's given in its `domNodes` parameter -- so sensitiveNodes is
// passed into redact() RAW (unscaled) below; buildRedactedRegions does
// the CSS->screenshot-px conversion for it. Pre-scaling sensitiveNodes
// bboxes ourselves before that call would be double-scaling -- exactly as
// broken as not scaling at all, per CLAUDE.md's Phase 2b RESULT.
//
// CONTRACT GAP found here: `domSnapshot` (the FULL snapshot built by
// action-executor.buildDomSnapshot(), not just the flagged subset) is
// NEVER passed through buildRedactedRegions() at all -- it goes straight
// to the server via sanitizeDomSnapshot(). Nothing in Phase 2a/2b/3 scales
// domSnapshot's own bbox field. CLAUDE.md's Phase 2b RESULT says
// "Everything crossing a module boundary -- domSnapshot.bbox,
// redactedRegions.bbox, vision boxes -- must be in screenshot-pixel space
// by the time it reaches server/", so this file scales domSnapshot's
// bboxes explicitly, exactly once, as its own separate step (distinct
// from the scaling redact() does internally for sensitiveNodes).
// ---------------------------------------------------------------------
function scaleDomSnapshotBBoxes(domSnapshot, scaleFactor) {
  return domSnapshot.map((node) => {
    if (!node.bbox) return node;
    return {
      ...node,
      bbox: {
        x: node.bbox.x * scaleFactor,
        y: node.bbox.y * scaleFactor,
        w: node.bbox.w * scaleFactor,
        h: node.bbox.h * scaleFactor,
      },
    };
  });
}

// ---------------------------------------------------------------------
// CONTRACT MISMATCH #2, found and fixed here: dom-scanner.js's fallback
// agentId self-assignment (`options.getAgentId`, used only when an
// element has no pre-existing data-agent-id) starts its own counter at 1,
// with NO knowledge of the ids action-executor already stamped elsewhere
// in the same document. dom-scanner DOES prefer an existing
// data-agent-id on the SAME element (so actionable/flagged fields like
// the password input correctly reuse action-executor's id) -- but a
// PII-bearing element that is not actionable at all (e.g. a plain <p> or
// <span> caught only by dom-scanner's text-node regex pass, never visited
// by action-executor's assignAgentIds()) has no pre-existing id, and
// dom-scanner's own fallback would mint "agent-1", "agent-2", ... again
// from scratch -- directly colliding with action-executor's real
// "agent-1"/"agent-2" on a completely different element. That collision
// would make the server's find_pii_leaks() agentId-correlation strategy
// check the WRONG domSnapshot node. This is exactly the kind of "call
// order" ruling being satisfied in letter but not in spirit -- action-
// executor DOES run first, but dom-scanner's fallback numbering doesn't
// account for the id-space it left behind. Fixed by handing dom-scanner a
// getAgentId hook that continues action-executor's own numbering instead
// of restarting from 1 -- see computeMaxAgentIndex() and its call site in
// runAgentLoop() below.
// ---------------------------------------------------------------------
function computeMaxAgentIndex(idMap) {
  let max = 0;
  for (const id of idMap.keys()) {
    const m = /^agent-(\d+)$/.exec(id);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return max;
}

// ---------------------------------------------------------------------
// Section 5 invariant, enforced here as actual code (not just a rule in
// CLAUDE.md): nothing leaves the client except the redacted image and the
// sanitized DOM JSON. This asserts on the SERIALIZED outgoing payload,
// not just on flags -- it scans for the literal raw value of every
// sensitive field's live DOM content and refuses to send if any survived
// sanitization.
//
// "An error path is a data egress path" (CLAUDE.md Section 7 rule 5,
// found the hard way in Phase 2c): if this check fires, the thrown
// message names only the offending agentId(s), NEVER the raw value
// itself -- the whole point of this function is to stop a leak, so its
// own failure message must not become a new leak.
// ---------------------------------------------------------------------
function assertNoRawPii(outgoingPayload, sensitiveNodes, idMap) {
  const payloadStr = JSON.stringify(outgoingPayload);
  const leakedAgentIds = [];
  for (const node of sensitiveNodes) {
    const el = idMap.get(node.agentId);
    if (!el) continue; // not an actionable element (e.g. a flagged text node) -- never part of domSnapshot, nothing to check
    const rawValue = (typeof el.value === "string" && el.value) || (el.textContent || "").trim();
    if (rawValue && rawValue.length >= 3 && payloadStr.includes(rawValue)) {
      leakedAgentIds.push(node.agentId);
    }
  }
  if (leakedAgentIds.length > 0) {
    throw new Error(
      "SECTION 5 INVARIANT VIOLATION: outgoing payload contains a raw value for sensitive agentId(s) " +
        leakedAgentIds.join(", ") +
        ". Send aborted -- this is a client-side sanitization bug, not something to fix by loosening this check."
    );
  }
  console.log(
    `[agent-loop] Section 5 check PASSED -- outgoing payload contains no raw value for ${sensitiveNodes.length} flagged sensitive node(s).`
  );
}

// ---------------------------------------------------------------------
// PROBLEM 1 fix (coordinator, 2026-09-11): a transient upstream 5xx/429
// currently ends the whole demo run. Bounded retry with exponential
// backoff + jitter around the /analyze send.
//
// RETRY LOOP OWNERSHIP -- deliberately placed HERE, in content.js, not in
// background.js's handleAnalyze (which literally calls fetch()). Reason:
// the Section 5 check (assertNoRawPii) must re-run on EVERY attempt, not
// just the first -- "a retry is a fresh egress" -- and that check needs
// `sensitiveNodes`/`idMap`, which are LIVE DOM REFERENCES. A
// Map<string, Element> cannot cross the content<->background message
// boundary (structured clone has no representation for a live Element),
// so the check can only run where those references already live: here.
// background.js's handleAnalyze stays a simple, retry-unaware single-shot
// POST -- easier to reason about, and consistent with every other message
// type it already handles.
//
// RETRYABLE SET: HTTP 429 and any 5xx, per the coordinator's explicit
// policy ("NEVER retry a 4xx -- those are deterministic"). EXTENSION
// BEYOND THE LITERAL POLICY, flagged explicitly rather than silently
// folded in: status 0 (fetch() itself threw -- no HTTP response at all,
// e.g. a transient network blip or the server mid-restart) is ALSO
// treated as retryable here. It is structurally indistinguishable from a
// "transient upstream hiccup" and is not a deterministic 4xx client
// error -- but it wasn't literally named in the "5xx and 429" policy, so
// this is called out explicitly rather than silently assumed.
// ---------------------------------------------------------------------
const ANALYZE_MAX_ATTEMPTS = 3;
const ANALYZE_BASE_DELAY_MS = 1000; // -> roughly 1s / 2s before attempts 2 / 3

function isRetryableAnalyzeFailure(resp) {
  if (!resp) return false;
  const status = resp.status;
  if (status === 429) return true;
  if (typeof status === "number" && status >= 500 && status <= 599) return true;
  if (status === 0) return true; // see block comment above: documented extension beyond the literal policy
  return false;
}

function errorClassOf(resp) {
  if (!resp) return "no_response";
  if (resp.status === 0) return "network_error";
  if (resp.error && typeof resp.error === "object" && resp.error.errorCode) return resp.error.errorCode;
  if (typeof resp.status === "number") return `http_${resp.status}`;
  return "unknown";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Full jitter around exponential backoff: base * 2^(attempt-1), +/-30%,
// clamped to >=0. "Roughly 1s/2s/4s with jitter" per the coordinator's
// spec -- jitter is a deliberate inclusion, not padding: it's what keeps
// a real backoff from looking robotic/exact in the RUN SUMMARY, and is
// standard practice so concurrent retries (if this code ever runs more
// than one loop at once) don't all wake in lockstep.
function backoffDelayMs(attempt) {
  const base = ANALYZE_BASE_DELAY_MS * Math.pow(2, attempt - 1); // 1000, 2000, (4000, unused at MAX_ATTEMPTS=3)
  const jitter = base * 0.3 * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(base + jitter));
}

// ---------------------------------------------------------------------
// Instrumentation (item C). Timestamps every stage transition and logs
// performance.memory where available (Chrome-only, non-standard API --
// feature-detected, degrades to null rather than throwing). Structured so
// one run produces exactly one copy-pasteable JSON block, bracketed by
// unambiguous delimiter lines, plus a console.table for quick visual
// scanning in DevTools.
// ---------------------------------------------------------------------
function snapshotMemory() {
  const m = performance.memory;
  if (!m) return null;
  return {
    usedJSHeapSizeMB: +(m.usedJSHeapSize / 1048576).toFixed(2),
    totalJSHeapSizeMB: +(m.totalJSHeapSize / 1048576).toFixed(2),
    jsHeapSizeLimitMB: +(m.jsHeapSizeLimit / 1048576).toFixed(2),
  };
}

function createInstrumentation() {
  const runStart = performance.now();
  const entries = [];
  let lastT = runStart;

  function mark(step, stage, extra) {
    const t = performance.now();
    const entry = {
      step,
      stage,
      deltaMs: +(t - lastT).toFixed(1),
      sinceRunStartMs: +(t - runStart).toFixed(1),
      memory: snapshotMemory(),
      ...(extra || {}),
    };
    entries.push(entry);
    lastT = t;
    console.log(`[agent-loop] step ${step} :: ${stage} :: +${entry.deltaMs}ms (t=${entry.sinceRunStartMs}ms)`, extra || "");
    return entry;
  }

  function summarize(stepResults, outcome) {
    const totalMs = +(performance.now() - runStart).toFixed(1);
    const memSamples = entries.map((e) => e.memory).filter(Boolean);
    const peakUsedJSHeapSizeMB = memSamples.length ? Math.max(...memSamples.map((m) => m.usedJSHeapSizeMB)) : null;

    const summary = {
      runAt: new Date().toISOString(),
      outcome,
      totalSteps: stepResults.length,
      totalMs,
      peakUsedJSHeapSizeMB,
      memoryApiAvailable: memSamples.length > 0,
      stages: entries,
      steps: stepResults,
    };

    console.log(
      "================ [agent-loop] RUN SUMMARY -- copy/paste everything between these two lines ================"
    );
    console.log(JSON.stringify(summary, null, 2));
    console.log(
      "=============================================================================================================="
    );
    try {
      console.table(entries.map(({ step, stage, deltaMs, sinceRunStartMs }) => ({ step, stage, deltaMs, sinceRunStartMs })));
    } catch (_err) {
      /* console.table is a DevTools nicety, not load-bearing -- ignore if unavailable */
    }

    return { type: "RUN_AGENT_LOOP_RESULT", ...summary };
  }

  return { mark, summarize };
}

// ---------------------------------------------------------------------
// FRAME COORDINATION (real-site hardening pass): act on an element that
// lives in a SUBFRAME. The top frame's own `idMap` only ever contains
// elements from ITS OWN document -- a cross-frame live element reference
// does not exist as a concept in the DOM, so there is no way to make
// idMap.get("agent-f7-3") resolve locally, ever, by construction. When
// the server's action targets such an id, the top frame's own
// executeAction() correctly (and unavoidably) throws TARGET_NOT_FOUND
// first; THIS function is what turns that into a relay to the frame that
// actually owns the element, instead of a dead end.
//
// Only ONE relay hop is ever attempted, to the EXACT frameId encoded in
// the prefix -- never a retry against a different frame, never a guess.
// If the relay itself fails (the frame navigated away, timed out, or its
// own sensitivity guard blocked the action), that failure propagates
// exactly like any other executeAction failure: thrown, surfaced in the
// step's outcome, loop stops. Same fail-loud posture as
// action-executor.js's own executeAction() -- "never silently no-op,
// never guess a different element" now also means "never guess a
// different FRAME."
// ---------------------------------------------------------------------
async function executeActionAcrossFrames(action, idMap, options) {
  try {
    return { result: ActionExecutor.executeAction(action, idMap, options) };
  } catch (err) {
    if (err && err.code === "TARGET_NOT_FOUND") {
      const targetFrameId = frameIdForAgentId(action && action.targetId);
      if (targetFrameId !== null) {
        const relayResp = await browser.runtime.sendMessage({
          type: "EXECUTE_ACTION_IN_FRAME",
          frameId: targetFrameId,
          action,
        });
        if (relayResp && relayResp.ok === true) {
          return { result: relayResp.result, relayedToFrameId: targetFrameId };
        }
        const relayErr = new Error(
          (relayResp && relayResp.error) || `action relay to frame ${targetFrameId} failed with no error detail`
        );
        relayErr.code = (relayResp && relayResp.code) || "FRAME_ACTION_RELAY_FAILED";
        throw relayErr;
      }
    }
    throw err; // not a cross-frame case -- propagate exactly as before this pass existed
  }
}

// ---------------------------------------------------------------------
// The loop. Bounded to MAX_STEPS so a demo (or a misbehaving mock/VLM)
// can never spin forever -- "repeat" per CLAUDE.md Section 4 Phase 4, but
// repetition without a bound is an infinite loop, not a feature.
// ---------------------------------------------------------------------
const MAX_STEPS = 6;

async function runAgentLoop() {
  await loadLibModules();
  const instr = createInstrumentation();
  const stepResults = [];

  // Demo-design fix (coordinator, 2026-09-11): a live Gemini run showed
  // the ORIGINAL demo page removing "Full name" from the DOM the instant
  // it was typed into -- the typed value vanished in the same tick it
  // appeared, so a judge watching the screen would see nothing happen,
  // and the NEXT step's VLM call, no longer seeing that field at all,
  // went looking for somewhere else to put the value and picked a
  // sensitive field (correctly blocked by the guard, but an accident,
  // not a designed scenario). Fix: demo/test-page.html now KEEPS the
  // field in the DOM with its value visible. That means the field is
  // still a legitimate "type"-eligible candidate on every subsequent
  // scan (same type=text, same non-sensitive status) -- MockVLMClient's
  // rule 2 has no "already has a value" check, so without this tracking
  // it would be re-selected and re-typed into forever, never advancing
  // to click "Continue". `actedAgentIds` records every agentId this RUN
  // has already successfully clicked/typed into, and the domSnapshot
  // actually sent to the server (below) excludes them on later steps --
  // the field stays visible in the live DOM for the judge to see, but is
  // no longer offered to the VLM as something left to do. This is
  // backend-agnostic (filters what ANY backend, mock or real, is shown),
  // not a MockVLMClient-specific hack.
  const actedAgentIds = new Set();

  let taskGoal = "(no task goal set)";
  try {
    const stored = await browser.storage.local.get("taskGoal");
    if (typeof stored.taskGoal === "string" && stored.taskGoal.trim()) {
      taskGoal = stored.taskGoal.trim();
    }
  } catch (_err) {
    /* fall through with the default goal string -- storage read failure must not abort the demo */
  }

  let outcome = "max_steps_reached";

  for (let step = 1; step <= MAX_STEPS; step++) {
    // ---- 1. CAPTURE + DETECT (one round trip to background.js, which
    // times each half separately server-side of the message boundary so
    // message-passing overhead isn't misattributed to either stage). ----
    const captureResp = await browser.runtime.sendMessage({ type: "CAPTURE_AND_DETECT" });
    if (!captureResp || captureResp.type !== "CAPTURE_AND_DETECT_RESULT") {
      instr.mark(step, "capture", { error: (captureResp && captureResp.error) || "no response from background" });
      stepResults.push({ step, error: "capture_and_detect_failed", detail: captureResp && captureResp.error });
      outcome = "capture_failed";
      break;
    }
    instr.mark(step, "capture", {
      durationMs: +captureResp.captureMs.toFixed(1),
      offscreenDocumentAlreadyExisted: captureResp.offscreenDocumentAlreadyExisted,
    });
    // Split load vs. inference (coordinator-requested diagnostic,
    // 2026-09-11) -- these were previously conflated into one "detect"
    // mark, which is exactly why a 20x slowdown across repeated steps was
    // ambiguous (cold model reload each step? vs. inference itself
    // getting slow?). modelLoadMs/inferenceMs/pipelineWasAlreadyLoaded
    // come from offscreen.entry.js's own module state -- see that file's
    // runDetection() -- the only place that can truthfully answer this.
    instr.mark(step, "model-load", {
      durationMs: +captureResp.modelLoadMs.toFixed(1),
      pipelineWasAlreadyLoaded: captureResp.pipelineWasAlreadyLoaded,
      device: captureResp.device,
    });
    instr.mark(step, "inference", {
      durationMs: +captureResp.inferenceMs.toFixed(1),
      detections: (captureResp.boxes || []).length,
      // detectMs is kept for continuity/backward-compat with earlier runs'
      // RUN SUMMARY output -- it's the WALL-CLOCK total of the combined
      // detectObjects() call (load + inference + message-passing overhead
      // inside background.js), which should now roughly equal
      // modelLoadMs + inferenceMs + a small remainder when they don't,
      // that remainder is messaging/offscreen-doc-creation overhead, not
      // load or inference time.
      detectMsTotal: +captureResp.detectMs.toFixed(1),
    });

    // ---- 2. SCAN -- RULING 1: action-executor FIRST (stamps
    // data-agent-id), dom-scanner SECOND (reuses those ids). Reversed,
    // the two mint independent id spaces and sensitiveNodes.agentId stops
    // correlating with domSnapshot.agentId. ----
    const tScan0 = performance.now();
    const {
      domSnapshot,
      idMap,
      unscannableRegions: actionableUnscannable,
    } = ActionExecutor.buildDomSnapshot(document);
    const maxIndex = computeMaxAgentIndex(idMap);
    let nextFallbackIndex = maxIndex;
    const {
      sensitiveNodes,
      unscannableRegions: scannerUnscannable,
    } = DomScanner.scanForPii(document, {
      // CONTRACT MISMATCH #2 fix (see computeMaxAgentIndex's comment
      // above): continue action-executor's numbering instead of
      // restarting dom-scanner's own fallback counter at 1.
      getAgentId: () => `agent-${++nextFallbackIndex}`,
    });

    // ---- 2.5. FRAME COORDINATION (real-site hardening pass): merge in
    // every subframe's already-offset-translated, already-sanitized
    // report. See the FRAME COORDINATION block comment near the top of
    // this file for the full protocol. `idMap` stays TOP-FRAME-ONLY on
    // purpose -- a cross-frame element reference is not a thing, so
    // subframe-sourced sensitiveNodes/domSnapshot entries below have
    // agentIds that simply won't resolve via idMap.get() anywhere in this
    // step (the sensitivity-stamping loop and assertNoRawPii both already
    // guard with `if (el) ...`/`if (!el) continue`, so this degrades
    // gracefully rather than crashing -- see assertNoRawPii's own comment
    // for why it cannot independently re-verify a subframe's raw values). ----
    const subframeData = IS_TOP_FRAME
      ? await collectAndMergeSubframeReports()
      : { sensitiveNodes: [], domSnapshot: [], unscannableRegions: [], framesReported: 0, framesMerged: 0, droppedFrames: [] };
    const allSensitiveNodes = sensitiveNodes.concat(subframeData.sensitiveNodes);
    const allUnscannableRegions = [...actionableUnscannable, ...scannerUnscannable, ...subframeData.unscannableRegions];

    instr.mark(step, "scan", {
      durationMs: +(performance.now() - tScan0).toFixed(1),
      actionableNodes: domSnapshot.length,
      sensitiveNodes: sensitiveNodes.length,
      framesReported: subframeData.framesReported,
      framesMerged: subframeData.framesMerged,
      framesDropped: subframeData.droppedFrames.length,
      subframeSensitiveNodes: subframeData.sensitiveNodes.length,
      subframeActionableNodes: subframeData.domSnapshot.length,
      unscannableRegions: allUnscannableRegions.length,
    });

    // ---- 3. RULING 4 -- wire the sensitive guard. Stamp
    // data-agent-sensitive="true" on the real DOM elements AND build a
    // sensitiveAgentIds Set (belt-and-suspenders -- action-executor's
    // guard accepts either signal). allowSensitiveTargets is never set;
    // policy stays fail-closed. Also merge 2a's classification into the
    // domSnapshot copy that will actually be sent (2a classifies, 3
    // enumerates -- Phase 1 RESULT's ruling). ----
    const sensitiveByAgentId = new Map(allSensitiveNodes.map((n) => [n.agentId, n]));
    for (const node of sensitiveNodes) {
      const el = idMap.get(node.agentId);
      if (el) el.setAttribute(ActionExecutor.SENSITIVE_ATTR, "true");
    }
    const sensitiveAgentIds = new Set(allSensitiveNodes.map((n) => n.agentId));
    let mergedDomSnapshot = domSnapshot
      .concat(subframeData.domSnapshot) // subframe entries are ALREADY sanitized+offset-translated -- see collectAndMergeSubframeReports()/scanThisFrame()
      .filter((node) => !actedAgentIds.has(node.agentId)) // see actedAgentIds comment above runAgentLoop's declaration
      .map((node) => {
        const s = sensitiveByAgentId.get(node.agentId);
        // NOTE: do NOT merge piiType here. server/schemas.py's DomNode is
        // extra="forbid" and has no piiType field, so sending it is a hard 422.
        // The PII type already reaches the server via redactedRegions
        // ({type, bbox, agentId}) — putting it on DomNode too is redundant.
        // sensitive:true alone still triggers sanitizeDomSnapshot()'s strip.
        return s ? { ...node, sensitive: true } : node;
      });

    // ---- 4. RULING 2 -- bbox normalization, ONE point. domSnapshot's
    // own bboxes are scaled here, explicitly, exactly once (see the
    // CONTRACT GAP note above scaleDomSnapshotBBoxes). sensitiveNodes'
    // bboxes are NOT scaled here -- they go into redact() raw, and
    // buildRedactedRegions() scales them internally exactly once. Vision
    // boxes are never scaled anywhere. Subframe-sourced bboxes are
    // ALREADY in top-frame CSS-pixel space by this point (frame-coords.js
    // translated them by the iframe's own offset, which is itself in the
    // top frame's CSS pixels) -- devicePixelRatio scaling still applies
    // to them exactly like everything else, since DPR is a single
    // page-wide value, not a per-frame one. ----
    const scaleFactor = window.devicePixelRatio || 1;
    mergedDomSnapshot = scaleDomSnapshotBBoxes(mergedDomSnapshot, scaleFactor);

    // ---- 5. RULING 3 -- filter vision boxes to privacy-relevant classes
    // before they ever reach redact(). ----
    const filteredBoxes = filterPrivacyRelevantBoxes(captureResp.boxes);

    // ---- 5.5. DEFENSIVE REDACTION of confirmed-unscannable regions
    // (real-site hardening pass). A closed shadow root's content is
    // GENUINELY UNKNOWN -- it might hold a password field, it might hold
    // nothing. Per this project's own recall-biased, "when genuinely
    // ambiguous, flag it" policy (see dom-scanner.js's header), the safe
    // default is to black out the WHOLE host region defensively rather
    // than leave a known blind spot unpainted on the screenshot -- an
    // unredacted region we KNOW we couldn't scan is exactly the kind of
    // silent gap this whole pass exists to close. Synthesized as
    // sensitiveNode-shaped entries (piiType:"other", no agentId) so this
    // reuses redaction.js's EXISTING, unmodified contract (it already
    // redacts every domNode it's handed, unconditionally) rather than
    // needing any change to that file, which is out of scope. This is a
    // POLICY CHOICE made here, in content.js, not silently -- flagged for
    // the orchestrator in the report in case a different policy (e.g.
    // "report only, don't auto-redact") is preferred. ----
    const defensiveUnscannableNodes = allUnscannableRegions
      .filter((r) => r && r.bbox)
      .map((r) => ({ bbox: r.bbox, piiType: "other", selector: r.selector }));
    const redactionInputNodes = allSensitiveNodes.concat(defensiveUnscannableNodes);

    // ---- 6. REDACT ----
    const tRedact0 = performance.now();
    const { redactedImage, redactedRegions } = await Redaction.redact(
      captureResp.screenshot,
      filteredBoxes,
      redactionInputNodes, // RAW CSS-px bboxes -- buildRedactedRegions scales internally via options.scaleFactor
      { scaleFactor }
    );
    const sanitizedDomSnapshot = Redaction.sanitizeDomSnapshot(mergedDomSnapshot);
    instr.mark(step, "redact", {
      durationMs: +(performance.now() - tRedact0).toFixed(1),
      regions: redactedRegions.length,
      visionBoxesTotal: (captureResp.boxes || []).length,
      visionBoxesKeptAfterFilter: filteredBoxes.length,
    });

    // ---- 7 & 8. SECTION 5 CHECK + SEND, with bounded retry on transient
    // upstream failures. THE SECTION 5 CHECK RE-RUNS ON EVERY ATTEMPT --
    // not just the first -- because a retry is a fresh network egress
    // ("an error path is a data egress path", CLAUDE.md Section 7 rule
    // 5, and a retry path is too). See the block comment above
    // isRetryableAnalyzeFailure() (near the top of this file) for why
    // this loop lives here in content.js rather than in background.js's
    // handleAnalyze. ----
    let analyzeResp = null;
    let attemptsUsed = 0;
    let section5Failed = false;

    for (let attempt = 1; attempt <= ANALYZE_MAX_ATTEMPTS; attempt++) {
      attemptsUsed = attempt;

      // Freshly constructed AND freshly re-checked every attempt -- not
      // hoisted above the loop and reused. The underlying values
      // (redactedImage/sanitizedDomSnapshot/redactedRegions/taskGoal)
      // don't change between attempts, but assertNoRawPii() still runs
      // against this exact object on every single iteration, so a retry
      // can never skip the check that guards what actually goes over the
      // wire.
      const payload = { image: redactedImage, domSnapshot: sanitizedDomSnapshot, redactedRegions, taskGoal };
      try {
        assertNoRawPii(payload, sensitiveNodes, idMap);
      } catch (err) {
        instr.mark(step, "send", { attempt, error: err.message });
        section5Failed = true;
        stepResults.push({ step, error: "section5_invariant_violation", detail: err.message, attempt });
        outcome = "section5_violation";
        break; // out of the retry loop -- a sanitization bug is not retryable, ever
      }

      const tSend0 = performance.now();
      analyzeResp = await browser.runtime.sendMessage({ type: "ANALYZE", payload });
      const sendMs = +(performance.now() - tSend0).toFixed(1);

      if (analyzeResp && analyzeResp.type === "ANALYZE_RESULT") {
        instr.mark(step, "send+response", { attempt, durationMs: sendMs });
        break; // success -- stop retrying
      }

      const retryable = isRetryableAnalyzeFailure(analyzeResp);
      const errClass = errorClassOf(analyzeResp);
      const willRetry = retryable && attempt < ANALYZE_MAX_ATTEMPTS;
      const delay = willRetry ? backoffDelayMs(attempt) : 0;

      // Every attempt -- success, failed-but-retrying, or failed-and-
      // exhausted -- produces its own "send+response" entry in the RUN
      // SUMMARY, tagged with `attempt`. This is what makes a slow step
      // read as "retrying" (3 entries, increasing delay) rather than
      // "frozen" (1 entry, then nothing for 7 seconds).
      instr.mark(step, "send+response", {
        attempt,
        durationMs: sendMs,
        errorClass: errClass,
        retrying: willRetry,
        nextDelayMs: willRetry ? delay : undefined,
      });

      if (!willRetry) break; // not retryable (4xx), or attempts exhausted -- stop

      console.log(`[agent-loop] step ${step} attempt ${attempt} failed (${errClass}) -- retrying in ${delay}ms`);
      await sleep(delay);
      // loop continues to attempt+1, which re-runs assertNoRawPii() above
      // before sending again -- see the comment at the top of this block.
    }

    if (section5Failed) {
      break; // out of the STEP loop -- already recorded above, do not fall through to the generic analyze_failed handling below
    }

    if (!analyzeResp || analyzeResp.type !== "ANALYZE_RESULT") {
      const errDetail = (analyzeResp && analyzeResp.error) || "no response from background";
      // A step that didn't happen must never look like one that
      // succeeded: this records the SAME "analyze_failed" outcome as
      // before retry logic existed, plus how many attempts were actually
      // made, and stops the loop exactly as it always did on failure.
      stepResults.push({ step, error: "analyze_failed", detail: errDetail, attempts: attemptsUsed });
      outcome = "analyze_failed";
      break;
    }
    const action = analyzeResp.action;

    // ---- 9. ACT -- see executeActionAcrossFrames() above for the
    // cross-frame relay this pass adds: if `action.targetId` names an
    // element in a subframe ("agent-f<N>-..."), the top frame's own
    // idMap can never contain it (no such thing as a cross-frame live
    // element reference), so a TARGET_NOT_FOUND there is redirected to
    // frame N via background.js instead of failing the step outright. ----
    const tAct0 = performance.now();
    let actResult;
    let relayedToFrameId;
    try {
      const actOutcome = await executeActionAcrossFrames(action, idMap, { sensitiveAgentIds });
      actResult = actOutcome.result;
      relayedToFrameId = actOutcome.relayedToFrameId;
    } catch (err) {
      instr.mark(step, "act", {
        durationMs: +(performance.now() - tAct0).toFixed(1),
        error: err.message,
        code: err.code,
      });
      stepResults.push({ step, action, error: err.message, code: err.code });
      outcome = "act_failed";
      break;
    }
    instr.mark(step, "act", {
      durationMs: +(performance.now() - tAct0).toFixed(1),
      result: actResult,
      relayedToFrameId,
    });
    stepResults.push({ step, action, actResult, relayedToFrameId });

    // Record completed click/type targets -- see actedAgentIds comment
    // above runAgentLoop's declaration. Page-level scroll/done (the
    // PAGE_TARGET_ID sentinel) never refers to a real element and is
    // deliberately not tracked here.
    if (
      (action.action === "type" || action.action === "click") &&
      actResult &&
      actResult.targetId &&
      actResult.targetId !== ActionExecutor.PAGE_TARGET_ID
    ) {
      actedAgentIds.add(actResult.targetId);
    }

    if (action.action === "done") {
      outcome = "done";
      break;
    }
  }

  return instr.summarize(stepResults, outcome);
}

// ---------------------------------------------------------------------
// Message listener. RUN_AGENT_LOOP is sent by background.js via
// chrome.tabs.sendMessage(tabId, ...) when the popup's "Run Agent Loop"
// button is clicked -- see popup.js/background.js. Every other message
// type reaching this listener is logged and ignored, same as the Phase 1
// stub's behaviour (harmless: chrome.runtime.onMessage fires broadcasts
// in every extension context, not just the intended recipient).
// ---------------------------------------------------------------------
browser.runtime.onMessage.addListener((message) => {
  if (!message || typeof message.type !== "string") return undefined;

  if (message.type === "RUN_AGENT_LOOP") {
    // FRAME COORDINATION guard (real-site hardening pass): this file now
    // runs in every frame (manifest.json's all_frames:true), so this
    // listener exists in every subframe too. Chrome's default
    // chrome.tabs.sendMessage routing already targets frameId 0 (the top
    // frame) when background.js's handleRunAgentLoopFromPopup sends this
    // without an explicit {frameId}, so a subframe should never actually
    // receive it -- but this guard is defense in depth, not decoration:
    // it costs nothing and turns "the loop silently ran twice, once per
    // frame, corrupting shared state" into a clean, loud, immediate
    // error if that routing assumption is ever wrong.
    if (!IS_TOP_FRAME) {
      return Promise.resolve({
        type: "RUN_AGENT_LOOP_ERROR",
        error: "RUN_AGENT_LOOP received in a non-top frame -- refusing to run a second agent loop instance",
      });
    }
    return runAgentLoop().catch((err) => ({
      type: "RUN_AGENT_LOOP_ERROR",
      // err.message here is always a static description string produced
      // by code in this file (ActionExecutionError messages, this file's
      // own thrown errors, etc.) -- never a stringified payload. Kept as
      // a deliberate invariant, not an accident: see assertNoRawPii.
      error: (err && err.message) || String(err),
    }));
  }

  console.log("[content] received message (no handler for this type):", message.type, message);
  return undefined;
});
