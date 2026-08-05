import type { ParsedTargetRef } from './manifest.types.js';

const TARGET_REF_SEPARATOR = ':';

/** Splits `body` into `{ layerId: 'body' }` and `body:heavy` into `{ layerId: 'body', optionId: 'heavy' }`. */
export function parseTargetRef(ref: string): ParsedTargetRef {
  const separatorIndex = ref.indexOf(TARGET_REF_SEPARATOR);
  if (separatorIndex === -1) {
    return { layerId: ref };
  }

  return {
    layerId: ref.slice(0, separatorIndex),
    optionId: ref.slice(separatorIndex + 1),
  };
}

export function formatTargetRef(layerId: string, optionId?: string): string {
  return optionId ? `${layerId}${TARGET_REF_SEPARATOR}${optionId}` : layerId;
}
