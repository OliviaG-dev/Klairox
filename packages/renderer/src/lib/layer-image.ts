import { readFile } from 'node:fs/promises';
import type { CanvasConfig } from '@klairox/plugin-sdk';
import sharp from 'sharp';
import type { RenderLayer } from '@klairox/core';

const OPAQUE = 1;
const MAX_CHANNEL_VALUE = 255;

/**
 * Loads one layer image, checks it fits inside the canvas at its offset, and pre-multiplies
 * its alpha when the layer is partially transparent. Sharp has no per-composite opacity,
 * so the fade has to be baked into the image before compositing.
 */
export async function prepareLayerImage(
  layer: RenderLayer,
  canvas: CanvasConfig,
): Promise<Buffer> {
  const source = await readLayerFile(layer.assetPath);
  await assertFitsCanvas(source, layer, canvas);

  if (layer.opacity >= OPAQUE) {
    return source;
  }

  return applyOpacity(source, layer.opacity);
}

async function readLayerFile(assetPath: string): Promise<Buffer> {
  try {
    return await readFile(assetPath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read layer image "${assetPath}": ${reason}`, {
      cause: error,
    });
  }
}

async function assertFitsCanvas(
  source: Buffer,
  layer: RenderLayer,
  canvas: CanvasConfig,
): Promise<void> {
  const { width, height } = await sharp(source).metadata();

  if (width === undefined || height === undefined) {
    throw new Error(
      `Cannot read the dimensions of layer image "${layer.assetPath}"`,
    );
  }

  const right = layer.offset.x + width;
  const bottom = layer.offset.y + height;

  if (right > canvas.width || bottom > canvas.height) {
    throw new Error(
      `Layer image "${layer.assetPath}" (${width}x${height} at ${layer.offset.x},${layer.offset.y}) ` +
        `does not fit in the ${canvas.width}x${canvas.height} canvas`,
    );
  }
}

async function applyOpacity(source: Buffer, opacity: number): Promise<Buffer> {
  const alpha = Math.round(opacity * MAX_CHANNEL_VALUE);

  return sharp(source)
    .ensureAlpha()
    .composite([
      {
        input: Buffer.from([
          MAX_CHANNEL_VALUE,
          MAX_CHANNEL_VALUE,
          MAX_CHANNEL_VALUE,
          alpha,
        ]),
        raw: { width: 1, height: 1, channels: 4 },
        tile: true,
        blend: 'dest-in',
      },
    ])
    .png()
    .toBuffer();
}
