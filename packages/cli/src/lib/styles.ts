const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  cyan: '\u001b[36m',
} as const;

/** Honours the NO_COLOR convention and plain (non-TTY) output such as CI logs. */
function colorEnabled(): boolean {
  return process.env['NO_COLOR'] === undefined && process.stdout.isTTY === true;
}

function paint(code: string, text: string): string {
  return colorEnabled() ? `${code}${text}${ANSI.reset}` : text;
}

export const style = {
  bold: (text: string): string => paint(ANSI.bold, text),
  dim: (text: string): string => paint(ANSI.dim, text),
  red: (text: string): string => paint(ANSI.red, text),
  green: (text: string): string => paint(ANSI.green, text),
  cyan: (text: string): string => paint(ANSI.cyan, text),
};
