/**
 * Everything the CLI says, in one place.
 *
 * `--json` is a global flag, so the mode is process-wide state rather than an
 * argument threaded through every command: one `setJsonMode` at dispatch, and
 * no command has to remember it again. The split that matters is stdout vs.
 * stderr — stdout carries the answer (JSON or human), stderr carries the
 * chatter, so `bifrost pull --json | jq .` is parseable with nothing filtered
 * out first.
 *
 * `CliError` lives here rather than in `client.ts` because it is a *message to
 * the user* with an exit code attached, and because `discover.ts`/`config.ts`
 * raise one too — homing it in `client.ts` would make those two import the
 * module that already imports them.
 */

/**
 * Exit codes, so a script can tell "no such thing" from "the bridge is down"
 * without parsing the message. Anything unclassified is 1.
 */
export const EXIT = {
  failure: 1,
  /** The host didn't resolve, or nothing answered on it. */
  unreachable: 3,
  /** The bridge answered, and there is no such file/document/link. */
  notFound: 4,
  /** The bridge refused because something else holds the thing. */
  conflict: 5,
} as const;

/** A failure the CLI can name. Printed as one line; never a stack trace. */
export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode: number = EXIT.failure) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

let jsonMode = false;

export function setJsonMode(on: boolean): void {
  jsonMode = on;
}

export function isJsonMode(): boolean {
  return jsonMode;
}

/**
 * The only writer to stdout. In JSON mode `data` is serialized verbatim and
 * `render` is never called, which is what keeps human text out of a pipeline.
 */
export function print<T>(data: T, render: (value: T) => string): void {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return;
  }
  const text = render(data);
  if (text.length > 0) process.stdout.write(`${text}\n`);
}

/** Progress and confirmations. stderr, and silent in JSON mode. */
export function note(text: string): void {
  if (jsonMode) return;
  process.stderr.write(`${text}\n`);
}

/** Something failed but the command carried on. Always stderr, both modes. */
export function warn(text: string): void {
  process.stderr.write(`warning: ${text}\n`);
}

/** The failure line, on stderr so stdout stays empty (and parseable) either way. */
export function printError(message: string): void {
  process.stderr.write(jsonMode ? `${JSON.stringify({ error: message })}\n` : `error: ${message}\n`);
}

export interface Column<T> {
  header: string;
  value: (row: T) => string;
  /** Right-aligned for numbers, so sizes line up on the decimal-ish end. */
  align?: 'left' | 'right';
}

/**
 * A plain aligned table — no box drawing, so the output stays greppable and
 * pastes into a terminal that isn't ours.
 */
export function table<T>(rows: readonly T[], columns: readonly Column<T>[]): string {
  if (rows.length === 0) return '';
  const cells = rows.map((row) => columns.map((column) => column.value(row)));
  const widths = columns.map((column, index) =>
    Math.max(column.header.length, ...cells.map((row) => (row[index] ?? '').length)),
  );
  const line = (values: readonly string[]): string =>
    values
      .map((value, index) => {
        const width = widths[index] ?? value.length;
        return columns[index]?.align === 'right' ? value.padStart(width) : value.padEnd(width);
      })
      .join('  ')
      .trimEnd();

  return [
    line(columns.map((column) => column.header)),
    line(widths.map((width) => '-'.repeat(width))),
    ...cells.map(line),
  ].join('\n');
}

/** Binary units, matching what the browser client shows for the same files. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Epoch ms → a local, sortable stamp. */
export function formatWhen(epochMs: number): string {
  if (!Number.isFinite(epochMs) || epochMs <= 0) return '—';
  const date = new Date(epochMs);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
