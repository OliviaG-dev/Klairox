/**
 * Face-marking overlays for the Lusitano silhouette.
 *
 * The other builds lift markings from photoreal renders. Lusitano has no
 * marking renders, so these shapes are drawn on the bay face (512) and shaded
 * from that coat's own lighting so the white follows the head.
 *
 *   node tools/generate-lusitano-face-markings.mjs
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 512;
const BAY = 'plugins/horse/layers/coat-lusitano/bay.png';
const OUTS = [
  'plugins/horse/layers/markings/Lusitano',
  'apps/editor/public/plugins/horse/layers/markings/Lusitano',
];

/** Forehead (t=0) to lip (t=1), just inside the right-facing profile. */
const Y0 = 88;
const Y1 = 184;
const INSET = 18;

let RIGHT = null;
const IDS = [
  'blaze',
  'thin-blaze',
  'stripe',
  'star',
  'diamond',
  'heart',
  'snip',
  'star-snip',
  'bald',
  'crescent',
];

function clamp(v, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

function hash(ix, iy) {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0);
  const b = hash(x0 + 1, y0);
  const c = hash(x0, y0 + 1);
  const d = hash(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x, y) {
  return (
    valueNoise(x, y) * 0.55 +
    valueNoise(x * 2.1, y * 2.1) * 0.3 +
    valueNoise(x * 4.2, y * 4.2) * 0.15
  );
}

function buildFrame(data, width) {
  const right = new Int16Array(SIZE);
  right.fill(-1);
  for (let y = 0; y < SIZE; y++) {
    for (let x = width - 1; x >= 0; x--) {
      if (data[(y * width + x) * 4 + 3] > 200) {
        right[y] = x;
        break;
      }
    }
  }
  return right;
}

function axis(right, y) {
  const yy = Math.max(0, Math.min(SIZE - 1, Math.round(y)));
  const edge = right[yy];
  if (edge < 0) return null;
  const t = (y - Y0) / (Y1 - Y0);
  return { x: edge - INSET, t, edge };
}

/** Profile inset, averaged so a blaze does not step with each silhouette pixel. */
function smoothCenter(right) {
  const xs = new Float64Array(SIZE);
  const radius = 9;
  for (let y = 0; y < SIZE; y++) {
    let sum = 0;
    let weight = 0;
    for (let k = -radius; k <= radius; k++) {
      const yy = y + k;
      if (yy < 0 || yy >= SIZE || right[yy] < 0) continue;
      const w = radius + 1 - Math.abs(k);
      sum += (right[yy] - INSET) * w;
      weight += w;
    }
    xs[y] = weight ? sum / weight : -1;
  }
  return xs;
}

/** Signed pixels across the face (positive = toward the profile / right). */
function faceOf(right, x, y) {
  const a = axis(right, y);
  if (!a) return null;
  return { s: x - a.x, t: a.t, edge: a.edge };
}

function band(face, t0, t1, half, feather = 1.6) {
  if (!face) return 0;
  const along =
    smoothstep(t0 - 0.02, t0 + 0.015, face.t) *
    (1 - smoothstep(t1 - 0.015, t1 + 0.025, face.t));
  const across = 1 - smoothstep(half - feather, half + 0.4, Math.abs(face.s));
  return along * across;
}

function ellipse(face, t, s, rx, ry) {
  if (!face) return 0;
  const dt = (face.t - t) * (Y1 - Y0);
  const d = Math.hypot((face.s - s) / rx, dt / ry);
  return 1 - smoothstep(0.82, 1.08, d);
}

/**
 * Blaze on the smoothed midline. Width stays even; hair breaks only the edge,
 * so the stripe reads straight instead of jagged and blotchy.
 */
/**
 * Midline of the nasal bone. The silhouette dips at the cheek; tracking it
 * kinks the stripe, so the blaze uses this curve instead.
 */
function blazeX(y) {
  const u = clamp((y - 92) / (176 - 92));
  const forehead = 376;
  const bridge = 379;
  const lip = 387;
  return (1 - u) * (1 - u) * forehead + 2 * (1 - u) * u * bridge + u * u * lip;
}

function blazeCoverage(_center, x, y) {
  if (y < 82 || y > 182) return 0;
  const t = clamp((y - 92) / (176 - 92));
  const half = 9.2 * (1 - t) + 3.3 * t;
  const swing = 4.2 * (1 - t * 0.45);
  const left = -(
    half +
    (fbm(t * 4.2, 1.1) - 0.5) * swing +
    (fbm(t * 11, 2.4) - 0.5) * 1.6
  );
  const right =
    half + (fbm(t * 3.6, 6.3) - 0.5) * swing + (fbm(t * 10, 8.2) - 0.5) * 1.6;
  const s = x - blazeX(y);
  const neck =
    y >= 104 && y <= 176
      ? Math.min(
          smoothstep(left - 1.6, left + 1.2, s),
          1 - smoothstep(right - 1.2, right + 1.6, s),
        )
      : 0;
  const lip = 1 - smoothstep(0.88, 1, t);
  const fringe = (fbm(x * 0.35, y * 0.28) - 0.5) * 0.28;
  const cap = Math.hypot((x - blazeX(104)) / 12.5, (y - 104) / 12) + fringe;
  const dome = 1 - smoothstep(0.7, 1.05, cap);
  return Math.max(neck * lip, dome);
}

/** Narrow stripe on the same nasal midline as the blaze. */
function thinBlazeCoverage(x, y) {
  if (y < 84 || y > 180) return 0;
  const t = clamp((y - 96) / (174 - 96));
  const wave = 0.5 + 0.5 * Math.sin(t * Math.PI * 2.2 + 1.15);
  const n = fbm(t * 3.6, 5.5);
  const half = 1.25 + 4.2 * (0.55 * wave + 0.45 * n);
  const left = -(half * (0.82 + 0.35 * fbm(t * 3.2, 2.2)));
  const right = half * (0.78 + 0.4 * fbm(t * 2.8, 8.4));
  const s = x - blazeX(y);
  const body =
    y >= 100 && y <= 174
      ? Math.min(
          smoothstep(left - 1.4, left + 1, s),
          1 - smoothstep(right - 1, right + 1.4, s),
        ) *
        (1 - smoothstep(0.86, 1, t))
      : 0;
  const topHalf =
    1.25 + 4.2 * (0.55 * (0.5 + 0.5 * Math.sin(1.15)) + 0.45 * fbm(0, 5.5));
  const fringe = (fbm(x * 0.42, y * 0.33) - 0.5) * 0.22;
  const cap =
    Math.hypot(
      (x - blazeX(100)) / (topHalf * 1.05),
      (y - 100) / (topHalf * 1.55),
    ) + fringe;
  const dome = 1 - smoothstep(0.58, 1.04, cap);
  return Math.max(body, dome);
}

/** Interrupted race on the nasal midline, thicker than the thin blaze. */
function stripeDash(x, y, y0, y1, shift, lean, inner) {
  if (y < y0 - 12 || y > y1 + 12) return 0;
  const u = clamp((y - y0) / Math.max(1, y1 - y0));
  const swell = 0.35 + 0.65 * fbm(u * 2.8 + y0 * 0.02, 2.4);
  const half = 1.6 + 5.4 * swell;
  const left = -(half * (0.55 + 0.7 * fbm(u * 3.4, 4.1)));
  const right = half * (0.5 + 0.75 * fbm(u * 3.1, 8.6));
  const yy = Math.max(y0, Math.min(y1, y));
  const wander = (fbm(u * 1.7, y0 * 0.03) - 0.5) * 2.2;
  const s = x - blazeX(yy) - shift - Math.sin(u * Math.PI) * lean - wander;
  const across = Math.min(
    smoothstep(left - 1.5, left + 1.1, s),
    1 - smoothstep(right - 1.1, right + 1.5, s),
  );
  const jag = (fbm(s * 0.45, inner === 'bottom' ? 2.1 : 6.8) - 0.5) * 9;
  const outer =
    inner === 'bottom'
      ? smoothstep(y0 - 5, y0 + 3, y)
      : 1 - smoothstep(y1 - 3, y1 + 5, y);
  const facing =
    inner === 'bottom'
      ? 1 - smoothstep(y1 + jag - 1.5, y1 + jag + 2.5, y)
      : smoothstep(y0 + jag - 2.5, y0 + jag + 1.5, y);
  return across * outer * facing;
}

function stripeCoverage(x, y) {
  return Math.max(
    stripeDash(x, y, 98, 130, -1.2, 2.4, 'bottom'),
    stripeDash(x, y, 146, 172, 1.4, -2.2, 'top'),
  );
}

/** Forehead star: fat center, rounded uneven arms. */
function starCoverage(x, y) {
  const cy = 106;
  const cx = blazeX(cy);
  if (y < 90 || x < blazeX(y) - 6) return 0;
  const dx = x - cx;
  const dy = y - cy;
  const ang = Math.atan2(dy, dx);
  const arms = [-0.9, 0.25, 1.15, 2.15, -2.2];
  const reach = [4.2, 6.4, 5.2, 3.4, 2.2];
  const wide = [0.72, 0.85, 0.68, 0.6, 0.5];
  let arm = 0;
  for (let i = 0; i < arms.length; i++) {
    let delta = Math.abs(ang - arms[i]);
    if (delta > Math.PI) delta = Math.PI * 2 - delta;
    const t = clamp(delta / wide[i]);
    const lobe = Math.cos(t * Math.PI * 0.5);
    arm = Math.max(arm, lobe * lobe * reach[i]);
  }
  const radius = 6.2 + arm;
  const d = Math.hypot(dx, dy);
  return 1 - smoothstep(radius - 2.2, radius + 2.4, d);
}

/** Rhombus on the forehead, taller than it is wide. */
function diamondCoverage(x, y) {
  const cy = 106;
  const cx = blazeX(cy);
  if (y < 90 || x < blazeX(y) - 6) return 0;
  const dx = x - cx;
  const dy = y - cy;
  const ang = Math.atan2(dy, dx);
  const wobble =
    (fbm(Math.cos(ang) * 1.6 + 2, Math.sin(ang) * 1.6 + 5) - 0.5) * 0.16;
  const d = Math.abs(dx) / 7.4 + Math.abs(dy) / 10.2 + wobble;
  return 1 - smoothstep(0.82, 1.06, d);
}

/** Two uneven lobes and a soft point, still readable as a heart. */
function heartCoverage(x, y) {
  const cy = 104;
  const cx = blazeX(cy);
  if (y < 90 || x < blazeX(y) - 8) return 0;
  const dx = x - cx;
  const dy = y - cy;
  const ang = Math.atan2(dy, dx);
  const wobble =
    (fbm(Math.cos(ang) * 1.5 + 1.2, Math.sin(ang) * 1.5 + 4) - 0.5) * 0.14;
  const left = Math.hypot((dx + 3.2) / 4.4, (dy + 2.4) / 4) + wobble;
  const right = Math.hypot((dx - 4) / 5.1, (dy + 1.6) / 4.5) + wobble * 0.6;
  const lobes = Math.max(
    1 - smoothstep(0.7, 1.06, left),
    1 - smoothstep(0.7, 1.06, right),
  );
  const taper = 7 * (1 - clamp((dy + 0.5) / 10));
  const point =
    dy > -1 && dy < 9
      ? 1 - smoothstep(taper - 1.2, taper + 1.4, Math.abs(dx + dy * 0.08))
      : 0;
  return Math.max(lobes, point * (1 - smoothstep(6.5, 9.2, dy)));
}

/** Larger snip sitting on the midline of the muzzle. */
function snipCoverage(x, y) {
  const cy = 174;
  const cx = blazeX(cy) + 4;
  const dx = x - cx;
  const dy = y - cy;
  if (dy < -8 || dy > 7) return 0;
  const u = (dy + 8) / 15;
  const half =
    2.2 + 4.8 * fbm(u * 2.4, 3.3) + 1.6 * Math.sin(u * Math.PI * 1.7);
  const left = -(half * (0.65 + 0.5 * fbm(u * 3.1, 1.4)));
  const right = half * (0.55 + 0.6 * fbm(u * 2.7, 8.2));
  const across = Math.min(
    smoothstep(left - 1.2, left + 0.8, dx),
    1 - smoothstep(right - 0.8, right + 1.2, dx),
  );
  const end = (fbm(dx * 0.4, 5.5) - 0.5) * 3.5;
  const along =
    smoothstep(-7.6, -5.2, dy + end) *
    (1 - smoothstep(4.6, 7.2, dy - end * 0.6));
  return across * along;
}

function starSnipCoverage(x, y) {
  const cy = 106;
  const cx = blazeX(cy);
  let top = 0;
  if (y >= 92 && x >= blazeX(y) - 6) {
    const dx = x - cx;
    const dy = y - cy;
    const ang = Math.atan2(dy, dx);
    const wobble =
      (fbm(Math.cos(ang) * 1.4 + 2, Math.sin(ang) * 1.4 + 5) - 0.5) * 0.22;
    const d = Math.hypot(dx / 7.2, dy / 5.6) + wobble;
    top = 1 - smoothstep(0.7, 1.05, d);
  }
  return Math.max(top, snipCoverage(x, y));
}

/** Wide face white. The profile side fades before the silhouette so it does not stair-step. */
function baldCoverage(x, y) {
  if (y < 94 || y > 180 || !RIGHT) return 0;
  const t = clamp((y - 94) / (176 - 94));
  const cx = blazeX(y);
  const s = x - cx;
  const notch = Math.exp(-(((t - 0.62) / 0.16) ** 2)) * 12;
  const left = -(8 + 12 * t + (fbm(t * 2.6, 1.7) - 0.5) * 3) + notch;
  const right = 9 + 3 * Math.sin(t * Math.PI) + (fbm(t * 3.1, 6.4) - 0.5) * 2.4;
  const across = Math.min(
    smoothstep(left - 7, left + 5, s),
    1 - smoothstep(right - 2.2, right + 3.2, s),
  );
  const edge = RIGHT[Math.max(0, Math.min(SIZE - 1, Math.round(y)))];
  const inside = edge < 0 ? 0 : smoothstep(1.2, 6.5, edge - x);
  const top = smoothstep(92, 106, y);
  const sideLift = Math.min(0.16, Math.abs(s) / 50);
  const lipNoise = (fbm(s * 0.42, 11.2) - 0.5) * 0.18;
  const lip = 1 - smoothstep(0.86 - sideLift + lipNoise, 1.08, t);
  return across * inside * top * lip;
}

/** Forehead crescent, open toward the nose, kept off the mane. */
function crescentCoverage(x, y) {
  const cy = 106;
  const cx = blazeX(cy);
  if (y < 92 || x < blazeX(y) - 6) return 0;
  const dx = x - cx;
  const dy = y - cy;
  const ang = Math.atan2(dy, dx);
  const wobble =
    (fbm(Math.cos(ang) * 1.3 + 3, Math.sin(ang) * 1.3 + 2) - 0.5) * 0.1;
  const outer = Math.hypot(dx / 9, dy / 7.4) + wobble;
  const inner = Math.hypot((dx - 3.6) / 6.8, (dy - 0.6) / 5.8);
  return clamp(
    1 - smoothstep(0.76, 1.02, outer) - (1 - smoothstep(0.62, 0.96, inner)),
  );
}

function coverage(id, face) {
  if (!face || face.t < -0.04 || face.t > 1.08) return 0;
  const s = face.s;
  switch (id) {
    case 'blaze':
      return 0;
    case 'thin-blaze':
      return 0;
    case 'stripe':
      return 0;
    case 'star':
      return 0;
    case 'diamond':
      return 0;
    case 'heart':
      return 0;
    case 'crescent':
      return 0;
    case 'snip':
      return 0;
    case 'star-snip':
      return 0;
    case 'bald':
      return 0;
    default:
      return 0;
  }
}

/** Keep the near eye bay; bald and blaze must not paint the socket. */
function eyeHole(x, y) {
  const dx = x - 362;
  const dy = y - 112;
  const d = Math.hypot(dx / 11, dy / 7);
  return smoothstep(0.7, 1.15, d);
}

function paint(id, bay, right, center, width, height) {
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (bay[i + 3] < 40) continue;
      const face = faceOf(right, x, y);
      let cov =
        id === 'blaze'
          ? blazeCoverage(center, x, y)
          : id === 'thin-blaze'
            ? thinBlazeCoverage(x, y)
            : id === 'stripe'
              ? stripeCoverage(x, y)
              : id === 'star'
                ? starCoverage(x, y)
                : id === 'diamond'
                  ? diamondCoverage(x, y)
                  : id === 'heart'
                    ? heartCoverage(x, y)
                    : id === 'snip'
                      ? snipCoverage(x, y)
                      : id === 'star-snip'
                        ? starSnipCoverage(x, y)
                        : id === 'bald'
                          ? baldCoverage(x, y)
                          : id === 'crescent'
                            ? crescentCoverage(x, y)
                            : coverage(id, face);
      if (cov <= 0.02) continue;
      if (
        id !== 'blaze' &&
        id !== 'thin-blaze' &&
        id !== 'stripe' &&
        id !== 'star' &&
        id !== 'diamond' &&
        id !== 'heart' &&
        id !== 'snip' &&
        id !== 'star-snip' &&
        id !== 'bald' &&
        id !== 'crescent'
      ) {
        const n = fbm(x * 0.35, y * 0.35);
        cov *= 0.82 + 0.18 * n;
      }
      cov *= eyeHole(x, y);
      if (cov <= 0.04) continue;

      const L = 0.2126 * bay[i] + 0.7152 * bay[i + 1] + 0.0722 * bay[i + 2];
      const form =
        id === 'blaze' ||
        id === 'thin-blaze' ||
        id === 'stripe' ||
        id === 'star' ||
        id === 'diamond' ||
        id === 'heart' ||
        id === 'snip' ||
        id === 'star-snip' ||
        id === 'bald' ||
        id === 'crescent'
          ? clamp(0.74 + (L - 50) / 240, 0.62, 1.02)
          : clamp(0.62 + (L - 35) / 150, 0.58, 1.06);
      const side = id === 'blaze' ? clamp((x - blazeX(y)) / 8, -1, 1) : 0;
      let r = 244 * form * (1 + side * 0.04);
      let g = 238 * form * (1 + side * 0.03);
      let b = 230 * form * (1 - side * 0.02);
      const pink =
        id === 'bald'
          ? smoothstep(158, 176, y) *
            (0.35 + 0.65 * smoothstep(-4, 7, x - blazeX(y))) *
            (0.45 + 0.55 * fbm(x * 0.22, y * 0.28))
          : face
            ? smoothstep(0.78, 0.92, face.t) *
              (0.55 + 0.45 * smoothstep(0, 6, face.s + 4))
            : 0;
      if (
        id === 'blaze' ||
        id === 'bald' ||
        id === 'thin-blaze' ||
        id === 'stripe' ||
        id === 'snip' ||
        id === 'star-snip'
      ) {
        r = r * (1 - pink * 0.55) + 214 * pink;
        g = g * (1 - pink * 0.7) + 156 * pink;
        b = b * (1 - pink * 0.7) + 148 * pink;
      }
      const alpha = smoothstep(0.08, 0.35, cov);
      out[i] = Math.round(clamp(r, 0, 255));
      out[i + 1] = Math.round(clamp(g, 0, 255));
      out[i + 2] = Math.round(clamp(b, 0, 255));
      out[i + 3] = Math.round(clamp(alpha, 0, 1) * 255);
    }
  }
  return blurEdge(out, width, height);
}

/** Soften the alpha ramp so the white fringe is not a stair of pixels. */
function blurEdge(src, width, height) {
  const out = Buffer.from(src);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const here = (y * width + x) * 4;
      let a = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      let w = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const i = ((y + dy) * width + (x + dx)) * 4;
          const aa = src[i + 3];
          a += aa;
          r += src[i] * aa;
          g += src[i + 1] * aa;
          b += src[i + 2] * aa;
          w += aa;
        }
      }
      out[here + 3] = Math.round(a / 9);
      if (w > 0) {
        out[here] = Math.round(r / w);
        out[here + 1] = Math.round(g / w);
        out[here + 2] = Math.round(b / w);
      }
    }
  }
  return out;
}

async function composite(bay, overlay, width, height) {
  const preview = Buffer.from(bay);
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    const a = overlay[i + 3] / 255;
    if (a <= 0) continue;
    for (let c = 0; c < 3; c++) {
      preview[i + c] = Math.round(
        preview[i + c] * (1 - a) + overlay[i + c] * a,
      );
    }
  }
  return preview;
}

const bayImg = await sharp(path.join(ROOT, BAY))
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const { data, info } = bayImg;
const right = buildFrame(data, info.width);
const center = smoothCenter(right);
RIGHT = right;
const only = process.argv.slice(2);

for (const dir of OUTS) {
  await mkdir(path.join(ROOT, dir, '_preview'), { recursive: true });
}

for (const id of IDS) {
  if (only.length && !only.includes(id)) continue;
  let overlay = paint(id, data, right, center, info.width, info.height);
  const preview = await composite(data, overlay, info.width, info.height);
  for (const dir of OUTS) {
    await sharp(overlay, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .png({ compressionLevel: 9 })
      .toFile(path.join(ROOT, dir, `${id}.png`));
    await sharp(preview, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .extract({ left: 300, top: 40, width: 160, height: 180 })
      .resize(320, 360, { kernel: 'nearest' })
      .png()
      .toFile(path.join(ROOT, dir, '_preview', `${id}-on-bay.png`));
  }
  let area = 0;
  for (let p = 0; p < info.width * info.height; p++)
    if (overlay[p * 4 + 3] > 40) area++;
  console.log(id, 'area', area);
}
