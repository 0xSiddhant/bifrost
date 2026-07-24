/**
 * Calcifer — the Loki execution sandbox (PLAN-12 Part B). An ephemeral module
 * Web Worker: no DOM, no localStorage, no cookies, and killable from outside
 * (the main thread's watchdog / Stop both `terminate()` it), so a `while(true)`
 * can never take the editor down. One run per worker; the main thread spawns a
 * fresh one each time and terminates it when the result arrives.
 *
 * Console output is captured and budget-capped *inside* the worker; every value
 * is serialized to a string here (structuredClone can't carry functions and
 * loses `undefined`), so only plain strings/numbers cross the channel.
 */
import { formatConsoleArgs, inspect } from './serialize';
import type { ConsoleLevel, RunRequest, WorkerMessage } from './protocol';

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<RunRequest>) => void) | null;
  postMessage: (message: WorkerMessage) => void;
  console: Record<string, (...args: unknown[]) => void>;
  fetch?: unknown;
};

// AsyncFunction constructor — top-level `await` in a snippet just works.
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => () => Promise<unknown>;

ctx.onmessage = (event) => {
  const req = event.data;
  if (!req || req.type !== 'run') return;
  void execute(req);
};

async function execute(req: RunRequest): Promise<void> {
  const { runId, code, fetchAllowed, consoleMaxEntries, maxEntryChars } = req;
  let count = 0;
  let dropped = 0;

  const emit = (level: ConsoleLevel, args: unknown[]): void => {
    if (count >= consoleMaxEntries) {
      dropped += 1;
      return;
    }
    count += 1;
    let text = formatConsoleArgs(args);
    let truncated = false;
    if (text.length > maxEntryChars) {
      text = text.slice(0, maxEntryChars);
      truncated = true;
    }
    ctx.postMessage({ type: 'log', runId, level, text, truncated });
  };

  ctx.console = {
    log: (...a: unknown[]) => emit('log', a),
    info: (...a: unknown[]) => emit('info', a),
    warn: (...a: unknown[]) => emit('warn', a),
    error: (...a: unknown[]) => emit('error', a),
    debug: (...a: unknown[]) => emit('debug', a),
    table: (...a: unknown[]) => emit('table', a),
  };

  if (!fetchAllowed) {
    ctx.fetch = () => {
      throw new Error('fetch() is disabled by Heimdall for Loki runs.');
    };
  }

  const flushDropped = (): void => {
    if (dropped > 0) ctx.postMessage({ type: 'truncated', runId, dropped });
  };

  try {
    // The main thread has already rewritten a trailing expression to `return
    // (…)` (REPL completion value), so we just run the body and report whatever
    // it returns. `undefined` means "no value" (a declaration/loop/if ending).
    const result = await new AsyncFunction(code)();
    const hasValue = result !== undefined;
    flushDropped();
    ctx.postMessage({ type: 'result', runId, value: hasValue ? inspect(result) : null, hasValue });
  } catch (error) {
    flushDropped();
    const err = error as { name?: string; message?: string; stack?: string };
    ctx.postMessage({
      type: 'error',
      runId,
      name: err?.name ?? 'Error',
      message: err?.message ?? String(error),
      stack: typeof err?.stack === 'string' ? err.stack : null,
    });
  }
}
