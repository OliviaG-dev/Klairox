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

  it('paints foal coats instead of adult coats for the foal build', async () => {
    const plugin = await loadPlugin(HORSE_PLUGIN_DIR);
    const plan = buildCompositionPlan(plugin, {
      body: 'foal',
      'coat-foal': 'chestnut',
    });
    const painted = plan.layers.map((layer) => layer.layerId);

    expect(plan.selection.body).toBe('foal');
    expect(plan.hiddenLayers).toEqual(expect.arrayContaining(['body', 'coat']));
    expect(painted).toContain('coat-foal');
    expect(painted).not.toContain('coat');
    expect(
      plan.layers.find((layer) => layer.layerId === 'coat-foal')?.assetPath,
    ).toBe(path.resolve(HORSE_PLUGIN_DIR, 'layers/coat-foal/chestnut.png'));
  });

  it('paints pie over the coat and hides face markings', async () => {
    const plugin = await loadPlugin(HORSE_PLUGIN_DIR);
    const plan = buildCompositionPlan(plugin, {
      coat: 'chestnut',
      pie: 'overo',
      markings: 'blaze',
    });
    const painted = plan.layers.map((layer) => layer.layerId);

    expect(painted).toContain('coat');
    expect(painted).toContain('pie');
    expect(painted.indexOf('pie')).toBeGreaterThan(painted.indexOf('coat'));
    expect(painted).not.toContain('markings');
    expect(plan.selection.markings).toBe('blaze');
    expect(plan.hiddenLayers).toContain('markings');
    expect(
      plan.layers.find((layer) => layer.layerId === 'pie')?.assetPath,
    ).toBe(path.resolve(HORSE_PLUGIN_DIR, 'layers/pie/overo.png'));
  });

  it('keeps face markings over a tobiano, which has a solid head', async () => {
    const plugin = await loadPlugin(HORSE_PLUGIN_DIR);
    const plan = buildCompositionPlan(plugin, {
      coat: 'chestnut',
      pie: 'tobiano',
      markings: 'blaze',
    });
    const painted = plan.layers.map((layer) => layer.layerId);

    expect(painted).toContain('markings');
    expect(painted.indexOf('markings')).toBeGreaterThan(painted.indexOf('pie'));
    expect(plan.hiddenLayers).not.toContain('markings');
  });

  it('keeps foal face markings over a foal tobiano', async () => {
    const plugin = await loadPlugin(HORSE_PLUGIN_DIR);
    const plan = buildCompositionPlan(plugin, {
      body: 'foal',
      'coat-foal': 'chestnut',
      'pie-foal': 'tobiano',
      'markings-foal': 'blaze',
    });
    const painted = plan.layers.map((layer) => layer.layerId);

    expect(painted).toContain('markings-foal');
    expect(painted.indexOf('markings-foal')).toBeGreaterThan(
      painted.indexOf('pie-foal'),
    );
    expect(plan.hiddenLayers).not.toContain('markings-foal');
  });

  it('paints foal pie over the foal coat', async () => {
    const plugin = await loadPlugin(HORSE_PLUGIN_DIR);
    const plan = buildCompositionPlan(plugin, {
      body: 'foal',
      'coat-foal': 'chestnut',
      'pie-foal': 'sabino',
    });
    const painted = plan.layers.map((layer) => layer.layerId);

    expect(painted).toContain('coat-foal');
    expect(painted).toContain('pie-foal');
    expect(painted).not.toContain('pie');
    expect(painted).not.toContain('coat');
    expect(plan.hiddenLayers).toEqual(
      expect.arrayContaining(['body', 'coat', 'pie']),
    );
  });
});
