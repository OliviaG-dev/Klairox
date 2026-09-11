/**
 * Bakes the Stalloria horse matrix into dist/stalloria/horses.
 *
 * Matrix (constraints applied by the engine):
 *   body:      standard | foal
 *   coat:      all coats
 *   pie:       none | tobiano   (only Stalloria pie for now)
 *   markings:  none | all face markings
 *   equipment: omitted
 *
 * Usage:
 *   node tools/generate-stalloria-assets.mjs
 *   node tools/generate-stalloria-assets.mjs --dry-run
 *   node tools/generate-stalloria-assets.mjs --out path/to/dir
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KlairoxEngine } from '@klairox/core';
import { SharpRenderer } from '@klairox/renderer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_DIR = path.join(ROOT, 'plugins', 'horse');
const DEFAULT_OUT = path.join(ROOT, 'dist', 'stalloria', 'horses');
const CONCURRENCY = 4;

const COATS = [
  'bay',
  'bay-brun',
  'black',
  'chestnut',
  'grey',
  'roan',
  'palomino',
  'isabelle',
  'cream',
];

const MARKINGS = [
  'blaze',
  'thin-blaze',
  'stripe',
  'star',
  'diamond',
  'heart',
  'snip',
  'star-snip',
  'bald',
  'crescent',
];

/** none + tobiano only */
const PIES = [null, 'tobiano'];

/** none + every face marking */
const MARKING_CHOICES = [null, ...MARKINGS];

function parseArgs(argv) {
  let dryRun = false;
  let out = DEFAULT_OUT;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--out') out = path.resolve(argv[++i] ?? DEFAULT_OUT);
  }
  return { dryRun, out };
}

function buildJobs() {
  /** @type {{ name: string, selection: Record<string, string> }[]} */
  const jobs = [];

  for (const body of ['standard', 'foal']) {
    for (const coat of COATS) {
      for (const pie of PIES) {
        for (const marking of MARKING_CHOICES) {
          const pieId = pie ?? 'none';
          const markId = marking ?? 'none';
          const name = `stalloria-${body}-${coat}-pie-${pieId}-mark-${markId}`;

          /** @type {Record<string, string>} */
          const selection = { body, mane: 'short' };

          if (body === 'standard') {
            selection.coat = coat;
            if (pie) selection.pie = pie;
            if (marking) selection.markings = marking;
          } else {
            selection['coat-foal'] = coat;
            if (pie) selection['pie-foal'] = pie;
            if (marking) selection['markings-foal'] = marking;
          }

          jobs.push({ name, selection });
        }
      }
    }
  }

  return jobs;
}

async function mapPool(items, concurrency, mapper) {
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await mapper(items[i], i);
      }
    }),
  );
  return results;
}

async function main() {
  const { dryRun, out } = parseArgs(process.argv.slice(2));
  const jobs = buildJobs();

  console.log('Stalloria horse bake');
  console.log(`  plugin   ${path.relative(ROOT, PLUGIN_DIR)}`);
  console.log(`  out      ${path.relative(ROOT, out)}`);
  console.log(`  planned  ${jobs.length}`);
  console.log(
    `  axes     body(2) × coat(${COATS.length}) × pie(none|tobiano) × markings(none+${MARKINGS.length})`,
  );

  if (dryRun) {
    for (const job of jobs) {
      console.log(`  · ${job.name}`);
    }
    console.log(`Dry-run: ${jobs.length} variants (nothing written)`);
    return;
  }

  const engine = new KlairoxEngine({ renderer: new SharpRenderer() });
  const plugin = await engine.loadPlugin(PLUGIN_DIR);
  await mkdir(out, { recursive: true });

  let generated = 0;
  let failed = 0;
  const failures = [];

  await mapPool(jobs, CONCURRENCY, async (job) => {
    try {
      await engine.generate({
        plugin,
        selection: job.selection,
        outputDir: out,
        name: job.name,
      });
      generated += 1;
      if (generated % 25 === 0 || generated === jobs.length) {
        console.log(`  … ${generated}/${jobs.length}`);
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ name: job.name, message });
      console.error(`  ✗ ${job.name}: ${message}`);
    }
  });

  const manifest = {
    generatedAt: new Date().toISOString(),
    count: generated,
    failed,
    matrix: {
      body: ['standard', 'foal'],
      coat: COATS,
      pie: ['none', 'tobiano'],
      markings: ['none', ...MARKINGS],
    },
    failures,
  };
  await writeFile(
    path.join(out, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  console.log(
    `Done: ${generated} generated, ${failed} failed → ${path.relative(ROOT, out)}`,
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
