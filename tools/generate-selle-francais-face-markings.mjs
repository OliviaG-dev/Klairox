/**
 * Face-marking overlays for the Selle Français silhouette.
 *
 * Drawn on the bay face (1024, left-facing profile) and shaded from that
 * coat's own lighting so the white follows the head.
 *
 *   node tools/generate-selle-francais-face-markings.mjs
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 1024;
const BAY = 'plugins/horse/layers/coat-selle-francais/bay.png';
const OUTS = [
  'plugins/horse/layers/markings/SelleFrancais',
  'apps/editor/public/plugins/horse/layers/markings/SelleFrancais',
];

/** Forehead (t=0) to lip (t=1) along the left-facing profile. */
const Y_FORE = 128;
const Y_LIP = 312;

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
 * Smaller x is toward the nose. The Selle Français profile is straight,
 * so the stripe follows the silhouette instead of a dish.
 */
function blazeX(y) {
  // Centre of the chamfrein: ~30px behind the nose outline,
  // in front of the eye (x≈230), not down the cheek.
  const pts = [
    [108, 176],
    [140, 172],
    [170, 160],
    [200, 152],
    [230, 148],
    [260, 146],
    [290, 132],
    [320, 118],
  ];
  if (y <= pts[0][0]) return pts[0][1];
  if (y >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 1; i < pts.length; i++) {
    const [y0, x0] = pts[i - 1];
    const [y1, x1] = pts[i];
    if (y <= y1) {
      const u = (y - y0) / (y1 - y0);
      return x0 + (x1 - x0) * u;
    }
  }
  return pts[pts.length - 1][1];
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
  const u = clamp((y - 118) / (318 - 118));
  const wander = (fbm(u * 1.4, 1.8) - 0.5) * 1.4;
  return blazeX(y) + wander;
}

function blazeCoverage(x, y) {
  const py = y - 36;
  if (py < 148 || py > 326) return 0;
  const t = clamp((py - 156) / (312 - 156));
  const crown = smoothstep(0.02, 0.12, t);
  const shaft = smoothstep(168, 190, py) * (1 - smoothstep(250, 280, py));
  const crownIn = smoothstep(154, 188, py);
  const half =
    (10 + 4 * crown) *
    (1 - t * 0.18) *
    (1 - 0.34 * shaft) *
    (0.28 + 0.72 * crownIn);
  const swing = 3.2;
  const nearNostril = smoothstep(0.62, 0.92, t);
  const nearEye = Math.exp(-(((py - 158) / 28) ** 2));
  const topWide =
    7 * smoothstep(0.1, 0.24, t) * (1 - smoothstep(0.24, 0.42, t));
  const neck =
    -(
      half * (1 - 0.72 * nearNostril) * (1 - 0.42 * nearEye) +
      (fbm(t * 2.2, 1.1) - 0.5) * swing
    ) -
    topWide +
    Math.exp(-(((py - 286) / 22) ** 2)) * 8;
  const nose = half + (fbm(t * 2.1, 6.3) - 0.5) * swing;
  const left = 4 + 14 * smoothstep(200, 280, y);
  const wander =
    (fbm(t * 3.6, 2.8) - 0.5) * 8 + (fbm(t * 9.2, 6.4) - 0.5) * 3.4;
  const s = blazeCenter(y) - left - x - wander;
  const band =
    py >= 158 && py <= 318
      ? Math.min(
          smoothstep(neck - 6, neck + 5, s),
          1 - smoothstep(nose - 5, nose + 6, s),
        )
      : 0;
  const lip = 1 - smoothstep(300, 322, py + (fbm(s * 0.35, 4.2) - 0.5) * 12);
  const fringe = (fbm(x * 0.22, py * 0.18) - 0.5) * 0.38;
  const capDx = blazeCenter(204) - left - x - wander;
  const cap =
    Math.hypot(capDx / (capDx < 0 ? 13 : 9), (py - 170) / 16) + fringe;
  const dome = 1 - smoothstep(0.82, 1.12, cap);
  let cov = Math.max(band * lip, dome);
  if (x > blazeCenter(y) - left + 6) {
    const past = smoothstep(8, 24, x - (blazeCenter(y) - left));
    cov *= 1 - 0.4 * nearEye * past;
  }
  return cov;
}

function thinBlazeCoverage(x, y) {
  if (y > 318) return 0;
  const c = blazeCenter(y);
  // Same squeezed blaze as before; only the axis leans with the head.
  const lean = (280 - y) * 0.28 - 15 - 6 * (1 - smoothstep(210, 255, y));
  const top = 1 - smoothstep(205, 252, y);
  const jag =
    ((fbm(y * 0.22, 3.1) - 0.5) * 8 + (fbm(y * 0.55, 8.4) - 0.5) * 3.5) * top;
  const x0 = x - lean - jag;
  const groove = Math.exp(-(((y - 284) / 8) ** 2));
  const inset = x0 < c ? groove * 10 : 0;
  const yJag = (fbm(x0 * 0.45, 2.6) - 0.5) * 9 * top;
  const cov = blazeCoverage(c + (x0 - c) * 2.2 - inset, y + yJag);
  return cov * (1 - smoothstep(298, 316, y));
}

function stripeDash(x, y, y0, y1, shift, lean, inner) {
  if (y < y0 - 18 || y > y1 + 18) return 0;
  const u = clamp((y - y0) / Math.max(1, y1 - y0));
  const low = y0 > 250;
  const swell = 0.35 + 0.65 * fbm(u * 2.8 + y0 * 0.01, 2.4);
  const pinch = low
    ? 0.25 + 0.75 * Math.sin(Math.PI * clamp(u))
    : inner === 'bottom'
      ? 0.4 + 0.85 * (1 - u)
      : 1;
  const half = (1.3 + (low ? 2.6 : 3.6) * swell) * pinch;
  const neck = -(half * (0.55 + 0.7 * fbm(u * 3.4, 4.1)));
  const nose = half * (0.5 + 0.75 * fbm(u * 3.1, 8.6));
  const yy = Math.max(y0, Math.min(y1, y));
  const wander = (fbm(u * 1.7, y0 * 0.02) - 0.5) * 3.2;
  const left = 4 + 14 * smoothstep(200, 280, yy);
  const s = blazeCenter(yy) - left - x - shift - wander;
  const across = Math.min(
    smoothstep(neck - 2.3, neck + 1.7, s),
    1 - smoothstep(nose - 1.7, nose + 2.3, s),
  );
  const jag =
    (fbm(s * 0.3, low ? 4.4 : inner === 'bottom' ? 2.1 : 6.8) - 0.5) *
    (low ? 18 : 14);
  const outer = low
    ? smoothstep(y0 - 4, y0 + 16, y + jag * 0.35) *
      (1 - smoothstep(y1 - 18, y1 + 2, y - jag * 0.35))
    : inner === 'bottom'
      ? smoothstep(y0 - 8, y0 + 5, y)
      : 1 - smoothstep(y1 - 5, y1 + 8, y);
  const facing = low
    ? 1
    : inner === 'bottom'
      ? 1 - smoothstep(y1 + jag - 2.4, y1 + jag + 4, y)
      : smoothstep(y0 + jag - 4, y0 + jag + 2.4, y);
  return across * outer * facing;
}

function stripeCoverage(x, y) {
  return Math.max(
    stripeDash(x, y, 206, 236, 0, 0, 'bottom'),
    stripeDash(x, y, 264, 312, 6, 0, 'top'),
  );
}

function starCoverage(x, y) {
  const cy = 208;
  const cx = 143;
  if (y < 96) return 0;
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
  const cy = 208;
  const cx = 143;
  if (y < 122) return 0;
  const dx = x - cx;
  const dy = y - cy;
  const ang = Math.atan2(dy, dx);
  const wobble =
    (fbm(Math.cos(ang) * 2.2 + 2, Math.sin(ang) * 2.2 + 5) - 0.5) * 0.2 +
    (fbm(y * 0.14, x * 0.12) - 0.5) * 0.1;
  const rx = dx < 0 ? 11 : 13.5;
  const ry = dy < 0 ? 17 : 20;
  const diamond = Math.abs(dx) / rx + Math.abs(dy) / ry;
  const round = Math.hypot(dx / (rx * 1.15), dy / (ry * 1.05));
  const d = diamond * 0.7 + round * 0.3 + wobble;
  return 1 - smoothstep(0.76, 1.12, d);
}

function heartCoverage(x, y) {
  const cy = 208;
  const cx = 143;
  if (y < 120) return 0;
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

function muzzleEdge(y) {
  const pts = [
    [320, 87],
    [336, 81],
    [352, 78],
    [368, 81],
    [384, 92],
  ];
  if (y <= pts[0][0]) return pts[0][1];
  if (y >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 1; i < pts.length; i++) {
    const [y0, x0] = pts[i - 1];
    const [y1, x1] = pts[i];
    if (y <= y1) {
      const u = (y - y0) / (y1 - y0);
      return x0 + (x1 - x0) * u;
    }
  }
  return pts[pts.length - 1][1];
}

function snipCoverage(x, y) {
  const cy = 358;
  const dy = y - cy;
  const u0 = (dy + 42) / 58;
  const nearNostril = smoothstep(0.55, 0.9, u0);
  const wander =
    (fbm(u0 * 4.8, 2.2) - 0.5) * (2.2 + 7 * nearNostril) +
    (fbm(y * 0.35, 7.1) - 0.5) * 4.5 * nearNostril;
  const dx = x - (muzzleEdge(y) + 10 + wander);
  if (dy < -42 || dy > 16) return 0;
  const u = u0;
  const bulge = Math.sin(Math.PI * clamp(u));
  const half =
    (1.8 +
      4.6 * fbm(u * 2.4, 3.3) +
      nearNostril * (fbm(u * 9, 3.6) - 0.5) * 5) *
    (0.15 + 0.85 * bulge * bulge) *
    (1 - 0.55 * nearNostril);
  const jag = (fbm(u * 6.2, 4.4) - 0.5) * (2.6 + 5 * nearNostril);
  const across = 1 - smoothstep(half - 1.6, half + 2.8, Math.abs(dx) + jag);
  const round =
    dy < -8
      ? 1 - smoothstep(0.78, 1.08, Math.hypot(dx / 9, (dy + 16) / 16))
      : 0;
  return Math.max(across * bulge, round);
}

function starSnipCoverage(x, y) {
  const cy = 208;
  const cx = 149;
  let top = 0;
  if (y >= 122) {
    const dx = x - cx;
    const dy = y - cy;
    const ang = Math.atan2(dy, dx);
    const wobble =
      (fbm(Math.cos(ang) * 2.2 + 1, Math.sin(ang) * 2.2) - 0.5) * 0.4 +
      (fbm(Math.cos(ang) * 5.2, Math.sin(ang) * 5.2 + 3) - 0.5) * 0.22;
    const d = Math.hypot(dx / 12, dy / 19) + wobble;
    top = 1 - smoothstep(0.78, 1.08, d);
  }
  return Math.max(top, snipCoverage(x, y));
}

function baldOuter(y) {
  const pts = [
    [192, 147],
    [214, 154],
    [226, 166],
    [238, 174],
    [252, 164],
    [270, 152],
    [292, 172],
    [314, 150],
    [332, 140],
    [350, 124],
    [364, 108],
    [376, 98],
  ];
  if (y <= pts[0][0]) return pts[0][1];
  if (y >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 1; i < pts.length; i++) {
    const [y0, x0] = pts[i - 1];
    const [y1, x1] = pts[i];
    if (y <= y1) {
      const u = (y - y0) / (y1 - y0);
      const s = u * u * (3 - 2 * u);
      return x0 + (x1 - x0) * s;
    }
  }
  return pts[pts.length - 1][1];
}

function baldCoverage(x, y) {
  if (y < 192 || y > 378 || !LEFT) return 0;
  const edge = LEFT[Math.max(0, Math.min(SIZE - 1, Math.round(y)))];
  if (edge < 0) return 0;
  const t = clamp((y - 205) / (365 - 205));
  const jag =
    (fbm(t * 2.1, 1.4) - 0.5) * 12 +
    (fbm(y * 0.16, 4.6) - 0.5) * 8 +
    (fbm(y * 0.48, 8.8) - 0.5) * 5;
  const outerX = baldOuter(y) + jag;
  const fromNose = x - edge;
  const inside = smoothstep(2, 8, fromNose);
  const outer = 1 - smoothstep(outerX - 9, outerX + 11, x);
  const top = smoothstep(192, 208, y + (fbm(x * 0.08, 2.4) - 0.5) * 6);
  const lip = 1 - smoothstep(346, 376, y + (fbm(x * 0.12, 3.2) - 0.5) * 16);
  let cov = inside * outer * top * lip;
  const hollow =
    1 -
    smoothstep(
      0.5,
      1.04,
      Math.hypot((x - 166) / 15, (y - 268) / 13) +
        (fbm(x * 0.16, y * 0.14) - 0.5) * 0.16,
    );
  cov = Math.max(cov, hollow * inside);
  const eye = Math.hypot((x - 190) / 30, (y - 221) / 22);
  cov *= smoothstep(0.78, 1.04, eye);
  return cov;
}

function crescentCoverage(x, y) {
  const cy = 208;
  const cx = 151;
  if (y < 122) return 0;
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
  const dx = x - 230;
  const dy = y - 142;
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
      const hair =
        (fbm(x * 0.07, y * 0.16) - 0.5) * 0.1 +
        (fbm(x * 0.2 + y * 0.04, y * 0.08) - 0.5) * 0.05;
      const noseShade = LEFT
        ? smoothstep(16, 3, x - LEFT[Math.min(SIZE - 1, y)]) * 0.1
        : 0;
      const lit = clamp((L - 28) / 130, 0, 1);
      const form = clamp(0.58 + lit * 0.55 + hair - noseShade, 0.46, 1.18);
      const spec = smoothstep(150, 210, L);
      let r = 236 * form + 18 * spec;
      let g = 230 * form + 16 * spec;
      let b = 222 * form + 12 * spec;
      const cavity =
        id === 'bald' && y > 338 && L < 62 ? clamp((62 - L) / 48, 0, 1) : 0;
      const hairs = fbm(x * 0.28, y * 0.22);
      const pink =
        id === 'bald'
          ? clamp(
              smoothstep(350, 376, y + (hairs - 0.5) * 18) *
                (0.55 + 0.2 * fbm(x * 0.1, y * 0.08)) *
                (1 - cavity * 0.35),
              0,
              1,
            )
          : smoothstep(0.86, 0.97, (y - Y_FORE) / (Y_LIP - Y_FORE)) *
            (0.45 + 0.4 * smoothstep(0, 9, blazeX(y) - x + 6));
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
        if (id === 'bald' && cavity > 0) {
          const rim = clamp(1 - cavity, 0, 1) * smoothstep(28, 55, L);
          r = r * (1 - cavity * 0.72) + 168 * rim * 0.35;
          g = g * (1 - cavity * 0.78) + 96 * rim * 0.3;
          b = b * (1 - cavity * 0.68) + 92 * rim * 0.25;
        }
      }
      const alpha = smoothstep(0.04, 0.62, cov);
      out[i] = Math.round(clamp(r, 0, 255));
      out[i + 1] = Math.round(clamp(g, 0, 255));
      out[i + 2] = Math.round(clamp(b, 0, 255));
      out[i + 3] = Math.round(clamp(alpha, 0, 1) * 255);
    }
  }
  const once = blurEdge(out, width, height);
  return blurEdge(once, width, height);
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
      .extract({ left: 130, top: 70, width: 250, height: 280 })
      .resize(440, 460, { kernel: 'nearest' })
      .png()
      .toFile(path.join(ROOT, dir, '_preview', `${id}-on-bay.png`));
  }
  let area = 0;
  for (let p = 0; p < info.width * info.height; p++)
    if (overlay[p * 4 + 3] > 40) area++;
  console.log(id, 'area', area);
}
