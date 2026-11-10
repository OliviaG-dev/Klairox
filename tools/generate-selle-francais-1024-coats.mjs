/**
 * Rebuilds the Selle Français horse from a green-screen render:
 *   1. keys out the green background (soft alpha + despill),
 *   2. fits the horse on a transparent 1024×1024 canvas,
 *   3. recolors the exact same silhouette into each coat.
 *
 *   node tools/generate-selle-francais-1024-coats.mjs <green-screen.png>
 *   node tools/generate-selle-francais-1024-coats.mjs <png> --out path/to/dir
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = path.join(ROOT, 'dist', 'stalloria', 'selle-francais-1024');
const SIZE = 1024;

/** Horse bounding box on the existing 1024 plates (bay.png). */
const TARGET_BOX = { left: 72, top: 95, width: 880, height: 881 };

/** Green-screen keying (d = green minus the stronger of red and blue). */
const KEY_SOLID_BELOW = 20;
const KEY_CLEAR_ABOVE = 85;
const ALPHA_VISIBLE = 8;
const UNMIX_MIN_ALPHA = 0.2;
/** No silhouette shrink: only the green-mixed fringe is recoloured. */
const ERODE_RADIUS = 0;
const FEATHER_RADIUS = 0;
/** Anti-alias applied after the upscale, so the outline is not stair-stepped. */
const EDGE_BLUR = 0;

/** Hoof height in source pixels, measured up from the bottom of the horse. */
const HOOF_HEIGHT = 36;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const clampByte = (v) => clamp(Math.round(v), 0, 255);
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function mix(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

/** Bilinear value noise on a square grid of `cell` pixels. */
function valueNoise(x, y, cell) {
  const gx = x / cell;
  const gy = y / cell;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const fx = gx - ix;
  const fy = gy - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = uhash(ix, iy) * (1 - sx) + uhash(ix + 1, iy) * sx;
  const bottom = uhash(ix, iy + 1) * (1 - sx) + uhash(ix + 1, iy + 1) * sx;
  return top * (1 - sy) + bottom * sy;
}

function uhash(x, y) {
  let n = Math.imul(x ^ Math.imul(y, 374761), 1274126177);
  n = Math.imul(n ^ (n >>> 16), 668265263);
  return ((n ^ (n >>> 15)) >>> 0) / 4294967295;
}

/** Gradient map: luminance -> colour, linear between stops. */
function gradientMap(stops) {
  return (l) => {
    if (l <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      if (l <= stops[i][0]) {
        const [l0, c0] = stops[i - 1];
        const [l1, c1] = stops[i];
        return mix(c0, c1, (l - l0) / (l1 - l0));
      }
    }
    return stops[stops.length - 1][1];
  };
}

const MAPS = {
  bayBrunBody: gradientMap([
    [0, [12, 6, 4]],
    [26, [30, 15, 9]],
    [50, [55, 28, 16]],
    [78, [88, 48, 30]],
    [104, [120, 72, 50]],
    [140, [160, 110, 85]],
  ]),
  chestnutBody: gradientMap([
    [0, [60, 25, 10]],
    [26, [120, 55, 22]],
    [50, [178, 92, 38]],
    [78, [214, 126, 60]],
    [104, [238, 160, 100]],
    [140, [250, 190, 140]],
  ]),
  chestnutMane: gradientMap([
    [0, [120, 62, 24]],
    [15, [170, 92, 36]],
    [30, [214, 128, 58]],
    [60, [240, 170, 96]],
  ]),
  black: gradientMap([
    [0, [3, 3, 4]],
    [12, [10, 10, 11]],
    [30, [24, 24, 26]],
    [50, [31, 31, 34]],
    [78, [49, 49, 54]],
    [104, [76, 76, 82]],
    [140, [108, 108, 116]],
  ]),
  greyBody: gradientMap([
    [0, [95, 98, 104]],
    [26, [150, 153, 158]],
    [50, [200, 202, 205]],
    [78, [225, 227, 229]],
    [104, [240, 241, 242]],
    [140, [250, 250, 250]],
  ]),
  greyMane: gradientMap([
    [0, [70, 72, 76]],
    [15, [105, 107, 112]],
    [30, [145, 147, 152]],
    [60, [190, 192, 196]],
  ]),
  greyLeg: gradientMap([
    [0, [55, 57, 61]],
    [15, [85, 87, 92]],
    [30, [120, 122, 127]],
    [60, [170, 172, 176]],
  ]),
};

const ROAN_FLECK = [240, 226, 212];
const ROAN_STRENGTH = 0.6;
const ROAN_HEAD_DENSITY = 0.35;

async function readSource(file) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function estimateBackground(data, width) {
  const sum = [0, 0, 0];
  let n = 0;
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 100; x++) {
      const i = (y * width + x) * 4;
      sum[0] += data[i];
      sum[1] += data[i + 1];
      sum[2] += data[i + 2];
      n++;
    }
  }
  return sum.map((v) => v / n);
}

/** Pulls the foreground colour out of a pixel mixed with the green screen. */
function unmix(r, g, b, alpha, bg) {
  const a = Math.max(alpha, UNMIX_MIN_ALPHA);
  const rgb = [r, g, b].map((c, k) => (c - (1 - a) * bg[k]) / a);
  const warm = 0.45 * rgb[0] + 0.2 * rgb[2] + 2;
  rgb[1] = Math.min(rgb[1], Math.max(rgb[0], rgb[2]) + 4, warm);
  return rgb.map(clampByte);
}

/** Drops the outer rim, whose colour is still mixed with the background. */
function erodeAlpha(alpha, width, height, radius) {
  const eroded = new Float32Array(alpha.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let min = 1;
      for (let dy = -radius; dy <= radius && min > 0; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) {
          min = 0;
          break;
        }
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          const value = xx < 0 || xx >= width ? 0 : alpha[yy * width + xx];
          if (value < min) min = value;
        }
      }
      eroded[y * width + x] = min;
    }
  }
  return eroded;
}

/**
 * Edge pixels lost by the erosion keep a green-mixed colour. Replace it with
 * the nearest interior pixel before the edge is feathered back in.
 */
function fillEdgeColour(colour, alpha, width, height, radius) {
  const filled = Buffer.from(colour);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] >= 0.5) continue;
      let best = radius * radius + 1;
      let rgb = null;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const dist = dx * dx + dy * dy;
          if (dist >= best || alpha[yy * width + xx] < 0.5) continue;
          best = dist;
          const i = (yy * width + xx) * 4;
          rgb = [colour[i], colour[i + 1], colour[i + 2]];
        }
      }
      if (!rgb) continue;
      const i = (y * width + x) * 4;
      filled[i] = rgb[0];
      filled[i + 1] = rgb[1];
      filled[i + 2] = rgb[2];
    }
  }
  return filled;
}

/** One-pixel falloff so the eroded edge is not stair-stepped. */
function featherAlpha(alpha, width, height, radius) {
  const out = new Float32Array(alpha.length);
  const span = radius * 2 + 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          sum += alpha[yy * width + xx];
          n++;
        }
      }
      out[y * width + x] = sum / (n || span * span);
    }
  }
  return out;
}

/** Soft chroma key, then the contaminated rim is eroded and feathered. */
function keyGreen(data, width, height) {
  const bg = estimateBackground(data, width);
  const alpha = new Float32Array(width * height);
  const colour = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const raw =
      1 - smoothstep(KEY_SOLID_BELOW, KEY_CLEAR_ABOVE, g - Math.max(r, b));
    alpha[p] = raw;
    if (raw * 255 < ALPHA_VISIBLE) continue;
    const rgb = raw < 1 ? unmix(r, g, b, raw, bg) : [r, g, b];
    colour[i] = rgb[0];
    colour[i + 1] = rgb[1];
    colour[i + 2] = rgb[2];
  }

  const solid = erodeAlpha(alpha, width, height, ERODE_RADIUS);
  const cleaned = fillEdgeColour(
    colour,
    solid,
    width,
    height,
    ERODE_RADIUS + 3,
  );
  const matte = featherAlpha(solid, width, height, FEATHER_RADIUS);
  for (let p = 0; p < matte.length; p++) {
    const i = p * 4;
    const gCap = Math.max(cleaned[i], cleaned[i + 2]);
    if (cleaned[i + 1] > gCap) cleaned[i + 1] = gCap;
    cleaned[i + 3] = clampByte(matte[p] * 255);
  }
  return cleaned;
}

/** Blurs colour and alpha together so the upscaled outline is anti-aliased. */
function blurPremultiplied(buf, size, sigma) {
  const radius = Math.ceil(sigma * 2);
  const kernel = [];
  let weight = 0;
  for (let i = -radius; i <= radius; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(w);
    weight += w;
  }
  const n = size * size;
  const src = new Float32Array(n * 4);
  const tmp = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const a = buf[i * 4 + 3] / 255;
    src[i * 4] = buf[i * 4] * a;
    src[i * 4 + 1] = buf[i * 4 + 1] * a;
    src[i * 4 + 2] = buf[i * 4 + 2] * a;
    src[i * 4 + 3] = a;
  }
  const blurAxis = (input, output, horizontal) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const acc = [0, 0, 0, 0];
        for (let k = -radius; k <= radius; k++) {
          const xx = horizontal ? x + k : x;
          const yy = horizontal ? y : y + k;
          const inside = xx >= 0 && xx < size && yy >= 0 && yy < size;
          const s = inside ? (yy * size + xx) * 4 : -1;
          const w = kernel[k + radius];
          for (let c = 0; c < 4; c++) acc[c] += (s < 0 ? 0 : input[s + c]) * w;
        }
        const o = (y * size + x) * 4;
        for (let c = 0; c < 4; c++) output[o + c] = acc[c] / weight;
      }
    }
  };
  blurAxis(src, tmp, true);
  blurAxis(tmp, src, false);
  for (let i = 0; i < n; i++) {
    const a = src[i * 4 + 3];
    buf[i * 4 + 3] = clampByte(a * 255);
    if (a < 1 / 255) continue;
    for (let c = 0; c < 3; c++) buf[i * 4 + c] = clampByte(src[i * 4 + c] / a);
  }
}

function alphaBounds(data, width, height) {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let p = 0; p < width * height; p++) {
    if (data[p * 4 + 3] < ALPHA_VISIBLE) continue;
    const x = p % width;
    const y = (p / width) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

/** Fits the keyed horse on the 1024 canvas, same box as the existing plates. */
async function buildBase(file) {
  const src = await readSource(file);
  const keyed = keyGreen(src.data, src.width, src.height);
  const box = alphaBounds(keyed, src.width, src.height);
  const w = box.x1 - box.x0 + 1;
  const h = box.y1 - box.y0 + 1;
  const scale = Math.min(TARGET_BOX.width / w, TARGET_BOX.height / h);
  const outW = Math.round(w * scale);
  const outH = Math.round(h * scale);
  const left = Math.round(TARGET_BOX.left + (TARGET_BOX.width - outW) / 2);
  const top = Math.round(TARGET_BOX.top + (TARGET_BOX.height - outH) / 2);

  const resized = await sharp(keyed, {
    raw: { width: src.width, height: src.height, channels: 4 },
  })
    .extract({ left: box.x0, top: box.y0, width: w, height: h })
    .resize(outW, outH, { kernel: 'lanczos3' })
    .png()
    .toBuffer();

  const canvas = await sharp({
    create: {
      width: SIZE,
      height: SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: resized, left, top }])
    .raw()
    .toBuffer();

  for (let i = 0; i < canvas.length; i += 4) {
    if (canvas[i + 3] < ALPHA_VISIBLE) continue;
    const gCap = Math.max(canvas[i], canvas[i + 2]);
    if (canvas[i + 1] > gCap) canvas[i + 1] = gCap;
  }
  if (EDGE_BLUR > 0) blurPremultiplied(canvas, SIZE, EDGE_BLUR);

  const toSource = (x, y) => [
    box.x0 + (x - left + 0.5) / scale - 0.5,
    box.y0 + (y - top + 0.5) / scale - 0.5,
  ];
  return { canvas, toSource, sourceBottom: box.y1 };
}

function isHoof(ys, sourceBottom) {
  return ys >= sourceBottom - HOOF_HEIGHT;
}

/**
 * Per-pixel description in source coordinates. `point` is 1 for black points
 * (mane, tail, lower legs, face details) and 0 for coat; `tail` and `mane`
 * say which hair region a point belongs to (0..1 weights).
 */
function describe(r, g, b, xs, ys, sourceBottom) {
  const l = lum(r, g, b);
  const chroma = r - b;
  const point = l < 70 ? 1 - smoothstep(14, 55, chroma) : 0;
  const hoof = isHoof(ys, sourceBottom);
  const tail = ys > 350 ? smoothstep(710, 760, xs) : 0;
  const crest = ys < 190 ? 190 : 250 + (ys - 190) * 0.9;
  const mane = ys > 100 && ys < 370 && xs > crest && xs < 560 ? 1 : 0;
  const hair = Math.max(mane, tail);
  return { l, point, hoof, hair, headZone: xs < 365 && ys < 230 };
}

const PAINTS = {
  bay: null,
  'bay-brun': (px, d, x, y, strength = 1) => {
    const body = MAPS.bayBrunBody(d.l);
    const painted = mix(body, [px[0], px[1], px[2]], d.point);
    const toned = mix([px[0], px[1], px[2]], painted, Math.min(strength, 1));
    if (strength <= 1) return toned;
    return mix(toned, [8, 4, 3], strength - 1);
  },
  chestnut: (px, d) => {
    const l = d.l;
    return [l * 1.15, l * 0.5, l * 0.22];
  },
  black: (px, d) => MAPS.black(d.l),
  grey: (px, d) => {
    const body = MAPS.greyBody(d.l);
    const hairOrLeg = mix(MAPS.greyLeg(d.l), MAPS.greyMane(d.l), d.hair);
    return mix(body, hairOrLeg, d.point);
  },
  roan: (px, d, x, y) => {
    const base = [px[0] * 1.06, px[1] * 1.06, px[2] * 1.06];
    const density = d.headZone ? ROAN_HEAD_DENSITY : 1;
    const fleck = smoothstep(0.6, 0.8, valueNoise(x, y, 2.2));
    const patch = 0.55 + 0.45 * valueNoise(x + 97, y + 41, 38);
    const strength = fleck * patch * density * ROAN_STRENGTH * (1 - d.point);
    return mix(base, ROAN_FLECK, strength);
  },
};

function paintCoat(base, toSource, sourceBottom, name, strength = 1) {
  const paint = PAINTS[name];
  const out = Buffer.from(base);
  if (!paint) return out;
  for (let p = 0; p < SIZE * SIZE; p++) {
    const i = p * 4;
    if (base[i + 3] < ALPHA_VISIBLE) continue;
    const x = p % SIZE;
    const y = (p / SIZE) | 0;
    const [xs, ys] = toSource(x, y);
    const d = describe(base[i], base[i + 1], base[i + 2], xs, ys, sourceBottom);
    if (d.hoof) continue;
    const rgb = paint([base[i], base[i + 1], base[i + 2]], d, x, y, strength);
    out[i] = clampByte(rgb[0]);
    out[i + 1] = clampByte(rgb[1]);
    out[i + 2] = clampByte(rgb[2]);
  }
  return out;
}

async function writePlate(buffer, file) {
  await sharp(buffer, { raw: { width: SIZE, height: SIZE, channels: 4 } })
    .png()
    .toFile(file);
}

async function writeContactSheet(plates, file) {
  const TILE = 512;
  const tiles = await Promise.all(
    plates.map((plate) =>
      sharp(plate, { raw: { width: SIZE, height: SIZE, channels: 4 } })
        .flatten({ background: '#8a8a8a' })
        .resize(TILE, TILE)
        .png()
        .toBuffer(),
    ),
  );
  await sharp({
    create: {
      width: TILE * 3,
      height: TILE * 2,
      channels: 3,
      background: '#8a8a8a',
    },
  })
    .composite(
      tiles.map((input, i) => ({
        input,
        left: (i % 3) * TILE,
        top: Math.floor(i / 3) * TILE,
      })),
    )
    .png()
    .toFile(file);
}

function parseArgs(argv) {
  let input = '';
  let out = DEFAULT_OUT;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = path.resolve(argv[++i] ?? DEFAULT_OUT);
    else input = path.resolve(argv[i]);
  }
  if (!input) {
    throw new Error(
      'Usage: node tools/generate-selle-francais-1024-coats.mjs <png> [--out dir]',
    );
  }
  return { input, out };
}

const { input, out } = parseArgs(process.argv.slice(2));
await mkdir(out, { recursive: true });

const { canvas, toSource, sourceBottom } = await buildBase(input);
const names = Object.keys(PAINTS);
const plates = [];
for (const name of names) {
  const plate = paintCoat(canvas, toSource, sourceBottom, name);
  plates.push(plate);
  await writePlate(plate, path.join(out, `${name}.png`));
  console.log('wrote', name);
}
await writeContactSheet(plates, path.join(out, '_contact-sheet.png'));
console.log('done ->', path.relative(ROOT, out));
