import {
  coatFormShade,
  isEyeTissue,
  isMarkingOverlayLayer,
  isPieOverlayLayer,
  isWhiteOverlayLayer,
  liftPieWhite,
  mixPieOverDest,
} from './mix-pie-over-dest.js';

function px(r: number, g: number, b: number, a: number): Uint8ClampedArray {
  return new Uint8ClampedArray([r, g, b, a]);
}

function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe('mixPieOverDest', () => {
  it('recognises pie and face-marking white overlays', () => {
    expect(isPieOverlayLayer('pie')).toBe(true);
    expect(isPieOverlayLayer('pie-foal')).toBe(true);
    expect(isMarkingOverlayLayer('markings')).toBe(true);
    expect(isMarkingOverlayLayer('markings-foal')).toBe(true);
    expect(isWhiteOverlayLayer('pie')).toBe(true);
    expect(isWhiteOverlayLayer('markings')).toBe(true);
    expect(isWhiteOverlayLayer('coat')).toBe(false);
  });

  it('maps face-marking whites onto tobiano clay', () => {
    const pie = liftPieWhite(209, 205, 199);
    const marking = liftPieWhite(242, 235, 228);
    expect(Math.abs(luma(...pie) - luma(...marking))).toBeLessThan(12);
    expect(marking[0]).toBeLessThan(235);
    expect(pie[0]).toBeGreaterThanOrEqual(pie[1]);
    expect(marking[0]).toBeGreaterThanOrEqual(marking[1]);
  });

  it('preserves glass-eye blue iris instead of washing to clay white', () => {
    expect(isEyeTissue(96, 118, 168)).toBe(true);
    const [r, g, b] = liftPieWhite(96, 118, 168);
    expect(b - Math.max(r, g)).toBeGreaterThan(5);
    expect(r).toBe(96);
    expect(g).toBe(118);
    expect(b).toBe(168);
  });

  it('keeps shade/light separation on pie-matched whites', () => {
    const shade = liftPieWhite(176, 172, 166);
    const lit = liftPieWhite(238, 232, 224);
    expect(luma(...lit) - luma(...shade)).toBeGreaterThan(12);
  });

  it('shades white with darker coat form more than with light coat', () => {
    expect(coatFormShade(40, 24, 16)).toBeLessThan(
      coatFormShade(200, 180, 150),
    );
  });

  it('mixes white pie into black dest as opaque midtone, not a glass rim', () => {
    const dest = px(0, 0, 0, 255);
    const src = px(255, 255, 255, 128);
    mixPieOverDest(dest, src);
    const [lr, lg, lb] = liftPieWhite(255, 255, 255);
    const shade = coatFormShade(0, 0, 0);
    expect(dest[0]).toBe(Math.round((lr * shade * 128) / 255));
    expect(dest[1]).toBe(Math.round((lg * shade * 128) / 255));
    expect(dest[2]).toBe(Math.round((lb * shade * 128) / 255));
    expect(dest[3]).toBe(255);
  });

  it('applies coat form so white over bay is darker than flat graded white', () => {
    const dest = px(120, 64, 32, 255);
    const src = px(216, 213, 206, 255);
    const [wr, wg, wb] = liftPieWhite(216, 213, 206);
    mixPieOverDest(dest, src);
    expect(dest[0]).toBeLessThan(wr);
    expect(dest[1]).toBeLessThan(wg);
    expect(dest[2]).toBeLessThan(wb);
    expect(dest[3]).toBe(255);
  });

  it('source-overs onto empty dest so the checkerboard can show through', () => {
    const dest = px(0, 0, 0, 0);
    const src = px(252, 248, 241, 128);
    mixPieOverDest(dest, src);
    const [lr, lg, lb] = liftPieWhite(252, 248, 241);
    expect(dest[0]).toBe(lr);
    expect(dest[1]).toBe(lg);
    expect(dest[2]).toBe(lb);
    expect(dest[3]).toBe(128);
  });
});
