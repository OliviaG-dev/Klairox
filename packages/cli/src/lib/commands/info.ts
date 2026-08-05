import { loadPlugin, resolveLayerOrder } from '@klairox/core';
import type { CliOptions } from '../args.js';
import { style } from '../styles.js';

export async function runInfo(options: CliOptions): Promise<void> {
  const { manifest } = await loadPlugin(options.pluginDir, {
    verifyAssets: false,
  });

  console.log(
    `${style.bold(manifest.title ?? manifest.name)} ${style.dim(`v${manifest.version}`)}`,
  );
  if (manifest.description !== undefined) {
    console.log(style.dim(manifest.description));
  }
  console.log(
    style.dim(`canvas ${manifest.canvas.width}x${manifest.canvas.height}`),
  );

  console.log(style.bold('\nLayers'), style.dim('(in resolution order)'));
  for (const layer of resolveLayerOrder(manifest)) {
    const flags = [
      layer.required ? 'required' : 'optional',
      `order ${layer.order}`,
      layer.dependsOn.length > 0
        ? `after ${layer.dependsOn.join(', ')}`
        : undefined,
    ].filter((flag): flag is string => flag !== undefined);

    console.log(
      `  ${style.cyan(layer.id)} ${style.dim(`[${flags.join(', ')}]`)}`,
    );
    console.log(`    ${layer.options.map((option) => option.id).join('  ')}`);
  }

  if (manifest.constraints.length === 0) {
    return;
  }

  console.log(style.bold('\nConstraints'));
  for (const constraint of manifest.constraints) {
    const conditions = Object.entries(constraint.when)
      .map(([layerId, expected]) => `${layerId}=${[expected].flat().join('|')}`)
      .join(' and ');

    const effects = [
      constraint.disable.length > 0
        ? `disable ${constraint.disable.join(', ')}`
        : undefined,
      constraint.hide.length > 0
        ? `hide ${constraint.hide.join(', ')}`
        : undefined,
      constraint.require.length > 0
        ? `require ${constraint.require.join(', ')}`
        : undefined,
    ].filter((effect): effect is string => effect !== undefined);

    console.log(`  when ${style.cyan(conditions)} -> ${effects.join('; ')}`);
    if (constraint.description !== undefined) {
      console.log(style.dim(`    ${constraint.description}`));
    }
  }
}
