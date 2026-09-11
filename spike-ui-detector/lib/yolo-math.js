// Pure math helpers for decoding raw YOLOv8 ONNX output -- no image I/O,
// no Node-only or browser-only APIs, so this file is shared verbatim
// between node-test-*.js (Node, via lib/yolo-utils.js which re-exports it)
// and chrome-harness/src/offscreen.entry.js (browser, imported directly).
// Keeping decode/NMS logic in exactly one place means a Node PASS and a
// browser PASS are actually testing the same postprocessing, not two
// independently-written implementations that could silently diverge.

/** HWC uint8 RGB -> NCHW float32, rescaled to [0,1]. */
export function toCHWFloat(rgbData, width, height) {
  const chw = new Float32Array(3 * width * height);
  const plane = width * height;
  for (let i = 0; i < plane; i++) {
    chw[i] = rgbData[i * 3] / 255; // R
    chw[plane + i] = rgbData[i * 3 + 1] / 255; // G
    chw[plane * 2 + i] = rgbData[i * 3 + 2] / 255; // B
  }
  return chw;
}

function iou(a, b) {
  const x1 = Math.max(a.xmin, b.xmin);
  const y1 = Math.max(a.ymin, b.ymin);
  const x2 = Math.min(a.xmax, b.xmax);
  const y2 = Math.min(a.ymax, b.ymax);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = (a.xmax - a.xmin) * (a.ymax - a.ymin);
  const areaB = (b.xmax - b.xmin) * (b.ymax - b.ymin);
  return inter / (areaA + areaB - inter + 1e-9);
}

/** Class-wise greedy NMS. boxes: [{label,score,xmin,ymin,xmax,ymax}] */
export function nms(boxes, iouThreshold = 0.45) {
  const byLabel = new Map();
  for (const b of boxes) {
    if (!byLabel.has(b.label)) byLabel.set(b.label, []);
    byLabel.get(b.label).push(b);
  }
  const kept = [];
  for (const group of byLabel.values()) {
    group.sort((a, b) => b.score - a.score);
    const active = [...group];
    while (active.length) {
      const best = active.shift();
      kept.push(best);
      for (let i = active.length - 1; i >= 0; i--) {
        if (iou(best, active[i]) > iouThreshold) active.splice(i, 1);
      }
    }
  }
  return kept;
}

/**
 * Decode a standard ultralytics YOLOv8 raw head output.
 * Accepts either [1, 4+nc, N] (channels-first) or [1, N, 4+nc]
 * (anchors-first) -- auto-detected by which axis equals 4+nc.
 * Coordinates returned are in MODEL INPUT pixel space (cx,cy,w,h ->
 * xyxy) -- caller must un-letterbox/un-resize back to original image
 * pixels via unletterbox().
 */
export function decodeYoloV8(outputTensor, numClasses, labels, scoreThreshold) {
  const dims = outputTensor.dims;
  const data = outputTensor.data;
  const channelsExpected = 4 + numClasses;

  let numAnchors, channelsFirst;
  if (dims[1] === channelsExpected) {
    channelsFirst = true;
    numAnchors = dims[2];
  } else if (dims[2] === channelsExpected) {
    channelsFirst = false;
    numAnchors = dims[1];
  } else {
    throw new Error(
      `decodeYoloV8: cannot match output dims ${JSON.stringify(dims)} to 4+numClasses=${channelsExpected}`
    );
  }

  const get = (ch, anchor) =>
    channelsFirst ? data[ch * numAnchors + anchor] : data[anchor * channelsExpected + ch];

  const results = [];
  for (let a = 0; a < numAnchors; a++) {
    let bestClass = -1;
    let bestScore = -Infinity;
    for (let c = 0; c < numClasses; c++) {
      const s = get(4 + c, a);
      if (s > bestScore) {
        bestScore = s;
        bestClass = c;
      }
    }
    if (bestScore < scoreThreshold) continue;
    const cx = get(0, a);
    const cy = get(1, a);
    const w = get(2, a);
    const h = get(3, a);
    results.push({
      label: labels[bestClass] ?? `class_${bestClass}`,
      score: bestScore,
      xmin: cx - w / 2,
      ymin: cy - h / 2,
      xmax: cx + w / 2,
      ymax: cy + h / 2,
    });
  }
  return results;
}

/** Map model-input-space boxes back to original image pixel space. */
export function unletterbox(boxes, scale, padX, padY) {
  return boxes.map((b) => ({
    label: b.label,
    score: b.score,
    xmin: (b.xmin - padX) / scale,
    ymin: (b.ymin - padY) / scale,
    xmax: (b.xmax - padX) / scale,
    ymax: (b.ymax - padY) / scale,
  }));
}

export function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
