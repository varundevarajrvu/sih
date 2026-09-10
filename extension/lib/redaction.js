/**
 * Phase 2b — redaction-engine (CLAUDE.md Section 4).
 *
 * Pure, dependency-injected, testable functions. No `chrome.*` API and no
 * concrete canvas/image implementation is imported here — everything that
 * touches a real canvas or a real image decoder is passed in by the
 * caller (or falls back to browser-native globals when present). This is
 * what lets the whole module be unit-tested under plain Node with
 * `node --test`, with no extension runtime required.
 *
 * LITERAL CONTRACT (CLAUDE.md Section 4, Phase 2b):
 *   redact(screenshotBase64, visionBoxes, domNodes)
 *     -> { redactedImage: base64, redactedRegions: [{type, bbox}] }
 *
 * `redact()` below implements exactly that 3-positional-argument shape,
 * plus an optional 4th `options` argument for dependency injection
 * (canvas factory, image loader, scale factor, fill style). The literal
 * contract is unchanged for a caller that doesn't pass `options`.
 *
 * ---------------------------------------------------------------------
 * COORDINATE-SPACE HAZARD (read this before touching scaling logic)
 * ---------------------------------------------------------------------
 * `visionBoxes` (Phase 0/1 contract: {label, score, xmin, ymin, xmax,
 * ymax}) are produced by running detection directly on the captured
 * screenshot image, so they are ALREADY in that image's own pixel space
 * — the same space as the canvas this module draws on. They are used
 * AS-IS, never scaled.
 *
 * `domNodes` bboxes ({x, y, w, h}) are sourced from
 * `getBoundingClientRect()` (Phase 2a's contract), which reports CSS
 * pixels. On a HiDPI display (devicePixelRatio > 1), a screenshot
 * captured via `chrome.tabs.captureVisibleTab` is captured at physical
 * (device) pixel resolution, so CSS-pixel DOM boxes are SMALLER than
 * where they actually need to land on that screenshot by exactly
 * `devicePixelRatio`. If this scaling is skipped, redaction rectangles
 * silently land in the wrong place/size on any HiDPI machine — a
 * privacy failure that still looks like it worked (image gets PNG bytes
 * back, tests pass on a 1x fixture, and the box is just... wrong).
 *
 * This module NEVER assumes devicePixelRatio. The caller must pass it
 * explicitly as `options.scaleFactor` (e.g. `window.devicePixelRatio` in
 * the real extension). Default is `1` (no scaling) — correct only when
 * the screenshot and the DOM's CSS pixel space already agree, e.g. a
 * standard-DPI display, or a caller that pre-scaled bboxes itself.
 * `buildRedactedRegions` throws if given a non-positive/non-finite scale
 * factor rather than silently coercing it, because a silently-wrong
 * scale factor is exactly the failure mode this hazard is about.
 *
 * Scaling is applied EXACTLY ONCE, inside `buildRedactedRegions`, before
 * the bbox is used for anything else (drawing or returned metadata).
 * `redactedRegions` is therefore reported in the screenshot's own pixel
 * space for every entry (vision- and DOM-sourced alike) — the same
 * space as the accompanying redacted image — so a human or the VLM can
 * directly correlate a redactedRegions bbox to a rectangle in the
 * image. See the CONTRACT GAP note near `normalizePiiType` for a
 * caveat this creates against `domSnapshot`'s own (unconfirmed) bbox
 * units.
 */

// ---------------------------------------------------------------------------
// PII type vocabulary — mirrors server/schemas.py::PiiType exactly. This is
// a read-only client-side mirror; server/ is owned by Phase 2c, not edited
// here. Keep in sync manually if that enum ever changes.
// ---------------------------------------------------------------------------

export const KNOWN_PII_TYPES = Object.freeze([
  "password",
  "cc-number",
  "current-password",
  "email",
  "tel",
  "aadhaar",
  "pan",
  "other",
]);

const KNOWN_PII_TYPE_SET = new Set(KNOWN_PII_TYPES);

const DEFAULT_FILL_STYLE = "#000000";

/**
 * Thrown only for static, value-free "this environment has no canvas/image
 * API and no DI was provided" configuration errors (from
 * defaultCanvasFactory / defaultImageLoader). Distinguished from generic
 * runtime failures so paintRegionsOnImage can let this one pass through
 * with its helpful message intact, while still generically wrapping (and
 * thereby scrubbing) any error that might have originated from actually
 * processing the caller's image bytes (see the error-path-is-a-data-egress-
 * path lesson at the top of this file).
 */
class EnvironmentUnsupportedError extends Error {}

/**
 * Normalize an arbitrary incoming type label (a vision detector class
 * label like "cell phone", or a DOM scanner's `piiType` like "password")
 * into the server's closed PiiType vocabulary.
 *
 * Mirrors server/schemas.py's `RedactedRegion._degrade_unknown_type_to_other`
 * model_validator so the client-side and server-side degrade decisions
 * agree: unrecognized values degrade to "other" with the original string
 * preserved as `rawType`, never dropped and never a hard failure.
 *
 * CONTRACT GAP, flagged not invented: Phase 0's detector
 * (`Xenova/yolos-tiny`) is a general COCO object detector ("person",
 * "cell phone", "couch", ...), not a PII-specific classifier. Every
 * label it produces degrades to `{type: "other", rawType: <label>}"
 * here — this module does NOT filter or judge which detected classes
 * are "privacy sensitive"; it redacts every box it is handed,
 * unconditionally, per its literal "merge both sets, draw a rect over
 * each region" contract. If only a subset of detections should be
 * treated as sensitive, that filtering must happen upstream (Phase 4)
 * before calling `redact()` — see the report to the orchestrator.
 *
 * @param {unknown} rawType
 * @returns {{ type: string, rawType: string | undefined }}
 */
export function normalizePiiType(rawType) {
  if (typeof rawType === "string" && KNOWN_PII_TYPE_SET.has(rawType)) {
    return { type: rawType, rawType: undefined };
  }
  return {
    type: "other",
    rawType: rawType === null || rawType === undefined ? undefined : String(rawType),
  };
}

// ---------------------------------------------------------------------------
// Internal bbox helpers
// ---------------------------------------------------------------------------

function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function scaleBBox(bbox, scaleFactor) {
  return {
    x: bbox.x * scaleFactor,
    y: bbox.y * scaleFactor,
    w: bbox.w * scaleFactor,
    h: bbox.h * scaleFactor,
  };
}

/** Vision box {xmin,ymin,xmax,ymax} -> {x,y,w,h}. Tolerant of swapped min/max. */
function visionBoxToBBox(box) {
  const xmin = Math.min(box.xmin, box.xmax);
  const xmax = Math.max(box.xmin, box.xmax);
  const ymin = Math.min(box.ymin, box.ymax);
  const ymax = Math.max(box.ymin, box.ymax);
  return { x: xmin, y: ymin, w: xmax - xmin, h: ymax - ymin };
}

function isUsableVisionBox(box) {
  return (
    box &&
    isFiniteNumber(box.xmin) &&
    isFiniteNumber(box.ymin) &&
    isFiniteNumber(box.xmax) &&
    isFiniteNumber(box.ymax)
  );
}

function isUsableDomBBox(bbox) {
  return (
    bbox &&
    isFiniteNumber(bbox.x) &&
    isFiniteNumber(bbox.y) &&
    isFiniteNumber(bbox.w) &&
    isFiniteNumber(bbox.h)
  );
}

function validateScaleFactor(scaleFactor) {
  if (!isFiniteNumber(scaleFactor) || scaleFactor <= 0) {
    throw new Error(
      "redaction.js: scaleFactor must be a positive finite number (e.g. window.devicePixelRatio). " +
        "Refusing to silently default an invalid value — a wrong scale factor misplaces redaction " +
        "rectangles without any visible error."
    );
  }
}

// ---------------------------------------------------------------------------
// Half 1a — pure region merge/normalize (no canvas needed at all)
// ---------------------------------------------------------------------------

/**
 * Merge Phase 0's vision boxes and Phase 2a's flagged DOM nodes into the
 * `redactedRegions` metadata array from the Phase 2b contract. Pure
 * function, no canvas/image I/O — independently unit-testable.
 *
 * @param {Array<{label?: string, xmin: number, ymin: number, xmax: number, ymax: number}>} visionBoxes
 *   Phase 0/1 contract shape. Already in screenshot pixel space.
 * @param {Array<{bbox?: {x:number,y:number,w:number,h:number}, piiType?: string, type?: string, agentId?: string}>} domNodes
 *   Phase 2a's flagged/sensitive node list (sensitiveNodes), CSS pixel bboxes.
 * @param {{ scaleFactor?: number }} [options]
 *   scaleFactor: CSS-px -> screenshot-px multiplier (typically
 *   devicePixelRatio). Applied to domNodes only; visionBoxes are never
 *   scaled. Defaults to 1 — see the coordinate-space hazard note at the
 *   top of this file.
 * @returns {Array<{type: string, rawType?: string, bbox: {x:number,y:number,w:number,h:number}, agentId?: string}>}
 */
export function buildRedactedRegions(visionBoxes = [], domNodes = [], options = {}) {
  const { scaleFactor = 1 } = options;
  validateScaleFactor(scaleFactor);

  const regions = [];

  for (const box of Array.isArray(visionBoxes) ? visionBoxes : []) {
    if (!isUsableVisionBox(box)) continue; // malformed box: nothing usable to draw, skip rather than crash the whole batch
    const bbox = visionBoxToBBox(box);
    const { type, rawType } = normalizePiiType(box.label);
    const region = { type, bbox };
    if (rawType !== undefined) region.rawType = rawType;
    // Vision-only regions legitimately have no agentId — left absent, not invented.
    regions.push(region);
  }

  for (const node of Array.isArray(domNodes) ? domNodes : []) {
    if (!node || !isUsableDomBBox(node.bbox)) continue; // no usable bbox: nothing to draw here (its text is still stripped separately by sanitizeDomSnapshot)
    const bbox = scaleBBox(node.bbox, scaleFactor);
    const { type, rawType } = normalizePiiType(node.piiType ?? node.type);
    const region = { type, bbox };
    if (rawType !== undefined) region.rawType = rawType;
    if (typeof node.agentId === "string" && node.agentId.length > 0) {
      region.agentId = node.agentId; // DOM-sourced region: include agentId for server-side two-way correlation
    }
    regions.push(region);
  }

  return regions;
}

// ---------------------------------------------------------------------------
// Half 1b — canvas drawing (dependency-injected)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} RedactionCanvas
 * @property {() => any} getContext2D - returns a 2D context supporting
 *   `drawImage` and `fillStyle`/`fillRect`.
 * @property {() => (string | Promise<string>)} toPNGBase64 - PNG bytes,
 *   base64-encoded, with NO "data:" prefix (matches this codebase's
 *   established wire-format convention, see Phase 1's DETECT_OBJECTS
 *   ruling: "imageData is raw base64 with NO data: prefix on the wire").
 */

function stripDataUrlPrefix(input) {
  const match = /^data:[^;,]*;base64,([\s\S]*)$/.exec(input);
  return match ? match[1] : input;
}

function base64ToUint8Array(base64) {
  if (typeof atob === "function") {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  // eslint-disable-next-line no-undef -- Node path only, Buffer is a global there
  return new Uint8Array(Buffer.from(base64, "base64"));
}

function arrayBufferToBase64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (typeof btoa === "function") {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  // eslint-disable-next-line no-undef -- Node path only
  return Buffer.from(bytes).toString("base64");
}

/**
 * Browser-native default canvas factory: OffscreenCanvas (works in the
 * offscreen document / workers) if available, else a real DOM canvas.
 * No default exists for Node — tests (and any other Node caller) MUST
 * inject a canvasFactory (e.g. backed by @napi-rs/canvas). This is a
 * deliberate dependency-injection boundary, not an oversight: production
 * code never needs a Node canvas, and the module has zero canvas
 * dependency in package.json as a result.
 */
async function defaultCanvasFactory(width, height) {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    return {
      getContext2D: () => canvas.getContext("2d"),
      toPNGBase64: async () => {
        const blob = await canvas.convertToBlob({ type: "image/png" });
        const buf = await blob.arrayBuffer();
        return arrayBufferToBase64(buf);
      },
    };
  }
  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return {
      getContext2D: () => canvas.getContext("2d"),
      toPNGBase64: async () => {
        const dataUrl = canvas.toDataURL("image/png");
        return stripDataUrlPrefix(dataUrl);
      },
    };
  }
  throw new EnvironmentUnsupportedError(
    "redaction.js: no canvas implementation available in this environment " +
      "(no OffscreenCanvas, no document). Pass options.canvasFactory explicitly " +
      "— e.g. one backed by @napi-rs/canvas under Node/tests."
  );
}

/**
 * Browser-native default image loader: createImageBitmap (available in
 * both window and worker/offscreen-document contexts) when present,
 * else a plain <img> element. No default exists for Node — same
 * dependency-injection boundary as defaultCanvasFactory.
 */
async function defaultImageLoader(rawBase64) {
  const bytes = base64ToUint8Array(rawBase64);
  if (typeof createImageBitmap === "function" && typeof Blob !== "undefined") {
    const blob = new Blob([bytes]);
    return createImageBitmap(blob);
  }
  if (typeof document !== "undefined" && typeof Image !== "undefined") {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("redaction.js: failed to decode screenshot image"));
      img.src = `data:image/png;base64,${rawBase64}`;
    });
  }
  throw new EnvironmentUnsupportedError(
    "redaction.js: no image decoder available in this environment " +
      "(no createImageBitmap, no Image/document). Pass options.imageLoader explicitly " +
      "— e.g. one backed by @napi-rs/canvas's loadImage() under Node/tests."
  );
}

/**
 * Draw solid-fill rectangles for every region onto a fresh copy of the
 * screenshot and re-encode as PNG. `regions` must already be in the
 * screenshot's own pixel space (i.e. the output of `buildRedactedRegions`
 * — do not pass raw, unscaled DOM bboxes here).
 *
 * @param {string} screenshotBase64
 * @param {Array<{bbox: {x:number,y:number,w:number,h:number}}>} regions
 * @param {{ canvasFactory?: Function, imageLoader?: Function, fillStyle?: string }} [options]
 * @returns {Promise<string>} redacted image, base64 PNG, no "data:" prefix
 */
export async function paintRegionsOnImage(screenshotBase64, regions = [], options = {}) {
  const {
    canvasFactory = defaultCanvasFactory,
    imageLoader = defaultImageLoader,
    fillStyle = DEFAULT_FILL_STYLE,
  } = options;

  if (typeof screenshotBase64 !== "string" || screenshotBase64.length === 0) {
    throw new Error("redaction.js: screenshotBase64 must be a non-empty base64 string");
  }
  const raw = stripDataUrlPrefix(screenshotBase64);

  let image;
  try {
    image = await imageLoader(raw);
  } catch (err) {
    if (err instanceof EnvironmentUnsupportedError) throw err; // static, value-free, safe to surface as-is
    // Error-path-is-a-data-egress-path (Section 7 lesson from Phase 2c):
    // never echo the image bytes or the underlying decoder's error object
    // (which may embed the input) into a thrown message.
    throw new Error("redaction.js: failed to decode screenshot image");
  }

  const width = image && image.width;
  const height = image && image.height;
  if (!isFiniteNumber(width) || !isFiniteNumber(height) || width <= 0 || height <= 0) {
    throw new Error("redaction.js: decoded image has invalid dimensions");
  }

  let canvas;
  try {
    canvas = await canvasFactory(width, height);
  } catch (err) {
    if (err instanceof EnvironmentUnsupportedError) throw err;
    throw new Error("redaction.js: canvasFactory failed to produce a canvas");
  }

  const ctx = canvas.getContext2D();
  ctx.drawImage(image, 0, 0, width, height);

  ctx.fillStyle = fillStyle;
  for (const region of Array.isArray(regions) ? regions : []) {
    const bbox = region && region.bbox;
    if (!isUsableDomBBox(bbox)) continue;
    const w = Math.max(0, bbox.w);
    const h = Math.max(0, bbox.h);
    if (w <= 0 || h <= 0) continue;
    // Canvas 2D clips fillRect to the canvas bounds automatically; no
    // manual clamping needed for correctness of what gets painted. We
    // still guard w/h above so a NaN/negative box can't reach fillRect.
    ctx.fillRect(bbox.x, bbox.y, w, h);
  }

  try {
    return await canvas.toPNGBase64();
  } catch {
    throw new Error("redaction.js: failed to encode redacted canvas to PNG");
  }
}

// ---------------------------------------------------------------------------
// Half 1 — the literal Phase 2b contract, composed from the two halves above
// ---------------------------------------------------------------------------

/**
 * `redact(screenshotBase64, visionBoxes, domNodes) -> { redactedImage, redactedRegions }`
 * — CLAUDE.md Section 4, Phase 2b, literal contract (first 3 args). A 4th,
 * optional `options` argument carries dependency injection and the
 * mandatory devicePixelRatio scale factor; omitting it is backward
 * compatible with the literal 3-arg contract (scaleFactor then defaults
 * to 1 — correct only on a standard-DPI capture, see the file-level
 * coordinate-space note).
 *
 * @param {string} screenshotBase64
 * @param {Array} visionBoxes
 * @param {Array} domNodes
 * @param {{ scaleFactor?: number, canvasFactory?: Function, imageLoader?: Function, fillStyle?: string }} [options]
 * @returns {Promise<{ redactedImage: string, redactedRegions: Array }>}
 */
export async function redact(screenshotBase64, visionBoxes = [], domNodes = [], options = {}) {
  const { scaleFactor = 1, canvasFactory, imageLoader, fillStyle } = options;

  // Built first, deliberately: if region-building throws (e.g. bad
  // scaleFactor), we must never fall through to returning an unredacted
  // image. Fail closed.
  const redactedRegions = buildRedactedRegions(visionBoxes, domNodes, { scaleFactor });

  const redactedImage = await paintRegionsOnImage(screenshotBase64, redactedRegions, {
    canvasFactory,
    imageLoader,
    fillStyle,
  });

  return { redactedImage, redactedRegions };
}

// ---------------------------------------------------------------------------
// Half 2 — DOM-JSON redaction: strip flagged values before serialization
// ---------------------------------------------------------------------------

/**
 * Strip sensitive values from a full `domSnapshot` array (server/schemas.py
 * `DomNode[]` shape: {agentId, tag, role, type, text, bbox, sensitive})
 * BEFORE that JSON is ever serialized for transmission. Section 5 requires
 * that nothing sensitive exists in the payload object at any point — not
 * merely that it is visually covered in the image — so this must run on
 * the full snapshot the client is about to send, not only on the flagged
 * subset passed to `redact()`.
 *
 * Pure: returns a new array of new node objects. Never mutates its input
 * (defense against a caller accidentally holding a reference to the
 * original, pre-sanitized array and serializing that one by mistake).
 *
 * Only the `text` field is stripped (set to `null`, matching this
 * repo's own fixture convention — see
 * tests/fixtures/valid_request_with_redaction.json's sensitive password
 * node). No other field is added, renamed, or removed: server/schemas.py's
 * `DomNode` model is `extra="forbid"`, so inventing a new field here
 * would make the server reject the whole request with a 422.
 *
 * A node is treated as sensitive (and stripped) if EITHER:
 *   - `node.sensitive === true` (the authoritative, explicit signal), OR
 *   - `node.piiType` is a non-empty string (defense in depth, in case a
 *     caller passes a Phase-2a-shaped sensitiveNodes entry through here
 *     without having set `sensitive` — over-redaction is preferred to
 *     under-redaction per Section 5).
 * When stripped via the `piiType` fallback, `sensitive` is also forced
 * to `true` on the output node so the server sees a consistent, honest
 * declaration rather than a stripped-but-unflagged node.
 *
 * @param {Array<Object>} domSnapshot
 * @returns {Array<Object>}
 */
export function sanitizeDomSnapshot(domSnapshot = []) {
  if (!Array.isArray(domSnapshot)) {
    throw new Error("redaction.js: sanitizeDomSnapshot expects an array");
  }
  return domSnapshot.map(sanitizeDomNode);
}

function isFlaggedSensitive(node) {
  if (!node || typeof node !== "object") return false;
  if (node.sensitive === true) return true;
  if (typeof node.piiType === "string" && node.piiType.length > 0) return true;
  return false;
}

function sanitizeDomNode(node) {
  if (!node || typeof node !== "object") return node;
  const copy = { ...node };
  if (isFlaggedSensitive(copy)) {
    if ("text" in copy) copy.text = null;
    copy.sensitive = true;
  }
  return copy;
}
