/**
 * Rebuilds the foal morphology alpha from light photoreal coats.
 *
 * Bay/black points vanish against the studio backdrop if the mask is taken
 * from a dark coat. Cream, palomino and chestnut keep the legs and tail,
 * so their union becomes the shared silhouette.
 *
 * Usage: node tools/extract-foal-morph.mjs
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEST = path.join(
  ROOT,
  'docs/images/horse-base/foal/morphology-master.png',
);
const SOURCE_DIR = path.join(ROOT, 'docs/images/horse-source/foal');
const LIGHT_COATS = [
  'coat-cream-photoreal-src.png',
  'coat-palomino-photoreal-src.png',
  'coat-chestnut-photoreal-src.png',
];
const LUMA_THRESHOLD = 12;
const CLOSE_RADIUS = 3;
const VERTICAL_GAP = 18;
const HORIZONTAL_GAP = 6;

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function unionLightMasks(images) {
  const { width, height } = images[0].info;
  const mask = new Uint8Array(width * height);
  for (const image of images) {
    const { data } = image;
    for (let p = 0; p < width * height; p++) {
      const i = p * 3;
      if (luma(data[i], data[i + 1], data[i + 2]) > LUMA_THRESHOLD) {
        mask[p] = 1;
      }
    }
  }
  return { mask, width, height };
}

function largestComponent(mask, width, height) {
  const seen = new Uint8Array(width * height);
  const keep = new Uint8Array(width * height);
  let best = [];
  for (let start = 0; start < width * height; start++) {
    if (!mask[start] || seen[start]) continue;
    const stack = [start];
    const cells = [];
    seen[start] = 1;
    while (stack.length > 0) {
      const p = stack.pop();
      cells.push(p);
      const x = p % width;
      const y = (p / width) | 0;
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const np = ny * width + nx;
        if (!mask[np] || seen[np]) continue;
        seen[np] = 1;
        stack.push(np);
      }
    }
    if (cells.length > best.length) best = cells;
  }
  for (const p of best) keep[p] = 1;
  return keep;
}

function morph(mask, width, height, radius, keepIf) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let n = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (mask[ny * width + nx]) n++;
        }
      }
      out[y * width + x] = keepIf(n) ? 1 : 0;
    }
  }
  return out;
}

function closeMask(mask, width, height, radius) {
  const dilated = morph(mask, width, height, radius, (n) => n > 0);
  const window = (radius * 2 + 1) ** 2;
  return morph(dilated, width, height, radius, (n) => n === window);
}

function bridgeGaps(mask, width, height, maxGap, alongY) {
  const out = Uint8Array.from(mask);
  const primary = alongY ? width : height;
  const secondary = alongY ? height : width;
  for (let a = 0; a < primary; a++) {
    let b = 0;
    while (b < secondary) {
      while (b < secondary && sample(out, width, a, b, alongY)) b++;
      const gapStart = b;
      while (b < secondary && !sample(out, width, a, b, alongY)) b++;
      const gapEnd = b;
      const gap = gapEnd - gapStart;
      const before =
        gapStart > 0 && sample(out, width, a, gapStart - 1, alongY);
      const after = gapEnd < secondary && sample(out, width, a, gapEnd, alongY);
      if (before && after && gap > 0 && gap <= maxGap) {
        for (let i = gapStart; i < gapEnd; i++) {
          write(out, width, a, i, alongY);
        }
      }
    }
  }
  return out;
}

function sample(mask, width, a, b, alongY) {
  return alongY ? mask[b * width + a] : mask[a * width + b];
}

function write(mask, width, a, b, alongY) {
  if (alongY) mask[b * width + a] = 1;
  else mask[a * width + b] = 1;
}

function fillInteriorHoles(mask, width, height) {
  const outside = new Uint8Array(width * height);
  const q = [0];
  outside[0] = 1;
  for (let qi = 0; qi < q.length; qi++) {
    const p = q[qi];
    const x = p % width;
    const y = (p / width) | 0;
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const np = ny * width + nx;
      if (outside[np] || mask[np]) continue;
      outside[np] = 1;
      q.push(np);
    }
  }
  let filled = 0;
  for (let p = 0; p < mask.length; p++) {
    if (mask[p] || outside[p]) continue;
    mask[p] = 1;
    filled++;
  }
  return filled;
}

function toRgba(mask, width, height) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let p = 0; p < mask.length; p++) {
    const i = p * 4;
    if (!mask[p]) continue;
    rgba[i] = 128;
    rgba[i + 1] = 128;
    rgba[i + 2] = 128;
    rgba[i + 3] = 255;
  }
  return rgba;
}

function count(mask) {
  let n = 0;
  for (const bit of mask) if (bit) n++;
  return n;
}

async function main() {
  const images = await Promise.all(
    LIGHT_COATS.map(async (file) => {
      const src = path.join(SOURCE_DIR, file);
      return sharp(src)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    }),
  );

  let { mask, width, height } = unionLightMasks(images);
  console.log('union', count(mask));
  mask = largestComponent(mask, width, height);
  console.log('largest-cc', count(mask));
  mask = closeMask(mask, width, height, CLOSE_RADIUS);
  console.log('close', count(mask));
  mask = bridgeGaps(mask, width, height, VERTICAL_GAP, true);
  console.log('bridge-vertical', count(mask));
  mask = bridgeGaps(mask, width, height, HORIZONTAL_GAP, false);
  console.log('bridge-horizontal', count(mask));
  const holes = fillInteriorHoles(mask, width, height);
  console.log('holes', holes, 'final', count(mask));

  await mkdir(path.dirname(DEST), { recursive: true });
  await sharp(toRgba(mask, width, height), {
    raw: { width, height, channels: 4 },
  })
    .png({ compressionLevel: 9 })
    .toFile(DEST);
  console.log('wrote', path.relative(ROOT, DEST));
}

await main();
