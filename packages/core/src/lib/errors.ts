export type KlairoxErrorCode =
  | 'PLUGIN_NOT_FOUND'
  | 'MANIFEST_UNREADABLE'
  | 'MANIFEST_INVALID'
  | 'ASSET_NOT_FOUND'
  | 'ASSET_OUTSIDE_PLUGIN'
  | 'SELECTION_INVALID'
  | 'CONSTRAINT_VIOLATION'
  | 'VARIANTS_INVALID'
  | 'RENDER_FAILED'
  | 'EXPORT_FAILED';

export interface KlairoxErrorOptions {
  /** Individual problems, listed when a single message is not enough. */
  readonly details?: readonly string[];
  readonly cause?: unknown;
}

/** Every failure raised by the engine, tagged with a stable machine-readable code. */
export class KlairoxError extends Error {
  readonly code: KlairoxErrorCode;
  readonly details: readonly string[];

  constructor(
    code: KlairoxErrorCode,
    message: string,
    options: KlairoxErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'KlairoxError';
    this.code = code;
    this.details = options.details ?? [];
  }

  /** Human-readable rendering, used by the CLI and by log output. */
  format(): string {
    if (this.details.length === 0) {
      return this.message;
    }

    return [
      this.message,
      ...this.details.map((detail) => `  - ${detail}`),
    ].join('\n');
  }
}

export function isKlairoxError(error: unknown): error is KlairoxError {
  return error instanceof KlairoxError;
}
