/**
 * Stamp the photoreal cream glass eye onto bald-face overlays.
 * Uses the cream coat's real socket (shape, pupil, specular), not a cartoon disc.
 *
 * Usage: node tools/fix-bald-face-eye.mjs
 */
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = process.cwd();

const TARGETS = [
  {
    label: 'Standard-OC',
    plugin: 'plugins/horse/layers/markings/Standard-OC/bald.png',
    docs: 'docs/images/horse-base/OC-Standard/markings/bald.png',
    editor:
      'apps/editor/public/plugins/horse/layers/markings/Standard-OC/bald.png',
    source: 'plugins/horse/layers/coat/cream.png',
    srcCx: 261,
    srcCy: 174,
    cx: 130.5,
    cy: 87,
    rx: 6.6,
    ry: 4.7,
    tilt: -0.16,
  },
  {
    label: 'Foal',
    plugin: 'plugins/horse/layers/markings/Foal/bald.png',
    docs: 'docs/images/horse-base/foal/markings/bald.png',
    editor: 'apps/editor/public/plugins/horse/layers/markings/Foal/bald.png',
    source: 'plugins/horse/layers/coat-foal/cream.png',
    srcCx: 263,
    srcCy: 203,
    cx: 131.5,
    cy: 101.5,
    rx: 5.8,
    ry: 4.1,
    tilt: -0.38,
  },
];

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

function sampleBilinear(src, width, height, fx, fy) {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const i00 = (y0 * width + x0) * 4;
  const i10 = (y0 * width + x1) * 4;
  const i01 = (y1 * width + x0) * 4;
  const i11 = (y1 * width + x1) * 4;
  const mix = (a, b, t) => a + (b - a) * t;
  return [
    mix(mix(src[i00], src[i10], tx), mix(src[i01], src[i11], tx), ty),
    mix(mix(src[i00 + 1], src[i10 + 1], tx), mix(src[i01 + 1], src[i11 + 1], tx), ty),
    mix(mix(src[i00 + 2], src[i10 + 2], tx), mix(src[i01 + 2], src[i11 + 2], tx), ty),
    mix(mix(src[i00 + 3], src[i10 + 3], tx), mix(src[i01 + 3], src[i11 + 3], tx), ty),
  ];
}

function glassTint(r, g, b) {
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (L < 42) {
    return [r, g, b];
  }
  return [
    r * 0.78,
    g * 0.92,
    Math.min(255, b * 1.18 + 18),
  ];
}

function stampCreamEye(dest, destW, destH, src, srcW, srcH, eye) {
  const { cx, cy, rx, ry, tilt, srcCx, srcCy } = eye;
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  const scaleX = srcW / destW;
  const scaleY = srcH / destH;
  const pad = Math.ceil(Math.max(rx, ry) * 1.35) + 2;
  const x0 = Math.max(0, Math.floor(cx - pad));
  const x1 = Math.min(destW - 1, Math.ceil(cx + pad));
  const y0 = Math.max(0, Math.floor(cy - pad));
  const y1 = Math.min(destH - 1, Math.ceil(cy + pad));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const ox = x - cx;
      const oy = y - cy;
      const dx = ox * cos + oy * sin;
      const dy = -ox * sin + oy * cos;
      const d = Math.hypot(dx / rx, dy / ry);
      if (d > 1.22) {
        continue;
      }
      const cover = 1 - smoothstep(0.78, 1.16, d);
      if (cover < 0.02) {
        continue;
      }

      const sx = srcCx + ox * scaleX;
      const sy = srcCy + oy * scaleY;
      if (sx < 0 || sy < 0 || sx >= srcW - 1 || sy >= srcH - 1) {
        continue;
      }
      const [sr, sg, sb, sa] = sampleBilinear(src, srcW, srcH, sx, sy);
      if (sa < 80) {
        continue;
      }
      const [tr, tg, tb] = glassTint(sr, sg, sb);
      const i = (y * destW + x) * 4;
      dest[i] = clampByte(dest[i] * (1 - cover) + tr * cover);
      dest[i + 1] = clampByte(dest[i + 1] * (1 - cover) + tg * cover);
      dest[i + 2] = clampByte(dest[i + 2] * (1 - cover) + tb * cover);
      dest[i + 3] = Math.max(dest[i + 3], clampByte(cover * 255));
    }
  }
}

async function loadRgba(rel) {
  const { data, info } = await sharp(path.join(ROOT, rel))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data), info };
}

async function fixTarget(target) {
  const pluginPath = path.join(ROOT, target.plugin);
  const dest = await loadRgba(target.plugin);
  const src = await loadRgba(target.source);
  stampCreamEye(
    dest.data,
    dest.info.width,
    dest.info.height,
    src.data,
    src.info.width,
    src.info.height,
    target,
  );
  const out = await sharp(Buffer.from(dest.data), {
    raw: {
      width: dest.info.width,
      height: dest.info.height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
  await sharp(out).toFile(pluginPath);
  for (const rel of [target.docs, target.editor]) {
    const destFile = path.join(ROOT, rel);
    await mkdir(path.dirname(destFile), { recursive: true });
    await copyFile(pluginPath, destFile);
  }
  console.log(`stamped cream glass eye on ${target.label}`);
}

for (const target of TARGETS) {
  await fixTarget(target);
}
