import type { ImageFormat } from '@klairox/plugin-sdk';
import sharp, { type OverlayOptions, type Sharp } from 'sharp';
import {
  isPieOverlayLayer,
  mixPieOverDest,
  type Renderer,
  type RenderLayer,
  type RenderRequest,
  type ResizeRequest,
} from '@klairox/core';
import { SHARP_BLEND_MODES } from './blend-modes.js';
import { parseHexColor } from './color.js';
import { prepareLayerImage } from './layer-image.js';

const RGBA_CHANNELS = 4;

export interface SharpRendererOptions {
  /** Compression effort for the final encode, 0-9 for PNG and 0-6 for WebP. */
  readonly quality?: number;
}

/**
 * Reference renderer, backed by libvips through Sharp. It is one implementation of the
 * `Renderer` port defined by the core: swapping it for a Canvas or WebGL renderer
 * requires no change to the engine.
 */
export class SharpRenderer implements Renderer {
  readonly name = 'sharp';

  constructor(private readonly options: SharpRendererOptions = {}) {}

  async render(request: RenderRequest): Promise<Uint8Array> {
    const { canvas, layers, format, resizeTo } = request;

    const overlays = await Promise.all(
      layers.map(async (layer): Promise<OverlayOptions> => ({
        input: await prepareLayerImage(layer, canvas),
        left: layer.offset.x,
        top: layer.offset.y,
        blend: SHARP_BLEND_MODES[layer.blendMode],
      })),
    );

    const blank = (): Sharp =>
      sharp({
        create: {
          width: canvas.width,
          height: canvas.height,
          channels: RGBA_CHANNELS,
          background: parseHexColor(canvas.background),
        },
      });

    let composition: Sharp;
    if (!layers.some(shouldMixPie)) {
      composition = blank().composite(overlays);
    } else {
      composition = blank();
      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        const overlay = overlays[i];
        if (shouldMixPie(layer)) {
          composition = await mixPieLayer(composition, overlay, layer);
        } else {
          composition = sharp(
            await composition.composite([overlay]).png().toBuffer(),
          );
        }
      }
    }

    if (resizeTo === undefined) {
      return this.encode(composition, format).toBuffer();
    }

    // Sharp resizes before compositing within a single pipeline, so the thumbnail has
    // to be produced from the already-composed image.
    const composed = await composition.png().toBuffer();
    return this.encode(resize(sharp(composed), resizeTo), format).toBuffer();
  }

  private encode(pipeline: Sharp, format: ImageFormat): Sharp {
    const { quality } = this.options;

    return format === 'webp'
      ? pipeline.webp(quality === undefined ? {} : { quality })
      : pipeline.png(
          quality === undefined ? {} : { compressionLevel: quality },
        );
  }
}

function shouldMixPie(layer: RenderLayer): boolean {
  return (
    layer.layerId !== undefined &&
    isPieOverlayLayer(layer.layerId) &&
    layer.blendMode === 'normal'
  );
}

async function mixPieLayer(
  current: Sharp,
  overlay: OverlayOptions,
  layer: RenderLayer,
): Promise<Sharp> {
  const dest = await current
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const input = overlay.input;
  if (!Buffer.isBuffer(input)) {
    throw new Error('Pie overlay input must be a prepared image buffer');
  }
  const src = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const full = new Uint8ClampedArray(dest.data.length);
  const ox = layer.offset.x;
  const oy = layer.offset.y;
  const srcWidth = src.info.width;
  const destWidth = dest.info.width;
  const destHeight = dest.info.height;

  for (let y = 0; y < src.info.height; y++) {
    const dy = y + oy;
    if (dy < 0 || dy >= destHeight) {
      continue;
    }
    for (let x = 0; x < srcWidth; x++) {
      const dx = x + ox;
      if (dx < 0 || dx >= destWidth) {
        continue;
      }
      const si = (y * srcWidth + x) * RGBA_CHANNELS;
      const di = (dy * destWidth + dx) * RGBA_CHANNELS;
      full[di] = src.data[si];
      full[di + 1] = src.data[si + 1];
      full[di + 2] = src.data[si + 2];
      full[di + 3] = src.data[si + 3];
    }
  }

  const destPixels = new Uint8ClampedArray(dest.data);
  mixPieOverDest(destPixels, full);
  return sharp(Buffer.from(destPixels), {
    raw: {
      width: destWidth,
      height: destHeight,
      channels: RGBA_CHANNELS,
    },
  });
}

function resize(pipeline: Sharp, resizeTo: ResizeRequest): Sharp {
  return pipeline.resize({
    width: resizeTo.width,
    height: resizeTo.height,
    fit: 'inside',
    withoutEnlargement: true,
  });
}
