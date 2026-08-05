import { buildCompositionPlan } from './composition/composition-engine.js';
import type { CompositionPlan } from './composition/composition.types.js';
import type { KlairoxEventMap } from './events/engine-events.js';
import {
  EventBus,
  type EventListener,
  type Unsubscribe,
} from './events/event-bus.js';
import { exportComposition } from './export/export-manager.js';
import type { ExportedArtifact, ExportOptions } from './export/export.types.js';
import {
  loadPlugin,
  type LoadedPlugin,
  type LoadPluginOptions,
} from './plugin/plugin-loader.js';
import type { Renderer } from './render/renderer.types.js';
import type { SelectionInput } from './selection/selection.types.js';

export interface KlairoxEngineOptions {
  readonly renderer: Renderer;
}

export interface GenerateRequest extends ExportOptions {
  readonly plugin: LoadedPlugin;
  readonly selection?: SelectionInput;
}

export interface GenerateResult {
  readonly plan: CompositionPlan;
  readonly artifacts: readonly ExportedArtifact[];
}

/**
 * The public entry point of Klairox. It owns no rendering logic: it wires the plugin
 * loader, the rule engine, the composition engine and the export manager together,
 * and delegates rasterisation to whichever {@link Renderer} it was given.
 */
export class KlairoxEngine {
  private readonly events = new EventBus<KlairoxEventMap>();
  private readonly renderer: Renderer;

  constructor(options: KlairoxEngineOptions) {
    this.renderer = options.renderer;
  }

  on<TKey extends keyof KlairoxEventMap>(
    event: TKey,
    listener: EventListener<KlairoxEventMap[TKey]>,
  ): Unsubscribe {
    return this.events.on(event, listener);
  }

  off<TKey extends keyof KlairoxEventMap>(
    event: TKey,
    listener: EventListener<KlairoxEventMap[TKey]>,
  ): void {
    this.events.off(event, listener);
  }

  async loadPlugin(
    pluginDir: string,
    options?: LoadPluginOptions,
  ): Promise<LoadedPlugin> {
    const plugin = await loadPlugin(pluginDir, options);

    this.events.emit('plugin:loaded', {
      pluginName: plugin.manifest.name,
      rootDir: plugin.rootDir,
      layerCount: plugin.manifest.layers.length,
    });

    return plugin;
  }

  /** Resolves a selection into a renderer-agnostic plan, without touching the disk. */
  plan(plugin: LoadedPlugin, selection: SelectionInput = {}): CompositionPlan {
    const plan = buildCompositionPlan(plugin, selection);

    this.events.emit('selection:resolved', {
      pluginName: plan.pluginName,
      selection: plan.selection,
    });
    this.events.emit('composition:planned', {
      pluginName: plan.pluginName,
      layerCount: plan.layers.length,
      hiddenLayers: plan.hiddenLayers,
    });

    return plan;
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const { plugin, selection, ...exportOptions } = request;
    const plan = this.plan(plugin, selection);

    const artifacts = await exportComposition({
      plan,
      renderer: this.renderer,
      defaults: plugin.manifest.exports,
      options: exportOptions,
      onArtifact: (artifact) =>
        this.events.emit('asset:rendered', {
          format: artifact.format,
          byteLength: artifact.byteLength,
        }),
    });

    this.events.emit('asset:exported', {
      outputDir: exportOptions.outputDir,
      artifacts,
    });

    return { plan, artifacts };
  }
}
