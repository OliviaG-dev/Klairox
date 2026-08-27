/**
 * Refines the chestnut master: black hooves, sooty nuanced muzzle.
 *
 * Usage: node tools/refine-chestnut.mjs
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(
  ROOT,
  'docs/images/horse-source/coat-chestnut-photoreal-src.png',
);
const MORPH = path.join(ROOT, 'docs/images/horse-base/morphology-master.png');
const SIZE = 512;

function clamp(v, lo = 0, hi = 1) {
  return Math.min(hi, Math.max(lo, v));
}

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

async function main() {
  const morph = await sharp(MORPH).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  const gen = await sharp(SRC)
    .resize(SIZE, SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 1 },
      kernel: sharp.kernel.lanczos3,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = morph.info;
  const data = Buffer.alloc(morph.data.length);
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    const a = morph.data[i + 3];
    if (a < 8) continue;
    data[i] = gen.data[i];
    data[i + 1] = gen.data[i + 1];
    data[i + 2] = gen.data[i + 2];
    data[i + 3] = a;
  }
  const bottom = new Array(width).fill(-1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 16) bottom[x] = y;
    }
  }

  const out = Buffer.from(data);

  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    const a = data[i + 3];
    if (a < 8) continue;
    const x = p % width;
    const y = (p / width) | 0;
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    const l = luma(r, g, b);

    // Hooves: last ~32px of each leg column, dark horn / black.
    if (y > 430 && bottom[x] >= 0) {
      const fromBottom = bottom[x] - y;
      const hoof = 1 - smoothstep(6, 38, fromBottom);
      if (hoof > 0.02) {
        const sheen = clamp((l - 40) / 140);
        const horn = mix([16, 14, 13], [58, 50, 44], sheen * 0.7);
        [r, g, b] = mix([r, g, b], horn, hoof);
      }
    }

    // Muzzle: dark pigmented skin around nostrils/lips, soft fade into the face.
    if (x < 128 && y > 122 && y < 198) {
      const dist = Math.hypot(x - 88, (y - 154) * 1.05);
      const front = smoothstep(120, 78, x);
      const band = (1 - smoothstep(10, 44, dist)) * front;
      if (band > 0.02) {
        const grey = l;
        const skin = [
          Math.round(grey * 0.72 + 18),
          Math.round(grey * 0.58 + 12),
          Math.round(grey * 0.48 + 8),
        ];
        [r, g, b] = mix([r, g, b], skin, band * 0.55);
      }
    }

    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
  }

  const dests = [
    path.join(ROOT, 'docs/images/horse-base/coat-master-chestnut.png'),
    path.join(ROOT, 'plugins/horse/layers/coat/chestnut.png'),
  ];
  for (const dest of dests) {
    await mkdir(path.dirname(dest), { recursive: true });
    await sharp(out, { raw: { width, height, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toFile(dest);
    console.log('wrote', path.relative(ROOT, dest));
  }

  const { spawnSync } = await import('node:child_process');
  const sync = spawnSync(
    process.execPath,
    [path.join(ROOT, 'tools/sync-editor-horse-plugin.mjs')],
    { stdio: 'inherit' },
  );
  if (sync.status !== 0) process.exitCode = sync.status ?? 1;
}

await main();
