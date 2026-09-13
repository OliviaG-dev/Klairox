/**
 * Rebuilds plugin coat layers from the photoreal RGBA plates so the Klairox
 * editor shows the same cutout as Stalloria.
 *
 * Foal coats use the cream-propagated alpha plates. Adult coats use their
 * photoreal-src (RGBA) plates. Written at canvas size (1024).
 *
 *   node tools/sync-plugin-coats-from-photoreal.mjs
 *   node tools/sync-plugin-coats-from-photoreal.mjs --no-sync-editor
 */
import { access, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 1024;

const JOBS = [
  {
    build: 'standard',
    sourceDir: path.join(ROOT, 'docs/images/horse-source'),
    pluginDir: path.join(ROOT, 'plugins/horse/layers/coat'),
  },
  {
    build: 'foal',
    sourceDir: path.join(ROOT, 'docs/images/horse-source/foal'),
    pluginDir: path.join(ROOT, 'plugins/horse/layers/coat-foal'),
  },
];

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

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function listCoats(pluginDir) {
  const files = await readdir(pluginDir);
  return files
    .filter((f) => f.endsWith('.png'))
    .map((f) => f.replace(/\.png$/i, ''))
    .sort();
}

async function writeCoat(sourceDir, pluginDir, coat) {
  const src = path.join(sourceDir, `coat-${coat}-photoreal-src.png`);
  if (!(await exists(src))) {
    console.log(`  skip ${coat} (no photoreal)`);
    return;
  }

  const { data, info } = await sharp(src)
    .ensureAlpha()
    .resize(SIZE, SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: 'mitchell',
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const cleaned = dilateRgbIntoTransparent(data, info.width, info.height, 2);
  const dest = path.join(pluginDir, `${coat}.png`);
  await sharp(cleaned, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toFile(dest);

  let opaque = 0;
  for (let p = 0; p < info.width * info.height; p++) {
    if (cleaned[p * 4 + 3] > 16) opaque++;
  }
  console.log(
    `  wrote ${path.relative(ROOT, dest)} coverage=${((100 * opaque) / (info.width * info.height)).toFixed(1)}%`,
  );
}

function runSyncEditor() {
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

async function main() {
  const syncEditor = !process.argv.includes('--no-sync-editor');
  console.log('Sync plugin coats from photoreal RGBA');

  for (const job of JOBS) {
    const coats = await listCoats(job.pluginDir);
    console.log(`\n${job.build}`);
    for (const coat of coats) {
      await writeCoat(job.sourceDir, job.pluginDir, coat);
    }
  }

  if (syncEditor) {
    console.log('');
    await runSyncEditor();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
