import { KlairoxEngine } from '@klairox/core';
import { SharpRenderer } from '@klairox/renderer';
import type { CliOptions } from '../args.js';
import { printArtifacts, printSelection } from '../output.js';
import { style } from '../styles.js';

export async function runGenerate(options: CliOptions): Promise<void> {
  const renderer = new SharpRenderer({ quality: options.quality });
  const engine = new KlairoxEngine({ renderer });

  const plugin = await engine.loadPlugin(options.pluginDir);
  const { plan, artifacts } = await engine.generate({
    plugin,
    selection: options.selection,
    outputDir: options.outputDir,
    name: options.name ?? plugin.manifest.name,
    formats: options.formats,
    thumbnail: options.thumbnail ? undefined : false,
    metadata: options.metadata ? undefined : false,
  });

  console.log(
    `${style.bold(plugin.manifest.name)} ${style.dim(`v${plugin.manifest.version}`)} ` +
      `${style.dim(`- ${plan.layers.length} layer(s) via ${renderer.name}`)}`,
  );
  printSelection(plan);
  printArtifacts(artifacts, process.cwd());
}
