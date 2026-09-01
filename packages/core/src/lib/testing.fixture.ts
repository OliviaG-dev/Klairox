import {
  indexManifest,
  parsePluginManifest,
  type PluginManifestInput,
} from '@klairox/plugin-sdk';
import type { LoadedPlugin } from './plugin/plugin-loader.js';
import type { Renderer, RenderRequest } from './render/renderer.types.js';

export const TEST_PLUGIN_ROOT = '/plugins/sample';

/**
 * Builds an in-memory plugin, so the engine tests never touch the file system.
 * The manifest goes through the real parser: defaults and integrity rules apply.
 */
export function createTestPlugin(
  overrides: Partial<PluginManifestInput> = {},
): LoadedPlugin {
  const input: PluginManifestInput = {
    name: 'sample',
    version: '1.0.0',
    canvas: { width: 64, height: 64 },
    layers: [
      {
        id: 'body',
        order: 10,
        required: true,
        options: [
          { id: 'standard', asset: 'layers/body/standard.png' },
          { id: 'heavy', asset: 'layers/body/heavy.png' },
        ],
      },
      {
        id: 'coat',
        order: 20,
        required: true,
        dependsOn: ['body'],
        opacity: 0.9,
        options: [
          { id: 'bay', asset: 'layers/coat/bay.png' },
          { id: 'grey', asset: 'layers/coat/grey.png' },
        ],
      },
      {
        id: 'markings',
        order: 30,
        dependsOn: ['coat'],
        options: [{ id: 'star', asset: 'layers/markings/Standard-OC/star.png' }],
      },
      {
        id: 'equipment',
        order: 40,
        options: [
          { id: 'saddle', asset: 'layers/equipment/saddle.png' },
          { id: 'armor', asset: 'layers/equipment/armor.png' },
        ],
      },
    ],
    ...overrides,
  };

  const parsed = parsePluginManifest(input);
  if (!parsed.ok) {
    throw new Error(
      `Invalid test manifest:\n${parsed.issues.map((i) => `${i.path}: ${i.message}`).join('\n')}`,
    );
  }

  return {
    manifest: parsed.manifest,
    index: indexManifest(parsed.manifest),
    rootDir: TEST_PLUGIN_ROOT,
    manifestPath: `${TEST_PLUGIN_ROOT}/plugin.json`,
  };
}

/** Records the requests it receives and returns deterministic bytes. */
export class FakeRenderer implements Renderer {
  readonly name = 'fake';
  readonly requests: RenderRequest[] = [];

  async render(request: RenderRequest): Promise<Uint8Array> {
    this.requests.push(request);
    return Uint8Array.from([
      request.layers.length,
      request.format === 'webp' ? 1 : 0,
    ]);
  }
}
