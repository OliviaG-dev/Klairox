import type { PluginManifest } from './manifest.types.js';

/** A single validation problem, addressed with a dot/bracket path into the manifest. */
export interface ManifestIssue {
  readonly path: string;
  readonly message: string;
}

export type ManifestParseResult =
  | { readonly ok: true; readonly manifest: PluginManifest }
  | { readonly ok: false; readonly issues: readonly ManifestIssue[] };
