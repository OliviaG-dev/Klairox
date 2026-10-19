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

/** Forehead (t=0) to lip (t=1) along the left-facing dished profile. */
const Y_FORE = 162;
const Y_LIP = 298;
/** Forehead spots sit on the frontal bone, between the eyes. */
const Y_BROW = 176;

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
 * Midline of the nasal bone, inset from the nose outline.
 * The dished profile kinks if the stripe tracks the silhouette, so the
 * blaze uses this curve instead. Smaller x is toward the nose.
 */
function blazeX(y) {
  const u = clamp((y - Y_FORE) / (Y_LIP - Y_FORE));
  // Inset from the nose outline so the stripe stays on the front plane.
  // The old bridge control (206) pulled it back onto the cheek.
  const forehead = 200;
  const bridge = 184;
  const lip = 156;
  return (1 - u) * (1 - u) * forehead + 2 * (1 - u) * u * bridge + u * u * lip;
}

/** Pixels on the mane side of the face are not part of a marking. */
function onMane(x, y, pad = 8) {
  return x > blazeX(y) + pad;
}

/**
 * Blaze only. The shared axis stays put for the other markings.
 * Upper face is a mild dish; the lower third bends into the nostril cleft
 * instead of running straight off the nose.
 */
function blazeCenter(y) {
  const u = clamp((y - 136) / (308 - 136));
  const forehead = 208;
  const dish = 168;
  const cleft = 146;
  const x =
    (1 - u) * (1 - u) * forehead + 2 * (1 - u) * u * dish + u * u * cleft;
  const belowEyes = smoothstep(190, 220, y);
  const straight = 186 + ((y - 190) / (308 - 190)) * (cleft - 186);
  const base = x * (1 - belowEyes) + straight * belowEyes;
  const low = clamp((y - 240) / 70);
  const towardRightEye = Math.exp(-(((y - 188) / 46) ** 2)) * 11;
  const chanfrein = Math.exp(-(((y - 228) / 28) ** 2)) * 10;
  const wander = (fbm(u * 1.4, 1.8) - 0.5) * 1.6;
  const underEye = smoothstep(186, 210, y);
  return (
    base +
    (Math.sin(low * Math.PI * 0.85) * 5 * (0.35 - low) +
      towardRightEye +
      chanfrein +
      wander) *
      (1 - 0.72 * underEye)
  );
}

function blazeCoverage(x, y) {
  if (y < 126 || y > 328) return 0;
  const t = clamp((y - 136) / (308 - 136));
  const crown = smoothstep(0.05, 0.2, t);
  const shaft = smoothstep(198, 216, y) * (1 - smoothstep(272, 296, y));
  const half = (12 + 8 * crown) * (1 - t * 0.22) * (1 - 0.34 * shaft);
  const swing = 0.8;
  const nearNostril = smoothstep(0.62, 0.92, t);
  const nearEye = Math.exp(-(((y - 186) / 36) ** 2));
  const neck =
    -(
      half * (1 - 0.72 * nearNostril) * (1 - 0.42 * nearEye) +
      (fbm(t * 2.2, 1.1) - 0.5) * swing
    ) +
    Math.exp(-(((y - 278) / 22) ** 2)) * 12;
  const nose = half + (fbm(t * 2.1, 6.3) - 0.5) * swing;
  const s = blazeCenter(y) - x;
  const band =
    y >= 150 && y <= 322
      ? Math.min(
          smoothstep(neck - 6, neck + 5, s),
          1 - smoothstep(nose - 5, nose + 6, s),
        )
      : 0;
  const lip = 1 - smoothstep(302, 322, y + (fbm(s * 0.35, 4.2) - 0.5) * 12);
  const fringe = (fbm(x * 0.22, y * 0.18) - 0.5) * 0.12;
  const cap = Math.hypot((blazeCenter(146) - x) / 16, (y - 146) / 18) + fringe;
  const dome = 1 - smoothstep(0.68, 1.02, cap);
  let cov = Math.max(band * lip, dome);
  if (x > blazeCenter(y)) {
    const past = smoothstep(2, 16, x - blazeCenter(y));
    cov *= 1 - 0.7 * nearEye * past;
  }
  return cov;
}

function thinBlazeCoverage(x, y) {
  if (y > 266) return 0;
  const c = blazeCenter(y);
  const groove = Math.exp(-(((y - 248) / 8) ** 2));
  const inset = x < c ? groove * 10 : 0;
  const cov = blazeCoverage(c + (x - c) * 2.2 - inset, y);
  return cov * (1 - smoothstep(246, 264, y));
}

function stripeDash(x, y, y0, y1, shift, lean, inner) {
  if (y < y0 - 18 || y > y1 + 18) return 0;
  const u = clamp((y - y0) / Math.max(1, y1 - y0));
  const swell = 0.35 + 0.65 * fbm(u * 2.8 + y0 * 0.01, 2.4);
  const pinch =
    inner === 'bottom' ? 0.45 + 0.55 * Math.sin(Math.PI * clamp(u)) : 1;
  const half = (2.2 + 6.2 * swell) * pinch;
  const neck = -(half * (0.55 + 0.7 * fbm(u * 3.4, 4.1)));
  const nose = half * (0.5 + 0.75 * fbm(u * 3.1, 8.6));
  const yy = Math.max(y0, Math.min(y1, y));
  const wander = (fbm(u * 1.7, y0 * 0.02) - 0.5) * 1.6;
  const s = blazeCenter(yy) - x - shift - wander;
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
    stripeDash(x, y, 138, 186, 0, 0, 'bottom'),
    stripeDash(x, y, 224, 258, 8, 0, 'top'),
  );
}

function starCoverage(x, y) {
  const cy = 154;
  const cx = blazeCenter(cy) - 10;
  if (y < 128) return 0;
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
  const radius = 9.6 + arm + smoothstep(0, 10, dx) * 1.8;
  const d = Math.hypot(dx, dy);
  return 1 - smoothstep(radius - 3.4, radius + 3.6, d);
}

function diamondCoverage(x, y) {
  const cy = 154;
  const cx = blazeCenter(cy);
  if (y < 128) return 0;
  const dx = x - cx;
  const dy = y - cy;
  const ang = Math.atan2(dy, dx);
  const wobble =
    (fbm(Math.cos(ang) * 2.4 + 2, Math.sin(ang) * 2.4 + 5) - 0.5) * 0.42 +
    (fbm(Math.cos(ang) * 5.5, Math.sin(ang) * 5.5 + 1) - 0.5) * 0.18;
  const d = Math.abs(dx) / 16 + Math.abs(dy) / 21 + wobble;
  return 1 - smoothstep(0.82, 1.06, d);
}

function heartCoverage(x, y) {
  const cy = 152;
  const cx = blazeCenter(cy);
  if (y < 126) return 0;
  const dx = x - cx;
  const dy = y - cy;
  const ang = Math.atan2(dy, dx);
  const wobble =
    (fbm(Math.cos(ang) * 2.2 + 1.2, Math.sin(ang) * 2.2 + 4) - 0.5) * 0.55 +
    (fbm(Math.cos(ang) * 6.4, Math.sin(ang) * 6.4 + 2) - 0.5) * 0.28;
  const left = Math.hypot((dx + 6.2) / 8.4, (dy + 5.1) / 7.6) + wobble;
  const right = Math.hypot((dx - 9.2) / 12.4, (dy + 1.4) / 10.2) + wobble * 0.7;
  const lobes = Math.max(
    1 - smoothstep(0.58, 1.12, left),
    1 - smoothstep(0.55, 1.16, right),
  );
  const sway = (fbm(dy * 0.35, 2.2) - 0.5) * 6;
  const taper =
    13 * (1 - clamp((dy + 0.4) / 22)) + (fbm(dy * 0.5, 7) - 0.5) * 4;
  const point =
    dy > -1 && dy < 24
      ? 1 - smoothstep(taper - 3, taper + 2.4, Math.abs(dx + dy * 0.28 + sway))
      : 0;
  return Math.max(lobes, point * (1 - smoothstep(16, 24, dy)));
}

function snipCoverage(x, y) {
  const cy = 276;
  const cx = blazeCenter(cy) - 10;
  const dx = x - cx;
  const dy = y - cy;
  if (dy < -22 || dy > 18) return 0;
  const u = (dy + 22) / 40;
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
    smoothstep(-22, -14, dy + end) * (1 - smoothstep(12, 18, dy - end * 0.6));
  const cap = Math.hypot(dx / 12, (dy + 18) / 10);
  const roundTop = dy < -12 ? 1 - smoothstep(0.55, 1.08, cap) : 1;
  return across * along * roundTop;
}

function starSnipCoverage(x, y) {
  const cy = 154;
  const cx = blazeCenter(cy) - 8;
  let top = 0;
  if (y >= 110) {
    const dx = x - cx;
    const dy = y - cy;
    const ang = Math.atan2(dy, dx);
    const arms = [-1.4, 0.02, 1.55, 2.28, -2.15];
    const reach = [11, 19, 13, 16, 7];
    const wide = [0.72, 0.78, 0.7, 0.64, 0.58];
    let arm = 0;
    for (let i = 0; i < arms.length; i++) {
      let delta = Math.abs(ang - arms[i]);
      if (delta > Math.PI) delta = Math.PI * 2 - delta;
      const t = clamp(delta / wide[i]);
      const lobe = Math.cos(t * Math.PI * 0.5);
      arm = Math.max(arm, lobe * lobe * reach[i]);
    }
    const radius =
      8 +
      arm * (0.72 + 0.55 * fbm(Math.cos(ang) * 2.2 + 3, Math.sin(ang) * 2.2)) +
      (fbm(ang * 3.4 + 1, 4.2) - 0.5) * 4.5;
    const d = Math.hypot(dx, dy);
    top = 1 - smoothstep(radius - 2.2, radius + 2.4, d);
  }
  return Math.max(top, snipCoverage(x, y));
}

function baldCoverage(x, y) {
  if (y < 118 || y > 318 || !LEFT) return 0;
  const t = clamp((y - 130) / (300 - 130));
  const cx = blazeCenter(y) + 14;
  const s = cx - x;
  const edge = LEFT[Math.max(0, Math.min(SIZE - 1, Math.round(y)))];
  if (edge < 0) return 0;
  const inside = smoothstep(1, 8, x - edge);
  const right =
    26 +
    44 * Math.exp(-(((y - 188) / 26) ** 2)) +
    (fbm(t * 2.4, 2.1) - 0.5) * 4;
  const left =
    42 + 10 * smoothstep(0.45, 0.85, t) + (fbm(t * 4.1, 6.4) - 0.5) * 5;
  const across = Math.min(
    smoothstep(-right - 6, -right + 5, s),
    1 - smoothstep(left - 4, left + 5, s),
  );
  const crownX = blazeCenter(150) + 16;
  const crown =
    1 - smoothstep(0.8, 1.04, Math.hypot((x - crownX) / 52, (y - 162) / 34));
  const top = y < 176 ? crown : 1;
  const lip = 1 - smoothstep(304, 322, y + (fbm(s * 0.2, 4) - 0.5) * 8);
  if (y >= 172 && y <= 206 && x >= 248) return 0;
  return across * inside * top * lip;
}

function crescentCoverage(x, y) {
  const cy = 154;
  const cx = blazeCenter(cy);
  if (y < 120) return 0;
  const dx = x - cx;
  const dy = y - cy;
  const ang = Math.atan2(dy, dx);
  const wobble =
    (fbm(Math.cos(ang) * 2.4 + 3, Math.sin(ang) * 2.4 + 2) - 0.5) * 0.28 +
    (fbm(Math.cos(ang) * 5.2, Math.sin(ang) * 5.2 + 1) - 0.5) * 0.12;
  const outer = Math.hypot(dx / 20, dy / 16.5) + wobble;
  const inner =
    Math.hypot((dx - 7.4) / 14.5, (dy - 1.4) / 12.2) + wobble * 0.35;
  return clamp(
    1 - smoothstep(0.72, 1.05, outer) - (1 - smoothstep(0.55, 0.98, inner)),
  );
}

/** Keep the near eye bay; wide whites must not paint the socket. */
function eyeHole(x, y, scale = 1, lowerGap = false) {
  const dx = x - 254;
  const dy = y - 166;
  const ry = (lowerGap && dy > 0 ? 15 : 11) * scale;
  const d = Math.hypot(dx / (15 * scale), dy / ry);
  return smoothstep(0.88, 1.04, d);
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
      cov *= eyeHole(x, y, id === 'bald' ? 1.45 : 1, id === 'bald');
      if (cov <= 0.04) continue;

      const L = 0.2126 * bay[i] + 0.7152 * bay[i + 1] + 0.0722 * bay[i + 2];
      const form =
        id === 'bald'
          ? clamp(0.58 + (L - 32) / 120, 0.5, 1.1)
          : clamp(0.74 + (L - 50) / 240, 0.62, 1.02);
      const side = id === 'blaze' ? clamp((blazeX(y) - x) / 12, -1, 1) : 0;
      let r = 244 * form * (1 + side * 0.04);
      let g = 238 * form * (1 + side * 0.03);
      let b = 230 * form * (1 - side * 0.02);
      if (id === 'bald') {
        const spec = smoothstep(145, 205, L);
        r += 22 * spec;
        g += 20 * spec;
        b += 16 * spec;
      }
      const pink =
        id === 'bald'
          ? smoothstep(226, 318, y) *
            (0.78 + 0.22 * smoothstep(-10, 16, blazeX(y) - x)) *
            (0.88 + 0.12 * fbm(x * 0.08, y * 0.1))
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
        r =
          r * (1 - pink * (id === 'bald' ? 0.78 : 0.55)) +
          (id === 'bald' ? 232 : 214) * pink;
        g =
          g * (1 - pink * (id === 'bald' ? 0.82 : 0.7)) +
          (id === 'bald' ? 146 : 156) * pink;
        b =
          b * (1 - pink * (id === 'bald' ? 0.82 : 0.7)) +
          (id === 'bald' ? 138 : 148) * pink;
      }
      const alpha = smoothstep(0.08, 0.35, cov);
      out[i] = Math.round(clamp(r, 0, 255));
      out[i + 1] = Math.round(clamp(g, 0, 255));
      out[i + 2] = Math.round(clamp(b, 0, 255));
      out[i + 3] = Math.round(clamp(alpha, 0, 1) * 255);
    }
  }
  const once = blurEdge(out, width, height);
  return id === 'blaze' ? blurEdge(once, width, height) : once;
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
