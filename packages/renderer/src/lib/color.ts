export interface RgbaColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly alpha: number;
}

export const TRANSPARENT: RgbaColor = { r: 0, g: 0, b: 0, alpha: 0 };

/** Parses `#RRGGBB` / `#RRGGBBAA`. The manifest schema already guarantees the shape. */
export function parseHexColor(hex: string | undefined): RgbaColor {
  if (hex === undefined) {
    return TRANSPARENT;
  }

  const digits = hex.slice(1);
  const channel = (index: number): number =>
    Number.parseInt(digits.slice(index * 2, index * 2 + 2), 16);

  return {
    r: channel(0),
    g: channel(1),
    b: channel(2),
    alpha: digits.length === 8 ? channel(3) / 255 : 1,
  };
}
