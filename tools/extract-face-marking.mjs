/**
 * Turns the photoreal marking renders into plugin face-marking overlays.
 *
 * The renders in docs/images/horse-base/OC-Standard/markings/real are full
 * horses whose framing drifts from the Standard-OC silhouette, so the white
 * patch cannot simply be differenced out. This script registers each render
 * onto the canonical bay coat (global silhouette pass, then a head-window
 * refine), lifts the marking as a coverage field, and repaints it with the
 * morphology clay lighting so the overlay stays coat-agnostic — the same white
 * treatment tools/extract-face-marking.mjs uses on the overlay pass.
 *
 * Usage:
 *   node tools/extract-face-marking.mjs [--build Standard-OC] [--out <dir>] [--debug] [id ...]
 */
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 512;
const WORK = 1024;
const SCALE = WORK / SIZE;

/**
 * Morph-model builds — one plugin overlay folder per silhouette.
 *
 * `head` is the head window in 512 space used to refine the registration, and
 * `eye` the near (viewer side) eye, measured on that build's own bay plate.
 * `nudges` collects per-marking satellite-patch fixes for that build's renders,
 * `shading` per-marking overrides of the default form/detail lighting gains,
 * and `muzzle` the pink-skin band, whose height depends on the silhouette.
 */
const DEFAULT_MUZZLE = {
  rise: [112, 162],
  fall: [148, 175],
  tip: [122, 82],
  strength: 0.48,
};

const BUILDS = {
  'Standard-OC': {
    renderDir: 'docs/images/horse-base/OC-Standard/markings/real',
    bay: 'plugins/horse/layers/coat/bay.png',
    morph: 'docs/images/horse-base/OC-Standard/morphology-master.png',
    pluginDir: 'plugins/horse/layers/markings/Standard-OC',
    docsDir: 'docs/images/horse-base/OC-Standard/markings',
    head: { x0: 52, y0: 28, x1: 168, y1: 202 },
    eye: [130, 88],
    /**
     * Every forehead marking (star, diamond, heart, crescent) centres near
     * [105, 76] with ~140px of area, but snip's forehead spot is a 17px sliver
     * sitting high and left of that cluster, which reads as a smudge on the
     * frontal-bone highlight. The entry moves the patch nearest `from` onto
     * `to`, then dilates it by `grow`.
     */
    nudges: { snip: [{ from: [90, 68], to: [104, 77], grow: 4 }] },
    shading: {},
    muzzle: DEFAULT_MUZZLE,
  },
  Foal: {
    renderDir: 'docs/images/horse-base/foal/markings/real',
    bay: 'plugins/horse/layers/coat-foal/bay.png',
    morph: 'docs/images/horse-base/foal/morphology-master.png',
    pluginDir: 'plugins/horse/layers/markings/Foal',
    docsDir: 'docs/images/horse-base/foal/markings',
    head: { x0: 60, y0: 24, x1: 180, y1: 180 },
    // Pupil on the foal bay plate (512). Adult stamp coords sat too high
    // and forward, so every marking that reached the socket got the same
    // misplaced blue eye.
    eye: [129, 101],
    eyeRx: 17,
    eyeRy: 11,
    eyeTilt: -0.38,
    eyeSoft: true,
    nudges: {},
    /**
     * The two long face stripes run the whole length of the nasal bone, so the
     * default gains average their lighting away and they flatten into a ribbon.
     * Steeper form gain and a deeper shadow floor let the far side of the nose
     * drop into shade while the lit ridge stays near white.
     */
    shading: {
      blaze: { form: 2.3, detail: 1.1, min: 0.6, max: 1.05 },
      // Too narrow for a cross-nose gradient, so it leans on length-wise
      // modelling and a tighter highlight cap to stop the band reading as neon.
      'thin-blaze': { form: 2.9, detail: 1.35, min: 0.55, max: 1.06 },
    },
    /**
     * The foal muzzle sits lower than the adult's, so the shared band bled
     * pink halfway up the nose and the face read warmer than the tobiano
     * patches next to it. Keep it on the nostrils and at the pie overlays'
     * tint strength so both whites match.
     */
    muzzle: {
      rise: [142, 163],
      fall: [168, 184],
      tip: [116, 84],
      strength: 0.2,
    },
  },
};

const DEFAULT_BUILD = 'Standard-OC';
/** Render file prefix -> plugin option id in plugin.json's markings layer. */
const PLUGIN_ID = {
  'real-01-star': 'star',
  'real-02-snip': 'snip',
  'real-03-stripe': 'stripe',
  'real-04-thin-blaze': 'thin-blaze',
  'real-05-blaze': 'blaze',
  'real-06-star-snip': 'star-snip',
  'real-07-bald': 'bald',
  'real-08-heart': 'heart',
  'real-09-diamond': 'diamond',
  'real-10-crescent': 'crescent',
};

/** Geometry of the build being extracted; `main` swaps these before painting. */
let HEAD = BUILDS[DEFAULT_BUILD].head;
let EYE = BUILDS[DEFAULT_BUILD].eye;
let EYE_RX = 12;
let EYE_RY = 10;
let EYE_TILT = 0;
let EYE_SOFT = false;
let NUDGES = BUILDS[DEFAULT_BUILD].nudges;
let SHADING = BUILDS[DEFAULT_BUILD].shading;
let MUZZLE = BUILDS[DEFAULT_BUILD].muzzle;
/** Soft radius of the eye stamp, in 512 space: iris, lids and socket. */
const DEFAULT_EYE_RX = 12;
const DEFAULT_EYE_RY = 10;

/** Marking pixels are bright; brown coat highlights are bright *and* saturated. */
const LUMA_LO = 148;
const LUMA_HI = 205;
const CHROMA_LO = 58;
const CHROMA_HI = 108;
/** Bay pixels darker than this are mane or deep shadow, not face. */
const BAY_FLOOR = 25;

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

async function loadRaw(file, size) {
  return sharp(path.join(ROOT, file))
    .ensureAlpha()
    .resize(size, size, { fit: 'contain', kernel: 'mitchell' })
    .raw()
    .toBuffer({ resolveWithObject: true });
}

function alphaMask(data, width, height) {
  const mask = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p++)
    mask[p] = data[p * 4 + 3] > 128 ? 1 : 0;
  return mask;
}

/**
 * Similarity transform ref -> src around the window centre.
 * Scale below 1 means the render's subject is larger than the reference.
 */
function mapPoint(x, y, cx, cy, s, tx, ty) {
  return [(x - cx) / s + cx + tx, (y - cy) / s + cy + ty];
}

function iou(refMask, srcMask, width, height, win, s, tx, ty, step) {
  const cx = (win.x0 + win.x1) / 2;
  const cy = (win.y0 + win.y1) / 2;
  let inter = 0;
  let union = 0;
  for (let y = win.y0; y <= win.y1; y += step) {
    for (let x = win.x0; x <= win.x1; x += step) {
      const r = refMask[y * width + x];
      const [fx, fy] = mapPoint(x, y, cx, cy, s, tx, ty);
      const sx = Math.round(fx);
      const sy = Math.round(fy);
      const v =
        sx >= 0 && sy >= 0 && sx < width && sy < height
          ? srcMask[sy * width + sx]
          : 0;
      if (r || v) union++;
      if (r && v) inter++;
    }
  }
  return union ? inter / union : 0;
}

function search(refMask, srcMask, width, height, win, grid, seed) {
  let best = { score: -1, s: seed.s, tx: seed.tx, ty: seed.ty };
  for (let s = grid.s0; s <= grid.s1 + 1e-9; s += grid.ds) {
    for (let tx = grid.t0; tx <= grid.t1; tx += grid.dt) {
      for (let ty = grid.t0; ty <= grid.t1; ty += grid.dt) {
        const score = iou(
          refMask,
          srcMask,
          width,
          height,
          win,
          s,
          seed.tx + tx,
          seed.ty + ty,
          grid.step,
        );
        if (score > best.score) {
          best = { score, s, tx: seed.tx + tx, ty: seed.ty + ty };
        }
      }
    }
  }
  return best;
}

/** Global silhouette pass, then a head-window refine so the face lands right. */
function register(refMask, srcMask, width, height) {
  const body = { x0: 0, y0: 0, x1: width - 1, y1: height - 1 };
  const head = {
    x0: Math.round(HEAD.x0 * SCALE),
    y0: Math.round(HEAD.y0 * SCALE),
    x1: Math.round(HEAD.x1 * SCALE),
    y1: Math.round(HEAD.y1 * SCALE),
  };

  const coarse = search(
    refMask,
    srcMask,
    width,
    height,
    body,
    { s0: 0.82, s1: 1.24, ds: 0.03, t0: -96, t1: 96, dt: 12, step: 6 },
    { s: 1, tx: 0, ty: 0 },
  );

  let best = coarse;
  for (const grid of [
    { ds: 0.01, dt: 4, span: 16, sspan: 0.04, step: 3 },
    { ds: 0.005, dt: 1, span: 5, sspan: 0.015, step: 2 },
  ]) {
    const refined = search(
      refMask,
      srcMask,
      width,
      height,
      head,
      {
        s0: best.s - grid.sspan,
        s1: best.s + grid.sspan,
        ds: grid.ds,
        t0: -grid.span,
        t1: grid.span,
        dt: grid.dt,
        step: grid.step,
      },
      { s: best.s, tx: best.tx, ty: best.ty },
    );
    best = refined;
  }
  return { ...best, bodyScore: coarse.score };
}

function sampleScalar(field, width, height, fx, fy) {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const ax = fx - x0;
  const ay = fy - y0;
  let acc = 0;
  for (const [dx, dy, w] of [
    [0, 0, (1 - ax) * (1 - ay)],
    [1, 0, ax * (1 - ay)],
    [0, 1, (1 - ax) * ay],
    [1, 1, ax * ay],
  ]) {
    const x = Math.min(width - 1, Math.max(0, x0 + dx));
    const y = Math.min(height - 1, Math.max(0, y0 + dy));
    acc += field[y * width + x] * w;
  }
  return acc;
}

function sampleBilinear(data, width, height, fx, fy) {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const ax = fx - x0;
  const ay = fy - y0;
  const out = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    let acc = 0;
    for (const [dx, dy, w] of [
      [0, 0, (1 - ax) * (1 - ay)],
      [1, 0, ax * (1 - ay)],
      [0, 1, (1 - ax) * ay],
      [1, 1, ax * ay],
    ]) {
      const x = Math.min(width - 1, Math.max(0, x0 + dx));
      const y = Math.min(height - 1, Math.max(0, y0 + dy));
      acc += data[(y * width + x) * 4 + c] * w;
    }
    out[c] = acc;
  }
  return out;
}

/**
 * Lift the white patch: bright and desaturated relative to the bay coat,
 * inside the head box, on skin the coat actually paints.
 */
function extractCoverage(render, bay, morph, width, height, fit) {
  const field = new Float32Array(width * height);
  const cx = (Math.round(HEAD.x0 * SCALE) + Math.round(HEAD.x1 * SCALE)) / 2;
  const cy = (Math.round(HEAD.y0 * SCALE) + Math.round(HEAD.y1 * SCALE)) / 2;
  const eyeX = EYE[0] * SCALE;
  const eyeY = EYE[1] * SCALE;
  const eyeR = 9 * SCALE;

  for (
    let y = Math.round(HEAD.y0 * SCALE);
    y <= Math.round(HEAD.y1 * SCALE);
    y++
  ) {
    for (
      let x = Math.round(HEAD.x0 * SCALE);
      x <= Math.round(HEAD.x1 * SCALE);
      x++
    ) {
      const p = y * width + x;
      const i = p * 4;
      if (bay[i + 3] < 16 || morph[i + 3] < 16) continue;
      const bayL = luma(bay[i], bay[i + 1], bay[i + 2]);
      if (bayL < BAY_FLOOR) continue;
      if (Math.hypot(x - eyeX, y - eyeY) < eyeR && bayL < 60) continue;

      const [fx, fy] = mapPoint(x, y, cx, cy, fit.s, fit.tx, fit.ty);
      const [r, g, b, a] = sampleBilinear(render, width, height, fx, fy);
      if (a < 140) continue;

      const bright = smoothstep(LUMA_LO, LUMA_HI, luma(r, g, b));
      if (bright <= 0) continue;
      const desat = 1 - smoothstep(CHROMA_LO, CHROMA_HI, chroma(r, g, b));
      field[p] = clamp(bright * desat);
    }
  }
  return field;
}

function blurField(field, width, height, radius) {
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

/** Drop isolated speckles: keep only blobs reachable from a confident core. */
const BLOB_FLOOR = 0.08;

/** 4-connected flood of the coverage blob containing `seed`. */
function floodBlob(field, width, height, seed, visited) {
  const blob = [seed];
  visited[seed] = 1;
  for (let qi = 0; qi < blob.length; qi++) {
    const q = blob[qi];
    const x = q % width;
    const y = (q / width) | 0;
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const n = ny * width + nx;
      if (visited[n] || field[n] < BLOB_FLOOR) continue;
      visited[n] = 1;
      blob.push(n);
    }
  }
  return blob;
}

function keepMainBlobs(field, width, height, coreLevel = 0.55, minArea = 60) {
  const visited = new Uint8Array(width * height);
  const out = new Float32Array(field.length);
  for (let p = 0; p < width * height; p++) {
    if (visited[p] || field[p] < BLOB_FLOOR) continue;
    const blob = floodBlob(field, width, height, p, visited);
    let peak = 0;
    for (const q of blob) if (field[q] > peak) peak = field[q];
    if (peak < coreLevel || blob.length < minArea) continue;
    for (const q of blob) out[q] = field[q];
  }
  return out;
}

/** Centroid, in WORK space, of a flooded blob. */
function centroid(blob, width) {
  let sx = 0;
  let sy = 0;
  for (const p of blob) {
    sx += p % width;
    sy += (p / width) | 0;
  }
  return [sx / blob.length, sy / blob.length];
}

/** Flood the strongest coverage blob within `radius512` of a probe point. */
function findBlob(field, width, height, at512, radius512 = 14) {
  const r = radius512 * SCALE;
  const x0 = Math.max(0, Math.round(at512[0] * SCALE - r));
  const x1 = Math.min(width - 1, Math.round(at512[0] * SCALE + r));
  const y0 = Math.max(0, Math.round(at512[1] * SCALE - r));
  const y1 = Math.min(height - 1, Math.round(at512[1] * SCALE + r));
  let seed = -1;
  let best = BLOB_FLOOR;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = y * width + x;
      if (field[p] <= best) continue;
      best = field[p];
      seed = p;
    }
  }
  if (seed < 0) return null;
  return floodBlob(field, width, height, seed, new Uint8Array(width * height));
}

/** Softening of the dilated rim, so hairenEdge still has a gradient to bite. */
const GROW_FALLOFF = 0.3;

/**
 * Round a thin patch out into a spot. The renders sometimes keep a marking as a
 * narrow specular sliver, which reads as a smudge once flattened; dilating by a
 * radius gives it the mass and the round silhouette of a real forehead mark.
 */
function growPatch(field, dest, width, height, radius) {
  const out = Float32Array.from(field);
  for (const p of dest) {
    const v = field[p];
    if (v <= 0) continue;
    const px = p % width;
    const py = (p / width) | 0;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > radius) continue;
        const x = px + dx;
        const y = py + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const q = y * width + x;
        const w = v * (1 - GROW_FALLOFF * (d / radius));
        if (w > out[q]) out[q] = w;
      }
    }
  }
  return out;
}

/**
 * Translate satellite blobs so their centroids land on `to`, in 512 space, and
 * optionally dilate them by `grow`. Also returns the pixel translations: the
 * render-derived shading has to travel with the patch, otherwise it would be
 * read off whatever the render shows at the destination — forelock, for snip.
 */
function nudgeBlobs(field, width, height, nudges) {
  const moves = [];
  if (!nudges?.length) return { field, moves };

  let out = Float32Array.from(field);
  for (const { from, to, grow = 0 } of nudges) {
    const blob = findBlob(field, width, height, from);
    if (!blob) continue;
    const [bx, by] = centroid(blob, width);
    const dx = Math.round(to[0] * SCALE - bx);
    const dy = Math.round(to[1] * SCALE - by);
    for (const p of blob) out[p] = 0;

    const dest = [];
    for (const p of blob) {
      const x = (p % width) + dx;
      const y = ((p / width) | 0) + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const q = y * width + x;
      out[q] = Math.max(out[q], field[p]);
      dest.push(q);
    }
    if (grow > 0) {
      out = growPatch(out, dest, width, height, Math.round(grow * SCALE));
    }
    moves.push({ blob, dx, dy });
  }
  return { field: out, moves };
}

/** Replay nudgeBlobs' translations on a scalar field, destinations only. */
function shiftField(src, moves, width, height) {
  if (!moves.length) return src;
  const out = Float32Array.from(src);
  for (const { blob, dx, dy } of moves) {
    for (const p of blob) {
      const x = (p % width) + dx;
      const y = ((p / width) | 0) + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      out[y * width + x] = src[p];
    }
  }
  return out;
}

/**
 * Per-marking path warp in 512 space. The thin-blaze render is a ruler-straight
 * ribbon; a slow meander plus width pulse make it read as a real face marking.
 */
const STRIPE_WARP = {
  'thin-blaze': {
    sway: 1.8,
    swaySlow: 0.006,
    swayFine: 0.01,
    pinch: 0.3,
    pinchFreq: 0.026,
    seed: 73,
  },
};

function warpStripe(field, width, height, spec) {
  if (!spec) return field;

  const scale = width / SIZE;
  const cx = new Float32Array(height).fill(-1);
  for (let y = 0; y < height; y++) {
    let sx = 0;
    let w = 0;
    for (let x = 0; x < width; x++) {
      const v = field[y * width + x];
      if (v < 0.08) continue;
      sx += x * v;
      w += v;
    }
    if (w > 0) cx[y] = sx / w;
  }

  const smoothed = new Float32Array(height).fill(-1);
  const radius = Math.max(2, Math.round(3 * scale));
  for (let y = 0; y < height; y++) {
    if (cx[y] < 0) continue;
    let s = 0;
    let n = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= height || cx[ny] < 0) continue;
      s += cx[ny];
      n++;
    }
    smoothed[y] = n > 0 ? s / n : cx[y];
  }

  const out = new Float32Array(field.length);
  const swayAmp = spec.sway * scale;
  for (let y = 0; y < height; y++) {
    const y512 = y / scale;
    const slow = fbm(2.1, y512 * spec.swaySlow * 8, spec.seed, 3) - 0.5;
    const fine = fbm(6.4, y512 * spec.swayFine * 8, spec.seed + 5, 2) - 0.5;
    const sway = (slow * 2 + fine * 0.4) * swayAmp;
    const pinch = clamp(
      1 +
        (fbm(9.2, y512 * spec.pinchFreq * 8, spec.seed + 11, 3) - 0.5) *
          2 *
          spec.pinch,
      0.68,
      1.38,
    );
    const rowCx = smoothed[y];
    for (let x = 0; x < width; x++) {
      const srcX =
        rowCx >= 0 ? rowCx + (x - rowCx - sway) / pinch : x - sway;
      out[y * width + x] = sampleScalar(field, width, height, srcX, y);
    }
  }
  return out;
}

/**
 * Break the matte boundary into hair. The render gives a clean photographic
 * edge, which reads as paint once it is flattened to an overlay, so the low
 * threshold is jittered by noise and a short fringe is added on the rim band.
 */
function hairenEdge(field, width, height, seed, edge = {}) {
  const hairAmp = edge.hair ?? 0.16;
  const fringeAmp = edge.fringe ?? 0.24;
  const out = new Float32Array(field.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const cov = field[p];
      if (cov < 0.02) continue;
      const hair = fbm(x * 0.5 + y * 0.14, y * 0.95, seed + 7, 4);
      const fringe = fbm(x * 1.5 + y * 0.28, y * 1.9, seed + 19, 3);
      const lo = 0.16 + (hair - 0.5) * hairAmp;
      const shaped = Math.pow(smoothstep(lo, 0.64, cov), 0.85);
      const rim =
        smoothstep(0.06, 0.32, shaped) * (1 - smoothstep(0.42, 0.88, shaped));
      // The core has to reach full opacity: capped below 1 it lets the coat
      // bleed through, which tints the white warm on a bay and would drift on
      // every other coat, so a blaze never matches an opaque pie patch.
      out[p] = clamp(shaped + rim * fringe * fringeAmp);
    }
  }
  return out;
}

/** Same warm clay-lit white as the extract overlay pass. */
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

/**
 * Pink skin showing through sparse white hair on the muzzle (512 canvas space).
 * `rise` and `fall` bound the band down the nasal midline and `tip` fades it
 * toward the nose tip, so it stays off the forehead star zone.
 */
function muzzlePinkFactor(x512, y512) {
  const alongNose =
    smoothstep(MUZZLE.rise[0], MUZZLE.rise[1], y512) *
    (1 - smoothstep(MUZZLE.fall[0], MUZZLE.fall[1], y512));
  const towardTip = smoothstep(MUZZLE.tip[0], MUZZLE.tip[1], x512);
  return clamp(alongNose * (0.28 + towardTip * 0.72));
}

/** Blend warm muzzle pink into lit white — like cream coat nostril skin. */
function tintMuzzlePink(r, g, b, pink) {
  if (pink <= 0.001) return [r, g, b];
  const pr = 234;
  const pg = 176;
  const pb = 168;
  const k = pink * MUZZLE.strength;
  return [r * (1 - k) + pr * k, g * (1 - k) + pg * k, b * (1 - k) + pb * k];
}

/**
 * Luminance of the registered render, 0..1, or -1 where the render is empty.
 * This is the photographic light on the real white hair, which the flat clay
 * white throws away — it is what makes the overlay read as paint.
 */
function registeredLuma(render, fit, width, height) {
  const cx = (Math.round(HEAD.x0 * SCALE) + Math.round(HEAD.x1 * SCALE)) / 2;
  const cy = (Math.round(HEAD.y0 * SCALE) + Math.round(HEAD.y1 * SCALE)) / 2;
  const out = new Float32Array(width * height).fill(-1);
  const y0 = Math.round(HEAD.y0 * SCALE);
  const y1 = Math.round(HEAD.y1 * SCALE);
  const x0 = Math.round(HEAD.x0 * SCALE);
  const x1 = Math.round(HEAD.x1 * SCALE);

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const [fx, fy] = mapPoint(x, y, cx, cy, fit.s, fit.tx, fit.ty);
      const [r, g, b, a] = sampleBilinear(render, width, height, fx, fy);
      if (a < 140) continue;
      out[y * width + x] = luma(r, g, b) / 255;
    }
  }
  return out;
}

/** Broad form shading and fine hair detail lifted from the render. */
const FORM_GAIN = 1.15;
const DETAIL_GAIN = 0.7;
const SHADE_MIN = 0.5;
const SHADE_MAX = 1.3;

function buildShading(lumaField, field, width, height, tuning = {}) {
  const formGain = tuning.form ?? FORM_GAIN;
  const detailGain = tuning.detail ?? DETAIL_GAIN;
  const shadeMin = tuning.min ?? SHADE_MIN;
  const shadeMax = tuning.max ?? SHADE_MAX;
  let sum = 0;
  let n = 0;
  for (let p = 0; p < width * height; p++) {
    if (field[p] > 0.35 && lumaField[p] >= 0) {
      sum += lumaField[p];
      n++;
    }
  }
  const mean = n > 0 ? sum / n : 0.8;

  // Fill gaps with the mean so the blur does not drag shading toward zero.
  const filled = new Float32Array(width * height);
  for (let p = 0; p < width * height; p++) {
    filled[p] = lumaField[p] >= 0 ? lumaField[p] : mean;
  }
  const form = blurField(filled, width, height, 6);

  const shade = new Float32Array(width * height).fill(1);
  for (let p = 0; p < width * height; p++) {
    if (lumaField[p] < 0) continue;
    const broad = (form[p] - mean) * formGain;
    const detail = (filled[p] - form[p]) * detailGain;
    shade[p] = clamp(1 + broad + detail, shadeMin, shadeMax);
  }
  return shade;
}

/** Local eye coords and radial distance in the (optionally tilted) ellipse. */
function eyeLocal(x512, y512) {
  let dx = x512 - EYE[0];
  let dy = y512 - EYE[1];
  if (EYE_TILT !== 0) {
    const c = Math.cos(EYE_TILT);
    const s = Math.sin(EYE_TILT);
    const rx = dx * c + dy * s;
    const ry = -dx * s + dy * c;
    dx = rx;
    dy = ry;
  }
  return [dx, dy, Math.hypot(dx / EYE_RX, dy / EYE_RY)];
}

/** Soft elliptical weight for the eye stamp, in 512 space. */
function eyeMask(x512, y512) {
  const d = eyeLocal(x512, y512)[2];
  const lo = EYE_SOFT ? 0.36 : 0.55;
  const hi = EYE_SOFT ? 1.12 : 1;
  return 1 - smoothstep(lo, hi, d);
}

/**
 * The render's eye is a 20px feature downsampled to 512, so its iris and pupil
 * come out muddy. Stretch contrast around the socket mid-tone and keep the cool
 * cast so the blue iris and dark pupil separate at plugin resolution.
 */
const EYE_PIVOT = 118;
const EYE_CONTRAST = 1.3;
const EYE_COOL = 8;

function punchEye(r, g, b, d, screenDy) {
  const L = luma(r, g, b);
  const blue = b - Math.max(r, g);
  const iris = smoothstep(8, 20, blue) * smoothstep(70, 110, L);
  const pupil = (1 - smoothstep(14, 42, L)) * (1 - smoothstep(0.16, 0.34, d));
  const t = smoothstep(40, 102, L) * (1 - pupil);
  const pr = EYE_PIVOT + (r - EYE_PIVOT) * EYE_CONTRAST;
  const pg = EYE_PIVOT + (g - EYE_PIVOT) * EYE_CONTRAST;
  const pb = EYE_PIVOT + (b - EYE_PIVOT) * EYE_CONTRAST + EYE_COOL;
  let outR = r + (pr - r) * t;
  let outG = g + (pg - g) * t;
  let outB = b + (pb - b) * t;

  const lid = (1 - iris) * (1 - pupil) * (1 - smoothstep(48, 165, L));
  const below = smoothstep(0.6, 2.4, screenDy);
  const margin = (1 - below) * lid;
  const crease = below * (1 - iris) * (1 - pupil);

  if (margin > 0.02) {
    const shade = clamp(L / 80);
    outR = outR * (1 - margin) + (220 + 14 * shade) * margin;
    outG = outG * (1 - margin) + (150 + 26 * shade) * margin;
    outB = outB * (1 - margin) + (144 + 22 * shade) * margin;
  }
  if (crease > 0.02) {
    const fade = crease * (1 - smoothstep(175, 232, L));
    outR = outR * (1 - fade) + 236 * fade;
    outG = outG * (1 - fade) + 230 * fade;
    outB = outB * (1 - fade) + 226 * fade;
  }
  return [outR, outG, outB];
}

/**
 * Where the render's own iris lands after registration, in 512 space.
 * The stamp is always painted on the coat socket (`EYE`); this offset maps
 * the photoreal blue eye onto that socket when the fit is a few pixels off.
 */
function registeredEyeCenter(render, fit, width, height) {
  const cx = (Math.round(HEAD.x0 * SCALE) + Math.round(HEAD.x1 * SCALE)) / 2;
  const cy = (Math.round(HEAD.y0 * SCALE) + Math.round(HEAD.y1 * SCALE)) / 2;
  const reach = Math.max(EYE_RX, EYE_RY) * 1.6 * SCALE;
  const x0 = Math.max(0, Math.round(EYE[0] * SCALE - reach));
  const x1 = Math.min(width - 1, Math.round(EYE[0] * SCALE + reach));
  const y0 = Math.max(0, Math.round(EYE[1] * SCALE - reach));
  const y1 = Math.min(height - 1, Math.round(EYE[1] * SCALE + reach));
  let best = { score: -1e9, x: EYE[0], y: EYE[1] };
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const [fx, fy] = mapPoint(x, y, cx, cy, fit.s, fit.tx, fit.ty);
      const [r, g, b, a] = sampleBilinear(render, width, height, fx, fy);
      if (a < 140) continue;
      const L = luma(r, g, b);
      const blue = b - Math.max(r, g);
      if (L > 110 && blue < 6) continue;
      const score = 90 - L + Math.min(18, Math.max(0, blue));
      if (score > best.score) {
        best = { score, x: x / SCALE, y: y / SCALE };
      }
    }
  }
  return [best.x, best.y];
}

/** True when the marking actually covers the eye (bald face and friends). */
function coversEye(field, width, minAvg = 0.45) {
  let sum = 0;
  let n = 0;
  for (let dy = -EYE_RY; dy <= EYE_RY; dy++) {
    for (let dx = -EYE_RX; dx <= EYE_RX; dx++) {
      const x = Math.round((EYE[0] + dx) * SCALE);
      const y = Math.round((EYE[1] + dy) * SCALE);
      sum += field[y * width + x];
      n++;
    }
  }
  return n > 0 && sum / n > minAvg;
}

function paintOverlay(field, morph, render, fit, moves, width, height, tuning) {
  const lumaField = shiftField(
    registeredLuma(render, fit, width, height),
    moves,
    width,
    height,
  );
  const shade = buildShading(lumaField, field, width, height, tuning);
  const stampEye = coversEye(field, width);
  const [srcEyeX, srcEyeY] = stampEye
    ? registeredEyeCenter(render, fit, width, height)
    : EYE;
  const sampleDx = (srcEyeX - EYE[0]) * SCALE;
  const sampleDy = (srcEyeY - EYE[1]) * SCALE;
  const cx = (Math.round(HEAD.x0 * SCALE) + Math.round(HEAD.x1 * SCALE)) / 2;
  const cy = (Math.round(HEAD.y0 * SCALE) + Math.round(HEAD.y1 * SCALE)) / 2;
  const out = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const i = p * 4;
      const cov = field[p];
      const x512 = x / SCALE;
      const y512 = y / SCALE;
      let eye = stampEye ? eyeMask(x512, y512) : 0;
      if ((cov < 0.02 && eye <= 0.01) || morph[i + 3] < 16) continue;

      let iris = null;
      if (eye > 0) {
        const [fx, fy] = mapPoint(
          x + sampleDx,
          y + sampleDy,
          cx,
          cy,
          fit.s,
          fit.tx,
          fit.ty,
        );
        const [er, eg, eb, ea] = sampleBilinear(render, width, height, fx, fy);
        if (ea >= 140) {
          iris = punchEye(
            er,
            eg,
            eb,
            eyeLocal(x512, y512)[2],
            y512 - EYE[1],
          );
        } else {
          eye = 0;
        }
      }

      let [r, g, b] = whiteFromMorph(morph, i);
      const k = 1 + (shade[p] - 1) * (1 - eye);
      r *= k;
      g *= k;
      b *= k;
      [r, g, b] = tintMuzzlePink(r, g, b, muzzlePinkFactor(x512, y512));

      if (iris) {
        r = r * (1 - eye) + iris[0] * eye;
        g = g * (1 - eye) + iris[1] * eye;
        b = b * (1 - eye) + iris[2] * eye;
      }

      const alpha = Math.max(cov, eye);
      out[i] = clampByte(r);
      out[i + 1] = clampByte(g);
      out[i + 2] = clampByte(b);
      out[i + 3] = clampByte(morph[i + 3] * alpha);
    }
  }
  return out;
}

async function writeResized(raw, width, height, dest) {
  await mkdir(path.dirname(dest), { recursive: true });
  await sharp(raw, { raw: { width, height, channels: 4 } })
    .resize(SIZE, SIZE, { kernel: 'mitchell' })
    .png({ compressionLevel: 9 })
    .toFile(dest);
}

function parseArgs(argv) {
  let build = DEFAULT_BUILD;
  let out = null;
  let debug = false;
  const ids = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--build') {
      build = argv[++i];
      continue;
    }
    if (argv[i] === '--out') {
      out = argv[++i];
      continue;
    }
    if (argv[i] === '--debug') {
      debug = true;
      continue;
    }
    ids.push(argv[i]);
  }
  const spec = BUILDS[build];
  if (!spec) {
    throw new Error(
      `Unknown build "${build}". Known: ${Object.keys(BUILDS).join(', ')}`,
    );
  }
  return {
    build,
    spec,
    out: out ?? spec.pluginDir,
    docsOut: spec.docsDir,
    debug,
    ids,
  };
}

async function main() {
  const { build, spec, out, docsOut, debug, ids } = parseArgs(
    process.argv.slice(2),
  );
  HEAD = spec.head;
  EYE = spec.eye;
  EYE_RX = spec.eyeRx ?? DEFAULT_EYE_RX;
  EYE_RY = spec.eyeRy ?? DEFAULT_EYE_RY;
  EYE_TILT = spec.eyeTilt ?? 0;
  EYE_SOFT = spec.eyeSoft === true;
  NUDGES = spec.nudges;
  SHADING = spec.shading;
  MUZZLE = spec.muzzle;

  const bay = await loadRaw(spec.bay, WORK);
  const morph = await loadRaw(spec.morph, WORK);
  const { width, height } = bay.info;
  const refMask = alphaMask(bay.data, width, height);

  const files = (await readdir(path.join(ROOT, spec.renderDir)))
    .filter((f) => f.endsWith('.png'))
    .sort();

  let index = -1;
  for (const file of files) {
    const prefix = Object.keys(PLUGIN_ID).find((k) => file.startsWith(k));
    if (!prefix) continue;
    index++;
    const id = PLUGIN_ID[prefix];
    if (ids.length && !ids.includes(id)) continue;

    const render = await loadRaw(`${spec.renderDir}/${file}`, WORK);
    const srcMask = alphaMask(render.data, width, height);
    const fit = register(refMask, srcMask, width, height);

    let field = extractCoverage(
      render.data,
      bay.data,
      morph.data,
      width,
      height,
      fit,
    );
    field = blurField(field, width, height, 2);
    field = keepMainBlobs(field, width, height);
    const { field: nudged, moves } = nudgeBlobs(
      field,
      width,
      height,
      NUDGES[id],
    );
    const shape = STRIPE_WARP[id];
    field = warpStripe(nudged, width, height, shape);
    if (shape) field = blurField(field, width, height, 1);
    field = hairenEdge(field, width, height, 41 + index * 17, shape);
    field = blurField(field, width, height, 1);

    let area = 0;
    for (let p = 0; p < field.length; p++) if (field[p] > 0.2) area++;

    const overlay = paintOverlay(
      field,
      morph.data,
      render.data,
      fit,
      moves,
      width,
      height,
      SHADING[id],
    );
    const overlayPath = path.join(ROOT, out, `${id}.png`);
    await writeResized(overlay, width, height, overlayPath);
    await writeResized(
      overlay,
      width,
      height,
      path.join(ROOT, docsOut, `${id}.png`),
    );

    if (debug) {
      const preview = Buffer.from(bay.data);
      for (let p = 0; p < width * height; p++) {
        const i = p * 4;
        const a = overlay[i + 3] / 255;
        if (a <= 0) continue;
        for (let c = 0; c < 3; c++) {
          preview[i + c] = clampByte(
            preview[i + c] * (1 - a) + overlay[i + c] * a,
          );
        }
      }
      await writeResized(
        preview,
        width,
        height,
        path.join(ROOT, out, '_preview', `${id}-on-bay.png`),
      );
    }

    console.log(
      `[${build}] ${id.padEnd(11)} scale ${fit.s.toFixed(3)} dx ${String(fit.tx).padStart(4)} dy ${String(
        fit.ty,
      ).padStart(
        4,
      )} headIoU ${fit.score.toFixed(3)} bodyIoU ${fit.bodyScore.toFixed(
        3,
      )} area ${area}`,
    );
  }
}

await main();
