import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { KlairoxError } from '../errors.js';

/** Looked up in order; the first one that exists wins. */
export const MANIFEST_FILE_NAMES = [
  'plugin.json',
  'plugin.yaml',
  'plugin.yml',
] as const;

export interface ManifestSource {
  readonly filePath: string;
  readonly data: unknown;
}

/** Reads and deserialises a plugin manifest without validating its content. */
export async function readManifestSource(
  pluginDir: string,
): Promise<ManifestSource> {
  for (const fileName of MANIFEST_FILE_NAMES) {
    const filePath = path.join(pluginDir, fileName);
    const raw = await readFileIfExists(filePath);

    if (raw !== undefined) {
      return { filePath, data: deserialize(raw, filePath) };
    }
  }

  throw new KlairoxError(
    'PLUGIN_NOT_FOUND',
    `No plugin manifest found in "${pluginDir}"`,
    { details: MANIFEST_FILE_NAMES.map((name) => `expected ${name}`) },
  );
}

async function readFileIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (isFileNotFound(error)) {
      return undefined;
    }
    throw new KlairoxError('MANIFEST_UNREADABLE', `Cannot read "${filePath}"`, {
      cause: error,
    });
  }
}

function deserialize(raw: string, filePath: string): unknown {
  try {
    return filePath.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new KlairoxError(
      'MANIFEST_UNREADABLE',
      `Cannot parse "${filePath}": ${reason}`,
      {
        cause: error,
      },
    );
  }
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
}
