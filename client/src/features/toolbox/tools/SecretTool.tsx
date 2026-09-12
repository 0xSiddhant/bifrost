import { useEffect, useState } from 'react';
import { Button } from '../../../core/ui/Button';
import { Input } from '../../../core/ui/Field';
import { copyText } from '../../../core/copy';
import { notify } from '../../../core/notify';
import { estimateStrength, generatePassword, type CharsetOptions } from '../lib/secret';
import { useToolState } from '../useToolState';

const TOGGLES: Array<[keyof CharsetOptions, string]> = [
  ['lower', 'a–z'],
  ['upper', 'A–Z'],
  ['digits', '0–9'],
  ['symbols', '!@#$…'],
  ['avoidAmbiguous', 'Avoid look-alikes (0/O, 1/l)'],
];

/**
 * Password generation (PLAN-18). `getRandomValues` with rejection sampling, so
 * it works on every LAN device and the entropy figure below is honest.
 */
export function SecretTool() {
  const [length, setLength] = useToolState('secret.length', 20);
  const [options, setOptions] = useToolState<CharsetOptions>('secret.options', {
    lower: true,
    upper: true,
    digits: true,
    symbols: true,
    avoidAmbiguous: false,
  });
  const [password, setPassword] = useState('');

  useEffect(() => {
    setPassword(generatePassword(length, options));
  }, [length, options]);

  const strength = estimateStrength(length, options);
  const nothingSelected = strength.alphabetSize === 0;

  const copy = async () => {
    if (!password) return;
    if (await copyText(password)) notify.ok('Copied the password');
    else notify.error('Could not reach the clipboard — select it and copy by hand.');
  };

  return (
    <>
      <div className="tool-controls">
        <Input
          label="Length"
          type="number"
          min={4}
          max={256}
          value={length}
          onChange={(event) => setLength(Number(event.target.value))}
        />
        <div className="field">
          <span className="field__label">Characters</span>
          <div className="tool-checks">
            {TOGGLES.map(([key, label]) => (
              <label className="check-row" key={key}>
                <input
                  type="checkbox"
                  checked={options[key]}
                  onChange={(event) => setOptions({ ...options, [key]: event.target.checked })}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="tool-chiprow">
          <Button size="sm" onClick={() => setPassword(generatePassword(length, options))}>
            Generate again
          </Button>
          <Button variant="ghost" size="sm" onClick={copy} disabled={!password}>
            Copy
          </Button>
        </div>
      </div>

      <div className="tool-output">
        {nothingSelected ? (
          <p className="tool-error" role="status">
            Pick at least one character set.
          </p>
        ) : (
          <>
            <output className="tool-secret mono">{password}</output>
            <div className={`tool-meter tool-meter--${strength.label.replace(' ', '-')}`}>
              <span
                className="tool-meter__fill"
                style={{ width: `${Math.min(100, (strength.bits / 128) * 100)}%` }}
              />
            </div>
            <p className="caption">
              About <strong>{strength.bits} bits</strong> of entropy — {strength.label}. Drawn
              uniformly from {strength.alphabetSize} characters, in this browser, never sent
              anywhere.
            </p>
          </>
        )}
      </div>
    </>
  );
}
