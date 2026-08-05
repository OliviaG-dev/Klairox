# Writing a plugin

A plugin is a directory. It holds a manifest and some images, and nothing else. There is no
build step, no code and no dependency on Klairox.

```
my-plugin/
  plugin.json          # or plugin.yaml / plugin.yml
  layers/
    <layer>/<option>.png
```

Validate it at any time:

```bash
npx klairox validate my-plugin
npx klairox info my-plugin
```

For autocompletion and inline validation in your editor, generate the JSON Schema once
(`npm run schema`) and point the manifest at it:

```json
{ "$schema": "../../schemas/plugin.schema.json" }
```

## Manifest reference

### Top level

| Field         | Type       | Required | Notes                                             |
| ------------- | ---------- | -------- | ------------------------------------------------- |
| `name`        | identifier | yes      | Kebab-case. Used as the default output file name. |
| `version`     | string     | yes      | Semver, e.g. `1.0.0`.                             |
| `title`       | string     | no       | Human-readable name shown by tools.               |
| `description` | string     | no       |                                                   |
| `author`      | string     | no       |                                                   |
| `license`     | string     | no       |                                                   |
| `canvas`      | object     | yes      | Output dimensions, see below.                     |
| `layers`      | array      | yes      | At least one layer.                               |
| `constraints` | array      | no       | Defaults to `[]`.                                 |
| `exports`     | object     | no       | Defaults to a single PNG plus metadata.           |

Identifiers (`name`, layer ids, option ids) are kebab-case: lowercase letters, digits and
dashes. Unknown keys are rejected, so a typo fails loudly instead of being ignored.

### `canvas`

| Field        | Type   | Required | Notes                                           |
| ------------ | ------ | -------- | ----------------------------------------------- |
| `width`      | int    | yes      | Positive.                                       |
| `height`     | int    | yes      | Positive.                                       |
| `background` | string | no       | `#RRGGBB` or `#RRGGBBAA`. Transparent if unset. |

Every layer image must fit inside the canvas at its offset. Oversized artwork is reported with
its dimensions and the layer it belongs to.

### `layers[]`

| Field       | Type       | Default  | Notes                                                           |
| ----------- | ---------- | -------- | --------------------------------------------------------------- |
| `id`        | identifier | —        | Unique across the manifest.                                     |
| `title`     | string     | —        | Shown by `info` and by editors.                                 |
| `order`     | int        | —        | Stacking order; lower is painted first.                         |
| `required`  | boolean    | `false`  | Required layers always end up in the output.                    |
| `dependsOn` | id[]       | `[]`     | Layers resolved before this one. Cycles are rejected.           |
| `opacity`   | 0–1        | `1`      | Applied to the whole layer.                                     |
| `blendMode` | enum       | `normal` | `normal`, `multiply`, `screen`, `overlay`, `darken`, `lighten`. |
| `offset`    | `{x, y}`   | `{0, 0}` | Non-negative pixel offset from the top-left corner.             |
| `options[]` | array      | —        | At least one option.                                            |

### `layers[].options[]`

| Field   | Type       | Default | Notes                                         |
| ------- | ---------- | ------- | --------------------------------------------- |
| `id`    | identifier | —       | Unique within the layer.                      |
| `title` | string     | —       |                                               |
| `asset` | string     | —       | Path relative to the plugin root. Must exist. |
| `tags`  | string[]   | `[]`    | Free-form; useful for grouping and filtering. |

### `constraints[]`

| Field         | Type         | Default | Notes                                       |
| ------------- | ------------ | ------- | ------------------------------------------- |
| `id`          | string       | —       | Used in error messages. Give one.           |
| `description` | string       | —       | Explains the rule to humans.                |
| `when`        | object       | —       | Condition, see below. At least one entry.   |
| `disable`     | target ref[] | `[]`    | Options or layers that become unselectable. |
| `hide`        | layer id[]   | `[]`    | Layers excluded from the render.            |
| `require`     | target ref[] | `[]`    | Choices that must be made.                  |

A **target ref** is either a layer id (`equipment`) or a layer and one of its options
(`equipment:saddle`). `hide` only accepts layer ids.

`when` maps layer ids to the option that must be selected. A list means "any of these":

```json
{ "when": { "coat": ["bay", "black"] } }
```

All entries must match for the constraint to apply, and a layer that is not selected never
matches.

### `exports`

| Field       | Type                | Default   | Notes                                             |
| ----------- | ------------------- | --------- | ------------------------------------------------- |
| `formats`   | `("png"\|"webp")[]` | `["png"]` | One file per format.                              |
| `thumbnail` | object              | —         | `{ width, height?, format? }`. Skipped if absent. |
| `metadata`  | boolean             | `true`    | Writes a `.json` sidecar next to the images.      |

The thumbnail keeps the canvas aspect ratio when `height` is omitted, and is never upscaled.
The CLI can override all of these with `--format`, `--no-thumbnail` and `--no-metadata`.

## Rules of thumb

**Model the real dependencies.** If choosing a body should restrict the available coats, say
`"dependsOn": ["body"]` on the coat layer. That single line is what lets the engine pick
sensible defaults and lets an editor grey out impossible combinations.

**Prefer `hide` to `disable` for occlusion.** Armour covering the ears is not a forbidden
combination; it is a combination where one layer is not visible. Keeping it in the selection
means the metadata still records what was chosen.

**Always give a constraint an `id` and a `description`.** They are what users see when the
engine refuses their request.

**Keep each option's artwork on the full canvas.** Exporting every layer at the canvas size
with transparency around it is the simplest thing that works, and sidesteps offsets entirely.

## Complete example

The bundled [`plugins/horse`](../plugins/horse) plugin exercises every feature: dependencies
between layers, per-layer opacity, an occlusion rule (`hide`), an option disabled by an
upstream choice, and multi-format export with a thumbnail. Its placeholder artwork is
generated by `tools/generate-example-assets.mjs`, so you can regenerate or replace it freely.

## YAML

The manifest may be written as `plugin.yaml` or `plugin.yml` instead. Same schema, same
validation:

```yaml
name: horse
version: 1.0.0
canvas:
  width: 512
  height: 512
layers:
  - id: body
    order: 10
    required: true
    options:
      - id: standard
        asset: layers/body/standard.png
```
