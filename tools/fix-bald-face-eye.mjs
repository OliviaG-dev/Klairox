/**
 * Stamp the photoreal cream eye onto bald-face overlays.
 *
 * Foal bald uses the cream foal coat iris verbatim (position + size).
 * Run after `extract-face-marking.mjs --build Foal bald`.
 *
 * Usage:
 *   node tools/fix-bald-face-eye.mjs
 *   node tools/fix-bald-face-eye.mjs Standard-OC
 *   node tools/fix-bald-face-eye.mjs Foal
 */
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
    source: 'plugins/horse/layers/coat-foal/cream.png',
    srcCx: 260,
    srcCy: 205.9,
    cx: 130,
    cy: 103,
    rx: 7.8,
    ry: 5.2,
    tilt: -0.38,
    exactCopy: true,
    socketRx: 16,
    socketRy: 14,
  },
];

function clamp(v, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

function clampByte(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
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
    mix(
      mix(src[i00 + 1], src[i10 + 1], tx),
      mix(src[i01 + 1], src[i11 + 1], tx),
      ty,
    ),
    mix(
      mix(src[i00 + 2], src[i10 + 2], tx),
      mix(src[i01 + 2], src[i11 + 2], tx),
      ty,
    ),
    mix(
      mix(src[i00 + 3], src[i10 + 3], tx),
      mix(src[i01 + 3], src[i11 + 3], tx),
      ty,
    ),
  ];
}

function glassTint(r, g, b) {
  const L = luma(r, g, b);
  if (L < 42) {
    return [r, g, b];
  }
  return [r * 0.78, g * 0.92, Math.min(255, b * 1.18 + 18)];
}

function local(x, y, cx, cy, tilt) {
  const ox = x - cx;
  const oy = y - cy;
  if (tilt === 0) {
    return [ox, oy];
  }
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  return [ox * cos + oy * sin, -ox * sin + oy * cos];
}

/** Tobiano / marking clay white — speckles read on this, not on paper white. */
const MARKING_WHITE = [212, 207, 200];

function ellipsoidDist(dx, dy, rx, ry) {
  return Math.hypot(dx / rx, dy / ry);
}

/** Erase extract-face-marking lash specks before the cream iris stamp. */
function whitenEyeSocket(dest, destW, destH, eye) {
  const { cx, cy, rx, ry, tilt, socketRx = 16, socketRy = 14 } = eye;
  const pad = Math.ceil(Math.max(socketRx, socketRy) * 1.15) + 2;
  const x0 = Math.max(0, Math.floor(cx - pad));
  const x1 = Math.min(destW - 1, Math.ceil(cx + pad));
  const y0 = Math.max(0, Math.floor(cy - pad));
  const y1 = Math.min(destH - 1, Math.ceil(cy + pad));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const [dx, dy] = local(x, y, cx, cy, tilt);
      const dSocket = ellipsoidDist(dx, dy, socketRx, socketRy);
      if (dSocket > 1.04) {
        continue;
      }
      const dEye = ellipsoidDist(dx, dy, rx, ry);
      if (dEye <= 1.06) {
        continue;
      }
      const i = (y * destW + x) * 4;
      const fade = 1 - smoothstep(0.9, 1.04, dSocket);
      dest[i] = clampByte(MARKING_WHITE[0] * fade + dest[i] * (1 - fade));
      dest[i + 1] = clampByte(
        MARKING_WHITE[1] * fade + dest[i + 1] * (1 - fade),
      );
      dest[i + 2] = clampByte(
        MARKING_WHITE[2] * fade + dest[i + 2] * (1 - fade),
      );
      dest[i + 3] = Math.max(dest[i + 3], clampByte(255 * fade));
    }
  }
}

const FOAL_IRIS_BLUE = [98, 115, 162];

function blendFoalIrisBlue(r, g, b, w) {
  const t = clamp(w);
  return [
    clampByte(r * (1 - t) + FOAL_IRIS_BLUE[0] * t),
    clampByte(g * (1 - t) + FOAL_IRIS_BLUE[1] * t),
    clampByte(b * (1 - t) + FOAL_IRIS_BLUE[2] * t),
  ];
}

/** Lift dark lid pixels; push iris toward a vivid foal blue (bald face). */
function foalEyePixel(sr, sg, sb, d) {
  const L = luma(sr, sg, sb);
  if (L < 38) {
    return [sr, sg, sb];
  }
  const blue = sb - Math.max(sr, sg);
  let r = sr;
  let g = sg;
  let b = sb;
  if (L < 84 && d > 0.92 && blue < 8) {
    const t = clamp((84 - L) / 46) * smoothstep(0.92, 1.12, d);
    const soft = [92, 86, 82];
    r = sr * (1 - t) + soft[0] * t;
    g = sg * (1 - t) + soft[1] * t;
    b = sb * (1 - t) + soft[2] * t;
  }
  if (L >= 48 && L < 182) {
    const iris =
      smoothstep(0, 14, b - Math.max(r, g)) *
      smoothstep(48, 120, L) *
      (1 - smoothstep(148, 198, L));
    const core = (1 - smoothstep(0.1, 0.68, d)) * smoothstep(50, 115, L);
    const w = Math.min(0.55, iris * 0.85 + core * 0.4);
    if (w > 0.04) {
      [r, g, b] = blendFoalIrisBlue(r, g, b, w);
    }
  }
  return [r, g, b];
}

/**
 * Dark upper/lower lids + limbal ring so the iris reads on bald white.
 * Inspired by extract-face-marking punchEye dark lids (Foal build).
 */
function drawFoalEyeContour(dest, destW, destH, eye) {
  const { cx, cy, rx, ry, tilt } = eye;
  const LASH = [26, 22, 20];
  const LIMBAL = [42, 48, 72];
  const pad = Math.ceil(Math.max(rx, ry) * 1.45) + 2;
  const x0 = Math.max(0, Math.floor(cx - pad));
  const x1 = Math.min(destW - 1, Math.ceil(cx + pad));
  const y0 = Math.max(0, Math.floor(cy - pad));
  const y1 = Math.min(destH - 1, Math.ceil(cy + pad));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const [dx, dy] = local(x, y, cx, cy, tilt);
      const d = ellipsoidDist(dx, dy, rx, ry);
      if (d > 1.12) {
        continue;
      }
      const i = (y * destW + x) * 4;
      if (dest[i + 3] < 80) {
        continue;
      }
      const r = dest[i];
      const g = dest[i + 1];
      const b = dest[i + 2];
      const L = luma(r, g, b);
      if (L < 34 && d < 0.48) {
        continue;
      }

      const upper =
        (1 - smoothstep(-0.45, 0.75, dy)) *
        smoothstep(0.4, 0.66, d) *
        (1 - smoothstep(0.84, 1.02, d));
      const lower =
        smoothstep(0.18, 1.05, dy) *
        smoothstep(0.56, 0.8, d) *
        (1 - smoothstep(0.9, 1.06, d)) *
        0.62;
      const lash = Math.max(upper, lower) * (1 - smoothstep(145, 205, L));
      const limbal =
        smoothstep(0.58, 0.74, d) *
        (1 - smoothstep(0.9, 1.02, d)) *
        smoothstep(55, 130, L) *
        (1 - lash * 0.65);

      const wLash = lash * 0.88;
      const wLimbal = limbal * 0.72;
      if (wLash < 0.03 && wLimbal < 0.03) {
        continue;
      }

      let nr = r;
      let ng = g;
      let nb = b;
      if (wLash > 0.03) {
        nr = nr * (1 - wLash) + LASH[0] * wLash;
        ng = ng * (1 - wLash) + LASH[1] * wLash;
        nb = nb * (1 - wLash) + LASH[2] * wLash;
      }
      if (wLimbal > 0.03) {
        nr = nr * (1 - wLimbal) + LIMBAL[0] * wLimbal;
        ng = ng * (1 - wLimbal) + LIMBAL[1] * wLimbal;
        nb = nb * (1 - wLimbal) + LIMBAL[2] * wLimbal;
      }
      dest[i] = clampByte(nr);
      dest[i + 1] = clampByte(ng);
      dest[i + 2] = clampByte(nb);
    }
  }
}

/** Mop up any remaining dark neutral pixels in the socket halo. */
function cleanEyeHalo(dest, destW, destH, eye) {
  const { cx, cy, rx, ry, tilt, socketRx = 16, socketRy = 14 } = eye;
  const pad = Math.ceil(Math.max(socketRx, socketRy) * 1.15) + 2;
  const x0 = Math.max(0, Math.floor(cx - pad));
  const x1 = Math.min(destW - 1, Math.ceil(cx + pad));
  const y0 = Math.max(0, Math.floor(cy - pad));
  const y1 = Math.min(destH - 1, Math.ceil(cy + pad));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const [dx, dy] = local(x, y, cx, cy, tilt);
      const dSocket = ellipsoidDist(dx, dy, socketRx, socketRy);
      if (dSocket > 1.02) {
        continue;
      }
      const dEye = ellipsoidDist(dx, dy, rx, ry);
      const i = (y * destW + x) * 4;
      const r = dest[i];
      const g = dest[i + 1];
      const b = dest[i + 2];
      const L = luma(r, g, b);
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      const blue = b - Math.max(r, g);
      if (L < 38 && dEye < 0.55) {
        continue;
      }
      if (blue > 8 && L > 50 && L < 185 && dEye < 1.02) {
        continue;
      }
      if (L >= 78 || chroma >= 46) {
        continue;
      }
      const t =
        (1 - smoothstep(72, 82, L)) *
        smoothstep(0.55, 1.02, Math.max(dEye, dSocket * 0.72));
      if (t < 0.04) {
        continue;
      }
      dest[i] = clampByte(r * (1 - t) + MARKING_WHITE[0] * t);
      dest[i + 1] = clampByte(g * (1 - t) + MARKING_WHITE[1] * t);
      dest[i + 2] = clampByte(b * (1 - t) + MARKING_WHITE[2] * t);
    }
  }
}

function stampCreamEye(dest, destW, destH, src, srcW, srcH, eye) {
  const { cx, cy, rx, ry, tilt, srcCx, srcCy } = eye;
  const scaleX = srcW / destW;
  const scaleY = srcH / destH;
  const pad = Math.ceil(Math.max(rx, ry) * 1.35) + 2;
  const x0 = Math.max(0, Math.floor(cx - pad));
  const x1 = Math.min(destW - 1, Math.ceil(cx + pad));
  const y0 = Math.max(0, Math.floor(cy - pad));
  const y1 = Math.min(destH - 1, Math.ceil(cy + pad));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const [dx, dy] = local(x, y, cx, cy, tilt);
      const d = Math.hypot(dx / rx, dy / ry);
      if (d > 1.22) {
        continue;
      }
      const cover = 1 - smoothstep(0.78, 1.16, d);
      if (cover < 0.02) {
        continue;
      }
      const ox = x - cx;
      const oy = y - cy;
      const sx = srcCx + ox * scaleX;
      const sy = srcCy + oy * scaleY;
      if (sx < 0 || sy < 0 || sx >= srcW - 1 || sy >= srcH - 1) {
        continue;
      }
      const [sr, sg, sb, sa] = sampleBilinear(src, srcW, srcH, sx, sy);
      if (sa < 80) {
        continue;
      }
      const [tr, tg, tb] = eye.exactCopy
        ? foalEyePixel(sr, sg, sb, d)
        : glassTint(sr, sg, sb);
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

async function writePng(data, width, height, rel) {
  const destFile = path.join(ROOT, rel);
  await mkdir(path.dirname(destFile), { recursive: true });
  await sharp(Buffer.from(data), {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toFile(destFile);
}

async function fixTarget(target) {
  const dest = await loadRgba(target.plugin);
  const src = await loadRgba(target.source);
  if (target.socketRx) {
    whitenEyeSocket(dest.data, dest.info.width, dest.info.height, target);
  }
  stampCreamEye(
    dest.data,
    dest.info.width,
    dest.info.height,
    src.data,
    src.info.width,
    src.info.height,
    target,
  );
  if (target.socketRx) {
    cleanEyeHalo(dest.data, dest.info.width, dest.info.height, target);
    drawFoalEyeContour(dest.data, dest.info.width, dest.info.height, target);
  }
  await writePng(dest.data, dest.info.width, dest.info.height, target.plugin);
  for (const rel of [target.docs, target.editor].filter(Boolean)) {
    const destFile = path.join(ROOT, rel);
    await mkdir(path.dirname(destFile), { recursive: true });
    await copyFile(path.join(ROOT, target.plugin), destFile);
  }
  console.log(`stamped cream glass eye on ${target.label}`);
}

function syncEditor() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(ROOT, 'tools/sync-editor-horse-plugin.mjs')],
      { stdio: 'inherit' },
    );
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`sync-editor exited ${code}`));
    });
  });
}

const select = process.argv[2];
const jobs = TARGETS.filter(
  (target) => !select || target.label.toLowerCase() === select.toLowerCase(),
);
if (jobs.length === 0) {
  throw new Error(`No bald-eye target named "${select}"`);
}
for (const target of jobs) {
  await fixTarget(target);
}
await syncEditor();
