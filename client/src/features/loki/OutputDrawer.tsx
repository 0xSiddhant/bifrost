import type { ConsoleLevel } from './protocol';

export interface OutputEntry {
  key: number;
  level: ConsoleLevel;
  text: string;
  truncated: boolean;
}

export interface OutputState {
  entries: OutputEntry[];
  result: { value: string | null; hasValue: boolean } | null;
  error: { name: string; message: string; stack: string | null } | null;
  running: boolean;
  stopped: boolean;
  dropped: number;
  durationMs: number | null;
}

export const emptyOutput: OutputState = {
  entries: [],
  result: null,
  error: null,
  running: false,
  stopped: false,
  dropped: 0,
  durationMs: null,
};

/** A label only when it carries meaning; a plain finish shows just the duration. */
function status(state: OutputState): { label: string; kind: string } | null {
  if (state.running) return { label: 'Running…', kind: 'run' };
  if (state.stopped) return { label: 'Stopped', kind: 'stop' };
  if (state.error) return { label: 'Error', kind: 'error' };
  return null;
}

/**
 * Calcifer's output drawer (PLAN-12 Part B): level-coloured console entries, a
 * return-value line, thrown errors with an (optional) stack, and truncation
 * markers. Mobile-primary — the page opens it after a run.
 */
export function OutputDrawer({
  state,
  onClear,
  onHide,
}: {
  state: OutputState;
  onClear: () => void;
  onHide: () => void;
}) {
  const badge = status(state);
  return (
    <div className="loki-output" aria-live="polite">
      <div className="loki-output__head">
        {badge && (
          <span className={`loki-output__status loki-output__status--${badge.kind}`}>
            {badge.label}
          </span>
        )}
        {state.durationMs !== null && (
          <span className="caption">{Math.round(state.durationMs)} ms</span>
        )}
        <button type="button" className="loki-output__clear" onClick={onClear}>
          Clear
        </button>
        <button type="button" className="loki-output__hide" onClick={onHide}>
          Hide
        </button>
      </div>

      <div className="loki-output__body mono">
        {state.entries.length === 0 && !state.result && !state.error && !state.running && (
          <p className="caption loki-output__empty">Run the code to see console output here.</p>
        )}

        {state.entries.map((entry) => (
          <div key={entry.key} className={`loki-line loki-line--${entry.level}`}>
            {entry.text}
            {entry.truncated && <span className="loki-line__mark"> …(clipped)</span>}
          </div>
        ))}

        {state.dropped > 0 && (
          <div className="loki-line loki-line--warn">…and {state.dropped} more (console budget reached)</div>
        )}

        {state.result?.hasValue && (
          <div className="loki-line loki-line--result">⇐ {state.result.value}</div>
        )}

        {state.error && (
          <div className="loki-line loki-line--error loki-output__error">
            <strong>
              {state.error.name}: {state.error.message}
            </strong>
            {state.error.stack && (
              <details>
                <summary className="caption">stack</summary>
                <pre>{state.error.stack}</pre>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
