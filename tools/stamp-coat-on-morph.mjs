/**
 * Stamps a generated coat onto the shared morphology alpha so the silhouette
 * stays pixel-identical while keeping the photoreal RGB.
 *
 * Smooth at 1024 with an edge-preserving filter, then Mitchell-downscale
 * to 512 so grain drops without a gaussian melt.
 *
 * Usage:
 *   node tools/stamp-coat-on-morph.mjs <generated.png> <out-name>
 *   node tools/stamp-coat-on-morph.mjs <generated.png> <out-name> --build foal
 *
 * Rebuild the foal silhouette (legs/tail) before stamping:
 *   node tools/extract-foal-morph.mjs
 */
import { access, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 512;
const WORK = 1024;

function parseArgs(argv) {
  let build = 'standard';
  let syncEditor = true;
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--build') {
      build = argv[++i] ?? '';
      continue;
    }
    if (arg === '--no-sync') {
      syncEditor = false;
      continue;
    }
    positional.push(arg);
  }
  if (build !== 'standard' && build !== 'foal') {
    throw new Error('Unknown --build (expected standard or foal)');
  }
  return {
    build,
    syncEditor,
    src: positional[0] ? path.resolve(positional[0]) : '',
    name: positional[1] ?? 'bay',
  };
}

function pathsForBuild(build) {
  if (build === 'foal') {
    return {
      morph: path.join(
        ROOT,
        'docs/images/horse-base/foal/morphology-master.png',
      ),
      master: (name) =>
        path.join(
          ROOT,
          'docs/images/horse-base/foal',
          `coat-master-${name}.png`,
        ),
      plugin: (name) =>
        path.join(ROOT, 'plugins/horse/layers/coat-foal', `${name}.png`),
      archive: (name) =>
        path.join(
          ROOT,
          'docs/images/horse-source/foal',
          `coat-${name}-photoreal-src.png`,
        ),
    };
  }
  return {
    morph: path.join(
      ROOT,
      'docs/images/horse-base/OC-Standard/morphology-master.png',
    ),
    master: (name) =>
      path.join(
        ROOT,
        'docs/images/horse-base/OC-Standard',
        `coat-master-${name}.png`,
      ),
    plugin: (name) =>
      path.join(ROOT, 'plugins/horse/layers/coat', `${name}.png`),
    archive: (name) =>
      path.join(
        ROOT,
        'docs/images/horse-source',
        `coat-${name}-photoreal-src.png`,
      ),
  };
}

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

async function loadCoat(src) {
  return sharp(src)
    .resize(WORK, WORK, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 1 },
      kernel: 'mitchell',
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

async function upscaleMorph(data, width, height) {
  return sharp(data, { raw: { width, height, channels: 4 } })
    .resize(WORK, WORK, { kernel: 'nearest' })
    .raw()
    .toBuffer({ resolveWithObject: true });
}

function smoothCoat(
  data,
  width,
  height,
  { radius = 3, lumaTol = 9, passes = 2 } = {},
) {
  let src = data;
  for (let pass = 0; pass < passes; pass++) {
    const next = Buffer.from(src);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (src[i + 3] < 8) continue;
        const cl = luma(src[i], src[i + 1], src[i + 2]);
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let wsum = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const j = (ny * width + nx) * 4;
            if (src[j + 3] < 8) continue;
            const nl = luma(src[j], src[j + 1], src[j + 2]);
            const dl = Math.abs(nl - cl);
            if (dl > lumaTol) continue;
            const spatial = 1 / (1 + dx * dx + dy * dy);
            const range = 1 - dl / lumaTol;
            const w = spatial * range;
            sr += src[j] * w;
            sg += src[j + 1] * w;
            sb += src[j + 2] * w;
            wsum += w;
          }
        }
        if (wsum > 0) {
          next[i] = Math.round(sr / wsum);
          next[i + 1] = Math.round(sg / wsum);
          next[i + 2] = Math.round(sb / wsum);
        }
      }
    }
    src = next;
  }
  return src;
}

function clampByte(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** Spread coat RGB into transparent pixels so Mitchell downscale does not pull black. */
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

async function unsharpMild(data, width, height) {
  const { data: blur } = await sharp(data, {
    raw: { width, height, channels: 4 },
  })
    .blur(0.55)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = Buffer.from(data);
  const amount = 0.26;
  const lo = 8;
  const hi = 34;
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    if (data[i + 3] < 8) continue;
    const sl = luma(data[i], data[i + 1], data[i + 2]);
    const bl = luma(blur[i], blur[i + 1], blur[i + 2]);
    const d = Math.abs(sl - bl);
    if (d < lo || d > hi) continue;
    const a = amount * (1 - ((d - lo) / (hi - lo)) * 0.35);
    out[i] = clampByte(data[i] + a * (data[i] - blur[i]));
    out[i + 1] = clampByte(data[i + 1] + a * (data[i + 1] - blur[i + 1]));
    out[i + 2] = clampByte(data[i + 2] + a * (data[i + 2] - blur[i + 2]));
  }
  return out;
}

/** Close transparent pockets fully enclosed by the silhouette (groin crack, etc.). */
function fillInteriorHoles(data, width, height) {
  const outside = new Uint8Array(width * height);
  const q = [0];
  outside[0] = 1;
  for (let qi = 0; qi < q.length; qi++) {
    const p = q[qi];
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
      const np = ny * width + nx;
      if (outside[np]) continue;
      if (data[np * 4 + 3] > 16) continue;
      outside[np] = 1;
      q.push(np);
    }
  }

  let filled = 0;
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3] > 16) continue;
        if (outside[y * width + x]) continue;
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const j = ((y + dy) * width + (x + dx)) * 4;
            if (data[j + 3] < 200) continue;
            sr += data[j];
            sg += data[j + 1];
            sb += data[j + 2];
            n++;
          }
        }
        if (n < 3) continue;
        data[i] = Math.round(sr / n);
        data[i + 1] = Math.round(sg / n);
        data[i + 2] = Math.round(sb / n);
        data[i + 3] = 255;
        filled++;
        changed = true;
      }
    }
  }
  return filled;
}

/** Seal the 1–4px crack where the barrel meets the stifle. */
function closeGroinCrack(data, width, height) {
  let filled = 0;
  for (let y = 255; y <= 286; y++) {
    const segs = [];
    let start = -1;
    for (let x = 320; x <= 380; x++) {
      const on = data[(y * width + x) * 4 + 3] > 16;
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        segs.push([start, x - 1]);
        start = -1;
      }
    }
    if (start >= 0) segs.push([start, 380]);
    for (let s = 0; s < segs.length - 1; s++) {
      const gapFrom = segs[s][1] + 1;
      const gapTo = segs[s + 1][0] - 1;
      const gap = gapTo - gapFrom + 1;
      if (gap < 1 || gap > 4) continue;
      const left = (y * width + segs[s][1]) * 4;
      const right = (y * width + segs[s + 1][0]) * 4;
      for (let x = gapFrom; x <= gapTo; x++) {
        const t = (x - gapFrom + 1) / (gap + 1);
        const i = (y * width + x) * 4;
        data[i] = Math.round(data[left] + (data[right] - data[left]) * t);
        data[i + 1] = Math.round(
          data[left + 1] + (data[right + 1] - data[left + 1]) * t,
        );
        data[i + 2] = Math.round(
          data[left + 2] + (data[right + 2] - data[left + 2]) * t,
        );
        data[i + 3] = 255;
        filled++;
      }
    }
  }
  return filled;
}

/** Jet black: crush leftover brown in the body, keep the glossy spec. */
function gradeBlack(data, width, height) {
  const out = Buffer.from(data);
  const bayer = [0, 2, 3, 1];
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    if (data[i + 3] < 8) continue;
    const x = p % width;
    const y = (p / width) | 0;
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    const l = luma(r, g, b);

    const desat = 0.4;
    r = r * (1 - desat) + l * desat;
    g = g * (1 - desat) + l * desat;
    b = b * (1 - desat) + l * desat;
    r *= 0.96;
    g *= 0.98;
    b *= 1.02;

    let k = 1;
    if (l < 60) {
      k = 0.78;
    } else if (l < 95) {
      k = 0.78 + ((l - 60) / 35) * 0.22;
    } else {
      k = 1 + Math.min(0.12, (l - 95) / 500);
    }
    k += (bayer[(y & 1) * 2 + (x & 1)] - 1.5) * 0.004;

    out[i] = clampByte(r * k);
    out[i + 1] = clampByte(g * k);
    out[i + 2] = clampByte(b * k);
  }
  return out;
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
    return;
  }
  const { src, name, build, syncEditor } = parsed;
  const dests = pathsForBuild(build);
  if (!src) {
    console.error(
      'Usage: node tools/stamp-coat-on-morph.mjs <generated.png> <out-name> [--build foal]',
    );
    process.exitCode = 1;
    return;
  }
  try {
    await access(src);
    await access(dests.morph);
  } catch {
    console.error('Missing source or morphology master.');
    process.exitCode = 1;
    return;
  }

  const morph = await sharp(dests.morph).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  const { width, height } = morph.info;
  const healed =
    fillInteriorHoles(morph.data, width, height) +
    (build === 'standard' ? closeGroinCrack(morph.data, width, height) : 0);
  if (healed > 0 && build === 'standard') {
    await sharp(morph.data, { raw: { width, height, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toFile(dests.morph);
    console.log('healed morphology holes', healed);
  }
  const gen = await loadCoat(src);
  const hi = await upscaleMorph(morph.data, width, height);
  const stamped = Buffer.alloc(hi.data.length);
  const hw = hi.info.width;
  const hh = hi.info.height;

  for (let p = 0; p < hw * hh; p++) {
    const i = p * 4;
    const a = hi.data[i + 3];
    if (a < 8) {
      stamped[i] = stamped[i + 1] = stamped[i + 2] = stamped[i + 3] = 0;
      continue;
    }
    let r = gen.data[i];
    let g = gen.data[i + 1];
    let b = gen.data[i + 2];
    if (luma(r, g, b) < 8) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let n = 0;
      const x = p % hw;
      const y = (p / hw) | 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= hw || ny >= hh) continue;
          const j = (ny * hw + nx) * 4;
          if (hi.data[j + 3] < 8) continue;
          const rr = gen.data[j];
          const gg = gen.data[j + 1];
          const bb = gen.data[j + 2];
          if (luma(rr, gg, bb) < 12) continue;
          sr += rr;
          sg += gg;
          sb += bb;
          n++;
        }
      }
      if (n > 0) {
        r = Math.round(sr / n);
        g = Math.round(sg / n);
        b = Math.round(sb / n);
      }
    }
    stamped[i] = r;
    stamped[i + 1] = g;
    stamped[i + 2] = b;
    stamped[i + 3] = a;
  }

  let out = smoothCoat(stamped, hw, hh, {
    radius: 3,
    lumaTol: 10,
    passes: 3,
  });
  if (name === 'black') {
    out = gradeBlack(out, hw, hh);
  }
  out = dilateRgbIntoTransparent(out, hw, hh, 2);
  const { data: down } = await sharp(out, {
    raw: { width: hw, height: hh, channels: 4 },
  })
    .resize(SIZE, SIZE, { kernel: 'mitchell' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  out = await unsharpMild(down, SIZE, SIZE);

  const written = [dests.master(name), dests.plugin(name)];
  for (const dest of written) {
    await mkdir(path.dirname(dest), { recursive: true });
    await sharp(out, { raw: { width: SIZE, height: SIZE, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toFile(dest);
    console.log('wrote', path.relative(ROOT, dest));
  }

  const archive = dests.archive(name);
  if (path.resolve(src) !== path.resolve(archive)) {
    await mkdir(path.dirname(archive), { recursive: true });
    await copyFile(src, archive);
    console.log('archived', path.relative(ROOT, archive));
  }

  if (!syncEditor) {
    return;
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
