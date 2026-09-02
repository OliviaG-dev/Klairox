import { isPieOverlayLayer, mixPieOverDest } from './mix-pie-over-dest.js';

function px(
  r: number,
  g: number,
  b: number,
  a: number,
): Uint8ClampedArray {
  return new Uint8ClampedArray([r, g, b, a]);
}

describe('mixPieOverDest', () => {
  it('recognises adult and foal pie layers', () => {
    expect(isPieOverlayLayer('pie')).toBe(true);
    expect(isPieOverlayLayer('pie-foal')).toBe(true);
    expect(isPieOverlayLayer('coat')).toBe(false);
  });

  it('mixes white pie into black dest as opaque grey, not a glass rim', () => {
    const dest = px(0, 0, 0, 255);
    const src = px(255, 255, 255, 128);
    mixPieOverDest(dest, src);
    expect(dest[0]).toBe(128);
    expect(dest[1]).toBe(128);
    expect(dest[2]).toBe(128);
    expect(dest[3]).toBe(255);
  });

  it('mixes white pie into bay dest using the dest colour', () => {
    const dest = px(120, 64, 32, 255);
    const src = px(252, 248, 241, 128);
    mixPieOverDest(dest, src);
    expect(dest[0]).toBe(186);
    expect(dest[1]).toBe(156);
    expect(dest[2]).toBe(137);
    expect(dest[3]).toBe(255);
  });

  it('source-overs onto empty dest so the checkerboard can show through', () => {
    const dest = px(0, 0, 0, 0);
    const src = px(252, 248, 241, 128);
    mixPieOverDest(dest, src);
    expect(dest[0]).toBe(252);
    expect(dest[1]).toBe(248);
    expect(dest[2]).toBe(241);
    expect(dest[3]).toBe(128);
  });
});
