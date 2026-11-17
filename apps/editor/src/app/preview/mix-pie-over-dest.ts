/** Dest pixels above this alpha are treated as coat/hair, not void. */
const DEST_COVERED = 24;

const PIE_WHITE_R = 212;
const PIE_WHITE_G = 207;
const PIE_WHITE_B = 200;
const PIE_WHITE_L = 205.4;

const STOCK_WHITE_R = 249;
const STOCK_WHITE_G = 231;
const STOCK_WHITE_B = 221;
const STOCK_WHITE_L = 234;

const PIE_MATCH = 0.88;
const STOCK_MATCH = 0.28;
const SHADE_SPAN_HI = 10;
const SHADE_SPAN_LO = 30;
const SHADE_SOFT = 50;

export type WhiteMixProfile = 'clay' | 'stocking';

export function whiteMixProfile(layerId: string): WhiteMixProfile {
  return layerId === 'pie-paint-horse' || layerId === 'markings-paint-horse'
    ? 'stocking'
    : 'clay';
}

export function isPieOverlayLayer(layerId: string): boolean {
  return (
    layerId === 'pie' || layerId === 'pie-foal' || layerId === 'pie-paint-horse'
  );
}

export function isMarkingOverlayLayer(layerId: string): boolean {
  return (
    layerId === 'markings' ||
    layerId === 'markings-foal' ||
    layerId === 'markings-lusitano' ||
    layerId === 'markings-arabian' ||
    layerId === 'markings-selle-francais' ||
    layerId === 'markings-paint-horse'
  );
}

export function isWhiteOverlayLayer(layerId: string): boolean {
  return isPieOverlayLayer(layerId) || isMarkingOverlayLayer(layerId);
}

export function isEyeTissue(r: number, g: number, b: number): boolean {
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (L < 52) {
    return true;
  }
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  if (L < 72 && chroma < 40) {
    return true;
  }
  const blue = b - Math.max(r, g);
  if (blue > 5 && L > 55 && L < 205) {
    return true;
  }
  const warm = r - Math.max(g, b);
  if (warm > 8 && L > 70 && L < 218 && r - Math.min(g, b) > 14) {
    return true;
  }
  return false;
}

export function liftPieWhite(
  r: number,
  g: number,
  b: number,
  profile: WhiteMixProfile = 'clay',
): [number, number, number] {
  if (isEyeTissue(r, g, b)) {
    return [r, g, b];
  }

  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (L < 48) {
    return [r, g, b];
  }

  const mid = profile === 'stocking' ? STOCK_WHITE_L : PIE_WHITE_L;
  const match = profile === 'stocking' ? STOCK_MATCH : PIE_MATCH;
  const white =
    profile === 'stocking'
      ? [STOCK_WHITE_R, STOCK_WHITE_G, STOCK_WHITE_B]
      : [PIE_WHITE_R, PIE_WHITE_G, PIE_WHITE_B];
  const delta = L - mid;
  const span = delta >= 0 ? SHADE_SPAN_HI : SHADE_SPAN_LO;
  const targetL = mid + Math.tanh(delta / SHADE_SOFT) * span;

  const scale = L > 1e-6 ? targetL / L : 1;
  let nr = r * scale;
  let ng = g * scale;
  let nb = b * scale;

  const pieScale = targetL / mid;
  nr = nr * (1 - match) + white[0] * pieScale * match;
  ng = ng * (1 - match) + white[1] * pieScale * match;
  nb = nb * (1 - match) + white[2] * pieScale * match;
  nb = Math.min(nb, Math.max(nr, ng) * 0.985);

  return [
    Math.round(Math.min(255, Math.max(0, nr))),
    Math.round(Math.min(255, Math.max(0, ng))),
    Math.round(Math.min(255, Math.max(0, nb))),
  ];
}

export function coatFormShade(
  r: number,
  g: number,
  b: number,
  profile: WhiteMixProfile = 'clay',
): number {
  const dL = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const t = Math.min(1, Math.max(0, (dL - 16) / 170));
  if (profile === 'stocking') {
    return 0.94 + t * 0.08;
  }
  return 0.78 + t * 0.3;
}

export function mixPieOverDest(
  dest: Uint8ClampedArray | Uint8Array,
  src: Uint8ClampedArray | Uint8Array,
  profile: WhiteMixProfile = 'clay',
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
    const [sr0, sg0, sb0] = liftPieWhite(srIn, sgIn, sbIn, profile);
    const da = dest[i + 3];
    if (da > DEST_COVERED) {
      const shade = eye
        ? 1
        : coatFormShade(dest[i], dest[i + 1], dest[i + 2], profile);
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
