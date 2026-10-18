/**
 * Face-marking overlays for the Arabian silhouette.
 *
 * Drawn on the bay face (1024, left-facing profile) and shaded from that
 * coat's own lighting so the white follows the head.
 *
 *   node tools/generate-arabian-face-markings.mjs
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 1024;
const BAY = 'plugins/horse/layers/coat-arabian/bay.png';
const OUTS = [
  'plugins/horse/layers/markings/Arabian',
  'apps/editor/public/plugins/horse/layers/markings/Arabian',
];

/** Forehead (t=0) to lip (t=1) along the left-facing profile. */
const Y_FORE = 162;
const Y_LIP = 300;

let LEFT = null;
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
  const left = new Int16Array(SIZE);
  left.fill(-1);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 200) {
        left[y] = x;
        break;
      }
    }
  }
  return left;
}

/**
 * Midline of the nasal bone. The dished profile kinks if the stripe tracks
 * the silhouette, so the blaze uses this curve instead.
 * Smaller x is toward the nose.
 */
function blazeX(y) {
  const u = clamp((y - Y_FORE) / (Y_LIP - Y_FORE));
  const forehead = 238;
  const bridge = 220;
  const lip = 172;
  return (1 - u) * (1 - u) * forehead + 2 * (1 - u) * u * bridge + u * u * lip;
}

/** Pixels on the mane side of the face are not part of a marking. */
function onMane(x, y, pad = 8) {
  return x > blazeX(y) + pad;
}

/**
 * Follows the dish: wider and round on the forehead, then forward
 * with the nose so it ends between the nostrils.
 */
function blazeCenter(y) {
  const u = clamp((y - 168) / (298 - 168));
  const forehead = 232;
  const bridge = 214;
  const lip = 176;
  return (1 - u) * (1 - u) * forehead + 2 * (1 - u) * u * bridge + u * u * lip;
}

function blazeCoverage(x, y) {
  if (y < 158 || y > 304) return 0;
  const t = clamp((y - 168) / (298 - 168));
  const half = 20 * (1 - t) + 7.5 * t;
  const swing = 5.5 * (1 - t * 0.4);
  const neck = -(
    half +
    (fbm(t * 4.2, 1.1) - 0.5) * swing +
    (fbm(t * 11, 2.4) - 0.5) * 2.2
  );
  const nose =
    half + (fbm(t * 3.6, 6.3) - 0.5) * swing + (fbm(t * 10, 8.2) - 0.5) * 2.2;
  const s = blazeCenter(y) - x;
  const band =
    y >= 172 && y <= 296
      ? Math.min(
          smoothstep(neck - 2.6, neck + 2, s),
          1 - smoothstep(nose - 2, nose + 2.6, s),
        )
      : 0;
  const lip = 1 - smoothstep(0.92, 1, t);
  const fringe = (fbm(x * 0.22, y * 0.18) - 0.5) * 0.22;
  const cap = Math.hypot((blazeCenter(172) - x) / 22, (y - 172) / 16) + fringe;
  const dome = 1 - smoothstep(0.68, 1.02, cap);
  return Math.max(band * lip, dome);
}

function thinBlazeCoverage(x, y) {
  if (y < 154 || y > 308) return 0;
  const t = clamp((y - 166) / (296 - 166));
  const wave = 0.5 + 0.5 * Math.sin(t * Math.PI * 2.2 + 1.15);
  const n = fbm(t * 3.6, 5.5);
  const half = 2 + 6.5 * (0.55 * wave + 0.45 * n);
  const neck = -(half * (0.82 + 0.35 * fbm(t * 3.2, 2.2)));
  const nose = half * (0.78 + 0.4 * fbm(t * 2.8, 8.4));
  const s = blazeX(y) - x;
  const body =
    y >= 170 && y <= 294
      ? Math.min(
          smoothstep(neck - 2.1, neck + 1.5, s),
          1 - smoothstep(nose - 1.5, nose + 2.1, s),
        ) *
        (1 - smoothstep(0.86, 1, t))
      : 0;
  const topHalf =
    2 + 6.5 * (0.55 * (0.5 + 0.5 * Math.sin(1.15)) + 0.45 * fbm(0, 5.5));
  const fringe = (fbm(x * 0.28, y * 0.22) - 0.5) * 0.22;
  const cap =
    Math.hypot(
      (blazeX(168) - x) / (topHalf * 1.05),
      (y - 168) / (topHalf * 1.55),
    ) + fringe;
  const dome = 1 - smoothstep(0.58, 1.04, cap);
  return Math.max(body, dome);
}

function stripeDash(x, y, y0, y1, shift, lean, inner) {
  if (y < y0 - 18 || y > y1 + 18) return 0;
  const u = clamp((y - y0) / Math.max(1, y1 - y0));
  const swell = 0.35 + 0.65 * fbm(u * 2.8 + y0 * 0.01, 2.4);
  const half = 2.5 + 8.4 * swell;
  const neck = -(half * (0.55 + 0.7 * fbm(u * 3.4, 4.1)));
  const nose = half * (0.5 + 0.75 * fbm(u * 3.1, 8.6));
  const yy = Math.max(y0, Math.min(y1, y));
  const wander = (fbm(u * 1.7, y0 * 0.02) - 0.5) * 3.4;
  const s = blazeX(yy) - x - shift - Math.sin(u * Math.PI) * lean - wander;
  const across = Math.min(
    smoothstep(neck - 2.3, neck + 1.7, s),
    1 - smoothstep(nose - 1.7, nose + 2.3, s),
  );
  const jag = (fbm(s * 0.3, inner === 'bottom' ? 2.1 : 6.8) - 0.5) * 14;
  const outer =
    inner === 'bottom'
      ? smoothstep(y0 - 8, y0 + 5, y)
      : 1 - smoothstep(y1 - 5, y1 + 8, y);
  const facing =
    inner === 'bottom'
      ? 1 - smoothstep(y1 + jag - 2.4, y1 + jag + 4, y)
      : smoothstep(y0 + jag - 4, y0 + jag + 2.4, y);
  return across * outer * facing;
}

function stripeCoverage(x, y) {
  return Math.max(
    stripeDash(x, y, 166, 214, -2, 3.6, 'bottom'),
    stripeDash(x, y, 236, 278, 2.2, -3.4, 'top'),
  );
}

function starCoverage(x, y) {
  const cy = 166;
  const cx = blazeX(cy);
  if (y < 142 || onMane(x, y, 10)) return 0;
  const dx = x - cx;
  const dy = y - cy;
  const ang = Math.atan2(dy, dx);
  const arms = [-0.9, 0.25, 1.15, 2.15, -2.2];
  const reach = [6.5, 10, 8.1, 5.3, 3.4];
  const wide = [0.72, 0.85, 0.68, 0.6, 0.5];
  let arm = 0;
  for (let i = 0; i < arms.length; i++) {
    let delta = Math.abs(ang - arms[i]);
    if (delta > Math.PI) delta = Math.PI * 2 - delta;
    const t = clamp(delta / wide[i]);
    const lobe = Math.cos(t * Math.PI * 0.5);
    arm = Math.max(arm, lobe * lobe * reach[i]);
  }
  const radius = 9.6 + arm;
  const d = Math.hypot(dx, dy);
  return 1 - smoothstep(radius - 3.4, radius + 3.6, d);
}

function diamondCoverage(x, y) {
  const cy = 166;
  const cx = blazeX(cy);
  if (y < 142 || onMane(x, y, 10)) return 0;
  const dx = x - cx;
  const dy = y - cy;
  const ang = Math.atan2(dy, dx);
  const wobble =
    (fbm(Math.cos(ang) * 1.6 + 2, Math.sin(ang) * 1.6 + 5) - 0.5) * 0.16;
  const d = Math.abs(dx) / 11.5 + Math.abs(dy) / 15.8 + wobble;
  return 1 - smoothstep(0.82, 1.06, d);
}

function heartCoverage(x, y) {
  const cy = 164;
  const cx = blazeX(cy);
  if (y < 140 || onMane(x, y, 12)) return 0;
  const dx = x - cx;
  const dy = y - cy;
  const ang = Math.atan2(dy, dx);
  const wobble =
    (fbm(Math.cos(ang) * 1.5 + 1.2, Math.sin(ang) * 1.5 + 4) - 0.5) * 0.14;
  const left = Math.hypot((dx + 5) / 6.8, (dy + 3.7) / 6.2) + wobble;
  const right = Math.hypot((dx - 6.2) / 7.9, (dy + 2.5) / 7) + wobble * 0.6;
  const lobes = Math.max(
    1 - smoothstep(0.7, 1.06, left),
    1 - smoothstep(0.7, 1.06, right),
  );
  const taper = 11 * (1 - clamp((dy + 0.8) / 15));
  const point =
    dy > -1.5 && dy < 14
      ? 1 - smoothstep(taper - 1.8, taper + 2.2, Math.abs(dx + dy * 0.08))
      : 0;
  return Math.max(lobes, point * (1 - smoothstep(10, 14.2, dy)));
}

function snipCoverage(x, y) {
  const cy = 276;
  const cx = blazeX(cy);
  const dx = x - cx;
  const dy = y - cy;
  if (dy < -12 || dy > 11) return 0;
  const u = (dy + 12) / 23;
  const half =
    3.4 + 7.4 * fbm(u * 2.4, 3.3) + 2.5 * Math.sin(u * Math.PI * 1.7);
  const neck = -(half * (0.65 + 0.5 * fbm(u * 3.1, 1.4)));
  const nose = half * (0.55 + 0.6 * fbm(u * 2.7, 8.2));
  const across = Math.min(
    smoothstep(neck - 1.8, neck + 1.2, -dx),
    1 - smoothstep(nose - 1.2, nose + 1.8, -dx),
  );
  const end = (fbm(dx * 0.26, 5.5) - 0.5) * 5.4;
  const along =
    smoothstep(-11.5, -8, dy + end) * (1 - smoothstep(7, 11, dy - end * 0.6));
  return across * along;
}

function starSnipCoverage(x, y) {
  const cy = 166;
  const cx = blazeX(cy);
  let top = 0;
  if (y >= 146 && !onMane(x, y, 10)) {
    const dx = x - cx;
    const dy = y - cy;
    const ang = Math.atan2(dy, dx);
    const wobble =
      (fbm(Math.cos(ang) * 1.4 + 2, Math.sin(ang) * 1.4 + 5) - 0.5) * 0.22;
    const d = Math.hypot(dx / 11.2, dy / 8.7) + wobble;
    top = 1 - smoothstep(0.7, 1.05, d);
  }
  return Math.max(top, snipCoverage(x, y));
}

function baldCoverage(x, y) {
  if (y < 156 || y > 308 || !LEFT) return 0;
  const t = clamp((y - 160) / (300 - 160));
  const cx = blazeX(y);
  const s = cx - x;
  const notch = Math.exp(-(((t - 0.62) / 0.16) ** 2)) * 18;
  const neck = -(12 + 18 * t + (fbm(t * 2.6, 1.7) - 0.5) * 4.6) + notch;
  const nose =
    14 + 4.6 * Math.sin(t * Math.PI) + (fbm(t * 3.1, 6.4) - 0.5) * 3.6;
  const across = Math.min(
    smoothstep(neck - 11, neck + 8, s),
    1 - smoothstep(nose - 3.4, nose + 5, s),
  );
  const edge = LEFT[Math.max(0, Math.min(SIZE - 1, Math.round(y)))];
  const inside = edge < 0 ? 0 : smoothstep(2, 10, x - edge);
  const top = smoothstep(154, 176, y);
  const sideLift = Math.min(0.16, Math.abs(s) / 78);
  const lipNoise = (fbm(s * 0.28, 11.2) - 0.5) * 0.18;
  const lip = 1 - smoothstep(0.86 - sideLift + lipNoise, 1.08, t);
  return across * inside * top * lip;
}

function crescentCoverage(x, y) {
  const cy = 166;
  const cx = blazeX(cy);
  if (y < 144 || onMane(x, y, 10)) return 0;
  const dx = x - cx;
  const dy = y - cy;
  const ang = Math.atan2(dy, dx);
  const wobble =
    (fbm(Math.cos(ang) * 1.3 + 3, Math.sin(ang) * 1.3 + 2) - 0.5) * 0.1;
  const outer = Math.hypot(dx / 14, dy / 11.5) + wobble;
  const inner = Math.hypot((dx - 5.6) / 10.5, (dy - 0.9) / 9);
  return clamp(
    1 - smoothstep(0.76, 1.02, outer) - (1 - smoothstep(0.62, 0.96, inner)),
  );
}

/** Keep the near eye bay; wide whites must not paint the socket. */
function eyeHole(x, y) {
  const dx = x - 262;
  const dy = y - 192;
  const d = Math.hypot(dx / 17, dy / 11);
  return smoothstep(0.7, 1.15, d);
}

function paint(id, bay, width, height) {
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (bay[i + 3] < 40) continue;
      let cov =
        id === 'blaze'
          ? blazeCoverage(x, y)
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
                            : 0;
      if (cov <= 0.02) continue;
      cov *= eyeHole(x, y);
      if (cov <= 0.04) continue;

      const L = 0.2126 * bay[i] + 0.7152 * bay[i + 1] + 0.0722 * bay[i + 2];
      const form = clamp(0.74 + (L - 50) / 240, 0.62, 1.02);
      const side = id === 'blaze' ? clamp((blazeX(y) - x) / 12, -1, 1) : 0;
      let r = 244 * form * (1 + side * 0.04);
      let g = 238 * form * (1 + side * 0.03);
      let b = 230 * form * (1 - side * 0.02);
      const pink =
        id === 'bald'
          ? smoothstep(274, 304, y) *
            (0.35 + 0.65 * smoothstep(-6, 11, blazeX(y) - x)) *
            (0.45 + 0.55 * fbm(x * 0.14, y * 0.18))
          : smoothstep(0.78, 0.92, (y - Y_FORE) / (Y_LIP - Y_FORE)) *
            (0.55 + 0.45 * smoothstep(0, 9, blazeX(y) - x + 6));
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
LEFT = buildFrame(data, info.width);
const only = process.argv.slice(2);

for (const dir of OUTS) {
  await mkdir(path.join(ROOT, dir, '_preview'), { recursive: true });
}

for (const id of IDS) {
  if (only.length && !only.includes(id)) continue;
  const overlay = paint(id, data, info.width, info.height);
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
      .extract({ left: 140, top: 120, width: 220, height: 230 })
      .resize(440, 460, { kernel: 'nearest' })
      .png()
      .toFile(path.join(ROOT, dir, '_preview', `${id}-on-bay.png`));
  }
  let area = 0;
  for (let p = 0; p < info.width * info.height; p++)
    if (overlay[p * 4 + 3] > 40) area++;
  console.log(id, 'area', area);
}
