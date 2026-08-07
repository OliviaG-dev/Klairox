import { parseCliArgs, UsageError } from './args.js';

function runOptions(argv: string[]) {
  const parsed = parseCliArgs(argv);
  if (parsed.kind !== 'run') {
    throw new Error(`expected a runnable command, got "${parsed.kind}"`);
  }
  return parsed.options;
}

describe('parseCliArgs', () => {
  it('shows the help when called without arguments', () => {
    expect(parseCliArgs([])).toEqual({ kind: 'help' });
  });

  it('shows the help on --help', () => {
    expect(parseCliArgs(['generate', 'plugins/horse', '--help'])).toEqual({
      kind: 'help',
    });
  });

  it('applies the defaults of the generate command', () => {
    expect(runOptions(['generate', 'plugins/horse'])).toEqual({
      command: 'generate',
      pluginDir: 'plugins/horse',
      selection: {},
      outputDir: 'dist/assets',
      name: undefined,
      formats: undefined,
      quality: undefined,
      thumbnail: true,
      metadata: true,
      axes: [],
      dryRun: false,
      force: false,
      concurrency: undefined,
    });
  });

  it('collects repeated --select flags into one selection', () => {
    const options = runOptions([
      'generate',
      'plugins/horse',
      '-s',
      'coat=bay',
      '--select',
      'equipment=saddle',
    ]);

    expect(options.selection).toEqual({ coat: 'bay', equipment: 'saddle' });
  });

  it('collects repeated --format flags', () => {
    expect(
      runOptions(['generate', 'p', '-f', 'png', '-f', 'webp']).formats,
    ).toEqual(['png', 'webp']);
  });

  it('turns the thumbnail and metadata off', () => {
    const options = runOptions([
      'generate',
      'p',
      '--no-thumbnail',
      '--no-metadata',
    ]);

    expect(options).toMatchObject({ thumbnail: false, metadata: false });
  });

  it('rejects an unknown command', () => {
    expect(() => parseCliArgs(['explode', 'p'])).toThrow(UsageError);
  });

  it('rejects a command without a plugin directory', () => {
    expect(() => parseCliArgs(['validate'])).toThrow(
      /needs a plugin directory/,
    );
  });

  it('rejects a --select without an option', () => {
    expect(() => parseCliArgs(['generate', 'p', '-s', 'coat'])).toThrow(
      /Expected the form layer=option/,
    );
  });

  it('rejects an unsupported format', () => {
    expect(() => parseCliArgs(['generate', 'p', '-f', 'gif'])).toThrow(
      /Invalid --format "gif"/,
    );
  });

  it('rejects a non-numeric quality', () => {
    expect(() => parseCliArgs(['generate', 'p', '--quality', 'high'])).toThrow(
      /Invalid --quality "high"/,
    );
  });

  it('parses batch axes, dry-run and concurrency', () => {
    expect(
      runOptions([
        'batch',
        'plugins/horse',
        '-a',
        'coat',
        '--axis',
        'mane',
        '--dry-run',
        '--force',
        '--concurrency',
        '2',
      ]),
    ).toMatchObject({
      command: 'batch',
      axes: ['coat', 'mane'],
      dryRun: true,
      force: true,
      concurrency: 2,
    });
  });

  it('rejects a non-positive concurrency', () => {
    expect(() => parseCliArgs(['batch', 'p', '--concurrency', '0'])).toThrow(
      /Invalid --concurrency "0"/,
    );
  });

  it('reports an unknown flag as a usage error', () => {
    expect(() => parseCliArgs(['generate', 'p', '--turbo'])).toThrow(
      UsageError,
    );
  });
});
