import { useEffect, useState } from 'react';
import { Button } from '../../../core/ui/Button';
import { Input } from '../../../core/ui/Field';
import { copyText } from '../../../core/copy';
import { notify } from '../../../core/notify';
import { generateUuids, timestampFromV7, type UuidVersion } from '../lib/uuid';
import { relativeTime } from '../lib/epoch';
import { useToolState } from '../useToolState';

/**
 * UUID v4 / v7 (PLAN-18). Bytes come from `crypto.getRandomValues`, never
 * `crypto.randomUUID` — the latter is secure-context-only and therefore absent
 * on every device that reaches Bifrost over plain LAN http. See lib/uuid.ts.
 */
export function UuidTool() {
  const [version, setVersion] = useToolState<UuidVersion>('uuid.version', 'v4');
  const [count, setCount] = useToolState('uuid.count', 1);
  const [uppercase, setUppercase] = useToolState('uuid.uppercase', false);
  const [ids, setIds] = useState<string[]>([]);

  // Something to look at the moment the panel opens; regenerating on every
  // option change is what the tool is for.
  useEffect(() => {
    setIds(generateUuids(version, count, uppercase));
  }, [version, count, uppercase]);

  const copyAll = async () => {
    if (ids.length === 0) return;
    if (await copyText(ids.join('\n'))) {
      notify.ok(`Copied ${ids.length} UUID${ids.length === 1 ? '' : 's'}`);
    } else {
      notify.error('Could not reach the clipboard — select the list and copy it by hand.');
    }
  };

  const stamp = version === 'v7' && ids[0] ? timestampFromV7(ids[0]) : null;

  return (
    <>
      <div className="tool-controls">
        <div className="field">
          <span className="field__label">Version</span>
          <div className="tool-chiprow" role="group" aria-label="UUID version">
            {(['v4', 'v7'] as UuidVersion[]).map((option) => (
              <Button
                key={option}
                variant={option === version ? 'primary' : 'ghost'}
                size="sm"
                aria-pressed={option === version}
                onClick={() => setVersion(option)}
              >
                {option}
              </Button>
            ))}
          </div>
          <p className="caption">
            {version === 'v4'
              ? '122 random bits. No ordering, no information about when it was made.'
              : 'A millisecond timestamp then randomness, so a list of them sorts by creation time.'}
          </p>
        </div>

        <Input
          label="How many"
          type="number"
          min={1}
          max={100}
          value={count}
          onChange={(event) => setCount(Number(event.target.value))}
        />

        <label className="check-row">
          <input
            type="checkbox"
            checked={uppercase}
            onChange={(event) => setUppercase(event.target.checked)}
          />
          <span>Uppercase</span>
        </label>

        <div className="tool-chiprow">
          <Button size="sm" onClick={() => setIds(generateUuids(version, count, uppercase))}>
            Generate again
          </Button>
          <Button variant="ghost" size="sm" onClick={copyAll} disabled={ids.length === 0}>
            Copy all
          </Button>
        </div>
      </div>

      <div className="tool-output">
        <ul className="tool-list mono" aria-label="Generated UUIDs">
          {ids.map((id, index) => (
            <li key={`${id}-${index}`}>{id}</li>
          ))}
        </ul>
        {stamp !== null && (
          <p className="caption">
            The first one encodes {new Date(stamp).toISOString()} ({relativeTime(stamp)}).
          </p>
        )}
      </div>
    </>
  );
}
