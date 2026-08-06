import { Button } from '../../../core/ui/Button';
import { Input } from '../../../core/ui/Field';
import { explainCron, nextFireTimes, parseCron } from '../lib/cron';
import { formatZoned, relativeTime } from '../lib/epoch';
import { useToolState } from '../useToolState';

const EXAMPLES = ['*/15 * * * *', '0 9 * * 1-5', '0 0 1 * *', '30 3 * * 0', '0 0 13 * 5'];

/**
 * Cron explanation + the next few fire times (PLAN-18). Times are local,
 * because "when does this actually run for me?" is the question — and the
 * explanation says out loud when the two day fields are OR'd, which is the
 * single most misread thing about cron.
 */
export function CronTool() {
  const [input, setInput] = useToolState('cron.input', '*/15 * * * *');
  const { expression, error } = parseCron(input);
  const now = new Date();
  const upcoming = expression ? nextFireTimes(expression, now, 5) : [];

  return (
    <>
      <div className="tool-controls">
        <Input
          label="Expression"
          spellCheck={false}
          className="field__input mono"
          placeholder="*/15 * * * *"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <p className="caption mono">minute hour day-of-month month day-of-week</p>

        <div className="field">
          <span className="field__label">Try one</span>
          <div className="tool-chiprow">
            {EXAMPLES.map((example) => (
              <Button
                key={example}
                variant={example === input ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => setInput(example)}
              >
                <span className="mono">{example}</span>
              </Button>
            ))}
          </div>
        </div>

        {error && (
          <p className="tool-error" role="status">
            {error}
          </p>
        )}
        {expression && <p className="tool-explain">{explainCron(expression)}</p>}
      </div>

      <div className="tool-output">
        <span className="field__label">Next five runs (your timezone)</span>
        {upcoming.length === 0 ? (
          <p className="caption">
            {expression
              ? 'This expression never fires — like 30 February, it names a date that does not exist.'
              : 'Enter five fields to see when they land.'}
          </p>
        ) : (
          <ul className="tool-list">
            {upcoming.map((date) => (
              <li key={date.getTime()}>
                <span className="mono">{formatZoned(date.getTime())}</span>{' '}
                <span className="caption">{relativeTime(date.getTime(), now.getTime())}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
