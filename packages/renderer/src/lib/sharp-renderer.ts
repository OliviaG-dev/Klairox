import type { ImageFormat } from '@klairox/plugin-sdk';
import sharp, { type OverlayOptions, type Sharp } from 'sharp';
import type { Renderer, RenderRequest, ResizeRequest } from '@klairox/core';
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

    const composition = sharp({
      create: {
        width: canvas.width,
        height: canvas.height,
        channels: RGBA_CHANNELS,
        background: parseHexColor(canvas.background),
      },
    }).composite(overlays);

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

function resize(pipeline: Sharp, resizeTo: ResizeRequest): Sharp {
  return pipeline.resize({
    width: resizeTo.width,
    height: resizeTo.height,
    fit: 'inside',
    withoutEnlargement: true,
  });
}
