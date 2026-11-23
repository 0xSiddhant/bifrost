import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
} from 'react';
import { hubNavigate, showBridgeClosed } from '../../core/bridge';
import { useNavigate, useParams } from 'react-router-dom';
import { copyText } from '../../core/copy';
import { formatBytes } from '../../core/format';
import {
  FORMAT_FILE,
  JSON_FORMATS,
  asJsonFormat,
  formatJson,
  jsonStats,
  minifyJson,
  parseJsonValue,
  pathAt,
  sortJsonKeys,
  toStrictJson,
  unescapeEmbedded,
  validateJson,
  type JsonFormat,
  type JsonIssue,
} from '../../core/json';
import { log } from '../../core/log';
import { jsonToJs } from '../../core/js';
import { relicTitle } from '../../core/relicNames';
import { useDraftCache, showsRestore, type ScratchDraft } from '../../core/draftCache';
import { takeLeftOpen } from '../../core/draftReturn';
import { takeRunestoneSeed } from '../../core/runestoneSeed';
import { putBrotliSeed } from '../../core/brotliSeed';
import { ApiError, HubUnavailableError, isHubClosed } from '../../core/api';
import { usePanelFont } from '../../core/panelFont';
import { saveText } from '../../core/saveBlob';
import { Button } from '../../core/ui/Button';
import { Card } from '../../core/ui/Card';
import { PanelFontControl, UndoRedoControl } from '../../core/ui/PanelControls';
import { JsonEditor, type JsonEditorHandle } from '../../core/ui/JsonEditor';
import { Toast } from '../../core/ui/Toast';
import { AlertIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon } from '../../core/ui/icons';
import {
  fetchRunestone,
  RUNESTONE_CONFIG,
  saveRunestone,
  updateRunestone,
} from '../../core/runestone';
import { clearDraft, loadDraft, saveDraft, type RunestoneDraft } from './draft';
import { TreeView } from '../../core/ui/TreeView';
import './runestone.css';

const EDITOR_PLACEHOLDER = 'Paste, type, or drop a .json or .jsonc file to carve it…';

/** Why Unescape is off in JSONC: it rebuilds the text and would lose the comments. */
const UNESCAPE_JSONC_REASON =
  'Unescape works on strict JSON only: it rebuilds the document and would drop its comments';

/** The format a file's name or type says it is, or null when it says neither. */
function formatOfFile(name: string, type: string): JsonFormat | null {
  if (/\.jsonc$/i.test(name) || type === 'application/jsonc') return 'jsonc';
  if (/\.json$/i.test(name) || type === 'application/json') return 'json';
  return null;
}

/** Identifies this editor's buffer to `core/draftReturn`. */
const DRAFT_ID = 'runestone';

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
function exportFilename(title: string, format: JsonFormat): string {
  // eslint-disable-next-line no-control-regex
  const safe = title.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '').trim();
  return `${safe || 'runestone'}${FORMAT_FILE[format].extension}`;
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
  const font = usePanelFont();

  const [phase, setPhase] = useState<Phase>(slug ? 'loading' : 'new');
  const [docId, setDocId] = useState<string | null>(null);
  const [title, setTitle] = useState(() => relicTitle());
  const [text, setText] = useState('');
  // Strict JSON or JSONC (PLAN-42). A mode, never a transform: switching it
  // changes how the buffer is read and checked, and never the buffer itself.
  const [format, setFormat] = useState<JsonFormat>('json');
  const [snapshot, setSnapshot] = useState<{
    title: string;
    text: string;
    format: JsonFormat;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<'code' | 'tree'>(() =>
    window.innerWidth < 768 ? 'tree' : 'code',
  );
  // Baked in at build time (PLAN-35): known before the first render.
  const config = RUNESTONE_CONFIG;
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger'; message: string } | null>(null);
  const [restorable, setRestorable] = useState<RunestoneDraft | null>(null);
  const [cursor, setCursor] = useState(0);
  const editorRef = useRef<JsonEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        const docFormat = asJsonFormat(doc.format);
        setDocId(doc.id);
        setTitle(doc.name);
        setText(doc.content);
        setFormat(docFormat);
        setSnapshot({ title: doc.name, text: doc.content, format: docFormat });
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

  // On arriving at the scratch editor, in order of how directly the person
  // asked for it:
  //   1. a hand-off from another tool (Groot's "Open in Runestone") — a
  //      document they just asked for, so it opens rather than offering to;
  //   2. a buffer left open by a navigation inside this page's lifetime —
  //      leaving to convert something in Groot and coming back is one task;
  //   3. a draft from an earlier page load, which is still only *offered*,
  //      because opening the tool fresh must not silently refill it.
  useEffect(() => {
    if (!isScratch) return;
    const seed = takeRunestoneSeed();
    if (seed) {
      setText(seed.text);
      setFormat(seed.format ?? 'json');
      if (seed.title) setTitle(seed.title);
      setView('code');
      setRestorable(null);
      return;
    }
    const draft = loadDraft();
    if (!draft || draft.text.trim() === '') return;
    if (takeLeftOpen(DRAFT_ID)) {
      setTitle((current) => draft.title || current);
      setText(draft.text);
      setFormat(draft.format);
    } else {
      setRestorable(draft);
    }
  }, [isScratch]);

  // The cache mirrors the scratch buffer, so a refresh mid-edit loses nothing,
  // and leaving flushes it and marks it left open for the silent return above.
  // Saving clears the draft deliberately and flips `isScratch` before leaving,
  // so a saved document cannot resurrect it.
  const blank = text.trim() === '';
  // The cache knows title and text; the format rides along with them. An
  // earlier visit's draft that is re-written while on offer keeps its own.
  const saveFormatDraft = useCallback(
    (draft: ScratchDraft) => saveDraft({ format, ...draft }),
    [format],
  );
  useDraftCache({
    isScratch,
    title,
    text,
    blank,
    offered: restorable,
    save: saveFormatDraft,
    clear: clearDraft,
    returnId: DRAFT_ID,
  });

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 2200);
    return () => window.clearTimeout(id);
  }, [notice]);

  const debouncedText = useDebounced(text, 300);
  const issues: JsonIssue[] = useMemo(
    () => (debouncedText.trim() === '' ? [] : validateJson(debouncedText, format)),
    [debouncedText, format],
  );
  const stats = useMemo(() => jsonStats(debouncedText, format), [debouncedText, format]);
  const empty = debouncedText.trim() === '';
  const valid = !empty && issues.length === 0;
  // Strict JSON that is only broken by comments or trailing commas: say so,
  // and offer the switch, rather than leave a wall of "Comments are not valid".
  const validAsJsonc = useMemo(
    () =>
      format === 'json' &&
      !empty &&
      issues.length > 0 &&
      validateJson(debouncedText, 'jsonc').length === 0,
    [format, empty, issues, debouncedText],
  );
  const parsed: unknown = useMemo(
    () => (view === 'tree' && valid ? parseJsonValue(debouncedText, format) : undefined),
    [view, valid, debouncedText, format],
  );

  const maxBytes = config.maxDocKb * 1024;
  const overCap = maxBytes !== null && stats.bytes > maxBytes;

  const debouncedCursor = useDebounced(cursor, 150);
  const cursorPath = useMemo(() => {
    if (view !== 'code' || empty) return null;
    return pathAt(debouncedText, Math.min(debouncedCursor, debouncedText.length));
  }, [view, empty, debouncedText, debouncedCursor]);

  const dirty =
    snapshot === null
      ? text.trim() !== ''
      : snapshot.title !== title || snapshot.text !== text || snapshot.format !== format;
  const canSave = valid && !overCap && !saving && (snapshot === null || dirty);

  const ok = (message: string) => setNotice({ kind: 'ok', message });
  const fail = (message: string) => setNotice({ kind: 'danger', message });

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      if (docId === null) {
        const doc = await saveRunestone({ name: title, content: text, format });
        const savedFormat = asJsonFormat(doc.format);
        setDocId(doc.id);
        setTitle(doc.name);
        setFormat(savedFormat);
        setSnapshot({ title: doc.name, text: doc.content, format: savedFormat });
        setPhase('saved');
        clearDraft();
        setRestorable(null);
        navigate(`/runestone/${doc.slug}`, { replace: true });
        ok('Runestone carved');
      } else {
        const doc = await updateRunestone(docId, { name: title, content: text, format });
        const savedFormat = asJsonFormat(doc.format);
        setTitle(doc.name);
        setFormat(savedFormat);
        setSnapshot({ title: doc.name, text: doc.content, format: savedFormat });
        if (slug && doc.slug !== slug) navigate(`/runestone/${doc.slug}`, { replace: true });
        ok('Saved');
      }
    } catch (error) {
      if (isHubClosed(error)) {
        // The sheet already explains; on the standalone site its "Download
        // instead" is this editor's own export, the local answer to "save".
        showBridgeClosed({
          reason: error instanceof HubUnavailableError ? 'standalone' : 'unreachable',
          download: exportDocument,
        });
        return;
      }
      fail(
        error instanceof ApiError && error.status === 413
          ? 'The server refused it — over the size limit.'
          : 'Save failed — is the bridge up?',
      );
    } finally {
      setSaving(false);
    }
  };

  // Format keeps every comment (the formatter only moves whitespace); Minify
  // keeps them in JSONC, with a line break after a line comment.
  const applyFormat = () => setText((current) => formatJson(current));
  const applyMinify = () => setText((current) => minifyJson(current, format));

  const applySortKeys = () => {
    const sorted = sortJsonKeys(text, format);
    if (sorted !== null) {
      setText(sorted);
      ok('Keys sorted A→Z');
    } else if (format === 'jsonc' && validateJson(text, 'jsonc').length === 0) {
      // The comment-safe sort refused its own output: nothing is changed. It
      // should not happen, and when it does the document is the clue.
      log.warn(
        `runestone: comment-safe key sort refused a valid JSONC document (${text.length} chars)`,
        { module: 'runestone' },
      );
      fail('Keys were not sorted: not every comment could stay with its key.');
    } else {
      fail(`Fix the errors first — sorting needs valid ${FORMAT_FILE[format].label}.`);
    }
  };

  const applyUnescape = () => {
    if (format === 'jsonc') return;
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

  // Loki's jsonToJs (PLAN-12): valid JSON → a JS object literal (identifier
  // keys unquoted, single-quoted strings), copied to the clipboard. Enabled
  // only on Valid JSON ✓, so it's safe by construction. A JSONC document is
  // read through its strict form; the buffer is never touched.
  const copyAsJs = async () => {
    try {
      const strict = format === 'jsonc' ? toStrictJson(text) : text;
      if (strict === null) throw new Error('not valid JSONC');
      const js = jsonToJs(strict);
      if (await copyText(js)) ok('Copied as a JS object literal');
      else fail('Copy was blocked by the browser.');
    } catch {
      fail(`Fix the errors first — Copy as JS needs valid ${FORMAT_FILE[format].label}.`);
    }
  };

  // JSONC → strict JSON for a consumer that rejects comments (PLAN-42): the
  // comments and trailing commas go, every value token stays as written, and
  // it is a copy — the buffer keeps its comments.
  const copyAsStrictJson = async () => {
    const strict = toStrictJson(text);
    if (strict === null) {
      fail('Fix the errors first — this needs valid JSONC.');
      return;
    }
    if (await copyText(strict)) ok('Copied as strict JSON, without the comments');
    else fail('Copy was blocked by the browser.');
  };

  // The switch (PLAN-42). Only the mode changes: the editor's language and
  // lint, the checks and the save. The buffer is left exactly as it is.
  const changeFormat = (next: JsonFormat) => {
    if (next === format) return;
    setFormat(next);
  };


  // Hand-off, not an import (PLAN-25): the Brotli page reads this seed once on
  // mount and compresses it straight away, so no feature imports another. The
  // live buffer is sent, never the debounced copy the toolbar's disabled state
  // is derived from — a snapshot 300ms old is not what the user is looking at.
  const compressWithBrotli = () => {
    putBrotliSeed({ text, sourceLabel: 'Runestone' });
    hubNavigate(navigate, '/brotli');
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

  // The file says which format it is: `.jsonc` opens as JSONC even when its
  // contents happen to be strict JSON, and `.json` as JSON. A file that says
  // neither keeps the current mode.
  const importText = async (name: string, type: string, content: string, sizeBytes: number) => {
    const maxBytes = config.maxDocKb * 1024;
    if (maxBytes !== null && sizeBytes > maxBytes) {
      fail(`That file is over the ${formatBytes(maxBytes)} limit.`);
      return;
    }
    const fileFormat = formatOfFile(name, type);
    setText(content);
    if (fileFormat) setFormat(fileFormat);
    const base = name.replace(/\.jsonc?$/i, '').trim();
    if (base) setTitle(base);
    ok(`Imported ${name}${fileFormat ? ` as ${FORMAT_FILE[fileFormat].label}` : ''}`);
  };

  const onPickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) await importText(file.name, file.type, await file.text(), file.size);
  };

  const onDrop = async (event: DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    if (formatOfFile(file.name, file.type) === null) {
      fail('Only .json and .jsonc files can be dropped here.');
      return;
    }
    await importText(file.name, file.type, await file.text(), file.size);
  };

  const exportDocument = () =>
    saveText(text, exportFilename(title, format), FORMAT_FILE[format].mimeType);

  const restoreDraft = () => {
    if (!restorable) return;
    setTitle(restorable.title || title);
    setText(restorable.text);
    setFormat(restorable.format);
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
    setFormat('json');
    setTitle(slug ? titleFromSlug(slug) || relicTitle() : relicTitle());
    navigate('/runestone', { replace: true });
  };

  // A blank buffer without leaving the page. Once a document is saved the
  // editor is bound to its slug, and reloading /runestone/<slug> correctly
  // re-opens that same document — so the only way to start another one was to
  // leave Ollivanders and come back in. This is the same reset the 404 does,
  // with a generated title instead of a slug-derived one, and it *pushes* the
  // scratch URL rather than replacing it, so Back returns to the document.
  const startNew = () => {
    if (dirty && !window.confirm('Start a new runestone? Unsaved changes to this one are lost.'))
      return;
    setPhase('new');
    setDocId(null);
    setSnapshot(null);
    setText('');
    setFormat('json');
    setTitle(relicTitle());
    setNotice(null);
    // The cached draft backs up the buffer being left behind, so keeping it
    // would have the restore prompt offer back exactly what New discarded.
    clearDraft();
    setRestorable(null);
    if (slug) navigate('/runestone');
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
            <p>…or it has crumbled to dust. The Pensieve keeps no memory of “{slug}”.</p>
          </div>
        </div>
        <Card>
          <div className="rune-404">
            <p className="rune-404__glyph" aria-hidden="true">
              ᚱᚢᚾᛖ᛫ᛚᛟᛊᛏ
            </p>
            <div className="row">
              <Button onClick={carveFromSlug}>Carve it now</Button>
              <Button variant="ghost" onClick={() => hubNavigate(navigate, '/pensieve?type=runestone')}>
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
          <p>Validate, explore, and shape JSON or JSONC. The title names your export.</p>
        </div>
        <div className="rune-head-actions">
          <Button
            variant="ghost"
            onClick={startNew}
            disabled={saving}
            title="Start a new runestone"
          >
            New
          </Button>
          <Button onClick={() => void save()} disabled={!canSave}>
            {saving ? 'Carving…' : docId === null ? 'Save to Pensieve' : dirty ? 'Save' : 'Saved'}
          </Button>
          <Button variant="ghost" onClick={() => hubNavigate(navigate, '/pensieve?type=runestone')}>
            Pensieve
          </Button>
        </div>
      </div>

      <div
        className="stack rune-workspace panel-scope"
        style={{ '--panel-font': `${font.px}px` } as CSSProperties}
      >
        {showsRestore(restorable, blank) && (
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
            <fieldset className="rune-toolbar__group rune-format">
              <legend className="rune-format__legend">Document format</legend>
              {JSON_FORMATS.map((option) => (
                <label key={option} className="rune-format__option">
                  <input
                    className="rune-format__input"
                    type="radio"
                    name="rune-format"
                    value={option}
                    checked={format === option}
                    onChange={() => changeFormat(option)}
                  />
                  <span className="rune-format__label">{FORMAT_FILE[option].label}</span>
                </label>
              ))}
            </fieldset>
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
              <Button
                size="sm"
                variant="ghost"
                disabled={empty || format === 'jsonc'}
                title={format === 'jsonc' ? UNESCAPE_JSONC_REASON : undefined}
                onClick={applyUnescape}
              >
                Unescape
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!canTransform}
                title="Copy as a JavaScript object literal"
                onClick={() => void copyAsJs()}
              >
                Copy as JS
              </Button>
              {format === 'jsonc' && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canTransform}
                  title="Copy without the comments and trailing commas; the document keeps them"
                  onClick={() => void copyAsStrictJson()}
                >
                  Copy as strict JSON
                </Button>
              )}
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
                disabled={empty}
                title="Send this document to the Brotli page and compress it"
                onClick={compressWithBrotli}
              >
                Brotli
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
                value={text}
                mode={format}
                onChange={setText}
                onCursor={setCursor}
                height="var(--rune-editor-h, 60vh)"
                placeholder={EDITOR_PLACEHOLDER}
              />
            ) : empty ? (
              <p className="rune-tree-empty caption">
                Nothing carved yet — switch to Code and paste some {FORMAT_FILE[format].label}.
              </p>
            ) : valid && parsed !== undefined ? (
              <TreeView
                value={parsed}
                onCopyPath={(path) => void copyPath(path)}
                onCopyValue={(value) => void copyValue(value)}
              />
            ) : (
              <p className="rune-tree-empty caption">
                The tree appears once the {FORMAT_FILE[format].label} is valid — {issues.length}{' '}
                {issues.length === 1 ? 'error remains' : 'errors remain'}.
              </p>
            )}
          </div>

          <div className="rune-status" aria-live="polite">
            {empty ? (
              <span className="rune-status__state caption">
                Empty — paste or import {FORMAT_FILE[format].label}
              </span>
            ) : valid ? (
              <span className="rune-status__state rune-status__state--ok">
                <CheckIcon size={14} /> Valid {FORMAT_FILE[format].label}
              </span>
            ) : (
              <span className="rune-status__state rune-status__state--bad">
                <AlertIcon size={14} /> {issues.length} {issues.length === 1 ? 'error' : 'errors'}{' '}
                in {FORMAT_FILE[format].label}
              </span>
            )}
            {validAsJsonc && (
              <span className="rune-status__hint caption">
                Valid as JSONC —{' '}
                <button
                  type="button"
                  className="rune-status__switch"
                  onClick={() => changeFormat('jsonc')}
                >
                  switch to JSONC
                </button>{' '}
                to keep its comments
              </span>
            )}
            {docId !== null && (
              <span className="caption">{dirty ? 'Unsaved changes' : 'Kept in the Pensieve'}</span>
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

        {notice && (
          <Toast kind={notice.kind} floating>
            {notice.message}
          </Toast>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.jsonc,application/json,application/jsonc"
        hidden
        onChange={(event) => void onPickFile(event)}
      />
    </>
  );
}
