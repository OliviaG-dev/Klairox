import { readFileSync } from 'node:fs';

/** Reads the version from the package manifest that ships next to the built CLI. */
export function readCliVersion(): string {
  const packageJsonUrl = new URL('../../package.json', import.meta.url);
  const parsed: unknown = JSON.parse(readFileSync(packageJsonUrl, 'utf8'));

  if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
    return String((parsed as { version: unknown }).version);
  }

  return '0.0.0';
}
