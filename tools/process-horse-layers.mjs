/**
 * Builds horse plugin layers from chroma-key (green screen) artwork.
 *
 * Source folder (override with KLAIROX_HORSE_ASSETS):
 *   docs/images/horse-source/
 *
 * Usage: node tools/process-horse-layers.mjs
 */
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.resolve(
  process.env.KLAIROX_HORSE_ASSETS ??
    path.join(ROOT, 'docs/images/horse-source'),
);
const OUT = path.join(ROOT, 'plugins/horse/layers');
const SIZE = 512;
const WORK = 1024;

function isScreenGreen(r, g, b) {
  return (
    (g > 70 && g > r + 20 && g > b + 20) ||
    (g > 140 && g >= r && g >= b && g - Math.min(r, b) > 15)
  );
}

function greenLead(r, g, b) {
  return g - Math.max(r, b);
}

function despill(r, g, b) {
  const lead = greenLead(r, g, b);
  if (lead <= 2) return [r, g, b];
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Pale coats (cream/grey/palomino) soak green fringe — pull G fully to max(R,B).
  const strength = lum > 150 ? 1.2 : lum > 100 ? 1.0 : 0.9;
  const gg = Math.max(0, g - lead * strength);
  const rr = Math.min(255, r + lead * 0.2);
  const bb = Math.min(255, b + lead * 0.15);
  return [Math.round(rr), Math.round(gg), Math.round(bb)];
}

async function chromaKeyGreen(src, dest, { erode = 0 } = {}) {
  const { data, info } = await sharp(src)
    .resize(WORK, WORK, {
      fit: 'contain',
      background: { r: 0, g: 255, b: 0, alpha: 1 },
      kernel: sharp.kernel.lanczos3,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const out = Buffer.alloc(data.length);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const lead = greenLead(r, g, b);

    // Hard key: cream body has negative lead; fringe/screen has positive lead.
    if (isScreenGreen(r, g, b) || lead > 14 || (g > 200 && lead > 8)) {
      out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
      continue;
    }

    const [rr, gg, bb] = despill(r, g, b);
    // If still green-dominant after despill, drop it.
    if (greenLead(rr, gg, bb) > 10) {
      out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
      continue;
    }

    out[i] = rr;
    out[i + 1] = gg;
    out[i + 2] = bb;
    out[i + 3] = 255;
  }

  // Edge cleanup: green fringe only (never pale cream body — body lead is < 0).
  for (let pass = 0; pass < 2; pass++) {
    const kill = [];
    const total = width * height;
    for (let p = 0; p < total; p++) {
      const i = p * 4;
      if (out[i + 3] < 8) continue;
      const x = p % width;
      const y = (p / width) | 0;
      let clearNeighbors = 0;
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          clearNeighbors++;
          continue;
        }
        if (out[(ny * width + nx) * 4 + 3] < 8) clearNeighbors++;
      }
      if (clearNeighbors === 0) continue;

      const er = out[i];
      const eg = out[i + 1];
      const eb = out[i + 2];
      const lead = greenLead(er, eg, eb);
      if (lead > 5 || isScreenGreen(er, eg, eb)) {
        kill.push(p);
      }
    }
    for (const p of kill) {
      const i = p * 4;
      out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
    }
  }

  // Light coats: peel one ring of silhouette to remove white halo on dark preview BG.
  for (let pass = 0; pass < erode; pass++) {
    const kill = [];
    const total = width * height;
    for (let p = 0; p < total; p++) {
      const i = p * 4;
      if (out[i + 3] < 8) continue;
      const x = p % width;
      const y = (p / width) | 0;
      let touchesClear = false;
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          touchesClear = true;
          break;
        }
        if (out[(ny * width + nx) * 4 + 3] < 8) {
          touchesClear = true;
          break;
        }
      }
      if (touchesClear) kill.push(p);
    }
    for (const p of kill) {
      const i = p * 4;
      out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
    }
  }

  await mkdir(path.dirname(dest), { recursive: true });
  await sharp(out, { raw: { width, height, channels: 4 } })
    .resize(SIZE, SIZE, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .sharpen({ sigma: 0.75, m1: 0.85, m2: 2.4 })
    .png({ compressionLevel: 9 })
    .toFile(dest);
  console.log('wrote', path.relative(ROOT, dest));
}

async function writeEmptyLayer(dest) {
  await mkdir(path.dirname(dest), { recursive: true });
  await sharp({
    create: {
      width: SIZE,
      height: SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toFile(dest);
  console.log('wrote empty', path.relative(ROOT, dest));
}

async function main() {
  try {
    await access(ASSETS);
  } catch {
    console.error(
      `Horse source folder not found: ${path.relative(ROOT, ASSETS)}\n` +
        'Set KLAIROX_HORSE_ASSETS to the directory that holds the greenscreen PNGs.',
    );
    process.exitCode = 1;
    return;
  }

  const A = (name) => path.join(ASSETS, name);
  await mkdir(OUT, { recursive: true });

  await chromaKeyGreen(
    A('horse-body-standard-greenscreen.png'),
    path.join(OUT, 'body/standard.png'),
  );
  await chromaKeyGreen(
    A('horse-coat-bay-greenscreen.png'),
    path.join(OUT, 'coat/bay.png'),
  );
  await chromaKeyGreen(
    A('horse-coat-black-greenscreen.png'),
    path.join(OUT, 'coat/black.png'),
  );
  await chromaKeyGreen(
    A('horse-coat-chestnut-greenscreen.png'),
    path.join(OUT, 'coat/chestnut.png'),
  );
  await chromaKeyGreen(
    A('horse-coat-grey-greenscreen.png'),
    path.join(OUT, 'coat/grey.png'),
    { erode: 1 },
  );
  await chromaKeyGreen(
    A('horse-coat-roan-greenscreen.png'),
    path.join(OUT, 'coat/roan.png'),
  );
  await chromaKeyGreen(
    A('horse-coat-palomino-greenscreen.png'),
    path.join(OUT, 'coat/palomino.png'),
    { erode: 1 },
  );
  await chromaKeyGreen(
    A('horse-coat-dun-greenscreen.png'),
    path.join(OUT, 'coat/dun.png'),
  );
  await chromaKeyGreen(
    A('horse-coat-cream-greenscreen.png'),
    path.join(OUT, 'coat/cream.png'),
    { erode: 1 },
  );

  for (const rel of [
    'mane/short.png',
    'mane/long.png',
    'markings/blaze.png',
    'markings/star.png',
    'equipment/saddle.png',
    'equipment/armor.png',
  ]) {
    await writeEmptyLayer(path.join(OUT, rel));
  }

  // Keep the Angular public mirror in sync for the live editor.
  const { spawnSync } = await import('node:child_process');
  const sync = spawnSync(
    process.execPath,
    [path.join(ROOT, 'tools/sync-editor-horse-plugin.mjs')],
    { stdio: 'inherit' },
  );
  if (sync.status !== 0) {
    process.exitCode = sync.status ?? 1;
  }
}

await main();
