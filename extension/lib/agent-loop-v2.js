// SIH 26171 v2 rebuild -- Phase V4a (integration-v2), extension/lib/agent-loop-v2.js
//
// PURE orchestration of the v2 capture -> scan -> rank -> tokenize -> scene ->
// egress-assert -> send -> policy -> (consent) -> rehydrate -> act loop
// (docs/v2/ARCHITECTURE.md contracts C1-C6). "Pure" means: this module never
// touches `document`, `chrome`/`browser`, `fetch`, or a canvas directly. Every
// side-effecting operation is an injected function on the `io` parameter --
// see IO CONTRACT below -- so the whole loop can run, and be unit-tested with
// `node --test`, against hand-written fakes with zero browser. The REAL
// implementations of `io`'s functions (real chrome.tabs.captureVisibleTab,
// real fetch to 127.0.0.1:8757 and /v2/analyze, real DOM manipulation via
// ActionExecutor.executeAction) live in extension/content.js's
// `buildContentScriptIoV2()` adapter, not here.
//
// VERIFIED MODULES CONSUMED (headers/exports read, never modified):
//   pii-regex.js       findRegexSpans(text) -> PiiSpan[]
//   pii-tokenizer.js   mergeSpans, classifyBand, tokenize, rehydrate,
//                      createTokenMap, seedVault, UnknownTokenError, TokenMap
//   policy.js          classifyTier, decide, tightenWithServer, POLICY_CODES,
//                      isGoalTokenComplete (C4 amendment, 2026-09-28)
//   element-ranker.js  rankElements (already pure -- imported directly, not
//                      injected, since it needs no DOM/network access)
// action-executor.js/dom-scanner.js/redaction.js/capture-hash.js/
// stall-detector.js/profile-vault.js are all DOM- or canvas-bound, so they
// are wrapped by the `io` adapter in content.js instead of imported here.
//
// ---------------------------------------------------------------------------
// IO CONTRACT -- every field required unless noted optional.
// ---------------------------------------------------------------------------
//   io.getTaskGoal() -> Promise<string>
//   io.getProfile() -> Promise<{full_name:string, email:string, phone:string}>
//   io.getViewport() -> {width:number, height:number, devicePixelRatio:number}
//   io.newRevision() -> string                    (crypto.randomUUID() in production)
//   io.now() -> number                            (ms; performance.now() in production)
//   io.sleep(ms) -> Promise<void>
//   io.isAborted() -> boolean                     (Stop button support)
//   io.reportProgress(patch) -> void              (optional; no-op default)
//
//   -- "capture, scan, detect, ner, send, execute": the six injection points
//      CLAUDE.md's brief names explicitly. capture/detect are two named
//      calls but MAY share one underlying round trip in production (v1's
//      existing CAPTURE_AND_DETECT message already returns both a
//      screenshot and vision boxes in one offscreen-doc round trip; see
//      buildContentScriptIoV2() in content.js) --
//
//   io.capture() -> Promise<{
//     screenshotBase64: string, screenshotWidthPx: number|null,
//     screenshotHeightPx: number|null, screenshotHash: string|null,
//     captureMs: number, throttleWaitMs?: number,
//   }>
//   io.detect() -> Promise<{ boxes: Array<{label,score,xmin,ymin,xmax,ymax}>, detectMs: number }>
//     Called immediately after capture() for the SAME step; production
//     adapter returns the boxes from that same capture()'s round trip.
//
//   io.scanDom() -> Promise<{
//     domSnapshot: Array<{agentId,tag,role,type,text,bbox:{x,y,w,h},sensitive}>,
//     idMap: Map<string, *>,           -- opaque to this module; passed straight to io.executeAction
//     sensitiveNodes: Array<{selector,bbox,piiType,agentId}>,
//     unscannableRegions: Array<*>,
//   }>
//
//   io.nerCall(texts: string[]) -> Promise<PiiSpan[][]>
//     One batched call per step (V4 design rule). MUST throw NerUnavailableError
//     (exported below) on any failure -- there is no regex-only fallback (C3).
//
//   io.sendAnalyze(payload: object) -> Promise<
//     {ok:true, body:object} | {ok:false, status:number, error:*}
//   >
//
//   io.executeAction(action, idMap, options) -> Promise<*> | *
//     Wraps ActionExecutor.executeAction. May throw (ActionExecutionError-shaped
//     -- reads `.code`/`.message`).
//
//   io.requestConsent({code, reason, elementDescription}) -> Promise<boolean>
//     Must resolve `false` if nothing answers within its own timeout (C4:
//     "Consent UI denies by default after 60s"). The 60s timeout itself is
//     the io adapter's responsibility (content.js), not this module's --
//     this module just awaits whatever io.requestConsent() resolves to.
//
//   io.redact(screenshotBase64, visionBoxes, domNodes, options) -> Promise<{redactedImage, redactedRegions}>
//     Only called for a `need_visual` escalation (image mode).
//
//   io.reviewGoalPrivacySpan({text, label, score}) -> Promise<boolean> (OPTIONAL)
//     C5/C2 amendment (2026-09-26). Called once per ask-band span found in
//     the USER's OWN taskGoal (never for page-label spans), before step 1
//     ever sends anything. Resolves `true` ("Keep private" -- the span
//     stays tokenized) or `false` ("Not private" -- the raw text is
//     restored verbatim). MUST resolve `true` if nothing answers within
//     its own timeout (same "keep private" default, mirroring C4's own
//     "deny by default" posture for io.requestConsent above) -- the
//     timeout itself is the io adapter's responsibility, not this
//     module's. `text` is the raw span text -- passed ONLY to this hook,
//     never onward to io.nerCall/io.sendAnalyze. Absent in a fake/test io
//     that never wires it, every ask-band span simply stays tokenized
//     (the same safe default the hook itself must return on timeout).
//
// ---------------------------------------------------------------------------

import { findRegexSpans } from "./pii-regex.js";
import {
  mergeSpans,
  tokenize,
  rehydrate,
  createTokenMap,
  seedVault,
  UnknownTokenError,
  TOKEN_PATTERN,
} from "./pii-tokenizer.js";
import { classifyTier, decide, tightenWithServer, POLICY_CODES, isGoalTokenComplete } from "./policy.js";
import { rankElements, DEFAULT_MAX_ELEMENTS } from "./element-ranker.js";

export const SCHEMA_LITERAL_V2 = "dhristi-scene-v2";
export const PAGE_TARGET_ID_V2 = "page";
export const MAX_STEPS_V2 = 25;
export const MAX_HISTORY_V2 = 10;
export const MAX_LABEL_CHARS_V2 = 120;

/** Thrown by an io.nerCall() implementation when the NER service (C3) is
 * unreachable/unhealthy. Caught at the top of the step loop -- the run
 * stops with a clear outcome, never silently degrading to regex-only. */
export class NerUnavailableError extends Error {
  constructor(detail) {
    super(`NER service unavailable -- run stopped (no regex-only fallback, C3). ${detail || ""}`.trim());
    this.name = "NerUnavailableError";
  }
}

/** Thrown by assertEgressV2() -- C6. Never includes a raw value, only
 * agentIds/locations, matching this codebase's "an error path is a data
 * egress path" rule (CLAUDE.md Section 7 rule 5 / ARCHITECTURE.md C6). */
export class EgressAssertionError extends Error {
  constructor(reasons) {
    super(
      `C6 EGRESS ASSERTION FAILED -- outgoing v2 payload rejected before it left the client: ${reasons.join("; ")}. ` +
        "This is a client-side sanitization bug, not something to fix by loosening this check."
    );
    this.name = "EgressAssertionError";
    this.reasons = reasons;
  }
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/** Scale a v1-shaped {x,y,w,h} bbox (CSS px, from getBoundingClientRect())
 * into screenshot-pixel space -- same "exactly once, at the boundary" rule
 * v1's Ruling 1/Ruling 2 established (ARCHITECTURE.md carries that
 * invariant forward for v2; C5 doesn't re-litigate bbox units, so this
 * module follows the existing, proven precedent rather than inventing a
 * new one). Vision boxes are NEVER passed through here -- they are already
 * in screenshot-pixel space by construction (face-detect.js's own header). */
function scaleBBox(bbox, devicePixelRatio) {
  if (!bbox) return { x: 0, y: 0, w: 0, h: 0 };
  const s = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return { x: bbox.x * s, y: bbox.y * s, w: bbox.w * s, h: bbox.h * s };
}

/** Truncate to C5's 120-char label cap. Truncated BEFORE regex/NER/tokenize
 * run (not after) -- truncating a tokenized string could cut a token in
 * half ("EMAIL#" with the digit sliced off), which would then fail
 * TOKEN_PATTERN and rehydrate() would treat it as ordinary text forever.
 * Truncating the raw text first means tokenize() only ever emits whole
 * tokens for whatever raw text distribution survived truncation. */
function truncateLabel(text) {
  if (typeof text !== "string") return "";
  return text.length > MAX_LABEL_CHARS_V2 ? text.slice(0, MAX_LABEL_CHARS_V2) : text;
}

/** v1 PiiType -> C5 RegionKind. C5's RegionKind enum (face/password/field/
 * text-pii/frame/media) was never given an explicit mapping table from
 * dom-scanner.js's PII_TYPES anywhere in the architecture doc -- this is a
 * DOCUMENTED INTERPRETATION (flagged in this file's own header and in the
 * V4a report), not a ported contract: password-shaped types map to
 * "password" (a form field), cc-number maps to "field" (a form field that
 * isn't a password), everything else (the regex-detected text/value
 * matches -- email/tel/aadhaar/pan/other) maps to "text-pii", matching C5's
 * own vocabulary split between form-field kinds and plain-text-PII kinds. */
function piiTypeToRegionKind(piiType) {
  if (piiType === "password" || piiType === "current-password") return "password";
  if (piiType === "cc-number") return "field";
  return "text-pii";
}

/** Guess a representative action kind for an element that has not been
 * targeted by any actual action yet, purely so classifyTier(element,
 * action) -- which contract C4 defines as taking BOTH -- has something to
 * classify against when C5's `elements[].tier` is populated at SCENE-BUILD
 * time (before the model has chosen anything). DOCUMENTED INTERPRETATION:
 * C4/C5 do not specify how a pre-action tier is derived; see this file's
 * header / the V4a report for the same flag. */
function guessRepresentativeAction(domNode) {
  const tag = String((domNode && domNode.tag) || "").toLowerCase();
  const type = String((domNode && domNode.type) || "").toLowerCase();
  const role = String((domNode && domNode.role) || "").toLowerCase();
  if (tag === "a" || role === "link" || role === "navigation") {
    return { action: "click", targetId: domNode.agentId, value: null };
  }
  if (
    tag === "input" &&
    ["text", "email", "tel", "password", "search", "url", "number"].includes(type)
  ) {
    return { action: "type", targetId: domNode.agentId, value: null };
  }
  if (tag === "textarea") return { action: "type", targetId: domNode.agentId, value: null };
  return { action: "click", targetId: domNode.agentId, value: null };
}

/** C4 rule mapping -> v1-style *_BLOCKED outcome label, for a DENIED/timed-out
 * "ask" verdict. Per CLAUDE.md's Phase 3 safety ruling + this file's brief:
 * "make sure deny produces v1's SENSITIVE_TARGET_BLOCKED /
 * IRREVERSIBLE_ACTION_BLOCKED outcomes" -- kept as literal string matches so
 * any downstream tooling that already greps for these two v1 codes keeps
 * working unchanged against the v2 loop. */
function deniedOutcomeCode(policyCode) {
  if (policyCode === POLICY_CODES.SENSITIVE_TARGET) return "SENSITIVE_TARGET_BLOCKED";
  if (policyCode === POLICY_CODES.IRREVERSIBLE_ACTION) return "IRREVERSIBLE_ACTION_BLOCKED";
  if (policyCode === POLICY_CODES.INTENT_MISMATCH) return "INTENT_MISMATCH_BLOCKED";
  return `${policyCode}_BLOCKED`;
}

/** Extract every token-shaped raw substring that got tokenized (band !==
 * "ignore") out of `text`, given the ORIGINAL (pre-tokenize) spans. Used to
 * grow the run's rawValueRegistry -- see runAgentLoopV2()'s own comment on
 * why this exists instead of enumerating TokenMap directly (TokenMap
 * deliberately has no enumeration method; see pii-tokenizer.js's own
 * class-level comment on toJSON()). */
function collectRawValuesTokenizedOutOf(text, spans, classifyBandFn) {
  const out = [];
  for (const span of spans) {
    if (classifyBandFn(span) === "ignore") continue;
    const raw = text.slice(span.start, span.end);
    if (raw) out.push(raw);
  }
  return out;
}

// ---------------------------------------------------------------------------
// C6 -- egress assertion
// ---------------------------------------------------------------------------

/**
 * C6: "Before every send and every retry, the serialized body must contain
 * no TokenMap value, no vault value, and no flagged raw node value, and
 * must match the mode (no `image` key in semantic mode). Failure throws;
 * the request never leaves."
 *
 * @param {object} payload the exact object about to be JSON.stringify'd and sent.
 * @param {"semantic"|"image"} mode
 * @param {Iterable<string>} rawValueRegistry every raw value ever tokenized
 *   or vault-seeded THIS RUN (see runAgentLoopV2's own comment -- this is
 *   this module's stand-in for "every TokenMap value", since TokenMap
 *   itself cannot be enumerated by design).
 * @param {Array<{agentId:string, rawValue:string}>} liveSensitiveRawValues
 *   the CURRENT raw DOM value for every sensitive node this step's scan
 *   found, resolved by the io adapter (mirrors v1's assertNoRawPii -- see
 *   that function's own comment in content.js for why this is
 *   defense-in-depth on top of the tokenization checks above, not a
 *   replacement for them).
 * @throws {EgressAssertionError}
 */
export function assertEgressV2(payload, mode, rawValueRegistry, liveSensitiveRawValues) {
  const reasons = [];
  const payloadStr = JSON.stringify(payload);

  const hasImageKey = payload && typeof payload === "object" && Object.prototype.hasOwnProperty.call(payload, "image") && payload.image != null;
  if (mode === "semantic" && hasImageKey) {
    reasons.push("mode is 'semantic' but the payload carries a non-null `image` key");
  }
  if (mode === "image" && !hasImageKey) {
    reasons.push("mode is 'image' but the payload carries no `image` key");
  }

  const leakedTokenValueAgentIds = [];
  for (const raw of rawValueRegistry) {
    if (typeof raw === "string" && raw.length >= 2 && payloadStr.includes(raw)) {
      leakedTokenValueAgentIds.push(raw.length > 0 ? "(tokenized/vault value)" : raw);
    }
  }
  if (leakedTokenValueAgentIds.length > 0) {
    reasons.push(`payload contains ${leakedTokenValueAgentIds.length} raw tokenized/vault value(s) that should only ever appear as tokens`);
  }

  const leakedSensitiveAgentIds = [];
  for (const entry of liveSensitiveRawValues || []) {
    if (entry && typeof entry.rawValue === "string" && entry.rawValue.length >= 3 && payloadStr.includes(entry.rawValue)) {
      leakedSensitiveAgentIds.push(entry.agentId);
    }
  }
  if (leakedSensitiveAgentIds.length > 0) {
    reasons.push(`payload contains a raw live value for flagged sensitive agentId(s) ${leakedSensitiveAgentIds.join(", ")}`);
  }

  if (reasons.length > 0) throw new EgressAssertionError(reasons);
}

// ---------------------------------------------------------------------------
// Per-step egress-text tokenization
// ---------------------------------------------------------------------------

/**
 * Regex-scan + (batched) NER-scan + merge + tokenize a batch of raw text
 * pieces in ONE pass, sharing the run's single TokenMap. Order matches the
 * V4 design rule: NER only ever sees egress text (taskGoal on step 1,
 * ranked element labels every step) -- never the whole page, and never a
 * value already known to be token-shaped (history values are copied
 * through verbatim by the caller instead of being run through this
 * function -- see runAgentLoopV2()'s own comment at its history-handling
 * site for why re-tokenizing an already-tokenized string is actively
 * wrong, not merely redundant).
 *
 * @param {string[]} texts
 * @param {function} nerCall io.nerCall
 * @param {TokenMap} tokenMap
 * @returns {Promise<{tokenizedTexts: string[], rawValues: string[], asked: object[]}>}
 */
async function tokenizeBatch(texts, nerCall, tokenMap) {
  if (texts.length === 0) return { tokenizedTexts: [], rawValues: [], asked: [] };

  let nerSpansPerText;
  try {
    nerSpansPerText = await nerCall(texts);
  } catch (err) {
    if (err instanceof NerUnavailableError) throw err;
    throw new NerUnavailableError(err && err.message ? err.message : String(err));
  }
  if (!Array.isArray(nerSpansPerText) || nerSpansPerText.length !== texts.length) {
    throw new NerUnavailableError("ner response shape mismatch (expected one span array per input text)");
  }

  const tokenizedTexts = [];
  const rawValues = [];
  const asked = [];
  // classifyBand is re-imported indirectly through tokenize()'s own use of
  // it; collectRawValuesTokenizedOutOf needs its own reference, so import
  // it directly here rather than re-deriving band logic.
  const { classifyBand } = await import("./pii-tokenizer.js");

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    const regexSpans = findRegexSpans(text);
    const nerSpans = nerSpansPerText[i] || [];
    const merged = mergeSpans(regexSpans, nerSpans);
    rawValues.push(...collectRawValuesTokenizedOutOf(text, merged, classifyBand));
    const { text: tokenizedText, asked: askedHere } = tokenize(text, merged, tokenMap);
    tokenizedTexts.push(tokenizedText);
    asked.push(...askedHere);
  }

  return { tokenizedTexts, rawValues, asked };
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

/**
 * @param {object} io see IO CONTRACT above.
 * @param {{maxSteps?:number, maxElements?:number}} [options]
 * @returns {Promise<{
 *   outcome: string, steps: number, stepResults: object[],
 *   staleCaptureCount: number, revision: string|null,
 * }>}
 */
export async function runAgentLoopV2(io, options = {}) {
  const maxSteps = Number.isInteger(options.maxSteps) && options.maxSteps > 0 ? options.maxSteps : MAX_STEPS_V2;
  const maxElements = Number.isInteger(options.maxElements) && options.maxElements > 0 ? options.maxElements : DEFAULT_MAX_ELEMENTS;

  const rawTaskGoal = (await io.getTaskGoal()) || "";
  const profile = (await io.getProfile()) || { full_name: "", email: "", phone: "" };

  const tokenMap = createTokenMap();
  const vaultTokens = seedVault(tokenMap, profile);
  // C5/C2 amendment (2026-09-26): announce the vault to the planner as
  // {token, field} pairs -- tokens + categories only, NEVER a value (the
  // raw profile value never leaves this closure). Before this, seedVault()
  // minted PROFILE...#n tokens straight into the TokenMap but this module
  // never put them anywhere a planner could read -- not in taskGoal, not
  // in any element label -- so a real (non-scripted) planner had no
  // legitimate way to learn such a token exists, and the server's own
  // UNKNOWN_TOKEN check would reject any it guessed. `field` values here
  // are seedVault()'s own object keys ("full_name"|"email"|"phone"),
  // which are byte-identical to C5/schemas_v2's ProfileFieldV2 enum
  // members -- same closed set, not independently redefined here.
  const vaultManifest = Object.entries(vaultTokens)
    .filter(([, token]) => token)
    .map(([field, token]) => ({ token, field }));
  // Every value ever handed to TokenMap.getOrCreateToken() this run -- see
  // assertEgressV2's own doc comment for why this module tracks its own
  // copy instead of enumerating TokenMap (which structurally cannot be
  // enumerated -- see pii-tokenizer.js's TokenMap class comment).
  const rawValueRegistry = new Set();
  for (const field of ["full_name", "email", "phone"]) {
    const raw = profile[field] && String(profile[field]).trim();
    if (raw) rawValueRegistry.add(raw);
  }

  // taskGoal never changes within a run -- tokenize it ONCE (step 1) and
  // reuse the tokenized string on every later step, instead of re-sending
  // an unchanging string through NER every step (V4 design rule: NER is
  // the latency risk; don't pay for what doesn't change).
  let tokenizedTaskGoal = null;

  const stepResults = [];
  const history = []; // C5 HistoryEntry[], newest-last, capped at MAX_HISTORY_V2
  const actionSignatureHistory = []; // for StallDetector, if the io adapter wires one in
  const actedAgentIds = new Set();
  const seenHashScrollY = new Map(); // capture-hash.js RULING A' check 2 state, whole-run

  let outcome = "max_steps_reached";
  let lastRevision = null;
  let staleCaptureCount = 0;

  // ---- Instrumentation (CLAUDE.md V4a brief, item 6): per-stage
  // timestamps for capture, detect, scan, rank, ner, tokenize,
  // egress-assert, send, response, policy, act -- plus performance.memory
  // where available, "written to the run log and summarizable to JSON".
  // `io.now()` is injected (performance.now() in production, a fake clock
  // in tests) so timing is exercised by the unit tests too, not just left
  // untested until the browser run. `io.getMemoryUsage()` is optional --
  // a test io can omit it, matching every other optional io field's
  // pattern in this file. ----
  const now = () => (io.now ? io.now() : Date.now());
  const snapshotMemory = () => (io.getMemoryUsage ? io.getMemoryUsage() : null);
  const ms = (t0) => +(now() - t0).toFixed(1);

  for (let step = 1; step <= maxSteps; step++) {
    const timings = {};
    const pushStepResult = (extra) => stepResults.push({ step, timings: { ...timings }, memory: snapshotMemory(), ...extra });

    if (io.isAborted && io.isAborted()) {
      outcome = "stopped";
      break;
    }

    io.reportProgress && io.reportProgress({ step, stage: "capture" });

    // ---- 1. CAPTURE + DETECT ----
    let captureResult, detectResult;
    try {
      captureResult = await io.capture();
      detectResult = await io.detect();
    } catch (err) {
      pushStepResult({ error: "capture_failed", detail: err && err.message });
      outcome = "capture_failed";
      break;
    }
    // Reuse the io adapter's own real measurements (background.js already
    // times capture/detect precisely -- see agent-loop-v2.js's header on
    // why capture/detect share one round trip) rather than re-timing a
    // message round trip redundantly.
    timings.captureMs = captureResult.captureMs;
    timings.detectMs = detectResult.detectMs;

    const revision = io.newRevision();
    lastRevision = revision;

    const viewport = io.getViewport ? io.getViewport() : { width: 1280, height: 800, devicePixelRatio: 1 };
    const dpr = viewport.devicePixelRatio || 1;

    // ---- STALE-CAPTURE DETECTION (capture-hash.js, RULING A', reused
    // verbatim from v1 -- see that module's own header for the two-check
    // rationale). Optional: only runs if the io adapter supplied a
    // CaptureHash-shaped helper; a fake/test io can omit it entirely. ----
    if (io.detectStaleCapture) {
      const verdict = io.detectStaleCapture({
        screenshotWidthPx: captureResult.screenshotWidthPx,
        screenshotHeightPx: captureResult.screenshotHeightPx,
        screenshotHash: captureResult.screenshotHash,
        expectedWidthPx: viewport.width * dpr,
        expectedHeightPx: viewport.height * dpr,
        seenHashScrollY,
      });
      if (verdict && (verdict.dimensionMismatch || verdict.hashRecurrence)) {
        staleCaptureCount++;
        pushStepResult({ skipped: "stale_capture", verdict });
        io.reportProgress && io.reportProgress({ stage: "capture", lastError: { summary: "stale capture detected, send refused this step" } });
        continue; // NOT break -- v1's RULING C: skip only this step's send
      }
    }

    io.reportProgress && io.reportProgress({ stage: "scan", step });

    // ---- 2. SCAN + RANK ----
    const tScan0 = now();
    const scan = await io.scanDom();
    timings.scanMs = ms(tScan0);
    const sensitiveAgentIds = new Set(scan.sensitiveNodes.map((n) => n.agentId));
    const domSnapshotForRanking = scan.domSnapshot
      .filter((n) => !actedAgentIds.has(n.agentId))
      .map((n) => ({ ...n, sensitive: sensitiveAgentIds.has(n.agentId) || n.sensitive === true }));

    const tRank0 = now();
    const rankResult = rankElements(domSnapshotForRanking, rawTaskGoal, {
      maxElements,
      viewport: { width: viewport.width, height: viewport.height },
    });
    timings.rankMs = ms(tRank0);
    timings.actionableNodes = domSnapshotForRanking.length;
    timings.rankSelected = rankResult.selected.length;
    timings.rankDropped = rankResult.dropped;

    // ---- 3. EGRESS TEXT COLLECTION + TOKENIZE (regex + NER, batched) ----
    // taskGoal: tokenized once, step 1 only (V4 design rule).
    timings.nerMs = 0;
    if (tokenizedTaskGoal === null) {
      const tGoal0 = now();
      try {
        const goalResult = await tokenizeBatch([rawTaskGoal], io.nerCall, tokenMap);
        tokenizedTaskGoal = goalResult.tokenizedTexts[0] || "";
        for (const raw of goalResult.rawValues) rawValueRegistry.add(raw);

        // C5/C2 amendment (2026-09-26): ask-band spans in the USER'S OWN
        // taskGoal (never in page labels -- item 2's own scoping; the
        // per-step label batch below never runs this) are reviewed with
        // the user, once each, BEFORE step 1 ever sends anything.
        // io.reviewGoalPrivacySpan() is optional (absent in a fake/test
        // io that doesn't wire it, same pattern as every other optional
        // hook in this file) -- when absent, every ask-band span simply
        // stays tokenized, which is the same SAFE default the hook itself
        // must return on its own 60s timeout ("Keep private").
        //
        // "Not private" substitutes the RAW span text back into
        // tokenizedTaskGoal, verbatim, and removes it from
        // rawValueRegistry -- otherwise C6's egress assertion would
        // fail-close on a value the user just explicitly declassified.
        // This is not "loosening" C6 (EgressAssertionError's own posture:
        // never work around a real leak by loosening the check) -- it is
        // correcting what counts as private for THIS run, before C6 ever
        // evaluates it, exactly once, from an explicit human answer.
        //
        // The raw span text is handed ONLY to io.reviewGoalPrivacySpan()
        // -- never to io.nerCall/io.sendAnalyze or anywhere else
        // network-facing. This pure module cannot enforce that past its
        // own io boundary (same as every other io.* call), but the real
        // adapter (content.js -> background.js -> popup.js) must uphold
        // it, same as it already does for io.requestConsent()'s
        // `elementDescription`.
        if (goalResult.asked.length > 0 && typeof io.reviewGoalPrivacySpan === "function") {
          for (const span of goalResult.asked) {
            const rawSpanText = rawTaskGoal.slice(span.start, span.end);
            const tReview0 = now();
            const keepPrivate = await io.reviewGoalPrivacySpan({ text: rawSpanText, label: span.label, score: span.score });
            timings.goalPrivacyReviewMs = (timings.goalPrivacyReviewMs || 0) + ms(tReview0);
            if (keepPrivate === false) {
              // Idempotent: identical (label, rawValue) pair tokenize()
              // already minted this exact token from -- returns the SAME
              // token, never a fresh one, so this can never orphan or
              // duplicate a token identity.
              const token = tokenMap.getOrCreateToken(span.label, rawSpanText);
              tokenizedTaskGoal = tokenizedTaskGoal.split(token).join(rawSpanText);
              rawValueRegistry.delete(rawSpanText);
            }
          }
        }
      } catch (err) {
        timings.nerMs += ms(tGoal0);
        if (err instanceof NerUnavailableError) {
          pushStepResult({ error: "ner_unavailable", detail: err.message });
          outcome = "ner_unavailable";
          io.reportProgress && io.reportProgress({ stage: "ner", lastError: { summary: err.message } });
          break;
        }
        throw err;
      }
      timings.nerMs += ms(tGoal0);
    }

    // A sensitive-flagged node's raw text is NEVER handed to regex/NER/
    // tokenize at all -- action-executor.js's buildDomSnapshot() reads a
    // form field's live `.value` as its `text` BY DESIGN (see that
    // function's own doc comment: "this is intentional and correct for
    // this module's scope... Phase 2b is the one that strips raw values"),
    // so an untouched sensitive node's `.text` can genuinely BE the raw
    // password/PII value itself. Regex/NER only catch PII-SHAPED text
    // (email/phone/name/etc.) -- a password like "hunter2Demo!" matches
    // NONE of those patterns and would tokenize to itself UNCHANGED,
    // landing verbatim in elements[].label. Caught live by C6 during this
    // module's own V4a browser evidence run (agent-1's raw password value
    // reached this point before the egress assertion caught it) -- fixed
    // here at the source rather than left for the assertion to keep
    // catching every single step.
    const truncatedLabels = rankResult.selected.map((n) => {
      const isSensitive = sensitiveAgentIds.has(n.agentId) || n.sensitive === true;
      return isSensitive ? "" : truncateLabel(n.text || "");
    });

    // History values are NEVER re-run through regex/NER, even though C5's
    // "egress text" wording names them alongside labels/taskGoal --
    // DELIBERATE, CORRECTED DECISION, found live in this module's own V4a
    // browser evidence run. A history value is always ALREADY safe by the
    // time it lands in `history`: it can only ever be response.value from
    // a PRIOR step's /v2/analyze reply, which by then has already passed
    // (a) the server's own compute_server_verdict() UNKNOWN_TOKEN/
    // RAW_VALUE_IN_ACTION checks and (b) this module's own local
    // rehydrate()/UnknownTokenError check -- so it is either a known
    // token or benign non-PII text, never raw PII. Re-scanning it is not
    // merely redundant, it is ACTIVELY WRONG: NER, run on a token-shaped
    // string like "PERSONNAME#1", tags the WHOLE token as a PERSONNAME
    // entity in its own right (confirmed live: a direct /ner probe on the
    // literal string "PERSONNAME#1" returned a PERSONNAME span covering
    // all 12 characters) -- tokenizing THAT "detection" mints a second,
    // bogus token whose raw value IS the string "PERSONNAME#1", which
    // then poisons rawValueRegistry: the C6 assertion started rejecting
    // every step 2+ payload because taskGoal LEGITIMATELY contains
    // "PERSONNAME#1" as its real token, which the poisoned registry now
    // also treats as a forbidden raw value. History values are copied
    // through verbatim instead.
    const tokenizedHistoryValues = history.map((h) => (h.action && typeof h.action.value === "string" ? h.action.value : null));

    let tokenizedLabels = [];
    const tBatch0 = now();
    try {
      const batchResult = await tokenizeBatch(truncatedLabels, io.nerCall, tokenMap);
      tokenizedLabels = batchResult.tokenizedTexts;
      for (const raw of batchResult.rawValues) rawValueRegistry.add(raw);
    } catch (err) {
      timings.nerMs += ms(tBatch0);
      if (err instanceof NerUnavailableError) {
        pushStepResult({ error: "ner_unavailable", detail: err.message });
        outcome = "ner_unavailable";
        io.reportProgress && io.reportProgress({ stage: "ner", lastError: { summary: err.message } });
        break;
      }
      throw err;
    }
    timings.nerMs += ms(tBatch0);
    timings.egressTextCount = truncatedLabels.length;

    io.reportProgress && io.reportProgress({ stage: "tokenize", step, elements: rankResult.selected.length });

    // ---- 4. C5 SEMANTIC SCENE ----
    const elements = rankResult.selected.map((node, i) => {
      const sensitive = sensitiveAgentIds.has(node.agentId) || node.sensitive === true;
      const tier = classifyTier(node, guessRepresentativeAction(node));
      const label = tokenizedLabels[i] && tokenizedLabels[i].length > 0 ? tokenizedLabels[i] : null;
      return {
        agentId: node.agentId,
        tag: node.tag,
        role: node.role || null,
        type: node.type || null,
        label,
        bbox: scaleBBox(node.bbox, dpr),
        sensitive,
        tier,
      };
    });

    // V4b (integration-v2, part B): subframe + shadow-DOM parity. `scan.
    // unscannableRegions` (io.scanDom()'s own optional field -- see the IO
    // CONTRACT header) covers everything this step could NOT positively
    // verify is safe to leave unredacted: a closed shadow root (reused
    // verbatim from v1's TIER 1 policy -- see dom-scanner.js) AND, when the
    // io adapter merges subframe reports (content.js's
    // collectAndMergeSubframeReports(), also reused verbatim from v1), any
    // <iframe> whose child report did not positively merge this step. C5's
    // RegionKind enum names "frame" for exactly this case (never produced
    // by piiTypeToRegionKind() above, which only ever sees dom-scanner's
    // PII_TYPES) -- mapping it here is what makes the "when you cannot see
    // inside, over-redact" policy visible to the PLANNER (via the prompt's
    // regions list), not only to the image (need_visual's redact() call
    // below folds the same list in as domNodes). A region with no
    // resolvable bbox is skipped, never sent as {x:0,y:0,w:0,h:0} -- a
    // fabricated zero-box is exactly the "wrong bbox that looks like
    // success" this codebase's frame-coords.js/redaction.js both already
    // refuse to do.
    const unscannableRegionsWithBbox = (scan.unscannableRegions || []).filter((r) => r && r.bbox);

    const regions = [
      ...scan.sensitiveNodes.map((n) => ({
        kind: piiTypeToRegionKind(n.piiType),
        bbox: scaleBBox(n.bbox, dpr),
        source: "dom",
      })),
      ...unscannableRegionsWithBbox.map((r) => ({
        kind: "frame",
        bbox: scaleBBox(r.bbox, dpr),
        source: "dom",
      })),
      ...((detectResult.boxes || [])
        .filter((b) => String(b.label || "").toLowerCase() === "face")
        .map((b) => ({
          kind: "face",
          bbox: { x: b.xmin, y: b.ymin, w: b.xmax - b.xmin, h: b.ymax - b.ymin },
          source: "vision",
        }))),
    ];

    // Frame-coordination stats: reported ONLY when the io adapter supplies
    // them (a fake/test io can omit every one of these fields, matching
    // every other optional io field's pattern in this file) -- unconditional
    // once present, even at zero, per this codebase's "silent truncation
    // reads as success" convention (v1's `dropped`/`staleCaptureCount`/
    // `fullPage` precedent).
    if (typeof scan.framesReported === "number") timings.framesReported = scan.framesReported;
    if (typeof scan.framesMerged === "number") timings.framesMerged = scan.framesMerged;
    if (typeof scan.framesDropped === "number") timings.framesDropped = scan.framesDropped;
    if (typeof scan.defensivelyRedactedIframeCount === "number") {
      timings.defensivelyRedactedIframeCount = scan.defensivelyRedactedIframeCount;
    }
    timings.unscannableRegions = unscannableRegionsWithBbox.length;

    const historyForRequest = history.map((h, i) => ({
      action: { action: h.action.action, targetId: h.action.targetId, value: tokenizedHistoryValues[i] || null },
      outcome: h.outcome,
    }));

    const semanticPayload = {
      schema: SCHEMA_LITERAL_V2,
      mode: "semantic",
      revision,
      taskGoal: tokenizedTaskGoal,
      viewport: { w: viewport.width, h: viewport.height },
      elements,
      regions,
      history: historyForRequest,
      // C5/C2 amendment (2026-09-26): omitted entirely when the vault is
      // empty (spec: "omitted when the vault is empty"), rather than sent
      // as `[]` -- matches this codebase's existing pattern of omitting
      // an empty optional array (e.g. v1's own optional fields) rather
      // than asserting its presence either way.
      ...(vaultManifest.length > 0 ? { vault: vaultManifest } : {}),
    };

    // ---- 5. C6 EGRESS ASSERTION (before every send/retry) ----
    const tAssert0 = now();
    const liveSensitiveRawValues = io.getLiveSensitiveRawValues ? io.getLiveSensitiveRawValues(scan.sensitiveNodes, scan.idMap) : [];
    try {
      assertEgressV2(semanticPayload, "semantic", rawValueRegistry, liveSensitiveRawValues);
    } catch (err) {
      timings.egressAssertMs = ms(tAssert0);
      pushStepResult({ error: "egress_assertion_failed", detail: err.message });
      outcome = "egress_assertion_failed";
      io.reportProgress && io.reportProgress({ stage: "egress-assert", lastError: { summary: err.message } });
      throw err; // C6: "Failure throws; the request never leaves." -- propagate, do not swallow.
    }
    timings.egressAssertMs = ms(tAssert0);
    io.reportProgress && io.reportProgress({ stage: "egress-assert", step, ok: true });

    // ---- 6. SEND ----
    const tSend0 = now();
    let sendResp = await io.sendAnalyze(semanticPayload);
    timings.sendMs = ms(tSend0);
    io.reportProgress && io.reportProgress({ stage: "send", step });

    if (!sendResp.ok) {
      pushStepResult({ error: "analyze_failed", status: sendResp.status, detail: sendResp.error });
      outcome = "analyze_failed";
      break;
    }

    let response = sendResp.body;
    let usedImageEscalation = false;

    // ---- 7. need_visual: at most once per step, same revision, image mode ----
    if (response.action === "need_visual" && !usedImageEscalation) {
      usedImageEscalation = true;
      const tRedact0 = now();
      // V4b: fold unscannable regions (dropped subframes, closed shadow
      // roots) into the SAME defensive-redaction policy v1 already applies
      // (content.js's own `defensiveUnscannableNodes` -- synthesized as
      // sensitiveNode-shaped entries, `piiType: "other"`, so redaction.js's
      // EXISTING, unmodified contract "redacts every domNode it's handed"
      // covers them with no change to that module). Without this, a
      // need_visual escalation would send an image where an unmerged
      // iframe or closed shadow host is NOT blacked out, even though the
      // semantic payload's own `regions` list (above) already told the
      // planner it was unscannable -- the image must not contradict that.
      const domNodesForRedact = scan.sensitiveNodes.concat(
        unscannableRegionsWithBbox.map((r) => ({ bbox: r.bbox, piiType: "other", selector: r.selector }))
      );
      const { redactedImage, redactedRegions } = await io.redact(
        captureResult.screenshotBase64,
        detectResult.boxes || [],
        domNodesForRedact,
        { scaleFactor: dpr }
      );
      timings.redactMs = ms(tRedact0);
      const imagePayload = { ...semanticPayload, mode: "image", image: redactedImage };
      try {
        assertEgressV2(imagePayload, "image", rawValueRegistry, liveSensitiveRawValues);
      } catch (err) {
        pushStepResult({ error: "egress_assertion_failed_image", detail: err.message });
        outcome = "egress_assertion_failed";
        throw err;
      }
      const tSendImg0 = now();
      const imageResp = await io.sendAnalyze(imagePayload);
      timings.sendImageMs = ms(tSendImg0);
      if (!imageResp.ok) {
        pushStepResult({ error: "analyze_failed_image", status: imageResp.status, detail: imageResp.error });
        outcome = "analyze_failed";
        break;
      }
      response = imageResp.body;
      if (response.action === "need_visual") {
        // Second need_visual in the same step -- cap at one escalation.
        // Not treated as a hard failure: skip acting this step, re-capture
        // fresh next step (mirrors RULING C's "skip and continue" posture).
        pushStepResult({ skipped: "need_visual_capped" });
        io.reportProgress && io.reportProgress({ stage: "response", lastError: { summary: "need_visual escalation capped at 1/step -- skipping this step's action" } });
        continue;
      }
      redactedRegions; // exposed for callers that want to log it; not otherwise consumed here.
    }

    io.reportProgress && io.reportProgress({ stage: "response", step, action: response.action, serverVerdict: response.serverVerdict });

    // ---- 8. POLICY: local decide() + tightenWithServer() ----
    const tPolicy0 = now();
    const resolvedElement =
      response.targetId === PAGE_TARGET_ID_V2 ? null : elements.find((e) => e.agentId === response.targetId) || null;

    const localDecision = decide({
      action: response,
      element: resolvedElement,
      scene: elements,
      currentRevision: revision,
      taskGoal: tokenizedTaskGoal,
      tokenValues: rawValueRegistry,
    });
    const tightened = tightenWithServer(localDecision, response.serverVerdict);
    timings.policyMs = ms(tPolicy0);

    io.reportProgress && io.reportProgress({ stage: "policy", step, verdict: tightened.verdict, code: tightened.code });

    let executedThisStep = false;

    if (tightened.verdict === "reject") {
      pushStepResult({ rejected: tightened.code, reason: tightened.reason });
      history.push({ action: { action: response.action, targetId: response.targetId, value: response.value }, outcome: `rejected:${tightened.code}` });
      outcome = tightened.code === POLICY_CODES.STALE_REVISION ? "stale_revision" : "rejected";
      break; // v1 semantics: a refusal ends the run (see this file's header note on GUARD_REFUSAL_CODES).
    }

    let approvedByConsent = false;
    if (tightened.verdict === "ask") {
      const tConsent0 = now();
      approvedByConsent = await io.requestConsent({
        code: tightened.code,
        reason: tightened.reason,
        elementDescription: resolvedElement ? resolvedElement.label || resolvedElement.tag || resolvedElement.agentId : "the whole page",
        // V4b (integration-v2, part B): the real consent panel (popup.js)
        // needs the actual pending action + target element to build its
        // plain-language description via action-describe.js's
        // describePendingAction() -- `elementDescription` above is kept
        // for back-compat (V4a's minimal window.confirm() plumbing already
        // consumed it), but the panel reads `action`/`element` instead.
        // `action` here is the SERVER'S response shape (still carrying a
        // TOKEN in `.value`, never rehydrated) -- describePendingAction()
        // is built to never print `.value` raw regardless, so this is safe
        // to pass through unmodified. `element` is the C5 scene element
        // (already tokenized `.label`), or null for a page-level action.
        action: { action: response.action, targetId: response.targetId, value: response.value, profileField: response.profileField, key: response.key },
        element: resolvedElement,
      });
      timings.consentMs = ms(tConsent0);
      if (!approvedByConsent) {
        const blockedCode = deniedOutcomeCode(tightened.code);
        pushStepResult({ blocked: blockedCode, reason: tightened.reason });
        history.push({ action: { action: response.action, targetId: response.targetId, value: response.value }, outcome: `asked-denied` });
        outcome = "blocked";
        break; // v1 semantics: SENSITIVE_TARGET_BLOCKED / IRREVERSIBLE_ACTION_BLOCKED end the run.
      }
    }

    // ---- 9. accept (or ask+approved): rehydrate + execute ----
    let rehydratedValue = null;
    if (typeof response.value === "string" && response.value.length > 0) {
      try {
        rehydratedValue = rehydrate(response.value, tokenMap);
      } catch (err) {
        if (err instanceof UnknownTokenError) {
          pushStepResult({ rejected: "UNKNOWN_TOKEN_LOCAL", reason: err.message });
          history.push({ action: { action: response.action, targetId: response.targetId, value: null }, outcome: "rejected:UNKNOWN_TOKEN_LOCAL" });
          outcome = "rejected";
          break;
        }
        throw err;
      }
    }

    const finalAction = {
      action: response.action,
      targetId: response.targetId,
      value: rehydratedValue,
      profileField: response.profileField || undefined,
      key: response.key || undefined,
      revision,
    };

    const tAct0 = now();
    try {
      const execResult = await io.executeAction(finalAction, scan.idMap, {
        // ORCHESTRATOR RULING 2026-09-25: action-executor.js's own
        // guardSensitive/guardIrreversible stay an INDEPENDENT second layer
        // (defence in depth), not a rubber stamp. They yield only to an
        // explicit user approval from the consent step above. If policy.js
        // said "accept" but the v1 guard still flags the target, the two
        // layers disagree and the action is refused (fail closed).
        onSensitiveTarget: () => approvedByConsent,
        onIrreversibleAction: () => approvedByConsent,
        getProfileValue: io.getProfileValue,
      });
      timings.actMs = ms(tAct0);
      executedThisStep = true;
      pushStepResult({ action: { action: response.action, targetId: response.targetId }, execResult });
    } catch (err) {
      timings.actMs = ms(tAct0);
      pushStepResult({ error: err && err.message, code: err && err.code });
      outcome = "act_failed";
      break;
    }

    if (response.targetId && response.targetId !== PAGE_TARGET_ID_V2) actedAgentIds.add(response.targetId);

    // History carries the TOKENIZED value the server actually sent
    // (response.value), NEVER rehydratedValue -- a raw value must never
    // enter `history`, which becomes part of every subsequent request body.
    history.push({ action: { action: response.action, targetId: response.targetId, value: response.value || null }, outcome: "ok" });
    while (history.length > MAX_HISTORY_V2) history.shift();

    // ---- C4 amendment (2026-09-28): deterministic task completion. Runs
    // after EVERY successful action (this point in the loop is reached
    // ONLY once io.executeAction() above has already resolved without
    // throwing) and before the next capture -- exactly the amendment's own
    // "after each successful action ... before the next capture" wording.
    // Annotates the CURRENT step's already-pushed stepResults entry (from
    // the pushStepResult() call inside the try block above) rather than
    // pushing a new one, so `steps`/`stepResults.length` still count real
    // capture/detect/act cycles, not this early-exit check. See
    // policy.js's isGoalTokenComplete() for the exact 3 rules -- this is a
    // pure boolean read of data already collected; it cannot construct or
    // influence an action, so it cannot weaken any safety rule (V2
    // invariant 2).
    if (isGoalTokenComplete({ tokenizedGoal: tokenizedTaskGoal, rawGoal: rawTaskGoal, history })) {
      const lastStep = stepResults[stepResults.length - 1];
      if (lastStep) {
        lastStep.code = POLICY_CODES.GOAL_TOKENS_COMPLETE;
        lastStep.reason = "all goal value tokens rehydrated via a successful type this run; raw goal expresses no click intent";
      }
      outcome = "done";
      break;
    }

    if (response.action === "done") {
      outcome = "done";
      break;
    }

    if (executedThisStep) {
      actionSignatureHistory.push(`${response.action}:${response.targetId}:${response.value || ""}`);
      if (io.detectStall) {
        const stall = io.detectStall(actionSignatureHistory);
        if (stall) {
          outcome = "stalled";
          pushStepResult({ stalled: stall });
          break;
        }
      }
    }
  }

  return {
    outcome,
    steps: stepResults.length,
    stepResults,
    staleCaptureCount,
    revision: lastRevision,
    vaultTokens,
  };
}
