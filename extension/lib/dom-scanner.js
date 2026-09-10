// SIH 26171 -- Phase 2a (dom-pii-scanner)
//
// Pure-function DOM PII scanner. Contract (CLAUDE.md Section 4, Phase 2a):
//
//   { "sensitiveNodes": [
//     { "selector": "#pw", "bbox": {"x":0,"y":0,"w":0,"h":0}, "piiType": "password", "agentId": "agent-1" }
//   ]}
//
// `piiType` is the CLOSED vocabulary fixed by server/schemas.py::PiiType:
// password, cc-number, current-password, email, tel, aadhaar, pan, other.
// See PII_TYPES below -- keep it byte-for-byte in sync with schemas.py.
//
// ARCHITECTURE, per this module's role definition:
//   - scanForPii() is a PURE FUNCTION: (Document, options) -> plain object.
//     No `document`/`window` globals are read implicitly and nothing here
//     imports a DOM-parsing library -- it operates on whatever Document-like
//     object it is handed. That means it runs unmodified:
//       (a) as a real MV3 content script, called with the page's live
//           `document`, once Phase 4 wires it into content.js; and
//       (b) under plain Node in unit tests, called with a jsdom-parsed
//           Document (see tests/unit/test_dom_scanner.mjs) -- jsdom itself
//           is a TEST-ONLY dependency, never imported from this file.
//   - bbox acquisition is injectable via `options.getBBox(element)`. The
//     default calls `element.getBoundingClientRect()`. In jsdom (no
//     layout engine) that always returns zeros -- fixtures in this repo
//     assert on *detection and classification*, never on real pixel
//     geometry. Real bbox values are UNVERIFIED outside an actual browser;
//     that verification has to happen once this is wired into content.js
//     and loaded in Chrome (Phase 4 / integration).
//   - agentId acquisition is injectable via `options.getAgentId(element,
//     ordinal)`. Default: reuse an existing `data-agent-id` attribute if
//     Phase 3 (action-executor) already stamped the element; otherwise
//     synthesize "agent-<n>" in document order. See the CONTRACT NOTE
//     below -- this is a flagged ambiguity, not a silent assumption.
//
// CONTRACT NOTE -- agentId provenance (flagged for the orchestrator):
//   CLAUDE.md's Phase 1 RESULT says Phase 3 (action-executor) is the
//   producer of the ID->element map that `domSnapshot` is built from, and
//   that Phase 2a "classifies" while Phase 3 "enumerates". But Phase 2a's
//   OWN contract (Section 4) independently requires an `agentId` field on
//   every sensitiveNodes entry, with the literal example "agent-1". Since
//   Phase 2a can run standalone (unit tests, or a content-script pass that
//   fires before action-executor has stamped the DOM), this module cannot
//   assume `data-agent-id` attributes already exist. Resolution implemented
//   here: prefer an existing `data-agent-id` attribute when present (so if
//   Phase 4 runs action-executor's stamping pass BEFORE this scanner, IDs
//   line up automatically with zero extra wiring); otherwise self-assign
//   "agent-<n>" in document order as a fallback so the contract's required
//   field is never missing. Phase 4 should confirm/override this ordering
//   choice when it wires the real pipeline together.
//
// CONTRACT NOTE -- "new-password" and cc-adjacent autocomplete tokens:
//   The HTML autocomplete spec and this module's own task description both
//   name "new-password" as a token to detect, but server/schemas.py's
//   PiiType enum has no NEW_PASSWORD member (only CURRENT_PASSWORD and the
//   generic PASSWORD). Per the explicit instruction "never silently drop
//   an unrecognised type -- degrade it to `other`", autocomplete="new-password"
//   (when not co-located with type=password, which would independently
//   classify as "password") degrades to PII_TYPES.OTHER rather than being
//   invented as a new enum value or silently merged into "password". Same
//   treatment for credit-card-adjacent-but-not-cc-number tokens (cc-csc,
//   cc-exp, cc-exp-month, cc-exp-year, cc-name, ...): flagged as OTHER, not
//   dropped, not mislabeled cc-number. See AUTOCOMPLETE_OTHER_TOKENS below
//   and the full writeup in the report back to the orchestrator.
//
// VISIBILITY: CLAUDE.md's Phase 2a scope line reads "...and regex-matches
// *visible* text nodes for email/phone/Aadhaar/PAN patterns" -- the
// "visible" qualifier is grammatically attached only to the text-node
// regex pass. Form-field detection (type=password, autocomplete) is
// therefore NOT gated on visibility here: a `display:none` password field
// (e.g. a client-side-toggled "confirm password" field) can still hold a
// raw value that Phase 2b's DOM-JSON-stripping step must strip before
// `domSnapshot` is ever serialized, even though there is nothing to redact
// in the screenshot itself (its bbox will simply come back {0,0,0,0} from
// getBoundingClientRect, which is harmless -- redaction just draws nothing
// there). Text-node regex matching DOES honor visibility, matching the
// literal contract text and avoiding flagging content a user never sees
// (and that therefore never appears in the screenshot needing redaction).
//
// VALUE/PLACEHOLDER SCANNING (added in retry 1, orchestrator-caught gap):
//   The original version of this module ran the regex battery over DOM
//   text nodes only. That misses the single most common real-world case:
//   an autofilled or pre-populated `<input>`/`<textarea>` whose `.value`
//   is PII-shaped but sits in NEITHER a `type=password` field NOR a
//   PII-relevant `autocomplete` attribute -- e.g.
//     <input type="text" name="id_number" value="1234 5678 9012">
//   has no type/autocomplete signal at all, and its value is a property,
//   not a Text node, so the original text-node walk never saw it. This is
//   now covered: every input/textarea's `.value` AND `placeholder`
//   attribute, plus a `<select>`'s selected-option visible text, are run
//   through the SAME regex battery as text nodes (see
//   getFieldValueSources() / scanForPii()'s field loop, "1b").
//
//   `value` and `placeholder` are semantically different (a populated
//   value is real user/autofilled data; a placeholder is usually a UI
//   hint, sometimes literally a fake example like "e.g. ABCDE1234F") but
//   BOTH are flagged identically here, on purpose: this module's policy is
//   recall-first, and a developer can and does leak a real value into a
//   placeholder by mistake. A benign example placeholder gets swept up
//   too -- intentional over-flagging, exercised explicitly by
//   tests/fixtures/dom_scanner_benign_example_placeholder.html.
//
//   CONTRACT GAP, flagged not invented around: the fixed sensitiveNodes
//   shape ({selector, bbox, piiType, agentId}) has no field to say WHICH
//   of value/placeholder/text-node/select-option triggered a given entry.
//   Adding one (e.g. a `source` field) would be a contract change this
//   module isn't authorized to make unilaterally, so it is NOT added --
//   both are flagged under the existing shape, and this limitation is
//   reported rather than silently worked around. If Phase 4 needs the
//   distinction (e.g. to only treat `value` as "must strip", not
//   `placeholder`), that needs an explicit contract decision upstream.

// ---------------------------------------------------------------------------
// Closed PII-type vocabulary -- MUST mirror server/schemas.py::PiiType
// exactly (kebab-case string values). tests/unit/test_dom_scanner.mjs has a
// drift-guard test that hardcodes the expected value set from schemas.py;
// if you change this object, also update that test and cross-check
// schemas.py, or the enums will silently diverge across the Python/JS
// language boundary (no shared import is possible between them).
// ---------------------------------------------------------------------------
export const PII_TYPES = Object.freeze({
  PASSWORD: "password",
  CC_NUMBER: "cc-number",
  CURRENT_PASSWORD: "current-password",
  EMAIL: "email",
  TEL: "tel",
  AADHAAR: "aadhaar",
  PAN: "pan",
  OTHER: "other",
});

const ALL_PII_TYPE_VALUES = Object.freeze(Object.values(PII_TYPES));

// ---------------------------------------------------------------------------
// Field-level classification: input[type], autocomplete tokens.
// ---------------------------------------------------------------------------

// autocomplete's field-name token is always the LAST space-separated token
// in the attribute value (the spec allows optional leading section-*/
// shipping|billing/contact-type tokens before it), so callers must split on
// whitespace and take the last token -- never string-match the raw
// attribute value as a whole.
const AUTOCOMPLETE_EXACT_MAP = Object.freeze({
  "current-password": PII_TYPES.CURRENT_PASSWORD,
  // Not a real autocomplete spec token, but seen in the wild on informally
  // authored forms; harmless to treat the same as type=password.
  "password": PII_TYPES.PASSWORD,
  "cc-number": PII_TYPES.CC_NUMBER,
  "email": PII_TYPES.EMAIL,
  "tel": PII_TYPES.TEL,
  "tel-national": PII_TYPES.TEL,
  "tel-country-code": PII_TYPES.TEL,
  "tel-area-code": PII_TYPES.TEL,
  "tel-local": PII_TYPES.TEL,
  "tel-local-prefix": PII_TYPES.TEL,
  "tel-local-suffix": PII_TYPES.TEL,
  "tel-extension": PII_TYPES.TEL,
});

// Tokens that ARE sensitive/PII-adjacent but have no exact PiiType match.
// Degrade to OTHER (flagged, redacted, unclassified) per the explicit
// "never silently drop" instruction -- see the CONTRACT NOTE at the top of
// this file for the reasoning on "new-password" specifically.
const AUTOCOMPLETE_OTHER_TOKENS = new Set([
  "new-password",
  "cc-csc",
  "cc-exp",
  "cc-exp-month",
  "cc-exp-year",
  "cc-name",
  "cc-given-name",
  "cc-additional-name",
  "cc-family-name",
  "cc-type",
]);

function classifyByAutocomplete(el) {
  const raw = el.getAttribute && el.getAttribute("autocomplete");
  if (!raw) return null;
  const tokens = raw.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const last = tokens[tokens.length - 1];
  if (Object.prototype.hasOwnProperty.call(AUTOCOMPLETE_EXACT_MAP, last)) {
    return AUTOCOMPLETE_EXACT_MAP[last];
  }
  if (AUTOCOMPLETE_OTHER_TOKENS.has(last)) return PII_TYPES.OTHER;
  return null;
}

function classifyByInputType(el) {
  const type = (el.getAttribute && el.getAttribute("type")) || "";
  switch (type.toLowerCase()) {
    case "password":
      return PII_TYPES.PASSWORD;
    case "email":
      return PII_TYPES.EMAIL;
    case "tel":
      return PII_TYPES.TEL;
    default:
      return null;
  }
}

/**
 * Classify one form-field-like element (input/textarea/select).
 * Priority, most-specific-signal-wins:
 *   1. autocomplete token with an EXACT PiiType match (e.g. "current-password"
 *      beats a plain type=password on the same element -- it's strictly
 *      more informative).
 *   2. input[type] literal signal (password/email/tel).
 *   3. autocomplete token in the sensitive-but-unmapped bucket -> OTHER.
 * Returns a PII_TYPES value or null (not classified as sensitive).
 */
function classifyField(el) {
  const byAutocompleteExact = classifyByAutocomplete(el);
  if (byAutocompleteExact && byAutocompleteExact !== PII_TYPES.OTHER) {
    return byAutocompleteExact;
  }
  const byType = classifyByInputType(el);
  if (byType) return byType;
  if (byAutocompleteExact === PII_TYPES.OTHER) return PII_TYPES.OTHER;
  return null;
}

// ---------------------------------------------------------------------------
// Text-node regex classification.
//
// KNOWN WEAKNESSES (deliberately not "fixed" -- see report to orchestrator,
// false negatives are the dangerous direction here per CLAUDE.md Section 5
// and this module's task description):
//   - AADHAAR_RE flags ANY bare/grouped 12-digit number. It cannot tell an
//     Aadhaar number apart from a 12-digit order ID, invoice number,
//     timestamp, or a phone number concatenated with an extension. This is
//     an intentional over-flag; see PHASE 2a REPORT for the explicit
//     false-positive-trap fixture that demonstrates and documents it.
//   - PHONE_RE is India-context-tuned (matches this project's Aadhaar/PAN
//     scope): it requires either a leading "+" (international) or a bare
//     10-digit run starting 6-9 (Indian mobile range). A 10-digit number in
//     another country's format with no distinguishing prefix will NOT be
//     flagged -- an accepted false negative outside the India context this
//     tool targets.
//   - PAN_RE is case-insensitive (5 letters + 4 digits + 1 letter) even
//     though real PANs are issued uppercase-only; case-insensitivity is a
//     deliberate false-negative-averse choice, not an oversight.
//   - None of these patterns attempt checksum/format validation (e.g. PAN's
//     4th character encoding holder type, Aadhaar's Verhoeff checksum digit)
//     -- that would cut false positives but risks false negatives on
//     legitimately-formatted-but-checksum-edge-case values, which this
//     module is instructed to avoid.
//   - FIXED (retry 1): this battery now also runs over input/textarea
//     value+placeholder and select's selected-option text, not just DOM
//     text nodes -- see VALUE/PLACEHOLDER SCANNING at the top of the file.
//     An autofilled PII-shaped value with no type=password/autocomplete
//     signal was previously an unflagged false negative; it no longer is.
// ---------------------------------------------------------------------------

const EMAIL_RE =
  /[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/i;

// Bare 12 digits OR three groups of 4 digits separated by space/hyphen.
// \b boundaries mean a 12-digit substring embedded in a LONGER unbroken
// digit run (e.g. a 16-digit card-shaped number) will NOT match the bare
// branch -- see the module header for what this heuristic does and does
// not catch.
const AADHAAR_RE = /\b\d{4}[\s-]\d{4}[\s-]\d{4}\b|\b\d{12}\b/;

// 5 letters + 4 digits + 1 letter, case-insensitive.
const PAN_RE = /\b[a-z]{5}[0-9]{4}[a-z]\b/i;

// India-context: +91-prefixed or bare 10-digit starting 6-9, OR a generic
// "+<country code> ..." international-looking number.
const PHONE_RE =
  /(?:\+91[\s-]?)?\b[6-9]\d{9}\b|\+\d{1,3}[\s-]?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b/;

// Order matters only for readability/debugging (every rule that matches is
// reported -- there is no "first match wins" short-circuit), but declared
// in most-specific-to-least-specific order.
const TEXT_REGEX_RULES = Object.freeze([
  { piiType: PII_TYPES.EMAIL, pattern: EMAIL_RE },
  { piiType: PII_TYPES.PAN, pattern: PAN_RE },
  { piiType: PII_TYPES.AADHAAR, pattern: AADHAAR_RE },
  { piiType: PII_TYPES.TEL, pattern: PHONE_RE },
]);

function findTextRegexMatches(text) {
  const found = [];
  for (const { piiType, pattern } of TEXT_REGEX_RULES) {
    if (pattern.test(text)) found.push(piiType);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Value/placeholder source extraction -- see VALUE/PLACEHOLDER SCANNING note
// at top of file. Returns raw strings to run through findTextRegexMatches();
// deliberately does NOT tag which string came from which attribute (value
// vs placeholder vs selected-option text) -- see the CONTRACT GAP note
// above for why that distinction isn't threaded through to the output.
//
// Deliberately NOT gated on isElementVisible(): a `display:none` field's
// value is exactly the "still strip it from domSnapshot even though
// there's nothing on-screen to redact" case already established for
// type=password (see the VISIBILITY note above) -- same reasoning applies
// to an autofilled value hidden behind a toggle.
// ---------------------------------------------------------------------------

function getFieldValueSources(el) {
  const sources = [];
  if (el.tagName === "SELECT") {
    const selected =
      el.options && el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;
    if (selected && selected.textContent && selected.textContent.trim()) {
      sources.push(selected.textContent);
    }
    return sources;
  }
  const value = typeof el.value === "string" ? el.value : "";
  if (value) sources.push(value);
  const placeholder = (el.getAttribute && el.getAttribute("placeholder")) || "";
  if (placeholder) sources.push(placeholder);
  return sources;
}

// ---------------------------------------------------------------------------
// Visibility (text nodes only -- see VISIBILITY note at top of file).
// ---------------------------------------------------------------------------

function isElementVisible(el) {
  let node = el;
  while (node && node.nodeType === 1) {
    if (node.hidden === true) return false;
    if (node.getAttribute) {
      const ariaHidden = node.getAttribute("aria-hidden");
      if (ariaHidden && ariaHidden.toLowerCase() === "true") return false;
      if (
        node.tagName === "INPUT" &&
        (node.getAttribute("type") || "").toLowerCase() === "hidden"
      ) {
        return false;
      }
      const inlineStyle = node.getAttribute("style");
      if (inlineStyle && /display\s*:\s*none/i.test(inlineStyle)) return false;
      if (inlineStyle && /visibility\s*:\s*hidden/i.test(inlineStyle)) return false;
    }
    node = node.parentElement;
  }
  // Best-effort secondary check via computed style, for stylesheet-driven
  // (not inline) hidden text. Wrapped defensively: some minimal DOM shims
  // don't implement getComputedStyle at all, and that must never crash the
  // scanner (a crash here is a worse false negative than skipping this
  // check).
  try {
    const view = el.ownerDocument && el.ownerDocument.defaultView;
    if (view && typeof view.getComputedStyle === "function") {
      const cs = view.getComputedStyle(el);
      if (cs && (cs.display === "none" || cs.visibility === "hidden")) return false;
    }
  } catch (_err) {
    /* best effort only -- ignore and fall through to visible */
  }
  return true;
}

// ---------------------------------------------------------------------------
// Selector generation.
// ---------------------------------------------------------------------------

function cssEscapeIdent(value) {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value);
  return String(value).replace(/([ #.;:>+~^$|*[\]()='"\\])/g, "\\$1");
}

/**
 * Build a CSS selector for `el`. Prefers `#id` (matches the contract's own
 * example, "#pw"); otherwise walks up building an nth-of-type structural
 * path, stopping at the first ancestor with an id (or at <html>). This is a
 * pragmatic "good enough to re-locate the element" selector, not a
 * globally-unique-selector solver -- dynamically reordered siblings between
 * scan time and redaction time could in principle invalidate it. Acceptable
 * for this module's scope; flagged here rather than silently assumed.
 */
export function computeSelector(el) {
  if (!el || el.nodeType !== 1) return "";
  if (el.id) return "#" + cssEscapeIdent(el.id);

  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && node.tagName !== "HTML") {
    if (node.id) {
      parts.unshift("#" + cssEscapeIdent(node.id));
      break;
    }
    const tag = node.tagName.toLowerCase();
    const parent = node.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const sameTagSiblings = Array.from(parent.children).filter(
      (c) => c.tagName === node.tagName
    );
    if (sameTagSiblings.length > 1) {
      const idx = sameTagSiblings.indexOf(node) + 1;
      parts.unshift(`${tag}:nth-of-type(${idx})`);
    } else {
      parts.unshift(tag);
    }
    node = parent;
  }
  return parts.join(" > ");
}

// ---------------------------------------------------------------------------
// bbox / agentId defaults (both injectable -- see ARCHITECTURE note above).
// ---------------------------------------------------------------------------

function defaultGetBBox(el) {
  if (!el || typeof el.getBoundingClientRect !== "function") {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  const rect = el.getBoundingClientRect();
  return {
    x: rect.x ?? rect.left ?? 0,
    y: rect.y ?? rect.top ?? 0,
    w: rect.width ?? 0,
    h: rect.height ?? 0,
  };
}

function defaultGetAgentId(_el, ordinal) {
  return `agent-${ordinal}`;
}

// ---------------------------------------------------------------------------
// Text-node collection (skips script/style/template/noscript/title subtrees;
// TreeWalker NodeFilter constants hardcoded -- SHOW_TEXT=4, FILTER_ACCEPT=1,
// FILTER_REJECT=2 -- these are standardized DOM values, safe without a
// `NodeFilter` global reference, which this module deliberately never
// touches so it stays free of any implicit global/window dependency).
// ---------------------------------------------------------------------------

const SKIP_TEXT_ANCESTOR_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TITLE"]);

function collectCandidateTextNodes(doc) {
  const root = doc.body || doc.documentElement || doc;
  if (!root || typeof doc.createTreeWalker !== "function") return [];

  const SHOW_TEXT = 4;
  const FILTER_ACCEPT = 1;
  const FILTER_REJECT = 2;

  const walker = doc.createTreeWalker(root, SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return FILTER_REJECT;
      if (SKIP_TEXT_ANCESTOR_TAGS.has(parent.tagName)) return FILTER_REJECT;
      if (!node.textContent || !node.textContent.trim()) return FILTER_REJECT;
      return FILTER_ACCEPT;
    },
  });

  const out = [];
  let n = walker.nextNode();
  while (n) {
    out.push(n);
    n = walker.nextNode();
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/**
 * Scan a Document (or any Document-like object exposing querySelectorAll /
 * createTreeWalker / body) for sensitive nodes.
 *
 * @param {Document} doc
 * @param {object} [options]
 * @param {(el: Element) => {x:number,y:number,w:number,h:number}} [options.getBBox]
 *   Injectable bbox source. Defaults to getBoundingClientRect(), which is
 *   ALWAYS {0,0,0,0} under jsdom (no layout engine) -- inject a stub in
 *   tests that need to assert on bbox shape, and never trust jsdom's
 *   geometry as a proxy for real-browser output.
 * @param {(el: Element, ordinal: number) => string} [options.getAgentId]
 *   Injectable agentId source for elements with no existing
 *   `data-agent-id` attribute. Defaults to "agent-<ordinal>" in document
 *   order. See the CONTRACT NOTE at the top of this file.
 * @returns {{ sensitiveNodes: Array<{selector:string, bbox:{x:number,y:number,w:number,h:number}, piiType:string, agentId:string}> }}
 */
export function scanForPii(doc, options = {}) {
  if (!doc || typeof doc.querySelectorAll !== "function") {
    throw new TypeError("scanForPii(doc, options): doc must be a Document-like object exposing querySelectorAll");
  }

  const getBBox = options.getBBox || defaultGetBBox;
  const getAgentId = options.getAgentId || defaultGetAgentId;

  const results = [];
  const seenKeys = new Set();
  let ordinal = 0;

  function resolveAgentId(el) {
    const existing = el.getAttribute && el.getAttribute("data-agent-id");
    if (existing) return existing;
    ordinal += 1;
    return getAgentId(el, ordinal);
  }

  function addNode(el, piiType) {
    if (!ALL_PII_TYPE_VALUES.includes(piiType)) {
      // Defensive: this module only ever produces values from PII_TYPES
      // itself, so this branch should be unreachable. If a future edit
      // introduces a stray literal, degrade rather than emit an
      // out-of-vocabulary value into the contract.
      piiType = PII_TYPES.OTHER;
    }
    const selector = computeSelector(el);
    const key = `${selector}::${piiType}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    results.push({
      selector,
      bbox: getBBox(el),
      piiType,
      agentId: resolveAgentId(el),
    });
  }

  // --- 1. Form-field detection (NOT visibility-gated -- see header note).
  const fields = doc.querySelectorAll("input, textarea, select");
  fields.forEach((el) => {
    const piiType = classifyField(el);
    if (piiType) addNode(el, piiType);

    // --- 1b. Regex battery over value/placeholder/selected-option text --
    // see VALUE/PLACEHOLDER SCANNING note at top of file. Independent of
    // (and additive to) the type/autocomplete classification above: a
    // field can be flagged via both paths, or via this path alone (e.g.
    // an autofilled Aadhaar-shaped value in a plain type=text input with
    // no autocomplete attribute at all).
    getFieldValueSources(el).forEach((text) => {
      findTextRegexMatches(text).forEach((matchedPiiType) => addNode(el, matchedPiiType));
    });
  });

  // --- 2. Visible-text-node regex detection.
  const textNodes = collectCandidateTextNodes(doc);
  textNodes.forEach((textNode) => {
    const parent = textNode.parentElement;
    if (!parent) return;
    if (!isElementVisible(parent)) return;
    const matches = findTextRegexMatches(textNode.textContent);
    matches.forEach((piiType) => addNode(parent, piiType));
  });

  return { sensitiveNodes: results };
}
