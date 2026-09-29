/**
 * V2 Phase V2 (vision-v2) — face-detect.js.
 *
 * Pure preprocessing/decode/NMS/coordinate-mapping for UltraFace RFB-320,
 * ported from the recipe verified working end-to-end in a real browser by
 * the V0b spike (`spikes/ultraface/RESULT.md` — "the exact pre/post-
 * processing recipe that worked", itself copied verbatim from Project B's
 * `Prototype/shared/vision.mjs` into `spikes/ultraface/lib/vision.mjs`).
 * `rgbaToNchw` and the decode/NMS math below are that same recipe, not a
 * reimplementation — only reshaped to (a) emit the project's own flat
 * DETECTION_RESULT box contract `{label, score, xmin, ymin, xmax, ymax}`
 * (CLAUDE.md Section 4 Phase 1) instead of vision.mjs's own
 * `{kind,x,y,width,height,confidence}` shape, and (b) split into smaller
 * named exports so decode, NMS, and coordinate scaling are independently
 * testable per the V2 brief.
 *
 * DELIBERATELY FRAMEWORK-AGNOSTIC: this file never imports onnxruntime-web
 * (or any ONNX runtime) itself. It only consumes plain typed-array tensor
 * data (`scores`, `boxes` — whatever a real `session.run()` result or a
 * hand-built fake produces) and plain RGBA pixel data. That is what makes
 * it testable under `node --test` with either a real onnxruntime-node
 * session's output or, as this module's own test suite does, hand-built
 * fake tensors — no ONNX runtime dependency needed in the test suite at
 * all. Session creation, canvas resizing, and the actual `session.run()`
 * call live in `extension/src/offscreen.entry.js`, which has real
 * browser/offscreen-document canvas and WASM/WebGPU runtime access this
 * module intentionally does not need.
 *
 * ---------------------------------------------------------------------
 * COORDINATE SPACE — no separate "scale to screenshot pixels" step needed
 * ---------------------------------------------------------------------
 * UltraFace's raw output boxes are NORMALIZED 0–1. `decodeFaceDetections`
 * takes the caller's target width/height directly (not the model's fixed
 * 320×240 input size) and scales by THAT — so passing the screenshot's
 * (or a tile's) own real pixel dimensions produces boxes already in that
 * exact pixel space, with no extra scaling pass required afterward. This
 * mirrors this project's existing vision-box contract (redaction.js's own
 * hazard note: "visionBoxes ... already in that image's own pixel space
 * ... used AS-IS, never scaled") and is why devicePixelRatio needs no
 * special handling here: `chrome.tabs.captureVisibleTab` screenshots are
 * already captured at physical (device) pixel resolution, so as long as
 * the caller passes the SCREENSHOT's actual pixel width/height (not a
 * CSS-pixel viewport size) into `decodeFaceDetections`, the returned boxes
 * are correct in screenshot-pixel space at any devicePixelRatio. The V2
 * brief's "devicePixelRatio 1.25/1.5" test coverage below exercises this
 * by decoding the SAME normalized model output against differently-sized
 * target dimensions and checking the resulting pixel boxes scale exactly
 * proportionally — proving the linear math is correct, which is what
 * carries the DPR guarantee through in practice.
 *
 * For the tiled second pass (mitigation for small/far faces — see
 * offscreen.entry.js), each tile is decoded against ITS OWN width/height
 * (already in full-screenshot-pixel units, since tiles are pixel crops of
 * the screenshot), then `offsetDetections` adds the tile's top-left corner
 * to translate tile-local boxes into full-screenshot coordinates.
 */

const DEFAULT_THRESHOLD = 0.7; // Project B's default, matches the V0b spike's validated recipe.
const DEFAULT_IOU_THRESHOLD = 0.3;
const DEFAULT_NMS_CAP = 100;
const MODEL_INPUT_WIDTH = 320;
const MODEL_INPUT_HEIGHT = 240;
const FACE_LABEL = "face";

function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function assertImageShape(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192) {
    throw new Error("face-detect.js: invalid image shape");
  }
}

/**
 * RGBA (Uint8Array/Uint8ClampedArray, or already-normalized floats in
 * 0–255 range) -> NCHW float32, alpha dropped, per-channel
 * `(value - 127) / 128`. Ported verbatim from the V0b spike's verified
 * recipe (`spikes/ultraface/lib/vision.mjs::rgbaToNchw`).
 *
 * @param {Uint8Array|Uint8ClampedArray|number[]} data RGBA pixel bytes, length width*height*4.
 * @param {number} [width=320]
 * @param {number} [height=240]
 * @returns {Float32Array} length width*height*3, layout [R plane][G plane][B plane].
 */
export function rgbaToNchw(data, width = MODEL_INPUT_WIDTH, height = MODEL_INPUT_HEIGHT) {
  assertImageShape(width, height);
  if (!data || data.length !== width * height * 4) throw new Error("face-detect.js: invalid image shape");
  const out = new Float32Array(width * height * 3);
  const n = width * height;
  const byteInput = data instanceof Uint8Array || data instanceof Uint8ClampedArray;
  for (let i = 0; i < n; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    if (!byteInput && (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b) || r < 0 || g < 0 || b < 0 || r > 255 || g > 255 || b > 255)) {
      throw new Error("face-detect.js: invalid image sample");
    }
    out[i] = (r - 127) / 128;
    out[n + i] = (g - 127) / 128;
    out[2 * n + i] = (b - 127) / 128;
  }
  return out;
}

/** IoU over the project's flat {xmin,ymin,xmax,ymax} box shape. */
export function iou(a, b) {
  const x = Math.max(a.xmin, b.xmin);
  const y = Math.max(a.ymin, b.ymin);
  const right = Math.min(a.xmax, b.xmax);
  const bottom = Math.min(a.ymax, b.ymax);
  const inter = Math.max(0, right - x) * Math.max(0, bottom - y);
  const areaA = Math.max(0, a.xmax - a.xmin) * Math.max(0, a.ymax - a.ymin);
  const areaB = Math.max(0, b.xmax - b.xmin) * Math.max(0, b.ymax - b.ymin);
  return inter / (areaA + areaB - inter || 1);
}

/**
 * Greedy NMS: sort by score descending, keep while IoU < iouThreshold
 * against every already-kept box, cap at `cap`. Separable from decode so
 * NMS behavior (overlap suppression, non-overlap retention, the cap) is
 * directly testable on hand-built candidate sets.
 *
 * @param {Array<{label:string,score:number,xmin:number,ymin:number,xmax:number,ymax:number}>} candidates
 * @param {number} [iouThreshold=0.3]
 * @param {number} [cap=100]
 */
export function nonMaxSuppression(candidates, iouThreshold = DEFAULT_IOU_THRESHOLD, cap = DEFAULT_NMS_CAP) {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const kept = [];
  for (const c of sorted) {
    if (kept.every((k) => iou(c, k) < iouThreshold)) {
      kept.push(c);
      if (kept.length === cap) break;
    }
  }
  return kept;
}

/**
 * Decode UltraFace's raw `scores`/`boxes` output tensors into the flat
 * DETECTION_RESULT box contract, already NMS'd. Ported from
 * `vision.mjs::decodeFaces`, reshaped to emit `{label:"face", score,
 * xmin, ymin, xmax, ymax}` (project contract) instead of vision.mjs's
 * `{kind,x,y,width,height,confidence}`.
 *
 * A malformed tensor throws (matches vision.mjs's own stance: "a
 * malformed tensor is a failed inference, never a clean/no-face result" —
 * never silently return zero detections for what is actually a decode
 * bug, since that would look identical to "no faces present").
 *
 * @param {ArrayLike<number>} scoresData flat, length N*2 (per-candidate [background, face] pair).
 * @param {ArrayLike<number>} boxesData flat, length N*4, normalized 0–1 (x1,y1,x2,y2).
 * @param {number} width target pixel width to scale into (screenshot's or tile's OWN pixel width — see file header).
 * @param {number} height target pixel height to scale into.
 * @param {number} [threshold=0.7] minimum face-class score to keep as a candidate.
 * @param {{iouThreshold?: number, cap?: number}} [options]
 * @returns {Array<{label:"face",score:number,xmin:number,ymin:number,xmax:number,ymax:number}>}
 */
export function decodeFaceDetections(scoresData, boxesData, width, height, threshold = DEFAULT_THRESHOLD, options = {}) {
  assertImageShape(width, height);
  if (!isFiniteNumber(threshold) || threshold < 0 || threshold > 1) {
    throw new Error("face-detect.js: invalid confidence threshold");
  }
  const scoresLen = scoresData?.length;
  if (!scoresLen || scoresLen % 2 !== 0 || scoresLen > 200000 || boxesData?.length !== scoresLen * 2) {
    throw new Error("face-detect.js: unexpected face model output shape");
  }
  for (let i = 0; i < scoresLen; i++) {
    const s = scoresData[i];
    if (!Number.isFinite(s) || s < 0 || s > 1) throw new Error("face-detect.js: invalid face model score");
  }
  for (let i = 0; i < boxesData.length; i++) {
    if (!Number.isFinite(boxesData[i])) throw new Error("face-detect.js: invalid face model box coordinate");
  }

  const candidates = [];
  for (let i = 0; i < scoresLen / 2; i++) {
    const score = scoresData[i * 2 + 1]; // index 1 == face class, matches vision.mjs's decodeFaces
    if (score < threshold) continue;
    const xmin = Math.max(0, boxesData[i * 4] * width);
    const ymin = Math.max(0, boxesData[i * 4 + 1] * height);
    const xmax = Math.min(width, boxesData[i * 4 + 2] * width);
    const ymax = Math.min(height, boxesData[i * 4 + 3] * height);
    if (xmax > xmin && ymax > ymin) {
      candidates.push({ label: FACE_LABEL, score, xmin, ymin, xmax, ymax });
    }
  }

  const { iouThreshold = DEFAULT_IOU_THRESHOLD, cap = DEFAULT_NMS_CAP } = options;
  return nonMaxSuppression(candidates, iouThreshold, cap);
}

/**
 * Translate tile-local detections into full-screenshot coordinates by
 * adding the tile's top-left offset. Pure, no NMS applied here (see
 * `mergeTileResults` for cross-tile dedupe).
 *
 * @param {Array<{label,score,xmin,ymin,xmax,ymax}>} detections
 * @param {number} offsetX
 * @param {number} offsetY
 */
export function offsetDetections(detections, offsetX, offsetY) {
  if (!isFiniteNumber(offsetX) || !isFiniteNumber(offsetY)) {
    throw new Error("face-detect.js: offsetX/offsetY must be finite numbers");
  }
  return detections.map((d) => ({
    ...d,
    xmin: d.xmin + offsetX,
    ymin: d.ymin + offsetY,
    xmax: d.xmax + offsetX,
    ymax: d.ymax + offsetY,
  }));
}

/**
 * Compute a `cols` x `rows` tile grid covering a `screenshotWidth` x
 * `screenshotHeight` image, in full-screenshot pixel coordinates. Used
 * for the small-face mitigation (tiled second pass): each tile is later
 * resized independently to the model's fixed 320x240 input, giving faces
 * within that tile a larger apparent size relative to the model's input
 * resolution than they had in the single full-screenshot pass.
 *
 * Edge tiles absorb any remainder from non-integer division (floor for
 * width/height, last column/row takes the leftover) so the grid always
 * exactly covers the full image with no gaps and no out-of-bounds tiles.
 *
 * @param {number} screenshotWidth
 * @param {number} screenshotHeight
 * @param {number} [cols=2]
 * @param {number} [rows=2]
 * @returns {Array<{x:number,y:number,width:number,height:number}>} length cols*rows, row-major order.
 */
export function computeTileGrid(screenshotWidth, screenshotHeight, cols = 2, rows = 2) {
  assertImageShape(screenshotWidth, screenshotHeight);
  if (!Number.isInteger(cols) || cols < 1 || !Number.isInteger(rows) || rows < 1) {
    throw new Error("face-detect.js: cols/rows must be positive integers");
  }
  const baseW = Math.floor(screenshotWidth / cols);
  const baseH = Math.floor(screenshotHeight / rows);
  const tiles = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * baseW;
      const y = row * baseH;
      const width = col === cols - 1 ? screenshotWidth - x : baseW;
      const height = row === rows - 1 ? screenshotHeight - y : baseH;
      tiles.push({ x, y, width, height });
    }
  }
  return tiles;
}

/**
 * Merge per-tile detection arrays (already offset into full-screenshot
 * coordinates by the caller via `offsetDetections`) into one deduplicated
 * list. A face straddling a tile boundary can be independently detected
 * in two adjacent tiles at slightly different box extents — a final NMS
 * pass across the UNION collapses those into one box (highest-score
 * candidate wins), same IoU/cap semantics as the single-pass path.
 *
 * @param {Array<Array<{label,score,xmin,ymin,xmax,ymax}>>} perTileDetections already offset, one array per tile.
 * @param {{iouThreshold?: number, cap?: number}} [options]
 */
export function mergeTileResults(perTileDetections, options = {}) {
  const { iouThreshold = DEFAULT_IOU_THRESHOLD, cap = DEFAULT_NMS_CAP } = options;
  const all = [].concat(...perTileDetections.filter(Array.isArray));
  return nonMaxSuppression(all, iouThreshold, cap);
}

export const FACE_DETECT_CONSTANTS = Object.freeze({
  MODEL_INPUT_WIDTH,
  MODEL_INPUT_HEIGHT,
  DEFAULT_THRESHOLD,
  DEFAULT_IOU_THRESHOLD,
  DEFAULT_NMS_CAP,
  FACE_LABEL,
});
