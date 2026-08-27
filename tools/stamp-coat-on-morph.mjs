/**
 * Stamps a generated coat onto the shared morphology alpha so the silhouette
 * stays pixel-identical while keeping the photoreal RGB.
 *
 * Stamps a generated coat onto the shared morphology alpha so the silhouette
 * stays pixel-identical while keeping the photoreal RGB.
 *
 * Usage:
 *   node tools/stamp-coat-on-morph.mjs <generated.png> <out-name>
 */
import { access, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MORPH = path.join(ROOT, 'docs/images/horse-base/morphology-master.png');
const SIZE = 512;

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

async function loadDenoisedCoat(src) {
  return sharp(src)
    .resize(SIZE, SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 1 },
      kernel: 'lanczos3',
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

async function main() {
  const src = path.resolve(process.argv[2] ?? '');
  const name = process.argv[3] ?? 'bay';
  if (!src) {
    console.error('Usage: node tools/stamp-coat-on-morph.mjs <generated.png> <out-name>');
    process.exitCode = 1;
    return;
  }
  try {
    await access(src);
    await access(MORPH);
  } catch {
    console.error('Missing source or morphology master.');
    process.exitCode = 1;
    return;
  }

  const morph = await sharp(MORPH).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  const gen = await loadDenoisedCoat(src);
  const { width, height } = morph.info;
  const out = Buffer.alloc(morph.data.length);

  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    const a = morph.data[i + 3];
    if (a < 8) {
      out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
      continue;
    }
    let r = gen.data[i];
    let g = gen.data[i + 1];
    let b = gen.data[i + 2];
    // Background leak: morph covers a pixel the gen still treats as black void.
    if (name !== 'black' && luma(r, g, b) < 6) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let n = 0;
      const x = p % width;
      const y = (p / width) | 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const j = (ny * width + nx) * 4;
          if (morph.data[j + 3] < 8) continue;
          const rr = gen.data[j];
          const gg = gen.data[j + 1];
          const bb = gen.data[j + 2];
          if (luma(rr, gg, bb) < 12) continue;
          sr += rr;
          sg += gg;
          sb += bb;
          n++;
        }
      }
      if (n > 0) {
        r = Math.round(sr / n);
        g = Math.round(sg / n);
        b = Math.round(sb / n);
      }
    }
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = a;
  }

  const dests = [
    path.join(ROOT, 'docs/images/horse-base', `coat-master-${name}.png`),
    path.join(ROOT, 'plugins/horse/layers/coat', `${name}.png`),
  ];
  for (const dest of dests) {
    await mkdir(path.dirname(dest), { recursive: true });
    await sharp(out, { raw: { width, height, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toFile(dest);
    console.log('wrote', path.relative(ROOT, dest));
  }

  const archive = path.join(
    ROOT,
    'docs/images/horse-source',
    `coat-${name}-photoreal-src.png`,
  );
  if (path.resolve(src) !== path.resolve(archive)) {
    await mkdir(path.dirname(archive), { recursive: true });
    await copyFile(src, archive);
    console.log('archived', path.relative(ROOT, archive));
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
