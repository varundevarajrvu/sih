// Browser-side (OffscreenCanvas-based) equivalents of lib/yolo-utils.js's
// sharp-based letterboxResize/divisorResize. An MV3 offscreen document has
// a real DOM (unlike a service worker), so createImageBitmap + OffscreenCanvas
// are both available -- no extra bundled dependency needed for image decode.

async function loadBitmap(url) {
  const resp = await fetch(url);
  const blob = await resp.blob();
  return createImageBitmap(blob);
}

function drawAndExtract(bitmap, targetW, targetH, drawW, drawH, offsetX, offsetY, bg) {
  const canvas = new OffscreenCanvas(targetW, targetH);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (bg !== undefined) {
    ctx.fillStyle = `rgb(${bg},${bg},${bg})`;
    ctx.fillRect(0, 0, targetW, targetH);
  }
  ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, offsetX, offsetY, drawW, drawH);
  const imgData = ctx.getImageData(0, 0, targetW, targetH);
  // imgData.data is RGBA Uint8ClampedArray -- strip alpha to RGB to match
  // the Node/sharp path's output shape exactly (toCHWFloat expects RGB).
  const rgba = imgData.data;
  const rgb = new Uint8Array(targetW * targetH * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i];
    rgb[j + 1] = rgba[i + 1];
    rgb[j + 2] = rgba[i + 2];
  }
  return rgb;
}

/** Ultralytics-style letterbox resize to a fixed square, gray-padded. */
export async function letterboxResizeBrowser(url, targetW, targetH, padColor = 114) {
  const bitmap = await loadBitmap(url);
  const origWidth = bitmap.width;
  const origHeight = bitmap.height;
  const scale = Math.min(targetW / origWidth, targetH / origHeight);
  const newW = Math.round(origWidth * scale);
  const newH = Math.round(origHeight * scale);
  const padX = Math.floor((targetW - newW) / 2);
  const padY = Math.floor((targetH - newH) / 2);
  const data = drawAndExtract(bitmap, targetW, targetH, newW, newH, padX, padY, padColor);
  bitmap.close();
  return { data, width: targetW, height: targetH, scale, padX, padY, origWidth, origHeight };
}

/** OmniParser-style resize: aspect-preserving, longest edge, divisor-rounded. */
export async function divisorResizeBrowser(url, longestEdge, divisor) {
  const bitmap = await loadBitmap(url);
  const origWidth = bitmap.width;
  const origHeight = bitmap.height;
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
  const data = drawAndExtract(bitmap, newW, newH, newW, newH, 0, 0, undefined);
  bitmap.close();
  return { data, width: newW, height: newH, scale: newW / origWidth, padX: 0, padY: 0, origWidth, origHeight };
}
