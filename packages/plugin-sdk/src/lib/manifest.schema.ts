import { z } from 'zod';

/** Identifiers are kebab-case so they stay safe in file names, URLs and CLI flags. */
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** `layerId` (whole layer) or `layerId:optionId` (a single option of a layer). */
const TARGET_REF_PATTERN = /^[a-z0-9][a-z0-9-]*(?::[a-z0-9][a-z0-9-]*)?$/;

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export const identifierSchema = z
  .string()
  .regex(IDENTIFIER_PATTERN, 'must be kebab-case (a-z, 0-9, dashes)');

export const targetRefSchema = z
  .string()
  .regex(TARGET_REF_PATTERN, 'must be "layerId" or "layerId:optionId"');

export const blendModeSchema = z.enum([
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
]);

export const imageFormatSchema = z.enum(['png', 'webp']);

export const offsetSchema = z.strictObject({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
});

export const layerOptionSchema = z.strictObject({
  id: identifierSchema,
  title: z.string().min(1).optional(),
  /** Path to the image, relative to the plugin root. */
  asset: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
});

export const layerSchema = z.strictObject({
  id: identifierSchema,
  title: z.string().min(1).optional(),
  /** Stacking order: lower values are painted first. */
  order: z.number().int(),
  required: z.boolean().default(false),
  /** Layers that must be resolved before this one. Drives resolution order, not stacking. */
  dependsOn: z.array(identifierSchema).default([]),
  opacity: z.number().min(0).max(1).default(1),
  blendMode: blendModeSchema.default('normal'),
  offset: offsetSchema.default({ x: 0, y: 0 }),
  options: z.array(layerOptionSchema).min(1),
});

/** Maps a layer id to the option id(s) that satisfy the condition. */
export const selectorSchema = z.record(
  z.string(),
  z.union([identifierSchema, z.array(identifierSchema).min(1)]),
);

export const constraintSchema = z.strictObject({
  id: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  when: selectorSchema,
  /** Targets that become unselectable while the condition holds. */
  disable: z.array(targetRefSchema).default([]),
  /** Layers excluded from the render while the condition holds. */
  hide: z.array(identifierSchema).default([]),
  /** Targets that must be selected while the condition holds. */
  require: z.array(targetRefSchema).default([]),
});

export const thumbnailSchema = z.strictObject({
  width: z.number().int().positive(),
  height: z.number().int().positive().optional(),
  format: imageFormatSchema.default('png'),
});

export const exportsSchema = z.strictObject({
  formats: z.array(imageFormatSchema).min(1).default(['png']),
  thumbnail: thumbnailSchema.optional(),
  metadata: z.boolean().default(true),
});

export const canvasSchema = z.strictObject({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  background: z
    .string()
    .regex(HEX_COLOR_PATTERN, 'must be #RRGGBB or #RRGGBBAA')
    .optional(),
});

export const pluginManifestSchema = z.strictObject({
  /** Editor hint only; ignored by the engine. */
  $schema: z.string().min(1).optional(),
  name: identifierSchema,
  version: z.string().regex(SEMVER_PATTERN, 'must be a semver version'),
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  author: z.string().min(1).optional(),
  license: z.string().min(1).optional(),
  canvas: canvasSchema,
  layers: z.array(layerSchema).min(1),
  constraints: z.array(constraintSchema).default([]),
  exports: exportsSchema.default({ formats: ['png'], metadata: true }),
});
