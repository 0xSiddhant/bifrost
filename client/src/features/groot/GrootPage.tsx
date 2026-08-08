import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { copyText } from '../../core/copy';
import { formatBytes } from '../../core/format';
import { relicTitle } from '../../core/relicNames';
import { ApiError } from '../../core/api';
import { usePanelFont } from '../../core/panelFont';
import { putVariantTextSeed } from '../../core/variantSeed';
import { Button } from '../../core/ui/Button';
import { Card } from '../../core/ui/Card';
import { PanelFontControl, UndoRedoControl } from '../../core/ui/PanelControls';
import { JsonEditor, type JsonEditorHandle } from '../../core/ui/JsonEditor';
import { TreeView } from '../../core/ui/TreeView';
import { Toast } from '../../core/ui/Toast';
import { AlertIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon } from '../../core/ui/icons';
import {
  advisories,
  documentValues,
  formatYaml,
  toBlock,
  toFlow,
  validateYaml,
  yamlToJson,
  type YamlAdvisory,
  type YamlIssue,
} from '../../core/yaml';
import {
  fetchGroot,
  fetchGrootConfig,
  saveGroot,
  updateGroot,
  type GrootConfig,
} from '../../core/groot';
import { clearDraft, loadDraft, saveDraft, type GrootDraft } from './draft';

const EDITOR_PLACEHOLDER = 'Paste, type, or drop a .yaml file to grow it…';

/** Debounce the heavy derived work (validate/advise/parse) off the keystroke path. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

function titleFromSlug(slug: string): string {
  const withoutId = slug.replace(/-[a-z0-9]{6}$/, '');
  return withoutId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

type Phase = 'new' | 'loading' | 'ready' | 'notfound';
type View = 'code' | 'tree';

/** Advisory rail grouping — one row per kind, so ten Norway hits read as one line. */
interface AdvisoryGroup {
  kind: YamlAdvisory['kind'];
  message: string;
  count: number;
  first: YamlAdvisory;
}

function groupAdvisories(found: YamlAdvisory[]): AdvisoryGroup[] {
  const groups = new Map<string, AdvisoryGroup>();
  for (const advisory of found) {
    const existing = groups.get(advisory.kind);
    if (existing) {
      existing.count += 1;
      continue;
    }
    groups.set(advisory.kind, {
      kind: advisory.kind,
      message: advisory.message,
      count: 1,
      first: advisory,
    });
  }
  return [...groups.values()];
}

/**
 * Groot — the YAML workspace (PLAN-19). Editor, tree, advisory rail, and the
 * conversions, over the shared editor and `core/yaml`.
 */
export function GrootPage() {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const editorRef = useRef<JsonEditorHandle>(null);
  const font = usePanelFont();

  const [phase, setPhase] = useState<Phase>(slug ? 'loading' : 'new');
  const [docId, setDocId] = useState<string | null>(null);
  const [title, setTitle] = useState(() => relicTitle());
  const [text, setText] = useState('');
  const [snapshot, setSnapshot] = useState<{ title: string; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<GrootConfig | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger'; message: string } | null>(null);
  const [restorable, setRestorable] = useState<GrootDraft | null>(null);
  const [view, setView] = useState<View>('code');
  const [activeDoc, setActiveDoc] = useState(0);

  const debouncedText = useDebounced(text, 250);

  const issues: YamlIssue[] = useMemo(() => validateYaml(debouncedText), [debouncedText]);
  const found = useMemo(() => advisories(debouncedText), [debouncedText]);
  const groups = useMemo(() => groupAdvisories(found), [found]);
  const docs = useMemo(
    () => (view === 'tree' ? documentValues(debouncedText) : []),
    [debouncedText, view],
  );

  const empty = text.trim() === '';
  const valid = issues.length === 0;
  const bytes = useMemo(() => new TextEncoder().encode(text).length, [text]);
  const maxBytes = config ? config.maxDocKb * 1024 : null;
  const overCap = maxBytes !== null && bytes > maxBytes;
  const dirty = snapshot === null ? !empty : snapshot.text !== text || snapshot.title !== title;
  const canSave = valid && !overCap && !saving && dirty;
  const canTransform = valid && !empty;

  useEffect(() => {
    let cancelled = false;
    fetchGrootConfig()
      .then((next) => {
        if (!cancelled) setConfig(next);
      })
      .catch(() => {
        // Cap unknown until this lands; the server still enforces it with a 413,
        // so the only cost is that the pre-flight warning stays quiet.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load (or fail to find) the document a slug URL names.
  useEffect(() => {
    if (!slug) {
      setPhase('new');
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
        setPhase('ready');
        // The API follows a 301 transparently; fix the address bar after it.
        if (doc.slug !== slug) navigate(`/groot/${doc.slug}`, { replace: true });
      })
      .catch(() => {
        if (!cancelled) setPhase('notfound');
      });
    return () => {
      cancelled = true;
    };
  }, [slug, navigate]);

  // Offer the scratch draft back, but only for a genuinely new document — a
  // slug URL has a server copy, which always wins.
  useEffect(() => {
    if (slug) return;
    const draft = loadDraft();
    if (draft && draft.text.trim() !== '') setRestorable(draft);
  }, [slug]);

  // Persist the scratch draft while editing an unsaved document.
  useEffect(() => {
    if (docId !== null || empty) return;
    const id = window.setTimeout(() => saveDraft({ title, text, savedAt: Date.now() }), 500);
    return () => window.clearTimeout(id);
  }, [docId, empty, title, text]);

  const applyToEditor = (next: string) => {
    setText(next);
    editorRef.current?.applyEdit(() => ({ doc: next, from: next.length, to: next.length }));
  };

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const doc =
        docId === null
          ? await saveGroot({ name: title, content: text })
          : await updateGroot(docId, { name: title, content: text });
      setDocId(doc.id);
      setSnapshot({ title: doc.name, text: doc.content });
      clearDraft();
      setRestorable(null);
      setNotice({ kind: 'ok', message: 'Kept in the Pensieve.' });
      if (doc.slug !== slug) navigate(`/groot/${doc.slug}`, { replace: true });
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 413
          ? `Too large to save${maxBytes ? ` — the limit is ${formatBytes(maxBytes)}` : ''}.`
          : 'Could not save — is the bridge up?';
      setNotice({ kind: 'danger', message });
    } finally {
      setSaving(false);
    }
  };

  const gotoIssue = (direction: 1 | -1) => {
    if (issues.length === 0) return;
    const target = direction === 1 ? issues[0] : issues[issues.length - 1];
    if (target) editorRef.current?.gotoOffset(target.offset);
  };

  const convertToJson = async () => {
    const result = yamlToJson(text);
    if (!result.ok) {
      setNotice({ kind: 'danger', message: result.reason });
      return;
    }
    const copied = await copyText(result.text);
    setNotice({
      kind: copied ? 'ok' : 'danger',
      message: copied
        ? 'Copied as JSON — comments are not carried across.'
        : 'Could not reach the clipboard.',
    });
  };

  /**
   * Hand the document to Variant through the existing sessionStorage bridge
   * rather than importing anything — features may never import features, and
   * Loki established this hop for exactly this purpose.
   *
   * The **YAML** goes across, not its JSON form: Variant's text mode diffs it
   * line by line, which keeps comments, key order and quoting visible. Those
   * are usually the whole point of comparing two manifests, and converting
   * first would throw all three away before the diff ran.
   */
  const diffInVariant = () => {
    putVariantTextSeed({ left: text, right: '' });
    void navigate('/variant');
  };

  const restoreDraft = () => {
    if (!restorable) return;
    setTitle(restorable.title);
    applyToEditor(restorable.text);
    setRestorable(null);
  };

  const growFromSlug = () => {
    setPhase('new');
    setDocId(null);
    setSnapshot(null);
    setText('');
    setTitle(slug ? titleFromSlug(slug) || relicTitle() : relicTitle());
    void navigate('/groot', { replace: true });
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
            <p>The Pensieve keeps no memory of “{slug}”.</p>
          </div>
        </div>
        <Card>
          <div className="rune-404">
            <p className="rune-404__glyph" aria-hidden="true">
              I·AM·GROOT
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
          <p>Fold, format, and check YAML — comments survive every transform here.</p>
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
              <Button size="sm" variant="ghost" onClick={() => setRestorable(null)}>
                Dismiss
              </Button>
            </span>
          </Toast>
        )}

        {overCap && maxBytes !== null && (
          <Toast kind="danger">
            This document is {formatBytes(bytes)} — past the {formatBytes(maxBytes)} limit. Editing
            still works, but it cannot be saved.
          </Toast>
        )}

        {notice && <Toast kind={notice.kind === 'ok' ? 'ok' : 'danger'}>{notice.message}</Toast>}

        <Card>
          <div className="rune-toolbar" role="toolbar" aria-label="Document actions">
            <div className="rune-toolbar__group">
              <Button
                size="sm"
                variant="ghost"
                disabled={!canTransform}
                title="Re-indent — every comment stays where it is"
                onClick={() => applyToEditor(formatYaml(text))}
              >
                Format
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!canTransform}
                title="Collapse to flow style — comments cannot survive this"
                onClick={() => applyToEditor(toFlow(text))}
              >
                Compact
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!canTransform}
                title="Expand to block style"
                onClick={() => applyToEditor(toBlock(text))}
              >
                Expand
              </Button>
            </div>
            <div className="rune-toolbar__group">
              <Button
                size="sm"
                variant="ghost"
                disabled={!canTransform}
                title="Copy this document as JSON (comments are not carried across)"
                onClick={() => void convertToJson()}
              >
                Copy as JSON
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={empty}
                title="Compare this document against another in Variant"
                onClick={diffInVariant}
              >
                Diff in Variant
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
                aria-label="First error"
                onClick={() => gotoIssue(-1)}
              >
                <ChevronLeftIcon size={14} />
                Error
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={issues.length === 0}
                aria-label="Last error"
                onClick={() => gotoIssue(1)}
              >
                Error
                <ChevronRightIcon size={14} />
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

          <div className="rune-body">
            {view === 'code' ? (
              <JsonEditor
                ref={editorRef}
                value={text}
                onChange={setText}
                mode="yaml"
                height="var(--rune-editor-h, 60vh)"
                placeholder={EDITOR_PLACEHOLDER}
              />
            ) : docs.length === 0 ? (
              <p className="rune-tree-empty caption">
                Nothing grown yet — switch to Code and paste some YAML.
              </p>
            ) : (
              <>
                {/* A `---` stream is several documents in one buffer, so the
                    tree needs to say which one it is showing. */}
                {docs.length > 1 && (
                  <div className="groot-docs" role="group" aria-label="Document in the stream">
                    {docs.map((doc, index) => (
                      <button
                        key={doc.index}
                        type="button"
                        className={`lib-chip${index === activeDoc ? ' lib-chip--on' : ''}`}
                        aria-pressed={index === activeDoc}
                        onClick={() => setActiveDoc(index)}
                      >
                        Doc {doc.index}
                      </button>
                    ))}
                  </div>
                )}
                {(() => {
                  const doc = docs[Math.min(activeDoc, docs.length - 1)];
                  if (!doc) return null;
                  if (doc.error) {
                    return <p className="rune-tree-empty caption">{doc.error}</p>;
                  }
                  return (
                    <TreeView
                      value={doc.value}
                      onCopyPath={(path) => void copyText(path)}
                      onCopyValue={(value) => void copyText(String(value))}
                    />
                  );
                })()}
              </>
            )}
          </div>

          {/* Advisories: valid documents that probably mean something other than
              they look like. Never blocking, never auto-fixed. */}
          {groups.length > 0 && (
            <div className="groot-advisories" role="status" aria-label="Advisories">
              {groups.map((group) => (
                <button
                  key={group.kind}
                  type="button"
                  className="groot-advisory"
                  onClick={() => {
                    setView('code');
                    editorRef.current?.gotoOffset(group.first.offset);
                  }}
                >
                  <AlertIcon size={14} />
                  <span>
                    {group.message}
                    {group.count > 1 && <span className="groot-advisory__count"> ×{group.count}</span>}
                  </span>
                  <span className="groot-advisory__line">line {group.first.line}</span>
                </button>
              ))}
            </div>
          )}

          <div className="rune-stats caption">
            {valid ? (
              <span className="rune-stat rune-stat--ok">
                <CheckIcon size={14} /> Parses cleanly
              </span>
            ) : (
              <span className="rune-stat rune-stat--bad">
                <AlertIcon size={14} /> {issues.length} error{issues.length === 1 ? '' : 's'} — first
                on line {issues[0]?.line}
              </span>
            )}
            <span>{formatBytes(bytes)}</span>
            <span>{text === '' ? 0 : text.split('\n').length} lines</span>
            {docs.length > 1 && <span>{docs.length} documents</span>}
          </div>
        </Card>
      </div>
    </>
  );
}
