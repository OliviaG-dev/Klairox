import { loadPlugin } from '@klairox/core';
import type { CliOptions } from '../args.js';
import { style } from '../styles.js';

export async function runValidate(options: CliOptions): Promise<void> {
  const plugin = await loadPlugin(options.pluginDir);
  const { manifest } = plugin;

  const optionCount = manifest.layers.reduce(
    (total, layer) => total + layer.options.length,
    0,
  );

  console.log(
    `${style.green('valid')} ${style.bold(manifest.name)} ${style.dim(`v${manifest.version}`)}`,
  );
  console.log(style.dim(`  manifest    ${plugin.manifestPath}`));
  console.log(style.dim(`  layers      ${manifest.layers.length}`));
  console.log(style.dim(`  options     ${optionCount} (all assets found)`));
  console.log(style.dim(`  constraints ${manifest.constraints.length}`));
}
