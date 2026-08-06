import { Button } from '../../../core/ui/Button';
import { Input, Textarea } from '../../../core/ui/Field';
import { copyText } from '../../../core/copy';
import { notify } from '../../../core/notify';
import { buildUrl, parseUrl, runUrl, type UrlMode } from '../lib/url';
import { useToolState } from '../useToolState';

const MODES: Array<{ id: UrlMode; label: string; hint: string }> = [
  { id: 'component', label: 'component', hint: 'For a value going inside a query string — escapes & = ? /' },
  { id: 'full', label: 'full URL', hint: "Leaves the URL's own delimiters alone — for an assembled URL" },
  { id: 'html', label: 'HTML entities', hint: 'For text going into a page — escapes & < > " \'' },
];

/**
 * URL encoding + a parser with an editable query table (PLAN-18). Both encode
 * modes are one click apart because picking the wrong one is the mistake this
 * tool exists to make visible.
 */
export function UrlTool() {
  const [input, setInput] = useToolState('url.input', '');
  const [mode, setMode] = useToolState<UrlMode>('url.mode', 'component');
  const [direction, setDirection] = useToolState<'encode' | 'decode'>('url.direction', 'encode');
  const [parseInput, setParseInput] = useToolState('url.parse', '');

  const { value, error } = runUrl(input, mode, direction);
  const parts = parseUrl(parseInput);
  const activeMode = MODES.find((m) => m.id === mode);

  const copy = async (text: string) => {
    if (!text) return;
    if (await copyText(text)) notify.ok('Copied');
    else notify.error('Could not reach the clipboard — select the value and copy it by hand.');
  };

  /** Edit a query param in place and rebuild the URL from the parts. */
  const editParam = (index: number, key: string, paramValue: string) => {
    if (!parts) return;
    const params = parts.params.map((param, i) => (i === index ? { key, value: paramValue } : param));
    setParseInput(buildUrl({ ...parts, params }));
  };

  return (
    <>
      <div className="tool-bar">
        <div className="tool-chiprow" role="group" aria-label="Direction">
          {(['encode', 'decode'] as const).map((option) => (
            <Button
              key={option}
              variant={option === direction ? 'primary' : 'ghost'}
              size="sm"
              aria-pressed={option === direction}
              onClick={() => setDirection(option)}
            >
              {option}
            </Button>
          ))}
        </div>
        <div className="tool-chiprow" role="group" aria-label="Encoding">
          {MODES.map((option) => (
            <Button
              key={option.id}
              variant={option.id === mode ? 'primary' : 'ghost'}
              size="sm"
              aria-pressed={option.id === mode}
              onClick={() => setMode(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <span className="tool-bar__spacer" />
        <Button variant="ghost" size="sm" onClick={() => copy(value)} disabled={!value}>
          Copy result
        </Button>
      </div>
      <p className="caption">{activeMode?.hint}</p>

      <div className="tool-pair">
        <Textarea
          label={direction === 'encode' ? 'Text' : 'Encoded'}
          rows={5}
          spellCheck={false}
          className="field__input mono"
          placeholder="https://a.test/path?x=hello there"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <Textarea
          label={direction === 'encode' ? 'Encoded' : 'Text'}
          rows={5}
          readOnly
          spellCheck={false}
          className="field__input mono"
          value={error ? '' : value}
        />
      </div>
      {error && (
        <p className="tool-error" role="status">
          {error}
        </p>
      )}

      <hr className="tool-rule" />

      <Input
        label="Take a URL apart"
        spellCheck={false}
        className="field__input mono"
        placeholder="https://bifrost.local:4646/go/router?a=1&b=two#frag"
        value={parseInput}
        onChange={(event) => setParseInput(event.target.value)}
      />

      {parts ? (
        <div className="tool-split-rows">
          <dl className="tool-rows">
            {(
              [
                ['Scheme', parts.scheme],
                ['Host', parts.host],
                ['Port', parts.port || '(default)'],
                ['Path', parts.path],
                ['Fragment', parts.hash || '—'],
              ] as Array<[string, string]>
            ).map(([label, text]) => (
              <div className="tool-rows__row" key={label}>
                <dt>{label}</dt>
                <dd className="mono">{text}</dd>
              </div>
            ))}
          </dl>

          <div className="tool-output">
            <span className="field__label">Query parameters</span>
            {parts.params.length === 0 ? (
              <p className="caption">No query string.</p>
            ) : (
              <ul className="tool-param-table">
                {parts.params.map((param, index) => (
                  <li key={`${param.key}-${index}`}>
                    <input
                      className="field__input mono"
                      aria-label={`Parameter ${index + 1} name`}
                      value={param.key}
                      onChange={(event) => editParam(index, event.target.value, param.value)}
                    />
                    <input
                      className="field__input mono"
                      aria-label={`Parameter ${index + 1} value`}
                      value={param.value}
                      onChange={(event) => editParam(index, param.key, event.target.value)}
                    />
                  </li>
                ))}
              </ul>
            )}
            <p className="caption">
              Values are shown decoded; editing one rebuilds the URL above with it re-encoded.
            </p>
          </div>
        </div>
      ) : (
        parseInput.trim() !== '' && (
          <p className="tool-error" role="status">
            That is not a URL the browser can parse — it needs a scheme, like <code>https://</code>.
          </p>
        )
      )}
    </>
  );
}
