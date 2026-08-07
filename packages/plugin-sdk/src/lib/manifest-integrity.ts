import { indexManifest, type ManifestIndex } from './manifest-index.js';
import type { Constraint, PluginManifest, Selector } from './manifest.types.js';
import { parseTargetRef } from './target-ref.js';
import type { ManifestIssue } from './validation.types.js';

/**
 * Cross-field checks that a per-field schema cannot express: uniqueness,
 * referential integrity between layers/options/constraints, and dependency cycles.
 */
export function checkManifestIntegrity(
  manifest: PluginManifest,
): ManifestIssue[] {
  const index = indexManifest(manifest);

  return [
    ...checkUniqueIds(manifest),
    ...checkDependencies(manifest, index),
    ...checkDependencyCycles(manifest),
    ...checkConstraints(manifest, index),
    ...checkVariants(manifest, index),
  ];
}

function checkUniqueIds(manifest: PluginManifest): ManifestIssue[] {
  const issues: ManifestIssue[] = [];
  const seenLayerIds = new Set<string>();

  manifest.layers.forEach((layer, layerIndex) => {
    if (seenLayerIds.has(layer.id)) {
      issues.push({
        path: `layers[${layerIndex}].id`,
        message: `duplicate layer id "${layer.id}"`,
      });
    }
    seenLayerIds.add(layer.id);

    const seenOptionIds = new Set<string>();
    layer.options.forEach((option, optionIndex) => {
      if (seenOptionIds.has(option.id)) {
        issues.push({
          path: `layers[${layerIndex}].options[${optionIndex}].id`,
          message: `duplicate option id "${option.id}" in layer "${layer.id}"`,
        });
      }
      seenOptionIds.add(option.id);
    });
  });

  return issues;
}

function checkDependencies(
  manifest: PluginManifest,
  index: ManifestIndex,
): ManifestIssue[] {
  const issues: ManifestIssue[] = [];

  manifest.layers.forEach((layer, layerIndex) => {
    layer.dependsOn.forEach((dependencyId, dependencyIndex) => {
      const path = `layers[${layerIndex}].dependsOn[${dependencyIndex}]`;

      if (dependencyId === layer.id) {
        issues.push({
          path,
          message: `layer "${layer.id}" cannot depend on itself`,
        });
        return;
      }

      if (!index.layers.has(dependencyId)) {
        issues.push({ path, message: `unknown layer "${dependencyId}"` });
      }
    });
  });

  return issues;
}

type VisitState = 'visiting' | 'visited';

function checkDependencyCycles(manifest: PluginManifest): ManifestIssue[] {
  const dependencies = new Map(
    manifest.layers.map((layer) => [layer.id, layer.dependsOn]),
  );
  const state = new Map<string, VisitState>();
  const issues: ManifestIssue[] = [];

  const visit = (layerId: string, trail: string[]): void => {
    if (state.get(layerId) === 'visited') {
      return;
    }

    if (state.get(layerId) === 'visiting') {
      const cycleStart = trail.indexOf(layerId);
      const cycle = [...trail.slice(cycleStart), layerId].join(' -> ');
      issues.push({
        path: 'layers',
        message: `dependency cycle detected: ${cycle}`,
      });
      return;
    }

    state.set(layerId, 'visiting');
    for (const dependencyId of dependencies.get(layerId) ?? []) {
      visit(dependencyId, [...trail, layerId]);
    }
    state.set(layerId, 'visited');
  };

  for (const layerId of dependencies.keys()) {
    visit(layerId, []);
  }

  // A cycle is reported once per entry point; keep only distinct messages.
  return dedupeIssues(issues);
}

function checkConstraints(
  manifest: PluginManifest,
  index: ManifestIndex,
): ManifestIssue[] {
  const issues: ManifestIssue[] = [];

  manifest.constraints.forEach((constraint, constraintIndex) => {
    const path = `constraints[${constraintIndex}]`;
    issues.push(...checkSelector(constraint.when, index, `${path}.when`));
    issues.push(...checkTargets(constraint, index, path));

    if (Object.keys(constraint.when).length === 0) {
      issues.push({
        path: `${path}.when`,
        message: 'must contain at least one condition',
      });
    }
  });

  return issues;
}

function checkSelector(
  selector: Selector,
  index: ManifestIndex,
  path: string,
): ManifestIssue[] {
  const issues: ManifestIssue[] = [];

  for (const [layerId, expected] of Object.entries(selector)) {
    if (!index.layers.has(layerId)) {
      issues.push({
        path: `${path}.${layerId}`,
        message: `unknown layer "${layerId}"`,
      });
      continue;
    }

    const options = index.optionsByLayer.get(layerId);
    const expectedIds = Array.isArray(expected) ? expected : [expected];
    for (const optionId of expectedIds) {
      if (!options?.has(optionId)) {
        issues.push({
          path: `${path}.${layerId}`,
          message: `unknown option "${optionId}" for layer "${layerId}"`,
        });
      }
    }
  }

  return issues;
}

function checkTargets(
  constraint: Constraint,
  index: ManifestIndex,
  path: string,
): ManifestIssue[] {
  const groups = [
    { key: 'disable', refs: constraint.disable },
    { key: 'hide', refs: constraint.hide },
    { key: 'require', refs: constraint.require },
  ] as const;

  const issues: ManifestIssue[] = [];

  for (const group of groups) {
    group.refs.forEach((ref, refIndex) => {
      const refPath = `${path}.${group.key}[${refIndex}]`;
      const { layerId, optionId } = parseTargetRef(ref);

      if (!index.layers.has(layerId)) {
        issues.push({ path: refPath, message: `unknown layer "${layerId}"` });
        return;
      }

      if (optionId === undefined) {
        return;
      }

      if (!index.optionsByLayer.get(layerId)?.has(optionId)) {
        issues.push({
          path: refPath,
          message: `unknown option "${optionId}" for layer "${layerId}"`,
        });
      }
    });
  }

  return issues;
}

function checkVariants(
  manifest: PluginManifest,
  index: ManifestIndex,
): ManifestIssue[] {
  if (manifest.variants === undefined) {
    return [];
  }

  const { variants } = manifest;
  const issues: ManifestIssue[] = [];
  const seenAxes = new Set<string>();

  variants.axes.forEach((axis, axisIndex) => {
    const path = `variants.axes[${axisIndex}]`;

    if (seenAxes.has(axis)) {
      issues.push({ path, message: `duplicate axis "${axis}"` });
      return;
    }
    seenAxes.add(axis);

    if (!index.layers.has(axis)) {
      issues.push({ path, message: `unknown layer "${axis}"` });
    }
  });

  for (const [layerId, optionId] of Object.entries(variants.include)) {
    const path = `variants.include.${layerId}`;

    if (seenAxes.has(layerId)) {
      issues.push({
        path,
        message: `layer "${layerId}" cannot appear in both axes and include`,
      });
      continue;
    }

    issues.push(...checkLayerOption(layerId, optionId, index, path));
  }

  variants.exclude.forEach((entry, entryIndex) => {
    for (const [layerId, optionId] of Object.entries(entry)) {
      issues.push(
        ...checkLayerOption(
          layerId,
          optionId,
          index,
          `variants.exclude[${entryIndex}].${layerId}`,
        ),
      );
    }
  });

  return issues;
}

function checkLayerOption(
  layerId: string,
  optionId: string,
  index: ManifestIndex,
  path: string,
): ManifestIssue[] {
  if (!index.layers.has(layerId)) {
    return [{ path, message: `unknown layer "${layerId}"` }];
  }

  if (!index.optionsByLayer.get(layerId)?.has(optionId)) {
    return [
      {
        path,
        message: `unknown option "${optionId}" for layer "${layerId}"`,
      },
    ];
  }

  return [];
}

function dedupeIssues(issues: readonly ManifestIssue[]): ManifestIssue[] {
  const seen = new Set<string>();

  return issues.filter((issue) => {
    const key = `${issue.path}|${issue.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
