import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AssetMetadata } from '../export/metadata.js';

/**
 * Returns true when a previous export for this name still matches `planHash`
 * and every artifact listed in its metadata sidecar is present.
 * Skip caching requires the metadata sidecar (it carries the hash).
 */
export async function isCachedVariant(
  outputDir: string,
  name: string,
  planHash: string,
): Promise<boolean> {
  const metadataPath = path.join(outputDir, `${name}.json`);

  let metadata: AssetMetadata;
  try {
    metadata = JSON.parse(
      await readFile(metadataPath, 'utf8'),
    ) as AssetMetadata;
  } catch {
    return false;
  }

  if (metadata.planHash !== planHash) {
    return false;
  }

  for (const file of metadata.files) {
    try {
      await access(path.join(outputDir, file.file));
    } catch {
      return false;
    }
  }

  return true;
}
