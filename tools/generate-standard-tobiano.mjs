/**
 * Paints a classic tobiano overlay onto the Standard-OC bay cutout.
 * Coverage lives only on the bay alpha, so the pie silhouette matches
 * the morpho 1:1. White is lit from this coat's own form.
 *
 * Usage:
 *   node tools/generate-standard-tobiano.mjs
 */
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 1024;

const WHITE = [238, 230, 220];
const SHADE_MIN = 0.4;
const SHADE_TOP = 0.98;
const SHADE_GAMMA = 0.92;
const SHADE_PCT_LO = 0.02;
const SHADE_PCT_HI = 0.98;
const MATTE_GRAIN = 0;
const SPEC_GAIN = 0.38;

const EDGE_BASE = 0.34;
const EDGE_WIDTH = 0.3;
const EDGE_JITTER = 0.34;
const EDGE_STRAND = 0.45;
const EDGE_FRAY_MIN = 0.25;
const EDGE_LO_MAX = 1 - EDGE_WIDTH - 0.05;

/** Long adult mane hangs down the neck, not bristled like the foal crest. */
const MANE_SMOOTH_RADIUS = 5;
const MANE_ANGLE = Math.PI / 5;
const MANE_ACROSS_FREQ = 2.15;
const MANE_ALONG_FREQ = 0.1;
const MANE_SWING = 0.28;
const MANE_DETAIL = 1.15;
const MANE_SHADE_FLOOR = 0.55;

const MANE_X0 = 280;
const MANE_X1 = 560;
const MANE_Y0 = 24;
const MANE_Y1 = 430;

const LEGS = [
  { x0: 285, x1: 366, yMin: 762, seed: 21, phase: 0.25, tilt: 16, amp: 1 },
  { x0: 382, x1: 461, yMin: 772, seed: 33, phase: 1.15, tilt: -14, amp: 1 },
  { x0: 624, x1: 714, yMin: 642, seed: 47, phase: 0.55, tilt: 18, amp: 1 },
  { x0: 748, x1: 818, yMin: 912, seed: 59, phase: 0.4, tilt: 6, amp: 0.35 },
];

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function chroma(r, g, b) {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function clamp(v, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

function clampByte(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function hash(ix, iy, seed) {
  let n =
    Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + seed * 1274126177;
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
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      let n = 0;
      for (let dx = -radius; dx <= radius; dx++) {
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
      for (let dy = -radius; dy <= radius; dy++) {
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

function dilateBinary(field, width, height, radius) {
  const out = new Float32Array(field.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let max = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const v = field[ny * width + nx];
          if (v > max) max = v;
        }
      }
      out[y * width + x] = max;
    }
  }
  return out;
}

function erodeBinary(field, width, height, radius) {
  const out = new Float32Array(field.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let min = 1;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const v = field[ny * width + nx];
          if (v < min) min = v;
        }
      }
      out[y * width + x] = min;
    }
  }
  return out;
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

function wobbleBlob(nx, ny, cx, cy, rx, ry, inner, seed, amt = 0.3) {
  const dx = (nx - cx) / rx;
  const dy = (ny - cy) / ry;
  const ang = Math.atan2(dy, dx);
  const wobble =
    1 +
    (fbm(Math.cos(ang) * 3.4, Math.sin(ang) * 3.4, seed) - 0.5) * amt +
    (fbm(Math.cos(ang) * 8, Math.sin(ang) * 8, seed + 13) - 0.5) * amt * 0.4;
  const d = Math.hypot(dx, dy) / wobble;
  return 1 - smoothstep(inner, 1, d);
}

/** Wavy sock line, unique per leg — not a ruler-straight cannon band. */
function sockTopY(x, leg) {
  const span = Math.max(1, leg.x1 - leg.x0);
  const t = (x - leg.x0) / span;
  const wave = Math.sin((t + leg.phase) * Math.PI * 1.5) * 20;
  const tilt = (t - 0.42) * leg.tilt;
  const slow = (fbm(x * 0.03, 14, leg.seed, 3) - 0.5) * 32;
  const nibble = (fbm(x * 0.18, 31, leg.seed + 11, 2) - 0.5) * 16;
  const amp = leg.amp ?? 1;
  return leg.yMin + (wave + tilt + slow + nibble) * amp;
}

function inManeBox(x, y) {
  return x >= MANE_X0 && x <= MANE_X1 && y >= MANE_Y0 && y <= MANE_Y1;
}

/** Soft disc between the ears so the forelock stays bay. */
function forelockWeight(x, y) {
  const nx = x - 318;
  const ny = y - 72;
  return smoothstep(48, 18, Math.hypot(nx * 1.2, ny));
}

function isTailPixel(x, y, bay, width) {
  if (x < 808) return false;
  if (x >= 836 && y < 910) return true;
  if (y >= 860) return false;
  const i = (y * width + x) * 4;
  if (bay[i + 3] < 16) return false;
  const L = luma(bay[i], bay[i + 1], bay[i + 2]);
  const C = chroma(bay[i], bay[i + 1], bay[i + 2]);
  return L < 90 && C < 50;
}

function maneWeight(bay, x, y, width) {
  if (!inManeBox(x, y)) return 0;
  const lock = 1 - forelockWeight(x, y);
  if (lock < 0.04) return 0;
  const i = (y * width + x) * 4;
  if (bay[i + 3] < 16) return 0;
  const L = luma(bay[i], bay[i + 1], bay[i + 2]);
  const C = chroma(bay[i], bay[i + 1], bay[i + 2]);
  return lock * smoothstep(88, 40, L) * smoothstep(52, 18, C);
}

function maneField(bay, width, height) {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      out[y * width + x] = maneWeight(bay, x, y, width);
    }
  }
  return blurCoverage(out, width, height, 2);
}

function growWhiteMane(field, bay, width, height) {
  const colHasWhite = new Uint8Array(width);
  for (let y = MANE_Y0; y <= MANE_Y1; y++) {
    for (let x = MANE_X0; x <= MANE_X1; x++) {
      if (field[y * width + x] > 0.4) colHasWhite[x] = 1;
    }
  }
  for (let x = MANE_X0; x <= MANE_X1; x++) {
    let nearby = colHasWhite[x];
    for (let dx = -8; dx <= 8 && !nearby; dx++) {
      const nx = x + dx;
      if (nx < MANE_X0 || nx > MANE_X1) continue;
      if (colHasWhite[nx]) nearby = 1;
    }
    if (!nearby) continue;
    for (let y = MANE_Y0; y <= MANE_Y1; y++) {
      const p = y * width + x;
      if (bay[p * 4 + 3] < 16) continue;
      const w = maneWeight(bay, x, y, width);
      if (w < 0.06) continue;
      field[p] = Math.max(field[p], w);
    }
  }
}

function nearVoid(bay, width, height, x, y, radius = 2) {
  if (x < radius || y < radius || x >= width - radius || y >= height - radius) {
    return true;
  }
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (bay[((y + dy) * width + (x + dx)) * 4 + 3] < 16) return true;
    }
  }
  return false;
}

/**
 * Matches the classic tobiano layout: white neck/mane, white over the
 * back, a large barrel that wraps the belly, croup patch, coloured
 * chest/flank/hip. Socks are painted separately.
 */
function standardTobiano(nx, ny, n, n2) {
  const p = {
    x: nx + (n - 0.5) * 0.024,
    y: ny + (n2 - 0.5) * 0.024,
  };
  let v = 0;
  v = Math.max(v, wobbleBlob(p.x, p.y, 0.3, 0.26, 0.15, 0.2, 0.34, 41, 0.36));
  v = Math.max(v, wobbleBlob(p.x, p.y, 0.34, 0.34, 0.13, 0.15, 0.36, 47, 0.34));
  v = Math.max(v, wobbleBlob(nx, ny, 0.5, 0.27, 0.24, 0.11, 0.32, 53, 0.3));
  v = Math.max(v, wobbleBlob(p.x, p.y, 0.52, 0.4, 0.17, 0.16, 0.3, 59, 0.4));
  v = Math.max(v, wobbleBlob(nx, ny, 0.5, 0.54, 0.2, 0.13, 0.28, 89, 0.4));
  v = Math.max(v, wobbleBlob(nx, ny, 0.74, 0.29, 0.13, 0.1, 0.32, 73, 0.36));
  v *= 1 - blob(nx, ny, 0.22, 0.5, 0.16, 0.16, 0.38) * 0.97;
  v *= 1 - wobbleBlob(nx, ny, 0.64, 0.44, 0.1, 0.11, 0.3, 81, 0.4) * 0.9;
  v *= 1 - blob(nx, ny, 0.74, 0.46, 0.13, 0.13, 0.38) * 0.9;
  if (nx < 0.28 && ny < 0.38) {
    v *= smoothstep(0.16, 0.3, nx) * smoothstep(0.26, 0.4, ny);
  }
  if (nx > 0.86 && ny > 0.34) {
    v *= 1 - smoothstep(0.86, 0.94, nx);
  }
  v *= 0.9 + n * 0.18;
  v += (n2 - 0.5) * 0.05;
  return clamp(v);
}

function hairEdge(field, mane, silhouette, width, height, seed = 61) {
  const out = new Float32Array(field.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const cov = field[p];
      if (cov <= 0.002) continue;
      if (silhouette[p] && cov > 0.28) {
        out[p] = 1;
        continue;
      }
      const wobble = fbm(x * 0.55 + y * 0.14, y * 0.9, seed, 4) - 0.5;
      const strand = fbm(x * 0.14 + y * 0.05, y * 0.42, seed + 23, 2) - 0.5;
      const fray = EDGE_FRAY_MIN + fbm(x * 0.045, y * 0.05, seed + 41, 3);
      const calm = 1 - mane[p];
      const lo = clamp(
        EDGE_BASE + (wobble * EDGE_JITTER + strand * EDGE_STRAND * fray) * calm,
        0.06,
        EDGE_LO_MAX,
      );
      const band = EDGE_WIDTH + mane[p] * 0.28;
      out[p] = clamp(smoothstep(lo, lo + band, cov));
    }
  }
  return out;
}

function formLight(p, palLuma, bayLuma, palForm, bayForm, maneW = 0) {
  const palN = clamp((palForm[p] - 0.12) / 0.78);
  const bayN = clamp((bayForm[p] - 0.06) / 0.55);
  const palMix = 0.62 * (1 - maneW * 0.22);
  const L = clamp(
    palN * palMix +
      bayN * (1 - palMix) * (1 - maneW * 0.55) +
      (palLuma[p] - palForm[p]) * (0.55 + maneW * 0.45) +
      (bayLuma[p] - bayForm[p]) * (0.42 + maneW * 1.15),
  );
  return L < 0.5
    ? 0.5 * Math.pow(L * 2, 1.45)
    : 1 - 0.5 * Math.pow((1 - L) * 2, 1.05);
}

function paintOverlay(soft, mane, palomino, bay, width, height) {
  const palLuma = new Float32Array(width * height);
  const bayLuma = new Float32Array(width * height);
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    palLuma[p] = luma(palomino[i], palomino[i + 1], palomino[i + 2]) / 255;
    bayLuma[p] = luma(bay[i], bay[i + 1], bay[i + 2]) / 255;
  }
  const palForm = blurCoverage(palLuma, width, height, 7);
  const bayForm = blurCoverage(bayLuma, width, height, 7);
  const out = Buffer.alloc(width * height * 4);

  const samples = [];
  for (let p = 0; p < width * height; p++) {
    if (soft[p] < 0.5 || bay[p * 4 + 3] < 16) continue;
    samples.push(formLight(p, palLuma, bayLuma, palForm, bayForm, mane[p]));
  }
  samples.sort((a, b) => a - b);
  const pick = (q) => samples[Math.floor(q * (samples.length - 1))] ?? 0.5;
  const loLight = samples.length ? pick(SHADE_PCT_LO) : 0.2;
  const hiLight = samples.length ? pick(SHADE_PCT_HI) : 0.9;
  const lightSpan = Math.max(1e-3, hiLight - loLight);

  const shadeField = new Float32Array(width * height);
  for (let p = 0; p < width * height; p++) {
    if (soft[p] < 0.06 || bay[p * 4 + 3] < 16) continue;
    const x = p % width;
    const y = (p / width) | 0;
    const t = formLight(p, palLuma, bayLuma, palForm, bayForm, mane[p]);
    const grain = (fbm(x * 1.1 + y * 0.3, y * 1.7, 29, 3) - 0.5) * MATTE_GRAIN;
    const lit = clamp((t - loLight) / lightSpan);
    shadeField[p] = clamp(
      SHADE_MIN + (SHADE_TOP - SHADE_MIN) * Math.pow(lit, SHADE_GAMMA) + grain,
      0,
      SHADE_TOP,
    );
  }
  const maneFlat = blurCoverage(shadeField, width, height, MANE_SMOOTH_RADIUS);
  const cosA = Math.cos(MANE_ANGLE);
  const sinA = Math.sin(MANE_ANGLE);

  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    const cov = soft[p];
    if (cov < 0.06 || bay[i + 3] < 16) continue;
    const x = p % width;
    const y = (p / width) | 0;
    let shade = shadeField[p];
    const m = mane[p];
    if (m > 0.01) {
      const warp = (fbm(x * 0.09, y * 0.11, 83, 2) - 0.5) * 3.5;
      const across = x * cosA + y * sinA + warp;
      const along = y * cosA - x * sinA;
      const strand =
        fbm(across * MANE_ACROSS_FREQ, along * MANE_ALONG_FREQ, 71, 3) - 0.5;
      const split =
        fbm(across * MANE_ACROSS_FREQ * 2.3, along * 0.22, 97, 2) - 0.5;
      const hairMicro = shadeField[p] - maneFlat[p];
      const combed =
        maneFlat[p] * (1 + strand * 2.35 * MANE_SWING + split * 0.28) +
        hairMicro * MANE_DETAIL;
      shade = clamp(shade * (1 - m) + combed * m, MANE_SHADE_FLOOR, SHADE_TOP);
    }
    const spec =
      Math.max(0, palLuma[p] - palForm[p]) * SPEC_GAIN +
      Math.max(0, bayLuma[p] - bayForm[p]) * (SPEC_GAIN * 0.7);
    shade = clamp(shade + spec * (1 - m * 0.25), 0, SHADE_TOP);
    out[i] = clampByte(WHITE[0] * shade);
    out[i + 1] = clampByte(WHITE[1] * shade);
    out[i + 2] = clampByte(WHITE[2] * shade);
    out[i + 3] = Math.min(bay[i + 3], clampByte(255 * cov));
  }
  return out;
}

/** Keep low coronet socks from climbing the fetlock knob. */
function clipShortSocks(soft, binary, width) {
  for (const leg of LEGS) {
    if ((leg.amp ?? 1) >= 0.5) continue;
    for (let x = leg.x0 - 8; x <= leg.x1 + 8; x++) {
      if (x < 0 || x >= width) continue;
      const cut = sockTopY(x, leg) - 4;
      for (let y = 0; y < cut; y++) {
        const p = y * width + x;
        soft[p] = 0;
        binary[p] = 0;
      }
    }
  }
}

function dropTinyBlobs(buf, width, height, minArea) {
  const seen = new Uint8Array(width * height);
  const out = Buffer.from(buf);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const start = y * width + x;
      if (seen[start] || buf[start * 4 + 3] < 8) continue;
      const stack = [start];
      const cells = [];
      seen[start] = 1;
      while (stack.length > 0) {
        const p = stack.pop();
        cells.push(p);
        const cx = p % width;
        const cy = (p / width) | 0;
        for (const [dx, dy] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const np = ny * width + nx;
          if (seen[np] || buf[np * 4 + 3] < 8) continue;
          seen[np] = 1;
          stack.push(np);
        }
      }
      if (cells.length < minArea) {
        for (const p of cells) out[p * 4 + 3] = 0;
      }
    }
  }
  return out;
}

async function loadRaw(file) {
  return sharp(file)
    .ensureAlpha()
    .resize(SIZE, SIZE, { kernel: 'mitchell' })
    .raw()
    .toBuffer({ resolveWithObject: true });
}

async function writePng(buf, dest) {
  await mkdir(path.dirname(dest), { recursive: true });
  await sharp(buf, { raw: { width: SIZE, height: SIZE, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(dest);
}

async function compositeOnBay(overlay, bayPath, dest) {
  const overlayRaw = await sharp(overlay)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bay = await sharp(bayPath).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  const { width, height } = overlayRaw.info;
  const out = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    const a = overlayRaw.data[i + 3] / 255;
    out[i] = clampByte(bay.data[i] * (1 - a) + overlayRaw.data[i] * a);
    out[i + 1] = clampByte(
      bay.data[i + 1] * (1 - a) + overlayRaw.data[i + 1] * a,
    );
    out[i + 2] = clampByte(
      bay.data[i + 2] * (1 - a) + overlayRaw.data[i + 2] * a,
    );
    out[i + 3] = bay.data[i + 3];
  }
  await sharp(out, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(dest);
}

function reportMatch(overlay, bay, width, height) {
  let pieOn = 0;
  let pieOut = 0;
  let rimGap = 0;
  let rimGapNeck = 0;
  let rimGapLegs = 0;
  const nearPie = (x, y, r) => {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (overlay[(ny * width + nx) * 4 + 3] > 80) return true;
      }
    }
    return false;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const ba = bay[i + 3];
      const pa = overlay[i + 3];
      if (pa > 24) {
        pieOn++;
        if (ba < 16) pieOut++;
      }
      if (
        ba > 24 &&
        pa < 16 &&
        nearVoid(bay, width, height, x, y, 2) &&
        nearPie(x, y, 6)
      ) {
        rimGap++;
        if (y < height * 0.45 && x > width * 0.25 && x < width * 0.55)
          rimGapNeck++;
        if (y > height * 0.55) rimGapLegs++;
      }
    }
  }
  console.log(
    JSON.stringify({ pieOn, pieOut, rimGap, rimGapNeck, rimGapLegs }),
  );
}

async function main() {
  const bayMaster = path.join(
    ROOT,
    'docs/images/horse-base/OC-Standard/coat-master-bay.png',
  );
  const bay = await loadRaw(bayMaster);
  const pal = await loadRaw(
    path.join(ROOT, 'plugins/horse/layers/coat/palomino.png'),
  );
  const { width, height } = bay.info;
  const box = silhouetteBbox(bay.data, width, height);
  const colTop = new Int16Array(width).fill(-1);
  const colBot = new Int16Array(width).fill(-1);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if (bay.data[(y * width + x) * 4 + 3] < 16) continue;
      if (colTop[x] < 0) colTop[x] = y;
      colBot[x] = y;
    }
  }

  let field = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (bay.data[i + 3] < 16) continue;
      if (isTailPixel(x, y, bay.data, width)) continue;
      const nx = (x - box.minX) / box.bw;
      const ny = (y - box.minY) / box.bh;
      const n = fbm(nx * 6.5, ny * 6.5, 11);
      const n2 = fbm(nx * 13, ny * 13, 28);
      let v = standardTobiano(nx, ny, n, n2);
      const top = colTop[x];
      const bot = colBot[x];
      if (bot > top && bot > height * 0.7) {
        for (const leg of LEGS) {
          if (x < leg.x0 || x > leg.x1) continue;
          const yMin = sockTopY(x, leg);
          if (y >= yMin - 8) {
            v = Math.max(v, smoothstep(yMin - 6, yMin + 12, y));
          }
        }
      }
      field[y * width + x] = v;
    }
  }

  for (const leg of LEGS) {
    for (let x = leg.x0; x <= leg.x1; x++) {
      const top = colTop[x];
      const bot = colBot[x];
      if (bot <= top) continue;
      const yMin = sockTopY(x, leg);
      for (let y = bot; y >= Math.max(top, Math.floor(yMin) - 6); y--) {
        const p = y * width + x;
        if (bay.data[p * 4 + 3] < 16) continue;
        if (isTailPixel(x, y, bay.data, width)) continue;
        if (field[p] > 0.45) {
          if (nearVoid(bay.data, width, height, x, y, 2)) field[p] = 1;
          continue;
        }
        let neighbor = false;
        for (let dx = -2; dx <= 2 && !neighbor; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          if (field[y * width + nx] > 0.5) neighbor = true;
          if (y + 1 < height && field[(y + 1) * width + nx] > 0.5) {
            neighbor = true;
          }
        }
        if (neighbor && nearVoid(bay.data, width, height, x, y, 3)) {
          field[p] = 1;
        }
      }
    }
  }

  growWhiteMane(field, bay.data, width, height);
  field = blurCoverage(field, width, height, 2);

  let binary = new Float32Array(width * height);
  for (let p = 0; p < field.length; p++) {
    binary[p] = field[p] > 0.38 ? 1 : 0;
  }
  binary = erodeBinary(
    dilateBinary(binary, width, height, 2),
    width,
    height,
    2,
  );
  binary = dilateBinary(
    erodeBinary(binary, width, height, 3),
    width,
    height,
    3,
  );
  const rounded = blurCoverage(binary, width, height, 5);
  for (let p = 0; p < binary.length; p++) {
    binary[p] = rounded[p] > 0.48 ? 1 : 0;
  }
  for (const leg of LEGS) {
    for (let x = leg.x0; x <= leg.x1; x++) {
      const bot = colBot[x];
      if (bot < 0) continue;
      const yMin = sockTopY(x, leg);
      const pad = (leg.amp ?? 1) < 0.5 ? 6 : 18;
      for (let y = Math.floor(yMin) - pad; y <= bot; y++) {
        if (y < 0 || y >= height) continue;
        const p = y * width + x;
        if (bay.data[p * 4 + 3] < 16) continue;
        if (isTailPixel(x, y, bay.data, width)) {
          binary[p] = 0;
          continue;
        }
        binary[p] = y >= yMin ? 1 : 0;
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isTailPixel(x, y, bay.data, width)) binary[y * width + x] = 0;
    }
  }

  const maneMask = maneField(bay.data, width, height);
  const maneCalm = blurCoverage(maneMask, width, height, 5);
  for (let p = 0; p < maneCalm.length; p++) {
    maneCalm[p] = clamp(maneCalm[p] * 2.4);
  }

  const silhouette = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (bay.data[p * 4 + 3] < 24) continue;
      if (nearVoid(bay.data, width, height, x, y, 2)) silhouette[p] = 1;
    }
  }

  const soft = hairEdge(
    blurCoverage(binary, width, height, 4),
    maneCalm,
    silhouette,
    width,
    height,
  );
  growWhiteMane(soft, bay.data, width, height);
  for (const leg of LEGS) {
    for (let x = leg.x0; x <= leg.x1; x++) {
      const bot = colBot[x];
      if (bot < 0) continue;
      const yMin = sockTopY(x, leg);
      const pad = (leg.amp ?? 1) < 0.5 ? 8 : 22;
      for (let y = Math.floor(yMin) - pad; y <= bot; y++) {
        if (y < 0 || y >= height) continue;
        const p = y * width + x;
        if (bay.data[p * 4 + 3] < 16) continue;
        if (isTailPixel(x, y, bay.data, width)) {
          soft[p] = 0;
          continue;
        }
        const fringe = (fbm(x * 0.22, y * 0.12, leg.seed + 19, 3) - 0.5) * 14;
        const top = yMin + fringe;
        if (y >= top + 10) soft[p] = 1;
        else if (y <= top - 10) {
          soft[p] = 0;
        } else {
          soft[p] = Math.max(soft[p], smoothstep(top - 8, top + 8, y));
        }
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (bay.data[p * 4 + 3] < 16) {
        soft[p] = 0;
        continue;
      }
      if (isTailPixel(x, y, bay.data, width)) {
        soft[p] = 0;
        continue;
      }
      if (silhouette[p] && (binary[p] > 0.5 || soft[p] > 0.28)) {
        soft[p] = 1;
      }
    }
  }
  clipShortSocks(soft, binary, width);

  const painted = dropTinyBlobs(
    paintOverlay(soft, maneCalm, pal.data, bay.data, width, height),
    width,
    height,
    200,
  );

  const plugin = path.join(ROOT, 'plugins/horse/layers/pie/tobiano.png');
  const docs = path.join(
    ROOT,
    'docs/images/horse-base/OC-Standard/pie/easy-tobiano-05.png',
  );
  const preview = path.join(
    ROOT,
    'docs/images/horse-base/OC-Standard/pie/tobiano-on-bay.png',
  );
  const sourceOverlay = path.join(
    ROOT,
    'docs/images/horse-source/pie/tobiano-standard-overlay.png',
  );
  await writePng(painted, plugin);
  await writePng(painted, docs);
  await writePng(painted, sourceOverlay);
  await compositeOnBay(plugin, bayMaster, preview);
  reportMatch(painted, bay.data, width, height);
  console.log('wrote', path.relative(ROOT, plugin));
  console.log('wrote', path.relative(ROOT, preview));

  const sync = spawnSync(
    process.execPath,
    [path.join(ROOT, 'tools/sync-editor-horse-plugin.mjs')],
    { cwd: ROOT, stdio: 'inherit' },
  );
  if (sync.status !== 0) {
    throw new Error('editor plugin sync failed');
  }
}

await main();
