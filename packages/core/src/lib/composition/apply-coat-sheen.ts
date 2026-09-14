/** Skip void / fringe pixels. */
const COVERED = 24;

/** Warm specular tint (screened into the coat). */
const SPEC_R = 255;
const SPEC_G = 250;
const SPEC_B = 242;

/** Base gloss on mid/high coat tones. */
const COAT_SHEEN = 0.32;
/** Extra gloss on pale / white patches (pie, markings, flaxen). */
const WHITE_SHEEN = 0.42;

export interface CoatSheenOptions {
  readonly width?: number;
  readonly height?: number;
}

/**
 * Soft wet-coat sheen: screen a warm highlight into covered pixels.
 * Stronger on pale whites; optional top-lit falloff when size is known.
 */
export function applyCoatSheen(
  pixels: Uint8ClampedArray | Uint8Array,
  options: CoatSheenOptions = {},
): void {
  const { width, height } = options;
  const pixelCount = pixels.length >>> 2;
  const hasSize =
    width !== undefined &&
    height !== undefined &&
    width > 0 &&
    height > 0 &&
    width * height === pixelCount;

  for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
    const a = pixels[i + 3];
    if (a < COVERED) {
      continue;
    }

    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    // Concentrate gloss on lit fur, keep shadows matte.
    const lit = Math.min(1, Math.max(0, (L - 40) / 175));
    let sheen = Math.pow(lit, 1.55) * COAT_SHEEN;

    const maxc = Math.max(r, g, b);
    const minc = Math.min(r, g, b);
    const chroma = maxc - minc;
    if (L > 155 && chroma < 60) {
      const pale = Math.min(1, (L - 155) / 85);
      const lowChroma = 1 - chroma / 60;
      sheen += Math.pow(pale, 1.15) * lowChroma * WHITE_SHEEN;
    }

    if (hasSize && width !== undefined && height !== undefined) {
      const x = p % width;
      const y = (p / width) | 0;
      const nx = x / width;
      const ny = y / height;
      // Soft key light from upper-front-left.
      const key = Math.max(0, 0.62 - ny * 0.5 + (0.48 - nx) * 0.14);
      sheen *= 0.52 + key * 0.95;
    }

    sheen = Math.min(0.78, sheen);
    if (sheen < 0.012) {
      continue;
    }

    // Screen blend toward warm specular.
    pixels[i] = Math.round(255 - (255 - r) * (1 - (SPEC_R / 255) * sheen));
    pixels[i + 1] = Math.round(255 - (255 - g) * (1 - (SPEC_G / 255) * sheen));
    pixels[i + 2] = Math.round(255 - (255 - b) * (1 - (SPEC_B / 255) * sheen));
  }
}
