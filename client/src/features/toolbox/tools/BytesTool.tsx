import { Button } from '../../../core/ui/Button';
import { Input, Textarea } from '../../../core/ui/Field';
import { copyText } from '../../../core/copy';
import { notify } from '../../../core/notify';
import {
  bytesToText,
  convertBase,
  textStats,
  textToBytes,
  type ByteFormat,
  type NumberBase,
} from '../lib/bytes';
import { useToolState } from '../useToolState';

const FORMATS: ByteFormat[] = ['hex', 'binary', 'decimal'];
const BASES: Array<{ base: NumberBase; label: string }> = [
  { base: 10, label: 'decimal' },
  { base: 16, label: 'hex' },
  { base: 8, label: 'octal' },
  { base: 2, label: 'binary' },
];

/** Text ⇄ bytes, number bases, and a live count of what was typed (PLAN-18). */
export function BytesTool() {
  const [text, setText] = useToolState('bytes.text', '');
  const [format, setFormat] = useToolState<ByteFormat>('bytes.format', 'hex');
  const [direction, setDirection] = useToolState<'to-bytes' | 'to-text'>(
    'bytes.direction',
    'to-bytes',
  );
  const [number, setNumber] = useToolState('bytes.number', '');
  const [base, setBase] = useToolState<NumberBase>('bytes.base', 10);

  const toBytes = direction === 'to-bytes';
  const decoded = toBytes ? null : bytesToText(text, format);
  const output = toBytes ? textToBytes(text, format) : (decoded?.value ?? '');
  const stats = textStats(toBytes ? text : (decoded?.value ?? ''));
  const converted = convertBase(number, base);

  const copy = async (value: string) => {
    if (!value) return;
    if (await copyText(value)) notify.ok('Copied');
    else notify.error('Could not reach the clipboard — select the value and copy it by hand.');
  };

  return (
    <>
      <div className="tool-bar">
        <div className="tool-chiprow" role="group" aria-label="Direction">
          <Button
            variant={toBytes ? 'primary' : 'ghost'}
            size="sm"
            aria-pressed={toBytes}
            onClick={() => setDirection('to-bytes')}
          >
            text → bytes
          </Button>
          <Button
            variant={!toBytes ? 'primary' : 'ghost'}
            size="sm"
            aria-pressed={!toBytes}
            onClick={() => setDirection('to-text')}
          >
            bytes → text
          </Button>
        </div>
        <div className="tool-chiprow" role="group" aria-label="Notation">
          {FORMATS.map((option) => (
            <Button
              key={option}
              variant={option === format ? 'primary' : 'ghost'}
              size="sm"
              aria-pressed={option === format}
              onClick={() => setFormat(option)}
            >
              {option}
            </Button>
          ))}
        </div>
        <span className="tool-bar__spacer" />
        <Button variant="ghost" size="sm" onClick={() => copy(output)} disabled={!output}>
          Copy result
        </Button>
      </div>

      <div className="tool-pair">
        <Textarea
          label={toBytes ? 'Text' : `${format} bytes`}
          rows={5}
          spellCheck={false}
          className="field__input mono"
          placeholder={toBytes ? 'héllo 🌉' : '48 69'}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <Textarea
          label={toBytes ? `${format} bytes` : 'Text'}
          rows={5}
          readOnly
          spellCheck={false}
          className="field__input mono"
          value={decoded?.error ? '' : output}
        />
      </div>
      {decoded?.error && (
        <p className="tool-error" role="status">
          {decoded.error}
        </p>
      )}

      <ul className="tool-stats" aria-label="Text statistics">
        <li>
          <strong>{stats.bytes}</strong> bytes
        </li>
        <li>
          <strong>{stats.graphemes}</strong> characters
        </li>
        <li>
          <strong>{stats.characters}</strong> UTF-16 units
        </li>
        <li>
          <strong>{stats.words}</strong> words
        </li>
        <li>
          <strong>{stats.lines}</strong> lines
        </li>
      </ul>

      <hr className="tool-rule" />

      <div className="tool-bar">
        <div className="tool-chiprow" role="group" aria-label="Input base">
          {BASES.map((option) => (
            <Button
              key={option.base}
              variant={option.base === base ? 'primary' : 'ghost'}
              size="sm"
              aria-pressed={option.base === base}
              onClick={() => setBase(option.base)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>
      <Input
        label="Convert a number"
        spellCheck={false}
        className="field__input mono"
        placeholder="255"
        value={number}
        onChange={(event) => setNumber(event.target.value)}
      />
      {converted ? (
        <dl className="tool-rows">
          {(
            [
              ['Decimal', converted.decimal],
              ['Hex', converted.hex],
              ['Octal', converted.octal],
              ['Binary', converted.binary],
            ] as Array<[string, string]>
          ).map(([label, value]) => (
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
        number.trim() !== '' && (
          <p className="tool-error" role="status">
            Those are not valid {BASES.find((b) => b.base === base)?.label} digits.
          </p>
        )
      )}
      <p className="caption">
        Conversion runs on arbitrary-precision integers, so a 64-bit id keeps every digit.
      </p>
    </>
  );
}
