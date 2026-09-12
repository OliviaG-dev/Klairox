/**
 * Bakes the Stalloria horse matrix at 1024×1024 into dist/stalloria/horses.
 *
 * Coat RGB comes from the photoreal source (native ≥1024), masked with the
 * plugin silhouette alpha so corners stay transparent. Other layers are
 * resized with Lanczos and keep their alpha. Canvas background is transparent.
 *
 *   node tools/generate-stalloria-assets.mjs
 *   node tools/generate-stalloria-assets.mjs --dry-run
 *   node tools/generate-stalloria-assets.mjs --force
 *   node tools/generate-stalloria-assets.mjs --only stalloria-standard-palomino-pie-none-mark-none
 *   node tools/generate-stalloria-assets.mjs --out path/to/dir
 */
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KlairoxEngine,
  buildAssetMetadata,
  toRenderRequest,
} from '@klairox/core';
import { SharpRenderer } from '@klairox/renderer';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_DIR = path.join(ROOT, 'plugins', 'horse');
const DEFAULT_OUT = path.join(ROOT, 'dist', 'stalloria', 'horses');
const LAYER_CACHE = path.join(ROOT, 'dist', 'stalloria', '_layers-1024');
const VERIFY_DIR = path.join(ROOT, 'dist', 'stalloria', 'verify');
const SIZE = 1024;
const THUMB = 256;
const CONCURRENCY = 1;
const PALOMINO_CHECK = 'stalloria-standard-palomino-pie-none-mark-none';
/** Near-side adult eye on the 512 plate, scaled to 1024. */
const ADULT_EYE_1024 = [260, 176];

const COATS = [
  'bay',
  'bay-brun',
  'black',
  'chestnut',
  'grey',
  'roan',
  'palomino',
  'isabelle',
  'cream',
];

const MARKINGS = [
  'blaze',
  'thin-blaze',
  'stripe',
  'star',
  'diamond',
  'heart',
  'snip',
  'star-snip',
  'bald',
  'crescent',
];

const PIES = [null, 'tobiano'];
const MARKING_CHOICES = [null, ...MARKINGS];

function parseArgs(argv) {
  let dryRun = false;
  let force = false;
  let out = DEFAULT_OUT;
  let only = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--force') force = true;
    else if (arg === '--out') out = path.resolve(argv[++i] ?? DEFAULT_OUT);
    else if (arg === '--only') only = argv[++i] ?? null;
  }
  return { dryRun, force, out, only };
}

function buildJobs() {
  /** @type {{ name: string, selection: Record<string, string> }[]} */
  const jobs = [];

  for (const body of ['standard', 'foal']) {
    for (const coat of COATS) {
      for (const pie of PIES) {
        for (const marking of MARKING_CHOICES) {
          const pieId = pie ?? 'none';
          const markId = marking ?? 'none';
          const name = `stalloria-${body}-${coat}-pie-${pieId}-mark-${markId}`;
          /** @type {Record<string, string>} */
          const selection = { body, mane: 'short' };

          if (body === 'standard') {
            selection.coat = coat;
            if (pie) selection.pie = pie;
            if (marking) selection.markings = marking;
          } else {
            selection['coat-foal'] = coat;
            if (pie) selection['pie-foal'] = pie;
            if (marking) selection['markings-foal'] = marking;
          }

          jobs.push({ name, selection });
        }
      }
    }
  }

  return jobs;
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function alreadyBaked1024(out, name) {
  const sidecar = path.join(out, `${name}.json`);
  const pngPath = path.join(out, `${name}.png`);
  if (!(await exists(sidecar)) || !(await exists(pngPath))) return false;
  try {
    const meta = JSON.parse(await readFile(sidecar, 'utf8'));
    if (meta?.canvas?.width !== SIZE) return false;
    const { data } = await sharp(pngPath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return data[3] === 0;
  } catch {
    return false;
  }
}

function photorealPath(layerId, optionId) {
  if (layerId === 'coat') {
    return path.join(
      ROOT,
      'docs',
      'images',
      'horse-source',
      `coat-${optionId}-photoreal-src.png`,
    );
  }
  if (layerId === 'coat-foal') {
    return path.join(
      ROOT,
      'docs',
      'images',
      'horse-source',
      'foal',
      `coat-${optionId}-photoreal-src.png`,
    );
  }
  return null;
}

/** Plugin silhouette as a 1-channel 1024 alpha, not an opaque grey PNG. */
async function silhouetteAlpha(pluginPng) {
  return sharp(pluginPng)
    .resize(SIZE, SIZE, { kernel: 'lanczos3' })
    .ensureAlpha()
    .extractChannel('alpha')
    .raw()
    .toBuffer();
}

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/**
 * Everything reachable from the border through already-transparent pixels, plus
 * pixels darker than anything the coat itself contains (`voidMax`). On a
 * jet-black coat `voidMax` collapses to 0, so its silhouette is untouched; on a
 * pale coat it lets the flood reach the void trapped inside the tail blob.
 */
function floodExterior(alpha, rgb, width, height, voidMax) {
  const bg = new Uint8Array(width * height);
  const queue = [];
  const tryPush = (p) => {
    if (bg[p]) return;
    if (alpha[p] >= 24) {
      if (voidMax <= 0) return;
      const j = p * 3;
      if (luma(rgb[j], rgb[j + 1], rgb[j + 2]) > voidMax) return;
    }
    bg[p] = 1;
    queue.push(p);
  };

  for (let x = 0; x < width; x++) {
    tryPush(x);
    tryPush((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    tryPush(y * width);
    tryPush(y * width + (width - 1));
  }

  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi];
    const x = p % width;
    const y = (p / width) | 0;
    if (x > 0) tryPush(p - 1);
    if (x + 1 < width) tryPush(p + 1);
    if (y > 0) tryPush(p - width);
    if (y + 1 < height) tryPush(p + width);
  }
  return bg;
}

/**
 * Shared tail of every layer: kill the black in the soft edge, then in the
 * fully transparent pixels, so no later resample can pull it back in.
 */
function cleanLayerRgba(data, width, height) {
  return dilateRgbIntoTransparent(
    repaintDarkRim(despeckleMatte(data, width, height), width, height),
    width,
    height,
    2,
  );
}

/** Distance to the nearest background pixel (8-connected), capped at maxD. */
function distanceToBackground(bg, width, height, maxD) {
  const dist = new Uint8Array(width * height).fill(maxD + 1);
  const queue = new Int32Array(width * height);
  let tail = 0;

  for (let p = 0; p < bg.length; p++) {
    if (bg[p]) {
      dist[p] = 0;
      queue[tail++] = p;
    }
  }

  for (let head = 0; head < tail; head++) {
    const p = queue[head];
    const d = dist[p];
    if (d >= maxD) continue;
    const x = p % width;
    const y = (p / width) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const np = ny * width + nx;
        if (dist[np] <= d + 1) continue;
        dist[np] = d + 1;
        queue[tail++] = np;
      }
    }
  }
  return dist;
}

/**
 * Tidy the matte edge: drop isolated near-void pixels left inside the cut
 * (they read as a jagged black lace around mane and tail) and close single
 * transparent pinholes surrounded by coat, so the robe keeps no holes.
 */
function despeckleMatte(data, width, height) {
  const out = Buffer.from(data);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      let clear = 0;
      let solid = 0;
      let alphaSum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const a = data[((y + dy) * width + (x + dx)) * 4 + 3];
          if (a < 8) clear++;
          else {
            solid++;
            alphaSum += a;
          }
        }
      }

      const a = data[i + 3];
      if (a === 0) {
        if (solid >= 7) out[i + 3] = Math.round(alphaSum / solid);
        continue;
      }
      if (clear >= 6 && luma(data[i], data[i + 1], data[i + 2]) < 14) {
        out[i + 3] = 0;
      }
    }
  }
  return out;
}

/** Thickness of the rim whose colour is suspect, in 1024px pixels. */
const RIM_WIDTH = 2;
/** Neighbourhood the rim borrows its colour from. */
const RIM_DONOR_RADIUS = 4;
/** Only lift a rim pixel this much darker than its neighbourhood. */
const RIM_DARK_MARGIN = 8;
/** Repaint passes, so wisps made only of rim pixels are reached too. */
const RIM_PASSES = 3;

/** Pixels that still have alpha but sit within RIM_WIDTH of transparency. */
function rimMask(data, width, height) {
  const rim = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (data[p * 4 + 3] === 0) continue;
      for (let dy = -RIM_WIDTH; dy <= RIM_WIDTH && !rim[p]; dy++) {
        for (let dx = -RIM_WIDTH; dx <= RIM_WIDTH; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (data[(ny * width + nx) * 4 + 3] >= 8) continue;
          rim[p] = 1;
          break;
        }
      }
    }
  }
  return rim;
}

/**
 * Repaint the rim with the colour of the coat just behind it. Rim pixels carry
 * the plate's black void in their RGB — whatever their alpha — and that is what
 * reads as a black outline. Only pixels clearly darker than their own
 * surroundings are lifted, so a black coat, whose neighbourhood is black too,
 * is left exactly as it is. Alpha is never touched: this cannot drill a hole
 * nor erase black, it only changes the colour of an edge that was wrong.
 */
function repaintDarkRim(data, width, height) {
  const out = Buffer.from(data);
  const rim = rimMask(data, width, height);
  const fixed = new Uint8Array(width * height);

  for (let pass = 0; pass < RIM_PASSES; pass++) {
    const snapshot = Buffer.from(out);
    let repainted = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        if (!rim[p] || fixed[p]) continue;
        const i = p * 4;

        let sr = 0;
        let sg = 0;
        let sb = 0;
        let n = 0;
        for (let dy = -RIM_DONOR_RADIUS; dy <= RIM_DONOR_RADIUS; dy++) {
          for (let dx = -RIM_DONOR_RADIUS; dx <= RIM_DONOR_RADIUS; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const np = ny * width + nx;
            const isDonor =
              fixed[np] || (!rim[np] && snapshot[np * 4 + 3] >= 250);
            if (!isDonor) continue;
            const j = np * 4;
            sr += snapshot[j];
            sg += snapshot[j + 1];
            sb += snapshot[j + 2];
            n++;
          }
        }
        if (n === 0) continue;

        const refR = Math.round(sr / n);
        const refG = Math.round(sg / n);
        const refB = Math.round(sb / n);
        const gap =
          luma(refR, refG, refB) -
          luma(snapshot[i], snapshot[i + 1], snapshot[i + 2]);
        if (gap <= RIM_DARK_MARGIN) continue;

        out[i] = refR;
        out[i + 1] = refG;
        out[i + 2] = refB;
        fixed[p] = 1;
        repainted++;
      }
    }
    if (repainted === 0) break;
  }
  return out;
}

/** Spread coat RGB into transparent pixels so later downscales do not pull black. */
function dilateRgbIntoTransparent(data, width, height, radius = 2) {
  const out = Buffer.from(data);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] >= 8) continue;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let n = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const j = (ny * width + nx) * 4;
          if (data[j + 3] < 8) continue;
          sr += data[j];
          sg += data[j + 1];
          sb += data[j + 2];
          n++;
        }
      }
      if (n === 0) continue;
      out[i] = Math.round(sr / n);
      out[i + 1] = Math.round(sg / n);
      out[i + 2] = Math.round(sb / n);
    }
  }
  return out;
}

/** Depth, per pass, at which the morph silhouette is re-checked against the plate. */
const MATTE_BAND = 4;
/**
 * Passes of the peel. The tail blob is the deepest case, so the peel needs to
 * reach well inside it; it converges on its own once nothing more opens.
 */
const MATTE_PASSES = 12;
/** Neighbourhood used to estimate the local "fully covered" colour. */
const MATTE_REF_RADIUS = 6;
/**
 * Minimum reference luma for the coverage estimate. A jet-black coat sits below
 * it, so its silhouette is left alone; mane and tail hair sit above it.
 */
const MATTE_MIN_REF = 20;
/** Low percentile: a shadow in the core must not read as half covered. */
const MATTE_CORE_PERCENTILE = 0.25;
/** Minimum core samples before the reference is trusted. */
const MATTE_MIN_CORE_SAMPLES = 8;

/**
 * Local "fully covered" colour for a band pixel: the solid-core pixel sitting
 * at a low percentile of luma. Low on purpose — next to a dark tail the bright
 * rump must not become the reference, or the tail would read as barely covered.
 * The whole pixel is returned, not just its luma, because a partially covered
 * pixel has to be *repainted* with that colour: the plate stores it as #000, so
 * no multiplicative gain could ever bring its own colour back.
 * Returns null when there is not enough core to decide.
 */
function referenceCore(rgb, dist, width, height, p) {
  const x0 = p % width;
  const y0 = (p / width) | 0;
  const lumas = [];
  const offsets = [];

  for (let dy = -MATTE_REF_RADIUS; dy <= MATTE_REF_RADIUS; dy++) {
    for (let dx = -MATTE_REF_RADIUS; dx <= MATTE_REF_RADIUS; dx++) {
      const nx = x0 + dx;
      const ny = y0 + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const np = ny * width + nx;
      if (dist[np] <= MATTE_BAND) continue;
      const j = np * 3;
      lumas.push(luma(rgb[j], rgb[j + 1], rgb[j + 2]));
      offsets.push(j);
    }
  }

  if (lumas.length < MATTE_MIN_CORE_SAMPLES) return null;
  const sorted = [...lumas].sort((a, b) => a - b);
  const target =
    sorted[Math.floor(MATTE_CORE_PERCENTILE * (sorted.length - 1))];

  let best = 0;
  let bestGap = Infinity;
  for (let k = 0; k < lumas.length; k++) {
    const gap = Math.abs(lumas[k] - target);
    if (gap >= bestGap) continue;
    bestGap = gap;
    best = offsets[k];
  }

  return {
    luma: target,
    r: rgb[best],
    g: rgb[best + 1],
    b: rgb[best + 2],
  };
}

/** Fraction of the darkest coat tone still considered pure void. */
const MATTE_VOID_RATIO = 0.4;
/** Percentile defining "the darkest tone the coat really contains". */
const MATTE_VOID_PERCENTILE = 0.01;
/** Hard ceiling, so a very pale coat cannot start eating its own shadows. */
const MATTE_VOID_CEILING = 24;

/**
 * Luma below which a pixel cannot belong to this coat, so the flood may cross
 * it even deep inside the silhouette. Derived from the plate itself: a black
 * coat reaches #000 and gets 0 (no crossing at all), a cream coat gets ~17.
 */
function coatVoidCeiling(rgb, alpha, width, height) {
  const bg = floodExterior(alpha, rgb, width, height, 0);
  const dist = distanceToBackground(bg, width, height, MATTE_BAND + 1);
  const core = [];
  for (let p = 0; p < width * height; p++) {
    if (dist[p] <= MATTE_BAND) continue;
    const j = p * 3;
    core.push(luma(rgb[j], rgb[j + 1], rgb[j + 2]));
  }
  if (core.length === 0) return 0;
  core.sort((a, b) => a - b);
  const darkest = core[Math.floor(MATTE_VOID_PERCENTILE * (core.length - 1))];
  return Math.min(MATTE_VOID_CEILING, Math.floor(darkest * MATTE_VOID_RATIO));
}

/**
 * One peel pass: along the current cutout the plate reads as `hair × k` over
 * black, so coverage `k` is the pixel luma relative to the local coat colour.
 * Void drops to k=0, dark mane keeps k≈1. Alpha can only decrease, and only
 * inside the band, which is why the coat interior never gains a hole.
 */
function peelPass(
  rgb,
  morphAlpha,
  work,
  paint,
  painted,
  width,
  height,
  voidMax,
) {
  const bg = floodExterior(work, rgb, width, height, voidMax);
  const dist = distanceToBackground(bg, width, height, MATTE_BAND + 1);
  let opened = 0;

  for (let p = 0; p < width * height; p++) {
    if (work[p] === 0) continue;
    if (bg[p]) {
      work[p] = 0;
      opened++;
      continue;
    }
    if (dist[p] === 0 || dist[p] > MATTE_BAND) continue;

    const ref = referenceCore(rgb, dist, width, height, p);
    if (ref === null || ref.luma < MATTE_MIN_REF) continue;

    const j = p * 3;
    const coverage = Math.min(
      1,
      luma(rgb[j], rgb[j + 1], rgb[j + 2]) / ref.luma,
    );
    const next = clampByte(morphAlpha[p] * coverage);
    if (next >= work[p]) continue;
    work[p] = next;
    paint[j] = ref.r;
    paint[j + 1] = ref.g;
    paint[j + 2] = ref.b;
    painted[p] = 1;
    opened++;
  }
  return opened;
}

/**
 * Cut the photoreal plate out of its black void. The morph silhouette is a
 * coarse blob — around the tail it even bridges the gap to the rump — so the
 * matte is peeled inwards pass after pass: each pass re-floods the void that
 * the previous one opened between the hair strands, and stops on anything that
 * is as bright as its own surroundings. Partially covered pixels are repainted
 * with their local coat colour, since their own colour is gone from the plate.
 */
function maskPhotorealCoat(rgb, alpha, width, height) {
  const voidMax = coatVoidCeiling(rgb.data, alpha, width, height);
  const work = Uint8Array.from(alpha);
  const paint = new Uint8Array(width * height * 3);
  const painted = new Uint8Array(width * height);

  for (let pass = 0; pass < MATTE_PASSES; pass++) {
    const opened = peelPass(
      rgb.data,
      alpha,
      work,
      paint,
      painted,
      width,
      height,
      voidMax,
    );
    if (opened === 0) break;
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    const j = p * 3;
    const source = painted[p] && work[p] > 0 ? paint : rgb.data;
    rgba[i] = source[j];
    rgba[i + 1] = source[j + 1];
    rgba[i + 2] = source[j + 2];
    rgba[i + 3] = work[p];
  }

  return cleanLayerRgba(rgba, width, height);
}

/** @type {Map<string, Promise<string>>} */
const layerCache = new Map();

function scaleLayer(layer) {
  const key = `${layer.layerId}:${layer.optionId}`;
  const cached = layerCache.get(key);
  if (cached) return cached;

  const pending = (async () => {
    const dest = path.join(
      LAYER_CACHE,
      `${layer.layerId}-${layer.optionId}.png`,
    );
    await mkdir(path.dirname(dest), { recursive: true });
    const photo = photorealPath(layer.layerId, layer.optionId);

    if (photo && (await exists(photo))) {
      const alpha = await silhouetteAlpha(layer.assetPath);
      const rgb = await sharp(photo)
        .resize(SIZE, SIZE, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
          kernel: 'mitchell',
        })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const rgba = maskPhotorealCoat(rgb, alpha, SIZE, SIZE);
      await sharp(rgba, {
        raw: { width: SIZE, height: SIZE, channels: 4 },
      })
        .png()
        .toFile(dest);
    } else {
      const { data, info } = await sharp(layer.assetPath)
        .ensureAlpha()
        .resize(SIZE, SIZE, { kernel: 'lanczos3' })
        .raw()
        .toBuffer({ resolveWithObject: true });
      const cleaned = cleanLayerRgba(data, info.width, info.height);
      await sharp(cleaned, {
        raw: { width: info.width, height: info.height, channels: 4 },
      })
        .png()
        .toFile(dest);
    }

    return dest;
  })();

  layerCache.set(key, pending);
  return pending;
}

async function mapPool(items, concurrency, mapper) {
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await mapper(items[i], i);
      }
    }),
  );
  return results;
}

async function bakeJob(engine, renderer, plugin, job, out) {
  const plan = engine.plan(plugin, job.selection);
  const srcW = plan.canvas.width || SIZE;
  const srcH = plan.canvas.height || SIZE;
  const layers = [];

  for (const layer of plan.layers) {
    const assetPath = await scaleLayer(layer);
    layers.push({
      ...layer,
      assetPath,
      offset: {
        x: Math.round(layer.offset.x * (SIZE / srcW)),
        y: Math.round(layer.offset.y * (SIZE / srcH)),
      },
    });
  }

  const scaledPlan = {
    ...plan,
    canvas: {
      ...plan.canvas,
      width: SIZE,
      height: SIZE,
      background: '#00000000',
    },
    layers,
  };

  const pngBytes = await renderer.render(toRenderRequest(scaledPlan, 'png'));
  const pngPath = path.join(out, `${job.name}.png`);
  const webpPath = path.join(out, `${job.name}.webp`);
  const thumbPngPath = path.join(out, `${job.name}.thumbnail.png`);
  const thumbWebpPath = path.join(out, `${job.name}.thumbnail.webp`);
  const jsonPath = path.join(out, `${job.name}.json`);

  await writeFile(pngPath, pngBytes);
  await sharp(pngBytes).webp({ alphaQuality: 100 }).toFile(webpPath);
  await sharp(pngBytes)
    .resize(THUMB, THUMB, { fit: 'inside', kernel: 'lanczos3' })
    .png()
    .toFile(thumbPngPath);
  await sharp(pngBytes)
    .resize(THUMB, THUMB, { fit: 'inside', kernel: 'lanczos3' })
    .webp({ alphaQuality: 100 })
    .toFile(thumbWebpPath);

  const artifacts = [
    {
      kind: 'image',
      format: 'png',
      filePath: pngPath,
      byteLength: pngBytes.byteLength,
    },
    { kind: 'image', format: 'webp', filePath: webpPath, byteLength: 0 },
    { kind: 'thumbnail', format: 'png', filePath: thumbPngPath, byteLength: 0 },
    {
      kind: 'thumbnail',
      format: 'webp',
      filePath: thumbWebpPath,
      byteLength: 0,
    },
  ];
  const meta = buildAssetMetadata(scaledPlan, artifacts);
  await writeFile(jsonPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
}

async function verifyPalomino(out) {
  const file = path.join(out, `${PALOMINO_CHECK}.png`);
  const img = sharp(file);
  const meta = await img.metadata();
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const corners = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
  ].map(([x, y]) => data[(y * w + x) * 4 + 3]);

  if (meta.format !== 'png') {
    throw new Error(`Palomino check: expected png, got ${meta.format}`);
  }
  if (meta.hasAlpha !== true) {
    throw new Error('Palomino check: missing alpha channel');
  }
  if (w !== SIZE || h !== SIZE) {
    throw new Error(`Palomino check: size ${w}x${h}, expected ${SIZE}x${SIZE}`);
  }
  if (corners.some((a) => a !== 0)) {
    throw new Error(`Palomino check: opaque corners ${corners.join(',')}`);
  }

  const [ex, ey] = ADULT_EYE_1024;
  const crop = { left: ex - 20, top: ey - 14, width: 40, height: 28 };
  await mkdir(VERIFY_DIR, { recursive: true });
  const cropPath = path.join(VERIFY_DIR, 'palomino-eye-200pct.png');
  await sharp(file)
    .extract(crop)
    .resize(crop.width * 2, crop.height * 2, { kernel: 'nearest' })
    .png()
    .toFile(cropPath);

  console.log('Palomino check OK');
  console.log(`  ${path.relative(ROOT, file)} ${w}x${h} png alpha`);
  console.log(`  corners alpha ${corners.join(',')}`);
  console.log(`  eye crop ${path.relative(ROOT, cropPath)}`);
}

async function main() {
  const { dryRun, force, out, only } = parseArgs(process.argv.slice(2));
  let jobs = buildJobs();
  if (only) {
    jobs = jobs.filter((job) => job.name === only);
    if (jobs.length === 0) {
      throw new Error(`No job named "${only}"`);
    }
  }

  console.log('Stalloria horse bake 1024 (transparent)');
  console.log(`  plugin       ${path.relative(ROOT, PLUGIN_DIR)}`);
  console.log(`  out          ${path.relative(ROOT, out)}`);
  console.log(`  planned      ${jobs.length}`);
  console.log(`  concurrency  ${CONCURRENCY}`);
  console.log(
    `  axes         body(2) × coat(${COATS.length}) × pie(none|tobiano) × markings(none+${MARKINGS.length})`,
  );

  if (dryRun) {
    for (const job of jobs) {
      console.log(`  · ${job.name}`);
    }
    console.log(`Dry-run: ${jobs.length} variants (nothing written)`);
    return;
  }

  const engine = new KlairoxEngine({ renderer: new SharpRenderer() });
  const renderer = new SharpRenderer();
  const plugin = await engine.loadPlugin(PLUGIN_DIR);
  await mkdir(out, { recursive: true });
  await mkdir(LAYER_CACHE, { recursive: true });

  let generated = 0;
  let skipped = 0;
  let failed = 0;
  const failures = [];

  await mapPool(jobs, CONCURRENCY, async (job) => {
    try {
      if (!force && (await alreadyBaked1024(out, job.name))) {
        skipped += 1;
        return;
      }
      await bakeJob(engine, renderer, plugin, job, out);
      generated += 1;
      const done = generated + skipped + failed;
      if (done % 10 === 0 || done === jobs.length) {
        console.log(
          `  … ${done}/${jobs.length} (${generated} wrote, ${skipped} skip)`,
        );
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ name: job.name, message });
      console.error(`  ✗ ${job.name}: ${message}`);
    }
  });

  if (jobs.some((job) => job.name === PALOMINO_CHECK) && failed === 0) {
    await verifyPalomino(out);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    canvas: { width: SIZE, height: SIZE, background: '#00000000' },
    count: generated,
    skipped,
    failed,
    matrix: {
      body: ['standard', 'foal'],
      coat: COATS,
      pie: ['none', 'tobiano'],
      markings: ['none', ...MARKINGS],
    },
    failures,
  };
  await writeFile(
    path.join(out, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  console.log(
    `Done: ${generated} generated, ${skipped} skipped, ${failed} failed → ${path.relative(ROOT, out)}`,
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
