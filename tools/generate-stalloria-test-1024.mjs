/**
 * One Stalloria horse at 1024×1024 to check crop/contours without a full bake.
 *
 * standard + bay + mane short, no pie, no marking.
 * Plugin 512 layers are left untouched.
 *
 *   node tools/generate-stalloria-test-1024.mjs
 */
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KlairoxEngine, exportComposition } from '@klairox/core';
import { SharpRenderer } from '@klairox/renderer';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_DIR = path.join(ROOT, 'plugins', 'horse');
const OUT_DIR = path.join(ROOT, 'dist', 'stalloria', 'test');
const LAYER_DIR = path.join(OUT_DIR, '_layers');
const SIZE = 1024;
const NAME = 'stalloria-standard-bay-pie-none-mark-none-1024';
const PHOTO_BAY = path.join(
  ROOT,
  'docs',
  'images',
  'horse-source',
  'coat-bay-photoreal-src.png',
);
const EXISTING_512 = path.join(
  ROOT,
  'dist',
  'stalloria',
  'horses',
  'stalloria-standard-bay-pie-none-mark-none.png',
);

const SELECTION = { body: 'standard', coat: 'bay', mane: 'short' };

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function scaleLayer(layer, dest) {
  await mkdir(path.dirname(dest), { recursive: true });

  if (layer.layerId === 'coat' && (await exists(PHOTO_BAY))) {
    const alphaPng = await sharp(layer.assetPath)
      .resize(SIZE, SIZE, { kernel: 'lanczos3' })
      .ensureAlpha()
      .extractChannel('alpha')
      .png()
      .toBuffer();
    await sharp(PHOTO_BAY)
      .resize(SIZE, SIZE, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        kernel: 'mitchell',
      })
      .ensureAlpha()
      .composite([{ input: alphaPng, blend: 'dest-in' }])
      .png()
      .toFile(dest);
    return 'photoreal+plugin-alpha';
  }

  await sharp(layer.assetPath)
    .resize(SIZE, SIZE, { kernel: 'lanczos3' })
    .png()
    .toFile(dest);
  return 'lanczos3';
}

/** Stalloria HorsePortrait lg: object-fit contain, object-position center 78%. */
async function writeFramedPreview(source, dest, frameW, frameH) {
  const fitted = Math.min(frameW, frameH);
  const horse = await sharp(source)
    .resize(fitted, fitted, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const top = Math.round(frameH * 0.78 - fitted * 0.78);
  const left = Math.round((frameW - fitted) / 2);
  await sharp({
    create: {
      width: frameW,
      height: frameH,
      channels: 4,
      background: { r: 18, g: 16, b: 14, alpha: 255 },
    },
  })
    .composite([{ input: horse, left, top }])
    .png()
    .toFile(dest);
}

async function main() {
  console.log('Stalloria 1024 crop test (1 variant, sequential)');
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(LAYER_DIR, { recursive: true });

  const engine = new KlairoxEngine({ renderer: new SharpRenderer() });
  const plugin = await engine.loadPlugin(PLUGIN_DIR);
  const plan = engine.plan(plugin, SELECTION);

  const scaledLayers = [];
  for (const layer of plan.layers) {
    const dest = path.join(LAYER_DIR, `${layer.layerId}-${layer.optionId}.png`);
    const how = await scaleLayer(layer, dest);
    console.log(`  layer ${layer.layerId}:${layer.optionId} → 1024 (${how})`);
    scaledLayers.push({
      ...layer,
      assetPath: dest,
      offset: {
        x: layer.offset.x * (SIZE / plan.canvas.width),
        y: layer.offset.y * (SIZE / plan.canvas.height),
      },
    });
  }

  const scaledPlan = {
    ...plan,
    canvas: { ...plan.canvas, width: SIZE, height: SIZE },
    layers: scaledLayers,
  };

  const artifacts = await exportComposition({
    plan: scaledPlan,
    renderer: new SharpRenderer(),
    defaults: { formats: ['webp'], metadata: true },
    options: {
      outputDir: OUT_DIR,
      name: NAME,
      formats: ['png', 'webp'],
      thumbnail: false,
      metadata: true,
    },
  });

  for (const artifact of artifacts) {
    console.log(
      `  wrote ${path.relative(ROOT, artifact.filePath)} (${artifact.byteLength} bytes)`,
    );
  }

  const png = artifacts.find((a) => a.format === 'png' && a.kind === 'image');
  if (png) {
    const crop1024 = path.join(OUT_DIR, 'crop-preview-1024.png');
    await writeFramedPreview(png.filePath, crop1024, 320, 400);
    console.log(`  wrote ${path.relative(ROOT, crop1024)} (Stalloria-style frame)`);
  }

  if (await exists(EXISTING_512)) {
    const crop512 = path.join(OUT_DIR, 'crop-preview-512.png');
    await writeFramedPreview(EXISTING_512, crop512, 320, 400);
    console.log(`  wrote ${path.relative(ROOT, crop512)} (current 512, same frame)`);
  }

  await writeFile(
    path.join(OUT_DIR, 'README.txt'),
    [
      'Single 1024 test: standard bay, no pie, no marking.',
      'Open crop-preview-1024.png next to crop-preview-512.png to compare framing.',
      'Full sprite: stalloria-standard-bay-pie-none-mark-none-1024.webp',
      '',
    ].join('\n'),
    'utf8',
  );

  await rm(LAYER_DIR, { recursive: true, force: true });
  console.log(`Done → ${path.relative(ROOT, OUT_DIR)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
