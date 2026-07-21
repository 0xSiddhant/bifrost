import { useMemo, useState } from 'react';
import hljs from 'highlight.js/lib/common';
import { ApiError } from '../../core/api';
import { formatBytes, formatTimeAgo } from '../../core/format';
import { deviceName } from '../../core/devices';
import { Button } from '../../core/ui/Button';
import { Card } from '../../core/ui/Card';
import { EmptyState } from '../../core/ui/EmptyState';
import { CheckIcon, ClipboardIcon, CloseIcon } from '../../core/ui/icons';
import { copyText } from '../../core/copy';
import { addClipboard, deleteClipboard, type ClipboardEntry } from './api';
import { linkify, opensInNewTab } from './linkify';
import { useClipboard } from './useClipboard';

function byteSize(text: string): string {
  return formatBytes(new TextEncoder().encode(text).length);
}

function LinkifiedText({ text }: { text: string }) {
  const tokens = useMemo(() => linkify(text), [text]);
  return (
    <>
      {tokens.map((token, index) =>
        token.type === 'link' ? (
          <a
            key={index}
            className="clip-entry__link"
            href={token.href}
            target={opensInNewTab(token.href) ? '_blank' : undefined}
            rel="noopener noreferrer"
          >
            {token.text}
          </a>
        ) : (
          token.text
        ),
      )}
    </>
  );
}

function CodeBlock({ text, lang }: { text: string; lang: string | null }) {
  const html =
    lang && hljs.getLanguage(lang)
      ? hljs.highlight(text, { language: lang }).value
      : hljs.highlightAuto(text).value;
  return (
    <pre className="preview-text clip-entry__code">
      <code dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}

export function HermesPage() {
  const { entries, ready } = useClipboard();
  const [text, setText] = useState('');
  const [isCode, setIsCode] = useState(false);
  const [lang, setLang] = useState('');
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const share = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await addClipboard({
        text,
        kind: isCode ? 'code' : 'text',
        lang: isCode && lang.trim() ? lang.trim() : undefined,
      });
      setText('');
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 413
          ? 'That text is too large to share.'
          : 'Could not share that.',
      );
    } finally {
      setBusy(false);
    }
  };

  const copy = async (entry: ClipboardEntry) => {
    setError(null);
    if (await copyText(entry.text)) {
      setCopiedId(entry.id);
      window.setTimeout(() => setCopiedId((id) => (id === entry.id ? null : id)), 1500);
    } else {
      setError('Copy was blocked — select the text to copy it manually.');
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">hermes · the messenger carries words</span>
          <h2>Hermes</h2>
          <p>Paste once, read everywhere. Text syncs to every connected device.</p>
        </div>
      </div>

      <div className="stack">
        <Card>
          <div className="stack">
            <div className="field">
              <label className="field__label" htmlFor="clip-input">
                Share text
              </label>
              <textarea
                id="clip-input"
                className="field__input clip-composer"
                rows={4}
                placeholder="Type or paste text to share it with every device…"
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={isCode}
                onChange={(event) => setIsCode(event.target.checked)}
              />
              <span>Code snippet</span>
              {isCode && (
                <input
                  className="field__input clip-lang"
                  placeholder="language (e.g. ts, py)"
                  value={lang}
                  maxLength={32}
                  onChange={(event) => setLang(event.target.value)}
                />
              )}
            </label>
            {error && (
              <p className="caption" role="alert" style={{ color: 'var(--danger)' }}>
                {error}
              </p>
            )}
            <div className="row">
              <Button onClick={() => void share()} disabled={busy || text.trim().length === 0}>
                {busy ? 'Sharing…' : 'Share to devices'}
              </Button>
            </div>
          </div>
        </Card>

        {ready && entries.length === 0 ? (
          <EmptyState
            icon={<ClipboardIcon size={28} />}
            title="The board is empty"
            hint="Share a link, snippet, or note and it appears on every device."
          />
        ) : (
          <Card>
            {entries.map((entry) => {
              const who = deviceName(entry.deviceId);
              const copied = copiedId === entry.id;
              return (
                <div className="clip-entry" key={entry.id}>
                  {entry.kind === 'code' ? (
                    <CodeBlock text={entry.text} lang={entry.lang} />
                  ) : (
                    <div className="clip-entry__text">
                      <LinkifiedText text={entry.text} />
                    </div>
                  )}
                  <div className="clip-entry__foot">
                    <div className="clip-entry__meta">
                      <span>
                        {who ? (
                          <>
                            from <strong className="clip-entry__who">{who}</strong>
                          </>
                        ) : (
                          'shared'
                        )}
                      </span>
                      <span>{formatTimeAgo(entry.createdAt)}</span>
                      <span>{byteSize(entry.text)}</span>
                      {entry.kind === 'code' && entry.lang && (
                        <span className="badge">{entry.lang}</span>
                      )}
                    </div>
                    <div className="clip-entry__actions">
                      <Button variant="ghost" size="sm" onClick={() => void copy(entry)}>
                        {copied ? <CheckIcon size={15} /> : <ClipboardIcon size={15} />}
                        {copied ? 'Copied' : 'Copy'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete entry"
                        onClick={() => void deleteClipboard(entry.id).catch(() => {})}
                      >
                        <CloseIcon size={15} />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </Card>
        )}
      </div>
    </>
  );
}
