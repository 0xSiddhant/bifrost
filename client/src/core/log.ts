import { getDeviceId } from './deviceId';

/**
 * Browser-side logging (PLAN-16a).
 *
 * Bifrost is opened from phones and tablets the owner is never sitting at, so
 * until now a React crash or a failed fetch on one of them had no path back:
 * no console anyone reads, nothing in `storage/logs/`. Lines reported here are
 * batched to `POST /api/client-logs` and re-emitted through the server's pino
 * with `source: "client"`, so they land in the same files and inherit the same
 * rotation, Alloy shipping, and backfill as everything else.
 *
 * Two rules shape the whole file:
 *
 * 1. **`warn` and above, by default.** The server logs at `trace` because
 *    appending to a local file is free; every line here crosses the network
 *    into an unauthenticated endpoint, so the economics invert. The floor
 *    arrives from `GET /api/client-logs/config` (an operator can lower it
 *    without a rebuild) and falls back to `warn` when that request fails —
 *    logging must never depend on the config round-trip succeeding.
 * 2. **Never make things worse.** A failed send is dropped, never retried:
 *    reporting an error about the error reporter is the shortest path to a
 *    crash loop, and the page the user is on matters more than the report.
 */

export type ClientLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LEVELS: ClientLogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

const DEFAULT_LEVEL: ClientLogLevel = 'warn';
const CONFIG_URL = '/api/client-logs/config';
const INGEST_URL = '/api/client-logs';

/** Debounce window: an error burst (a render loop) becomes one request. */
const FLUSH_DELAY_MS = 2000;
/** Server default is 50; re-read from /config on boot. */
const DEFAULT_MAX_BATCH = 50;
/** Hard bound on what one page can queue if the endpoint is refusing. */
const QUEUE_CAP = 100;
/** Server caps these too — trimming here keeps a whole batch from 400ing. */
const MAX_MSG = 2000;
const MAX_STACK = 8000;

export interface ClientLogFields {
  /** Feature name — matches the server module of the same name where one exists. */
  module?: string;
  /** Stack, when there is one. */
  stack?: string;
}

interface QueuedEntry {
  level: ClientLogLevel;
  msg: string;
  module?: string;
  route?: string;
  stack?: string;
  ts: number;
}

interface Transport {
  send: (entries: QueuedEntry[]) => Promise<void>;
  now: () => number;
  route: () => string;
  schedule: (fn: () => void, ms: number) => number;
  cancel: (handle: number) => void;
}

const defaultTransport: Transport = {
  send: async (entries) => {
    const response = await fetch(INGEST_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bifrost-device': getDeviceId() },
      body: JSON.stringify({ entries }),
      // The page may be unloading when the last batch goes out.
      keepalive: true,
    });
    if (!response.ok) throw new Error(`client-logs responded ${response.status}`);
  },
  now: () => Date.now(),
  route: () => window.location.pathname,
  schedule: (fn, ms) => window.setTimeout(fn, ms),
  cancel: (handle) => window.clearTimeout(handle),
};

export class ClientLogger {
  private level: ClientLogLevel = DEFAULT_LEVEL;
  private maxBatch = DEFAULT_MAX_BATCH;
  private queue: QueuedEntry[] = [];
  private timer: number | null = null;
  /** Set while a send is in flight, so a flush can't double-post the batch. */
  private sending = false;

  constructor(private readonly transport: Transport = defaultTransport) {}

  /**
   * Read the floor from the server. Deliberately fire-and-forget: on failure
   * the default floor stands and logging keeps working, because a broken
   * config request is exactly the kind of moment worth having logs for.
   */
  async configure(fetchConfig: () => Promise<unknown> = defaultFetchConfig): Promise<void> {
    try {
      const config = (await fetchConfig()) as { level?: unknown; maxBatch?: unknown };
      if (isLevel(config.level)) this.level = config.level;
      if (typeof config.maxBatch === 'number' && config.maxBatch > 0) {
        this.maxBatch = Math.floor(config.maxBatch);
      }
    } catch {
      // Deliberately silent, and deliberately not reported through this very
      // logger: the floor stays at `warn`, which is the safe end of the range.
    }
  }

  /** Current floor — exposed for tests and for the "is this on?" question. */
  get floor(): ClientLogLevel {
    return this.level;
  }

  trace = (msg: string, fields?: ClientLogFields) => this.report('trace', msg, fields);
  debug = (msg: string, fields?: ClientLogFields) => this.report('debug', msg, fields);
  info = (msg: string, fields?: ClientLogFields) => this.report('info', msg, fields);
  warn = (msg: string, fields?: ClientLogFields) => this.report('warn', msg, fields);
  error = (msg: string, fields?: ClientLogFields) => this.report('error', msg, fields);
  fatal = (msg: string, fields?: ClientLogFields) => this.report('fatal', msg, fields);

  /** Report a caught value — the shape most call sites actually have. */
  reportError(msg: string, error: unknown, fields?: ClientLogFields): void {
    const detail = error instanceof Error ? `${msg}: ${error.message}` : msg;
    const stack = error instanceof Error ? error.stack : undefined;
    this.report('error', detail, { ...fields, stack: fields?.stack ?? stack });
  }

  private report(level: ClientLogLevel, msg: string, fields?: ClientLogFields): void {
    if (LEVELS.indexOf(level) < LEVELS.indexOf(this.level)) return;
    if (this.queue.length >= QUEUE_CAP) return;
    this.queue.push({
      level,
      msg: msg.slice(0, MAX_MSG),
      module: fields?.module,
      route: this.transport.route(),
      stack: fields?.stack?.slice(0, MAX_STACK),
      ts: this.transport.now(),
    });
    if (this.timer === null) {
      this.timer = this.transport.schedule(() => {
        this.timer = null;
        void this.flush();
      }, FLUSH_DELAY_MS);
    }
  }

  /** Send what's queued. Safe to call at any time; never throws. */
  async flush(): Promise<void> {
    if (this.sending || this.queue.length === 0) return;
    if (this.timer !== null) {
      this.transport.cancel(this.timer);
      this.timer = null;
    }
    const batch = this.queue.slice(0, this.maxBatch);
    this.queue = this.queue.slice(batch.length);
    this.sending = true;
    try {
      await this.transport.send(batch);
    } catch {
      // Dropped, not requeued. A retry loop against a refusing endpoint would
      // grow the queue and the request rate at exactly the moment the page is
      // already in trouble — and the rate limiter would refuse it anyway.
    } finally {
      this.sending = false;
    }
  }
}

function isLevel(value: unknown): value is ClientLogLevel {
  return typeof value === 'string' && (LEVELS as string[]).includes(value);
}

async function defaultFetchConfig(): Promise<unknown> {
  const response = await fetch(CONFIG_URL, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`client-logs config responded ${response.status}`);
  return response.json();
}

/** The app-wide logger. Client code logs through this, never bare `console.*`. */
export const log = new ClientLogger();

/**
 * Install the global nets and read the floor. Called once from `main.tsx`.
 *
 * `window.onerror` and `unhandledrejection` are what make this more than
 * opt-in: the failures worth knowing about are the ones nobody wrote a
 * try/catch for.
 */
export function initClientLogging(): void {
  void log.configure();

  window.addEventListener('error', (event) => {
    const error: unknown = event.error;
    const where = event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : '';
    log.error(`uncaught error: ${event.message}${where}`, {
      stack: error instanceof Error ? error.stack : undefined,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    log.error(`unhandled rejection: ${message}`, {
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });

  // A tab closing on a fresh error would otherwise take the report with it.
  window.addEventListener('pagehide', () => void log.flush());
}
