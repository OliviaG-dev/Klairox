/**
 * Tobiano overlay for the Paint Horse silhouette.
 *
 * White is taken from the reference cutout (neck stripe, wide flank,
 * croup, near hind and near fore) and lit from the bay coat.
 *
 *   node tools/generate-paint-horse-tobiano.mjs
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BAY = 'plugins/horse/layers/coat-paint-horse/bay.png';
const REF = 'docs/images/horse-source/pie/paint-horse-tobiano-ref.jpg';
const OUTS = [
  'plugins/horse/layers/pie-paint-horse',
  'apps/editor/public/plugins/horse/layers/pie-paint-horse',
];

function clamp(v, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

function bbox(data, width, height, alphaCut) {
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lit = data[i] + data[i + 1] + data[i + 2] > 24;
      if (alphaCut) {
        if (data[i + 3] <= 200) continue;
      } else if (!lit) {
        continue;
      }
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY };
}

function isRefWhite(r, g, b) {
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  return L > 158 && chroma < 46;
}

function paint(bay, ref, width, height, dx, dy) {
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (bay[i + 3] < 200) continue;
      const rx = x - dx;
      const ry = y - dy;
      if (rx < 0 || ry < 0 || rx >= width || ry >= height) continue;
      const j = (ry * width + rx) * 4;
      if (!isRefWhite(ref[j], ref[j + 1], ref[j + 2])) continue;
      // Off-fore stays dark; the reference only catches a hoof highlight there.
      if (x > 630 && y > 650) continue;

      const L = 0.2126 * bay[i] + 0.7152 * bay[i + 1] + 0.0722 * bay[i + 2];
      const lit = clamp((L - 28) / 130);
      const form = clamp(0.58 + lit * 0.55, 0.46, 1.18);
      const spec = smoothstep(150, 210, L);
      out[i] = Math.round(clamp(236 * form + 18 * spec, 0, 255));
      out[i + 1] = Math.round(clamp(230 * form + 16 * spec, 0, 255));
      out[i + 2] = Math.round(clamp(222 * form + 12 * spec, 0, 255));
      out[i + 3] = 255;
    }
  }
  const filled = extendBottomToLeg(
    liftLeftPatchBottom(
      widenLeftPatch(closeHoles(out, width, height), bay, width, height),
      width,
      height,
    ),
    bay,
    width,
    height,
  );
  const shaped = stopAboveStockings(
    roughenLeftTop(filled, bay, width, height),
    bay,
    width,
    height,
  );
  return paintWhiteMane(
    insetFromLeftEdge(
      clipInsideCoat(
        softenEdges(shaped, bay, width, height),
        bay,
        width,
        height,
      ),
      bay,
      width,
      height,
    ),
    bay,
    width,
    height,
  );
}

/** Fine white hairs leaving the neck patch into the mane. The patch itself stays. */
function paintWhiteMane(src, bay, width, height) {
  const out = Buffer.from(src);
  const isMane = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const i = (y * width + x) * 4;
    if (bay[i + 3] < 230) return false;
    const L = 0.2126 * bay[i] + 0.7152 * bay[i + 1] + 0.0722 * bay[i + 2];
    return L < 60;
  };
  for (let y = 80; y < 380; y += 2) {
    let edge = -1;
    for (let x = 520; x < 760; x++) {
      const white = out[(y * width + x) * 4 + 3] > 140;
      if (white && isMane(x + 2, y)) {
        edge = x;
      }
    }
    if (edge < 0) continue;
    const len = 8 + (y % 5) * 3;
    let x = edge;
    let yy = y;
    for (let t = 0; t < len; t++) {
      x += 0.35 + Math.sin(yy * 0.4) * 0.15;
      yy += 0.85;
      const ix = Math.round(x);
      const iy = Math.round(yy);
      if (!isMane(ix, iy)) break;
      const i = (iy * width + ix) * 4;
      const alpha = Math.round(200 * (1 - t / len));
      if (out[i + 3] >= alpha) continue;
      out[i] = 236;
      out[i + 1] = 232;
      out[i + 2] = 226;
      out[i + 3] = alpha;
    }
  }
  return out;
}

/** The neck stripe climbs beside the mane and tapers toward the poll. */
function raiseNeckStripe(src, bay, width, height) {
  const out = Buffer.from(src);
  const y0 = 136;
  const y1 = 188;
  for (let y = y0; y < y1; y++) {
    let x0 = -1;
    for (let x = 560; x < 760; x++) {
      if (bay[(y * width + x) * 4 + 3] > 200) {
        x0 = x;
        break;
      }
    }
    if (x0 < 0) continue;
    const t = (y - y0) / (y1 - y0);
    const band = Math.round(4 + t * 14);
    const wave = Math.round(Math.sin(y * 0.18) * 2);
    const left = x0 + 6 + wave;
    for (let x = left; x < left + band; x++) {
      const i = (y * width + x) * 4;
      if (bay[i + 3] < 200) continue;
      const L = 0.2126 * bay[i] + 0.7152 * bay[i + 1] + 0.0722 * bay[i + 2];
      const lit = clamp((L - 28) / 130);
      const form = clamp(0.58 + lit * 0.55, 0.46, 1.18);
      const spec = smoothstep(150, 210, L);
      out[i] = Math.round(clamp(236 * form + 18 * spec, 0, 255));
      out[i + 1] = Math.round(clamp(230 * form + 16 * spec, 0, 255));
      out[i + 2] = Math.round(clamp(222 * form + 12 * spec, 0, 255));
      out[i + 3] = 255;
    }
  }
  return out;
}

/** Soften the white where it meets the black mane, along the hair. */
function featherManeSide(src, bay, width, height) {
  const out = Buffer.from(src);
  for (let y = 120; y < 430; y++) {
    const sway = Math.round(Math.sin(y * 0.08) * 2);
    for (let x = 540; x < 740; x++) {
      const i = (y * width + x) * 4;
      if (bay[i + 3] < 245) continue;
      const here = src[i + 3] > 150;
      let dist = 9;
      for (let dx = 1; dx <= 8; dx++) {
        const nx = x + dx;
        if (nx >= width) break;
        const other = src[(y * width + nx) * 4 + 3] > 150;
        if (other !== here) {
          dist = dx;
          break;
        }
      }
      if (here) {
        const fade = smoothstep(1, 7, dist + sway * 0.15);
        if (fade < 1) out[i + 3] = Math.round(90 + fade * 165);
        continue;
      }
      if (dist > 5) continue;
      const lx = x - dist;
      const j = (y * width + lx) * 4;
      if (src[j + 3] < 150) continue;
      const a = 1 - dist / 6;
      out[i] = src[j];
      out[i + 1] = src[j + 1];
      out[i + 2] = src[j + 2];
      out[i + 3] = Math.round(a * 170);
    }
  }
  return out;
}

function insetFromLeftEdge(src, bay, width, height) {
  const MARGIN = 12;
  const out = Buffer.from(src);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (out[i + 3] === 0) continue;
      let exposed = false;
      for (let dx = 1; dx <= MARGIN; dx++) {
        const nx = x - dx;
        if (nx < 0 || bay[(y * width + nx) * 4 + 3] < 250) {
          exposed = true;
          break;
        }
      }
      if (exposed) out[i + 3] = 0;
    }
  }
  return out;
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

/** Break the straight top of the left patch into a short irregular hairline. */
function roughenLeftTop(src, bay, width, height) {
  const out = Buffer.from(src);
  for (let x = 210; x < 360; x++) {
    let top = -1;
    for (let y = 260; y < 520; y++) {
      if (out[(y * width + x) * 4 + 3] > 180) {
        top = y;
        break;
      }
    }
    if (top < 0) continue;
    const shift = Math.round(Math.sin(x * 0.045) * 6);
    if (shift > 0) {
      for (let y = top; y < top + shift && y < height; y++) {
        out[(y * width + x) * 4 + 3] = 0;
      }
      continue;
    }
    for (let y = top + shift; y < top; y++) {
      if (y < 0) continue;
      const i = (y * width + x) * 4;
      if (bay[i + 3] < 200) continue;
      const L = 0.2126 * bay[i] + 0.7152 * bay[i + 1] + 0.0722 * bay[i + 2];
      const lit = clamp((L - 28) / 130);
      const form = clamp(0.58 + lit * 0.55, 0.46, 1.18);
      const spec = smoothstep(150, 210, L);
      out[i] = Math.round(clamp(236 * form + 18 * spec, 0, 255));
      out[i + 1] = Math.round(clamp(230 * form + 16 * spec, 0, 255));
      out[i + 2] = Math.round(clamp(222 * form + 12 * spec, 0, 255));
      out[i + 3] = 255;
    }
  }
  return out;
}
function liftLeftPatchBottom(src, width, height) {
  const out = Buffer.from(src);
  for (let x = 190; x < 300; x++) {
    const u = clamp((x - 210) / 70);
    const arch = Math.sin(Math.pow(u, 0.65) * Math.PI);
    const cut = Math.round(500 + arch * 150);
    for (let y = Math.max(0, cut); y < height; y++) {
      out[(y * width + x) * 4 + 3] = 0;
    }
  }
  return out;
}

/** Lower part of the left patch reaches both edges of the hind leg. */
function extendBottomToLeg(src, bay, width, height) {
  const out = Buffer.from(src);
  for (let y = 560; y < 680; y++) {
    let has = false;
    for (let x = 150; x < 290; x++) {
      if (out[(y * width + x) * 4 + 3] > 80) {
        has = true;
        break;
      }
    }
    if (!has) continue;
    let x0 = -1;
    let x1 = -1;
    for (let x = 140; x < 320; x++) {
      if (bay[(y * width + x) * 4 + 3] > 200) {
        if (x0 < 0) x0 = x;
        x1 = x;
      } else if (x0 >= 0 && x > x0 + 10) {
        break;
      }
    }
    if (x0 < 0) continue;
    for (let x = x0; x <= x1; x++) {
      const i = (y * width + x) * 4;
      if (out[i + 3] > 180) continue;
      const L = 0.2126 * bay[i] + 0.7152 * bay[i + 1] + 0.0722 * bay[i + 2];
      const lit = clamp((L - 28) / 130);
      const form = clamp(0.58 + lit * 0.55, 0.46, 1.18);
      const spec = smoothstep(150, 210, L);
      out[i] = Math.round(clamp(236 * form + 18 * spec, 0, 255));
      out[i + 1] = Math.round(clamp(230 * form + 16 * spec, 0, 255));
      out[i + 2] = Math.round(clamp(222 * form + 12 * spec, 0, 255));
      out[i + 3] = 255;
    }
  }
  return out;
}
function widenLeftPatch(src, bay, width, height) {
  const out = Buffer.from(src);
  for (let y = 360; y < 650; y++) {
    let x0 = -1;
    let x1 = -1;
    for (let x = 180; x < 330; x++) {
      if (out[(y * width + x) * 4 + 3] > 180) {
        if (x0 < 0) x0 = x;
        x1 = x;
      }
    }
    if (x0 < 0) continue;
    const left = Math.max(180, x0 - 8);
    const right = Math.min(300, x1 + 8);
    for (let x = left; x <= right; x++) {
      if (x < 0 || x >= width) continue;
      const i = (y * width + x) * 4;
      if (out[i + 3] > 180) continue;
      if (bay[i + 3] < 200) continue;
      const L = 0.2126 * bay[i] + 0.7152 * bay[i + 1] + 0.0722 * bay[i + 2];
      const lit = clamp((L - 28) / 130);
      const form = clamp(0.58 + lit * 0.55, 0.46, 1.18);
      const spec = smoothstep(150, 210, L);
      out[i] = Math.round(clamp(236 * form + 18 * spec, 0, 255));
      out[i + 1] = Math.round(clamp(230 * form + 16 * spec, 0, 255));
      out[i + 2] = Math.round(clamp(222 * form + 12 * spec, 0, 255));
      out[i + 3] = 255;
    }
  }
  return out;
}

/** Drop white that sits outside the solid coat, including the soft left fringe. */
function clipInsideCoat(src, bay, width, height) {
  const solid = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let ok = true;
      for (let dy = -1; dy <= 1 && ok; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (bay[((y + dy) * width + (x + dx)) * 4 + 3] < 250) {
            ok = false;
            break;
          }
        }
      }
      if (ok) solid[y * width + x] = 1;
    }
  }
  const out = Buffer.from(src);
  for (let p = 0; p < solid.length; p++) {
    if (!solid[p]) out[p * 4 + 3] = 0;
  }
  return out;
}
function softenEdges(src, bay, width, height) {
  const out = Buffer.from(src);
  const radius = 3;
  for (let y = radius; y < height - radius; y++) {
    for (let x = radius; x < width - radius; x++) {
      const i = (y * width + x) * 4;
      let solid = 0;
      let total = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      let nw = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const j = ((y + dy) * width + (x + dx)) * 4;
          total++;
          if (src[j + 3] > 200) {
            solid++;
            r += src[j];
            g += src[j + 1];
            b += src[j + 2];
            nw++;
          }
        }
      }
      const cover = solid / total;
      if (cover > 0.92) {
        out[i + 3] = 255;
        continue;
      }
      if (cover < 0.08) {
        out[i + 3] = 0;
        continue;
      }
      if (bay[i + 3] < 220) {
        out[i + 3] = src[i + 3] > 200 ? 255 : 0;
        continue;
      }
      const alpha = smoothstep(0.28, 0.78, cover);
      if (alpha < 0.05 || nw === 0) {
        out[i + 3] = 0;
        continue;
      }
      out[i] = Math.round(r / nw);
      out[i + 1] = Math.round(g / nw);
      out[i + 2] = Math.round(b / nw);
      out[i + 3] = Math.round(alpha * 255);
    }
  }
  return out;
}

/** Pie white ends a few pixels above the coat's own stockings. */
function stopAboveStockings(src, bay, width, height) {
  const GAP = 18;
  const top = new Int16Array(width);
  top.fill(-1);
  for (let x = 0; x < width; x++) {
    for (let y = 660; y < height; y++) {
      const i = (y * width + x) * 4;
      if (bay[i + 3] < 200) continue;
      const r = bay[i];
      const g = bay[i + 1];
      const b = bay[i + 2];
      const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      if (L > 175 && chroma < 52) {
        top[x] = y;
        break;
      }
    }
  }
  for (let pass = 0; pass < 24; pass++) {
    const next = new Int16Array(top);
    for (let x = 1; x < width - 1; x++) {
      if (top[x] >= 0) continue;
      let coat = 0;
      for (let y = 700; y < 940; y += 4) {
        if (bay[(y * width + x) * 4 + 3] > 200) coat++;
      }
      if (coat < 6) continue;
      const left = top[x - 1];
      const right = top[x + 1];
      if (left >= 0 && right >= 0 && Math.abs(left - right) < 80) {
        next[x] = Math.round((left + right) / 2);
      } else if (left >= 0) {
        next[x] = left;
      } else if (right >= 0) {
        next[x] = right;
      }
    }
    top.set(next);
  }
  const out = Buffer.from(src);
  for (let y = 660; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (out[i + 3] === 0) continue;
      let earliest = -1;
      for (let dx = -16; dx <= 16; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= width || top[nx] < 0) continue;
        if (earliest < 0 || top[nx] < earliest) earliest = top[nx];
      }
      if (earliest >= 0 && y >= earliest - GAP) out[i + 3] = 0;
    }
  }
  return out;
}

/** Fill small transparent gaps inside a white plate so the checkerboard cannot show. */
function closeHoles(src, width, height) {
  const mask = new Uint8Array(width * height);
  for (let p = 0; p < mask.length; p++) {
    if (src[p * 4 + 3] > 160) mask[p] = 1;
  }
  const MAX_GAP = 8;
  for (let y = 0; y < height; y++) {
    let runEnd = -1;
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (mask[p]) {
        if (runEnd >= 0 && x - runEnd - 1 > 0 && x - runEnd - 1 <= MAX_GAP) {
          for (let gx = runEnd + 1; gx < x; gx++) mask[y * width + gx] = 1;
        }
        runEnd = x;
      }
    }
  }
  for (let x = 0; x < width; x++) {
    let runEnd = -1;
    for (let y = 0; y < height; y++) {
      const p = y * width + x;
      if (mask[p]) {
        if (runEnd >= 0 && y - runEnd - 1 > 0 && y - runEnd - 1 <= MAX_GAP) {
          for (let gy = runEnd + 1; gy < y; gy++) mask[gy * width + x] = 1;
        }
        runEnd = y;
      }
    }
  }
  for (let pass = 0; pass < 3; pass++) {
    const next = new Uint8Array(mask);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const p = y * width + x;
        if (mask[p]) continue;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (mask[(y + dy) * width + (x + dx)]) n++;
          }
        }
        if (n >= 5) next[p] = 1;
      }
    }
    mask.set(next);
  }
  const out = Buffer.from(src);
  for (let p = 0; p < mask.length; p++) {
    const i = p * 4;
    if (!mask[p]) {
      out[i + 3] = 0;
      continue;
    }
    if (src[i + 3] > 160) {
      out[i + 3] = 255;
      continue;
    }
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    const x = p % width;
    const y = (p / width) | 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = (ny * width + nx) * 4;
        if (src[j + 3] < 160) continue;
        r += src[j];
        g += src[j + 1];
        b += src[j + 2];
        n++;
      }
    }
    if (n === 0) continue;
    out[i] = Math.round(r / n);
    out[i + 1] = Math.round(g / n);
    out[i + 2] = Math.round(b / n);
    out[i + 3] = 255;
  }
  return out;
}

const bayImg = await sharp(path.join(ROOT, BAY))
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const refImg = await sharp(path.join(ROOT, REF))
  .ensureAlpha()
  .resize(bayImg.info.width, bayImg.info.height, { fit: 'fill' })
  .raw()
  .toBuffer({ resolveWithObject: true });

const bayBox = bbox(bayImg.data, bayImg.info.width, bayImg.info.height, true);
const refBox = bbox(refImg.data, refImg.info.width, refImg.info.height, false);
const dx = bayBox.minX - refBox.minX;
const dy = bayBox.minY - refBox.minY;
const overlay = paint(
  bayImg.data,
  refImg.data,
  bayImg.info.width,
  bayImg.info.height,
  dx,
  dy,
);

for (const dir of OUTS) {
  await mkdir(path.join(ROOT, dir), { recursive: true });
  await sharp(overlay, {
    raw: {
      width: bayImg.info.width,
      height: bayImg.info.height,
      channels: 4,
    },
  })
    .png({ compressionLevel: 9 })
    .toFile(path.join(ROOT, dir, 'tobiano.png'));
}

const preview = Buffer.from(bayImg.data);
for (let p = 0; p < preview.length; p += 4) {
  const a = overlay[p + 3] / 255;
  if (a <= 0) continue;
  for (let c = 0; c < 3; c++) {
    preview[p + c] = Math.round(preview[p + c] * (1 - a) + overlay[p + c] * a);
  }
}
const previewPath = path.join(
  ROOT,
  'plugins/horse/layers/pie-paint-horse/_preview.png',
);
await sharp(preview, {
  raw: {
    width: bayImg.info.width,
    height: bayImg.info.height,
    channels: 4,
  },
})
  .resize(512, 512)
  .png()
  .toFile(previewPath);

let area = 0;
for (let p = 3; p < overlay.length; p += 4) {
  if (overlay[p] > 40) area++;
}
console.log('tobiano area', area, 'shift', dx, dy);
