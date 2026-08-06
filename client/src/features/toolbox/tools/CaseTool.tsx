import { Input } from '../../../core/ui/Field';
import { copyText } from '../../../core/copy';
import { notify } from '../../../core/notify';
import { convertCase } from '../lib/textCase';
import { useToolState } from '../useToolState';

const LABELS: Array<[keyof ReturnType<typeof convertCase>, string]> = [
  ['camel', 'camelCase'],
  ['pascal', 'PascalCase'],
  ['snake', 'snake_case'],
  ['kebab', 'kebab-case'],
  ['constant', 'CONSTANT_CASE'],
  ['title', 'Title Case'],
  ['sentence', 'Sentence case'],
  ['slug', 'slug'],
  ['lower', 'lower'],
  ['upper', 'UPPER'],
];

/**
 * Identifier case conversion (PLAN-18). Every form at once rather than a picker:
 * the question is almost always "what is this called in the other convention?",
 * and showing all ten answers it without a second click.
 */
export function CaseTool() {
  const [input, setInput] = useToolState('case.input', '');
  const forms = convertCase(input);

  const copy = async (value: string) => {
    if (!value) return;
    if (await copyText(value)) notify.ok('Copied');
    else notify.error('Could not reach the clipboard — select the value and copy it by hand.');
  };

  return (
    <>
      <Input
        label="Text"
        spellCheck={false}
        placeholder="httpResponseCode, http_response_code, HTTP Response Code…"
        value={input}
        onChange={(event) => setInput(event.target.value)}
      />

      {input.trim() === '' ? (
        <p className="caption">
          Type in any convention — the word split is shared, so every form agrees on where the words
          are. <code>HTTPResponse</code> stays <code>HTTP</code> + <code>Response</code>.
        </p>
      ) : (
        <dl className="tool-rows">
          {LABELS.map(([key, label]) => (
            <div className="tool-rows__row" key={key}>
              <dt>{label}</dt>
              <dd className="mono">{forms[key] || '—'}</dd>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => copy(forms[key])}
                aria-label={`Copy ${label}`}
              >
                Copy
              </button>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}
