/**
 * Recolors the Arabian bay cutout into the other coats.
 * Lightness of the Arabian is kept so the shading stays.
 * Pass coat names to write only those files:
 *   node tools/generate-arabian-coats.mjs palomino cream black roan grey
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'plugins/horse/layers/coat-arabian/bay.png');
const REF_DIR = path.join(ROOT, 'plugins/horse/layers/coat-lusitano');
const OUT_DIR = path.join(ROOT, 'plugins/horse/layers/coat-arabian');
const PUBLIC_DIR = path.join(
  ROOT,
  'apps/editor/public/plugins/horse/layers/coat-arabian',
);
const ONLY = new Set(process.argv.slice(2));

function selected(name) {
  return ONLY.size === 0 || ONLY.has(name);
}

const XN = 0.95047;
const YN = 1;
const ZN = 1.08883;

function lin(c) {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

function rgbToLab(r, g, b) {
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const x = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
  const y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const z = R * 0.0193339 + G * 0.119192 + B * 0.9503041;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x / XN);
  const fy = f(y / YN);
  const fz = f(z / ZN);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labToRgb(L, a, b) {
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const fInv = (t) => {
    const c = t ** 3;
    return c > 0.008856 ? c : (t - 16 / 116) / 7.787;
  };
  const x = XN * fInv(fx);
  const y = YN * fInv(fy);
  const z = ZN * fInv(fz);
  let R = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
  let G = x * -0.969266 + y * 1.8760108 + z * 0.041556;
  let B = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;
  const comp = (c) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(v * 255)));
  };
  return [comp(R), comp(G), comp(B)];
}

function lum(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function isPoint(r, g, b) {
  return lum(r, g, b) < 32 && r < 55 && g < 50 && b < 50;
}

async function loadRaw(file) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function stats(data, mask) {
  let n = 0;
  let sL = 0;
  let sa = 0;
  let sb = 0;
  const labs = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    if (mask && !mask(data[i], data[i + 1], data[i + 2], i)) continue;
    const lab = rgbToLab(data[i], data[i + 1], data[i + 2]);
    labs.push(lab);
    sL += lab[0];
    sa += lab[1];
    sb += lab[2];
    n++;
  }
  const mL = sL / n;
  const ma = sa / n;
  const mb = sb / n;
  let vL = 0;
  let va = 0;
  let vb = 0;
  for (const [L, a, b] of labs) {
    vL += (L - mL) ** 2;
    va += (a - ma) ** 2;
    vb += (b - mb) ** 2;
  }
  return {
    n,
    mL,
    ma,
    mb,
    sL: Math.sqrt(vL / n) || 1,
    sa: Math.sqrt(va / n) || 1,
    sb: Math.sqrt(vb / n) || 1,
  };
}

function hash(i) {
  let n = (i + 1) * 374761393;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}

const bay = await loadRaw(SRC);
const body = (r, g, b) => !isPoint(r, g, b);
const srcBody = stats(bay.data, body);

async function writeCoat(name, paint) {
  if (!selected(name)) return;
  const out = Buffer.alloc(bay.data.length);
  for (let i = 0, p = 0; i < bay.data.length; i += 4, p++) {
    const a = bay.data[i + 3];
    out[i + 3] = a;
    if (a < 8) continue;
    const x = p % bay.width;
    const y = Math.floor(p / bay.width);
    const rgb = paint(bay.data[i], bay.data[i + 1], bay.data[i + 2], x, y, i);
    out[i] = rgb[0];
    out[i + 1] = rgb[1];
    out[i + 2] = rgb[2];
  }
  const file = `${name}.png`;
  await sharp(out, {
    raw: { width: bay.width, height: bay.height, channels: 4 },
  })
    .png()
    .toFile(path.join(OUT_DIR, file));
  fs.copyFileSync(path.join(OUT_DIR, file), path.join(PUBLIC_DIR, file));
  console.log('wrote', name);
}

function clampByte(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

await writeCoat('black', (r, g, b) => {
  const y = lum(r, g, b);
  const t = Math.min(1, y / 150);
  const base = 4 + Math.pow(t, 1.05) * 24;
  const spec = Math.pow(Math.min(1, Math.max(0, (y - 42) / 80)), 1.1);
  const tone = base + spec * 78;
  return [clampByte(tone), clampByte(tone * 0.98), clampByte(tone * 1.03)];
});

const refChestnut = await loadRaw(
  path.join(ROOT, 'plugins/horse/layers/coat-lusitano/chestnut.png'),
);
const refByLight = [];
for (let i = 0; i < refChestnut.data.length; i += 4) {
  if (refChestnut.data[i + 3] < 200) continue;
  refByLight.push([
    lum(refChestnut.data[i], refChestnut.data[i + 1], refChestnut.data[i + 2]),
    refChestnut.data[i],
    refChestnut.data[i + 1],
    refChestnut.data[i + 2],
  ]);
}
refByLight.sort((a, b) => a[0] - b[0]);

function uhash(x, y) {
  let n = Math.imul(x ^ Math.imul(y, 374761), 1274126177);
  n = Math.imul(n ^ (n >>> 16), 668265263);
  return ((n ^ (n >>> 15)) >>> 0) / 4294967295;
}

await writeCoat('chestnut', (r, g, b, x, y) => {
  const pix = lum(r, g, b);
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  const hoof = y > 910 && pix > 90 && chroma < 55;
  const inEye = x > 242 && x < 286 && y > 152 && y < 180;
  const eye = inEye && (pix < 45 || chroma < 20);
  if (hoof || eye) return [r, g, b];
  const t = Math.min(1, Math.max(0, (pix + 18) / 150));
  const target = 52 + Math.pow(t, 0.85) * 78;
  let lo = 0;
  let hi = refByLight.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (refByLight[mid][0] < target) lo = mid + 1;
    else hi = mid;
  }
  const jitter = Math.round((uhash(x >> 1, y >> 1) - 0.5) * 700);
  const sample =
    refByLight[Math.max(0, Math.min(refByLight.length - 1, lo + jitter))];
  return [
    clampByte(sample[1] + (r - pix) * 0.25),
    clampByte(sample[2] + (g - pix) * 0.15),
    clampByte(sample[3] + (b - pix) * 0.08),
  ];
});

await writeCoat('grey', (r, g, b) => {
  const y = lum(r, g, b);
  if (y < 30) {
    const tone = 46 + y * 0.45;
    return [clampByte(tone), clampByte(tone + 1), clampByte(tone + 3)];
  }
  const lifted = 158 + (y - 80) * 0.5;
  return [r, g, b].map((c) => clampByte(c * 0.1 + lifted * 0.9));
});

await writeCoat('roan', (r, g, b, x, y) => {
  if (isPoint(r, g, b)) return [r, g, b];
  const fine = uhash(x, y);
  const patch = uhash(x >> 2, y >> 2);
  if (fine > 0.82 && patch > 0.4) {
    const mix = 0.45 + (fine - 0.82) * 1.2;
    return [r, g, b].map((c) => clampByte(c * (1 - mix) + 236 * mix));
  }
  return [r, g, b];
});

function isFlaxenHair(x, y, r, g, b) {
  const pix = lum(r, g, b);
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  if (pix > 20 || chroma > 12 || y > 680) return false;
  return (x < 480 && y < 560) || (x > 800 && y < 680);
}

await writeCoat('palomino', (r, g, b, x, y) => {
  const pix = lum(r, g, b);
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  const hoof = y > 910 && pix > 90 && chroma < 55;
  if (hoof) return [214, 168, 112];
  if (isFlaxenHair(x, y, r, g, b)) {
    const tone = 186 + pix;
    return [clampByte(tone + 10), clampByte(tone - 8), clampByte(tone - 36)];
  }
  const t = Math.min(1, Math.pow(pix / 175, 0.92));
  return [
    clampByte(36 + t * 196),
    clampByte(18 + t * 148),
    clampByte(8 + t * 78),
  ];
});

await writeCoat('cream', (r, g, b, x, y) => {
  const pix = lum(r, g, b);
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  const hoof = y > 910 && pix > 80 && chroma < 70;
  if (hoof) return [228, 196, 160];
  const eye = x > 242 && x < 286 && y > 152 && y < 180 && pix < 40;
  if (eye) return [92, 108, 132];
  if (isFlaxenHair(x, y, r, g, b)) {
    const tone = 228 + pix * 0.4;
    return [clampByte(tone), clampByte(tone - 4), clampByte(tone - 14)];
  }
  const t = Math.min(1, Math.pow(pix / 170, 0.85));
  return [
    clampByte(176 + t * 70),
    clampByte(150 + t * 78),
    clampByte(118 + t * 80),
  ];
});

await writeCoat('isabelle', (r, g, b) => {
  if (isPoint(r, g, b)) return [r, g, b];
  return [
    clampByte(r * 0.78 + 48),
    clampByte(g * 0.7 + 28),
    clampByte(b * 0.32 + 4),
  ];
});

await writeCoat('bay-brun', (r, g, b, x, y) => {
  const pix = lum(r, g, b);
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  const hoof = y > 910 && pix > 90 && chroma < 55;
  if (hoof) return [r, g, b];
  if (pix < 26 && chroma < 16) return [r, g, b];
  const t = Math.min(1, pix / 175);
  const shade = t * t;
  return [
    clampByte(14 + shade * 96 + Math.max(0, r - pix) * 0.2),
    clampByte(8 + shade * 46),
    clampByte(6 + shade * 28),
  ];
});
