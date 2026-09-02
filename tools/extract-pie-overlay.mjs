/**
 * Builds a pie overlay from a photoreal piebald horse: align to the
 * Standard-OC morph, keep the white patches, shade them from the palomino
 * coat (light, grain, flaxen mane), leave the base coat transparent.
 *
 * Usage:
 *   node tools/extract-pie-overlay.mjs <horse.png> <out.png> [--base layers/coat/bay.png]
 */
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 512;

/**
 * Lit end of the warm clay white shared by the face markings and the
 * procedural pie overlays, so a patch and a blaze read as the same hair.
 */
const WHITE = [252, 248, 241];

/**
 * Shading is normalised on the patches' *own* light rather than run through an
 * absolute ramp: the darkest and brightest of it are mapped onto the ends of
 * the white, so neither the shaded underside nor the lit back collapses onto a
 * single value. The gamma keeps the bulk of the coat up at the white the face
 * markings share, leaving the lower range for the shadows.
 */
const SHADE_MIN = 0.64;
const SHADE_TOP = 1;
const SHADE_GAMMA = 0.95;
/** Local unsharp on form light, so muscle cups read instead of a global wash. */
const FORM_CONTRAST = 1.55;
const FORM_CONTRAST_RADIUS = 14;
const SHADE_PCT_LO = 0.02;
const SHADE_PCT_HI = 0.98;

/** Weights of the fine detail on top of the morph clay form. */
const DETAIL_PAL = 0.55;
const DETAIL_BAY = 0.58;
const DETAIL_FORM = 1.0;

/** Fine coat grain plus a slower mottle, so the patch reads as matte hair. */
const MATTE_GRAIN = 0.06;
const MATTE_MOTTLE = 0.04;

/**
 * Mane locks come from the aligned source horse, remapped onto the patch
 * white. A 1px blur only antialiases; more than that turns the hair into felt.
 */
const MANE_PAINT_BLUR = 1;

/**
 * Coverage band the patch edge fades across, then the two noises that break it
 * up: `JITTER` bends the boundary over a few pixels, `STRAND` pushes it back
 * and forth by about a hair's width so single hairs cross into the other
 * colour, and `FRAY` modulates that so the boundary runs almost clean for a
 * stretch and then frays instead of serrating evenly.
 */
const EDGE_BASE = 0.38;
const EDGE_WIDTH = 0.42;
const EDGE_JITTER = 0.12;
const EDGE_STRAND = 0.16;
const EDGE_FRAY_MIN = 0.25;
/** Jitter has to leave the top of the ramp below 1, or the interior pits. */
const EDGE_LO_MAX = 1 - EDGE_WIDTH - 0.05;

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
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

function chroma(r, g, b) {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function clamp(v, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

function clampByte(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function morphEdgeDist(morph, width, height, x, y, maxR = 3) {
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return r;
        if (morph[(ny * width + nx) * 4 + 3] < 16) return r;
      }
    }
  }
  return maxR + 1;
}

/** Drops studio-white halo on the silhouette; keeps interior pie patches. */
function defringeSilhouette(overlay, morph, width, height, edgePx = 2) {
  const out = Buffer.from(overlay);
  const lumaAt = (buf, i) =>
    0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (out[i + 3] < 8) continue;
      if (morph[i + 3] < 24) {
        out[i + 3] = 0;
        continue;
      }
      out[i + 3] = Math.min(out[i + 3], morph[i + 3]);
      const edge = morphEdgeDist(morph, width, height, x, y, edgePx + 1);
      if (edge <= edgePx) {
        out[i + 3] = clampByte(out[i + 3] * (edge / (edgePx + 1)));
      }
    }
  }

  // Second pass: 1px specks and hairline strokes
  const cleaned = Buffer.from(out);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (out[i + 3] < 180) continue;
      if (lumaAt(out, i) < 160) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const j = (ny * width + nx) * 4;
          if (out[j + 3] > 24) n++;
        }
      }
      if (n <= 2) {
        cleaned[i + 3] = 0;
      }
    }
  }
  return dropTinyBlobs(cleaned, width, height, 12);
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
        for (const p of cells) {
          out[p * 4 + 3] = 0;
        }
      }
    }
  }
  return out;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * A tobiano boundary is a couple of hairs wide, not an airbrush: the blur that
 * rounds the blobs has to be pulled back into a narrow band, with the threshold
 * jittered so the rim breaks into hair and not a clean vector curve.
 */
function hairEdge(field, mane, width, height, seed = 61) {
  const scale = width / SIZE;
  const out = new Float32Array(field.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const cov = field[p];
      if (cov <= 0.002) continue;
      const nx = x / scale;
      const ny = y / scale;
      const wobble = fbm(nx * 0.55 + ny * 0.14, ny * 0.9, seed, 4) - 0.5;
      // Stretched along the body so the fringe reads as lying hair, over two
      // octaves so the strands vary in length instead of combing evenly.
      const strand = fbm(nx * 0.14 + ny * 0.05, ny * 0.42, seed + 23, 2) - 0.5;
      const fray = EDGE_FRAY_MIN + fbm(nx * 0.045, ny * 0.05, seed + 41, 3);
      // Mane hair hangs in long locks, so the crest keeps a clean line: the
      // coat fringe is faded out wherever the mane mask takes over.
      const calm = 1 - mane[p];
      const lo = clamp(
        EDGE_BASE + (wobble * EDGE_JITTER + strand * EDGE_STRAND * fray) * calm,
        0.06,
        EDGE_LO_MAX,
      );
      // Crest hair is a soft lock, not a pixel stair: widen the coverage ramp
      // wherever the mane takes over so the silhouette antialiases.
      const band = EDGE_WIDTH + mane[p] * 0.38;
      out[p] = clamp(smoothstep(lo, lo + band, cov));
    }
  }
  return out;
}

/** Same warm clay-lit white as the face-marking extract, so pie matches a blaze. */
function whiteFromMorph(morph, i) {
  const l = luma(morph[i], morph[i + 1], morph[i + 2]) / 255;
  const lift = 0.9;
  let r = morph[i] + (248 - morph[i]) * lift;
  let g = morph[i + 1] + (244 - morph[i + 1]) * lift;
  let b = morph[i + 2] + (236 - morph[i + 2]) * lift;
  r = r * 0.82 + (228 + l * 27) * 0.18;
  g = g * 0.82 + (224 + l * 28) * 0.18;
  b = b * 0.82 + (216 + l * 32) * 0.18;
  return [r, g, b];
}

/** Morph clay as the form, coat luma as the hair grain on top of it. */
function formLight(
  p,
  morphLuma,
  morphBlur,
  palLuma,
  bayLuma,
  palBlur,
  bayBlur,
) {
  const broad = morphBlur[p];
  const detail =
    (morphLuma[p] - morphBlur[p]) * DETAIL_FORM +
    (palLuma[p] - palBlur[p]) * DETAIL_PAL +
    (bayLuma[p] - bayBlur[p]) * DETAIL_BAY;
  return clamp(broad + detail);
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

/** Search window for crest locks — not a paint mask. Morph alpha is the real clip. */
const MANE_X0 = 145;
const MANE_X1 = 310;
const MANE_Y0 = 24;
const MANE_Y1 = 240;

function inManeBox(x, y, scale) {
  if (x < MANE_X0 * scale || x > MANE_X1 * scale) return false;
  if (y < MANE_Y0 * scale || y > MANE_Y1 * scale) return false;
  return true;
}

/** Soft disc between the ears so the forelock stays dark without a 90° cut. */
function forelockWeight(x, y, scale) {
  const nx = x / scale - 160;
  const ny = y / scale - 50;
  return smoothstep(42, 18, Math.hypot(nx * 1.25, ny));
}

function isManeHair(bay, x, y, width) {
  return maneWeight(bay, x, y, width) > 0.45;
}

/** 0–1: dark low-chroma bay hair in the mane box. Soft edge, not a hard cut. */
function maneWeight(bay, x, y, width) {
  const scale = width / SIZE;
  if (!inManeBox(x, y, scale)) return 0;
  const lock = 1 - forelockWeight(x, y, scale);
  if (lock < 0.04) return 0;
  const i = (y * width + x) * 4;
  if (bay[i + 3] < 16) return 0;
  const L = luma(bay[i], bay[i + 1], bay[i + 2]);
  const C = chroma(bay[i], bay[i + 1], bay[i + 2]);
  return lock * smoothstep(88, 40, L) * smoothstep(52, 18, C);
}

/** maneWeight over the whole canvas, softened so it can be used as a blend. */
function maneField(bay, morph, width, height) {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (morph[p * 4 + 3] < 16) continue;
      out[p] = maneWeight(bay, x, y, width);
    }
  }
  return blurCoverage(out, width, height, 2);
}

function clipToMorph(buf, morph, size) {
  for (let p = 0; p < size * size; p++) {
    const i = p * 4;
    if (morph[i + 3] < 8) buf[i + 3] = 0;
    else buf[i + 3] = Math.min(buf[i + 3], morph[i + 3]);
  }
}

function blurRgbMasked(buf, mask, width, height, radius) {
  const tmp = Buffer.alloc(buf.length);
  buf.copy(tmp);
  const out = Buffer.from(buf);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (mask[p] < 0.2) continue;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let wsum = 0;
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= width) continue;
        const np = y * width + nx;
        const w = mask[np] * (buf[np * 4 + 3] / 255);
        if (w < 0.05) continue;
        const i = np * 4;
        sr += buf[i] * w;
        sg += buf[i + 1] * w;
        sb += buf[i + 2] * w;
        wsum += w;
      }
      if (wsum < 0.05) continue;
      const i = p * 4;
      tmp[i] = clampByte(sr / wsum);
      tmp[i + 1] = clampByte(sg / wsum);
      tmp[i + 2] = clampByte(sb / wsum);
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (mask[p] < 0.2) continue;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let wsum = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        const np = ny * width + x;
        const w = mask[np] * (tmp[np * 4 + 3] / 255);
        if (w < 0.05) continue;
        const i = np * 4;
        sr += tmp[i] * w;
        sg += tmp[i + 1] * w;
        sb += tmp[i + 2] * w;
        wsum += w;
      }
      if (wsum < 0.05) continue;
      const i = p * 4;
      const k = clamp(mask[p]);
      out[i] = clampByte(out[i] * (1 - k) + (sr / wsum) * k);
      out[i + 1] = clampByte(out[i + 1] * (1 - k) + (sg / wsum) * k);
      out[i + 2] = clampByte(out[i + 2] * (1 - k) + (sb / wsum) * k);
    }
  }
  return out;
}

/** Grow white into the mane where the pie already crosses the crest. */
function growWhiteMane(field, horse, bay, morph, width) {
  const scale = width / SIZE;
  const x0 = Math.round(MANE_X0 * scale);
  const x1 = Math.round(MANE_X1 * scale);
  const y0 = Math.round(MANE_Y0 * scale);
  const y1 = Math.round(MANE_Y1 * scale);

  const colHasWhite = new Uint8Array(width);
  const colStart = new Int32Array(width).fill(-1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (field[y * width + x] > 0.45) {
        colHasWhite[x] = 1;
        if (colStart[x] < 0) colStart[x] = y;
      }
    }
  }

  for (let x = x0; x <= x1; x++) {
    if (
      !colHasWhite[x] &&
      !colHasWhite[Math.max(x0, x - 2)] &&
      !colHasWhite[Math.min(x1, x + 2)]
    ) {
      continue;
    }
    let startY = y1;
    for (let nx = x - 2; nx <= x + 2; nx++) {
      if (nx < x0 || nx > x1 || colStart[nx] < 0) continue;
      if (colStart[nx] < startY) startY = colStart[nx];
    }
    for (let y = startY; y <= y1; y++) {
      const p = y * width + x;
      const i = p * 4;
      if (morph[i + 3] < 16) continue;
      const lock = 1 - forelockWeight(x, y, scale);
      if (lock < 0.08) continue;
      const hL = luma(horse[i], horse[i + 1], horse[i + 2]);
      const hC = chroma(horse[i], horse[i + 1], horse[i + 2]);
      if (hL > 148 && hC < 46) {
        field[p] = Math.max(field[p], lock * smoothstep(148, 188, hL));
        continue;
      }
      if (!isManeHair(bay, x, y, width)) continue;
      field[p] = Math.max(field[p], lock);
    }
  }
}

async function resizeRaw(data, width, height, size, kernel) {
  return sharp(data, { raw: { width, height, channels: 4 } })
    .resize(size, size, { kernel })
    .raw()
    .toBuffer({ resolveWithObject: true });
}

function parseArgs(argv) {
  let base = path.join(ROOT, 'plugins/horse/layers/coat/bay.png');
  let aligned = false;
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') {
      base = path.resolve(argv[++i] ?? '');
      continue;
    }
    if (argv[i] === '--aligned') {
      aligned = true;
      continue;
    }
    positional.push(argv[i]);
  }
  return {
    src: positional[0] ? path.resolve(positional[0]) : '',
    dest: positional[1] ? path.resolve(positional[1]) : '',
    base,
    aligned,
  };
}

async function main() {
  const {
    src,
    dest,
    base,
    aligned: alreadyAligned,
  } = parseArgs(process.argv.slice(2));
  if (!src || !dest) {
    console.error(
      'Usage: node tools/extract-pie-overlay.mjs <horse.png> <out.png> [--base bay.png] [--aligned]',
    );
    process.exitCode = 1;
    return;
  }

  let aligned = src;
  if (!alreadyAligned) {
    aligned = path.join(ROOT, 'tmp', 'pie-extract-aligned.png');
    const cut = spawnSync(
      process.execPath,
      [path.join(ROOT, 'tools/cutout-on-morph.mjs'), src, aligned],
      { stdio: 'inherit' },
    );
    if (cut.status !== 0) {
      process.exitCode = cut.status ?? 1;
      return;
    }
  }

  const horse512 = await sharp(aligned)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bay512 = await sharp(base)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const palomino512 = await sharp(
    path.join(ROOT, 'plugins/horse/layers/coat/palomino.png'),
  )
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const morph512 = await sharp(
    path.join(ROOT, 'docs/images/horse-base/OC-Standard/morphology-master.png'),
  )
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const WORK = 1024;
  const horse = await resizeRaw(
    horse512.data,
    horse512.info.width,
    horse512.info.height,
    WORK,
    'mitchell',
  );
  const bay = await resizeRaw(
    bay512.data,
    bay512.info.width,
    bay512.info.height,
    WORK,
    'mitchell',
  );
  const palomino = await resizeRaw(
    palomino512.data,
    palomino512.info.width,
    palomino512.info.height,
    WORK,
    'mitchell',
  );
  const morphHi = await resizeRaw(
    morph512.data,
    morph512.info.width,
    morph512.info.height,
    WORK,
    'mitchell',
  );

  const { width, height } = horse.info;
  let field = new Float32Array(width * height);
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    if (horse.data[i + 3] < 16) continue;
    const lr = horse.data[i];
    const lg = horse.data[i + 1];
    const lb = horse.data[i + 2];
    const lLiked = luma(lr, lg, lb);
    const lBay = luma(bay.data[i], bay.data[i + 1], bay.data[i + 2]);
    const cLiked = chroma(lr, lg, lb);
    const lift = lLiked - lBay;
    let score = smoothstep(32, 70, lift) * smoothstep(110, 165, lLiked);
    if (cLiked > 50 && lLiked < 175) {
      score *= 0.12;
    }
    field[p] = clamp(score);
  }

  growWhiteMane(field, horse.data, bay.data, morphHi.data, width, height);
  field = blurCoverage(field, width, height, 2);

  let binary = new Float32Array(width * height);
  for (let p = 0; p < field.length; p++) {
    binary[p] = field[p] > 0.38 ? 1 : 0;
  }
  binary = erodeBinary(
    dilateBinary(binary, width, height, 4),
    width,
    height,
    3,
  );

  const rounded = blurCoverage(binary, width, height, 10);
  const maneMask = maneField(bay.data, morphHi.data, width, height);
  // The crest sits a few pixels outside the base coat's mane silhouette, so the
  // calming mask is spread past it: otherwise the topmost row of the crest
  // still gets the coat fringe and the lock reads as fur.
  const maneCalm = blurCoverage(maneMask, width, height, 5);
  for (let p = 0; p < maneCalm.length; p++) {
    maneCalm[p] = clamp(maneCalm[p] * 2.4);
  }
  const edged = hairEdge(rounded, maneCalm, width, height);
  const soft = new Float32Array(edged.length);
  for (let p = 0; p < soft.length; p++) {
    const m = maneCalm[p];
    soft[p] = edged[p] * (0.4 + 0.6 * m) + rounded[p] * 0.6 * (1 - m);
  }
  // The blob-round pass above wipes lock silhouettes. Stamp the source horse's
  // own white mane back on, so the crest reads as hanging hair again.
  {
    const scale = width / SIZE;
    const x0 = Math.round(MANE_X0 * scale);
    const x1 = Math.round(MANE_X1 * scale);
    const y0 = Math.round(MANE_Y0 * scale);
    const y1 = Math.round(MANE_Y1 * scale);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const p = y * width + x;
        const i = p * 4;
        if (morphHi.data[i + 3] < 16) continue;
        const lock = 1 - forelockWeight(x, y, scale);
        if (lock < 0.08) continue;
        const hL = luma(horse.data[i], horse.data[i + 1], horse.data[i + 2]);
        const hC = chroma(horse.data[i], horse.data[i + 1], horse.data[i + 2]);
        if (hL <= 148 || hC >= 46) continue;
        soft[p] = Math.max(soft[p], lock * smoothstep(148, 188, hL));
      }
    }
  }

  const palLuma = new Float32Array(width * height);
  const bayLuma = new Float32Array(width * height);
  const morphLuma = new Float32Array(width * height);
  const horseLuma = new Float32Array(width * height);
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    palLuma[p] =
      luma(palomino.data[i], palomino.data[i + 1], palomino.data[i + 2]) / 255;
    bayLuma[p] = luma(bay.data[i], bay.data[i + 1], bay.data[i + 2]) / 255;
    morphLuma[p] =
      luma(morphHi.data[i], morphHi.data[i + 1], morphHi.data[i + 2]) / 255;
    horseLuma[p] =
      luma(horse.data[i], horse.data[i + 1], horse.data[i + 2]) / 255;
  }
  const morphBlur = blurCoverage(morphLuma, width, height, 6);
  const palBlur = blurCoverage(palLuma, width, height, 2);
  const bayBlur = blurCoverage(bayLuma, width, height, 2);

  const rawLight = new Float32Array(width * height);
  for (let p = 0; p < width * height; p++) {
    if (soft[p] < 0.06 || morphHi.data[p * 4 + 3] < 16) continue;
    rawLight[p] = formLight(
      p,
      morphLuma,
      morphBlur,
      palLuma,
      bayLuma,
      palBlur,
      bayBlur,
    );
  }
  const broadLight = blurCoverage(
    rawLight,
    width,
    height,
    FORM_CONTRAST_RADIUS,
  );
  const punchLight = new Float32Array(width * height);
  for (let p = 0; p < width * height; p++) {
    if (soft[p] < 0.06) continue;
    punchLight[p] = clamp(
      broadLight[p] + (rawLight[p] - broadLight[p]) * FORM_CONTRAST,
    );
  }

  const samples = [];
  for (let p = 0; p < width * height; p++) {
    if (soft[p] < 0.5 || morphHi.data[p * 4 + 3] < 16) continue;
    samples.push(punchLight[p]);
  }
  samples.sort((a, b) => a - b);
  const pick = (q) => samples[Math.floor(q * (samples.length - 1))] ?? 0.5;
  const loLight = samples.length ? pick(SHADE_PCT_LO) : 0.2;
  const hiLight = samples.length ? pick(SHADE_PCT_HI) : 0.9;
  const lightSpan = Math.max(1e-3, hiLight - loLight);

  const maneSamples = [];
  for (let p = 0; p < width * height; p++) {
    if (soft[p] < 0.5 || maneMask[p] < 0.4) continue;
    maneSamples.push(horseLuma[p]);
  }
  maneSamples.sort((a, b) => a - b);
  const maneAt = (q) =>
    maneSamples[Math.floor(q * (maneSamples.length - 1))] ?? 0.5;
  const maneLo = maneSamples.length ? maneAt(0.06) : 0.35;
  const maneHi = maneSamples.length ? maneAt(0.94) : 0.92;
  const maneSpan = Math.max(1e-3, maneHi - maneLo);

  const scale = width / SIZE;
  const shadeField = new Float32Array(width * height);
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    if (soft[p] < 0.06 || morphHi.data[i + 3] < 16) continue;
    const x = (p % width) / scale;
    const y = ((p / width) | 0) / scale;
    const t = punchLight[p];
    const grain = (fbm(x * 1.1 + y * 0.3, y * 1.7, 29, 3) - 0.5) * MATTE_GRAIN;
    const mottle =
      (fbm(x * 0.28 + y * 0.08, y * 0.34, 37, 3) - 0.5) * MATTE_MOTTLE;
    const lit = clamp((t - loLight) / lightSpan);
    shadeField[p] = clamp(
      SHADE_MIN +
        (SHADE_TOP - SHADE_MIN) * Math.pow(lit, SHADE_GAMMA) +
        grain +
        mottle,
      0,
      SHADE_TOP,
    );
  }
  const out = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    const cov = soft[p];
    if (cov < 0.06 || morphHi.data[i + 3] < 16) continue;
    let shade = shadeField[p];
    const mane = maneMask[p];
    if (mane > 0.01) {
      const maneLit = clamp((horseLuma[p] - maneLo) / maneSpan);
      const maneShade =
        SHADE_MIN + (SHADE_TOP - SHADE_MIN) * Math.pow(maneLit, 0.9);
      shade = shade * (1 - mane) + maneShade * mane;
    }
    const [cr, cg, cb] = whiteFromMorph(morphHi.data, i);
    out[i] = clampByte((WHITE[0] * 0.42 + cr * 0.58) * shade);
    out[i + 1] = clampByte((WHITE[1] * 0.42 + cg * 0.58) * shade);
    out[i + 2] = clampByte((WHITE[2] * 0.42 + cb * 0.58) * shade);
    out[i + 3] = Math.min(morphHi.data[i + 3], clampByte(255 * cov));
  }

  const painted = blurRgbMasked(out, maneMask, width, height, MANE_PAINT_BLUR);
  const defringed = defringeSilhouette(painted, morphHi.data, width, height, 2);
  const maneBuf = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    maneBuf[i] = maneBuf[i + 1] = maneBuf[i + 2] = 255;
    maneBuf[i + 3] = clampByte(maneMask[p] * 255);
  }
  const { data: downRaw } = await sharp(defringed, {
    raw: { width, height, channels: 4 },
  })
    .resize(SIZE, SIZE, { kernel: 'mitchell' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { data: maneDown } = await sharp(maneBuf, {
    raw: { width, height, channels: 4 },
  })
    .resize(SIZE, SIZE, { kernel: 'mitchell' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const mane512 = new Float32Array(SIZE * SIZE);
  for (let p = 0; p < SIZE * SIZE; p++) {
    mane512[p] = maneDown[p * 4 + 3] / 255;
  }
  const smoothed = blurRgbMasked(downRaw, mane512, SIZE, SIZE, 1);
  clipToMorph(smoothed, morph512.data, SIZE);

  await mkdir(path.dirname(dest), { recursive: true });
  await sharp(smoothed, { raw: { width: SIZE, height: SIZE, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(dest);
  console.log('wrote', path.relative(ROOT, dest));
}

await main();
