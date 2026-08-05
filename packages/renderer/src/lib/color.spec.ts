import { parseHexColor, TRANSPARENT } from './color.js';

describe('parseHexColor', () => {
  it('falls back to transparent when no background is set', () => {
    expect(parseHexColor(undefined)).toEqual(TRANSPARENT);
  });

  it('reads a #RRGGBB colour as fully opaque', () => {
    expect(parseHexColor('#3366ff')).toEqual({
      r: 51,
      g: 102,
      b: 255,
      alpha: 1,
    });
  });

  it('reads the alpha channel of a #RRGGBBAA colour', () => {
    expect(parseHexColor('#00000080')).toEqual({
      r: 0,
      g: 0,
      b: 0,
      alpha: 128 / 255,
    });
  });
});
