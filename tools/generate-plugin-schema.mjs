/**
 * Emits the JSON Schema of `plugin.json` so editors can validate and autocomplete
 * manifests. The schema is derived from the same Zod definitions the engine uses,
 * so it can never drift from the runtime validation.
 *
 * Usage: node tools/generate-plugin-schema.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pluginManifestJsonSchema } from '@klairox/plugin-sdk';

const OUTPUT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'schemas',
  'plugin.schema.json',
);

const schema = {
  $id: 'https://klairox.dev/schemas/plugin.schema.json',
  title: 'Klairox plugin manifest',
  ...pluginManifestJsonSchema(),
};

await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(schema, null, 2)}\n`, 'utf8');

console.log(`Wrote ${OUTPUT_PATH}`);
