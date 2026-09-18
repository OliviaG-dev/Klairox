/**
 * Propagates the manual bay Standard-OC cutout alpha onto every adult
 * photoreal coat except cream. RGB comes from each coat's .opaque.png
 * backup (fallback: current plate). Bay and cream are left untouched.
 *
 *   node tools/propagate-standard-cutout-alpha.mjs
 */
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'docs/images/horse-source');
const MASTER_DIR = path.join(ROOT, 'docs/images/horse-base/OC-Standard');
const SIZE = 1024;
const COATS = [
  'bay',
  'bay-brun',
  'black',
  'chestnut',
  'cream',
  'grey',
  'isabelle',
  'palomino',
  'roan',
];
const KEEP = new Set(['bay', 'cream']);

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const bayPath = path.join(DIR, 'coat-bay-photoreal-src.png');
  const bayMeta = await sharp(bayPath).metadata();
  if (!bayMeta.hasAlpha) {
    throw new Error('Bay plate has no alpha — manual cutout missing');
  }

  const bayAlpha = await sharp(bayPath)
    .ensureAlpha()
    .extractChannel('alpha')
    .resize(SIZE, SIZE, { kernel: 'lanczos3' })
    .raw()
    .toBuffer();

  console.log('Propagating bay cutout alpha → Standard-OC coats (skip cream)');
  await mkdir(MASTER_DIR, { recursive: true });

  for (const coat of COATS) {
    const dest = path.join(DIR, `coat-${coat}-photoreal-src.png`);
    if (KEEP.has(coat)) {
      console.log(`  keep ${coat} (manual cutout)`);
      continue;
    }

    const opaque = path.join(DIR, `coat-${coat}-photoreal-src.opaque.png`);
    const rgbPath = (await exists(opaque)) ? opaque : dest;
    const rgb = await sharp(rgbPath)
      .resize(SIZE, SIZE, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        kernel: 'mitchell',
      })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const rgba = Buffer.alloc(SIZE * SIZE * 4);
    let opaqueCount = 0;
    for (let p = 0; p < SIZE * SIZE; p++) {
      const i = p * 4;
      const j = p * 3;
      rgba[i] = rgb.data[j];
      rgba[i + 1] = rgb.data[j + 1];
      rgba[i + 2] = rgb.data[j + 2];
      rgba[i + 3] = bayAlpha[p];
      if (bayAlpha[p] > 16) opaqueCount++;
    }

    await sharp(rgba, { raw: { width: SIZE, height: SIZE, channels: 4 } })
      .png()
      .toFile(dest);

    const master = path.join(MASTER_DIR, `coat-master-${coat}.png`);
    await sharp(rgba, { raw: { width: SIZE, height: SIZE, channels: 4 } })
      .png()
      .toFile(master);

    console.log(
      `  wrote ${coat} coverage=${((100 * opaqueCount) / (SIZE * SIZE)).toFixed(1)}% from ${path.basename(rgbPath)}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
