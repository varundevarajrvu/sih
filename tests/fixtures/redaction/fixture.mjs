/**
 * Shared fixture for extension/lib/redaction.js unit tests.
 *
 * Builds a synthetic "captured screenshot" (220x170) with two pieces of
 * fake sensitive content pre-painted onto it (a blue "password field"
 * rect and a green "detected object" rect), plus two overlapping boxes
 * used to verify over-redaction behavior. All coordinates below are
 * chosen deliberately so that a devicePixelRatio scaling bug (forgetting
 * to scale DOM bboxes, or wrongly scaling vision boxes) produces a
 * DIFFERENT, wrong pixel footprint than the correct one — see
 * tests/unit/test_redaction.test.mjs for how these are used.
 *
 * Uses @napi-rs/canvas, resolved via createRequire anchored at
 * extension/package.json (where it is installed as a devDependency) so
 * this file works regardless of Node's ancestor node_modules lookup from
 * tests/ (a sibling of extension/, not an ancestor).
 */

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPackageJson = path.resolve(__dirname, "..", "..", "..", "extension", "package.json");
const require = createRequire(pathToFileURL(extensionPackageJson).href);
const { createCanvas, loadImage } = require("@napi-rs/canvas");

export { loadImage };

export const WIDTH = 220;
export const HEIGHT = 170;

export const BACKGROUND_RGB = [230, 230, 230];
export const BLUE_RGB = [30, 60, 200];
export const GREEN_RGB = [20, 160, 60];
export const FILL_RGB = [0, 0, 0]; // default redaction fill (#000000)

export const SCALE_FACTOR = 2; // simulated devicePixelRatio

// -- Region A: DOM-sourced "password" field ---------------------------------
// CSS-pixel bbox (as getBoundingClientRect() would report it).
export const DOM_NODE_PASSWORD = {
  agentId: "agent-1",
  piiType: "password",
  bbox: { x: 10, y: 10, w: 50, h: 15 },
};
// Correct screenshot-pixel location after applying SCALE_FACTOR: x20,y20,w100,h30.
export const REGION_A_CORRECT = { x: 20, y: 20, w: 100, h: 30 };
// What an UNSCALED (buggy) implementation would paint instead -- used only
// to derive a negative-check sample point, never passed into redact().
export const REGION_A_WRONG_IF_UNSCALED = { x: 10, y: 10, w: 50, h: 15 };

// -- Region B: vision-sourced "cell phone" detection -------------------------
// Already in screenshot pixel space per the Phase 0/1 contract -- must NOT
// be scaled by SCALE_FACTOR.
export const VISION_BOX_PHONE = {
  label: "cell phone",
  score: 0.87,
  xmin: 150,
  ymin: 20,
  xmax: 200,
  ymax: 70,
};
export const REGION_B = { x: 150, y: 20, w: 50, h: 50 };

// -- Overlap test: DOM node P (scaled) + vision box Q (unscaled) ------------
export const DOM_NODE_EMAIL = {
  agentId: "agent-3",
  piiType: "email",
  bbox: { x: 5, y: 60, w: 30, h: 20 }, // CSS px -> scaled: x10,y120,w60,h40
};
export const REGION_P = { x: 10, y: 120, w: 60, h: 40 };

export const VISION_BOX_BOOK = {
  label: "book",
  score: 0.6,
  xmin: 50,
  ymin: 140,
  xmax: 100,
  ymax: 160,
};
export const REGION_Q = { x: 50, y: 140, w: 50, h: 20 };

// -- Edge cases ---------------------------------------------------------------
// Unknown piiType -> must degrade to "other" + rawType, and its scaled
// bbox lands fully outside the 220x170 canvas -- must not throw, and the
// full (unclamped) bbox must still be reported in redactedRegions.
export const DOM_NODE_UNKNOWN_TYPE_OFFCANVAS = {
  agentId: "agent-5",
  piiType: "weird-unlisted-type",
  bbox: { x: 150, y: 100, w: 20, h: 10 }, // scaled -> x300,y200,w40,h20 (off-canvas)
};
export const REGION_UNKNOWN_OFFCANVAS = { x: 300, y: 200, w: 40, h: 20 };

// DOM node with no bbox at all -- must be skipped for drawing/regions
// without crashing (its `text` is still stripped by sanitizeDomSnapshot
// separately, tested with its own inline fixtures).
export const DOM_NODE_NO_BBOX = {
  agentId: "agent-4",
  piiType: "pan",
};

export function allVisionBoxes() {
  return [VISION_BOX_PHONE, VISION_BOX_BOOK];
}

export function allDomNodes() {
  return [DOM_NODE_PASSWORD, DOM_NODE_EMAIL, DOM_NODE_UNKNOWN_TYPE_OFFCANVAS, DOM_NODE_NO_BBOX];
}

/** Build the pre-redaction "captured screenshot" as a base64 PNG (no data: prefix). */
export async function buildFixtureScreenshotBase64() {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = rgbToCss(BACKGROUND_RGB);
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = rgbToCss(BLUE_RGB);
  ctx.fillRect(REGION_A_CORRECT.x, REGION_A_CORRECT.y, REGION_A_CORRECT.w, REGION_A_CORRECT.h);

  ctx.fillStyle = rgbToCss(GREEN_RGB);
  ctx.fillRect(REGION_B.x, REGION_B.y, REGION_B.w, REGION_B.h);

  const buf = canvas.toBuffer("image/png");
  return buf.toString("base64");
}

/** Build DI adapters (canvasFactory, imageLoader) backed by @napi-rs/canvas for tests. */
export function makeNodeCanvasAdapters() {
  const canvasFactory = async (width, height) => {
    const canvas = createCanvas(width, height);
    return {
      getContext2D: () => canvas.getContext("2d"),
      toPNGBase64: () => canvas.toBuffer("image/png").toString("base64"),
    };
  };
  const imageLoader = async (rawBase64) => {
    const buf = Buffer.from(rawBase64, "base64");
    return loadImage(buf);
  };
  return { canvasFactory, imageLoader };
}

/** Decode a base64 PNG (via @napi-rs/canvas) and return a pixel-sampling helper. */
export async function decodePngForSampling(base64) {
  const buf = Buffer.from(base64, "base64");
  const img = await loadImage(buf);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, img.width, img.height);
  return {
    width,
    height,
    /** @returns {[r,g,b,a]} */
    pixelAt(x, y) {
      const i = (Math.floor(y) * width + Math.floor(x)) * 4;
      return [data[i], data[i + 1], data[i + 2], data[i + 3]];
    },
  };
}

function rgbToCss([r, g, b]) {
  return `rgb(${r}, ${g}, ${b})`;
}
