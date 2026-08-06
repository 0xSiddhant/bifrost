import { useEffect, useState } from 'react';
import { Button } from '../../../core/ui/Button';
import { Input } from '../../../core/ui/Field';
import { copyText } from '../../../core/copy';
import { notify } from '../../../core/notify';
import {
  epochView,
  parseEpoch,
  parseHumanDate,
  toDatetimeLocalValue,
  type EpochUnit,
} from '../lib/epoch';
import { useToolState } from '../useToolState';

type Unit = EpochUnit | 'auto';

/**
 * Epoch ⇄ human time (PLAN-18). Both directions: a Unix timestamp in, or a
 * date picked/typed in local time. The unit is guessed by magnitude and the
 * guess is shown, because silently reading 1754478420 as milliseconds (1970)
 * instead of seconds (2026) is the classic way this conversion goes wrong.
 */
export function EpochTool() {
  const [raw, setRaw] = useToolState('epoch.raw', String(Math.floor(Date.now() / 1000)));
  const [unit, setUnit] = useToolState<Unit>('epoch.unit', 'auto');
  const [now, setNow] = useState(() => Date.now());

  // The live "now" row is the reason many people open this tool at all.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const parsed = parseEpoch(raw, unit === 'auto' ? undefined : unit);
  const view = parsed ? epochView(parsed.ms, now) : null;

  const copy = async (text: string) => {
    if (await copyText(text)) notify.ok('Copied');
    else notify.error('Could not reach the clipboard — select the value and copy it by hand.');
  };

  const rows: Array<[string, string]> = view
    ? [
        ['Seconds', String(view.seconds)],
        ['Milliseconds', String(view.milliseconds)],
        ['ISO-8601 (UTC)', view.iso],
        ['UTC', view.utc],
        ['Local', view.local],
        ['Relative', view.relative],
      ]
    : [];

  return (
    <>
      <div className="tool-controls">
        <Input
          label="Unix timestamp"
          inputMode="numeric"
          spellCheck={false}
          className="field__input mono"
          placeholder="1754478420"
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
        />
        <div className="field">
          <span className="field__label">Read as</span>
          <div className="tool-chiprow" role="group" aria-label="Timestamp unit">
            {(['auto', 's', 'ms'] as Unit[]).map((option) => (
              <Button
                key={option}
                variant={option === unit ? 'primary' : 'ghost'}
                size="sm"
                aria-pressed={option === unit}
                onClick={() => setUnit(option)}
              >
                {option}
              </Button>
            ))}
          </div>
          <p className="caption">
            {parsed
              ? `Read as ${parsed.unit === 's' ? 'seconds' : 'milliseconds'}.`
              : 'Waiting for a whole number.'}
          </p>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="epoch-date">
            …or pick a local date and time
          </label>
          <input
            id="epoch-date"
            className="field__input"
            type="datetime-local"
            value={parsed ? toDatetimeLocalValue(parsed.ms) : ''}
            onChange={(event) => {
              const ms = parseHumanDate(event.target.value);
              if (ms === null) return;
              setUnit('ms');
              setRaw(String(ms));
            }}
          />
        </div>

        <div className="tool-chiprow">
          <Button
            size="sm"
            onClick={() => {
              setUnit('ms');
              setRaw(String(Date.now()));
            }}
          >
            Now
          </Button>
        </div>
      </div>

      <div className="tool-output">
        {view ? (
          <dl className="tool-rows">
            {rows.map(([label, value]) => (
              <div className="tool-rows__row" key={label}>
                <dt>{label}</dt>
                <dd className="mono">{value}</dd>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => copy(value)}
                  aria-label={`Copy ${label}`}
                >
                  Copy
                </button>
              </div>
            ))}
          </dl>
        ) : (
          <p className="caption">
            Type a Unix timestamp on the left — seconds or milliseconds, negative for anything
            before 1970.
          </p>
        )}
        <p className="caption tool-now">
          Right now: <span className="mono">{Math.floor(now / 1000)}</span> ·{' '}
          <span className="mono">{now}</span>
        </p>
      </div>
    </>
  );
}
