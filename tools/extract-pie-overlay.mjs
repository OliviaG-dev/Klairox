/**
 * Builds a pie overlay from a photoreal piebald horse: align to the
 * Standard-OC morph, keep the white patches, shade them from the palomino
 * coat (light, grain, flaxen mane), leave the base coat transparent.
 *
 * Usage:
 *   node tools/extract-pie-overlay.mjs <horse.png> <out.png> [--base layers/coat/bay.png]
 */
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 512;

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function chroma(r, g, b) {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function clamp(v, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

function clampByte(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function morphEdgeDist(morph, width, height, x, y, maxR = 3) {
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return r;
        if (morph[(ny * width + nx) * 4 + 3] < 16) return r;
      }
    }
  }
  return maxR + 1;
}

/** Drops studio-white halo on the silhouette; keeps interior pie patches. */
function defringeSilhouette(overlay, morph, width, height, edgePx = 2) {
  const out = Buffer.from(overlay);
  const lumaAt = (buf, i) =>
    0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (out[i + 3] < 8) continue;
      if (morph[i + 3] < 24) {
        out[i + 3] = 0;
        continue;
      }
      out[i + 3] = Math.min(out[i + 3], morph[i + 3]);
      const edge = morphEdgeDist(morph, width, height, x, y, edgePx + 1);
      if (edge <= edgePx) {
        out[i + 3] = clampByte(out[i + 3] * (edge / (edgePx + 1)));
      }
    }
  }

  // Second pass: 1px specks and hairline strokes
  const cleaned = Buffer.from(out);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (out[i + 3] < 180) continue;
      if (lumaAt(out, i) < 160) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const j = (ny * width + nx) * 4;
          if (out[j + 3] > 24) n++;
        }
      }
      if (n <= 2) {
        cleaned[i + 3] = 0;
      }
    }
  }
  return dropTinyBlobs(cleaned, width, height, 12);
}

function dropTinyBlobs(buf, width, height, minArea) {
  const seen = new Uint8Array(width * height);
  const out = Buffer.from(buf);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const start = y * width + x;
      if (seen[start] || buf[start * 4 + 3] < 8) continue;
      const stack = [start];
      const cells = [];
      seen[start] = 1;
      while (stack.length > 0) {
        const p = stack.pop();
        cells.push(p);
        const cx = p % width;
        const cy = (p / width) | 0;
        for (const [dx, dy] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const np = ny * width + nx;
          if (seen[np] || buf[np * 4 + 3] < 8) continue;
          seen[np] = 1;
          stack.push(np);
        }
      }
      if (cells.length < minArea) {
        for (const p of cells) {
          out[p * 4 + 3] = 0;
        }
      }
    }
  }
  return out;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function featherAlpha(buf, width, height, radius) {
  const alpha = new Float32Array(width * height);
  for (let p = 0; p < width * height; p++) {
    alpha[p] = buf[p * 4 + 3] / 255;
  }
  const soft = blurCoverage(alpha, width, height, radius);
  const out = Buffer.from(buf);
  for (let p = 0; p < width * height; p++) {
    out[p * 4 + 3] = clampByte(soft[p] * 255);
  }
  return out;
}

function blurCoverage(field, width, height, radius) {
  if (radius <= 0) return field;
  const tmp = new Float32Array(field.length);
  const out = new Float32Array(field.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      let n = 0;
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= width) continue;
        s += field[y * width + nx];
        n++;
      }
      tmp[y * width + x] = s / n;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        s += tmp[ny * width + x];
        n++;
      }
      out[y * width + x] = s / n;
    }
  }
  return out;
}

function dilateBinary(field, width, height, radius) {
  const out = new Float32Array(field.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let max = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const v = field[ny * width + nx];
          if (v > max) max = v;
        }
      }
      out[y * width + x] = max;
    }
  }
  return out;
}

function erodeBinary(field, width, height, radius) {
  const out = new Float32Array(field.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let min = 1;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const v = field[ny * width + nx];
          if (v < min) min = v;
        }
      }
      out[y * width + x] = min;
    }
  }
  return out;
}

function contrastLuma(r, g, b, amount) {
  const L = luma(r, g, b);
  if (L < 1) return [r, g, b];
  const L2 = clamp(128 + (L - 128) * amount, 0, 255);
  const k = L2 / L;
  return [r * k, g * k, b * k];
}

function recolorFlaxenToWhiteHair(r, g, b, bayL) {
  const L = luma(r, g, b);
  const greyR = r * 0.28 + L * 0.72;
  const greyG = g * 0.28 + L * 0.72;
  const greyB = b * 0.28 + L * 0.72;
  const t = Math.pow(smoothstep(95, 228, L), 0.82);
  const target = 128 + t * 124;
  const k = target / Math.max(L, 1);
  const strand = clamp((bayL - 6) / 52);
  const occ = 0.86 + 0.14 * strand;
  return [
    greyR * k * occ,
    greyG * k * occ * 0.99,
    greyB * k * occ * 0.97,
  ];
}

function inManeBox(x, y, scale) {
  if (x < 145 * scale || x > 310 * scale) return false;
  if (y < 52 * scale || y > 240 * scale) return false;
  return true;
}

function isForelock(x, y, scale) {
  return y < 88 * scale && x < 185 * scale;
}

function isManeHair(bay, x, y, width, height) {
  return maneWeight(bay, x, y, width, height) > 0.45;
}

/** 0–1: dark low-chroma bay hair in the mane box. Soft edge, not a hard cut. */
function maneWeight(bay, x, y, width, height) {
  const scale = width / SIZE;
  if (!inManeBox(x, y, scale) || isForelock(x, y, scale)) return 0;
  const i = (y * width + x) * 4;
  if (bay[i + 3] < 16) return 0;
  const L = luma(bay[i], bay[i + 1], bay[i + 2]);
  const C = chroma(bay[i], bay[i + 1], bay[i + 2]);
  return smoothstep(88, 40, L) * smoothstep(52, 18, C);
}

function maneTipFade(maneMask, width, height, maxR) {
  const fade = new Float32Array(width * height);
  fade.fill(1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (!maneMask[p]) continue;
      let dist = maxR + 1;
      ring: for (let r = 1; r <= maxR; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
              dist = r;
              break ring;
            }
            if (!maneMask[ny * width + nx]) {
              dist = r;
              break ring;
            }
          }
        }
      }
      fade[p] = dist > maxR ? 1 : smoothstep(0.3, maxR + 0.2, dist);
    }
  }
  return blurCoverage(fade, width, height, 2);
}

function blurRgbMasked(buf, mask, width, height, radius) {
  const tmp = Buffer.alloc(buf.length);
  buf.copy(tmp);
  const out = Buffer.from(buf);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (mask[p] < 0.2) continue;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let wsum = 0;
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= width) continue;
        const np = y * width + nx;
        const w = mask[np] * (buf[np * 4 + 3] / 255);
        if (w < 0.05) continue;
        const i = np * 4;
        sr += buf[i] * w;
        sg += buf[i + 1] * w;
        sb += buf[i + 2] * w;
        wsum += w;
      }
      if (wsum < 0.05) continue;
      const i = p * 4;
      tmp[i] = clampByte(sr / wsum);
      tmp[i + 1] = clampByte(sg / wsum);
      tmp[i + 2] = clampByte(sb / wsum);
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (mask[p] < 0.2) continue;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let wsum = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        const np = ny * width + x;
        const w = mask[np] * (tmp[np * 4 + 3] / 255);
        if (w < 0.05) continue;
        const i = np * 4;
        sr += tmp[i] * w;
        sg += tmp[i + 1] * w;
        sb += tmp[i + 2] * w;
        wsum += w;
      }
      if (wsum < 0.05) continue;
      const i = p * 4;
      const k = clamp(mask[p]);
      out[i] = clampByte(out[i] * (1 - k) + (sr / wsum) * k);
      out[i + 1] = clampByte(out[i + 1] * (1 - k) + (sg / wsum) * k);
      out[i + 2] = clampByte(out[i + 2] * (1 - k) + (sb / wsum) * k);
    }
  }
  return out;
}

/** Grow white into the black mane where the pie already crosses the crest. */
function growWhiteMane(field, bay, morph, width, height) {
  const scale = width / SIZE;
  const x0 = Math.round(145 * scale);
  const x1 = Math.round(310 * scale);
  const y0 = Math.round(52 * scale);
  const y1 = Math.round(240 * scale);

  const colHasWhite = new Uint8Array(width);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (field[y * width + x] > 0.45) colHasWhite[x] = 1;
    }
  }

  for (let x = x0; x <= x1; x++) {
    if (
      !colHasWhite[x] &&
      !colHasWhite[Math.max(x0, x - 2)] &&
      !colHasWhite[Math.min(x1, x + 2)]
    ) {
      continue;
    }
    for (let y = y0; y <= y1; y++) {
      const p = y * width + x;
      const i = p * 4;
      if (morph[i + 3] < 16) continue;
      if (!isManeHair(bay, x, y, width, height)) continue;
      field[p] = 1;
    }
  }
}

async function resizeRaw(data, width, height, size, kernel) {
  return sharp(data, { raw: { width, height, channels: 4 } })
    .resize(size, size, { kernel })
    .raw()
    .toBuffer({ resolveWithObject: true });
}

function parseArgs(argv) {
  let base = path.join(ROOT, 'plugins/horse/layers/coat/bay.png');
  let aligned = false;
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') {
      base = path.resolve(argv[++i] ?? '');
      continue;
    }
    if (argv[i] === '--aligned') {
      aligned = true;
      continue;
    }
    positional.push(argv[i]);
  }
  return {
    src: positional[0] ? path.resolve(positional[0]) : '',
    dest: positional[1] ? path.resolve(positional[1]) : '',
    base,
    aligned,
  };
}

async function main() {
  const { src, dest, base, aligned: alreadyAligned } = parseArgs(process.argv.slice(2));
  if (!src || !dest) {
    console.error(
      'Usage: node tools/extract-pie-overlay.mjs <horse.png> <out.png> [--base bay.png] [--aligned]',
    );
    process.exitCode = 1;
    return;
  }

  let aligned = src;
  if (!alreadyAligned) {
    aligned = path.join(ROOT, 'tmp', 'pie-extract-aligned.png');
    const cut = spawnSync(
      process.execPath,
      [path.join(ROOT, 'tools/cutout-on-morph.mjs'), src, aligned],
      { stdio: 'inherit' },
    );
    if (cut.status !== 0) {
      process.exitCode = cut.status ?? 1;
      return;
    }
  }

  const horse512 = await sharp(aligned)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bay512 = await sharp(base)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const palomino512 = await sharp(
    path.join(ROOT, 'plugins/horse/layers/coat/palomino.png'),
  )
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const morph512 = await sharp(
    path.join(ROOT, 'docs/images/horse-base/OC-Standard/morphology-master.png'),
  )
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const WORK = 1024;
  const horse = await resizeRaw(
    horse512.data,
    horse512.info.width,
    horse512.info.height,
    WORK,
    'mitchell',
  );
  const bay = await resizeRaw(
    bay512.data,
    bay512.info.width,
    bay512.info.height,
    WORK,
    'mitchell',
  );
  const palomino = await resizeRaw(
    palomino512.data,
    palomino512.info.width,
    palomino512.info.height,
    WORK,
    'mitchell',
  );
  const morphHi = await resizeRaw(
    morph512.data,
    morph512.info.width,
    morph512.info.height,
    WORK,
    'mitchell',
  );

  const { width, height } = horse.info;
  let field = new Float32Array(width * height);
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    if (horse.data[i + 3] < 16) continue;
    const lr = horse.data[i];
    const lg = horse.data[i + 1];
    const lb = horse.data[i + 2];
    const lLiked = luma(lr, lg, lb);
    const lBay = luma(bay.data[i], bay.data[i + 1], bay.data[i + 2]);
    const cLiked = chroma(lr, lg, lb);
    const lift = lLiked - lBay;
    let score = smoothstep(32, 70, lift) * smoothstep(110, 165, lLiked);
    if (cLiked > 50 && lLiked < 175) {
      score *= 0.12;
    }
    field[p] = clamp(score);
  }

  growWhiteMane(field, bay.data, morphHi.data, width, height);
  field = blurCoverage(field, width, height, 2);

  let binary = new Float32Array(width * height);
  for (let p = 0; p < field.length; p++) {
    binary[p] = field[p] > 0.38 ? 1 : 0;
  }
  binary = erodeBinary(dilateBinary(binary, width, height, 4), width, height, 3);

  const rounded = blurCoverage(binary, width, height, 10);
  for (let p = 0; p < binary.length; p++) {
    binary[p] = rounded[p] > 0.5 ? 1 : 0;
  }
  const soft = blurCoverage(binary, width, height, 5);

  const palLuma = new Float32Array(width * height);
  const bayLuma = new Float32Array(width * height);
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    palLuma[p] =
      luma(palomino.data[i], palomino.data[i + 1], palomino.data[i + 2]) / 255;
    bayLuma[p] = luma(bay.data[i], bay.data[i + 1], bay.data[i + 2]) / 255;
  }
  const palForm = blurCoverage(palLuma, width, height, 8);
  const palBlur = blurCoverage(palLuma, width, height, 2);
  const bayBlur = blurCoverage(bayLuma, width, height, 2);

  const out = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    const cov = soft[p];
    if (cov < 0.06 || morphHi.data[i + 3] < 16) continue;
    const palGrain = palLuma[p] - palBlur[p];
    const bayGrain = bayLuma[p] - bayBlur[p];
    const form = palForm[p] - palLuma[p];
    const t = Math.pow(clamp((palForm[p] * 255 - 38) / 172), 1.36);
    let r = 162 + t * 93;
    let g = 160 + t * 94;
    let b = 155 + t * 97;
    r += palGrain * 52 + bayGrain * 62 - form * 70;
    g += palGrain * 46 + bayGrain * 56 - form * 64;
    b += palGrain * 38 + bayGrain * 48 - form * 56;
    out[i] = clampByte(r);
    out[i + 1] = clampByte(g);
    out[i + 2] = clampByte(b);
    out[i + 3] = Math.min(morphHi.data[i + 3], clampByte(255 * cov));
  }

  const defringed = defringeSilhouette(out, morphHi.data, width, height, 1);
  const { data: downRaw } = await sharp(defringed, {
    raw: { width, height, channels: 4 },
  })
    .resize(SIZE, SIZE, { kernel: 'mitchell' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const smooth = featherAlpha(downRaw, SIZE, SIZE, 1);

  await mkdir(path.dirname(dest), { recursive: true });
  await sharp(smooth, { raw: { width: SIZE, height: SIZE, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(dest);
  console.log('wrote', path.relative(ROOT, dest));
}

await main();
