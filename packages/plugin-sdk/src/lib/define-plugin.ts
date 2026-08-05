import { z } from 'zod';
import { pluginManifestSchema } from './manifest.schema.js';
import type { PluginManifestInput } from './manifest.types.js';

/**
 * Identity helper that gives plugin authors autocompletion and type checking when
 * they write a manifest in TypeScript instead of JSON/YAML.
 */
export function definePlugin(
  manifest: PluginManifestInput,
): PluginManifestInput {
  return manifest;
}

/**
 * JSON Schema for `plugin.json`, so editors can validate and autocomplete manifests.
 * Uses the input shape: fields with defaults stay optional.
 */
export function pluginManifestJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(pluginManifestSchema, { io: 'input' }) as Record<
    string,
    unknown
  >;
}
