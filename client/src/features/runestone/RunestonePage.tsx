import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
import { ApiError } from '../../core/api';
import { Button } from '../../core/ui/Button';
import { Card } from '../../core/ui/Card';
import { JsonEditor, type JsonEditorHandle } from '../../core/ui/JsonEditor';
import { Toast } from '../../core/ui/Toast';
import { AlertIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon } from '../../core/ui/icons';
import {
  fetchRunestone,
  fetchRunestoneConfig,
  saveRunestone,
  updateRunestone,
  type RunestoneConfig,
} from '../../core/runestone';
import { clearDraft, loadDraft, saveDraft, type RunestoneDraft } from './draft';
import { TreeView } from '../../core/ui/TreeView';

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

/** "gleaming-gungnir-abc123" → "Gleaming Gungnir" (drops an id-shaped tail). */
function titleFromSlug(slug: string): string {
  const parts = slug.split('-').filter(Boolean);
  if (parts.length > 1 && /^[a-z0-9]{6}$/.test(parts[parts.length - 1] ?? '')) parts.pop();
  return parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

type Phase = 'new' | 'loading' | 'saved' | 'notfound';

export function RunestonePage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>(slug ? 'loading' : 'new');
  const [docId, setDocId] = useState<string | null>(null);
  const [title, setTitle] = useState(() => relicTitle());
  const [text, setText] = useState('');
  const [snapshot, setSnapshot] = useState<{ title: string; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
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
        // cap check degrades gracefully; the server still enforces it on save
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load (or fail to find) the document a slug URL names.
  useEffect(() => {
    if (!slug) {
      setPhase('new');
      setDocId(null);
      setSnapshot(null);
      return;
    }
    let cancelled = false;
    setPhase('loading');
    fetchRunestone(slug)
      .then((doc) => {
        if (cancelled) return;
        if (!doc) {
          setPhase('notfound');
          return;
        }
        setDocId(doc.id);
        setTitle(doc.name);
        setText(doc.content);
        setSnapshot({ title: doc.name, text: doc.content });
        setPhase('saved');
        // The API 301s stale slugs; fix the address bar to the canonical one.
        if (doc.slug !== slug) navigate(`/runestone/${doc.slug}`, { replace: true });
      })
      .catch(() => {
        if (!cancelled) {
          setPhase('new');
          setNotice({ kind: 'danger', message: 'Could not load that runestone.' });
        }
      });
    return () => {
      cancelled = true;
    };
    // navigate identity churns; slug is the real dependency
  }, [slug]);

  const isScratch = phase === 'new' && docId === null;

  // Offer to restore a cached draft once, on arriving at the scratch editor.
  useEffect(() => {
    if (!isScratch) return;
    const draft = loadDraft();
    if (draft && draft.text.trim() !== '') setRestorable(draft);
  }, [isScratch]);

  // Auto-cache the scratch buffer (debounced) so a refresh mid-edit loses
  // nothing. Saved documents live on the server instead.
  useEffect(() => {
    if (!isScratch || text.trim() === '') return;
    const id = window.setTimeout(() => saveDraft({ title, text, savedAt: Date.now() }), 500);
    return () => window.clearTimeout(id);
  }, [isScratch, title, text]);

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

  const dirty = snapshot === null ? text.trim() !== '' : snapshot.title !== title || snapshot.text !== text;
  const canSave = valid && !overCap && !saving && (snapshot === null || dirty);

  const ok = (message: string) => setNotice({ kind: 'ok', message });
  const fail = (message: string) => setNotice({ kind: 'danger', message });

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      if (docId === null) {
        const doc = await saveRunestone({ name: title, content: text });
        setDocId(doc.id);
        setTitle(doc.name);
        setSnapshot({ title: doc.name, text: doc.content });
        setPhase('saved');
        clearDraft();
        setRestorable(null);
        navigate(`/runestone/${doc.slug}`, { replace: true });
        ok('Runestone carved');
      } else {
        const doc = await updateRunestone(docId, { name: title, content: text });
        setTitle(doc.name);
        setSnapshot({ title: doc.name, text: doc.content });
        if (slug && doc.slug !== slug) navigate(`/runestone/${doc.slug}`, { replace: true });
        ok('Saved');
      }
    } catch (error) {
      fail(
        error instanceof ApiError && error.status === 413
          ? 'The server refused it — over the size limit.'
          : 'Save failed — is the bridge up?',
      );
    } finally {
      setSaving(false);
    }
  };

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

  const carveFromSlug = () => {
    setPhase('new');
    setDocId(null);
    setSnapshot(null);
    setText('');
    setTitle(slug ? titleFromSlug(slug) || relicTitle() : relicTitle());
    navigate('/runestone', { replace: true });
  };

  const canTransform = valid && !overCap;

  if (phase === 'loading') {
    return <div className="page-loading caption">Reading the stone…</div>;
  }

  if (phase === 'notfound') {
    return (
      <>
        <div className="page-head">
          <div>
            <span className="eyebrow eyebrow--violet">the runes · carved to be read later</span>
            <h2>This runestone was never carved</h2>
            <p>…or it has crumbled to dust. Mímir keeps no memory of “{slug}”.</p>
          </div>
        </div>
        <Card>
          <div className="rune-404">
            <p className="rune-404__glyph" aria-hidden="true">
              ᚱᚢᚾᛖ᛫ᛚᛟᛊᛏ
            </p>
            <div className="row">
              <Button onClick={carveFromSlug}>Carve it now</Button>
              <Button variant="ghost" onClick={() => void navigate('/runestone/mimir')}>
                Back to Mímir
              </Button>
            </div>
          </div>
        </Card>
      </>
    );
  }

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
        <div className="rune-head-actions">
          <Button onClick={() => void save()} disabled={!canSave}>
            {saving ? 'Carving…' : docId === null ? 'Save to Mímir' : dirty ? 'Save' : 'Saved'}
          </Button>
          <Button variant="ghost" onClick={() => void navigate('/runestone/mimir')}>
            Mímir
          </Button>
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
            {docId !== null && (
              <span className="caption">{dirty ? 'Unsaved changes' : 'Kept in Mímir'}</span>
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
