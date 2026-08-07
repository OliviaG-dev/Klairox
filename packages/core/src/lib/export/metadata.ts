import path from 'node:path';
import type { CanvasConfig } from '@klairox/plugin-sdk';
import { hashCompositionPlan } from '../batch/plan-hash.js';
import type { CompositionPlan } from '../composition/composition.types.js';
import type { Selection } from '../selection/selection.types.js';
import type { ExportedArtifact } from './export.types.js';

export interface AssetMetadata {
  readonly generator: 'klairox';
  readonly plugin: { readonly name: string; readonly version: string };
  readonly canvas: CanvasConfig;
  readonly selection: Selection;
  readonly hiddenLayers: readonly string[];
  readonly layers: readonly {
    readonly layerId: string;
    readonly optionId: string;
  }[];
  readonly files: readonly { readonly kind: string; readonly file: string }[];
  /** Fingerprint of the composition plan, used to skip unchanged batch work. */
  readonly planHash: string;
}

/**
 * Sidecar describing how the asset was produced, so a game engine can index it.
 * Deliberately free of timestamps: identical inputs must produce identical output.
 */
export function buildAssetMetadata(
  plan: CompositionPlan,
  artifacts: readonly ExportedArtifact[],
): AssetMetadata {
  return {
    generator: 'klairox',
    plugin: { name: plan.pluginName, version: plan.pluginVersion },
    canvas: plan.canvas,
    selection: plan.selection,
    hiddenLayers: plan.hiddenLayers,
    layers: plan.layers.map((layer) => ({
      layerId: layer.layerId,
      optionId: layer.optionId,
    })),
    files: artifacts.map((artifact) => ({
      kind: artifact.kind,
      file: path.basename(artifact.filePath),
    })),
    planHash: hashCompositionPlan(plan),
  };
}
