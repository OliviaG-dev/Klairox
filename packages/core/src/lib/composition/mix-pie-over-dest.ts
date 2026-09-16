/** Dest pixels above this alpha are treated as coat/hair, not void. */
const DEST_COVERED = 24;

/**
 * Tobiano plate clay — face markings are forced onto this white so
 * blaze/bald match pie patches (shaded coat white, not paper).
 */
const PIE_WHITE_R = 212;
const PIE_WHITE_G = 207;
const PIE_WHITE_B = 200;
const PIE_WHITE_L = 205.4;

/** Chroma pull toward pie clay. */
const PIE_MATCH = 0.88;
/** How far whites may deviate from pie mid (shade ↔ light). */
const SHADE_SPAN = 18;
/** Softer than 40 → markings collapse closer to tobiano mid. */
const SHADE_SOFT = 55;

export function isPieOverlayLayer(layerId: string): boolean {
  return layerId === 'pie' || layerId === 'pie-foal';
}

export function isMarkingOverlayLayer(layerId: string): boolean {
  return layerId === 'markings' || layerId === 'markings-foal';
}

/** Pie and face markings share one white mix so tobiano patches match a blaze. */
export function isWhiteOverlayLayer(layerId: string): boolean {
  return isPieOverlayLayer(layerId) || isMarkingOverlayLayer(layerId);
}

/**
 * Glass-eye / flesh pixels stamped into bald (and similar) markings.
 * Must not go through pie clay grade or the iris washes to white-on-white.
 */
export function isEyeTissue(r: number, g: number, b: number): boolean {
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (L < 52) {
    return true;
  }
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  // Dark lid ink on bald overlays sits just above the pupil floor; without
  // this, liftPieWhite turns lashes into clay rings around the iris.
  if (L < 72 && chroma < 40) {
    return true;
  }
  const blue = b - Math.max(r, g);
  if (blue > 5 && L > 55 && L < 205) {
    return true;
  }
  // Pink lids / muzzle skin on markings (not white hair).
  const warm = r - Math.max(g, b);
  if (warm > 8 && L > 70 && L < 215 && r - Math.min(g, b) > 14) {
    return true;
  }
  return false;
}

/**
 * Remap overlay whites onto tobiano clay mid, keeping soft shade/light.
 * Eye tissue (iris, pupil, pink lids) passes through unchanged.
 */
export function liftPieWhite(
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  if (isEyeTissue(r, g, b)) {
    return [r, g, b];
  }

  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (L < 48) {
    return [r, g, b];
  }

  const targetL =
    PIE_WHITE_L + Math.tanh((L - PIE_WHITE_L) / SHADE_SOFT) * SHADE_SPAN;

  const scale = L > 1e-6 ? targetL / L : 1;
  let nr = r * scale;
  let ng = g * scale;
  let nb = b * scale;

  const pieScale = targetL / PIE_WHITE_L;
  nr = nr * (1 - PIE_MATCH) + PIE_WHITE_R * pieScale * PIE_MATCH;
  ng = ng * (1 - PIE_MATCH) + PIE_WHITE_G * pieScale * PIE_MATCH;
  nb = nb * (1 - PIE_MATCH) + PIE_WHITE_B * pieScale * PIE_MATCH;
  nb = Math.min(nb, Math.max(nr, ng) * 0.985);

  return [
    Math.round(Math.min(255, Math.max(0, nr))),
    Math.round(Math.min(255, Math.max(0, ng))),
    Math.round(Math.min(255, Math.max(0, nb))),
  ];
}

/**
 * Coat muscle / short-hair shading under white overlays (pie + markings).
 */
export function coatFormShade(r: number, g: number, b: number): number {
  const dL = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const t = Math.min(1, Math.max(0, (dL - 16) / 170));
  return 0.7 + t * 0.38;
}

/**
 * White overlays (pie + face markings): graded pie clay + coat form shade.
 * Eye stamps keep their authored colour (no coat-form multiply).
 */
export function mixPieOverDest(
  dest: Uint8ClampedArray | Uint8Array,
  src: Uint8ClampedArray | Uint8Array,
): void {
  const n = Math.min(dest.length, src.length);
  for (let i = 0; i < n; i += 4) {
    const sa = src[i + 3];
    if (sa === 0) {
      continue;
    }
    const srIn = src[i];
    const sgIn = src[i + 1];
    const sbIn = src[i + 2];
    const eye = isEyeTissue(srIn, sgIn, sbIn);
    const [sr0, sg0, sb0] = liftPieWhite(srIn, sgIn, sbIn);
    const da = dest[i + 3];
    if (da > DEST_COVERED) {
      const shade = eye ? 1 : coatFormShade(dest[i], dest[i + 1], dest[i + 2]);
      const sr = Math.min(255, sr0 * shade);
      const sg = Math.min(255, sg0 * shade);
      const sb = Math.min(255, sb0 * shade);
      const t = sa / 255;
      const u = 1 - t;
      dest[i] = Math.round(dest[i] * u + sr * t);
      dest[i + 1] = Math.round(dest[i + 1] * u + sg * t);
      dest[i + 2] = Math.round(dest[i + 2] * u + sb * t);
      dest[i + 3] = 255;
      continue;
    }
    const sA = sa / 255;
    const dA = da / 255;
    const outA = sA + dA * (1 - sA);
    if (outA < 1e-6) {
      continue;
    }
    const dKeep = dA * (1 - sA);
    dest[i] = Math.round((sr0 * sA + dest[i] * dKeep) / outA);
    dest[i + 1] = Math.round((sg0 * sA + dest[i + 1] * dKeep) / outA);
    dest[i + 2] = Math.round((sb0 * sA + dest[i + 2] * dKeep) / outA);
    dest[i + 3] = Math.round(outA * 255);
  }
}
