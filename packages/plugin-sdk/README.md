# @klairox/plugin-sdk

The contract between [Klairox](../../README.md) and the plugins it loads.

This package owns the shape of a plugin manifest and knows nothing about rendering, files or
asset types. Everything else in the workspace depends on it; it depends on nothing.

```ts
import { parsePluginManifest, definePlugin } from '@klairox/plugin-sdk';

const result = parsePluginManifest(JSON.parse(raw));

if (!result.ok) {
  for (const issue of result.issues) {
    console.error(`${issue.path}: ${issue.message}`);
  }
}
```

Validation runs in two passes: field shapes against the schema, then referential integrity
(unique ids, layers referenced by constraints, dependency cycles). Every problem is reported
at once, and Zod never leaks into the returned result.

`definePlugin()` gives autocompletion when a manifest is written in TypeScript, and
`pluginManifestJsonSchema()` emits the JSON Schema used to validate `plugin.json` in editors.

See [docs/plugins.md](../../docs/plugins.md) for the manifest reference.
