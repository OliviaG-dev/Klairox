/**
 * Cut the Lusitano roan source (green screen) back to the bay silhouette.
 *
 *   node tools/regenerate-lusitano-roan.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'docs/images/horse-source/Lusitano/coats/roan.jpg');
const BAY = path.join(ROOT, 'plugins/horse/layers/coat-lusitano/bay.png');
const OUTS = [
  path.join(ROOT, 'plugins/horse/layers/coat-lusitano/roan.png'),
  path.join(ROOT, 'apps/editor/public/plugins/horse/layers/coat-lusitano/roan.png'),
];

const { data: bay, info } = await sharp(BAY).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: w, height: h } = info;

const src = await sharp(SRC).resize(w, h).ensureAlpha().raw().toBuffer();
const out = Buffer.alloc(w * h * 4);

for (let i = 0; i < out.length; i += 4) {
  let r = src[i];
  let g = src[i + 1];
  let b = src[i + 2];
  const a = bay[i + 3];
  if (a < 8) {
    continue;
  }
  const spill = Math.max(0, g - Math.max(r, b));
  if (spill > 0) {
    g = Math.max(0, g - spill);
    r = Math.min(255, r + spill * 0.08);
    b = Math.min(255, b + spill * 0.04);
  }
  out[i] = Math.round(r);
  out[i + 1] = Math.round(g);
  out[i + 2] = Math.round(b);
  out[i + 3] = a;
}

for (const file of OUTS) {
  await sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toFile(file);
  console.log('wrote', path.relative(ROOT, file));
}
