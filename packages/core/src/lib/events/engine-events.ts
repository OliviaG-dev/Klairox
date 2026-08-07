import type { ImageFormat } from '@klairox/plugin-sdk';
import type { ExportedArtifact } from '../export/export.types.js';
import type { Selection } from '../selection/selection.types.js';

export type BatchJobStatus = 'generated' | 'cached' | 'planned';

/**
 * Everything the engine reports while it works. Hosts subscribe instead of polling.
 * Declared as a type alias so it keeps an implicit index signature and satisfies `EventMap`.
 */
export type KlairoxEventMap = {
  'plugin:loaded': {
    readonly pluginName: string;
    readonly rootDir: string;
    readonly layerCount: number;
  };
  'selection:resolved': {
    readonly pluginName: string;
    readonly selection: Selection;
  };
  'composition:planned': {
    readonly pluginName: string;
    readonly layerCount: number;
    readonly hiddenLayers: readonly string[];
  };
  'asset:rendered': {
    readonly format: ImageFormat | 'json';
    readonly byteLength: number;
  };
  'asset:exported': {
    readonly outputDir: string;
    readonly artifacts: readonly ExportedArtifact[];
  };
  'batch:started': {
    readonly pluginName: string;
    readonly total: number;
    readonly rejected: number;
    readonly dryRun: boolean;
  };
  'batch:variant': {
    readonly index: number;
    readonly total: number;
    readonly name: string;
    readonly status: BatchJobStatus;
    readonly planHash: string;
  };
  'batch:completed': {
    readonly pluginName: string;
    readonly generated: number;
    readonly cached: number;
    readonly planned: number;
    readonly rejected: number;
  };
};

export type KlairoxEventName = keyof KlairoxEventMap;
