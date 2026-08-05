import type { ImageFormat } from '@klairox/plugin-sdk';
import type { CompositionPlan } from '../composition/composition.types.js';
import type { RenderRequest, ResizeRequest } from './renderer.types.js';

/** Strips a plan down to what a renderer needs: pixels in, pixels out. */
export function toRenderRequest(
  plan: CompositionPlan,
  format: ImageFormat,
  resizeTo?: ResizeRequest,
): RenderRequest {
  return {
    canvas: plan.canvas,
    format,
    resizeTo,
    layers: plan.layers.map((layer) => ({
      assetPath: layer.assetPath,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      offset: layer.offset,
    })),
  };
}
