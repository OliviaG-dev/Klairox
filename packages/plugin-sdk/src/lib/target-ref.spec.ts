import { formatTargetRef, parseTargetRef } from './target-ref.js';

describe('parseTargetRef', () => {
  it('reads a whole-layer reference', () => {
    expect(parseTargetRef('body')).toEqual({ layerId: 'body' });
  });

  it('reads a layer/option reference', () => {
    expect(parseTargetRef('body:heavy')).toEqual({
      layerId: 'body',
      optionId: 'heavy',
    });
  });
});

describe('formatTargetRef', () => {
  it('round-trips both reference shapes', () => {
    expect(formatTargetRef('body')).toBe('body');
    expect(formatTargetRef('body', 'heavy')).toBe('body:heavy');
  });
});
