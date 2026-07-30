import path from 'node:path';
import { trace } from '@opentelemetry/api';
import pino from 'pino';
import type { LogLevel } from '../config/index.js';

export type Logger = pino.Logger;

export interface LoggerOptions {
  level: LogLevel;
  logsDir: string;
  /** Mirror logs to stdout via pino-pretty (dev mode). */
  pretty: boolean;
  /** Rotated files to keep beside the active one (LOG_RETENTION_FILES). */
  retainFiles: number;
}

/**
 * pino writes the level as a number, which would make the primary log UI filter
 * on `{level="50"}` instead of `{level="error"}` — unusable now that Grafana is
 * the only log reader. This formatter adds the text key `logLevel`.
 *
 * Named `logLevel`, not `log-level`: Loki label names forbid hyphens, so
 * camelCase keeps one name across the JSON key and the label.
 *
 * **The numeric `level` is kept**, deliberately, even though nothing in this
 * codebase reads it any more: `pino.transport()` with MORE THAN ONE target runs
 * a worker that re-parses each serialized line to decide which targets it
 * belongs to, and that router keys on the numeric level. Dropping the key made
 * the worker drop every line — file and stdout both silently produced *nothing*
 * (found in live verification; a single-target transport works either way,
 * which is what makes the trap so quiet). Alloy promotes only `logLevel` as a
 * label, so the extra ~12 bytes a line never reaches Loki.
 */
export const LEVEL_FORMATTER = {
  level: (label: string, number: number) => ({ logLevel: label, level: number }),
} as const;

/**
 * pino-roll options for the JSON file sink: daily rotation, 20 MB size cap,
 * `current.log` symlink always pointing at the active file (what `npm run logs`
 * tails), and a file-count retention limit so rotated files can't accumulate
 * forever on an appliance meant to run unattended.
 *
 * `removeOtherLogFiles: true` is load-bearing, not a flourish: pino-roll
 * otherwise counts only files the *current* process created, and Bifrost is
 * restarted constantly — every restart would start a fresh tally and the old
 * files would never be swept, which is exactly the disk-growth path the limit
 * exists to close. `count` is "in addition to the active file", so the folder
 * holds `retainFiles + 1`.
 */
export function rollOptions(logsDir: string, retainFiles: number) {
  return {
    file: path.join(logsDir, 'app'),
    extension: '.log',
    frequency: 'daily',
    size: '20m',
    mkdir: true,
    symlink: true,
    limit: { count: retainFiles, removeOtherLogFiles: true },
  } as const;
}

/**
 * Stamps the active trace on every line, so a log jumps to its trace in Grafana
 * (the Loki→Tempo correlation, PLAN-16b).
 *
 * Costs one function call per line and returns nothing when tracing is off,
 * which is the default — `trace.getActiveSpan()` is a no-op lookup until an SDK
 * registers a real tracer provider, so this stays inert rather than conditional.
 */
function traceContext(): Record<string, string> {
  const span = trace.getActiveSpan();
  if (!span) return {};
  const { traceId, spanId } = span.spanContext();
  return { trace_id: traceId, span_id: spanId };
}

export function createLogger(options: LoggerOptions): Logger {
  // Destination levels are 'trace' so the root logger's level is the single
  // gate, with no per-stream re-filtering.
  const targets: pino.TransportTargetOptions[] = [
    {
      target: 'pino-roll',
      options: { ...rollOptions(options.logsDir, options.retainFiles) },
      level: 'trace',
    },
  ];
  if (options.pretty) {
    targets.push({
      target: 'pino-pretty',
      // levelKey: tells pino-pretty to render the level from the text key. It
      // then treats `logLevel` as the level (not as an extra property) and
      // still hides the numeric `level` as a known key — so the redundant pair
      // shows up in neither. Without it, every dev line trails a dangling
      // `logLevel: "info"`. The `npm run logs` script passes the same flag.
      options: { colorize: true, translateTime: 'HH:MM:ss', levelKey: 'logLevel' },
      level: 'trace',
    });
  }
  return pino(
    { level: options.level, formatters: LEVEL_FORMATTER, mixin: traceContext },
    pino.transport({ targets }),
  );
}

/**
 * Every module logs through a child logger tagged with its name — and with
 * `source: 'server'`, the label that separates these lines from the browser's.
 *
 * `source` is a **child** binding, never a `base` one: pino *appends* to `base`
 * rather than overriding it, so `base: { source: 'server' }` plus a
 * `child({ source: 'client' })` would emit `{"source":"server","source":"client"}`.
 * Every parser in the chain happens to take the last occurrence, so it would
 * appear to work while resting on undefined behaviour. Root-logger lines (boot,
 * shutdown, Fastify's request logs) carry no `source` at all; Alloy defaults
 * those to `server` at ingest.
 */
export function moduleLogger(root: Logger, moduleName: string): Logger {
  return root.child({ source: 'server', module: moduleName });
}

/**
 * A logger for lines relayed from a browser (PLAN-16a): same file, same
 * rotation, same Alloy pipeline — only `source` differs, so `{module="accio"}`
 * returns both halves of a feature and `source="client"` narrows to the browser.
 *
 * **Must be built from the ROOT**, never from a module logger, for the reason
 * above: pino appends child bindings to the parent's, so `moduleLogger(...)
 * .child({ source: 'client' })` writes `source` twice. Sibling children of a
 * source-free root are the only way one process emits two values under one key.
 */
export function clientLogger(root: Logger, moduleName: string): Logger {
  return root.child({ source: 'client', module: moduleName });
}
