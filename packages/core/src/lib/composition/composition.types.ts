import type { BlendMode, CanvasConfig, Offset } from '@klairox/plugin-sdk';
import type { Selection } from '../selection/selection.types.js';

/** One image to paint, with everything the renderer needs and nothing else. */
export interface PlannedLayer {
  readonly layerId: string;
  readonly optionId: string;
  /** Absolute path, already checked to live inside the plugin root. */
  readonly assetPath: string;
  readonly order: number;
  readonly opacity: number;
  readonly blendMode: BlendMode;
  readonly offset: Offset;
}

/** A renderer-agnostic description of the image to produce. */
export interface CompositionPlan {
  readonly pluginName: string;
  readonly pluginVersion: string;
  readonly canvas: CanvasConfig;
  readonly selection: Selection;
  readonly hiddenLayers: readonly string[];
  /** Sorted by stacking order: first entry is painted first. */
  readonly layers: readonly PlannedLayer[];
}
