/**
 * The message contract between the Loki page (main thread) and the Calcifer
 * runner worker (PLAN-12 Part B). Nothing structured-clone-hostile crosses the
 * channel: every value is pre-serialized to a display string in the worker.
 */

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'table';

export interface RunRequest {
  type: 'run';
  runId: string;
  code: string;
  /** May the run call fetch()? (Heimdall-gated.) */
  fetchAllowed: boolean;
  /** Max console entries before the worker drops the rest. */
  consoleMaxEntries: number;
  /** Per-entry character cap before truncation. */
  maxEntryChars: number;
}

export interface LogMessage {
  type: 'log';
  runId: string;
  level: ConsoleLevel;
  text: string;
  /** This entry was clipped to maxEntryChars. */
  truncated: boolean;
}

export interface TruncatedMessage {
  type: 'truncated';
  runId: string;
  /** Console entries dropped past the budget. */
  dropped: number;
}

export interface ResultMessage {
  type: 'result';
  runId: string;
  /** Serialized return value, or null when the run produced no value. */
  value: string | null;
  hasValue: boolean;
}

export interface ErrorMessage {
  type: 'error';
  runId: string;
  name: string;
  message: string;
  stack: string | null;
}

export type WorkerMessage = LogMessage | TruncatedMessage | ResultMessage | ErrorMessage;
