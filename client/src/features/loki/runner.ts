/**
 * Main-thread controller for the Calcifer worker (PLAN-12 Part B). Owns the
 * spawn → watchdog → terminate lifecycle. Two kill paths — the watchdog firing
 * and a manual Stop — both just `terminate()`. A per-run `runId` filters out
 * any stray message from a worker that was already terminated.
 */
import type { ConsoleLevel, RunRequest, WorkerMessage } from './protocol';

const MAX_ENTRY_CHARS = 8_000;

export interface RunOptions {
  fetchAllowed: boolean;
  consoleMaxEntries: number;
  timeoutMs: number;
}

export interface RunHandlers {
  onLog: (level: ConsoleLevel, text: string, truncated: boolean) => void;
  onTruncated: (dropped: number) => void;
  onResult: (value: string | null, hasValue: boolean) => void;
  onError: (name: string, message: string, stack: string | null) => void;
  /** Fires once when the run settles (result, error, or timeout). */
  onSettled: (outcome: 'result' | 'error' | 'timeout') => void;
}

function newRunId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class LokiRunner {
  private worker: Worker | null = null;
  private runId = '';
  private watchdog: number | null = null;
  private settled = false;

  get running(): boolean {
    return this.worker !== null;
  }

  run(code: string, options: RunOptions, handlers: RunHandlers): void {
    this.terminate(); // kill any prior run
    this.settled = false;
    this.runId = newRunId();
    const worker = new Worker(new URL('./loki-runner.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker = worker;

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.runId !== this.runId) return; // stale worker, ignore
      switch (message.type) {
        case 'log':
          handlers.onLog(message.level, message.text, message.truncated);
          break;
        case 'truncated':
          handlers.onTruncated(message.dropped);
          break;
        case 'result':
          this.settle('result', () => handlers.onResult(message.value, message.hasValue), handlers);
          break;
        case 'error':
          this.settle(
            'error',
            () => handlers.onError(message.name, message.message, message.stack),
            handlers,
          );
          break;
      }
    };

    worker.onerror = (event: ErrorEvent) => {
      this.settle(
        'error',
        () => handlers.onError('WorkerError', event.message || 'the worker crashed', null),
        handlers,
      );
    };

    this.watchdog = window.setTimeout(() => {
      this.settle(
        'timeout',
        () =>
          handlers.onError(
            'Timeout',
            `Execution exceeded ${options.timeoutMs} ms — terminated.`,
            null,
          ),
        handlers,
      );
    }, options.timeoutMs);

    const request: RunRequest = {
      type: 'run',
      runId: this.runId,
      code,
      fetchAllowed: options.fetchAllowed,
      consoleMaxEntries: options.consoleMaxEntries,
      maxEntryChars: MAX_ENTRY_CHARS,
    };
    worker.postMessage(request);
  }

  /** Manual Stop: terminate without firing the settle handlers. */
  stop(): void {
    this.terminate();
  }

  private settle(
    outcome: 'result' | 'error' | 'timeout',
    apply: () => void,
    handlers: RunHandlers,
  ): void {
    if (this.settled) return;
    this.settled = true;
    this.terminate();
    apply();
    handlers.onSettled(outcome);
  }

  private terminate(): void {
    if (this.watchdog !== null) {
      window.clearTimeout(this.watchdog);
      this.watchdog = null;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
