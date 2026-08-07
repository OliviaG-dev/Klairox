import type { VariantsConfig } from '@klairox/plugin-sdk';
import { KlairoxError } from '../errors.js';
import type { LoadedPlugin } from '../plugin/plugin-loader.js';
import type {
  Selection,
  SelectionInput,
} from '../selection/selection.types.js';

/** Caller overrides merged on top of the plugin's `variants` section. */
export interface VariantOverrides {
  readonly axes?: readonly string[];
  readonly include?: SelectionInput;
  readonly exclude?: readonly Selection[];
  readonly nameTemplate?: string;
}

/** Fully resolved matrix description ready for expansion. */
export interface ResolvedVariantConfig {
  readonly axes: readonly string[];
  readonly include: Selection;
  readonly exclude: readonly Selection[];
  readonly nameTemplate: string;
  readonly strategy: 'cartesian';
}

/**
 * Merges manifest `variants` with CLI/API overrides. Axes may come from either
 * side; without at least one axis there is nothing to expand.
 */
export function resolveVariantConfig(
  plugin: LoadedPlugin,
  overrides: VariantOverrides = {},
): ResolvedVariantConfig {
  const fromManifest: VariantsConfig | undefined = plugin.manifest.variants;
  const axes = overrides.axes ?? fromManifest?.axes;

  if (axes === undefined || axes.length === 0) {
    throw new KlairoxError(
      'VARIANTS_INVALID',
      'No variant axes to expand: declare variants.axes in the manifest or pass axes explicitly',
    );
  }

  const include = compactSelection({
    ...(fromManifest?.include ?? {}),
    ...(overrides.include ?? {}),
  });

  validateResolvedConfig(plugin, axes, include);

  return {
    axes: [...axes],
    include,
    exclude: overrides.exclude ?? fromManifest?.exclude ?? [],
    nameTemplate:
      overrides.nameTemplate ?? fromManifest?.name ?? defaultNameTemplate(axes),
    strategy: 'cartesian',
  };
}

export function defaultNameTemplate(axes: readonly string[]): string {
  return ['{plugin}', ...axes.map((axis) => `{${axis}}`)].join('-');
}

function validateResolvedConfig(
  plugin: LoadedPlugin,
  axes: readonly string[],
  include: Selection,
): void {
  const { index } = plugin;
  const details: string[] = [];
  const seenAxes = new Set<string>();

  for (const axis of axes) {
    if (seenAxes.has(axis)) {
      details.push(`duplicate axis "${axis}"`);
      continue;
    }
    seenAxes.add(axis);

    if (!index.layers.has(axis)) {
      details.push(`unknown axis layer "${axis}"`);
    }
  }

  for (const [layerId, optionId] of Object.entries(include)) {
    if (seenAxes.has(layerId)) {
      details.push(`layer "${layerId}" cannot appear in both axes and include`);
      continue;
    }

    const options = index.optionsByLayer.get(layerId);
    if (options === undefined) {
      details.push(`unknown include layer "${layerId}"`);
      continue;
    }

    if (!options.has(optionId)) {
      details.push(
        `unknown option "${optionId}" for include layer "${layerId}"`,
      );
    }
  }

  if (details.length > 0) {
    throw new KlairoxError(
      'VARIANTS_INVALID',
      'The variant configuration is not valid',
      { details },
    );
  }
}

function compactSelection(input: SelectionInput): Selection {
  const selection: Record<string, string> = {};

  for (const [layerId, optionId] of Object.entries(input)) {
    if (optionId !== undefined) {
      selection[layerId] = optionId;
    }
  }

  return selection;
}
