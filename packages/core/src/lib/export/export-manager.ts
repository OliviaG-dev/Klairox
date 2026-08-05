import path from 'node:path';
import type {
  ExportsConfig,
  ImageFormat,
  ThumbnailConfig,
} from '@klairox/plugin-sdk';
import type { CompositionPlan } from '../composition/composition.types.js';
import { KlairoxError } from '../errors.js';
import type { Renderer } from '../render/renderer.types.js';
import { toRenderRequest } from '../render/to-render-request.js';
import type { ExportedArtifact, ExportOptions } from './export.types.js';
import { buildAssetMetadata } from './metadata.js';
import { ensureOutputDir, writeArtifact } from './write-artifact.js';

export interface ExportRequest {
  readonly plan: CompositionPlan;
  readonly renderer: Renderer;
  readonly defaults: ExportsConfig;
  readonly options: ExportOptions;
  /** Called as soon as each artifact is written, for progress reporting. */
  readonly onArtifact?: (artifact: ExportedArtifact) => void;
}

/**
 * Renders every requested format plus the optional thumbnail and metadata sidecar.
 * Image formats are rendered concurrently; the metadata file is written last because
 * it lists the files that were produced.
 */
export async function exportComposition(
  request: ExportRequest,
): Promise<ExportedArtifact[]> {
  const { plan, defaults, options, onArtifact } = request;
  const formats = options.formats ?? defaults.formats;
  const thumbnail = resolveThumbnail(options.thumbnail, defaults.thumbnail);

  await ensureOutputDir(options.outputDir);

  const images = await Promise.all(
    formats.map((format) =>
      renderImage(request, format, `${options.name}.${format}`, 'image'),
    ),
  );

  const artifacts = [...images];

  if (thumbnail !== undefined) {
    artifacts.push(
      await renderImage(
        request,
        thumbnail.format,
        `${options.name}.thumbnail.${thumbnail.format}`,
        'thumbnail',
        thumbnail,
      ),
    );
  }

  const wantsMetadata = options.metadata ?? defaults.metadata;
  if (wantsMetadata) {
    artifacts.push(await writeMetadata(plan, artifacts, options));
  }

  artifacts.forEach((artifact) => onArtifact?.(artifact));

  return artifacts;
}

async function renderImage(
  request: ExportRequest,
  format: ImageFormat,
  fileName: string,
  kind: 'image' | 'thumbnail',
  thumbnail?: ThumbnailConfig,
): Promise<ExportedArtifact> {
  const { plan, renderer, options } = request;
  const resizeTo = thumbnail && {
    width: thumbnail.width,
    height: thumbnail.height,
  };
  const filePath = path.join(options.outputDir, fileName);

  const bytes = await renderOrFail(renderer, plan, format, resizeTo);
  await writeArtifact(filePath, bytes);

  return { kind, format, filePath, byteLength: bytes.byteLength };
}

async function renderOrFail(
  renderer: Renderer,
  plan: CompositionPlan,
  format: ImageFormat,
  resizeTo: { width: number; height?: number } | undefined,
): Promise<Uint8Array> {
  try {
    return await renderer.render(toRenderRequest(plan, format, resizeTo));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new KlairoxError(
      'RENDER_FAILED',
      `Renderer "${renderer.name}" failed to produce a ${format} image: ${reason}`,
      { cause: error },
    );
  }
}

async function writeMetadata(
  plan: CompositionPlan,
  artifacts: readonly ExportedArtifact[],
  options: ExportOptions,
): Promise<ExportedArtifact> {
  const filePath = path.join(options.outputDir, `${options.name}.json`);
  const contents = `${JSON.stringify(buildAssetMetadata(plan, artifacts), null, 2)}\n`;

  await writeArtifact(filePath, contents);

  return {
    kind: 'metadata',
    format: 'json',
    filePath,
    byteLength: Buffer.byteLength(contents, 'utf8'),
  };
}

function resolveThumbnail(
  override: ThumbnailConfig | false | undefined,
  fallback: ThumbnailConfig | undefined,
): ThumbnailConfig | undefined {
  if (override === false) {
    return undefined;
  }

  return override ?? fallback;
}
