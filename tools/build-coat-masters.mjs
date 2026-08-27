/**
 * Paints the three coat masters (bay, chestnut, black) onto the shared
 * morphology plate. Same alpha, same shading; only pigment and points change.
 *
 * Usage: node tools/build-coat-masters.mjs
 *
 * Writes:
 *   docs/images/horse-base/coat-master-{bay,chestnut,black}.png
 *   plugins/horse/layers/coat/{bay,chestnut,black}.png
 */
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MORPH = path.join(ROOT, 'docs/images/horse-base/morphology-master.png');
const BASE_OUT = path.join(ROOT, 'docs/images/horse-base');
const LAYER_OUT = path.join(ROOT, 'plugins/horse/layers/coat');

function clamp(v, lo = 0, hi = 1) {
  return Math.min(hi, Math.max(lo, v));
}

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Clay body sits around luma 155–180. Keep mid as the coat colour;
 * only recesses go to shadow, only the brightest planes pick up a little high.
 */
function shade(l, shadow, mid, high) {
  const center = 158;
  if (l >= center) {
    const t = clamp((l - center) / 32) * 0.55;
    return mix(mid, high, t);
  }
  const t = clamp((center - l) / 90);
  return mix(mid, shadow, t * t * (3 - 2 * t));
}

const PALETTES = {
  bay: {
    body: {
      shadow: [64, 32, 18],
      mid: [128, 70, 36],
      high: [168, 108, 64],
    },
    points: {
      shadow: [10, 9, 8],
      mid: [28, 24, 22],
      high: [62, 54, 48],
    },
  },
  chestnut: {
    body: {
      shadow: [84, 32, 14],
      mid: [158, 74, 30],
      high: [196, 112, 58],
    },
    // Same family as body, a touch darker — never black.
    points: {
      shadow: [70, 26, 12],
      mid: [138, 58, 26],
      high: [186, 104, 56],
    },
  },
  black: {
    body: {
      shadow: [6, 5, 5],
      mid: [26, 23, 21],
      high: [52, 46, 40],
    },
    points: {
      shadow: [6, 5, 5],
      mid: [22, 20, 18],
      high: [48, 42, 38],
    },
  },
};

function buildSilhouette(data, width, height) {
  const top = new Array(width).fill(height);
  const left = new Array(height).fill(width);
  const right = new Array(height).fill(-1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < 16) continue;
      if (y < top[x]) top[x] = y;
      if (x < left[y]) left[y] = x;
      if (x > right[y]) right[y] = x;
    }
  }
  return { top, left, right };
}

/**
 * 0 = body pigment, 1 = points (mane, tail, lower legs, muzzle, ear rims).
 * Geometry is for the current 3/4 master: head left, croup right.
 */
function pointWeight(x, y, { top, left, right }) {
  let w = 0;

  // Lower legs — split starts ~y 310. Feather through knees / hocks.
  if (y > 268) {
    w = Math.max(w, smoothstep(278, 332, y));
  }

  // Tail: thicker at the dock, then a thin band down the right silhouette.
  if (y > 148 && y < 420 && x > 300 && right[y] >= 0) {
    const inward = right[y] - x;
    const maxDepth = y < 188 ? 34 : 18;
    if (inward >= 0) w = Math.max(w, 1 - smoothstep(2, maxDepth, inward));
  }

  // Muzzle / lower face (left of head).
  if (x < 122 && y > 122 && y < 200) {
    w = Math.max(w, smoothstep(122, 86, x) * (1 - smoothstep(182, 200, y)));
  }

  // Ear tips.
  if (y < 54 && x > 85 && x < 160) {
    w = Math.max(w, smoothstep(54, 34, y));
  }

  // Mane: crest band + hair falling down the near side of the neck.
  if (x > 75 && x < 220 && y > 46 && y < 162) {
    const crest = top[x];
    if (crest < 500) {
      w = Math.max(w, 1 - smoothstep(6, 58, y - crest));
    }
    const inward = x - left[y];
    if (left[y] < 512 && inward >= 0) {
      w = Math.max(w, 1 - smoothstep(4, 48, inward));
    }
  }

  return clamp(w);
}

async function paint(data, width, height, name) {
  const palette = PALETTES[name];
  const silhouette = buildSilhouette(data, width, height);
  const out = Buffer.alloc(data.length);

  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    const a = data[i + 3];
    if (a < 8) {
      out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
      continue;
    }

    const l = luma(data[i], data[i + 1], data[i + 2]);
    const body = shade(l, palette.body.shadow, palette.body.mid, palette.body.high);
    const pts = shade(
      l,
      palette.points.shadow,
      palette.points.mid,
      palette.points.high,
    );
    const x = p % width;
    const y = (p / width) | 0;
    // Chestnut: only mane/tail go to the darker red, not the legs.
    let w = pointWeight(x, y, silhouette);
    if (name === 'chestnut' && y > 260) w *= 0.12;
    if (name === 'black') w = Math.max(w, 0.2);

    const [r, g, b] = mix(body, pts, w);
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = a;
  }

  return out;
}

async function writePng(buffer, width, height, dest) {
  await mkdir(path.dirname(dest), { recursive: true });
  await sharp(buffer, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(dest);
  console.log('wrote', path.relative(ROOT, dest));
}

async function main() {
  try {
    await access(MORPH);
  } catch {
    console.error(`Morphology master not found: ${path.relative(ROOT, MORPH)}`);
    process.exitCode = 1;
    return;
  }

  const { data, info } = await sharp(MORPH)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;

  for (const name of ['bay', 'chestnut', 'black']) {
    const painted = await paint(data, width, height, name);
    await writePng(
      painted,
      width,
      height,
      path.join(BASE_OUT, `coat-master-${name}.png`),
    );
    await writePng(painted, width, height, path.join(LAYER_OUT, `${name}.png`));
  }

  const { spawnSync } = await import('node:child_process');
  const sync = spawnSync(
    process.execPath,
    [path.join(ROOT, 'tools/sync-editor-horse-plugin.mjs')],
    { stdio: 'inherit' },
  );
  if (sync.status !== 0) process.exitCode = sync.status ?? 1;
}

await main();
