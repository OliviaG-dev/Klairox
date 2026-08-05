import type { PluginManifestInput } from './manifest.types.js';

/** Minimal but complete manifest used across the test suites. */
export function createManifestInput(
  overrides: Partial<PluginManifestInput> = {},
): PluginManifestInput {
  return {
    name: 'sample',
    version: '1.0.0',
    canvas: { width: 64, height: 64 },
    layers: [
      {
        id: 'body',
        order: 10,
        required: true,
        options: [{ id: 'standard', asset: 'layers/body/standard.png' }],
      },
      {
        id: 'coat',
        order: 20,
        required: true,
        dependsOn: ['body'],
        options: [
          { id: 'bay', asset: 'layers/coat/bay.png' },
          { id: 'grey', asset: 'layers/coat/grey.png' },
        ],
      },
      {
        id: 'equipment',
        order: 30,
        options: [{ id: 'saddle', asset: 'layers/equipment/saddle.png' }],
      },
    ],
    ...overrides,
  };
}
