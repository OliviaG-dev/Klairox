/**
 * Builds the shared matte morphology plate from a keyed cream horse.
 *
 * The cream render is already alpha-matted. This script:
 *   - drops leftover black fringe
 *   - compresses specular highlights into diffuse shading
 *   - remaps luminance onto a warm clay so the plate is shape, not a cream coat
 *
 * Usage:
 *   node tools/matte-morphology.mjs [source.png]
 *
 * Output:
 *   docs/images/horse-base/morphology-master.png
 */
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SRC = path.join(
  ROOT,
  'docs/images/horse-source/morphology-master-cream-src.png',
);
const SRC = path.resolve(process.argv[2] ?? DEFAULT_SRC);
const OUT = path.join(ROOT, 'docs/images/horse-base/morphology-master.png');
const SIZE = 512;

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function clamp(v, lo = 0, hi = 255) {
  return Math.min(hi, Math.max(lo, v));
}

/** Warm stone clay: 1:1 luma, slight warmth, no posterizing stops. */
function clayFromLuma(l) {
  const v = clamp(l);
  return [
    Math.round(clamp(v * 1.04)),
    Math.round(clamp(v * 0.98)),
    Math.round(clamp(v * 0.9)),
  ];
}

function rollOffHighlights(l) {
  if (l <= 220) return l;
  return 220 + (l - 220) * 0.35;
}

/** Scale cream down to clay while keeping muscle deltas. */
function toClayLuma(l) {
  return 18 + l * 0.74;
}

async function matteMorphology(src) {
  const { data, info } = await sharp(src)
    .resize(SIZE, SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: sharp.kernel.lanczos3,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const out = Buffer.alloc(data.length);

  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    const a = data[i + 3];
    if (a < 8) {
      out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
      continue;
    }

    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    let l = luma(r, g, b);

    // Only drop leftover key on the outer fringe, not interior creases.
    let fringe = false;
    const x = p % width;
    const y = (p / width) | 0;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1)
      fringe = true;
    else {
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        if (data[((y + dy) * width + (x + dx)) * 4 + 3] < 16) {
          fringe = true;
          break;
        }
      }
    }
    if (l < 18 && a > 200 && fringe) {
      out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
      continue;
    }

    l = toClayLuma(rollOffHighlights(l));
    const [cr, cg, cb] = clayFromLuma(l);
    out[i] = cr;
    out[i + 1] = cg;
    out[i + 2] = cb;
    out[i + 3] = a;
  }

  return { out, width, height };
}

async function main() {
  try {
    await access(SRC);
  } catch {
    console.error(`Source not found: ${SRC}`);
    process.exitCode = 1;
    return;
  }

  const { out, width, height } = await matteMorphology(SRC);
  await mkdir(path.dirname(OUT), { recursive: true });
  await sharp(out, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(OUT);
  console.log('wrote', path.relative(ROOT, OUT));
}

await main();
