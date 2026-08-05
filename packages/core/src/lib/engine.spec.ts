import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { KlairoxEngine } from './engine.js';
import type { KlairoxEventMap } from './events/engine-events.js';
import { createTestPlugin, FakeRenderer } from './testing.fixture.js';

describe('KlairoxEngine', () => {
  let outputDir: string;
  let renderer: FakeRenderer;
  let engine: KlairoxEngine;

  beforeEach(async () => {
    outputDir = await mkdtemp(path.join(tmpdir(), 'klairox-engine-'));
    renderer = new FakeRenderer();
    engine = new KlairoxEngine({ renderer });
  });

  afterEach(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  it('plans a composition without touching the disk', () => {
    const plan = engine.plan(createTestPlugin(), { coat: 'grey' });

    expect(plan.selection).toEqual({ body: 'standard', coat: 'grey' });
    expect(renderer.requests).toHaveLength(0);
  });

  it('generates the artifacts declared by the plugin', async () => {
    const plugin = createTestPlugin({
      exports: {
        formats: ['png'],
        thumbnail: { width: 16, format: 'png' },
        metadata: true,
      },
    });

    const { artifacts } = await engine.generate({
      plugin,
      outputDir,
      name: 'sample',
    });

    expect(artifacts.map((artifact) => artifact.kind)).toEqual([
      'image',
      'thumbnail',
      'metadata',
    ]);
  });

  it('reports its progress through events', async () => {
    const seen: (keyof KlairoxEventMap)[] = [];
    engine.on('selection:resolved', () => seen.push('selection:resolved'));
    engine.on('composition:planned', () => seen.push('composition:planned'));
    engine.on('asset:exported', () => seen.push('asset:exported'));

    await engine.generate({
      plugin: createTestPlugin(),
      outputDir,
      name: 'sample',
    });

    expect(seen).toEqual([
      'selection:resolved',
      'composition:planned',
      'asset:exported',
    ]);
  });

  it('stops notifying a listener that unsubscribed', async () => {
    let calls = 0;
    const unsubscribe = engine.on('composition:planned', () => {
      calls += 1;
    });

    engine.plan(createTestPlugin());
    unsubscribe();
    engine.plan(createTestPlugin());

    expect(calls).toBe(1);
  });
});
