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

async function loadLibModules() {
  if (!DomScanner) {
    DomScanner = await import(browser.runtime.getURL("lib/dom-scanner.js"));
  }
  if (!Redaction) {
    Redaction = await import(browser.runtime.getURL("lib/redaction.js"));
  }
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
// The loop. Bounded to MAX_STEPS so a demo (or a misbehaving mock/VLM)
// can never spin forever -- "repeat" per CLAUDE.md Section 4 Phase 4, but
// repetition without a bound is an infinite loop, not a feature.
// ---------------------------------------------------------------------
const MAX_STEPS = 6;

async function runAgentLoop() {
  await loadLibModules();
  const instr = createInstrumentation();
  const stepResults = [];

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
    instr.mark(step, "capture", { durationMs: +captureResp.captureMs.toFixed(1) });
    instr.mark(step, "detect", { durationMs: +captureResp.detectMs.toFixed(1), detections: (captureResp.boxes || []).length });

    // ---- 2. SCAN -- RULING 1: action-executor FIRST (stamps
    // data-agent-id), dom-scanner SECOND (reuses those ids). Reversed,
    // the two mint independent id spaces and sensitiveNodes.agentId stops
    // correlating with domSnapshot.agentId. ----
    const tScan0 = performance.now();
    const { domSnapshot, idMap } = ActionExecutor.buildDomSnapshot(document);
    const maxIndex = computeMaxAgentIndex(idMap);
    let nextFallbackIndex = maxIndex;
    const { sensitiveNodes } = DomScanner.scanForPii(document, {
      // CONTRACT MISMATCH #2 fix (see computeMaxAgentIndex's comment
      // above): continue action-executor's numbering instead of
      // restarting dom-scanner's own fallback counter at 1.
      getAgentId: () => `agent-${++nextFallbackIndex}`,
    });
    instr.mark(step, "scan", {
      durationMs: +(performance.now() - tScan0).toFixed(1),
      actionableNodes: domSnapshot.length,
      sensitiveNodes: sensitiveNodes.length,
    });

    // ---- 3. RULING 4 -- wire the sensitive guard. Stamp
    // data-agent-sensitive="true" on the real DOM elements AND build a
    // sensitiveAgentIds Set (belt-and-suspenders -- action-executor's
    // guard accepts either signal). allowSensitiveTargets is never set;
    // policy stays fail-closed. Also merge 2a's classification into the
    // domSnapshot copy that will actually be sent (2a classifies, 3
    // enumerates -- Phase 1 RESULT's ruling). ----
    const sensitiveByAgentId = new Map(sensitiveNodes.map((n) => [n.agentId, n]));
    for (const node of sensitiveNodes) {
      const el = idMap.get(node.agentId);
      if (el) el.setAttribute(ActionExecutor.SENSITIVE_ATTR, "true");
    }
    const sensitiveAgentIds = new Set(sensitiveNodes.map((n) => n.agentId));
    let mergedDomSnapshot = domSnapshot.map((node) => {
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
    // boxes are never scaled anywhere. ----
    const scaleFactor = window.devicePixelRatio || 1;
    mergedDomSnapshot = scaleDomSnapshotBBoxes(mergedDomSnapshot, scaleFactor);

    // ---- 5. RULING 3 -- filter vision boxes to privacy-relevant classes
    // before they ever reach redact(). ----
    const filteredBoxes = filterPrivacyRelevantBoxes(captureResp.boxes);

    // ---- 6. REDACT ----
    const tRedact0 = performance.now();
    const { redactedImage, redactedRegions } = await Redaction.redact(
      captureResp.screenshot,
      filteredBoxes,
      sensitiveNodes, // RAW CSS-px bboxes -- buildRedactedRegions scales internally via options.scaleFactor
      { scaleFactor }
    );
    const sanitizedDomSnapshot = Redaction.sanitizeDomSnapshot(mergedDomSnapshot);
    instr.mark(step, "redact", {
      durationMs: +(performance.now() - tRedact0).toFixed(1),
      regions: redactedRegions.length,
      visionBoxesTotal: (captureResp.boxes || []).length,
      visionBoxesKeptAfterFilter: filteredBoxes.length,
    });

    // ---- 7. SECTION 5 CHECK, before send, fail-closed. ----
    const payload = { image: redactedImage, domSnapshot: sanitizedDomSnapshot, redactedRegions, taskGoal };
    try {
      assertNoRawPii(payload, sensitiveNodes, idMap);
    } catch (err) {
      instr.mark(step, "send", { error: err.message });
      stepResults.push({ step, error: "section5_invariant_violation", detail: err.message });
      outcome = "section5_violation";
      break;
    }

    // ---- 8. SEND ----
    const tSend0 = performance.now();
    const analyzeResp = await browser.runtime.sendMessage({ type: "ANALYZE", payload });
    instr.mark(step, "send+response", { durationMs: +(performance.now() - tSend0).toFixed(1) });
    if (!analyzeResp || analyzeResp.type !== "ANALYZE_RESULT") {
      const errDetail = (analyzeResp && analyzeResp.error) || "no response from background";
      stepResults.push({ step, error: "analyze_failed", detail: errDetail });
      outcome = "analyze_failed";
      break;
    }
    const action = analyzeResp.action;

    // ---- 9. ACT ----
    const tAct0 = performance.now();
    let actResult;
    try {
      actResult = ActionExecutor.executeAction(action, idMap, { sensitiveAgentIds });
    } catch (err) {
      instr.mark(step, "act", { durationMs: +(performance.now() - tAct0).toFixed(1), error: err.message, code: err.code });
      stepResults.push({ step, action, error: err.message, code: err.code });
      outcome = "act_failed";
      break;
    }
    instr.mark(step, "act", { durationMs: +(performance.now() - tAct0).toFixed(1), result: actResult });
    stepResults.push({ step, action, actResult });

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
