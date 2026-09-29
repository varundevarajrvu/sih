// Generates the face-scale-ladder fixtures for V0b: the demo face
// (site/assets/id-card-face.jpg, a tight close-up crop, 500x333) resized to
// each target HEIGHT and pasted onto a 1280x720 white canvas, centered.
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, "fixtures", "demo-face.jpg");
const CANVAS_W = 1280;
const CANVAS_H = 720;
const SCALES = [40, 60, 80, 96, 120, 200];

async function main() {
  const srcMeta = await sharp(SRC).metadata();
  const aspect = srcMeta.width / srcMeta.height; // ~1.5015

  for (const heightPx of SCALES) {
    const widthPx = Math.round(heightPx * aspect);
    const resized = await sharp(SRC).resize({ width: widthPx, height: heightPx, fit: "fill" }).toBuffer();
    const left = Math.round((CANVAS_W - widthPx) / 2);
    const top = Math.round((CANVAS_H - heightPx) / 2);
    const outPath = path.join(__dirname, "fixtures", `face-${heightPx}px.png`);
    await sharp({
      create: { width: CANVAS_W, height: CANVAS_H, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .composite([{ input: resized, left, top }])
      .png()
      .toFile(outPath);
    console.log(`wrote ${outPath} (face ${widthPx}x${heightPx}px at ${left},${top})`);
  }

  // Also write a plain 1280x720 white canvas with the face at a mid scale
  // (120px) for use as the standard latency-measurement input (any
  // consistent 1280x720 input works for timing; this one is realistic and
  // shared between models for a fair comparison).
  fs.copyFileSync(
    path.join(__dirname, "fixtures", "face-120px.png"),
    path.join(__dirname, "fixtures", "latency-input.png"),
  );
  console.log("wrote fixtures/latency-input.png (= face-120px.png)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
