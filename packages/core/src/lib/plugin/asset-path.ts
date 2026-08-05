import path from 'node:path';
import { KlairoxError } from '../errors.js';

/**
 * Resolves an asset declared in a manifest against the plugin root, refusing any
 * path that escapes it. Plugins are untrusted data, so `../` must never reach the
 * file system.
 */
export function resolveAssetPath(rootDir: string, asset: string): string {
  if (path.isAbsolute(asset)) {
    throw new KlairoxError(
      'ASSET_OUTSIDE_PLUGIN',
      `Asset "${asset}" must be relative to the plugin root`,
    );
  }

  const resolved = path.resolve(rootDir, asset);
  const relativeToRoot = path.relative(rootDir, resolved);

  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    throw new KlairoxError(
      'ASSET_OUTSIDE_PLUGIN',
      `Asset "${asset}" escapes the plugin root "${rootDir}"`,
    );
  }

  return resolved;
}
