import type { ManifestIndex, PluginManifest } from '@klairox/plugin-sdk';

/** A validated, indexed plugin ready for selection and composition. */
export interface LoadedPlugin {
  readonly manifest: PluginManifest;
  readonly index: ManifestIndex;
  readonly rootDir: string;
  readonly manifestPath: string;
}
