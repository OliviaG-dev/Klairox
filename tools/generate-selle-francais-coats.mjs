/**
 * Recolors the Selle Français bay cutout into the other coats.
 * Black points (mane, tail, legs) stay black except on chestnut, where the
 * legs become dark chestnut and the mane and tail stay black.
 *
 *   node tools/generate-selle-francais-coats.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'plugins/horse/layers/coat-selle-francais/bay.png');
const REF = path.join(ROOT, 'plugins/horse/layers/coat-lusitano/chestnut.png');
const OUT_DIR = path.join(ROOT, 'plugins/horse/layers/coat-selle-francais');
const PUBLIC_DIR = path.join(
  ROOT,
  'apps/editor/public/plugins/horse/layers/coat-selle-francais',
);

function lum(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function isPoint(r, g, b) {
  return lum(r, g, b) < 36 && r < 58 && g < 52 && b < 52;
}

function isManeOrTail(x, y) {
  return y < 560 || x > 760;
}

function clampByte(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function uhash(x, y) {
  let n = Math.imul(x ^ Math.imul(y, 374761), 1274126177);
  n = Math.imul(n ^ (n >>> 16), 668265263);
  return ((n ^ (n >>> 15)) >>> 0) / 4294967295;
}

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({
  resolveWithObject: true,
});
const width = info.width;
const height = info.height;

const refRaw = await sharp(REF).ensureAlpha().raw().toBuffer();
const refByLight = [];
for (let i = 0; i < refRaw.length; i += 4) {
  if (refRaw[i + 3] < 200) continue;
  refByLight.push([
    lum(refRaw[i], refRaw[i + 1], refRaw[i + 2]),
    refRaw[i],
    refRaw[i + 1],
    refRaw[i + 2],
  ]);
}
refByLight.sort((a, b) => a[0] - b[0]);

function chestnutSample(pix, r, g, b, x, y) {
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
}

const paints = {
  'bay-brun': (r, g, b, x, y) => {
    const pix = lum(r, g, b);
    if (isPoint(r, g, b)) return [r, g, b];
    if (y > 940 && pix > 90) return [r, g, b];
    const shade = Math.min(1, pix / 175) ** 2;
    return [
      clampByte(14 + shade * 96 + Math.max(0, r - pix) * 0.2),
      clampByte(8 + shade * 46),
      clampByte(6 + shade * 28),
    ];
  },
  chestnut: (r, g, b, x, y) => {
    const pix = lum(r, g, b);
    if (isPoint(r, g, b) && isManeOrTail(x, y)) return [r, g, b];
    if (y > 940 && pix > 80) return [120, 72, 42];
    if (isPoint(r, g, b)) {
      const tone = 42 + pix * 0.6;
      return [
        clampByte(tone + 18),
        clampByte(tone * 0.45),
        clampByte(tone * 0.22),
      ];
    }
    return chestnutSample(pix, r, g, b, x, y);
  },
  black: (r, g, b) => {
    const y = lum(r, g, b);
    const t = Math.min(1, y / 150);
    const base = 4 + Math.pow(t, 1.05) * 24;
    const spec = Math.pow(Math.min(1, Math.max(0, (y - 42) / 80)), 1.1);
    const tone = base + spec * 78;
    return [clampByte(tone), clampByte(tone * 0.98), clampByte(tone * 1.03)];
  },
  grey: (r, g, b) => {
    if (isPoint(r, g, b)) return [r, g, b];
    const y = lum(r, g, b);
    if (y < 30) {
      const tone = 46 + y * 0.45;
      return [clampByte(tone), clampByte(tone + 1), clampByte(tone + 3)];
    }
    const lifted = 158 + (y - 80) * 0.5;
    return [r, g, b].map((c) => clampByte(c * 0.1 + lifted * 0.9));
  },
  roan: (r, g, b, x, y) => {
    if (isPoint(r, g, b)) return [r, g, b];
    const fine = uhash(x, y);
    const patch = uhash(x >> 2, y >> 2);
    if (fine > 0.82 && patch > 0.4) {
      const mix = 0.45 + (fine - 0.82) * 1.2;
      return [r, g, b].map((c) => clampByte(c * (1 - mix) + 236 * mix));
    }
    return [r, g, b];
  },
};

for (const [name, paint] of Object.entries(paints)) {
  const out = Buffer.alloc(data.length);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const a = data[i + 3];
    out[i + 3] = a;
    if (a < 8) continue;
    const x = p % width;
    const y = Math.floor(p / width);
    const rgb = paint(data[i], data[i + 1], data[i + 2], x, y);
    out[i] = rgb[0];
    out[i + 1] = rgb[1];
    out[i + 2] = rgb[2];
  }
  const file = path.join(OUT_DIR, `${name}.png`);
  await sharp(out, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(file);
  fs.copyFileSync(file, path.join(PUBLIC_DIR, `${name}.png`));
  console.log('wrote', name);
}
