/**
 * Keys the flat white studio backdrop out of a generated horse render and
 * normalises it to the plugin canvas (512x512, straight alpha).
 *
 * Unlike tools/cutout-on-morph.mjs this does not borrow the morphology alpha,
 * so it also works on renders whose framing does not line up with the
 * Standard-OC silhouette.
 *
 * The backdrop is flooded from the border in two stages. The strict stage only
 * claims perfectly flat paper, which keeps shaded white hair (bald face, socks)
 * intact. The relaxed stage then reuses that result as its seed, so soft ground
 * shadows and the antialiased rim are reached without ever starting inside the
 * subject. A final choke erodes the matte by a couple of pixels to drop the
 * backdrop-contaminated fringe before the downscale.
 *
 * Usage:
 *   node tools/key-white-backdrop.mjs <src.png> <dest.png> [--size 512] [--choke 3]
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 512;
const CHOKE = 3;

/** Perfectly flat studio paper: safe to flood from the image border. */
const STRICT = { dist: 26, chroma: 6, luma: 234, flat: 4 };
/** Soft ground shadow and antialiased rim: only flooded from a strict seed. */
const RELAXED = { dist: 130, chroma: 15, luma: 204, flat: 16 };

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function chroma(r, g, b) {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function dist(r, g, b, bg) {
  return Math.abs(r - bg.r) + Math.abs(g - bg.g) + Math.abs(b - bg.b);
}

function sampleBackdrop(data, width, height) {
  const pts = [
    [2, 2],
    [width - 3, 2],
    [2, height - 3],
    [width - 3, height - 3],
    [width >> 1, 2],
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [x, y] of pts) {
    const i = (y * width + x) * 4;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  const n = pts.length;
  return { r: r / n, g: g / n, b: b / n };
}

/** 3x3 luma range per pixel; flat areas are backdrop, textured ones are coat. */
function lumaRange(data, width, height) {
  const range = new Uint8Array(width * height);
  const l = new Float32Array(width * height);
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    l[p] = luma(data[i], data[i + 1], data[i + 2]);
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let lo = 255;
      let hi = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const v = l[ny * width + nx];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      range[y * width + x] = Math.min(255, Math.round(hi - lo));
    }
  }
  return range;
}

/**
 * Flood the backdrop inward. Without `seed` the queue starts on the image
 * border; with `seed` it starts on every already-claimed pixel, which lets a
 * looser gate widen an existing matte without seeding inside the subject.
 */
function floodBackdrop(data, width, height, bg, range, gate, seed) {
  const isBackdrop = seed
    ? Uint8Array.from(seed)
    : new Uint8Array(width * height);
  const queue = [];

  const claim = (x, y) => {
    const p = y * width + x;
    if (isBackdrop[p]) return;
    const i = p * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (dist(r, g, b, bg) >= gate.dist) return;
    if (chroma(r, g, b) >= gate.chroma) return;
    if (luma(r, g, b) <= gate.luma) return;
    if (range[p] > gate.flat) return;
    isBackdrop[p] = 1;
    queue.push(p);
  };

  if (seed) {
    for (let p = 0; p < width * height; p++) {
      if (isBackdrop[p]) queue.push(p);
    }
  } else {
    for (let x = 0; x < width; x++) {
      claim(x, 0);
      claim(x, height - 1);
    }
    for (let y = 0; y < height; y++) {
      claim(0, y);
      claim(width - 1, y);
    }
  }

  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi];
    const x = p % width;
    const y = (p / width) | 0;
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      claim(nx, ny);
    }
  }

  return isBackdrop;
}

/** Erode the subject so the backdrop-contaminated rim is dropped. */
function chokeMatte(isBackdrop, width, height, radius) {
  if (radius <= 0) return Uint8Array.from(isBackdrop);
  const out = Uint8Array.from(isBackdrop);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isBackdrop[y * width + x]) continue;
      let touches = false;
      for (let dy = -radius; dy <= radius && !touches; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (isBackdrop[ny * width + nx]) {
            touches = true;
            break;
          }
        }
      }
      if (touches) out[y * width + x] = 1;
    }
  }
  return out;
}

/** Spread coat RGB outward so a premultiplied downscale cannot pull backdrop in. */
function dilateRgbIntoTransparent(data, isBackdrop, width, height, radius = 2) {
  const out = Buffer.from(data);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (!isBackdrop[p]) continue;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let n = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          if (isBackdrop[q]) continue;
          const j = q * 4;
          sr += data[j];
          sg += data[j + 1];
          sb += data[j + 2];
          n++;
        }
      }
      if (n === 0) continue;
      const i = p * 4;
      out[i] = Math.round(sr / n);
      out[i + 1] = Math.round(sg / n);
      out[i + 2] = Math.round(sb / n);
    }
  }
  return out;
}

async function keyBackdrop(src, dest, size, choke) {
  const { data, info } = await sharp(src)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;

  const bg = sampleBackdrop(data, width, height);
  const range = lumaRange(data, width, height);
  const strict = floodBackdrop(data, width, height, bg, range, STRICT);
  const relaxed = floodBackdrop(
    data,
    width,
    height,
    bg,
    range,
    RELAXED,
    strict,
  );
  const matte = chokeMatte(relaxed, width, height, choke);
  const rgb = dilateRgbIntoTransparent(data, matte, width, height, 2);

  const rgba = Buffer.alloc(width * height * 4);
  let kept = 0;
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    rgba[i] = rgb[i];
    rgba[i + 1] = rgb[i + 1];
    rgba[i + 2] = rgb[i + 2];
    rgba[i + 3] = matte[p] ? 0 : 255;
    if (!matte[p]) kept++;
  }

  await mkdir(path.dirname(dest), { recursive: true });
  await sharp(rgba, { raw: { width, height, channels: 4 } })
    .resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: 'mitchell',
    })
    .png({ compressionLevel: 9 })
    .toFile(dest);

  return { width, height, coverage: kept / (width * height) };
}

function parseArgs(argv) {
  let size = SIZE;
  let choke = CHOKE;
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--size') {
      size = Number(argv[++i]);
      continue;
    }
    if (argv[i] === '--choke') {
      choke = Number(argv[++i]);
      continue;
    }
    positional.push(argv[i]);
  }
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error('--size expects a positive integer');
  }
  if (!Number.isInteger(choke) || choke < 0) {
    throw new Error('--choke expects a non-negative integer');
  }
  return { size, choke, src: positional[0], dest: positional[1] };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
    return;
  }
  if (!args.src || !args.dest) {
    console.error(
      'Usage: node tools/key-white-backdrop.mjs <src.png> <dest.png> [--size 512] [--choke 3]',
    );
    process.exitCode = 1;
    return;
  }

  const { width, height, coverage } = await keyBackdrop(
    path.resolve(args.src),
    path.resolve(args.dest),
    args.size,
    args.choke,
  );
  console.log(
    `wrote ${path.relative(ROOT, path.resolve(args.dest))} (from ${width}x${height}, subject ${(
      coverage * 100
    ).toFixed(1)}%)`,
  );
}

await main();
