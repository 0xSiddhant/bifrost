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
 * Colour and progress follow the same rule: both are decided per stream from
 * `isTTY`, so nothing that reaches a pipe or a file ever carries an escape
 * sequence or a redrawn line. `NO_COLOR` turns colour off everywhere and
 * `FORCE_COLOR` turns it on; `--json` disables both outright.
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

// ---------------------------------------------------------------- colour ----

type Stream = 'stdout' | 'stderr';

const CODES = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
} as const;

/**
 * Decided per stream and re-read every time, never cached: a test (and a
 * command that redirects) can change the answer between two calls, and the
 * cost of an `isTTY` read is nothing next to the write it guards.
 */
export function colourEnabled(stream: Stream = 'stdout'): boolean {
  if (jsonMode) return false;
  // NO_COLOR is honoured by its presence, whatever its value (no-color.org).
  if (process.env.NO_COLOR !== undefined) return false;
  const forced = process.env.FORCE_COLOR;
  if (forced !== undefined && forced !== '0') return true;
  return (stream === 'stdout' ? process.stdout.isTTY : process.stderr.isTTY) === true;
}

function paint(text: string, codes: readonly string[], stream: Stream): string {
  return colourEnabled(stream) ? `${codes.join('')}${text}${CODES.reset}` : text;
}

/**
 * The composable styles. They colour for **stdout**, because that is what a
 * `print` renderer feeds and what a person pipes; `note`/`warn`/`printError`
 * style themselves against stderr instead.
 *
 * Symbols are not colour: they stay in human mode even without a TTY, because
 * a ✓ in a log file still reads as a ✓.
 */
export const ok = (text: string): string => paint(`✓ ${text}`, [CODES.green], 'stdout');
export const bad = (text: string): string => paint(`✗ ${text}`, [CODES.red], 'stdout');
export const attention = (text: string): string => paint(`⚠ ${text}`, [CODES.yellow], 'stdout');
export const dim = (text: string): string => paint(text, [CODES.dim], 'stdout');
export const bold = (text: string): string => paint(text, [CODES.bold], 'stdout');
export const accent = (text: string): string => paint(text, [CODES.cyan], 'stdout');

/** A section title: bold, with a rule under it so blocks separate at a glance. */
export function heading(text: string): string {
  return `${bold(text)}\n${dim('─'.repeat(text.length))}`;
}

/** Key/value block — the shape `status`, `config show` and `speed` all print. */
export function fields(rows: readonly (readonly [string, string])[]): string {
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map(([key]) => key.length));
  return rows.map(([key, value]) => `${dim(key.padEnd(width))}  ${value}`).join('\n');
}

// ---------------------------------------------------------------- output ----

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
  process.stderr.write(`${paint(text, [CODES.dim], 'stderr')}\n`);
}

/** Something failed but the command carried on. Always stderr, both modes. */
export function warn(text: string): void {
  process.stderr.write(`${paint(`⚠ warning:`, [CODES.yellow], 'stderr')} ${text}\n`);
}

/** The failure line, on stderr so stdout stays empty (and parseable) either way. */
export function printError(message: string): void {
  if (jsonMode) {
    process.stderr.write(`${JSON.stringify({ error: message })}\n`);
    return;
  }
  process.stderr.write(`${paint('✗ error:', [CODES.red], 'stderr')} ${message}\n`);
}

// ----------------------------------------------------------------- table ----

export interface Column<T> {
  header: string;
  value: (row: T) => string;
  /** Right-aligned for numbers, so sizes line up on the decimal-ish end. */
  align?: 'left' | 'right';
}

const BOX = {
  topLeft: '┌',
  topMid: '┬',
  topRight: '┐',
  midLeft: '├',
  midMid: '┼',
  midRight: '┤',
  bottomLeft: '└',
  bottomMid: '┴',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
} as const;

/**
 * A box-drawn table.
 *
 * **Cell values must be plain text.** Padding happens before styling — an ANSI
 * sequence inside a value would be counted as visible width and every column
 * after it would sit crooked. The renderer styles the frame and header itself,
 * which is why no caller needs to.
 */
export function table<T>(rows: readonly T[], columns: readonly Column<T>[]): string {
  if (rows.length === 0) return '';
  const cells = rows.map((row) => columns.map((column) => column.value(row)));
  const widths = columns.map((column, index) =>
    Math.max(column.header.length, ...cells.map((row) => (row[index] ?? '').length)),
  );

  const pad = (value: string, index: number): string => {
    const width = widths[index] ?? value.length;
    return columns[index]?.align === 'right' ? value.padStart(width) : value.padEnd(width);
  };
  const rule = (left: string, mid: string, right: string): string =>
    dim(left + widths.map((width) => BOX.horizontal.repeat(width + 2)).join(mid) + right);
  const line = (values: readonly string[], style: (text: string) => string): string => {
    const bar = dim(BOX.vertical);
    return `${bar} ${values.map((value, index) => style(pad(value, index))).join(` ${bar} `)} ${bar}`;
  };

  return [
    rule(BOX.topLeft, BOX.topMid, BOX.topRight),
    line(
      columns.map((column) => column.header),
      bold,
    ),
    rule(BOX.midLeft, BOX.midMid, BOX.midRight),
    ...cells.map((row) => line(row, (text) => text)),
    rule(BOX.bottomLeft, BOX.bottomMid, BOX.bottomRight),
  ].join('\n');
}

// -------------------------------------------------------------- progress ----

export interface ProgressHandle {
  /** Bytes (or units) transferred so far. */
  update(done: number): void;
  /** Clears the line. Safe to call more than once. */
  stop(): void;
}

const IDLE_PROGRESS: ProgressHandle = { update: () => undefined, stop: () => undefined };

/** Redraws at most this often — a 500 MB transfer must not cost 500k writes. */
const PROGRESS_INTERVAL_MS = 80;
const BAR_WIDTH = 24;

/**
 * A transfer bar on **stderr**, so stdout stays exactly what it would be
 * without it and `bifrost pull x --json > out` is unaffected. Returns an inert
 * handle whenever the output is not a live terminal (a pipe, a file, CI, or
 * `--json`), so the caller never has to ask.
 */
export function progress(label: string, total: number): ProgressHandle {
  if (jsonMode || process.stderr.isTTY !== true || !Number.isFinite(total) || total <= 0) {
    return IDLE_PROGRESS;
  }

  let lastDrawAt = 0;
  let stopped = false;
  const draw = (done: number, force: boolean): void => {
    const now = Date.now();
    if (stopped || (!force && now - lastDrawAt < PROGRESS_INTERVAL_MS)) return;
    lastDrawAt = now;
    const fraction = Math.min(1, Math.max(0, done / total));
    const filled = Math.round(fraction * BAR_WIDTH);
    const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
    const percent = String(Math.round(fraction * 100)).padStart(3);
    process.stderr.write(
      `\r${paint(`${label} ▕${bar}▏ ${percent}%  ${formatBytes(done)} / ${formatBytes(total)}`, [CODES.dim], 'stderr')}`,
    );
  };

  draw(0, true);
  return {
    update: (done: number) => draw(done, false),
    stop: () => {
      if (stopped) return;
      stopped = true;
      // Clear the whole line rather than overwriting it: the next line printed
      // is usually shorter, and leftovers of a bar read as corruption.
      process.stderr.write(`\r\u001b[2K`);
    },
  };
}

// ------------------------------------------------------------ formatting ----

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

/** `1 file` / `3 files` — the plural that appears in almost every summary. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
