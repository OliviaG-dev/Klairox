import { createTestPlugin } from '../testing.fixture.js';
import { resolveLayerOrder } from './resolution-order.js';

describe('resolveLayerOrder', () => {
  it('follows the declared stacking order when dependencies allow it', () => {
    const { manifest } = createTestPlugin();

    expect(resolveLayerOrder(manifest).map((layer) => layer.id)).toEqual([
      'body',
      'coat',
      'markings',
      'equipment',
    ]);
  });

  it('pulls a dependency ahead of the layer that needs it', () => {
    const { manifest } = createTestPlugin({
      layers: [
        {
          id: 'first',
          order: 10,
          dependsOn: ['second'],
          options: [{ id: 'a', asset: 'a.png' }],
        },
        { id: 'second', order: 20, options: [{ id: 'b', asset: 'b.png' }] },
      ],
    });

    expect(resolveLayerOrder(manifest).map((layer) => layer.id)).toEqual([
      'second',
      'first',
    ]);
  });

  it('is deterministic when two layers share the same order', () => {
    const { manifest } = createTestPlugin({
      layers: [
        { id: 'zulu', order: 10, options: [{ id: 'a', asset: 'a.png' }] },
        { id: 'alpha', order: 10, options: [{ id: 'b', asset: 'b.png' }] },
      ],
    });

    expect(resolveLayerOrder(manifest).map((layer) => layer.id)).toEqual([
      'alpha',
      'zulu',
    ]);
  });
});
