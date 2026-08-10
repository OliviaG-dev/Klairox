import { computed, Injectable, signal } from '@angular/core';
import {
  indexManifest,
  parsePluginManifest,
  type PluginManifest,
} from '@klairox/plugin-sdk';
import {
  isKlairoxError,
  isOptionDisabled,
  resolveSelection,
  type LoadedPlugin,
  type RuleEvaluation,
  type Selection,
  type SelectionInput,
  type SelectionResolution,
} from '@klairox/core/browser';

const HORSE_PLUGIN_BASE = '/plugins/horse';

export interface PreviewLayer {
  readonly layerId: string;
  readonly optionId: string;
  readonly url: string;
  readonly order: number;
  readonly opacity: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

interface ResolvedState {
  readonly resolution: SelectionResolution | null;
  readonly error: string | null;
}

@Injectable({ providedIn: 'root' })
export class EditorSession {
  readonly plugin = signal<LoadedPlugin | null>(null);
  readonly requested = signal<SelectionInput>({});
  readonly loadError = signal<string | null>(null);
  readonly loading = signal(false);

  private readonly resolvedState = computed<ResolvedState>(() => {
    const plugin = this.plugin();
    if (!plugin) {
      return { resolution: null, error: null };
    }

    try {
      return {
        resolution: resolveSelection(plugin, this.requested()),
        error: null,
      };
    } catch (error) {
      return { resolution: null, error: errorMessage(error) };
    }
  });

  readonly selectionError = computed(() => this.resolvedState().error);

  readonly resolved = computed(() => this.resolvedState().resolution);

  readonly selection = computed<Selection>(
    () => this.resolved()?.selection ?? {},
  );

  readonly evaluation = computed<RuleEvaluation | null>(
    () => this.resolved()?.evaluation ?? null,
  );

  readonly previewLayers = computed<readonly PreviewLayer[]>(() => {
    const plugin = this.plugin();
    const selection = this.selection();
    const evaluation = this.evaluation();

    if (!plugin || !evaluation) {
      return [];
    }

    const layers: PreviewLayer[] = [];

    for (const layer of plugin.manifest.layers) {
      if (evaluation.hiddenLayers.has(layer.id)) {
        continue;
      }

      const optionId = selection[layer.id];
      if (optionId === undefined) {
        continue;
      }

      const option = plugin.index.optionsByLayer.get(layer.id)?.get(optionId);
      if (option === undefined) {
        continue;
      }

      layers.push({
        layerId: layer.id,
        optionId,
        url: assetUrl(plugin.rootDir, option.asset),
        order: layer.order,
        opacity: layer.opacity,
        offsetX: layer.offset.x,
        offsetY: layer.offset.y,
      });
    }

    return layers.sort((left, right) => left.order - right.order);
  });

  async loadHorsePlugin(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);

    try {
      const response = await fetch(`${HORSE_PLUGIN_BASE}/plugin.json`);
      if (!response.ok) {
        throw new Error(`Failed to load plugin.json (${response.status})`);
      }

      const data: unknown = await response.json();
      const parsed = parsePluginManifest(data);
      if (!parsed.ok) {
        throw new Error(
          parsed.issues
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join('; '),
        );
      }

      this.plugin.set(toLoadedPlugin(parsed.manifest, HORSE_PLUGIN_BASE));
      this.requested.set({});
    } catch (error) {
      this.plugin.set(null);
      this.loadError.set(errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  selectOption(layerId: string, optionId: string | null): void {
    this.requested.update((current) => {
      const next: Record<string, string> = {};

      for (const [id, value] of Object.entries(current)) {
        if (value !== undefined) {
          next[id] = value;
        }
      }

      if (optionId === null) {
        delete next[layerId];
      } else {
        next[layerId] = optionId;
      }

      return next;
    });
  }

  isDisabled(layerId: string, optionId: string): boolean {
    const evaluation = this.evaluation();
    if (!evaluation) {
      return false;
    }

    return isOptionDisabled(evaluation, layerId, optionId);
  }

  isHidden(layerId: string): boolean {
    return this.evaluation()?.hiddenLayers.has(layerId) ?? false;
  }
}

function toLoadedPlugin(
  manifest: PluginManifest,
  rootDir: string,
): LoadedPlugin {
  return {
    manifest,
    index: indexManifest(manifest),
    rootDir,
    manifestPath: `${rootDir}/plugin.json`,
  };
}

function assetUrl(rootDir: string, asset: string): string {
  const base = rootDir.endsWith('/') ? rootDir : `${rootDir}/`;
  return `${base}${asset.replace(/^\//, '')}`;
}

function errorMessage(error: unknown): string {
  if (isKlairoxError(error)) {
    return error.format();
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
