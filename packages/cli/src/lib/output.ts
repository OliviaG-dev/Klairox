import path from 'node:path';
import type { CompositionPlan, ExportedArtifact } from '@klairox/core';
import { style } from './styles.js';

const BYTES_PER_KIB = 1024;

export function formatBytes(byteLength: number): string {
  if (byteLength < BYTES_PER_KIB) {
    return `${byteLength} B`;
  }

  return `${(byteLength / BYTES_PER_KIB).toFixed(1)} kB`;
}

export function printSelection(plan: CompositionPlan): void {
  console.log(style.bold('\nSelection'));

  for (const layer of plan.layers) {
    console.log(`  ${layer.layerId.padEnd(14)} ${style.cyan(layer.optionId)}`);
  }

  if (plan.hiddenLayers.length > 0) {
    console.log(
      style.dim(`  hidden by constraints: ${plan.hiddenLayers.join(', ')}`),
    );
  }
}

export function printArtifacts(
  artifacts: readonly ExportedArtifact[],
  cwd: string,
): void {
  console.log(style.bold('\nOutput'));

  for (const artifact of artifacts) {
    const location = path.relative(cwd, artifact.filePath) || artifact.filePath;
    console.log(
      `  ${style.green('+')} ${location} ${style.dim(`(${formatBytes(artifact.byteLength)})`)}`,
    );
  }
}
