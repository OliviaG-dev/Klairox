/**
 * Rebuild Standard cream so internal anatomy matches bay (shared morph).
 * Bay RGB is the form; cream is only the colour reference (body, flaxen,
 * pink muzzle, glass eye). Does not touch Stalloria output.
 *
 *   node tools/cream-from-bay-morph.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const JOBS = [
  {
    label: 'standard',
    bay: 'plugins/horse/layers/coat/bay.png',
    cream: 'docs/images/horse-source/coat-cream-photoreal-src.opaque.png',
    out: 'docs/images/horse-source/coat-cream-photoreal-src.png',
    plugin: 'plugins/horse/layers/coat/cream.png',
    eye: [261, 174],
    creamEye: [273, 172],
  },
  {
    label: 'foal',
    bay: 'plugins/horse/layers/coat-foal/bay.png',
    cream: 'docs/images/horse-source/foal/coat-cream-photoreal-src.opaque.png',
    out: 'docs/images/horse-source/foal/coat-cream-photoreal-src.png',
    plugin: 'plugins/horse/layers/coat-foal/cream.png',
    eye: [263, 203],
    creamEye: [263, 203],
  },
];

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function clampByte(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function gauss(x, y, cx, cy, rx, ry) {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return Math.exp(-(dx * dx + dy * dy));
}

async function load(rel) {
  const { data, info } = await sharp(path.join(ROOT, rel))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function sampleMean(data, width, height, pred) {
  let n = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  let L = 0;
  let lmin = 255;
  let lmax = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 180) continue;
      if (!pred(x, y, data[i], data[i + 1], data[i + 2])) continue;
      const lv = luma(data[i], data[i + 1], data[i + 2]);
      n++;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      L += lv;
      if (lv < lmin) lmin = lv;
      if (lv > lmax) lmax = lv;
    }
  }
  if (n === 0) {
    return { r: 220, g: 200, b: 180, L: 205, lmin: 140, lmax: 245, n: 0 };
  }
  return {
    r: r / n,
    g: g / n,
    b: b / n,
    L: L / n,
    lmin,
    lmax,
    n,
  };
}

function applyPal(bayL, bayPal, creamPal, lift = 0) {
  const span = Math.max(10, bayPal.lmax - bayPal.lmin);
  const t = Math.min(1, Math.max(0, (bayL - bayPal.lmin) / span));
  const mapped =
    creamPal.lmin + t * Math.max(12, creamPal.lmax - creamPal.lmin);
  const targetL = mapped * (1 - lift) + creamPal.L * lift;
  const s = creamPal.L > 1 ? targetL / creamPal.L : 1;
  return [creamPal.r * s, creamPal.g * s, creamPal.b * s];
}

function mix3(a, b, t) {
  return [
    a[0] * (1 - t) + b[0] * t,
    a[1] * (1 - t) + b[1] * t,
    a[2] * (1 - t) + b[2] * t,
  ];
}

function stampEye(out, width, height, cream, job) {
  const [dx, dy] = job.eye;
  const [sx0, sy0] = job.creamEye;
  const rx = 8.5;
  const ry = 6.2;
  const pad = 14;
  const x0 = Math.max(0, Math.floor(dx - pad));
  const x1 = Math.min(width - 1, Math.ceil(dx + pad));
  const y0 = Math.max(0, Math.floor(dy - pad));
  const y1 = Math.min(height - 1, Math.ceil(dy + pad));
  const cw = cream.width;
  const ch = cream.height;

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const ox = x - dx;
      const oy = y - dy;
      const d = Math.hypot(ox / rx, oy / ry);
      if (d > 1.25) continue;
      const t = Math.max(0, 1 - (d - 0.72) / 0.53);
      if (t < 0.02) continue;
      const sx = sx0 + ox;
      const sy = sy0 + oy;
      if (sx < 0 || sy < 0 || sx >= cw - 1 || sy >= ch - 1) continue;
      const x0s = Math.floor(sx);
      const y0s = Math.floor(sy);
      const tx = sx - x0s;
      const ty = sy - y0s;
      const sample = (ix, iy) => {
        const i = (iy * cw + ix) * 4;
        return [cream.data[i], cream.data[i + 1], cream.data[i + 2]];
      };
      const a00 = sample(x0s, y0s);
      const a10 = sample(Math.min(cw - 1, x0s + 1), y0s);
      const a01 = sample(x0s, Math.min(ch - 1, y0s + 1));
      const a11 = sample(Math.min(cw - 1, x0s + 1), Math.min(ch - 1, y0s + 1));
      const top = mix3(a00, a10, tx);
      const bot = mix3(a01, a11, tx);
      const rgb = mix3(top, bot, ty);
      const i = (y * width + x) * 4;
      out[i] = clampByte(out[i] * (1 - t) + rgb[0] * t);
      out[i + 1] = clampByte(out[i + 1] * (1 - t) + rgb[1] * t);
      out[i + 2] = clampByte(out[i + 2] * (1 - t) + rgb[2] * t);
    }
  }
}

async function rebuild(job) {
  const bay = await load(job.bay);
  const cream = await load(job.cream);
  const { width, height } = bay;

  const bodyPal = sampleMean(
    cream.data,
    cream.width,
    cream.height,
    (x, y, r, g, b) => {
      const L = luma(r, g, b);
      return (
        y > height * 0.32 &&
        y < height * 0.62 &&
        x > width * 0.35 &&
        x < width * 0.7 &&
        L > 140
      );
    },
  );
  const manePal = sampleMean(
    cream.data,
    cream.width,
    cream.height,
    (x, y, r, g, b) => {
      const L = luma(r, g, b);
      return (
        y < height * 0.42 && x > width * 0.28 && x < width * 0.55 && L > 150
      );
    },
  );
  const tailPal = sampleMean(
    cream.data,
    cream.width,
    cream.height,
    (x, y, r, g, b) => {
      const L = luma(r, g, b);
      return (
        x > width * 0.72 && y > height * 0.28 && y < height * 0.72 && L > 140
      );
    },
  );
  const legPal = sampleMean(
    cream.data,
    cream.width,
    cream.height,
    (x, y, r, g, b) => {
      const L = luma(r, g, b);
      return y > height * 0.68 && L > 100;
    },
  );
  const muzzlePal = sampleMean(
    cream.data,
    cream.width,
    cream.height,
    (x, y, r, g, b) => {
      return (
        x < width * 0.2 && y > height * 0.16 && y < height * 0.32 && r > g + 8
      );
    },
  );

  const bayBody = sampleMean(bay.data, width, height, (x, y, r, g, b) => {
    const L = luma(r, g, b);
    return (
      y > height * 0.32 &&
      y < height * 0.62 &&
      x > width * 0.35 &&
      x < width * 0.7 &&
      L > 45
    );
  });
  const bayMane = sampleMean(bay.data, width, height, (x, y, r, g, b) => {
    const L = luma(r, g, b);
    return y < height * 0.45 && x > width * 0.28 && x < width * 0.55 && L < 58;
  });
  const bayTail = sampleMean(bay.data, width, height, (x, y, r, g, b) => {
    const L = luma(r, g, b);
    return x > width * 0.72 && L < 65;
  });
  const bayLeg = sampleMean(bay.data, width, height, (x, y, r, g, b) => {
    const L = luma(r, g, b);
    return y > height * 0.68 && L < 80;
  });
  const bayMuzzle = sampleMean(bay.data, width, height, (x, y) => {
    return x < width * 0.2 && y > height * 0.16 && y < height * 0.32;
  });

  const out = Buffer.from(bay.data);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (bay.data[i + 3] < 8) continue;
      const r = bay.data[i];
      const g = bay.data[i + 1];
      const b = bay.data[i + 2];
      const L = luma(r, g, b);
      const ny = y / height;
      const nx = x / width;

      const dark = 1 - Math.min(1, L / 62);
      const mane = nx > 0.26 && nx < 0.56 && ny < 0.46 && nx > 0.3 ? dark : 0;
      const tail = nx > 0.74 && ny > 0.22 && ny < 0.72 ? dark : 0;
      const legs =
        ny > 0.67
          ? Math.min(1, (ny - 0.67) / 0.06) * (1 - Math.min(1, L / 95))
          : 0;
      const muzzle = gauss(
        x,
        y,
        width * 0.13,
        height * 0.225,
        width * 0.055,
        height * 0.055,
      );
      const [ex, ey] = job.eye;
      const eye = gauss(x, y, ex, ey, 11, 8);

      let wMane = mane;
      let wTail = tail;
      let wLegs = legs;
      let wMuz = muzzle;
      let wEye = eye * 0.35;
      const parts = wMane + wTail + wLegs + wMuz + wEye;
      if (parts > 1) {
        wMane /= parts;
        wTail /= parts;
        wLegs /= parts;
        wMuz /= parts;
        wEye /= parts;
      }
      const wBody = Math.max(0, 1 - wMane - wTail - wLegs - wMuz - wEye);

      const bodyC = applyPal(L, bayBody, bodyPal, 0.35);
      const maneC = applyPal(L, bayMane.n ? bayMane : bayBody, manePal, 0.72);
      const tailC = applyPal(
        L,
        bayTail.n ? bayTail : bayMane,
        tailPal.n ? tailPal : manePal,
        0.72,
      );
      const legC = applyPal(
        L,
        bayLeg.n ? bayLeg : bayBody,
        legPal.n ? legPal : bodyPal,
        0.45,
      );
      const muzC = applyPal(
        L,
        bayMuzzle.n ? bayMuzzle : bayBody,
        muzzlePal.n ? muzzlePal : bodyPal,
        0.25,
      );

      out[i] = clampByte(
        bodyC[0] * wBody +
          maneC[0] * wMane +
          tailC[0] * wTail +
          legC[0] * wLegs +
          muzC[0] * wMuz +
          r * wEye,
      );
      out[i + 1] = clampByte(
        bodyC[1] * wBody +
          maneC[1] * wMane +
          tailC[1] * wTail +
          legC[1] * wLegs +
          muzC[1] * wMuz +
          g * wEye,
      );
      out[i + 2] = clampByte(
        bodyC[2] * wBody +
          maneC[2] * wMane +
          tailC[2] * wTail +
          legC[2] * wLegs +
          muzC[2] * wMuz +
          b * wEye,
      );
      out[i + 3] = bay.data[i + 3];
    }
  }

  stampEye(out, width, height, cream, job);

  await sharp(out, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(ROOT, job.out));
  await sharp(out, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(ROOT, job.plugin));

  console.log(
    `${job.label}: cream rebuilt on bay morph (body n=${bodyPal.n}, mane n=${manePal.n})`,
  );
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

for (const job of JOBS) {
  await rebuild(job);
}
await syncEditor();
