import { applyCoatSheen } from './apply-coat-sheen.js';

function px(r: number, g: number, b: number, a: number): Uint8ClampedArray {
  return new Uint8ClampedArray([r, g, b, a]);
}

function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe('applyCoatSheen', () => {
  it('leaves deep shadow coat mostly matte', () => {
    const dest = px(28, 16, 10, 255);
    const before = luma(dest[0], dest[1], dest[2]);
    applyCoatSheen(dest);
    expect(luma(dest[0], dest[1], dest[2]) - before).toBeLessThan(6);
  });

  it('adds gloss to mid coat tones', () => {
    const dest = px(140, 78, 42, 255);
    const before = luma(dest[0], dest[1], dest[2]);
    applyCoatSheen(dest);
    expect(luma(dest[0], dest[1], dest[2])).toBeGreaterThan(before + 4);
  });

  it('adds stronger gloss to pale white patches', () => {
    const brown = px(140, 78, 42, 255);
    const white = px(228, 220, 210, 255);
    applyCoatSheen(brown);
    applyCoatSheen(white);
    const brownLift =
      luma(brown[0], brown[1], brown[2]) - luma(140, 78, 42);
    const whiteLift =
      luma(white[0], white[1], white[2]) - luma(228, 220, 210);
    expect(whiteLift).toBeGreaterThan(brownLift);
  });

  it('skips transparent pixels', () => {
    const dest = px(220, 210, 200, 0);
    applyCoatSheen(dest);
    expect([...dest]).toEqual([220, 210, 200, 0]);
  });
});
