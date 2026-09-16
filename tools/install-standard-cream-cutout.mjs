/**
 * Install the hand-cut Standard-OC cream plate (RGBA) into Klairox.
 * Does not touch foals or Stalloria.
 *
 *   node tools/install-standard-cream-cutout.mjs
 *   node tools/install-standard-cream-cutout.mjs <cutout.png>
 */
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 1024;

const DEFAULT_CUTOUT = path.join(
  ROOT,
  'docs/images/horse-source/coat-cream-photoreal-cutout.png',
);

const OUT_SRC = path.join(
  ROOT,
  'docs/images/horse-source/coat-cream-photoreal-src.png',
);
const OUT_PLUGIN = path.join(ROOT, 'plugins/horse/layers/coat/cream.png');
const OUT_DOCS = path.join(
  ROOT,
  'docs/images/horse-base/OC-Standard/coat-master-cream.png',
);

function dilateRgbIntoTransparent(data, width, height, radius = 2) {
  const out = Buffer.from(data);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] >= 8) continue;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let n = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const j = (ny * width + nx) * 4;
          if (data[j + 3] < 8) continue;
          sr += data[j];
          sg += data[j + 1];
          sb += data[j + 2];
          n++;
        }
      }
      if (n === 0) continue;
      out[i] = Math.round(sr / n);
      out[i + 1] = Math.round(sg / n);
      out[i + 2] = Math.round(sb / n);
    }
  }
  return out;
}

async function writePng(data, width, height, dest) {
  await mkdir(path.dirname(dest), { recursive: true });
  await sharp(Buffer.from(data), {
    raw: { width, height, channels: 4 },
  })
    .png({ compressionLevel: 9 })
    .toFile(dest);
}

function syncEditor() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(ROOT, 'tools/sync-editor-horse-plugin.mjs')],
      { stdio: 'inherit' },
    );
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`sync-editor exited ${code}`));
    });
  });
}

const cutoutArg = process.argv[2];
const cutoutPath = cutoutArg ? path.resolve(cutoutArg) : DEFAULT_CUTOUT;

const { data, info } = await sharp(cutoutPath)
  .ensureAlpha()
  .resize(SIZE, SIZE, {
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
    kernel: 'mitchell',
  })
  .raw()
  .toBuffer({ resolveWithObject: true });

const cleaned = dilateRgbIntoTransparent(data, info.width, info.height, 2);

if (!cutoutArg) {
  await copyFile(cutoutPath, DEFAULT_CUTOUT).catch(() => {});
}

await writePng(cleaned, info.width, info.height, OUT_SRC);
await writePng(cleaned, info.width, info.height, OUT_PLUGIN);
await writePng(cleaned, info.width, info.height, OUT_DOCS);

if (cutoutArg) {
  await copyFile(cutoutPath, DEFAULT_CUTOUT);
}

let opaque = 0;
for (let p = 0; p < info.width * info.height; p++) {
  if (cleaned[p * 4 + 3] > 16) opaque++;
}
console.log(
  `installed Standard-OC cream cutout from ${path.relative(ROOT, cutoutPath)}`,
);
console.log(
  `  coverage ${((100 * opaque) / (info.width * info.height)).toFixed(1)}%`,
);
console.log(`  ${path.relative(ROOT, OUT_SRC)}`);
console.log(`  ${path.relative(ROOT, OUT_PLUGIN)}`);

await syncEditor();
