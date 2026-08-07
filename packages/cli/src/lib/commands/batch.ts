import { KlairoxEngine } from '@klairox/core';
import { SharpRenderer } from '@klairox/renderer';
import type { CliOptions } from '../args.js';
import { style } from '../styles.js';

export async function runBatch(options: CliOptions): Promise<void> {
  const renderer = new SharpRenderer({ quality: options.quality });
  const engine = new KlairoxEngine({ renderer });
  const plugin = await engine.loadPlugin(options.pluginDir);

  const result = await engine.batch({
    plugin,
    outputDir: options.outputDir,
    formats: options.formats,
    thumbnail: options.thumbnail ? undefined : false,
    metadata: options.metadata ? undefined : false,
    dryRun: options.dryRun,
    force: options.force,
    concurrency: options.concurrency,
    variants: {
      axes: options.axes.length > 0 ? options.axes : undefined,
      include: options.selection,
      nameTemplate: options.name,
    },
  });

  console.log(
    `${style.bold(plugin.manifest.name)} ${style.dim(`v${plugin.manifest.version}`)} ` +
      `${style.dim(`- batch via ${renderer.name}`)}`,
  );

  console.log(style.bold('\nVariants'));
  console.log(`  axes       ${style.cyan(result.config.axes.join(' × '))}`);
  console.log(`  planned    ${result.jobs.length}`);
  if (result.rejected.length > 0) {
    console.log(`  rejected   ${style.dim(String(result.rejected.length))}`);
  }

  for (const entry of result.results) {
    const mark =
      entry.status === 'generated'
        ? style.green('+')
        : entry.status === 'cached'
          ? style.dim('·')
          : style.cyan('○');
    console.log(
      `  ${mark} ${entry.job.name} ${style.dim(`(${entry.status})`)}`,
    );
  }

  if (result.rejected.length > 0) {
    console.log(style.bold('\nRejected'));
    for (const rejection of result.rejected) {
      const combo = formatSelection(rejection.requested);
      console.log(`  ${style.dim('-')} ${combo}`);
      console.log(`    ${style.dim(rejection.reason)}`);
    }
  }

  const generated = result.results.filter(
    (entry) => entry.status === 'generated',
  ).length;
  const cached = result.results.filter(
    (entry) => entry.status === 'cached',
  ).length;
  const planned = result.results.filter(
    (entry) => entry.status === 'planned',
  ).length;

  console.log(style.bold('\nSummary'));
  if (options.dryRun) {
    console.log(`  ${planned} planned (dry-run, nothing written)`);
  } else {
    console.log(`  ${style.green(String(generated))} generated`);
    if (cached > 0) {
      console.log(`  ${style.dim(String(cached))} cached`);
    }
  }
  if (result.rejected.length > 0) {
    console.log(`  ${result.rejected.length} rejected`);
  }
  if (!options.dryRun) {
    console.log(`  ${style.dim(`out ${options.outputDir}`)}`);
  }
}

function formatSelection(
  selection: Readonly<Record<string, string | undefined>>,
): string {
  return Object.entries(selection)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([layerId, optionId]) => `${layerId}=${optionId}`)
    .join(' ');
}
