import { isKlairoxError } from '@klairox/core';
import { parseCliArgs, UsageError, type CliOptions } from './args.js';
import { runGenerate } from './commands/generate.js';
import { runInfo } from './commands/info.js';
import { runValidate } from './commands/validate.js';
import { style } from './styles.js';
import { USAGE } from './usage.js';
import { readCliVersion } from './version.js';

export const EXIT_SUCCESS = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;

const COMMAND_HANDLERS: Record<
  CliOptions['command'],
  (options: CliOptions) => Promise<void>
> = {
  generate: runGenerate,
  validate: runValidate,
  info: runInfo,
};

/** Returns the process exit code instead of calling `process.exit`, so it stays testable. */
export async function runCli(argv: readonly string[]): Promise<number> {
  try {
    const parsed = parseCliArgs(argv);

    if (parsed.kind === 'help') {
      console.log(USAGE);
      return EXIT_SUCCESS;
    }
    if (parsed.kind === 'version') {
      console.log(readCliVersion());
      return EXIT_SUCCESS;
    }

    await COMMAND_HANDLERS[parsed.options.command](parsed.options);
    return EXIT_SUCCESS;
  } catch (error) {
    return reportError(error);
  }
}

function reportError(error: unknown): number {
  if (error instanceof UsageError) {
    console.error(`${style.red('error')} ${error.message}`);
    console.error(style.dim('\nRun "klairox --help" for usage.'));
    return EXIT_USAGE;
  }

  if (isKlairoxError(error)) {
    console.error(`${style.red(`error [${error.code}]`)} ${error.format()}`);
    return EXIT_FAILURE;
  }

  console.error(
    `${style.red('error')} ${error instanceof Error ? error.stack : String(error)}`,
  );
  return EXIT_FAILURE;
}
