import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlugin } from './plugin-loader.js';

const EXAMPLE_PLUGIN_DIR = fileURLToPath(
  new URL('../../../../../plugins/horse', import.meta.url),
);

const MINIMAL_MANIFEST = {
  name: 'sample',
  version: '1.0.0',
  canvas: { width: 32, height: 32 },
  layers: [
    { id: 'body', order: 10, options: [{ id: 'standard', asset: 'body.png' }] },
  ],
};

describe('loadPlugin', () => {
  const createdDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      createdDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function writePluginDir(
    manifest: unknown,
    options: { fileName?: string; assets?: readonly string[] } = {},
  ): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'klairox-plugin-'));
    createdDirs.push(dir);

    const fileName = options.fileName ?? 'plugin.json';
    const serialised =
      typeof manifest === 'string' ? manifest : JSON.stringify(manifest);
    await writeFile(path.join(dir, fileName), serialised, 'utf8');

    for (const asset of options.assets ?? []) {
      const filePath = path.join(dir, asset);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, '', 'utf8');
    }

    return dir;
  }

  it('loads the bundled horse example', async () => {
    const plugin = await loadPlugin(EXAMPLE_PLUGIN_DIR);

    expect(plugin.manifest.name).toBe('horse');
    expect(plugin.manifest.layers).toHaveLength(5);
    expect(plugin.manifest.constraints).toHaveLength(4);
    expect(plugin.index.layers.get('coat')?.options).toHaveLength(8);
  });

  it('reads a YAML manifest', async () => {
    const yaml = [
      'name: sample',
      'version: 1.0.0',
      'canvas:',
      '  width: 32',
      '  height: 32',
      'layers:',
      '  - id: body',
      '    order: 10',
      '    options:',
      '      - id: standard',
      '        asset: body.png',
    ].join('\n');

    const dir = await writePluginDir(yaml, {
      fileName: 'plugin.yaml',
      assets: ['body.png'],
    });

    await expect(loadPlugin(dir)).resolves.toMatchObject({
      manifest: { name: 'sample' },
    });
  });

  it('fails when the directory holds no manifest', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'klairox-empty-'));
    createdDirs.push(dir);

    await expect(loadPlugin(dir)).rejects.toMatchObject({
      code: 'PLUGIN_NOT_FOUND',
    });
  });

  it('fails when the manifest cannot be parsed', async () => {
    const dir = await writePluginDir('{ not json');

    await expect(loadPlugin(dir)).rejects.toMatchObject({
      code: 'MANIFEST_UNREADABLE',
    });
  });

  it('lists every validation issue at once', async () => {
    const dir = await writePluginDir({
      ...MINIMAL_MANIFEST,
      name: 'Not Kebab',
      version: 'v1',
    });

    await expect(loadPlugin(dir)).rejects.toMatchObject({
      code: 'MANIFEST_INVALID',
      details: [
        'name: must be kebab-case (a-z, 0-9, dashes)',
        'version: must be a semver version',
      ],
    });
  });

  it('lists every missing asset at once', async () => {
    const dir = await writePluginDir(MINIMAL_MANIFEST);

    await expect(loadPlugin(dir)).rejects.toMatchObject({
      code: 'ASSET_NOT_FOUND',
      details: ['body:standard -> body.png'],
    });
  });

  it('skips the asset check when the caller opts out', async () => {
    const dir = await writePluginDir(MINIMAL_MANIFEST);

    await expect(
      loadPlugin(dir, { verifyAssets: false }),
    ).resolves.toMatchObject({
      manifest: { name: 'sample' },
    });
  });

  it('refuses an asset that escapes the plugin root', async () => {
    const dir = await writePluginDir({
      ...MINIMAL_MANIFEST,
      layers: [
        {
          id: 'body',
          order: 10,
          options: [{ id: 'standard', asset: '../../etc/passwd' }],
        },
      ],
    });

    await expect(loadPlugin(dir)).rejects.toMatchObject({
      code: 'ASSET_OUTSIDE_PLUGIN',
    });
  });
});
