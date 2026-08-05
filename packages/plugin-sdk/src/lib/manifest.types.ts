import type { z } from 'zod';
import type {
  blendModeSchema,
  canvasSchema,
  constraintSchema,
  exportsSchema,
  imageFormatSchema,
  layerOptionSchema,
  layerSchema,
  offsetSchema,
  pluginManifestSchema,
  selectorSchema,
  thumbnailSchema,
} from './manifest.schema.js';

export type BlendMode = z.infer<typeof blendModeSchema>;
export type ImageFormat = z.infer<typeof imageFormatSchema>;
export type Offset = z.infer<typeof offsetSchema>;
export type LayerOption = z.infer<typeof layerOptionSchema>;
export type Layer = z.infer<typeof layerSchema>;
export type Selector = z.infer<typeof selectorSchema>;
export type Constraint = z.infer<typeof constraintSchema>;
export type ThumbnailConfig = z.infer<typeof thumbnailSchema>;
export type ExportsConfig = z.infer<typeof exportsSchema>;
export type CanvasConfig = z.infer<typeof canvasSchema>;

/** A fully validated manifest, with every optional field resolved to its default. */
export type PluginManifest = z.infer<typeof pluginManifestSchema>;

/** The manifest as written by a plugin author, before defaults are applied. */
export type PluginManifestInput = z.input<typeof pluginManifestSchema>;

/** A reference to a whole layer (`body`) or to one of its options (`body:heavy`). */
export type TargetRef = string;

export interface ParsedTargetRef {
  layerId: string;
  optionId?: string;
}
