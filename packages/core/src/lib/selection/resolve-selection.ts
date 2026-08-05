import { formatTargetRef } from '@klairox/plugin-sdk';
import { KlairoxError } from '../errors.js';
import type { LoadedPlugin } from '../plugin/plugin-loader.js';
import {
  disablingConstraint,
  evaluateConstraints,
  findViolations,
  isOptionDisabled,
  type RuleEvaluation,
} from '../rules/rule-engine.js';
import { resolveLayerOrder } from './resolution-order.js';
import type { Selection, SelectionInput } from './selection.types.js';

export interface SelectionResolution {
  readonly selection: Selection;
  readonly evaluation: RuleEvaluation;
}

/**
 * Turns a partial request into a complete selection: unknown entries are rejected,
 * required layers fall back to their first option still allowed by the constraints,
 * and optional layers stay unset.
 *
 * Layers are walked in dependency order, so a constraint triggered by an upstream
 * layer already applies when the engine picks a default downstream.
 */
export function resolveSelection(
  plugin: LoadedPlugin,
  requested: SelectionInput = {},
): SelectionResolution {
  const { manifest, index } = plugin;
  const unknownEntries = findUnknownEntries(plugin, requested);

  if (unknownEntries.length > 0) {
    throw new KlairoxError(
      'SELECTION_INVALID',
      'The requested selection is not valid',
      {
        details: unknownEntries,
      },
    );
  }

  const draft: Record<string, string> = {};
  const errors: string[] = [];

  for (const layer of resolveLayerOrder(manifest)) {
    const evaluation = evaluateConstraints(manifest, draft);
    const requestedOptionId = requested[layer.id];

    if (requestedOptionId !== undefined) {
      const blockedBy = disablingConstraint(
        evaluation,
        layer.id,
        requestedOptionId,
      );
      if (blockedBy !== undefined) {
        errors.push(
          `"${formatTargetRef(layer.id, requestedOptionId)}" is disabled by ${blockedBy}`,
        );
        continue;
      }

      draft[layer.id] = requestedOptionId;
      continue;
    }

    if (!layer.required) {
      continue;
    }

    const options = index.optionsByLayer.get(layer.id);
    const fallback = [...(options?.values() ?? [])].find(
      (option) => !isOptionDisabled(evaluation, layer.id, option.id),
    );

    if (fallback === undefined) {
      errors.push(
        `layer "${layer.id}" is required but every option is disabled`,
      );
      continue;
    }

    draft[layer.id] = fallback.id;
  }

  if (errors.length > 0) {
    throw new KlairoxError(
      'SELECTION_INVALID',
      'The requested selection is not valid',
      {
        details: errors,
      },
    );
  }

  const evaluation = evaluateConstraints(manifest, draft);
  const violations = findViolations(evaluation, draft);

  if (violations.length > 0) {
    throw new KlairoxError(
      'CONSTRAINT_VIOLATION',
      'The selection breaks plugin constraints',
      {
        details: violations.map((violation) => violation.message),
      },
    );
  }

  return { selection: draft, evaluation };
}

function findUnknownEntries(
  plugin: LoadedPlugin,
  requested: SelectionInput,
): string[] {
  const errors: string[] = [];

  for (const [layerId, optionId] of Object.entries(requested)) {
    if (optionId === undefined) {
      continue;
    }

    const options = plugin.index.optionsByLayer.get(layerId);
    if (options === undefined) {
      errors.push(`unknown layer "${layerId}"`);
      continue;
    }

    if (!options.has(optionId)) {
      errors.push(
        `unknown option "${optionId}" for layer "${layerId}" (available: ${[...options.keys()].join(', ')})`,
      );
    }
  }

  return errors;
}
