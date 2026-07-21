/**
 * In-process tap on the log stream (PLAN-10 Logs section). The logger writes
 * every serialized line here; the tap keeps a bounded ring of parsed entries
 * (for the `GET /logs` tail) and fans each new line out to live subscribers
 * (the admin log-follow SSE). Deliberately in-memory: the file remains the
 * durable record (`npm run logs` / observability tail it) — this only needs the
 * recent window a debugging admin actually reads.
 */

const LEVEL_LABELS: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

const RESERVED = new Set(['time', 'level', 'msg', 'module', 'pid', 'hostname', 'v']);

export interface LogEntry {
  time: number;
  level: number;
  levelLabel: string;
  module: string | null;
  msg: string;
  /** Any structured fields beyond the standard pino keys. */
  extra?: Record<string, unknown>;
}

export function parseLogLine(line: string): LogEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  const level = typeof obj.level === 'number' ? obj.level : 30;
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!RESERVED.has(key)) extra[key] = value;
  }
  return {
    time: typeof obj.time === 'number' ? obj.time : Date.now(),
    level,
    levelLabel: LEVEL_LABELS[level] ?? String(level),
    module: typeof obj.module === 'string' ? obj.module : null,
    msg: typeof obj.msg === 'string' ? obj.msg : '',
    extra: Object.keys(extra).length > 0 ? extra : undefined,
  };
}

export class LogTap {
  private readonly buffer: LogEntry[] = [];
  private readonly listeners = new Set<(entry: LogEntry) => void>();

  constructor(private readonly capacity = 1000) {}

  /** Called by the logger sink for each serialized JSON line. */
  writeLine(line: string): void {
    const entry = parseLogLine(line);
    if (!entry) return;
    this.buffer.push(entry);
    if (this.buffer.length > this.capacity) this.buffer.shift();
    for (const listener of this.listeners) listener(entry);
  }

  /** The retained window, oldest first. */
  recent(): LogEntry[] {
    return [...this.buffer];
  }

  /** Live tail; returns an unsubscribe handle. */
  subscribe(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
