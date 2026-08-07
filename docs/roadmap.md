# Roadmap

Where the project stands and what comes next. Each phase is meant to be shippable on its own.

## Done

### Phase 1 — Foundation

- Nx monorepo with four buildable, publishable packages and enforced dependency boundaries.
- Plugin contract: manifest schema, strict validation, TypeScript types and a generated
  JSON Schema, all from a single Zod definition.
- Plugin loader for JSON and YAML, with asset verification and a path-traversal guard.
- Composition engine producing a serialisable, deterministic render plan.
- `Renderer` port with a Sharp implementation: offsets, per-layer opacity, blend modes,
  PNG and WebP output, thumbnails.
- Export manager: images, thumbnail and a timestamp-free metadata sidecar.
- Typed event bus so the engine can be driven from any host.

### Phase 2 — Rules

- Constraints: `disable`, `hide` and `require`, matching single values or lists.
- Layer dependencies with cycle detection, driving both resolution order and defaults.
- Errors that collect every problem at once and name the rule that refused a request.

### Phase 3 — CLI

- `klairox generate`, `validate` and `info`, with per-layer selection and export overrides.

### Phase 4 — Variants and batch generation

- A `variants` section in the manifest describing axes to expand (coat × equipment).
- `klairox batch` to generate the full matrix, with a naming template for the output files.
- Skip work whose inputs have not changed, using the plan hash stored in the metadata sidecar.
- Parallel rendering with a bounded async worker pool (`--concurrency`).

## Next

### Phase 4b — Sprite sheets

- A sprite-sheet exporter with its atlas JSON.

### Phase 5 — Projects and templates

Users should open a project, not a plugin.

- `project.yaml` referencing plugins, export presets and output directories.
- `klairox init` scaffolding a project or a new plugin from a template.
- Starter templates: character RPG, monster generator, horse game.
- Resolve plugins from `node_modules` in addition to local paths.

### Phase 6 — Web editor

Only worth building once the engine is stable, which is the point of doing it last.

- Angular application consuming `@klairox/core` directly, driven by the event bus.
- Layer panel generated from the manifest, with disabled options greyed out live.
- Real-time preview: the plan is already cheap to recompute, so the preview can be immediate.
- Undo/redo over the selection, drag-and-drop layer reordering, dark mode.
- A browser renderer (Canvas or WebGL) implementing the same `Renderer` port, so the editor
  previews without a server round trip.

### Phase 7 — Open source release

- Publish the four packages to npm under the `@klairox` scope, with `nx release`.
- `CONTRIBUTING.md`, issue templates, a code of conduct.
- A documentation site, with a plugin authoring tutorial.
- Replace the placeholder artwork with a properly drawn example plugin.

### Phase 8 — Ecosystem

- Distribute a plugin as an archive and install it with `klairox plugin add`.
- Plugin signing and integrity checks.
- A registry, which the architecture already allows even if it is never built.

## Known limitations

Deliberate gaps in the current implementation, each cheap to lift when needed:

- **Offsets must be non-negative** and layer artwork must fit inside the canvas. Supporting
  negative offsets means pre-cropping the layer before compositing.
- **No layer transforms.** No rotation, scale or flip; artwork is composited as authored.
- **PNG and WebP only.** AVIF and raw output would be a few lines in the Sharp adapter.
- **No colour tinting.** Recolouring a shared silhouette at render time would remove a lot of
  duplicated artwork, but it needs a tint operation in the `Renderer` port.
- **Constraints are one level deep.** A constraint reacts to a selection; it cannot react to
  another constraint's effect. Deliberate, to keep evaluation predictable and cycle-free.
- **The plugin loader reads from disk.** A virtual file system would let the browser editor
  load plugins over HTTP.
- **Batch skip-cache needs metadata.** `--no-metadata` disables plan-hash caching because the
  sidecar is where the hash lives.
