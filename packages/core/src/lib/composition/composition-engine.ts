import { KlairoxError } from '../errors.js';
import { pluginAssetPath } from '../plugin/plugin-loader.js';
import type { LoadedPlugin } from '../plugin/plugin.types.js';
import { compareLayers } from '../selection/resolution-order.js';
import { resolveSelection } from '../selection/resolve-selection.js';
import type { SelectionInput } from '../selection/selection.types.js';
import type { CompositionPlan, PlannedLayer } from './composition.types.js';

/**
 * Resolves a selection and turns it into an ordered list of images to paint.
 * The plan is pure data: it can be serialised, cached, diffed or handed to any renderer.
 */
export function buildCompositionPlan(
  plugin: LoadedPlugin,
  requested: SelectionInput = {},
): CompositionPlan {
  const { manifest, index } = plugin;
  const { selection, evaluation } = resolveSelection(plugin, requested);

  const layers: PlannedLayer[] = [];

  for (const [layerId, optionId] of Object.entries(selection)) {
    if (evaluation.hiddenLayers.has(layerId)) {
      continue;
    }

    const layer = index.layers.get(layerId);
    const option = index.optionsByLayer.get(layerId)?.get(optionId);

    if (layer === undefined || option === undefined) {
      throw new KlairoxError(
        'SELECTION_INVALID',
        `Selection references "${layerId}:${optionId}", which the manifest does not declare`,
      );
    }

    layers.push({
      layerId,
      optionId,
      assetPath: pluginAssetPath(plugin, option.asset),
      order: layer.order,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      offset: layer.offset,
    });
  }

  layers.sort((left, right) =>
    compareLayers(
      { id: left.layerId, order: left.order },
      { id: right.layerId, order: right.order },
    ),
  );

  return {
    pluginName: manifest.name,
    pluginVersion: manifest.version,
    canvas: manifest.canvas,
    selection,
    hiddenLayers: [...evaluation.hiddenLayers.keys()].sort(),
    layers,
  };
}
