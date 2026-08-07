# @klairox/cli

Command line interface for [Klairox](../../README.md).

```bash
klairox info plugins/horse       # list layers, options and constraints
klairox validate plugins/horse   # check the manifest and every declared asset
klairox generate plugins/horse --select coat=bay --out dist/assets
klairox batch plugins/horse --out dist/batch
```

Run `klairox --help` for the full list of options.

This package is the composition root: it is the only place that picks a renderer and wires it
into the engine. It exits with `0` on success, `1` on a generation failure and `2` on a usage
error, so it drops into a build pipeline cleanly.
