import type { PluginManifest, PluginManifestInput } from '@klairox/plugin-sdk';
import { createTestPlugin } from '../testing.fixture.js';
import {
  evaluateConstraints,
  findViolations,
  isOptionDisabled,
} from './rule-engine.js';

const CONSTRAINTS: PluginManifestInput['constraints'] = [
  {
    id: 'armor-hides-markings',
    when: { equipment: 'armor' },
    hide: ['markings'],
  },
  { id: 'grey-hides-star', when: { coat: 'grey' }, disable: ['markings:star'] },
  {
    id: 'dark-needs-saddle',
    when: { coat: ['bay', 'black'] },
    require: ['equipment:saddle'],
  },
];

function manifestWithConstraints(): PluginManifest {
  return createTestPlugin({
    layers: [
      {
        id: 'coat',
        order: 10,
        required: true,
        options: [
          { id: 'bay', asset: 'a.png' },
          { id: 'black', asset: 'b.png' },
          { id: 'grey', asset: 'c.png' },
        ],
      },
      { id: 'markings', order: 20, options: [{ id: 'star', asset: 'd.png' }] },
      {
        id: 'equipment',
        order: 30,
        options: [
          { id: 'saddle', asset: 'e.png' },
          { id: 'armor', asset: 'f.png' },
        ],
      },
    ],
    constraints: CONSTRAINTS,
  }).manifest;
}

describe('evaluateConstraints', () => {
  it('ignores constraints whose condition is not met', () => {
    const evaluation = evaluateConstraints(manifestWithConstraints(), {
      coat: 'grey',
    });

    expect(evaluation.matchedConstraints).toEqual(['grey-hides-star']);
    expect(evaluation.hiddenLayers.size).toBe(0);
  });

  it('does not match a condition on a layer that is not selected yet', () => {
    const evaluation = evaluateConstraints(manifestWithConstraints(), {});

    expect(evaluation.matchedConstraints).toEqual([]);
  });

  it('matches when the selected option is one of several accepted values', () => {
    const evaluation = evaluateConstraints(manifestWithConstraints(), {
      coat: 'black',
    });

    expect(evaluation.requiredTargets.get('equipment:saddle')).toBe(
      'dark-needs-saddle',
    );
  });

  it('records which constraint hid a layer', () => {
    const evaluation = evaluateConstraints(manifestWithConstraints(), {
      equipment: 'armor',
    });

    expect(evaluation.hiddenLayers.get('markings')).toBe(
      'armor-hides-markings',
    );
  });
});

describe('isOptionDisabled', () => {
  it('reports an option disabled by target reference', () => {
    const evaluation = evaluateConstraints(manifestWithConstraints(), {
      coat: 'grey',
    });

    expect(isOptionDisabled(evaluation, 'markings', 'star')).toBe(true);
    expect(isOptionDisabled(evaluation, 'equipment', 'saddle')).toBe(false);
  });

  it('treats a whole disabled layer as disabling each of its options', () => {
    const manifest = createTestPlugin({
      constraints: [{ when: { body: 'heavy' }, disable: ['equipment'] }],
    }).manifest;
    const evaluation = evaluateConstraints(manifest, { body: 'heavy' });

    expect(isOptionDisabled(evaluation, 'equipment', 'saddle')).toBe(true);
    expect(isOptionDisabled(evaluation, 'equipment', 'armor')).toBe(true);
  });
});

describe('findViolations', () => {
  it('reports a selected option that a constraint disables', () => {
    const selection = { coat: 'grey', markings: 'star' };
    const evaluation = evaluateConstraints(
      manifestWithConstraints(),
      selection,
    );

    expect(findViolations(evaluation, selection)).toEqual([
      {
        constraint: 'grey-hides-star',
        message: '"markings:star" is disabled by grey-hides-star',
      },
    ]);
  });

  it('reports an unsatisfied requirement', () => {
    const selection = { coat: 'bay' };
    const evaluation = evaluateConstraints(
      manifestWithConstraints(),
      selection,
    );

    expect(findViolations(evaluation, selection)).toEqual([
      {
        constraint: 'dark-needs-saddle',
        message:
          '"equipment:saddle" is required by dark-needs-saddle but is not selected',
      },
    ]);
  });

  it('accepts a selection that satisfies every requirement', () => {
    const selection = { coat: 'bay', equipment: 'saddle' };
    const evaluation = evaluateConstraints(
      manifestWithConstraints(),
      selection,
    );

    expect(findViolations(evaluation, selection)).toEqual([]);
  });
});
