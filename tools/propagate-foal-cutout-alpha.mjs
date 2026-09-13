/**
 * Propagates the manual cream foal cutout alpha onto every foal photoreal coat.
 * RGB comes from each coat's .opaque.png backup (fallback: current plate).
 * Cream itself is left untouched.
 *
 *   node tools/propagate-foal-cutout-alpha.mjs
 */
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'docs/images/horse-source/foal');
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

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const creamPath = path.join(DIR, 'coat-cream-photoreal-src.png');
  const creamMeta = await sharp(creamPath).metadata();
  if (!creamMeta.hasAlpha) {
    throw new Error('Cream plate has no alpha — manual cutout missing');
  }

  const creamAlpha = await sharp(creamPath)
    .ensureAlpha()
    .extractChannel('alpha')
    .resize(SIZE, SIZE, { kernel: 'lanczos3' })
    .raw()
    .toBuffer();

  console.log('Propagating cream cutout alpha → foal coats');

  for (const coat of COATS) {
    const dest = path.join(DIR, `coat-${coat}-photoreal-src.png`);
    if (coat === 'cream') {
      console.log('  keep cream (manual cutout)');
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
      rgba[i + 3] = creamAlpha[p];
      if (creamAlpha[p] > 16) opaqueCount++;
    }

    await sharp(rgba, { raw: { width: SIZE, height: SIZE, channels: 4 } })
      .png()
      .toFile(dest);

    console.log(
      `  wrote ${coat} coverage=${((100 * opaqueCount) / (SIZE * SIZE)).toFixed(1)}% from ${path.basename(rgbPath)}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
