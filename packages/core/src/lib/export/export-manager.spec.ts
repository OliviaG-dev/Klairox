import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ExportsConfig } from '@klairox/plugin-sdk';
import { buildCompositionPlan } from '../composition/composition-engine.js';
import { createTestPlugin, FakeRenderer } from '../testing.fixture.js';
import { exportComposition } from './export-manager.js';

const DEFAULT_EXPORTS: ExportsConfig = { formats: ['png'], metadata: true };

describe('exportComposition', () => {
  let outputDir: string;
  let renderer: FakeRenderer;

  beforeEach(async () => {
    outputDir = await mkdtemp(path.join(tmpdir(), 'klairox-export-'));
    renderer = new FakeRenderer();
  });

  afterEach(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  function exportPlan(
    defaults: ExportsConfig,
    options: Record<string, unknown> = {},
  ) {
    return exportComposition({
      plan: buildCompositionPlan(createTestPlugin()),
      renderer,
      defaults,
      options: { outputDir, name: 'sample', ...options },
    });
  }

  it('writes one image per declared format plus the metadata sidecar', async () => {
    const artifacts = await exportPlan({
      formats: ['png', 'webp'],
      metadata: true,
    });

    expect(
      artifacts.map((artifact) => path.basename(artifact.filePath)),
    ).toEqual(['sample.png', 'sample.webp', 'sample.json']);
  });

  it('renders a downscaled thumbnail when the plugin declares one', async () => {
    const artifacts = await exportPlan({
      formats: ['png'],
      metadata: false,
      thumbnail: { width: 32, format: 'png' },
    });

    expect(artifacts.map((artifact) => artifact.kind)).toEqual([
      'image',
      'thumbnail',
    ]);
    expect(renderer.requests.at(-1)?.resizeTo).toEqual({
      width: 32,
      height: undefined,
    });
  });

  it('lets the caller turn the thumbnail off', async () => {
    const artifacts = await exportPlan(
      {
        formats: ['png'],
        metadata: false,
        thumbnail: { width: 32, format: 'png' },
      },
      { thumbnail: false },
    );

    expect(artifacts.map((artifact) => artifact.kind)).toEqual(['image']);
  });

  it('lets the caller override the formats declared by the plugin', async () => {
    const artifacts = await exportPlan(DEFAULT_EXPORTS, {
      formats: ['webp'],
      metadata: false,
    });

    expect(artifacts.map((artifact) => artifact.format)).toEqual(['webp']);
  });

  it('describes the produced files in the metadata sidecar', async () => {
    const artifacts = await exportPlan({ formats: ['png'], metadata: true });
    const metadataPath = artifacts.at(-1)?.filePath ?? '';
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));

    expect(metadata).toMatchObject({
      generator: 'klairox',
      plugin: { name: 'sample', version: '1.0.0' },
      selection: { body: 'standard', coat: 'bay' },
      files: [{ kind: 'image', file: 'sample.png' }],
    });
  });

  it('wraps a renderer failure into a RENDER_FAILED error', async () => {
    renderer.render = async () => {
      throw new Error('libvips exploded');
    };

    await expect(exportPlan(DEFAULT_EXPORTS)).rejects.toMatchObject({
      code: 'RENDER_FAILED',
    });
  });
});
