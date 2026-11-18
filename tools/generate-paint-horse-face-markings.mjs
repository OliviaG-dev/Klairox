/**
 * Face-marking overlays for the Paint Horse silhouette.
 *
 * The head is three-quarter, facing the camera. Markings sit on the
 * nasal plane between the eyes and the muzzle, shaded from the bay coat.
 *
 *   node tools/generate-paint-horse-face-markings.mjs
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 1024;
const BAY = 'plugins/horse/layers/coat-paint-horse/bay.png';
const OUTS = [
  'plugins/horse/layers/markings/PaintHorse',
  'apps/editor/public/plugins/horse/layers/markings/PaintHorse',
];

/** Near eye (larger, horse's right) and far eye. */
const NEAR_EYE = { x: 688, y: 184, rx: 22, ry: 16 };
const FAR_EYE = { x: 764, y: 136, rx: 13, ry: 10 };

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

function buildRight(data, width) {
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

/** Chanfrein midline: under the forelock, down the nasal bone, between the nostrils. */
function faceX(y) {
  const pts = [
    [155, 738],
    [180, 736],
    [205, 738],
    [230, 742],
    [255, 748],
    [280, 754],
    [305, 758],
    [325, 756],
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

function blazeCoverage(x, y) {
  if (y < 148 || y > 322) return 0;
  const t = clamp((y - 165) / (310 - 165));
  const wander = (fbm(t * 2.4, 1.6) - 0.5) * 2.2;
  const cx = faceX(y) + wander;
  const topWide = 1 - smoothstep(0.05, 0.42, t);
  const base = 7 + 9 * topWide;
  const low = smoothstep(0.58, 0.92, t);
  const left = base + 10 * low;
  const right = base * (1 - 0.12 * low);
  const dx = x - cx;
  const edge = (fbm(t * 5.2, dx * 0.2) - 0.5) * 2.4;
  const s = dx + edge;
  const band =
    s < 0
      ? 1 - smoothstep(left - 3.5, left + 3.2, -s)
      : 1 - smoothstep(right - 3.5, right + 3.2, s);
  const jagY = (fbm(x * 0.18, 3.4) - 0.5) * 10;
  const capCy = 176;
  const rx = (s < 0 ? left : right) + 1.5;
  const ry = 14 + (fbm(s * 0.4, 1.7) - 0.5) * 5;
  const cap = Math.hypot(s / rx, (y - capCy + jagY) / ry);
  const dome = 1 - smoothstep(0.72, 1.02, cap);
  const body = band * smoothstep(capCy - 4, capCy + 10, y);
  const lip = 1 - smoothstep(302, 320, y);
  return Math.max(body, dome) * lip;
}

function thinBlazeCoverage(x, y) {
  if (y < 142 || y > 320) return 0;
  const t = clamp((y - 152) / (308 - 152));
  const wander = (fbm(t * 1.7, 2.2) - 0.5) * 14 + (fbm(t * 5.6, 5.1) - 0.5) * 6;
  const cx = faceX(y) + wander;
  const pinch = 0.35 + 0.65 * fbm(t * 2.8, 9.2);
  const topWide = 1 - smoothstep(0.02, 0.32, t);
  const half = (2.2 + 4.6 * fbm(t * 4.1, 3.3)) * pinch + 5.5 * topWide;
  const dx = x - cx;
  const jag = (fbm(t * 8, dx * 0.35) - 0.5) * 6;
  const yJag = (fbm(x * 0.25, 4.6) - 0.5) * 8;
  const band = 1 - smoothstep(half - 1.2, half + 2.4, Math.abs(dx) + jag);
  const top = smoothstep(142, 158, y + yJag);
  const lip = 1 - smoothstep(292, 318, y - yJag * 0.4);
  return band * top * lip;
}

function stripeCoverage(x, y) {
  const dashes = [
    [188, 214, 0],
    [250, 300, -4],
  ];
  let cov = 0;
  for (const [y0, y1, shift] of dashes) {
    if (y < y0 - 10 || y > y1 + 10) continue;
    const u = clamp((y - y0) / (y1 - y0));
    const low = shift !== 0;
    if (!low) {
      const cy = (y0 + y1) / 2;
      const cx = faceX(cy);
      const dx = x - cx;
      const dy = y - cy;
      const ang = Math.atan2(dy, dx);
      const wobble =
        (fbm(Math.cos(ang) * 2.4 + 1.2, Math.sin(ang) * 2.4) - 0.5) * 0.85 +
        (fbm(Math.cos(ang) * 6.5, Math.sin(ang) * 6.5 + 2) - 0.5) * 0.5;
      const d = Math.hypot(dx / 6.4, dy / 18) + wobble * 0.7;
      cov = Math.max(cov, 1 - smoothstep(0.55, 1.05, d));
      continue;
    }
    const wander =
      (fbm(u * (low ? 2.4 : 2), y0 * 0.01) - 0.5) * (low ? 5.5 : 2) +
      (low ? (fbm(u * 6.2, 4.4) - 0.5) * 3.2 : 0);
    const cx = faceX(y) + shift + wander;
    const half =
      (2.2 + (low ? 2.4 : 1.6) * fbm(u * 3.1, 2.8)) *
      (0.55 + 0.45 * Math.sin(Math.PI * clamp(u)));
    const jag = (fbm(u * 8, x * 0.2) - 0.5) * (low ? 5 : 1.5);
    const across = 1 - smoothstep(half - 1.2, half + 2, Math.abs(x - cx) + jag);
    const endJag = (fbm(x * 0.3, y0) - 0.5) * (low ? 8 : 2);
    const along =
      smoothstep(y0 - 4, y0 + 8, y + endJag * 0.3) *
      (1 - smoothstep(y1 - 8, y1 + 4, y - endJag * 0.3));
    cov = Math.max(cov, across * along);
  }
  return cov;
}

function starCoverage(x, y) {
  const cx = 740;
  const cy = 168;
  const dx = x - cx;
  const dy = y - cy;
  const ang = Math.atan2(dy, dx);
  const arms = [-1.2, -0.1, 0.9, 2.1, -2.4];
  const reach = [7, 11, 8, 6, 4];
  const wide = [0.7, 0.85, 0.7, 0.6, 0.5];
  let arm = 0;
  for (let i = 0; i < arms.length; i++) {
    let delta = Math.abs(ang - arms[i]);
    if (delta > Math.PI) delta = Math.PI * 2 - delta;
    const t = clamp(delta / wide[i]);
    const lobe = Math.cos(t * Math.PI * 0.5);
    arm = Math.max(arm, lobe * lobe * reach[i]);
  }
  const d = Math.hypot(dx, dy);
  return 1 - smoothstep(8 + arm - 3, 8 + arm + 3.2, d);
}

function diamondCoverage(x, y) {
  const cx = 740;
  const cy = 168;
  const dx = x - cx;
  const dy = y - cy;
  const diamond = Math.abs(dx) / 14 + Math.abs(dy) / 18;
  const round = Math.hypot(dx / 15, dy / 19);
  const wobble = (fbm(x * 0.12, y * 0.12) - 0.5) * 0.12;
  return 1 - smoothstep(0.72, 1.08, diamond * 0.65 + round * 0.35 + wobble);
}

function heartCoverage(x, y) {
  const cx = 740;
  const cy = 168;
  const dx = x - cx;
  const dy = y - cy;
  const left = Math.hypot((dx + 6) / 9, (dy + 5) / 8);
  const right = Math.hypot((dx - 6) / 9, (dy + 5) / 8);
  const lobes = Math.max(
    1 - smoothstep(0.55, 1.08, left),
    1 - smoothstep(0.55, 1.08, right),
  );
  const taper = 12 * (1 - clamp((dy + 2) / 20));
  const point =
    dy > -2 && dy < 22
      ? 1 - smoothstep(taper - 2, taper + 2.2, Math.abs(dx))
      : 0;
  return Math.max(lobes, point * (1 - smoothstep(14, 22, dy)));
}

function snipCoverage(x, y, cx = 740, cy = 168) {
  const dx = x - cx + (fbm(y * 0.2, 2) - 0.5) * 3;
  const dy = y - cy;
  if (dy < -16 || dy > 14) return 0;
  const bulge = Math.sin(Math.PI * clamp((dy + 16) / 30));
  const half = (6 + 3 * bulge) * (0.4 + 0.6 * bulge);
  return 1 - smoothstep(half - 1.5, half + 2.4, Math.abs(dx));
}

function starSnipCoverage(x, y) {
  const cx = 738;
  const cy = 166;
  const dx = x - cx;
  const dy = y - cy;
  const ang = Math.atan2(dy, dx);
  const lobe =
    0.78 +
    Math.sin(ang * 3 + 0.6) * 0.16 +
    Math.sin(ang * 5 - 1.1) * 0.1 +
    (fbm(Math.cos(ang) * 1.6 + 2.2, Math.sin(ang) * 1.6) - 0.5) * 0.28;
  const d = Math.hypot(dx / 15, (dy - 1) / 13);
  const grain = (fbm(x * 0.45, y * 0.45) - 0.5) * 0.16;
  const top = y < 118 ? 0 : 1 - smoothstep(lobe - 0.08, lobe + 0.2, d + grain);
  return Math.max(top, snipCoverage(x, y, 746, 312));
}

function muzzleLeft(y) {
  const pts = [
    [180, 690],
    [210, 676],
    [240, 670],
    [270, 674],
    [300, 688],
    [322, 708],
    [338, 720],
    [352, 728],
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

function baldCoverage(x, y) {
  if (y < 148 || y > 368) return 0;
  const t = clamp((y - 158) / (330 - 158));
  const cx = faceX(y);
  const jag = (fbm(t * 3.1, 1.6) - 0.5) * 5 + (fbm(y * 0.22, 4.4) - 0.5) * 3;
  const low = smoothstep(0.55, 0.78, t);
  const wide = 16 + 10 * smoothstep(0.15, 0.55, t);
  const flare = 28 * smoothstep(0.12, 0.45, t);
  const left = Math.max(cx - wide - flare + jag, muzzleLeft(y));
  const right = cx + wide + 26 * low + jag * 0.4;
  const dx = x - cx;
  const edge = (fbm(t * 6.4, x * 0.08) - 0.5) * 3;
  const inside = smoothstep(left - 3, left + 6, x + edge);
  const outer = 1 - smoothstep(right - 6, right + 4, x - edge);
  const cap = Math.hypot(dx / (wide + 2), (y - 172) / 16);
  const dome =
    1 - smoothstep(0.75, 1.05, cap + (fbm(x * 0.2, 2.2) - 0.5) * 0.25);
  const body = inside * outer * smoothstep(168, 184, y);
  const noseX = cx - 4;
  const fromNose = x - noseX;
  if (x < muzzleLeft(y)) return 0;
  const lipY =
    358 - (Math.abs(fromNose) / 48) ** 1.3 * 8 + (fbm(x * 0.18, 5.2) - 0.5) * 3;
  const lip = 1 - smoothstep(lipY - 5, lipY + 9, y);
  const nose =
    y > 284 && y < 352 && x >= muzzleLeft(y) && x <= faceX(y) + 38 ? 1 : 0;
  return Math.max(body * lip, dome * (y < 190 ? 1 : 0) * lip, nose);
}

function crescentCoverage(x, y) {
  const cx = 740;
  const cy = 168;
  const dx = x - cx;
  const dy = y - cy;
  const outer = Math.hypot(dx / 18, dy / 15);
  const inner = Math.hypot((dx - 6) / 12, (dy - 1) / 11);
  return clamp(
    1 - smoothstep(0.7, 1.02, outer) - (1 - smoothstep(0.52, 0.95, inner)),
  );
}

function eyeHole(x, y, scale = 1) {
  const near = Math.hypot(
    (x - NEAR_EYE.x) / (NEAR_EYE.rx * scale),
    (y - NEAR_EYE.y) / (NEAR_EYE.ry * scale),
  );
  const far = Math.hypot(
    (x - FAR_EYE.x) / (FAR_EYE.rx * scale),
    (y - FAR_EYE.y) / (FAR_EYE.ry * scale),
  );
  return smoothstep(0.82, 1.05, near) * smoothstep(0.82, 1.05, far);
}

function coverage(id, x, y) {
  if (id === 'blaze') return blazeCoverage(x, y);
  if (id === 'thin-blaze') return thinBlazeCoverage(x, y);
  if (id === 'stripe') return stripeCoverage(x, y);
  if (id === 'star') return starCoverage(x, y);
  if (id === 'diamond') return diamondCoverage(x, y);
  if (id === 'heart') return heartCoverage(x, y);
  if (id === 'snip') return snipCoverage(x, y);
  if (id === 'star-snip') return starSnipCoverage(x, y);
  if (id === 'bald') return baldCoverage(x, y);
  if (id === 'crescent') return crescentCoverage(x, y);
  return 0;
}

function paint(id, bay, width, height) {
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (bay[i + 3] < 40) continue;
      let cov = coverage(id, x, y);
      if (cov <= 0.02) continue;
      cov *= eyeHole(x, y, id === 'bald' ? 1.15 : 1);
      if (cov <= 0.04) continue;

      const L = 0.2126 * bay[i] + 0.7152 * bay[i + 1] + 0.0722 * bay[i + 2];
      const lit = clamp((L - 28) / 130, 0, 1);
      const hair = (fbm(x * 0.08, y * 0.14) - 0.5) * 0.08;
      const form = clamp(0.58 + lit * 0.55 + hair, 0.46, 1.18);
      const spec = smoothstep(150, 210, L);
      let r = 236 * form + 18 * spec;
      let g = 230 * form + 16 * spec;
      let b = 222 * form + 12 * spec;
      const pink =
        id === 'bald'
          ? smoothstep(292, 345, y) * 0.7
          : id === 'blaze' ||
              id === 'thin-blaze' ||
              id === 'stripe' ||
              id === 'snip' ||
              id === 'star-snip'
            ? smoothstep(286, 322, y) * 0.55
            : 0;
      if (pink > 0) {
        r = r * (1 - pink * 0.55) + 214 * pink;
        g = g * (1 - pink * 0.7) + 156 * pink;
        b = b * (1 - pink * 0.7) + 148 * pink;
      }
      const alpha = smoothstep(0.04, 0.62, cov);
      out[i] = Math.round(clamp(r, 0, 255));
      out[i + 1] = Math.round(clamp(g, 0, 255));
      out[i + 2] = Math.round(clamp(b, 0, 255));
      out[i + 3] = Math.round(clamp(alpha, 0, 1) * 255);
    }
  }
  const blurred = blurEdge(blurEdge(out, width, height), width, height);
  if (id === 'bald') clipToCoat(blurred, bay, width, height);
  return blurred;
}

function clipToCoat(overlay, bay, width, height) {
  const keep = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let solid = true;
      for (let dy = -1; dy <= 1 && solid; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const coat = bay[((y + dy) * width + (x + dx)) * 4 + 3];
          if (coat < 245) {
            solid = false;
            break;
          }
        }
      }
      if (solid) keep[y * width + x] = 1;
    }
  }
  for (let i = 0; i < width * height; i++) {
    if (keep[i] === 0) overlay[i * 4 + 3] = 0;
  }
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
RIGHT = buildRight(data, info.width);
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
      .extract({ left: 600, top: 50, width: 220, height: 300 })
      .resize(440, 600, { kernel: 'nearest' })
      .png()
      .toFile(path.join(ROOT, dir, '_preview', `${id}-on-bay.png`));
  }
  let area = 0;
  for (let p = 0; p < info.width * info.height; p++) {
    if (overlay[p * 4 + 3] > 40) area++;
  }
  console.log(id, 'area', area);
}
