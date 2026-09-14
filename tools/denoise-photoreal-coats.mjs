/**
 * Smooth high-frequency speckle on photoreal coats (not cream).
 * Keeps muscle/hair form; leaves .opaque.png backups untouched.
 *
 *   node tools/denoise-photoreal-coats.mjs
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DIRS = [
  path.join(ROOT, 'docs/images/horse-source'),
  path.join(ROOT, 'docs/images/horse-source/foal'),
];

const SKIP = new Set(['cream']);

/** How much 1px noise to keep. Roan is meant to be flecked. */
const SPECKLE = {
  roan: 0.38,
  grey: 0.2,
  default: 0.12,
};

/** Medium-scale hair / muscle kept from the 1px-blurred plate. */
const HAIR = 0.9;

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function speckleKeep(coat) {
  return SPECKLE[coat] ?? SPECKLE.default;
}

async function denoiseFile(file, coat) {
  const { data: orig, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { data: blurHf } = await sharp(file)
    .ensureAlpha()
    .blur(1.15)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { data: blurLf } = await sharp(file)
    .ensureAlpha()
    .blur(2.8)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const keep = speckleKeep(coat);
  const out = Buffer.from(orig);
  const n = orig.length;

  for (let i = 0; i < n; i += 4) {
    if (orig[i + 3] < 8) {
      continue;
    }
    const L = luma(orig[i], orig[i + 1], orig[i + 2]);
    // Eyes, nostrils, deep mane: keep the original pixel.
    if (L < 42) {
      continue;
    }

    const protect = L < 70 ? (70 - L) / 28 : 0;
    for (let c = 0; c < 3; c++) {
      const o = orig[i + c];
      const hf = blurHf[i + c];
      const lf = blurLf[i + c];
      const mixed = lf + (hf - lf) * HAIR + (o - hf) * keep;
      out[i + c] = Math.round(
        Math.min(255, Math.max(0, mixed * (1 - protect) + o * protect)),
      );
    }
  }

  await sharp(out, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png({ compressionLevel: 9 })
    .toFile(file);
}

async function coatsIn(dir) {
  const files = await readdir(dir);
  return files
    .filter((f) => /^coat-.+-photoreal-src\.png$/i.test(f))
    .filter((f) => !f.includes('.opaque.'))
    .map((f) => ({
      file: path.join(dir, f),
      coat: f.replace(/^coat-/, '').replace(/-photoreal-src\.png$/i, ''),
    }));
}

async function neighborHf(file) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const x0 = Math.floor(w * 0.38);
  const x1 = Math.floor(w * 0.62);
  const y0 = Math.floor(h * 0.38);
  const y1 = Math.floor(h * 0.58);
  let acc = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1 - 1; x++) {
      const i = (y * w + x) * 4;
      const j = i + 4;
      if (data[i + 3] < 200 || data[j + 3] < 200) continue;
      const L1 = luma(data[i], data[i + 1], data[i + 2]);
      const L2 = luma(data[j], data[j + 1], data[j + 2]);
      acc += Math.abs(L1 - L2);
      n++;
    }
  }
  return n ? acc / n : 0;
}

async function main() {
  console.log('Denoise photoreal coats (skip cream)');
  for (const dir of DIRS) {
    const coats = await coatsIn(dir);
    console.log(`\n${path.relative(ROOT, dir)}`);
    for (const { file, coat } of coats) {
      if (SKIP.has(coat)) {
        console.log(`  skip ${coat}`);
        continue;
      }
      const before = await neighborHf(file);
      await denoiseFile(file, coat);
      const after = await neighborHf(file);
      console.log(
        `  ${coat} hf ${before.toFixed(2)} → ${after.toFixed(2)}`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
