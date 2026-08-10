import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { copyText } from '../../core/copy';
import { formatBytes } from '../../core/format';
import {
  analyzeYaml,
  formatYaml,
  jsonToYaml,
  toBlock,
  toFlow,
  yamlToJson,
  type YamlAdvisory,
  type YamlIssue,
} from '../../core/yaml';
import { relicTitle } from '../../core/relicNames';
import { markLeftOpen, takeLeftOpen } from '../../core/draftReturn';
import { putRunestoneSeed } from '../../core/runestoneSeed';
import { putVariantTextSeed } from '../../core/variantSeed';
import { ApiError } from '../../core/api';
import { usePanelFont } from '../../core/panelFont';
import { Button } from '../../core/ui/Button';
import { Card } from '../../core/ui/Card';
import { PanelFontControl, UndoRedoControl } from '../../core/ui/PanelControls';
import { JsonEditor, type JsonEditorHandle } from '../../core/ui/JsonEditor';
import { TreeView } from '../../core/ui/TreeView';
import { Toast } from '../../core/ui/Toast';
import { AlertIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon } from '../../core/ui/icons';
import {
  fetchGroot,
  fetchGrootConfig,
  saveGroot,
  updateGroot,
  type GrootConfig,
} from '../../core/groot';
import { clearDraft, loadDraft, saveDraft, type GrootDraft } from './draft';

const EDITOR_PLACEHOLDER = 'Paste, type, or drop a .yaml file — one trunk, many branches…';

/** Identifies this editor's buffer to `core/draftReturn`. */
const DRAFT_ID = 'groot';

/** Debounce heavy derived work (parse/advise on up-to-2MB docs) off the keystroke path. */
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
  return `${safe || 'groot'}.yaml`;
}

/** "deploy-values-abc123" → "Deploy Values" (drops an id-shaped tail). */
function titleFromSlug(slug: string): string {
  const parts = slug.split('-').filter(Boolean);
  if (parts.length > 1 && /^[a-z0-9]{6}$/.test(parts[parts.length - 1] ?? '')) parts.pop();
  return parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

/** What the rail calls each advisory, so a person can tell them apart at a glance. */
const ADVISORY_LABEL: Record<YamlAdvisory['kind'], string> = {
  boolish: 'reads as a boolean elsewhere',
  'duplicate-key': 'duplicate key',
  'tab-indent': 'tab in indentation',
  'lossy-number': 'number, not text',
  'unsafe-integer': 'loses digits',
  anchor: 'anchor',
  'merge-key': 'merge key',
  'parser-warning': 'parser note',
};

type Phase = 'new' | 'loading' | 'saved' | 'notfound';

export function GrootPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const font = usePanelFont();

  const [phase, setPhase] = useState<Phase>(slug ? 'loading' : 'new');
  const [docId, setDocId] = useState<string | null>(null);
  const [title, setTitle] = useState(() => relicTitle());
  const [text, setText] = useState('');
  const [snapshot, setSnapshot] = useState<{ title: string; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<'code' | 'tree'>(() =>
    window.innerWidth < 768 ? 'tree' : 'code',
  );
  const [docIndex, setDocIndex] = useState(0);
  const [config, setConfig] = useState<GrootConfig | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger'; message: string } | null>(null);
  const [restorable, setRestorable] = useState<GrootDraft | null>(null);
  const [cursor, setCursor] = useState(0);
  const editorRef = useRef<JsonEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchGrootConfig()
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
    fetchGroot(slug)
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
        if (doc.slug !== slug) navigate(`/groot/${doc.slug}`, { replace: true });
      })
      .catch(() => {
        if (!cancelled) {
          setPhase('new');
          setNotice({ kind: 'danger', message: 'Could not load that document.' });
        }
      });
    return () => {
      cancelled = true;
    };
    // navigate identity churns; slug is the real dependency
  }, [slug]);

  const isScratch = phase === 'new' && docId === null;

  // What is on screen right now, for the leave handler below — it has to flush
  // the current buffer on unmount, not the one that existed when it registered.
  const bufferRef = useRef({ title, text, isScratch });
  bufferRef.current = { title, text, isScratch };

  // On arriving at the scratch editor: a buffer left open by a navigation
  // inside this page's lifetime comes straight back, because jumping to
  // Runestone to see the same document as JSON and returning is one task, not
  // two visits. A draft from an *earlier* page load is still only offered —
  // opening the tool fresh must not silently refill it with something old.
  useEffect(() => {
    if (!isScratch) return;
    const draft = loadDraft();
    if (!draft || draft.text.trim() === '') return;
    if (takeLeftOpen(DRAFT_ID)) {
      setTitle((current) => draft.title || current);
      setText(draft.text);
    } else {
      setRestorable(draft);
    }
  }, [isScratch]);

  // Leaving flushes the buffer and records that it was still open. Flushing
  // here rather than trusting the debounce below closes the window where
  // clicking "Runestone" within half a second of typing loses the last
  // keystrokes. Saving clears the draft deliberately and flips `isScratch`
  // before this runs, so the guard keeps a saved document from resurrecting it.
  useEffect(() => {
    return () => {
      const left = bufferRef.current;
      if (!left.isScratch || left.text.trim() === '') return;
      saveDraft({ title: left.title, text: left.text, savedAt: Date.now() });
      markLeftOpen(DRAFT_ID);
    };
  }, []);

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
  // One parse per tick feeds the issue list, the rail, the tree and the stats —
  // a 2 MB document is not worth parsing four times over.
  const analysis = useMemo(() => analyzeYaml(debouncedText), [debouncedText]);
  const issues: YamlIssue[] = analysis.issues;
  const stats = analysis.stats;
  const empty = debouncedText.trim() === '';
  const valid = !empty && issues.length === 0;

  // A multi-document stream keeps a tab per document. The index is clamped on
  // read rather than reset in an effect, so deleting a `---` while looking at
  // the last document shows the one that is left instead of flashing empty.
  const docCount = analysis.documents.length;
  const activeIndex = docCount === 0 ? 0 : Math.min(docIndex, docCount - 1);
  const activeDoc = analysis.documents[activeIndex];

  const maxBytes = config ? config.maxDocKb * 1024 : null;
  const overCap = maxBytes !== null && stats.bytes > maxBytes;

  const dirty =
    snapshot === null ? text.trim() !== '' : snapshot.title !== title || snapshot.text !== text;
  const canSave = valid && !overCap && !saving && (snapshot === null || dirty);
  const canTransform = valid && !overCap;

  const ok = (message: string) => setNotice({ kind: 'ok', message });
  const fail = (message: string) => setNotice({ kind: 'danger', message });

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      if (docId === null) {
        const doc = await saveGroot({ name: title, content: text });
        setDocId(doc.id);
        setTitle(doc.name);
        setSnapshot({ title: doc.name, text: doc.content });
        setPhase('saved');
        clearDraft();
        setRestorable(null);
        navigate(`/groot/${doc.slug}`, { replace: true });
        ok('Grown into the Pensieve');
      } else {
        const doc = await updateGroot(docId, { name: title, content: text });
        setTitle(doc.name);
        setSnapshot({ title: doc.name, text: doc.content });
        if (slug && doc.slug !== slug) navigate(`/groot/${doc.slug}`, { replace: true });
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

  const applyFormat = () => setText((current) => formatYaml(current));
  const applyCompact = () => setText((current) => toFlow(current));
  const applyExpand = () => setText((current) => toBlock(current));

  const copyDocument = async () => {
    if (await copyText(text)) ok('Document copied');
    else fail('Copy was blocked by the browser.');
  };

  const copyAsJson = async () => {
    try {
      if (await copyText(yamlToJson(text))) ok('Copied as JSON');
      else fail('Copy was blocked by the browser.');
    } catch {
      fail('Fix the errors first — converting needs valid YAML.');
    }
  };

  // Hand-off, not an import: Runestone reads the seed once on mount, so no
  // feature imports another (the Loki→Variant bridge, in the other direction).
  const openInRunestone = () => {
    try {
      putRunestoneSeed({ title, text: yamlToJson(text) });
      void navigate('/runestone');
    } catch {
      fail('Fix the errors first — converting needs valid YAML.');
    }
  };

  /** JSON is valid YAML, so this replaces the buffer in place and stays parseable. */
  const convertFromJson = () => {
    try {
      setText(jsonToYaml(text));
      ok('Converted from JSON');
    } catch {
      fail('That is not valid JSON — nothing was changed.');
    }
  };

  const diffAgainstSaved = () => {
    if (!snapshot) return;
    putVariantTextSeed({ left: snapshot.text, right: text });
    void navigate('/variant');
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

  const copyValue = async (value: string) => {
    // The whole value goes to the clipboard; only the toast is trimmed.
    const shown = value.length > 60 ? `${value.slice(0, 60)}…` : value;
    if (await copyText(value)) ok(`Value copied — ${shown}`);
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

  const gotoOffset = (offset: number) => {
    setView('code');
    setPendingJump(offset);
  };

  const gotoNextIssue = (direction: 1 | -1) => {
    if (issues.length === 0) return;
    const after = issues.filter((issue) => issue.offset > cursor);
    const before = issues.filter((issue) => issue.offset < cursor);
    const target =
      direction === 1
        ? (after[0] ?? issues[0])
        : (before[before.length - 1] ?? issues[issues.length - 1]);
    if (target) gotoOffset(target.offset);
  };

  const importText = (name: string, content: string, sizeBytes: number) => {
    if (maxBytes !== null && sizeBytes > maxBytes) {
      fail(`That file is over the ${formatBytes(maxBytes)} limit.`);
      return;
    }
    setText(content);
    const base = name.replace(/\.(ya?ml)$/i, '').trim();
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
    if (!/\.(ya?ml)$/i.test(file.name)) {
      fail('Only .yaml or .yml files can be dropped here.');
      return;
    }
    importText(file.name, await file.text(), file.size);
  };

  const exportDocument = () => {
    const blob = new Blob([text], { type: 'application/yaml' });
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

  const growFromSlug = () => {
    setPhase('new');
    setDocId(null);
    setSnapshot(null);
    setText('');
    setTitle(slug ? titleFromSlug(slug) || relicTitle() : relicTitle());
    navigate('/groot', { replace: true });
  };

  if (phase === 'loading') {
    return <div className="page-loading caption">Reading the rings…</div>;
  }

  if (phase === 'notfound') {
    return (
      <>
        <div className="page-head">
          <div>
            <span className="eyebrow eyebrow--violet">groot · one trunk, many branches</span>
            <h2>Nothing grew here</h2>
            <p>…or this branch was pruned. The Pensieve holds no “{slug}”.</p>
          </div>
        </div>
        <Card>
          <div className="rune-404">
            <p className="rune-404__glyph" aria-hidden="true">
              I&nbsp;AM&nbsp;GROOT
            </p>
            <div className="row">
              <Button onClick={growFromSlug}>Grow it now</Button>
              <Button variant="ghost" onClick={() => void navigate('/pensieve?type=groot')}>
                Back to the Pensieve
              </Button>
            </div>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <div className="page-head rune-head">
        <div>
          <span className="eyebrow eyebrow--violet">groot · one trunk, many branches</span>
          <h2>
            <input
              className="rune-title"
              value={title}
              maxLength={80}
              aria-label="Document title"
              onChange={(event) => setTitle(event.target.value)}
            />
          </h2>
          <p>Write, fold and check YAML. Comments survive every format.</p>
        </div>
        <div className="rune-head-actions">
          <Button onClick={() => void save()} disabled={!canSave}>
            {saving ? 'Growing…' : docId === null ? 'Save to Pensieve' : dirty ? 'Save' : 'Saved'}
          </Button>
          <Button variant="ghost" onClick={() => void navigate('/pensieve?type=groot')}>
            Pensieve
          </Button>
        </div>
      </div>

      <div
        className="stack rune-workspace panel-scope"
        style={{ '--panel-font': `${font.px}px` } as CSSProperties}
      >
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
              <Button
                size="sm"
                variant="ghost"
                disabled={!canTransform}
                title="Flow style — YAML's compact form"
                onClick={applyCompact}
              >
                Compact
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!canTransform}
                title="Block style — one key per line"
                onClick={applyExpand}
              >
                Expand
              </Button>
            </div>
            <div className="rune-toolbar__group groot-convert">
              {/* Said before the click, not after: JSON has nowhere to put a
                  comment or an anchor, so the conversion is lossy by nature. */}
              <span className="caption groot-convert__note">to JSON (drops comments):</span>
              <Button
                size="sm"
                variant="ghost"
                disabled={!canTransform}
                onClick={() => void copyAsJson()}
              >
                Copy
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!canTransform}
                title="Convert and open the result in Runestone"
                onClick={openInRunestone}
              >
                Runestone
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={empty}
                title="Replace the buffer with the YAML form of the JSON in it"
                onClick={convertFromJson}
              >
                From JSON
              </Button>
            </div>
            <div className="rune-toolbar__group">
              <Button
                size="sm"
                variant="ghost"
                disabled={view !== 'code'}
                onClick={() => editorRef.current?.openSearch()}
              >
                Find
              </Button>
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
              <Button
                size="sm"
                variant="ghost"
                disabled={!snapshot || !dirty}
                title={
                  snapshot
                    ? 'Compare the saved document with your edits in Variant'
                    : 'Available once the document has been saved'
                }
                onClick={diffAgainstSaved}
              >
                Diff
              </Button>
              <Button size="sm" variant="ghost" disabled={empty} onClick={clearDocument}>
                Clear
              </Button>
            </div>
            <div className="rune-toolbar__group rune-toolbar__group--end">
              <UndoRedoControl editor={editorRef} disabled={view !== 'code'} />
              <PanelFontControl font={font} />
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
                mode="yaml"
                value={text}
                onChange={setText}
                onCursor={setCursor}
                height="var(--rune-editor-h, 60vh)"
                placeholder={EDITOR_PLACEHOLDER}
              />
            ) : empty ? (
              <p className="rune-tree-empty caption">
                Nothing planted yet — switch to Code and paste some YAML.
              </p>
            ) : valid && activeDoc ? (
              <>
                {docCount > 1 && (
                  <div className="groot-docs" role="tablist" aria-label="Documents in this stream">
                    {analysis.documents.map((doc, index) => (
                      <button
                        key={doc.index}
                        type="button"
                        role="tab"
                        aria-selected={index === activeIndex}
                        className={`groot-docs__tab${index === activeIndex ? ' is-active' : ''}`}
                        onClick={() => setDocIndex(index)}
                      >
                        Doc {index + 1}
                      </button>
                    ))}
                  </div>
                )}
                <TreeView
                  value={activeDoc.value}
                  onCopyPath={(path) => void copyPath(path)}
                  onCopyValue={(value) => void copyValue(value)}
                  // Aliases resolve to their anchor's value, so without this an
                  // aliased branch looks like a hand-written duplicate.
                  annotationAt={(path) => {
                    const anchor = activeDoc.aliasPaths.get(path);
                    return anchor ? `*${anchor}` : undefined;
                  }}
                />
              </>
            ) : (
              <p className="rune-tree-empty caption">
                The tree appears once the YAML parses — {issues.length}{' '}
                {issues.length === 1 ? 'error remains' : 'errors remain'}.
              </p>
            )}
          </div>

          <div className="rune-status" aria-live="polite">
            {empty ? (
              <span className="rune-status__state caption">Empty — paste or import YAML</span>
            ) : valid ? (
              <span className="rune-status__state rune-status__state--ok">
                <CheckIcon size={14} /> Valid YAML
              </span>
            ) : (
              <span className="rune-status__state rune-status__state--bad">
                <AlertIcon size={14} /> {issues.length} {issues.length === 1 ? 'error' : 'errors'}
              </span>
            )}
            {docId !== null && (
              <span className="caption">{dirty ? 'Unsaved changes' : 'Kept in the Pensieve'}</span>
            )}
            <span className="rune-stats caption">
              {formatBytes(stats.bytes)} · {stats.lines} {stats.lines === 1 ? 'line' : 'lines'}
              {stats.documents > 1 && <> · {stats.documents} documents</>}
            </span>
          </div>

          {!empty && issues.length > 0 && (
            <ul className="rune-issues">
              {issues.slice(0, 20).map((issue, index) => {
                const { line, col } = lineColAt(debouncedText, issue.offset);
                return (
                  <li key={`${issue.offset}-${index}`}>
                    <button type="button" onClick={() => gotoOffset(issue.offset)}>
                      <span className="mono">
                        {line}:{col}
                      </span>{' '}
                      {issue.message}
                    </button>
                  </li>
                );
              })}
              {issues.length > 20 && <li className="caption">…and {issues.length - 20} more</li>}
            </ul>
          )}

          {analysis.advisories.length > 0 && (
            <section className="groot-rail" aria-label="Advisories">
              <p className="groot-rail__head caption">
                {analysis.advisories.length}{' '}
                {analysis.advisories.length === 1 ? 'advisory' : 'advisories'} — nothing here blocks
                a save, and nothing is changed for you.
              </p>
              <ul className="groot-rail__list">
                {analysis.advisories.slice(0, 30).map((advisory, index) => (
                  <li key={`${advisory.offset}-${advisory.kind}-${index}`}>
                    <button type="button" onClick={() => gotoOffset(advisory.offset)}>
                      <span className="mono groot-rail__line">line {advisory.line}</span>
                      <span className="groot-rail__kind">{ADVISORY_LABEL[advisory.kind]}</span>
                      <span className="groot-rail__message">{advisory.message}</span>
                    </button>
                  </li>
                ))}
                {analysis.advisories.length > 30 && (
                  <li className="caption">…and {analysis.advisories.length - 30} more</li>
                )}
              </ul>
            </section>
          )}
        </Card>

        {notice && (
          <Toast kind={notice.kind} floating>
            {notice.message}
          </Toast>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".yaml,.yml,application/yaml,text/yaml"
        hidden
        onChange={(event) => void onPickFile(event)}
      />
    </>
  );
}
