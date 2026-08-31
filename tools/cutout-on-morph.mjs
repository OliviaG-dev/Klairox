/**
 * Cuts a generated horse (opaque white studio background) onto the
 * Standard-OC morphology alpha. Interior tobiano white is kept: only
 * silhouette-edge pixels that match the studio backdrop are inpainted.
 *
 * Usage:
 *   node tools/cutout-on-morph.mjs <src.png> <out.png>
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 512;
const MORPH = path.join(
  ROOT,
  'docs/images/horse-base/OC-Standard/morphology-master.png',
);

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function chroma(r, g, b) {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function dist(r, g, b, br, bg, bb) {
  return Math.abs(r - br) + Math.abs(g - bg) + Math.abs(b - bb);
}

function sampleBackdrop(data, width, height) {
  const pts = [
    [2, 2],
    [width - 3, 2],
    [2, height - 3],
    [width - 3, height - 3],
    [width >> 1, 2],
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [x, y] of pts) {
    const i = (y * width + x) * 4;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  const n = pts.length;
  return { r: r / n, g: g / n, b: b / n };
}

function looksLikeBackdrop(r, g, b, bg) {
  return (
    dist(r, g, b, bg.r, bg.g, bg.b) < 24 &&
    chroma(r, g, b) < 5 &&
    luma(r, g, b) > 232
  );
}

function nearTransparent(morph, width, height, x, y, radius = 3) {
  if (morph[(y * width + x) * 4 + 3] < 250) return true;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return true;
      if (morph[(ny * width + nx) * 4 + 3] < 16) return true;
    }
  }
  return false;
}

function inpaint(gen, morph, width, height, x, y, bg) {
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let n = 0;
  for (let rad = 1; rad <= 8 && n === 0; rad++) {
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = (ny * width + nx) * 4;
        if (morph[j + 3] < 16) continue;
        const r = gen[j];
        const g = gen[j + 1];
        const b = gen[j + 2];
        if (looksLikeBackdrop(r, g, b, bg)) continue;
        sr += r;
        sg += g;
        sb += b;
        n++;
      }
    }
  }
  if (n === 0) return null;
  return [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)];
}

async function cutout(src, dest) {
  const morph = await sharp(MORPH)
    .ensureAlpha()
    .resize(SIZE, SIZE, { kernel: 'nearest' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const gen = await sharp(src)
    .resize(SIZE, SIZE, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
      kernel: 'mitchell',
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = morph.info;
  const bg = sampleBackdrop(gen.data, width, height);
  const out = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = morph.data[i + 3];
      if (a < 8) continue;
      let r = gen.data[i];
      let g = gen.data[i + 1];
      let b = gen.data[i + 2];
      if (
        nearTransparent(morph.data, width, height, x, y) &&
        looksLikeBackdrop(r, g, b, bg)
      ) {
        const filled = inpaint(gen.data, morph.data, width, height, x, y, bg);
        if (filled) {
          [r, g, b] = filled;
        }
      }
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = a;
    }
  }

  await mkdir(path.dirname(dest), { recursive: true });
  await sharp(out, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(dest);
}

const src = process.argv[2];
const dest = process.argv[3];
if (!src || !dest) {
  console.error('Usage: node tools/cutout-on-morph.mjs <src.png> <out.png>');
  process.exitCode = 1;
} else {
  await cutout(path.resolve(src), path.resolve(dest));
  console.log('wrote', dest);
}
