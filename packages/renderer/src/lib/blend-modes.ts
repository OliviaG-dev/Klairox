import type { BlendMode } from '@klairox/plugin-sdk';
import type { Blend } from 'sharp';

/** Klairox blend modes mapped onto the Porter-Duff/PDF operators exposed by Sharp. */
export const SHARP_BLEND_MODES: Readonly<Record<BlendMode, Blend>> = {
  normal: 'over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
};
