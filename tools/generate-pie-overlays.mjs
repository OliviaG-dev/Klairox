/**
 * Builds white-pattern overlays (pie) stamped to the shared morphology alpha.
 *
 * One mask per pattern, reused on every coat: the white is lit from the clay
 * master so muscle shading survives, and only the silhouette is opaque.
 *
 * Usage:
 *   node tools/generate-pie-overlays.mjs
 *   node tools/generate-pie-overlays.mjs --no-sync
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 512;

const PATTERNS = [
  'tobiano',
  'tovero',
  'overo',
  'splashed-white',
  'sabino',
];

const BUILDS = {
  standard: {
    morph: path.join(
      ROOT,
      'docs/images/horse-base/OC-Standard/morphology-master.png',
    ),
    plugin: (name) =>
      path.join(ROOT, 'plugins/horse/layers/pie', `${name}.png`),
  },
  foal: {
    morph: path.join(ROOT, 'docs/images/horse-base/foal/morphology-master.png'),
    plugin: (name) =>
      path.join(ROOT, 'plugins/horse/layers/pie-foal', `${name}.png`),
  },
};

function clamp(v, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

function clampByte(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function hash(ix, iy, seed) {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + seed * 1274126177;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0, seed);
  const b = hash(x0 + 1, y0, seed);
  const c = hash(x0, y0 + 1, seed);
  const d = hash(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x, y, seed, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 19);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function ellipse(nx, ny, cx, cy, rx, ry) {
  const dx = (nx - cx) / rx;
  const dy = (ny - cy) / ry;
  return Math.sqrt(dx * dx + dy * dy);
}

function blob(nx, ny, cx, cy, rx, ry, inner = 0.62) {
  const d = ellipse(nx, ny, cx, cy, rx, ry);
  return 1 - smoothstep(inner, 1, d);
}

function warp(nx, ny, seed, amount = 0.045) {
  const ox = (fbm(nx * 4.2, ny * 4.2, seed) - 0.5) * 2 * amount;
  const oy = (fbm(nx * 4.2 + 17, ny * 4.2, seed + 3) - 0.5) * 2 * amount;
  return { x: nx + ox, y: ny + oy };
}

/**
 * Pattern coverage in bbox-normalised space.
 * nx: 0 left → 1 right, ny: 0 top → 1 bottom.
 */
function coverage(pattern, nx, ny) {
  const n = fbm(nx * 6.5, ny * 6.5, 11);
  const n2 = fbm(nx * 13, ny * 13, 29);

  switch (pattern) {
    case 'tobiano':
      return tobiano(nx, ny, n, n2);
    case 'overo':
      return overo(nx, ny, n, n2);
    case 'tovero':
      return tovero(nx, ny, n, n2);
    case 'splashed-white':
      return splashed(nx, ny, n, n2);
    case 'sabino':
      return sabino(nx, ny, n, n2);
    default:
      return 0;
  }
}

function tobiano(nx, ny, n, n2) {
  const p = warp(nx, ny, 41, 0.05);
  let v = 0;
  v = Math.max(v, blob(p.x, p.y, 0.56, 0.4, 0.34, 0.18, 0.55));
  v = Math.max(v, blob(p.x, p.y, 0.74, 0.38, 0.24, 0.2, 0.5));
  v = Math.max(v, blob(p.x, p.y, 0.42, 0.34, 0.16, 0.12, 0.55));
  if (ny > 0.6) {
    v = Math.max(v, smoothstep(0.6, 0.68, ny));
  }
  if (nx > 0.86 && ny > 0.28) {
    v = Math.max(v, 0.9 * smoothstep(0.86, 0.92, nx));
  }
  v *= 0.88 + n * 0.22;
  if (ny < 0.22 && nx < 0.5) {
    v *= smoothstep(0.22, 0.3, ny);
  }
  const chest = blob(nx, ny, 0.26, 0.48, 0.16, 0.14, 0.45);
  v *= 1 - chest * 0.92;
  v += (n2 - 0.5) * 0.08;
  return clamp(v);
}

function overo(nx, ny, n, n2) {
  const p = warp(nx, ny, 73, 0.07);
  let v = 0;
  v = Math.max(v, blob(p.x, p.y, 0.48, 0.52, 0.3, 0.13, 0.42));
  v = Math.max(v, blob(p.x, p.y, 0.32, 0.48, 0.18, 0.11, 0.4));
  v = Math.max(v, blob(p.x, p.y, 0.66, 0.5, 0.2, 0.11, 0.4));
  v = Math.max(v, blob(p.x, p.y, 0.3, 0.32, 0.12, 0.16, 0.45));
  const onHead = ny < 0.28 && nx < 0.5;
  if (onHead) {
    v = Math.max(v, smoothstep(0.5, 0.22, nx) * smoothstep(0.28, 0.1, ny));
  }
  v *= 0.75 + n * 0.4 + (n2 - 0.5) * 0.25;
  if (ny < 0.34 && !onHead) {
    v *= smoothstep(0.28, 0.38, ny);
  }
  if (ny > 0.64) {
    v *= 1 - smoothstep(0.64, 0.72, ny);
  }
  return clamp(v);
}

function tovero(nx, ny, n, n2) {
  const p = warp(nx, ny, 91, 0.055);
  let v = 0.72 + n * 0.18;
  v = Math.max(v, tobiano(nx, ny, n, n2));
  v = Math.max(v, overo(nx, ny, n, n2) * 0.85);
  if (ny < 0.28 && nx < 0.52) {
    v = Math.max(v, 0.95);
  }
  if (ny > 0.58) {
    v = Math.max(v, 0.92);
  }
  const ear = blob(p.x, p.y, 0.28, 0.06, 0.12, 0.08, 0.35);
  const chest = blob(p.x, p.y, 0.3, 0.46, 0.12, 0.1, 0.4);
  const flank = blob(p.x, p.y, 0.7, 0.44, 0.14, 0.1, 0.4);
  v *= 1 - ear * 0.95;
  v *= 1 - chest * 0.88;
  v *= 1 - flank * 0.8;
  v += (n2 - 0.5) * 0.06;
  return clamp(v);
}

function splashed(nx, ny, n, n2) {
  const wave =
    0.46 +
    Math.sin(nx * Math.PI * 3.2) * 0.035 +
    (n - 0.5) * 0.06 +
    (n2 - 0.5) * 0.03;
  let v = smoothstep(wave - 0.04, wave + 0.03, ny);
  if (ny < 0.3 && nx < 0.28 && ny > 0.1) {
    const muzzle = smoothstep(0.28, 0.1, nx) * smoothstep(0.1, 0.16, ny);
    v = Math.max(v, muzzle * 0.95);
  }
  if (ny < 0.1) {
    v *= smoothstep(0.04, 0.12, ny);
  }
  v *= 0.92 + n * 0.1;
  return clamp(v);
}

function sabino(nx, ny, n, n2) {
  const p = warp(nx, ny, 53, 0.08);
  const runUp = 0.52 + (n - 0.5) * 0.18 + Math.sin(nx * 9) * 0.04;
  let v = 0;
  if (ny > runUp) {
    v = Math.max(v, smoothstep(runUp, runUp + 0.1, ny));
  }
  v = Math.max(v, blob(p.x, p.y, 0.48, 0.56, 0.28, 0.12, 0.4) * 0.9);
  if (ny < 0.26 && nx < 0.38) {
    const blaze = (1 - smoothstep(0.05, 0.11, Math.abs(nx - 0.24))) * smoothstep(0.26, 0.08, ny);
    v = Math.max(v, blaze);
  }
  if (ny < 0.28 && nx < 0.3 && ny > 0.14) {
    v = Math.max(v, 0.7 * smoothstep(0.3, 0.16, nx));
  }
  const edge = Math.abs(v - 0.5);
  if (edge < 0.32) {
    const speckle = n2 > 0.42 + (0.5 - edge) ? 1 : 0.15;
    v = v * 0.45 + v * speckle * 0.55;
  }
  v *= 0.8 + n * 0.28;
  return clamp(v);
}

function silhouetteBbox(data, width, height) {
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= 16) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY, bw: maxX - minX + 1, bh: maxY - minY + 1 };
}

function blurCoverage(field, width, height, radius) {
  if (radius <= 0) return field;
  const tmp = new Float32Array(field.length);
  const out = new Float32Array(field.length);
  const r = radius;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      let n = 0;
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= width) continue;
        s += field[y * width + nx];
        n++;
      }
      tmp[y * width + x] = s / n;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -r; dy <= r; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        s += tmp[ny * width + x];
        n++;
      }
      out[y * width + x] = s / n;
    }
  }
  return out;
}

function blurRadius(pattern) {
  if (pattern === 'sabino') return 3;
  if (pattern === 'overo') return 2;
  if (pattern === 'splashed-white') return 2;
  return 1;
}

function paintOverlay(morph, pattern) {
  const { data, info } = morph;
  const { width, height } = info;
  const box = silhouetteBbox(data, width, height);
  const field = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] <= 16) continue;
      const nx = (x - box.minX) / box.bw;
      const ny = (y - box.minY) / box.bh;
      field[y * width + x] = coverage(pattern, nx, ny);
    }
  }

  const soft = blurCoverage(field, width, height, blurRadius(pattern));
  const out = Buffer.alloc(width * height * 4);
  const muzzle =
    pattern === 'overo' ||
    pattern === 'tovero' ||
    pattern === 'splashed-white';

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const aSil = data[i + 3];
      if (aSil <= 16) continue;
      let cov = soft[y * width + x];
      if (cov < 0.04) continue;
      cov = smoothstep(0.08, 0.82, cov);

      const nx = (x - box.minX) / box.bw;
      const ny = (y - box.minY) / box.bh;
      const l = luma(data[i], data[i + 1], data[i + 2]) / 255;
      const lift = 0.9;
      let r = data[i] + (248 - data[i]) * lift;
      let g = data[i + 1] + (244 - data[i + 1]) * lift;
      let b = data[i + 2] + (236 - data[i + 2]) * lift;
      r = r * 0.82 + (228 + l * 27) * 0.18;
      g = g * 0.82 + (224 + l * 28) * 0.18;
      b = b * 0.82 + (216 + l * 32) * 0.18;

      if (muzzle && ny < 0.24 && nx < 0.4 && ny > 0.12) {
        const pink = smoothstep(0.4, 0.22, nx) * smoothstep(0.12, 0.18, ny);
        r = r * (1 - pink * 0.18) + 226 * pink * 0.18;
        g = g * (1 - pink * 0.18) + 168 * pink * 0.18;
        b = b * (1 - pink * 0.18) + 156 * pink * 0.18;
      }

      out[i] = clampByte(r);
      out[i + 1] = clampByte(g);
      out[i + 2] = clampByte(b);
      out[i + 3] = clampByte(aSil * cov);
    }
  }

  return { data: out, width, height };
}

async function writePng(buf, width, height, dest) {
  await mkdir(path.dirname(dest), { recursive: true });
  let pipeline = sharp(buf, { raw: { width, height, channels: 4 } });
  if (width !== SIZE || height !== SIZE) {
    pipeline = pipeline.resize(SIZE, SIZE, { kernel: 'mitchell' });
  }
  await pipeline.png({ compressionLevel: 9 }).toFile(dest);
}

async function generateBuild(buildId) {
  const spec = BUILDS[buildId];
  const morph = await sharp(spec.morph)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (const pattern of PATTERNS) {
    const overlay = paintOverlay(morph, pattern);
    const dest = spec.plugin(pattern);
    await writePng(overlay.data, overlay.width, overlay.height, dest);
    console.log('wrote', path.relative(ROOT, dest));
  }
}

async function main() {
  const syncEditor = !process.argv.includes('--no-sync');
  await generateBuild('standard');
  await generateBuild('foal');

  if (!syncEditor) {
    return;
  }
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
