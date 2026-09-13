/**
 * Re-exports photoreal coat plates as true RGBA PNGs.
 *
 * Opaque studio plates (black void, no alpha) are backed up once as
 * `*-photoreal-src.opaque.png`, then replaced by a matted RGBA version so
 * Stalloria / the editor can compose without rediscovering the cutout.
 *
 * Usage:
 *   node tools/reexport-photoreal-alpha.mjs
 *   node tools/reexport-photoreal-alpha.mjs --dry-run
 *   node tools/reexport-photoreal-alpha.mjs --only foal/bay-brun
 */
import { access, copyFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 1024;

const JOBS = [
  {
    build: 'standard',
    sourceDir: path.join(ROOT, 'docs/images/horse-source'),
    pluginDir: path.join(ROOT, 'plugins/horse/layers/coat'),
  },
  {
    build: 'foal',
    sourceDir: path.join(ROOT, 'docs/images/horse-source/foal'),
    pluginDir: path.join(ROOT, 'plugins/horse/layers/coat-foal'),
  },
];

function parseArgs(argv) {
  let dryRun = false;
  let only = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') dryRun = true;
    if (argv[i] === '--only') only = argv[++i] ?? null;
  }
  return { dryRun, only };
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

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

const MATTE_BAND = 4;
const MATTE_PASSES = 12;
const MATTE_REF_RADIUS = 6;
const MATTE_MIN_REF = 20;
const MATTE_CORE_PERCENTILE = 0.25;
const MATTE_MIN_CORE_SAMPLES = 8;
const MATTE_VOID_RATIO = 0.4;
const MATTE_VOID_PERCENTILE = 0.01;
const MATTE_VOID_CEILING = 24;
const RIM_WIDTH = 2;
const RIM_DONOR_RADIUS = 4;
const RIM_DARK_MARGIN = 8;
const RIM_PASSES = 3;

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

function cleanLayerRgba(data, width, height) {
  return dilateRgbIntoTransparent(
    repaintDarkRim(despeckleMatte(data, width, height), width, height),
    width,
    height,
    2,
  );
}

function maskPhotorealCoat(rgb, alpha, width, height) {
  const voidMax = coatVoidCeiling(rgb, alpha, width, height);
  const work = Uint8Array.from(alpha);
  const paint = new Uint8Array(width * height * 3);
  const painted = new Uint8Array(width * height);

  for (let pass = 0; pass < MATTE_PASSES; pass++) {
    const opened = peelPass(
      rgb,
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
    const source = painted[p] && work[p] > 0 ? paint : rgb;
    rgba[i] = source[j];
    rgba[i + 1] = source[j + 1];
    rgba[i + 2] = source[j + 2];
    rgba[i + 3] = work[p];
  }

  return cleanLayerRgba(rgba, width, height);
}

async function listCoats(pluginDir) {
  const files = await readdir(pluginDir);
  return files
    .filter((f) => f.endsWith('.png'))
    .map((f) => f.replace(/\.png$/i, ''))
    .sort();
}

async function reexportOne(build, sourceDir, pluginDir, coat, dryRun) {
  const src = path.join(sourceDir, `coat-${coat}-photoreal-src.png`);
  const morph = path.join(pluginDir, `${coat}.png`);
  const backup = path.join(sourceDir, `coat-${coat}-photoreal-src.opaque.png`);

  if (!(await exists(src))) {
    console.log(`  skip ${build}/${coat} (no source)`);
    return { coat, skipped: true };
  }
  if (!(await exists(morph))) {
    console.log(`  skip ${build}/${coat} (no morph ${morph})`);
    return { coat, skipped: true };
  }

  const meta = await sharp(src).metadata();
  if (meta.hasAlpha && (await exists(backup))) {
    console.log(`  skip ${build}/${coat} (already RGBA with backup)`);
    return { coat, skipped: true, already: true };
  }

  if (dryRun) {
    console.log(
      `  would matte ${build}/${coat} (${meta.width}x${meta.height})`,
    );
    return { coat, dryRun: true };
  }

  if (!meta.hasAlpha && !(await exists(backup))) {
    await copyFile(src, backup);
  }

  const opaquePath = (await exists(backup)) ? backup : src;
  const rgb = await sharp(opaquePath)
    .resize(SIZE, SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: 'mitchell',
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const alpha = await sharp(morph)
    .resize(SIZE, SIZE, { kernel: 'lanczos3' })
    .ensureAlpha()
    .extractChannel('alpha')
    .raw()
    .toBuffer();

  const rgba = maskPhotorealCoat(rgb.data, alpha, SIZE, SIZE);
  let opaque = 0;
  for (let p = 0; p < SIZE * SIZE; p++) {
    if (rgba[p * 4 + 3] > 16) opaque++;
  }

  await sharp(rgba, { raw: { width: SIZE, height: SIZE, channels: 4 } })
    .png()
    .toFile(src);

  console.log(
    `  wrote ${build}/${coat} coverage=${((100 * opaque) / (SIZE * SIZE)).toFixed(1)}%`,
  );
  return { coat, coverage: opaque / (SIZE * SIZE) };
}

async function main() {
  const { dryRun, only } = parseArgs(process.argv.slice(2));
  console.log(`Re-export photoreal coats → RGBA${dryRun ? ' (dry-run)' : ''}`);

  for (const job of JOBS) {
    const coats = await listCoats(job.pluginDir);
    console.log(`\n${job.build} (${coats.length} coats)`);
    for (const coat of coats) {
      const key = `${job.build === 'foal' ? 'foal/' : ''}${coat}`;
      if (only && only !== key && only !== coat) continue;
      await reexportOne(job.build, job.sourceDir, job.pluginDir, coat, dryRun);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
