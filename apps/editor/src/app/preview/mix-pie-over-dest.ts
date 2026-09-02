/** Dest pixels above this alpha are treated as coat/hair, not void. */
const DEST_COVERED = 24;

export function isPieOverlayLayer(layerId: string): boolean {
  return layerId === 'pie' || layerId === 'pie-foal';
}

/**
 * White pie with falling alpha over dark dest reads as a grey rim.
 * Over covered dest, mix RGB with the dest colour and stay opaque.
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
    const da = dest[i + 3];
    if (da > DEST_COVERED) {
      const t = sa / 255;
      const u = 1 - t;
      dest[i] = Math.round(dest[i] * u + src[i] * t);
      dest[i + 1] = Math.round(dest[i + 1] * u + src[i + 1] * t);
      dest[i + 2] = Math.round(dest[i + 2] * u + src[i + 2] * t);
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
    dest[i] = Math.round((src[i] * sA + dest[i] * dKeep) / outA);
    dest[i + 1] = Math.round((src[i + 1] * sA + dest[i + 1] * dKeep) / outA);
    dest[i + 2] = Math.round((src[i + 2] * sA + dest[i + 2] * dKeep) / outA);
    dest[i + 3] = Math.round(outA * 255);
  }
}
