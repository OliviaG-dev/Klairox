import { checkManifestIntegrity } from './manifest-integrity.js';
import { pluginManifestSchema } from './manifest.schema.js';
import type { ManifestIssue, ManifestParseResult } from './validation.types.js';

interface SchemaIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/**
 * Validates raw manifest data (parsed JSON or YAML) in two passes: field shapes
 * first, then referential integrity. Zod never leaks past this boundary.
 */
export function parsePluginManifest(input: unknown): ManifestParseResult {
  const parsed = pluginManifestSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map(toManifestIssue) };
  }

  const issues = checkManifestIntegrity(parsed.data);
  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, manifest: parsed.data };
}

function toManifestIssue(issue: SchemaIssue): ManifestIssue {
  return { path: formatPath(issue.path), message: issue.message };
}

function formatPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) {
    return '<root>';
  }

  return path.reduce<string>((accumulator, segment) => {
    if (typeof segment === 'number') {
      return `${accumulator}[${segment}]`;
    }
    return accumulator.length > 0
      ? `${accumulator}.${String(segment)}`
      : String(segment);
  }, '');
}
