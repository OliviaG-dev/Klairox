import type {
  BlendMode,
  CanvasConfig,
  ImageFormat,
  Offset,
} from '@klairox/plugin-sdk';

export interface RenderLayer {
  readonly assetPath: string;
  readonly opacity: number;
  readonly blendMode: BlendMode;
  readonly offset: Offset;
}

export interface ResizeRequest {
  readonly width: number;
  /** Omitted keeps the canvas aspect ratio. */
  readonly height?: number;
}

export interface RenderRequest {
  readonly canvas: CanvasConfig;
  readonly layers: readonly RenderLayer[];
  readonly format: ImageFormat;
  /** Applied after composition, used to produce thumbnails from the full-size image. */
  readonly resizeTo?: ResizeRequest;
}

/**
 * The single port the engine uses to rasterise a composition. Implementations live
 * outside the core (Sharp today; Canvas, WebGL or PixiJS later) and the core never
 * imports any of them.
 */
export interface Renderer {
  readonly name: string;
  render(request: RenderRequest): Promise<Uint8Array>;
}
