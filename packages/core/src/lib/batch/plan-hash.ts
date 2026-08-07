import { createHash } from 'node:crypto';
import type { CompositionPlan } from '../composition/composition.types.js';

/**
 * Stable fingerprint of a composition plan. Absolute asset paths are omitted so
 * the hash stays portable across machines; option ids already pin the artwork.
 */
export function hashCompositionPlan(plan: CompositionPlan): string {
  return createHash('sha256')
    .update(stableStringify(planFingerprint(plan)))
    .digest('hex')
    .slice(0, 16);
}

function planFingerprint(plan: CompositionPlan): unknown {
  return {
    pluginName: plan.pluginName,
    pluginVersion: plan.pluginVersion,
    canvas: plan.canvas,
    selection: sortedRecord(plan.selection),
    hiddenLayers: [...plan.hiddenLayers].sort(),
    layers: plan.layers.map((layer) => ({
      layerId: layer.layerId,
      optionId: layer.optionId,
      order: layer.order,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      offset: layer.offset,
    })),
  };
}

function sortedRecord(
  record: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}

/** Deterministic JSON so key insertion order never affects the hash. */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortValue(nested)]),
    );
  }

  return value;
}
