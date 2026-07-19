import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { copyText } from '../../core/copy';
import { formatBytes } from '../../core/format';
import {
  formatJson,
  jsonStats,
  minifyJson,
  pathAt,
  sortKeysDeep,
  unescapeEmbedded,
  validateJson,
  type JsonIssue,
} from '../../core/json';
import { relicTitle } from '../../core/relicNames';
import { Button } from '../../core/ui/Button';
import { Card } from '../../core/ui/Card';
import { JsonEditor, type JsonEditorHandle } from '../../core/ui/JsonEditor';
import { Toast } from '../../core/ui/Toast';
import { AlertIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon } from '../../core/ui/icons';
import { fetchRunestoneConfig, type RunestoneConfig } from './api';
import { clearDraft, loadDraft, saveDraft, type RunestoneDraft } from './draft';
import { TreeView } from './TreeView';

const EDITOR_PLACEHOLDER = 'Paste, type, or drop a .json file to carve it…';

/** Debounce heavy derived work (validate/stats on up-to-2MB docs) off the keystroke path. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

function lineColAt(text: string, offset: number): { line: number; col: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text[i] === '\n') {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, col: offset - lineStart + 1 };
}

/** Title → export filename: strip path separators and other unsafe characters. */
function exportFilename(title: string): string {
  // eslint-disable-next-line no-control-regex
  const safe = title.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '').trim();
  return `${safe || 'runestone'}.json`;
}

export function RunestonePage() {
  const [title, setTitle] = useState(() => relicTitle());
  const [text, setText] = useState('');
  const [view, setView] = useState<'code' | 'tree'>(() =>
    window.innerWidth < 768 ? 'tree' : 'code',
  );
  const [config, setConfig] = useState<RunestoneConfig | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger'; message: string } | null>(null);
  const [restorable, setRestorable] = useState<RunestoneDraft | null>(null);
  const [cursor, setCursor] = useState(0);
  const editorRef = useRef<JsonEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRunestoneConfig()
      .then((cfg) => {
        if (!cancelled) setConfig(cfg);
      })
      .catch(() => {
        // cap check degrades gracefully; the server still enforces it in Part B
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Offer to restore a cached draft once, on arrival with an empty buffer.
  useEffect(() => {
    const draft = loadDraft();
    if (draft && draft.text.trim() !== '') setRestorable(draft);
  }, []);

  // Auto-cache the buffer (debounced) so a refresh mid-edit loses nothing.
  useEffect(() => {
    if (text.trim() === '') return;
    const id = window.setTimeout(() => saveDraft({ title, text, savedAt: Date.now() }), 500);
    return () => window.clearTimeout(id);
  }, [title, text]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 2200);
    return () => window.clearTimeout(id);
  }, [notice]);

  const debouncedText = useDebounced(text, 300);
  const issues: JsonIssue[] = useMemo(
    () => (debouncedText.trim() === '' ? [] : validateJson(debouncedText)),
    [debouncedText],
  );
  const stats = useMemo(() => jsonStats(debouncedText), [debouncedText]);
  const empty = debouncedText.trim() === '';
  const valid = !empty && issues.length === 0;
  const parsed: unknown = useMemo(() => {
    if (view !== 'tree' || !valid) return undefined;
    try {
      return JSON.parse(debouncedText) as unknown;
    } catch {
      return undefined;
    }
  }, [view, valid, debouncedText]);

  const maxBytes = config ? config.maxDocKb * 1024 : null;
  const overCap = maxBytes !== null && stats.bytes > maxBytes;

  const debouncedCursor = useDebounced(cursor, 150);
  const cursorPath = useMemo(() => {
    if (view !== 'code' || empty) return null;
    return pathAt(debouncedText, Math.min(debouncedCursor, debouncedText.length));
  }, [view, empty, debouncedText, debouncedCursor]);

  const ok = (message: string) => setNotice({ kind: 'ok', message });
  const fail = (message: string) => setNotice({ kind: 'danger', message });

  const applyFormat = () => setText((current) => formatJson(current));
  const applyMinify = () => setText((current) => minifyJson(current));

  const applySortKeys = () => {
    try {
      const sorted = sortKeysDeep(JSON.parse(text));
      setText(JSON.stringify(sorted, null, 2));
      ok('Keys sorted A→Z');
    } catch {
      fail('Fix the errors first — sorting needs valid JSON.');
    }
  };

  const applyUnescape = () => {
    const inner = unescapeEmbedded(text.trim());
    if (inner === null) {
      fail('No embedded JSON found in this document.');
    } else {
      setText(formatJson(inner));
      ok('Embedded JSON unescaped');
    }
  };

  const copyDocument = async () => {
    if (await copyText(text)) ok('Document copied');
    else fail('Copy was blocked by the browser.');
  };

  const clearDocument = () => {
    if (!window.confirm('Clear the document? The cached draft is removed too.')) return;
    setText('');
    clearDraft();
    setRestorable(null);
  };

  const copyPath = async (path: string) => {
    if (await copyText(path)) ok(`Path copied — ${path}`);
    else fail('Copy was blocked by the browser.');
  };

  // Jump after the editor exists — switching tree→code mounts it on the next render.
  const [pendingJump, setPendingJump] = useState<number | null>(null);
  useEffect(() => {
    if (view === 'code' && pendingJump !== null) {
      editorRef.current?.gotoOffset(pendingJump);
      setPendingJump(null);
    }
  }, [view, pendingJump]);

  const gotoIssue = (issue: JsonIssue) => {
    setView('code');
    setPendingJump(issue.offset);
  };

  const gotoNextIssue = (direction: 1 | -1) => {
    if (issues.length === 0) return;
    const after = issues.filter((issue) => issue.offset > cursor);
    const before = issues.filter((issue) => issue.offset < cursor);
    const target =
      direction === 1
        ? (after[0] ?? issues[0])
        : (before[before.length - 1] ?? issues[issues.length - 1]);
    if (target) gotoIssue(target);
  };

  const importText = (name: string, content: string, sizeBytes: number) => {
    if (maxBytes !== null && sizeBytes > maxBytes) {
      fail(`That file is over the ${formatBytes(maxBytes)} limit.`);
      return;
    }
    setText(content);
    const base = name.replace(/\.json$/i, '').trim();
    if (base) setTitle(base);
    ok(`Imported ${name}`);
  };

  const onPickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) importText(file.name, await file.text(), file.size);
  };

  const onDrop = async (event: DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    if (!/\.json$/i.test(file.name) && file.type !== 'application/json') {
      fail('Only .json files can be dropped here.');
      return;
    }
    importText(file.name, await file.text(), file.size);
  };

  const exportDocument = () => {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = exportFilename(title);
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const restoreDraft = () => {
    if (!restorable) return;
    setTitle(restorable.title || title);
    setText(restorable.text);
    setRestorable(null);
    setView('code');
  };

  const dismissDraft = () => {
    clearDraft();
    setRestorable(null);
  };

  const canTransform = valid && !overCap;

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow eyebrow--violet">the runes · carved to be read later</span>
          <h2>
            <input
              className="rune-title"
              value={title}
              maxLength={80}
              aria-label="Document title"
              onChange={(event) => setTitle(event.target.value)}
            />
          </h2>
          <p>Validate, explore, and shape JSON. The title names your export.</p>
        </div>
      </div>

      <div className="stack">
        {restorable && (
          <Toast kind="info">
            <span className="rune-restore">
              Restore the draft from your last visit?
              <Button size="sm" onClick={restoreDraft}>
                Restore
              </Button>
              <Button size="sm" variant="ghost" onClick={dismissDraft}>
                Dismiss
              </Button>
            </span>
          </Toast>
        )}

        {overCap && maxBytes !== null && (
          <Toast kind="danger">
            This document is {formatBytes(stats.bytes)} — past the {formatBytes(maxBytes)} limit.
            Editing still works, but it cannot be saved and may feel slow.
          </Toast>
        )}

        <Card>
          <div className="rune-toolbar" role="toolbar" aria-label="Document actions">
            <div className="rune-toolbar__group">
              <Button size="sm" variant="ghost" disabled={!canTransform} onClick={applyFormat}>
                Format
              </Button>
              <Button size="sm" variant="ghost" disabled={!canTransform} onClick={applyMinify}>
                Minify
              </Button>
              <Button size="sm" variant="ghost" disabled={!canTransform} onClick={applySortKeys}>
                Sort keys
              </Button>
              <Button size="sm" variant="ghost" disabled={empty} onClick={applyUnescape}>
                Unescape
              </Button>
            </div>
            <div className="rune-toolbar__group">
              <Button
                size="sm"
                variant="ghost"
                disabled={view !== 'code'}
                onClick={() => editorRef.current?.foldAll()}
              >
                Fold all
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={view !== 'code'}
                onClick={() => editorRef.current?.unfoldAll()}
              >
                Unfold
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={issues.length === 0}
                aria-label="Previous error"
                onClick={() => gotoNextIssue(-1)}
              >
                <ChevronLeftIcon size={14} />
                Error
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={issues.length === 0}
                aria-label="Next error"
                onClick={() => gotoNextIssue(1)}
              >
                Error
                <ChevronRightIcon size={14} />
              </Button>
            </div>
            <div className="rune-toolbar__group">
              <Button size="sm" variant="ghost" onClick={() => fileInputRef.current?.click()}>
                Import
              </Button>
              <Button size="sm" variant="ghost" disabled={empty} onClick={exportDocument}>
                Export
              </Button>
              <Button size="sm" variant="ghost" disabled={empty} onClick={() => void copyDocument()}>
                Copy
              </Button>
              <Button size="sm" variant="ghost" disabled={empty} onClick={clearDocument}>
                Clear
              </Button>
            </div>
            <div className="rune-toolbar__group rune-toolbar__group--end">
              <div className="rune-viewtoggle" role="group" aria-label="View mode">
                <button
                  type="button"
                  className={`rune-viewtoggle__btn${view === 'code' ? ' is-active' : ''}`}
                  onClick={() => setView('code')}
                >
                  Code
                </button>
                <button
                  type="button"
                  className={`rune-viewtoggle__btn${view === 'tree' ? ' is-active' : ''}`}
                  onClick={() => setView('tree')}
                >
                  Tree
                </button>
              </div>
            </div>
          </div>

          <div
            className="rune-body"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => void onDrop(event)}
          >
            {view === 'code' ? (
              <JsonEditor
                ref={editorRef}
                value={text}
                onChange={setText}
                onCursor={setCursor}
                placeholder={EDITOR_PLACEHOLDER}
              />
            ) : empty ? (
              <p className="rune-tree-empty caption">
                Nothing carved yet — switch to Code and paste some JSON.
              </p>
            ) : valid && parsed !== undefined ? (
              <TreeView value={parsed} onCopyPath={(path) => void copyPath(path)} />
            ) : (
              <p className="rune-tree-empty caption">
                The tree appears once the JSON is valid — {issues.length}{' '}
                {issues.length === 1 ? 'error remains' : 'errors remain'}.
              </p>
            )}
          </div>

          <div className="rune-status" aria-live="polite">
            {empty ? (
              <span className="rune-status__state caption">Empty — paste or import JSON</span>
            ) : valid ? (
              <span className="rune-status__state rune-status__state--ok">
                <CheckIcon size={14} /> Valid JSON
              </span>
            ) : (
              <span className="rune-status__state rune-status__state--bad">
                <AlertIcon size={14} /> {issues.length} {issues.length === 1 ? 'error' : 'errors'}
              </span>
            )}
            {cursorPath && (
              <button
                type="button"
                className="rune-status__path mono"
                title="Copy JSON path at cursor"
                onClick={() => void copyPath(cursorPath)}
              >
                {cursorPath}
              </button>
            )}
            <span className="rune-stats caption">
              {formatBytes(stats.bytes)} · {stats.lines} {stats.lines === 1 ? 'line' : 'lines'}
              {stats.nodes > 0 && (
                <>
                  {' '}
                  · {stats.nodes} {stats.nodes === 1 ? 'node' : 'nodes'} · depth {stats.depth}
                </>
              )}
            </span>
          </div>

          {!empty && issues.length > 0 && (
            <ul className="rune-issues">
              {issues.slice(0, 20).map((issue, index) => {
                const { line, col } = lineColAt(debouncedText, issue.offset);
                return (
                  <li key={`${issue.offset}-${index}`}>
                    <button type="button" onClick={() => gotoIssue(issue)}>
                      <span className="mono">
                        {line}:{col}
                      </span>{' '}
                      {issue.message}
                    </button>
                  </li>
                );
              })}
              {issues.length > 20 && (
                <li className="caption">…and {issues.length - 20} more</li>
              )}
            </ul>
          )}
        </Card>

        {notice && <Toast kind={notice.kind}>{notice.message}</Toast>}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => void onPickFile(event)}
      />
    </>
  );
}
