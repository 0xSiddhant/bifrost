import { Button } from '../../../core/ui/Button';
import { Textarea } from '../../../core/ui/Field';
import { copyText } from '../../../core/copy';
import { notify } from '../../../core/notify';
import { SwapIcon } from '../../../core/ui/icons';
import { runBase64, type Base64Variant } from '../lib/base64';
import { useToolState } from '../useToolState';

type Mode = 'encode' | 'decode';

/**
 * Base64 (PLAN-18). Encoding goes through TextEncoder rather than `btoa`
 * directly, so pasting anything outside Latin-1 — an accent, an emoji — is a
 * round trip instead of an InvalidCharacterError. See lib/base64.ts.
 */
export function Base64Tool() {
  const [input, setInput] = useToolState('base64.input', '');
  const [mode, setMode] = useToolState<Mode>('base64.mode', 'encode');
  const [variant, setVariant] = useToolState<Base64Variant>('base64.variant', 'standard');

  const { value, error } = runBase64(input, mode, variant);

  const copy = async () => {
    if (!value) return;
    if (await copyText(value)) notify.ok('Copied the result');
    else notify.error('Could not reach the clipboard — select the text and copy it by hand.');
  };

  /** Feed the output back in as the input — the usual second step. */
  const swap = () => {
    if (!value) return;
    setInput(value);
    setMode(mode === 'encode' ? 'decode' : 'encode');
  };

  return (
    <>
      <div className="tool-bar">
        <div className="tool-chiprow" role="group" aria-label="Direction">
          {(['encode', 'decode'] as Mode[]).map((option) => (
            <Button
              key={option}
              variant={option === mode ? 'primary' : 'ghost'}
              size="sm"
              aria-pressed={option === mode}
              onClick={() => setMode(option)}
            >
              {option}
            </Button>
          ))}
        </div>
        {mode === 'encode' && (
          <div className="tool-chiprow" role="group" aria-label="Alphabet">
            {(['standard', 'url-safe'] as Base64Variant[]).map((option) => (
              <Button
                key={option}
                variant={option === variant ? 'primary' : 'ghost'}
                size="sm"
                aria-pressed={option === variant}
                onClick={() => setVariant(option)}
              >
                {option}
              </Button>
            ))}
          </div>
        )}
        <span className="tool-bar__spacer" />
        <Button variant="ghost" size="sm" onClick={swap} disabled={!value}>
          <SwapIcon size={16} /> Use as input
        </Button>
        <Button variant="ghost" size="sm" onClick={copy} disabled={!value}>
          Copy result
        </Button>
      </div>

      <div className="tool-pair">
        <Textarea
          label={mode === 'encode' ? 'Text' : 'Base64'}
          rows={8}
          spellCheck={false}
          className="field__input mono"
          placeholder={mode === 'encode' ? 'Anything at all — héllo 🌉' : 'aGVsbG8='}
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <Textarea
          label={mode === 'encode' ? 'Base64' : 'Text'}
          rows={8}
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
      {!error && mode === 'decode' && input.trim() !== '' && (
        <p className="caption">
          Padding and whitespace are fixed up automatically, and both alphabets are accepted.
        </p>
      )}
    </>
  );
}
