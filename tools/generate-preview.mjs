/**
 * Builds the README preview strip by driving the engine programmatically.
 * Doubles as a compact example of the TypeScript API: plan, render, done.
 *
 * Usage: node tools/generate-preview.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCompositionPlan,
  loadPlugin,
  toRenderRequest,
} from '@klairox/core';
import { SharpRenderer } from '@klairox/renderer';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_PATH = path.join(ROOT, 'docs', 'images', 'horse-preview.png');

const TILE = 256;
const PADDING = 16;
const LABEL_HEIGHT = 34;
const BACKGROUND = { r: 250, g: 249, b: 246, alpha: 1 };

const VARIANTS = [
  { label: 'bay (default)', selection: {} },
  { label: 'grey', selection: { coat: 'grey' } },
  { label: 'palomino', selection: { coat: 'palomino' } },
  { label: 'cream + armour', selection: { coat: 'cream', equipment: 'armor' } },
];

function labelSvg(text, width) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${LABEL_HEIGHT}">
      <text x="${width / 2}" y="22" font-family="Segoe UI, Helvetica, Arial, sans-serif"
            font-size="15" fill="#5b5750" text-anchor="middle">${text}</text>
    </svg>`,
  );
}

async function main() {
  const plugin = await loadPlugin(path.join(ROOT, 'plugins', 'horse'));
  const renderer = new SharpRenderer();

  const tiles = await Promise.all(
    VARIANTS.map(async ({ selection }) => {
      const plan = buildCompositionPlan(plugin, selection);
      const composed = await renderer.render(
        toRenderRequest(plan, 'png', { width: TILE }),
      );
      return Buffer.from(composed);
    }),
  );

  const width = VARIANTS.length * TILE + (VARIANTS.length + 1) * PADDING;
  const height = TILE + LABEL_HEIGHT + PADDING;

  const overlays = VARIANTS.flatMap(({ label }, index) => {
    const left = PADDING + index * (TILE + PADDING);
    return [
      { input: tiles[index], left, top: PADDING / 2 },
      { input: labelSvg(label, TILE), left, top: PADDING / 2 + TILE },
    ];
  });

  const strip = await sharp({
    create: { width, height, channels: 4, background: BACKGROUND },
  })
    .composite(overlays)
    .png({ compressionLevel: 9 })
    .toBuffer();

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, strip);

  console.log(`Wrote ${OUTPUT_PATH} (${VARIANTS.length} variants)`);
}

await main();
