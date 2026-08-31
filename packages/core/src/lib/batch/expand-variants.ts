import { buildCompositionPlan } from '../composition/composition-engine.js';
import type { CompositionPlan } from '../composition/composition.types.js';
import { isKlairoxError } from '../errors.js';
import type { LoadedPlugin } from '../plugin/plugin-loader.js';
import type {
  Selection,
  SelectionInput,
} from '../selection/selection.types.js';
import { hashCompositionPlan } from './plan-hash.js';
import {
  resolveVariantConfig,
  type ResolvedVariantConfig,
  type VariantOverrides,
} from './variant-config.js';

export interface VariantJob {
  /** Selection sent into the resolver before defaults are applied. */
  readonly requested: SelectionInput;
  /** Fully resolved selection after constraints and defaults. */
  readonly selection: Selection;
  readonly name: string;
  readonly plan: CompositionPlan;
  readonly planHash: string;
}

export interface VariantRejection {
  readonly requested: SelectionInput;
  readonly reason: string;
}

export interface ExpandVariantsResult {
  readonly config: ResolvedVariantConfig;
  readonly jobs: readonly VariantJob[];
  readonly rejected: readonly VariantRejection[];
}

/**
 * Expands a variant matrix into planned jobs. Invalid combinations (disabled by
 * constraints, unmet requires, …) are collected as rejections instead of failing
 * the whole batch — a realistic matrix always contains a few impossibles.
 */
export function expandVariants(
  plugin: LoadedPlugin,
  overrides: VariantOverrides = {},
): ExpandVariantsResult {
  const config = resolveVariantConfig(plugin, overrides);
  const jobs: VariantJob[] = [];
  const rejected: VariantRejection[] = [];

  for (const axisCombo of cartesianAxisCombos(plugin, config.axes)) {
    const requested: SelectionInput = { ...config.include, ...axisCombo };

    if (isExcluded(requested, config.exclude)) {
      rejected.push({
        requested,
        reason: 'excluded by variants.exclude',
      });
      continue;
    }

    try {
      const plan = buildCompositionPlan(plugin, requested);
      const dropped = findDroppedRequests(requested, plan.selection);
      if (dropped !== undefined) {
        rejected.push({
          requested,
          reason: dropped,
        });
        continue;
      }

      jobs.push({
        requested,
        selection: plan.selection,
        name: renderVariantName(config.nameTemplate, plugin.manifest.name, {
          ...requested,
          ...plan.selection,
        }),
        plan,
        planHash: hashCompositionPlan(plan),
      });
    } catch (error) {
      rejected.push({
        requested,
        reason: formatRejection(error),
      });
    }
  }

  return { config, jobs, rejected };
}

/** Axis values that resolveSelection dropped or remapped (e.g. disabled options). */
function findDroppedRequests(
  requested: SelectionInput,
  selection: Selection,
): string | undefined {
  for (const [layerId, optionId] of Object.entries(requested)) {
    if (optionId === undefined) {
      continue;
    }
    if (selection[layerId] !== optionId) {
      return `"${layerId}:${optionId}" is disabled or remapped by constraints`;
    }
  }
  return undefined;
}

function cartesianAxisCombos(
  plugin: LoadedPlugin,
  axes: readonly string[],
): Selection[] {
  const optionLists = axes.map((axis) => {
    const options = plugin.index.optionsByLayer.get(axis);
    if (options === undefined || options.size === 0) {
      return [] as Selection[];
    }

    return [...options.keys()].map((optionId) => ({ [axis]: optionId }));
  });

  return optionLists.reduce<Selection[]>(
    (products, options) => {
      if (products.length === 0) {
        return options;
      }

      return products.flatMap((product) =>
        options.map((option) => ({ ...product, ...option })),
      );
    },
    [{}],
  );
}

function isExcluded(
  requested: SelectionInput,
  excludes: readonly Selection[],
): boolean {
  return excludes.some((exclude) =>
    Object.entries(exclude).every(
      ([layerId, optionId]) => requested[layerId] === optionId,
    ),
  );
}

/**
 * Fills `{plugin}` and `{layerId}` placeholders. Unresolved placeholders become
 * `none` so optional layers left unset still yield a stable file name.
 */
export function renderVariantName(
  template: string,
  pluginName: string,
  selection: SelectionInput,
): string {
  let name = template.replaceAll('{plugin}', pluginName);

  for (const [layerId, optionId] of Object.entries(selection)) {
    if (optionId !== undefined) {
      name = name.replaceAll(`{${layerId}}`, optionId);
    }
  }

  return name.replace(/\{[a-z0-9-]+\}/g, 'none');
}

function formatRejection(error: unknown): string {
  if (isKlairoxError(error)) {
    if (error.details.length === 0) {
      return error.message;
    }

    return `${error.message}: ${error.details.join('; ')}`;
  }

  return error instanceof Error ? error.message : String(error);
}
