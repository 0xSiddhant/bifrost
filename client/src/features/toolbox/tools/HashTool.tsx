import { useEffect, useState } from 'react';
import { Textarea } from '../../../core/ui/Field';
import { Button } from '../../../core/ui/Button';
import { copyText } from '../../../core/copy';
import { notify } from '../../../core/notify';
import { useToolState } from '../useToolState';

/**
 * SHA-256 (PLAN-18). The card is hidden entirely on any device where
 * `crypto.subtle` is missing — see `supported()` in the registry — so this
 * component may assume it exists. That gate is why there is no "your browser
 * cannot do this" state here: the tool is simply absent instead.
 */
export function HashTool() {
  const [input, setInput] = useToolState('hash.input', '');
  const [digest, setDigest] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!input) {
      setDigest('');
      setFailed(false);
      return;
    }
    let cancelled = false;
    crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(input))
      .then((buffer) => {
        if (cancelled) return;
        setDigest(
          Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join(''),
        );
        setFailed(false);
      })
      .catch(() => {
        // Not silent by design: the registry gate means reaching here at all is
        // a surprise worth telling the user about rather than showing a stale
        // digest for text they have since changed.
        if (!cancelled) {
          setDigest('');
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [input]);

  const copy = async () => {
    if (!digest) return;
    if (await copyText(digest)) notify.ok('Copied the digest');
    else notify.error('Could not reach the clipboard — select it and copy by hand.');
  };

  return (
    <>
      <div className="tool-controls">
        <Textarea
          label="Text"
          rows={6}
          spellCheck={false}
          className="field__input mono"
          placeholder="Anything — the bytes are hashed in this browser."
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <p className="caption">
          SHA-256 of the UTF-8 bytes, via the browser&rsquo;s Web Crypto. This card only appears on
          a secure context — over plain LAN http the API does not exist, so it is hidden rather
          than broken.
        </p>
      </div>

      <div className="tool-output">
        <span className="field__label">Digest (hex)</span>
        {failed ? (
          <p className="tool-error" role="status">
            Web Crypto refused to hash that.
          </p>
        ) : (
          <output className="tool-secret tool-secret--wrap mono">
            {digest || 'Type something on the left.'}
          </output>
        )}
        <div className="tool-chiprow">
          <Button variant="ghost" size="sm" onClick={copy} disabled={!digest}>
            Copy digest
          </Button>
        </div>
      </div>
    </>
  );
}
