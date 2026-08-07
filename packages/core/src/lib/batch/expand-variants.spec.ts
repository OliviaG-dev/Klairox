import { createTestPlugin } from '../testing.fixture.js';
import { expandVariants, renderVariantName } from './expand-variants.js';
import { hashCompositionPlan } from './plan-hash.js';
import { resolveVariantConfig } from './variant-config.js';

describe('expandVariants', () => {
  it('builds the cartesian product of the declared axes', () => {
    const plugin = createTestPlugin({
      variants: {
        axes: ['coat', 'equipment'],
        include: { body: 'standard' },
      },
    });

    const { jobs, rejected } = expandVariants(plugin);

    expect(rejected).toEqual([]);
    expect(jobs.map((job) => job.selection)).toEqual([
      { body: 'standard', coat: 'bay', equipment: 'saddle' },
      { body: 'standard', coat: 'bay', equipment: 'armor' },
      { body: 'standard', coat: 'grey', equipment: 'saddle' },
      { body: 'standard', coat: 'grey', equipment: 'armor' },
    ]);
    expect(jobs.map((job) => job.name)).toEqual([
      'sample-bay-saddle',
      'sample-bay-armor',
      'sample-grey-saddle',
      'sample-grey-armor',
    ]);
  });

  it('drops combinations listed in exclude', () => {
    const plugin = createTestPlugin({
      variants: {
        axes: ['coat', 'equipment'],
        exclude: [{ coat: 'grey', equipment: 'armor' }],
      },
    });

    const { jobs, rejected } = expandVariants(plugin);

    expect(jobs).toHaveLength(3);
    expect(rejected).toEqual([
      {
        requested: { coat: 'grey', equipment: 'armor' },
        reason: 'excluded by variants.exclude',
      },
    ]);
  });

  it('rejects combinations that violate constraints instead of failing', () => {
    const plugin = createTestPlugin({
      constraints: [
        {
          id: 'heavy-blocks-saddle',
          when: { body: 'heavy' },
          disable: ['equipment:saddle'],
        },
      ],
      variants: {
        axes: ['body', 'equipment'],
      },
    });

    const { jobs, rejected } = expandVariants(plugin);

    expect(jobs.map((job) => job.selection)).toEqual([
      { body: 'standard', coat: 'bay', equipment: 'saddle' },
      { body: 'standard', coat: 'bay', equipment: 'armor' },
      { body: 'heavy', coat: 'bay', equipment: 'armor' },
    ]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.requested).toEqual({
      body: 'heavy',
      equipment: 'saddle',
    });
    expect(rejected[0]?.reason).toMatch(/disabled/);
  });

  it('lets callers override axes and the name template', () => {
    const plugin = createTestPlugin({
      variants: { axes: ['coat'] },
    });

    const { jobs, config } = expandVariants(plugin, {
      axes: ['equipment'],
      include: { coat: 'grey' },
      nameTemplate: '{plugin}_{equipment}',
    });

    expect(config.axes).toEqual(['equipment']);
    expect(jobs.map((job) => job.name)).toEqual([
      'sample_saddle',
      'sample_armor',
    ]);
    expect(jobs.every((job) => job.selection.coat === 'grey')).toBe(true);
  });

  it('hashes identical plans the same way', () => {
    const plugin = createTestPlugin({
      variants: { axes: ['coat'] },
    });
    const { jobs } = expandVariants(plugin);
    const first = jobs[0];

    expect(first).toBeDefined();
    if (first === undefined) {
      return;
    }

    expect(hashCompositionPlan(first.plan)).toBe(first.planHash);
    expect(hashCompositionPlan(first.plan)).toBe(
      hashCompositionPlan(first.plan),
    );
  });
});

describe('resolveVariantConfig', () => {
  it('fails when neither the manifest nor the caller provides axes', () => {
    expect(() => resolveVariantConfig(createTestPlugin())).toThrow(
      /No variant axes/,
    );
  });
});

describe('renderVariantName', () => {
  it('replaces unresolved placeholders with none', () => {
    expect(renderVariantName('{plugin}-{markings}', 'horse', {})).toBe(
      'horse-none',
    );
  });
});
