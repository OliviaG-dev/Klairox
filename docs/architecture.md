# Architecture

## The three roles

Klairox separates three concerns that most asset generators mix together.

| Role         | Package               | Knows about                                    |
| ------------ | --------------------- | ---------------------------------------------- |
| **Contract** | `@klairox/plugin-sdk` | What a manifest may contain. Nothing else.     |
| **Engine**   | `@klairox/core`       | The contract. No asset type, no rendering API. |
| **Adapter**  | `@klairox/renderer`   | The engine's `Renderer` port and libvips.      |
| **App**      | `@klairox/cli`        | All of the above; it is the composition root.  |

Each package carries an Nx tag (`type:contract`, `type:engine`, `type:adapter`, `type:app`)
and `@nx/enforce-module-boundaries` rejects any import that points the wrong way. The layering
is not a convention, it is a lint error.

A plugin is not in this table on purpose: it is data, validated by the contract, and it never
takes part in the build.

## The pipeline

A generation is five steps, each a pure function of the previous one until the last.

```
plugin directory
      │  loadPlugin
      ▼
LoadedPlugin ─── manifest validated, assets verified, lookup tables built
      │  resolveSelection
      ▼
Selection ────── defaults filled in, constraints applied, violations rejected
      │  buildCompositionPlan
      ▼
CompositionPlan ─ ordered list of images to paint, plain serialisable data
      │  toRenderRequest + Renderer.render
      ▼
bytes ────────── one buffer per requested format
      │  exportComposition
      ▼
files ────────── images, thumbnail, metadata sidecar
```

Everything up to `CompositionPlan` is synchronous, pure and free of I/O. That is what makes a
live editor preview cheap: recomputing a plan on every click costs nothing, and only the final
rasterisation is expensive.

## Resolving a selection

This is where the plugin's rules actually bite. Layers are walked in **dependency order**, not
stacking order, and constraints are re-evaluated at each step:

1. Reject anything the caller asked for that the manifest does not declare, listing the
   available options.
2. For each layer, in `dependsOn` order:
   - evaluate the constraints against the selection resolved **so far**;
   - if the caller picked an option, reject it when a constraint disables it;
   - otherwise, if the layer is `required`, take its first option that is still enabled;
   - otherwise leave the layer unset.
3. Re-evaluate the constraints on the finished selection and reject unmet `require` rules.

Because upstream layers are resolved first, a constraint triggered by an upstream choice is
already in force when the engine picks a downstream default. Choosing the heavy build can
therefore change which coats are offered, without the plugin containing a line of code.

Within the constraints imposed by `dependsOn`, resolution follows the `order` the author
declared, so the behaviour matches what someone reading the manifest top to bottom expects.

### `order` versus `dependsOn`

Two orderings, deliberately distinct:

- `order` is the **z-index**: lower values are painted first.
- `dependsOn` is the **resolution order**: which choices must be known before this one.

A layer can be painted last and resolved first. Conflating the two would make either the
stacking or the rules wrong.

## Constraints

A constraint matches when every entry of its `when` clause matches the current selection.
A value may be a single option id or a list, in which case any of them matches. A matching
constraint can:

- `disable` a target — an option (`markings:star`) or a whole layer (`equipment`);
- `hide` a layer, which removes it from the render while keeping it in the selection;
- `require` a target, which fails the generation if it is not selected.

Disabling and hiding are different on purpose. A disabled option cannot be chosen; a hidden
layer was chosen and is simply not painted, which is what "the helmet covers the ears" means.

Every constraint carries the id or description that triggered it into the error message, so a
rejection says _which rule_ refused the request rather than just "invalid selection".

## Rendering is a port

The core defines a single interface:

```ts
interface Renderer {
  readonly name: string;
  render(request: RenderRequest): Promise<Uint8Array>;
}
```

`RenderRequest` carries absolute file paths, offsets, opacities, blend modes and a target
format. It contains no plugin concepts and no Sharp types. `@klairox/renderer` implements it
with libvips; a Canvas, WebGL or PixiJS backend can be dropped in without touching the core.
The return type is `Uint8Array` rather than `Buffer` so a browser implementation stays possible.

Two details the Sharp adapter has to handle that are worth knowing:

- **Opacity is baked in.** Sharp has no per-composite opacity, so a partially transparent layer
  gets its alpha channel multiplied before it is composited.
- **Thumbnails are a second pass.** Sharp resizes before compositing within a single pipeline,
  so the thumbnail is produced from the already-composed image rather than from the same
  pipeline.

## Determinism

Identical inputs produce byte-identical outputs. Layer ordering breaks ties on layer id, the
selection resolution is deterministic, and the metadata sidecar deliberately contains no
timestamp. Asset pipelines can therefore cache on content and diffs stay meaningful.

## Errors

Every failure is a `KlairoxError` carrying a stable machine-readable `code`
(`MANIFEST_INVALID`, `ASSET_NOT_FOUND`, `SELECTION_INVALID`, `CONSTRAINT_VIOLATION`,
`RENDER_FAILED`, ...) and a list of `details`.

Problems are collected rather than thrown one at a time: an invalid manifest reports every
issue at once, and a plugin with missing artwork lists every missing file. Fixing a plugin is
one pass, not a game of whack-a-mole.

## Events

The engine exposes a typed event bus (`plugin:loaded`, `selection:resolved`,
`composition:planned`, `asset:rendered`, `asset:exported`) instead of being coupled to a host.
The same core drives the CLI today and can drive an Angular editor, a React app or a desktop
shell without modification. A listener that throws does not prevent the other listeners from
running; the failures are collected and reported together.

## Security

Plugins are untrusted data, so:

- asset paths are resolved against the plugin root and rejected if they escape it or are
  absolute;
- manifests are validated against a strict schema that rejects unknown keys;
- nothing in a plugin is ever executed — a plugin cannot contain code by design.

## Notable decisions

**Zod as the single source of truth.** The manifest schema, the TypeScript types and the
published JSON Schema all come from one definition, so they cannot drift. Zod never leaks past
the SDK boundary: `parsePluginManifest` returns a plain result object.

**Validation in two passes.** Field shapes are checked by the schema; uniqueness, referential
integrity between layers, options and constraints, and dependency cycles are checked
afterwards by a pure function. Expressing the second pass in the schema would have made it
unreadable.

**Export orchestration lives in the core.** Rendering produces bytes; deciding which files to
write, naming them and building the metadata sidecar is engine logic. A separate `exporters`
package would only have moved three functions behind another boundary.

**Buildable packages.** Every package has its own build and is publishable to npm, which is the
point of a framework, and gives Nx precise cache boundaries.
