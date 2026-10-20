/**
 * Softens stair-stepped edges on Arabian coat cutouts.
 * The body stays crisp (about 1px). Mane and tail, which are thin strands,
 * get a wider partial alpha so they read as hair instead of pixels.
 *
 *   node tools/smooth-arabian-coat-edges.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'plugins/horse/layers/coat-arabian');
const PUBLIC_DIR = path.join(
  ROOT,
  'apps/editor/public/plugins/horse/layers/coat-arabian',
);

const BODY_SIGMA = 0.7;
const HAIR_SIGMA = 2.2;
const HAIR_MAX_THICKNESS = 3;
const SOLID_DIST = 4;

function kernel(sigma) {
  const radius = Math.ceil(sigma * 3);
  const weights = [];
  let sum = 0;
  for (let i = -radius; i <= radius; i += 1) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    weights.push(w);
    sum += w;
  }
  return { radius, weights: weights.map((w) => w / sum) };
}

function blurChannel(src, width, height, sigma) {
  const { radius, weights } = kernel(sigma);
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let acc = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const xx = Math.min(width - 1, Math.max(0, x + k));
        acc += src[y * width + xx] * weights[k + radius];
      }
      tmp[y * width + x] = acc;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let acc = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const yy = Math.min(height - 1, Math.max(0, y + k));
        acc += tmp[yy * width + x] * weights[k + radius];
      }
      out[y * width + x] = acc;
    }
  }
  return out;
}

function distanceToTransparent(coverage, width, height) {
  const dist = new Float32Array(coverage.length);
  const inf = width + height;
  for (let i = 0; i < coverage.length; i += 1) {
    dist[i] = coverage[i] > 0.5 ? inf : 0;
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + 1);
      if (y > 0) d = Math.min(d, dist[i - width] + 1);
      dist[i] = d;
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const i = y * width + x;
      let d = dist[i];
      if (x + 1 < width) d = Math.min(d, dist[i + 1] + 1);
      if (y + 1 < height) d = Math.min(d, dist[i + width] + 1);
      dist[i] = d;
    }
  }
  return dist;
}

function maxFilter(src, width, height, radius) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let m = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const xx = Math.min(width - 1, Math.max(0, x + k));
        m = Math.max(m, src[y * width + xx]);
      }
      tmp[y * width + x] = m;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let m = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const yy = Math.min(height - 1, Math.max(0, y + k));
        m = Math.max(m, tmp[yy * width + x]);
      }
      out[y * width + x] = m;
    }
  }
  return out;
}

function smoothCoat(png) {
  const { width, height, data } = png;
  const n = width * height;
  const coverage = new Float32Array(n);
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    const a = data[o + 3] / 255;
    coverage[i] = a;
    r[i] = data[o] * a;
    g[i] = data[o + 1] * a;
    b[i] = data[o + 2] * a;
  }

  const dist = distanceToTransparent(coverage, width, height);
  const localThickness = maxFilter(dist, width, height, 5);
  const body = blurChannel(coverage, width, height, BODY_SIGMA);
  const hair = blurChannel(coverage, width, height, HAIR_SIGMA);
  const br = blurChannel(r, width, height, HAIR_SIGMA);
  const bg = blurChannel(g, width, height, HAIR_SIGMA);
  const bb = blurChannel(b, width, height, HAIR_SIGMA);
  const er = blurChannel(r, width, height, BODY_SIGMA);
  const eg = blurChannel(g, width, height, BODY_SIGMA);
  const eb = blurChannel(b, width, height, BODY_SIGMA);

  const out = Buffer.from(data);
  for (let i = 0; i < n; i += 1) {
    const solid = dist[i] >= SOLID_DIST;
    const isHair =
      localThickness[i] > 0 && localThickness[i] <= HAIR_MAX_THICKNESS;
    let alpha;
    let pr;
    let pg;
    let pb;
    if (solid) {
      alpha = 1;
      pr = data[i * 4];
      pg = data[i * 4 + 1];
      pb = data[i * 4 + 2];
    } else if (isHair) {
      alpha = hair[i];
      const cov = Math.max(alpha, 1e-4);
      pr = br[i] / cov;
      pg = bg[i] / cov;
      pb = bb[i] / cov;
    } else {
      alpha = body[i];
      const cov = Math.max(alpha, 1e-4);
      pr = er[i] / cov;
      pg = eg[i] / cov;
      pb = eb[i] / cov;
    }
    if (alpha < 10 / 255) {
      out[i * 4] = 0;
      out[i * 4 + 1] = 0;
      out[i * 4 + 2] = 0;
      out[i * 4 + 3] = 0;
      continue;
    }
    out[i * 4] = Math.max(0, Math.min(255, Math.round(pr)));
    out[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(pg)));
    out[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(pb)));
    out[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(alpha * 255)));
  }
  return out;
}

const files = fs
  .readdirSync(SRC_DIR)
  .filter((name) => name.endsWith('.png'))
  .sort();

fs.mkdirSync(PUBLIC_DIR, { recursive: true });

for (const name of files) {
  const file = path.join(SRC_DIR, name);
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const png = {
    width: info.width,
    height: info.height,
    data: Buffer.from(data),
  };
  const smoothed = smoothCoat(png);
  const encoded = await sharp(smoothed, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
  fs.writeFileSync(file, encoded);
  fs.writeFileSync(path.join(PUBLIC_DIR, name), encoded);
  let partial = 0;
  for (let i = 3; i < smoothed.length; i += 4) {
    const a = smoothed[i];
    if (a > 0 && a < 255) partial += 1;
  }
  console.log(`${name}: partial alpha pixels ${partial}`);
}
