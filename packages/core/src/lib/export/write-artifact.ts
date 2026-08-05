import { mkdir, writeFile } from 'node:fs/promises';
import { KlairoxError } from '../errors.js';

export async function ensureOutputDir(outputDir: string): Promise<void> {
  try {
    await mkdir(outputDir, { recursive: true });
  } catch (error) {
    throw new KlairoxError(
      'EXPORT_FAILED',
      `Cannot create output directory "${outputDir}"`,
      {
        cause: error,
      },
    );
  }
}

export async function writeArtifact(
  filePath: string,
  contents: Uint8Array | string,
): Promise<void> {
  try {
    await writeFile(filePath, contents);
  } catch (error) {
    throw new KlairoxError('EXPORT_FAILED', `Cannot write "${filePath}"`, {
      cause: error,
    });
  }
}
