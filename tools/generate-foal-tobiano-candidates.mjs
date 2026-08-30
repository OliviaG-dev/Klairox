/**
 * Paints the foal tobiano overlay onto the bay coat master, then extracts
 * the pie layer. White uses this photo's own light and shadow.
 *
 * Usage:
 *   node tools/generate-foal-tobiano-candidates.mjs
 */
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 512;
const WORK = 1024;

const VARIANTS = [
  { id: '01-classic', seed: 11, warp: 0.018, sock: 0, neck: 0, rump: 0, chest: 0, barrel: 0 },
];

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function chroma(r, g, b) {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function clamp(v, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

function eraseElbowStick(field, width, height) {
  const scale = width / SIZE;
  const x0 = Math.round(115 * scale);
  const x1 = Math.round(230 * scale);
  const y0 = Math.round(235 * scale);
  const y1 = Math.round(388 * scale);
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y < y1; y++) {
      field[y * width + x] = 0;
    }
  }
}

function clampByte(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function hash(ix, iy, seed) {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + seed * 1274126177;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0, seed);
  const b = hash(x0 + 1, y0, seed);
  const c = hash(x0, y0 + 1, seed);
  const d = hash(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x, y, seed, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 19);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function silhouetteBbox(data, width, height) {
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= 16) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY, bw: maxX - minX + 1, bh: maxY - minY + 1 };
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

function defringeSilhouette(overlay, morph, width, height, edgePx = 2) {
  const out = Buffer.from(overlay);
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
  return out;
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

function ellipse(nx, ny, cx, cy, rx, ry) {
  const dx = (nx - cx) / rx;
  const dy = (ny - cy) / ry;
  return Math.sqrt(dx * dx + dy * dy);
}

function blob(nx, ny, cx, cy, rx, ry, inner = 0.62) {
  const d = ellipse(nx, ny, cx, cy, rx, ry);
  return 1 - smoothstep(inner, 1, d);
}

function wobbleBlob(nx, ny, cx, cy, rx, ry, inner, seed, amt = 0.3) {
  const dx = (nx - cx) / rx;
  const dy = (ny - cy) / ry;
  const ang = Math.atan2(dy, dx);
  const wobble =
    1 +
    (fbm(Math.cos(ang) * 3.4, Math.sin(ang) * 3.4, seed) - 0.5) * amt +
    (fbm(Math.cos(ang) * 8, Math.sin(ang) * 8, seed + 13) - 0.5) * amt * 0.4;
  const d = Math.hypot(dx, dy) / wobble;
  return 1 - smoothstep(inner, 1, d);
}

function growFoalMane(field, bay, morph, width, height) {
  const scale = width / SIZE;
  const x0 = Math.round(148 * scale);
  const x1 = Math.round(255 * scale);
  const y0 = Math.round(40 * scale);
  const y1 = Math.round(165 * scale);
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
      if (morph[i + 3] < 16 || bay[i + 3] < 16) continue;
      if (y < 88 * scale && x < 165 * scale) continue;
      const L = luma(bay[i], bay[i + 1], bay[i + 2]);
      const C = chroma(bay[i], bay[i + 1], bay[i + 2]);
      if (L < 72 && C < 38) field[p] = 1;
    }
  }
}

/** Tobiano on the foal bbox: dark head, white over the back, white legs, dark tail. */
function foalTobiano(nx, ny, n, n2, variant) {
  const p = {
    x: nx + (n - 0.5) * variant.warp * 2,
    y: ny + (n2 - 0.5) * variant.warp * 2,
  };
  let v = 0;
  v = Math.max(v, blob(p.x, p.y, 0.3, 0.24, 0.14, 0.14, 0.48));
  v = Math.max(v, blob(p.x, p.y, 0.26, 0.22, 0.12, 0.13, 0.46));
  const backGap = blob(
    nx + (n2 - 0.5) * 0.03,
    ny + (n - 0.5) * 0.02,
    0.54,
    0.26,
    0.13,
    0.22,
    0.16,
  );
  v *= 1 - backGap * 0.99;
  v = Math.max(v, blob(nx, ny, 0.12, 0.91, 0.09, 0.09, 0.42));
  if (variant.neck > 0) {
    v = Math.max(v, blob(p.x, p.y, 0.3, 0.2, 0.16, 0.14, 0.48) * variant.neck * 7);
  }
  if (variant.rump > 0) {
    v = Math.max(v, blob(p.x, p.y, 0.78, 0.28, 0.16, 0.12, 0.48) * variant.rump * 7);
  }
  if (variant.barrel > 0) {
    v = Math.max(v, blob(p.x, p.y, 0.52, 0.34, 0.22, 0.12, 0.46) * variant.barrel * 7);
  }
  if (variant.barrel < 0) {
    v *= 1 - blob(nx, ny, 0.5, 0.38, 0.12, 0.1, 0.4) * Math.abs(variant.barrel) * 5;
  }
  v *= 1 - blob(nx, ny, 0.22, 0.4, 0.15, 0.13, 0.4) * (0.88 + variant.chest * 3);
  v *= 1 - blob(nx, ny, 0.7, 0.42, 0.12, 0.1, 0.4) * 0.72;
  v = Math.max(v, blob(p.x, p.y, 0.23, 0.36, 0.11, 0.12, 0.4));
  v = Math.max(v, wobbleBlob(nx, ny, 0.8, 0.23, 0.22, 0.075, 0.36, 73, 0.38));
  v = Math.max(v, wobbleBlob(nx, ny, 0.75, 0.35, 0.09, 0.16, 0.34, 81, 0.42));
  v = Math.max(v, wobbleBlob(nx, ny, 0.89, 0.26, 0.09, 0.07, 0.4, 97, 0.35));
  v = Math.max(v, wobbleBlob(nx, ny, 0.67, 0.25, 0.08, 0.075, 0.4, 103, 0.35));
  v = Math.max(v, blob(p.x, p.y, 0.54, 0.53, 0.17, 0.13, 0.34));
  v = Math.max(v, blob(p.x, p.y, 0.5, 0.45, 0.1, 0.09, 0.38));
  v = Math.max(v, blob(p.x, p.y, 0.47, 0.38, 0.072, 0.07, 0.4));
  v = Math.max(v, blob(p.x, p.y, 0.46, 0.33, 0.052, 0.055, 0.42));
  v = Math.max(v, blob(p.x, p.y, 0.47, 0.29, 0.042, 0.05, 0.4));
  if (nx < 0.24 && ny < 0.36) {
    v *= smoothstep(0.18, 0.3, nx) * smoothstep(0.3, 0.42, ny);
  }
  if (nx > 0.86 && ny > 0.34 && ny < 0.64) {
    v *= 1 - smoothstep(0.86, 0.94, nx);
  }
  v *= 0.88 + n * 0.22;
  v += (n2 - 0.5) * 0.07;
  return clamp(v);
}

async function loadRaw(file, size) {
  return sharp(file).ensureAlpha().resize(size, size, { kernel: 'mitchell' }).raw().toBuffer({
    resolveWithObject: true,
  });
}

function hoofMask(bay, width, height) {
  const mask = new Float32Array(width * height);
  const colBot = new Int16Array(width).fill(-1);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if (bay[(y * width + x) * 4 + 3] >= 16) colBot[x] = y;
    }
  }
  const hoofH = 18 * (width / SIZE);
  for (let x = 0; x < width; x++) {
    const bot = colBot[x];
    if (bot < height * 0.72) continue;
    for (let y = Math.max(0, Math.round(bot - hoofH)); y <= bot; y++) {
      if (bay[(y * width + x) * 4 + 3] < 16) continue;
      mask[y * width + x] = 1 - smoothstep(hoofH * 0.28, hoofH, bot - y);
    }
  }
  return mask;
}

function paintOverlay(soft, palomino, bay, morph, width, height) {
  const palLuma = new Float32Array(width * height);
  const bayLuma = new Float32Array(width * height);
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    palLuma[p] = luma(palomino[i], palomino[i + 1], palomino[i + 2]) / 255;
    bayLuma[p] = luma(bay[i], bay[i + 1], bay[i + 2]) / 255;
  }
  const palForm = blurCoverage(palLuma, width, height, 7);
  const bayForm = blurCoverage(bayLuma, width, height, 7);
  const hoof = hoofMask(bay, width, height);
  const out = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    const cov = soft[p];
    if (cov < 0.06 || morph[i + 3] < 16 || bay[i + 3] < 16) continue;
    const palN = clamp((palForm[p] - 0.12) / 0.78);
    const bayN = clamp((bayForm[p] - 0.06) / 0.55);
    let L = palN * 0.62 + bayN * 0.38;
    L = clamp(L + (palLuma[p] - palForm[p]) * 1.15 + (bayLuma[p] - bayForm[p]) * 0.9);
    const t =
      L < 0.5
        ? 0.5 * Math.pow(L * 2, 1.5)
        : 1 - 0.5 * Math.pow((1 - L) * 2, 1.15);
    let r = 122 + t * 133;
    let g = 120 + t * 134;
    let b = 114 + t * 138;
    const h = hoof[p];
    if (h > 0.02) {
      const grain = (palLuma[p] - palForm[p]) * 36;
      const hornR = 206 + t * 42 + grain;
      const hornG = 158 + t * 52 + grain * 0.85;
      const hornB = 142 + t * 48 + grain * 0.7;
      r = r * (1 - h) + hornR * h;
      g = g * (1 - h) + hornG * h;
      b = b * (1 - h) + hornB * h;
    }
    out[i] = clampByte(r);
    out[i + 1] = clampByte(g);
    out[i + 2] = clampByte(b);
    out[i + 3] = Math.min(bay[i + 3], morph[i + 3], clampByte(255 * cov));
  }
  return out;
}

async function compositeOnBay(overlay, bayPath, dest) {
  const overlayRaw = await sharp(overlay)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bay = await sharp(bayPath).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  const { width, height } = overlayRaw.info;
  const out = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    const a = overlayRaw.data[i + 3] / 255;
    out[i] = clampByte(bay.data[i] * (1 - a) + overlayRaw.data[i] * a);
    out[i + 1] = clampByte(bay.data[i + 1] * (1 - a) + overlayRaw.data[i + 1] * a);
    out[i + 2] = clampByte(bay.data[i + 2] * (1 - a) + overlayRaw.data[i + 2] * a);
    out[i + 3] = 255;
  }
  await sharp(out, { raw: { width, height, channels: 4 } }).png().toFile(dest);
}

async function main() {
  const bayMaster = path.join(ROOT, 'docs/images/horse-base/foal/coat-master-bay.png');
  const foalMorph = await loadRaw(
    path.join(ROOT, 'docs/images/horse-base/foal/morphology-master.png'),
    WORK,
  );
  const foalPal = await loadRaw(
    path.join(ROOT, 'plugins/horse/layers/coat-foal/palomino.png'),
    WORK,
  );
  const foalBay = await loadRaw(bayMaster, WORK);
  const { width, height } = foalMorph.info;
  const foalBox = silhouetteBbox(foalBay.data, width, height);
  const colTop = new Int16Array(width).fill(-1);
  const colBot = new Int16Array(width).fill(-1);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if (foalBay.data[(y * width + x) * 4 + 3] < 16) continue;
      if (colTop[x] < 0) colTop[x] = y;
      colBot[x] = y;
    }
  }
  const outDir = path.join(ROOT, 'docs/images/horse-base/foal/pie');
  await mkdir(outDir, { recursive: true });

  for (const variant of VARIANTS) {
    let field = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (foalBay.data[i + 3] < 16) continue;
        const nx = (x - foalBox.minX) / foalBox.bw;
        const ny = (y - foalBox.minY) / foalBox.bh;
        const n = fbm(nx * 6.5, ny * 6.5, variant.seed);
        const n2 = fbm(nx * 13, ny * 13, variant.seed + 17);
        let v = foalTobiano(nx, ny, n, n2, variant);
        const top = colTop[x];
        const bot = colBot[x];
        const scale = width / SIZE;
        if (bot > top && bot > height * 0.7) {
          const along = (y - top) / (bot - top);
          const nSock = fbm(nx * 10, ny * 7, 44);
          const sockStart = 0.58 - variant.sock + (nSock - 0.5) * 0.04;
          const leftFore = x >= 90 * scale && x <= 175 * scale;
          const elbowStick = x >= 185 * scale && x <= 230 * scale;
          if (leftFore) {
            if (y > 390 * scale) {
              v = Math.max(v, 1);
            }
          } else if (elbowStick) {
            if (y > 400 * scale) {
              v = Math.max(v, 1);
            }
          } else if (along > sockStart) {
            v = Math.max(v, smoothstep(sockStart, sockStart + 0.12, along));
          }
        }
        const rightFore = x >= 196 * scale && x <= 248 * scale;
        if (rightFore && bot > top) {
          const along = (y - top) / (bot - top);
          if (along < 0.56) {
            v *= smoothstep(0.56, 0.46, along);
          }
        }
        field[y * width + x] = v;
      }
    }

    eraseElbowStick(field, width, height);
    growFoalMane(field, foalBay.data, foalMorph.data, width, height);
    field = blurCoverage(field, width, height, 4);

    let binary = new Float32Array(width * height);
    for (let p = 0; p < field.length; p++) {
      binary[p] = field[p] > 0.38 ? 1 : 0;
    }
    binary = erodeBinary(dilateBinary(binary, width, height, 5), width, height, 4);
    binary = dilateBinary(erodeBinary(binary, width, height, 6), width, height, 6);
    const rounded = blurCoverage(binary, width, height, 16);
    for (let p = 0; p < binary.length; p++) {
      binary[p] = rounded[p] > 0.48 ? 1 : 0;
    }
    eraseElbowStick(binary, width, height);
    const soft = blurCoverage(binary, width, height, 8);

    const painted = paintOverlay(
      soft,
      foalPal.data,
      foalBay.data,
      foalMorph.data,
      width,
      height,
    );
    const defringed = defringeSilhouette(painted, foalMorph.data, width, height, 1);
    const { data: downRaw } = await sharp(defringed, {
      raw: { width, height, channels: 4 },
    })
      .resize(SIZE, SIZE, { kernel: 'mitchell' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const smooth = featherAlpha(downRaw, SIZE, SIZE, 1);

    const overlayPath = path.join(outDir, `tobiano-${variant.id}.png`);
    const previewPath = path.join(outDir, `tobiano-${variant.id}-on-bay.png`);
    await sharp(smooth, { raw: { width: SIZE, height: SIZE, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toFile(overlayPath);
    await compositeOnBay(overlayPath, bayMaster, previewPath);
    console.log('wrote', path.relative(ROOT, overlayPath));
  }

  const classic = path.join(outDir, 'tobiano-01-classic.png');
  const plugin = path.join(ROOT, 'plugins/horse/layers/pie-foal/tobiano.png');
  await sharp(classic).png().toFile(plugin);
  console.log('wrote', path.relative(ROOT, plugin));

  const sync = spawnSync(process.execPath, [path.join(ROOT, 'tools/sync-editor-horse-plugin.mjs')], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (sync.status !== 0) {
    throw new Error('editor plugin sync failed');
  }
}

await main();
