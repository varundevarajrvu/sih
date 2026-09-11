// Node-only (sharp-based) image loading/resizing for raw-ORT YOLO-family
// UI detectors. Pure math (decode/NMS/etc, shared with the browser harness
// in chrome-harness/src/) lives in ./yolo-math.js and is re-exported here
// so existing node-test-*.js imports don't need to change.

import sharp from "sharp";
import { toCHWFloat, nms, decodeYoloV8, unletterbox, median } from "./yolo-math.js";

export { toCHWFloat, nms, decodeYoloV8, unletterbox, median };

/**
 * Ultralytics-style letterbox resize: scale to fit within (targetW,targetH)
 * preserving aspect ratio, pad the rest with a constant gray (114,114,114).
 * Returns {data (Uint8Array RGB), width, height, scale, padX, padY, origWidth, origHeight}.
 */
export async function letterboxResize(inputPathOrBuffer, targetW, targetH, padColor = 114) {
  const img = sharp(inputPathOrBuffer).toColorspace("srgb");
  const meta = await img.metadata();
  const origWidth = meta.width;
  const origHeight = meta.height;

  const scale = Math.min(targetW / origWidth, targetH / origHeight);
  const newW = Math.round(origWidth * scale);
  const newH = Math.round(origHeight * scale);
  const padX = Math.floor((targetW - newW) / 2);
  const padY = Math.floor((targetH - newH) / 2);

  const { data } = await img
    .resize(newW, newH, { fit: "fill", kernel: "linear" })
    .extend({
      top: padY,
      bottom: targetH - newH - padY,
      left: padX,
      right: targetW - newW - padX,
      background: { r: padColor, g: padColor, b: padColor },
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
    .then((r) => ({ data: r.data, info: r.info }));

  return { data, width: targetW, height: targetH, scale, padX, padY, origWidth, origHeight };
}

/**
 * OmniParser-style resize: aspect-preserving, longest edge -> `longestEdge`,
 * both resulting dims rounded to nearest multiple of `divisor`. No padding
 * (matches preprocessor_config.json: do_resize + size_divisor, no letterbox
 * mentioned). This is the HF "ImageFeatureExtractor" resize convention, not
 * ultralytics' own letterbox -- OmniParser's icon_detect ships a non-standard
 * preprocessor_config.json even though the underlying model is YOLOv8.
 *
 * NOTE: the published size_divisor (16) is NOT sufficient on its own for
 * this 3-level FPN -- see node-test-omniparser.js's SIZE_DIVISOR comment.
 * Both dims must be multiples of 32 or ONNX Runtime throws a Concat/Resize
 * shape-mismatch error. Confirmed empirically, not assumed.
 */
export async function divisorResize(inputPathOrBuffer, longestEdge, divisor) {
  const img = sharp(inputPathOrBuffer).toColorspace("srgb");
  const meta = await img.metadata();
  const origWidth = meta.width;
  const origHeight = meta.height;

  const long = Math.max(origWidth, origHeight);
  const short = Math.min(origWidth, origHeight);
  let newLong = longestEdge;
  let newShort = Math.round((longestEdge * short) / long);
  newLong = Math.round(newLong / divisor) * divisor;
  newShort = Math.round(newShort / divisor) * divisor;
  newLong = Math.max(newLong, divisor);
  newShort = Math.max(newShort, divisor);

  const newW = origWidth >= origHeight ? newLong : newShort;
  const newH = origWidth >= origHeight ? newShort : newLong;

  const { data } = await img
    .resize(newW, newH, { fit: "fill", kernel: "linear" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
    .then((r) => ({ data: r.data, info: r.info }));

  return { data, width: newW, height: newH, scale: newW / origWidth, padX: 0, padY: 0, origWidth, origHeight };
}
