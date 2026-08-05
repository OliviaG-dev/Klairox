import type { ImageFormat, ThumbnailConfig } from '@klairox/plugin-sdk';

export type ArtifactKind = 'image' | 'thumbnail' | 'metadata';

export interface ExportedArtifact {
  readonly kind: ArtifactKind;
  readonly format: ImageFormat | 'json';
  readonly filePath: string;
  readonly byteLength: number;
}

export interface ExportOptions {
  readonly outputDir: string;
  /** Base file name, without extension. */
  readonly name: string;
  /** Overrides the formats declared by the plugin. */
  readonly formats?: readonly ImageFormat[];
  /** `false` disables the thumbnail even when the plugin declares one. */
  readonly thumbnail?: ThumbnailConfig | false;
  /** Overrides whether the metadata sidecar is written. */
  readonly metadata?: boolean;
}
