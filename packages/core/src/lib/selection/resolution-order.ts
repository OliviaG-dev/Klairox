import type { Layer, PluginManifest } from '@klairox/plugin-sdk';
import { KlairoxError } from '../errors.js';

/** The minimum a value needs to expose to take part in stacking. */
export interface StackableLayer {
  readonly id: string;
  readonly order: number;
}

/** Stacking order: lower `order` is painted first, ties broken by id for determinism. */
export function compareLayers(
  left: StackableLayer,
  right: StackableLayer,
): number {
  return left.order - right.order || left.id.localeCompare(right.id);
}

/**
 * Orders layers so that a layer is always resolved after the layers it depends on.
 * This is the *resolution* order used when filling in a selection, not the
 * stacking order used when painting.
 */
export function resolveLayerOrder(manifest: PluginManifest): Layer[] {
  const pending = new Map(
    [...manifest.layers].sort(compareLayers).map((l) => [l.id, l]),
  );
  const resolvedIds = new Set<string>();
  const ordered: Layer[] = [];

  // `pending` is kept in stacking order, so picking the first ready layer each round
  // follows the order the author declared whenever dependencies allow it.
  while (pending.size > 0) {
    const next = [...pending.values()].find((layer) =>
      layer.dependsOn.every((dependencyId) => resolvedIds.has(dependencyId)),
    );

    if (next === undefined) {
      throw new KlairoxError(
        'MANIFEST_INVALID',
        `Cannot order layers of plugin "${manifest.name}": unresolvable dependencies`,
        { details: [...pending.keys()] },
      );
    }

    ordered.push(next);
    resolvedIds.add(next.id);
    pending.delete(next.id);
  }

  return ordered;
}
