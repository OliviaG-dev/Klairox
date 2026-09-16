/**
 * Install the hand-cut foal cream plate (RGBA) into Klairox.
 * Optionally pulls body warmth/chroma from the Standard-OC cream cutout
 * so the foal does not read pale/white like the bay-morph rebuild.
 *
 *   node tools/install-foal-cream-cutout.mjs
 *   node tools/install-foal-cream-cutout.mjs <cutout.png>
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
  'docs/images/horse-source/foal/coat-cream-photoreal-cutout.png',
);
const STANDARD_REF = path.join(ROOT, 'plugins/horse/layers/coat/cream.png');

const OUT_SRC = path.join(
  ROOT,
  'docs/images/horse-source/foal/coat-cream-photoreal-src.png',
);
const OUT_PLUGIN = path.join(ROOT, 'plugins/horse/layers/coat-foal/cream.png');
const OUT_DOCS = path.join(
  ROOT,
  'docs/images/horse-base/foal/coat-master-cream.png',
);

/** Peak blend toward Standard cream at the same luma (body midtones). */
const WARMTH_PEAK = 0.78;

/** Foal near-eye socket in 512 space (extract-face-marking Foal build). */
const EYE_512 = [130, 103];
const EYE_RX_512 = 14;
const EYE_RY_512 = 9;
const EYE_TILT = -0.38;
const CANVAS_SCALE = 2;

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function clampByte(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function clamp(v, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

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

function eyeLocal512(x1024, y1024) {
  let dx = x1024 / CANVAS_SCALE - EYE_512[0];
  let dy = y1024 / CANVAS_SCALE - EYE_512[1];
  const c = Math.cos(EYE_TILT);
  const s = Math.sin(EYE_TILT);
  const rx = dx * c + dy * s;
  const ry = -dx * s + dy * c;
  const d = Math.hypot(rx / EYE_RX_512, ry / EYE_RY_512);
  return { d, rx, ry };
}

function eyeSocketWeight(x, y) {
  const { d } = eyeLocal512(x, y);
  return 1 - smoothstep(0.92, 1.08, d);
}

function buildLumaMap(data, width, height, bins = 72) {
  const sums = Array.from({ length: bins }, () => ({ r: 0, g: 0, b: 0, n: 0 }));
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const L = luma(data[i], data[i + 1], data[i + 2]);
    const b = Math.min(bins - 1, Math.floor((L / 255) * bins));
    sums[b].r += data[i];
    sums[b].g += data[i + 1];
    sums[b].b += data[i + 2];
    sums[b].n++;
  }
  const map = sums.map((s) => (s.n ? [s.r / s.n, s.g / s.n, s.b / s.n] : null));
  let last = null;
  for (let i = 0; i < map.length; i++) {
    if (map[i]) last = map[i];
    else map[i] = last;
  }
  last = null;
  for (let i = map.length - 1; i >= 0; i--) {
    if (map[i]) last = map[i];
    else map[i] = last;
  }
  return map;
}

function harmonizeWarmth(foal, standard, width, height) {
  const map = buildLumaMap(standard, width, height);
  const bins = map.length;
  const out = Buffer.from(foal);
  for (let i = 0; i < foal.length; i += 4) {
    if (foal[i + 3] < 128) continue;
    const px = (i / 4) % width;
    const py = Math.floor(i / 4 / width);
    if (eyeSocketWeight(px, py) > 0.02) continue;
    const r = foal[i];
    const g = foal[i + 1];
    const b = foal[i + 2];
    const L = luma(r, g, b);
    if (L < 52) continue;
    const blue = b - Math.max(r, g);
    if (blue > 14 && b > g + 4 && L > 55 && L < 205) continue;
    const bin = Math.min(bins - 1, Math.floor((L / 255) * bins));
    const target = map[bin];
    if (!target) continue;
    const t =
      WARMTH_PEAK * smoothstep(72, 118, L) * (1 - smoothstep(208, 238, L));
    out[i] = clampByte(r * (1 - t) + target[0] * t);
    out[i + 1] = clampByte(g * (1 - t) + target[1] * t);
    out[i + 2] = clampByte(b * (1 - t) + target[2] * t);
  }
  return out;
}

/** Target foal glass-eye blue (iris mid-tone). */
const FOAL_IRIS_BLUE = [98, 115, 162];

function blendFoalIrisBlue(r, g, b, w) {
  const t = clamp(w);
  return [
    clampByte(r * (1 - t) + FOAL_IRIS_BLUE[0] * t),
    clampByte(g * (1 - t) + FOAL_IRIS_BLUE[1] * t),
    clampByte(b * (1 - t) + FOAL_IRIS_BLUE[2] * t),
  ];
}

/** Cool iris mid-tones without touching the dark pupil or cream lids. */
function enhanceEyeBlue(data, width, height) {
  const out = Buffer.from(data);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 128) continue;
      const socket = eyeSocketWeight(x, y);
      if (socket <= 0.02) continue;

      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const L = luma(r, g, b);
      if (L < 38) continue;

      const { d } = eyeLocal512(x, y);
      const blue = b - Math.max(r, g);
      const iris =
        smoothstep(0, 14, blue) *
        smoothstep(44, 128, L) *
        (1 - smoothstep(142, 200, L)) *
        socket;
      const core =
        (1 - smoothstep(0.12, 0.62, d)) * smoothstep(52, 118, L) * socket;
      const w = Math.min(0.52, iris * 0.82 + core * 0.38);
      if (w <= 0.02) continue;

      const [nr, ng, nb] = blendFoalIrisBlue(r, g, b, w);
      out[i] = nr;
      out[i + 1] = ng;
      out[i + 2] = nb;
    }
  }
  return out;
}

async function loadRgba(filePath) {
  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .resize(SIZE, SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: 'mitchell',
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, info };
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

const { data: foalRaw, info } = await sharp(cutoutPath)
  .ensureAlpha()
  .resize(SIZE, SIZE, {
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
    kernel: 'mitchell',
  })
  .raw()
  .toBuffer({ resolveWithObject: true });

const { data: standard } = await loadRgba(STANDARD_REF);
const warmed = harmonizeWarmth(foalRaw, standard, info.width, info.height);
const eyed = enhanceEyeBlue(warmed, info.width, info.height);
const cleaned = dilateRgbIntoTransparent(eyed, info.width, info.height, 2);

if (cutoutArg) {
  await copyFile(cutoutPath, DEFAULT_CUTOUT);
}

await writePng(cleaned, info.width, info.height, OUT_SRC);
await writePng(cleaned, info.width, info.height, OUT_PLUGIN);
await writePng(cleaned, info.width, info.height, OUT_DOCS);

let opaque = 0;
for (let p = 0; p < info.width * info.height; p++) {
  if (cleaned[p * 4 + 3] > 16) opaque++;
}
console.log(
  `installed foal cream cutout from ${path.relative(ROOT, cutoutPath)}`,
);
console.log(
  `  warmth from Standard-OC (up to ${(WARMTH_PEAK * 100).toFixed(0)}% luma match)`,
);
console.log('  eye socket protected + blue iris boost');
console.log(
  `  coverage ${((100 * opaque) / (info.width * info.height)).toFixed(1)}%`,
);
console.log(`  ${path.relative(ROOT, OUT_SRC)}`);
console.log(`  ${path.relative(ROOT, OUT_PLUGIN)}`);

await syncEditor();
