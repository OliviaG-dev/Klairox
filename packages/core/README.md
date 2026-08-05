# @klairox/core

The [Klairox](../../README.md) engine: it loads plugins, resolves selections against their
rules, plans a composition and exports the result.

It contains no rendering code. Rasterisation happens behind the `Renderer` port, which
[`@klairox/renderer`](../renderer) implements with Sharp.

```ts
import { KlairoxEngine } from '@klairox/core';
import { SharpRenderer } from '@klairox/renderer';

const engine = new KlairoxEngine({ renderer: new SharpRenderer() });
const plugin = await engine.loadPlugin('plugins/horse');

await engine.generate({
  plugin,
  selection: { coat: 'grey' },
  outputDir: 'dist/assets',
  name: 'grey-horse',
});
```

The lower-level pieces are exported too, and everything up to the composition plan is pure and
synchronous — useful for a live preview:

```ts
import {
  loadPlugin,
  buildCompositionPlan,
  toRenderRequest,
} from '@klairox/core';

const plan = buildCompositionPlan(plugin, { coat: 'grey' });
const bytes = await renderer.render(toRenderRequest(plan, 'png'));
```

Subscribe to `plugin:loaded`, `selection:resolved`, `composition:planned`, `asset:rendered`
and `asset:exported` to drive a UI without polling.

See [docs/architecture.md](../../docs/architecture.md) for the pipeline in detail.
