import type { Layer, LayerOption, PluginManifest } from './manifest.types.js';

/**
 * Lookup tables built once per manifest so the engine never rescans the layer
 * arrays while resolving selections, constraints or render plans.
 */
export interface ManifestIndex {
  readonly layers: ReadonlyMap<string, Layer>;
  readonly optionsByLayer: ReadonlyMap<
    string,
    ReadonlyMap<string, LayerOption>
  >;
}

export function indexManifest(manifest: PluginManifest): ManifestIndex {
  const layers = new Map<string, Layer>();
  const optionsByLayer = new Map<string, ReadonlyMap<string, LayerOption>>();

  for (const layer of manifest.layers) {
    layers.set(layer.id, layer);
    optionsByLayer.set(
      layer.id,
      new Map(layer.options.map((option) => [option.id, option])),
    );
  }

  return { layers, optionsByLayer };
}

export function findOption(
  index: ManifestIndex,
  layerId: string,
  optionId: string,
): LayerOption | undefined {
  return index.optionsByLayer.get(layerId)?.get(optionId);
}
