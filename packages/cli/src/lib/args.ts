import { parseArgs } from 'node:util';
import type { ImageFormat } from '@klairox/plugin-sdk';

export const COMMANDS = ['generate', 'validate', 'info'] as const;
export type CommandName = (typeof COMMANDS)[number];

export interface CliOptions {
  readonly command: CommandName;
  readonly pluginDir: string;
  readonly selection: Readonly<Record<string, string>>;
  readonly outputDir: string;
  readonly name?: string;
  readonly formats?: readonly ImageFormat[];
  readonly quality?: number;
  readonly thumbnail: boolean;
  readonly metadata: boolean;
}

export type ParsedArgs =
  | { readonly kind: 'help' }
  | { readonly kind: 'version' }
  | { readonly kind: 'run'; readonly options: CliOptions };

/** Raised for anything the user can fix by retyping the command. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

const DEFAULT_OUTPUT_DIR = 'dist/assets';
const IMAGE_FORMATS: readonly string[] = ['png', 'webp'];

export function parseCliArgs(argv: readonly string[]): ParsedArgs {
  const { values, positionals } = parseArgsSafely(argv);

  if (values.help === true || positionals.length === 0) {
    return { kind: 'help' };
  }
  if (values.version === true) {
    return { kind: 'version' };
  }

  const [command, pluginDir] = positionals;
  assertCommand(command);

  if (pluginDir === undefined) {
    throw new UsageError(`Command "${command}" needs a plugin directory`);
  }

  return {
    kind: 'run',
    options: {
      command,
      pluginDir,
      selection: parseSelection(values.select ?? []),
      outputDir: values.out ?? DEFAULT_OUTPUT_DIR,
      name: values.name,
      formats: parseFormats(values.format),
      quality: parseQuality(values.quality),
      thumbnail: values['no-thumbnail'] !== true,
      metadata: values['no-metadata'] !== true,
    },
  };
}

interface RawValues {
  readonly help?: boolean;
  readonly version?: boolean;
  readonly select?: string[];
  readonly format?: string[];
  readonly out?: string;
  readonly name?: string;
  readonly quality?: string;
  readonly 'no-thumbnail'?: boolean;
  readonly 'no-metadata'?: boolean;
}

function parseArgsSafely(argv: readonly string[]): {
  values: RawValues;
  positionals: string[];
} {
  try {
    return parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
        select: { type: 'string', short: 's', multiple: true },
        format: { type: 'string', short: 'f', multiple: true },
        out: { type: 'string', short: 'o' },
        name: { type: 'string', short: 'n' },
        quality: { type: 'string' },
        'no-thumbnail': { type: 'boolean' },
        'no-metadata': { type: 'boolean' },
      },
    });
  } catch (error) {
    throw new UsageError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

function assertCommand(
  command: string | undefined,
): asserts command is CommandName {
  if (command === undefined || !COMMANDS.includes(command as CommandName)) {
    throw new UsageError(
      `Unknown command "${command ?? ''}". Expected one of: ${COMMANDS.join(', ')}`,
    );
  }
}

function parseSelection(entries: readonly string[]): Record<string, string> {
  const selection: Record<string, string> = {};

  for (const entry of entries) {
    const separatorIndex = entry.indexOf('=');
    if (separatorIndex <= 0 || separatorIndex === entry.length - 1) {
      throw new UsageError(
        `Invalid --select "${entry}". Expected the form layer=option`,
      );
    }

    selection[entry.slice(0, separatorIndex)] = entry.slice(separatorIndex + 1);
  }

  return selection;
}

function parseFormats(
  formats: readonly string[] | undefined,
): ImageFormat[] | undefined {
  if (formats === undefined || formats.length === 0) {
    return undefined;
  }

  return formats.map((format) => {
    if (!IMAGE_FORMATS.includes(format)) {
      throw new UsageError(
        `Invalid --format "${format}". Expected one of: ${IMAGE_FORMATS.join(', ')}`,
      );
    }
    return format as ImageFormat;
  });
}

function parseQuality(quality: string | undefined): number | undefined {
  if (quality === undefined) {
    return undefined;
  }

  const parsed = Number(quality);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new UsageError(
      `Invalid --quality "${quality}". Expected a non-negative integer`,
    );
  }

  return parsed;
}
