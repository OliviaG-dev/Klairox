/**
 * Rasterises the placeholder artwork of the `horse` reference plugin.
 *
 * The shapes are intentionally schematic: the point of the example plugin is to show
 * how layers, constraints and dependencies compose, not to ship finished art.
 *
 * Usage: node tools/generate-example-assets.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const CANVAS = 512;
const PLUGIN_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'plugins',
  'horse',
);

const MANE_COLOR = '#3b2a1d';

function svg(inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">${inner}</svg>`;
}

/** Side-view horse silhouette; `bulk` thickens the barrel to differentiate builds. */
function silhouette(fill, bulk = 1) {
  return `<g fill="${fill}">
    <ellipse cx="252" cy="286" rx="${118 * bulk}" ry="${64 * bulk}" />
    <polygon points="322,252 372,158 412,168 356,268" />
    <polygon points="368,160 436,140 452,176 404,192 364,182" />
    <rect x="316" y="330" width="${26 * bulk}" height="126" rx="9" />
    <rect x="284" y="336" width="${24 * bulk}" height="120" rx="9" />
    <rect x="168" y="330" width="${28 * bulk}" height="126" rx="9" />
    <rect x="204" y="336" width="${24 * bulk}" height="120" rx="9" />
    <path d="M162 248 C 128 288, 128 352, 152 396 L 176 388 C 156 350, 156 296, 182 258 Z" />
  </g>`;
}

const ASSETS = {
  'layers/body/standard.png': silhouette('#c9b8a1'),
  'layers/body/heavy.png': silhouette('#c9b8a1', 1.08),

  'layers/coat/bay.png': silhouette('#7b4a2d'),
  'layers/coat/black.png': silhouette('#33302c'),
  'layers/coat/grey.png': silhouette('#b9b6b0'),
  'layers/coat/chestnut.png': silhouette('#a45a25'),

  'layers/mane/short.png': `<path d="M320 250 L370 156 L392 164 L344 258 Z" fill="${MANE_COLOR}" />`,
  'layers/mane/long.png': `<path d="M314 258 L366 152 L396 162 L352 262 L338 296 L314 288 Z" fill="${MANE_COLOR}" />`,

  'layers/markings/blaze.png': `<path d="M392 160 L438 148 L442 162 L396 174 Z" fill="#f5f1e8" />`,
  'layers/markings/star.png': `<circle cx="400" cy="166" r="10" fill="#f7f4ec" />`,

  'layers/equipment/saddle.png': `<g>
    <rect x="244" y="228" width="14" height="104" fill="#4a2f1b" />
    <path d="M200 232 C 214 206, 292 206, 306 232 C 292 258, 214 258, 200 232 Z" fill="#5a3a22" />
  </g>`,
  'layers/equipment/armor.png': `<g>
    <path d="M176 234 C 206 204, 306 204, 336 234 L 328 282 C 298 258, 214 258, 184 282 Z" fill="#8d949c" />
    <path d="M194 240 C 220 218, 294 218, 318 240 L 314 258 C 290 240, 222 240, 198 258 Z" fill="#aeb5bd" />
  </g>`,
};

async function main() {
  const entries = Object.entries(ASSETS);

  await Promise.all(
    entries.map(async ([relativePath, inner]) => {
      const filePath = path.join(PLUGIN_DIR, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      const png = await sharp(Buffer.from(svg(inner)))
        .png({ compressionLevel: 9 })
        .toBuffer();
      await writeFile(filePath, png);
    }),
  );

  console.log(
    `Generated ${entries.length} placeholder assets in ${PLUGIN_DIR}`,
  );
}

await main();
