import { KlairoxError } from '../errors.js';
import { createTestPlugin } from '../testing.fixture.js';
import { resolveSelection } from './resolve-selection.js';

function expectFailure(run: () => unknown): KlairoxError {
  try {
    run();
  } catch (error) {
    if (error instanceof KlairoxError) {
      return error;
    }
    throw error;
  }

  throw new Error('expected the selection to be rejected');
}

describe('resolveSelection', () => {
  it('fills required layers with their first option and leaves optional ones unset', () => {
    const { selection } = resolveSelection(createTestPlugin());

    expect(selection).toEqual({ body: 'standard', coat: 'bay' });
  });

  it('keeps the options the caller asked for', () => {
    const { selection } = resolveSelection(createTestPlugin(), {
      coat: 'grey',
      equipment: 'armor',
    });

    expect(selection).toEqual({
      body: 'standard',
      coat: 'grey',
      equipment: 'armor',
    });
  });

  it('ignores undefined entries instead of failing on them', () => {
    const { selection } = resolveSelection(createTestPlugin(), {
      equipment: undefined,
    });

    expect(selection).toEqual({ body: 'standard', coat: 'bay' });
  });

  it('rejects an unknown layer', () => {
    const error = expectFailure(() =>
      resolveSelection(createTestPlugin(), { wings: 'feathered' }),
    );

    expect(error.code).toBe('SELECTION_INVALID');
    expect(error.details).toEqual(['unknown layer "wings"']);
  });

  it('lists the available options when the requested one does not exist', () => {
    const error = expectFailure(() =>
      resolveSelection(createTestPlugin(), { coat: 'purple' }),
    );

    expect(error.details).toEqual([
      'unknown option "purple" for layer "coat" (available: bay, grey)',
    ]);
  });

  it('rejects an option that an upstream layer disabled', () => {
    const plugin = createTestPlugin({
      constraints: [
        {
          id: 'no-star-on-grey',
          when: { coat: 'grey' },
          disable: ['markings:star'],
        },
      ],
    });

    const error = expectFailure(() =>
      resolveSelection(plugin, { coat: 'grey', markings: 'star' }),
    );

    expect(error.code).toBe('SELECTION_INVALID');
    expect(error.details).toEqual([
      '"markings:star" is disabled by no-star-on-grey',
    ]);
  });

  it('skips a disabled option when picking the default of a required layer', () => {
    const plugin = createTestPlugin({
      constraints: [
        {
          id: 'heavy-hates-bay',
          when: { body: 'heavy' },
          disable: ['coat:bay'],
        },
      ],
    });

    const { selection } = resolveSelection(plugin, { body: 'heavy' });

    expect(selection).toEqual({ body: 'heavy', coat: 'grey' });
  });

  it('fails when every option of a required layer is disabled', () => {
    const plugin = createTestPlugin({
      constraints: [
        { id: 'no-coat', when: { body: 'heavy' }, disable: ['coat'] },
      ],
    });

    const error = expectFailure(() =>
      resolveSelection(plugin, { body: 'heavy' }),
    );

    expect(error.details).toEqual([
      'layer "coat" is required but every option is disabled',
    ]);
  });

  it('reports a requirement the finished selection does not satisfy', () => {
    const plugin = createTestPlugin({
      constraints: [
        {
          id: 'bay-needs-saddle',
          when: { coat: 'bay' },
          require: ['equipment:saddle'],
        },
      ],
    });

    const error = expectFailure(() => resolveSelection(plugin));

    expect(error.code).toBe('CONSTRAINT_VIOLATION');
    expect(error.details).toEqual([
      '"equipment:saddle" is required by bay-needs-saddle but is not selected',
    ]);
  });

  it('exposes the layers hidden by the resolved selection', () => {
    const plugin = createTestPlugin({
      constraints: [
        { id: 'armor-hides', when: { equipment: 'armor' }, hide: ['markings'] },
      ],
    });

    const { evaluation } = resolveSelection(plugin, { equipment: 'armor' });

    expect([...evaluation.hiddenLayers.keys()]).toEqual(['markings']);
  });
});
