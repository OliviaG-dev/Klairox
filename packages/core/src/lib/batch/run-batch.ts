import { exportComposition } from '../export/export-manager.js';
import type {
  ExportedArtifact,
  ExportOptions,
} from '../export/export.types.js';
import type {
  BatchJobStatus,
  KlairoxEventMap,
} from '../events/engine-events.js';
import type { EventBus } from '../events/event-bus.js';
import type { LoadedPlugin } from '../plugin/plugin-loader.js';
import type { Renderer } from '../render/renderer.types.js';
import {
  expandVariants,
  type ExpandVariantsResult,
  type VariantJob,
} from './expand-variants.js';
import { mapPool } from './map-pool.js';
import { isCachedVariant } from './skip-cache.js';
import type { VariantOverrides } from './variant-config.js';

const DEFAULT_CONCURRENCY = 4;

export interface BatchRequest extends Omit<ExportOptions, 'name'> {
  readonly plugin: LoadedPlugin;
  readonly variants?: VariantOverrides;
  /** Max parallel renders. Defaults to 4. */
  readonly concurrency?: number;
  /** Plan and list jobs without writing files. */
  readonly dryRun?: boolean;
  /** Ignore the plan-hash cache and regenerate everything. */
  readonly force?: boolean;
}

export interface BatchJobResult {
  readonly job: VariantJob;
  readonly status: BatchJobStatus;
  readonly artifacts: readonly ExportedArtifact[];
}

export interface BatchResult extends ExpandVariantsResult {
  readonly results: readonly BatchJobResult[];
}

export interface BatchRunnerDeps {
  readonly renderer: Renderer;
  readonly events: EventBus<KlairoxEventMap>;
}

export async function runBatch(
  request: BatchRequest,
  deps: BatchRunnerDeps,
): Promise<BatchResult> {
  const expansion = expandVariants(request.plugin, request.variants);
  const concurrency = request.concurrency ?? DEFAULT_CONCURRENCY;
  const dryRun = request.dryRun === true;
  const force = request.force === true;
  const wantsMetadata =
    request.metadata ?? request.plugin.manifest.exports.metadata;

  deps.events.emit('batch:started', {
    pluginName: request.plugin.manifest.name,
    total: expansion.jobs.length,
    rejected: expansion.rejected.length,
    dryRun,
  });

  const results = await mapPool(
    expansion.jobs,
    dryRun ? 1 : concurrency,
    async (job, index) => {
      const result = await processJob(job, {
        request,
        deps,
        dryRun,
        force,
        wantsMetadata,
      });

      deps.events.emit('batch:variant', {
        index,
        total: expansion.jobs.length,
        name: job.name,
        status: result.status,
        planHash: job.planHash,
      });

      return result;
    },
  );

  deps.events.emit('batch:completed', {
    pluginName: request.plugin.manifest.name,
    generated: results.filter((result) => result.status === 'generated').length,
    cached: results.filter((result) => result.status === 'cached').length,
    planned: results.filter((result) => result.status === 'planned').length,
    rejected: expansion.rejected.length,
  });

  return { ...expansion, results };
}

async function processJob(
  job: VariantJob,
  context: {
    readonly request: BatchRequest;
    readonly deps: BatchRunnerDeps;
    readonly dryRun: boolean;
    readonly force: boolean;
    readonly wantsMetadata: boolean;
  },
): Promise<BatchJobResult> {
  const { request, deps, dryRun, force, wantsMetadata } = context;

  if (dryRun) {
    return { job, status: 'planned', artifacts: [] };
  }

  if (!force && wantsMetadata) {
    const cached = await isCachedVariant(
      request.outputDir,
      job.name,
      job.planHash,
    );
    if (cached) {
      return { job, status: 'cached', artifacts: [] };
    }
  }

  const artifacts = await exportComposition({
    plan: job.plan,
    renderer: deps.renderer,
    defaults: request.plugin.manifest.exports,
    options: {
      outputDir: request.outputDir,
      name: job.name,
      formats: request.formats,
      thumbnail: request.thumbnail,
      metadata: request.metadata,
    },
    onArtifact: (artifact) =>
      deps.events.emit('asset:rendered', {
        format: artifact.format,
        byteLength: artifact.byteLength,
      }),
  });

  return { job, status: 'generated', artifacts };
}

export type { BatchJobStatus };
