import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlugin } from '../plugin/plugin-loader.js';
import { createTestPlugin, TEST_PLUGIN_ROOT } from '../testing.fixture.js';
import { buildCompositionPlan } from './composition-engine.js';

const HORSE_PLUGIN_DIR = fileURLToPath(
  new URL('../../../../../plugins/horse', import.meta.url),
);

describe('buildCompositionPlan', () => {
  it('paints layers from the lowest order to the highest', () => {
    const plan = buildCompositionPlan(createTestPlugin(), {
      markings: 'star',
      equipment: 'armor',
    });

    expect(plan.layers.map((layer) => layer.layerId)).toEqual([
      'body',
      'coat',
      'markings',
      'equipment',
    ]);
  });

  it('resolves assets to absolute paths inside the plugin root', () => {
    const plan = buildCompositionPlan(createTestPlugin());

    expect(plan.layers[0].assetPath).toBe(
      path.resolve(TEST_PLUGIN_ROOT, 'layers/body/standard.png'),
    );
  });

  it('carries the per-layer compositing settings', () => {
    const plan = buildCompositionPlan(createTestPlugin());
    const coat = plan.layers.find((layer) => layer.layerId === 'coat');

    expect(coat).toMatchObject({
      opacity: 0.9,
      blendMode: 'normal',
      offset: { x: 0, y: 0 },
    });
  });

  it('leaves hidden layers out of the render but keeps them in the selection', () => {
    const plugin = createTestPlugin({
      constraints: [
        { id: 'armor-hides', when: { equipment: 'armor' }, hide: ['markings'] },
      ],
    });

    const plan = buildCompositionPlan(plugin, {
      markings: 'star',
      equipment: 'armor',
    });

    expect(plan.layers.map((layer) => layer.layerId)).not.toContain('markings');
    expect(plan.selection['markings']).toBe('star');
    expect(plan.hiddenLayers).toEqual(['markings']);
  });

  it('produces the same plan twice for the same input', () => {
    const plugin = createTestPlugin();

    expect(buildCompositionPlan(plugin, { coat: 'grey' })).toEqual(
      buildCompositionPlan(plugin, { coat: 'grey' }),
    );
  });

  it('keeps the horse body in selection but hides it under a normal coat', async () => {
    const plugin = await loadPlugin(HORSE_PLUGIN_DIR);
    const plan = buildCompositionPlan(plugin, { coat: 'bay' });
    const coat = plan.layers.find((layer) => layer.layerId === 'coat');

    expect(plan.hiddenLayers).toContain('body');
    expect(plan.selection.body).toBe('standard');
    expect(plan.layers.map((layer) => layer.layerId)).not.toContain('body');
    expect(plan.layers.map((layer) => layer.layerId)).toContain('coat');
    expect(coat?.blendMode).toBe('normal');
  });
});
