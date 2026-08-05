import { access } from 'node:fs/promises';
import path from 'node:path';
import {
  indexManifest,
  parsePluginManifest,
  type ManifestIndex,
  type PluginManifest,
} from '@klairox/plugin-sdk';
import { KlairoxError } from '../errors.js';
import { resolveAssetPath } from './asset-path.js';
import { readManifestSource } from './manifest-source.js';

export interface LoadedPlugin {
  readonly manifest: PluginManifest;
  readonly index: ManifestIndex;
  readonly rootDir: string;
  readonly manifestPath: string;
}

export interface LoadPluginOptions {
  /** Checks that every declared asset exists on disk. Enabled by default. */
  readonly verifyAssets?: boolean;
}

/** Reads, validates and indexes a plugin directory. */
export async function loadPlugin(
  pluginDir: string,
  options: LoadPluginOptions = {},
): Promise<LoadedPlugin> {
  const rootDir = path.resolve(pluginDir);
  const source = await readManifestSource(rootDir);
  const parsed = parsePluginManifest(source.data);

  if (!parsed.ok) {
    throw new KlairoxError(
      'MANIFEST_INVALID',
      `Invalid manifest "${source.filePath}"`,
      {
        details: parsed.issues.map(
          (issue) => `${issue.path}: ${issue.message}`,
        ),
      },
    );
  }

  const plugin: LoadedPlugin = {
    manifest: parsed.manifest,
    index: indexManifest(parsed.manifest),
    rootDir,
    manifestPath: source.filePath,
  };

  if (options.verifyAssets !== false) {
    await verifyAssets(plugin);
  }

  return plugin;
}

/** Absolute path of the image backing one option of a layer. */
export function pluginAssetPath(plugin: LoadedPlugin, asset: string): string {
  return resolveAssetPath(plugin.rootDir, asset);
}

async function verifyAssets(plugin: LoadedPlugin): Promise<void> {
  const assets = plugin.manifest.layers.flatMap((layer) =>
    layer.options.map((option) => ({
      layerId: layer.id,
      optionId: option.id,
      asset: option.asset,
    })),
  );

  const results = await Promise.all(
    assets.map(async (entry) => {
      const filePath = resolveAssetPath(plugin.rootDir, entry.asset);
      const exists = await isReadable(filePath);
      return { ...entry, exists };
    }),
  );

  const missing = results.filter((entry) => !entry.exists);
  if (missing.length === 0) {
    return;
  }

  throw new KlairoxError(
    'ASSET_NOT_FOUND',
    `${missing.length} asset(s) declared by plugin "${plugin.manifest.name}" are missing`,
    {
      details: missing.map(
        (entry) => `${entry.layerId}:${entry.optionId} -> ${entry.asset}`,
      ),
    },
  );
}

async function isReadable(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
