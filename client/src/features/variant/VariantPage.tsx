import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Text } from '@codemirror/state';
import { Chunk } from '@codemirror/merge';
import { useCapabilities } from '../../core/useCapabilities';
import { copyText } from '../../core/copy';
import { formatJson, validateJson } from '../../core/json';
import type { DiffRecord } from '../../core/json/diff';
import { normalizeText, hasActiveNormalization } from '../../core/textNormalize';
import { fetchRunestone, type RunestoneDoc } from '../../core/runestone';
import { Button } from '../../core/ui/Button';
import { Toast } from '../../core/ui/Toast';
import { TreeView } from '../../core/ui/TreeView';
import { JsonEditor, type JsonEditorHandle } from '../../core/ui/JsonEditor';
import { CheckIcon, AlertIcon, ChevronLeftIcon, ChevronRightIcon } from '../../core/ui/icons';
import {
  compareJson,
  DEFAULT_JSON_OPTIONS,
  DEFAULT_TEXT_OPTIONS,
  diffStats,
  toNormalizeOptions,
  type InvalidSide,
  type VariantJsonOptions,
  type VariantTextOptions,
} from './compare';
import { jumpTargetFor, recordsToHighlights } from './highlights';
import { LibraryPicker } from './LibraryPicker';
import { OptionsPopover } from './OptionsPopover';
import { ResultsDrawer, type TextChunkRow } from './ResultsDrawer';
import { TextCompare, type TextCompareHandle } from './TextCompare';

/**
 * Variant (PLAN-08): two-pane JSON & text comparison. Structural JSON diff by
 * default; text mode is the graceful floor for anything that will not parse.
 * All compute is client-side — the server module only advertises the page.
 */

type Mode = 'json' | 'text';
type Side = 'left' | 'right';

interface PaneSource {
  slug: string;
  name: string;
}

interface CompareResults {
  records: DiffRecord[];
  left: string;
  right: string;
}

const EDITOR_HEIGHT = '56vh';
const WRAP_KEY = 'variant.wordWrap';

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

const startsMobile = () => window.innerWidth < 768;

function fallbackMessage(side: InvalidSide): string {
  if (side === 'both') return 'Neither side is valid JSON — comparing as text.';
  return `The ${side} side isn't valid JSON — switched to Text mode.`;
}

interface PaneState {
  text: string;
  label: string;
  source: PaneSource | null;
  slugError: string | null;
}

const emptyPane = (label: string): PaneState => ({
  text: '',
  label,
  source: null,
  slugError: null,
});

export function VariantPage() {
  const { capabilities } = useCapabilities();
  const [searchParams, setSearchParams] = useSearchParams();

  const [mode, setMode] = useState<Mode>('json');
  const [left, setLeft] = useState<PaneState>(() => emptyPane('Original'));
  const [right, setRight] = useState<PaneState>(() => emptyPane('Modified'));
  const [jsonOptions, setJsonOptions] = useState<VariantJsonOptions>(DEFAULT_JSON_OPTIONS);
  const [textOptions, setTextOptions] = useState<VariantTextOptions>(DEFAULT_TEXT_OPTIONS);
  const [results, setResults] = useState<CompareResults | null>(null);
  const [stale, setStale] = useState(false);
  const [fallback, setFallback] = useState<InvalidSide | null>(null);
  const [view, setView] = useState<'code' | 'tree'>('code');
  const [textView, setTextView] = useState<'split' | 'unified'>(() =>
    startsMobile() ? 'unified' : 'split',
  );
  const [wordWrap, setWordWrap] = useState(() => sessionStorage.getItem(WRAP_KEY) === '1');
  const [drawerOpen, setDrawerOpen] = useState(startsMobile);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [pickerSide, setPickerSide] = useState<Side | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger'; message: string } | null>(null);
  const [resetToken, setResetToken] = useState(0);
  const [changeCursor, setChangeCursor] = useState(-1);
  const [pendingJump, setPendingJump] = useState<{ left: number | null; right: number | null } | null>(null);

  const leftEditorRef = useRef<JsonEditorHandle>(null);
  const rightEditorRef = useRef<JsonEditorHandle>(null);
  const textRef = useRef<TextCompareHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importSideRef = useRef<Side>('left');

  const setPane = (side: Side, update: (pane: PaneState) => PaneState) => {
    (side === 'left' ? setLeft : setRight)(update);
  };

  const ok = (message: string) => setNotice({ kind: 'ok', message });
  const fail = (message: string) => setNotice({ kind: 'danger', message });

  const copyPath = async (path: string) => {
    if (await copyText(path)) ok(`Path copied — ${path}`);
    else fail('Copy was blocked by the browser.');
  };

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 2400);
    return () => window.clearTimeout(id);
  }, [notice]);

  useEffect(() => {
    sessionStorage.setItem(WRAP_KEY, wordWrap ? '1' : '0');
  }, [wordWrap]);

  // ── shareable compare URLs: ?left=<slug>&right=<slug> ─────────────────────
  const leftParam = searchParams.get('left');
  const rightParam = searchParams.get('right');
  const leftLoadedSlug = left.source?.slug ?? null;
  const rightLoadedSlug = right.source?.slug ?? null;

  useEffect(() => {
    let cancelled = false;
    const load = async (side: Side, slug: string | null, loaded: string | null) => {
      if (!slug || slug === loaded) return null;
      try {
        const doc = await fetchRunestone(slug);
        if (cancelled) return null;
        if (!doc) {
          setPane(side, (pane) => ({
            ...pane,
            slugError: `No runestone answers to “${slug}” — it was never carved, or has crumbled.`,
          }));
          return null;
        }
        setPane(side, () => ({
          text: doc.content,
          label: doc.name,
          source: { slug: doc.slug, name: doc.name },
          slugError: null,
        }));
        return doc;
      } catch {
        if (!cancelled) {
          setPane(side, (pane) => ({ ...pane, slugError: 'Could not load that runestone.' }));
        }
        return null;
      }
    };
    void (async () => {
      const [leftDoc, rightDoc] = await Promise.all([
        load('left', leftParam, leftLoadedSlug),
        load('right', rightParam, rightLoadedSlug),
      ]);
      if (cancelled || (!leftDoc && !rightDoc)) return;
      setResetToken((token) => token + 1);
      // Acceptance 5: a URL naming both sides opens pre-loaded AND compared.
      const l = leftDoc?.content ?? (leftParam === leftLoadedSlug ? left.text : null);
      const r = rightDoc?.content ?? (rightParam === rightLoadedSlug ? right.text : null);
      if (l !== null && r !== null) runCompare(l, r);
    })();
    return () => {
      cancelled = true;
    };
    // The slug params are the real dependencies; pane text is read fresh inside.
  }, [leftParam, rightParam]);

  const setSlugParam = (side: Side, slug: string | null) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (slug) next.set(side, slug);
        else next.delete(side);
        return next;
      },
      { replace: true },
    );
  };

  // ── compare flow ──────────────────────────────────────────────────────────
  const runCompare = (l = left.text, r = right.text) => {
    const outcome = compareJson(l, r, jsonOptions);
    if (!outcome.ok) {
      setFallback(outcome.invalid);
      setMode('text');
      setResults(null);
      setStale(false);
      setResetToken((token) => token + 1);
      return;
    }
    setResults({ records: outcome.records, left: l, right: r });
    setStale(false);
    setFallback(null);
    setChangeCursor(-1);
    if (startsMobile()) setDrawerOpen(true);
  };

  const onPaneEdit = (side: Side) => (value: string) => {
    setPane(side, (pane) =>
      pane.text === value ? pane : { ...pane, text: value, slugError: null },
    );
    if (results) setStale(true);
  };

  const highlights = useMemo(
    () => (results ? recordsToHighlights(results.records, results.left, results.right) : null),
    [results],
  );

  // ── per-side validity (drives Compare state + the fallback return path) ───
  const debouncedLeft = useDebounced(left.text, 300);
  const debouncedRight = useDebounced(right.text, 300);
  const leftIssues = useMemo(
    () => (debouncedLeft.trim() === '' ? null : validateJson(debouncedLeft).length),
    [debouncedLeft],
  );
  const rightIssues = useMemo(
    () => (debouncedRight.trim() === '' ? null : validateJson(debouncedRight).length),
    [debouncedRight],
  );
  const bothValid = leftIssues === 0 && rightIssues === 0;

  const parsedFor = (text: string, issues: number | null): unknown => {
    if (issues !== 0) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  };
  const leftParsed = useMemo(
    () => (mode === 'json' && view === 'tree' ? parsedFor(debouncedLeft, leftIssues) : undefined),
    [mode, view, debouncedLeft, leftIssues],
  );
  const rightParsed = useMemo(
    () => (mode === 'json' && view === 'tree' ? parsedFor(debouncedRight, rightIssues) : undefined),
    [mode, view, debouncedRight, rightIssues],
  );

  // ── text mode: normalized copies + chunk rows for the drawer ──────────────
  const textDiff = useMemo(() => {
    if (mode !== 'text') return null;
    const options = toNormalizeOptions(textOptions);
    const l = normalizeText(debouncedLeft, options);
    const r = normalizeText(debouncedRight, options);
    const docA = Text.of(l.split('\n'));
    const docB = Text.of(r.split('\n'));
    const chunks = Chunk.build(docA, docB);
    const lines = (doc: Text, from: number, end: number) => {
      const a = doc.lineAt(Math.min(from, doc.length)).number;
      const b = doc.lineAt(Math.min(end, doc.length)).number;
      return a === b ? `${a}` : `${a}–${b}`;
    };
    const rows: TextChunkRow[] = chunks.map((chunk) => {
      const kind =
        chunk.fromA === chunk.toA ? 'add' : chunk.fromB === chunk.toB ? 'remove' : 'change';
      const spanA = lines(docA, chunk.fromA, chunk.endA);
      const spanB = lines(docB, chunk.fromB, chunk.endB);
      const label =
        kind === 'add'
          ? `line ${spanB} (right)`
          : kind === 'remove'
            ? `line ${spanA} (left)`
            : `left ${spanA} ↔ right ${spanB}`;
      return { kind, label, posA: Math.min(chunk.fromA, docA.length), posB: Math.min(chunk.fromB, docB.length) };
    });
    let adds = 0;
    let removes = 0;
    let changes = 0;
    for (const row of rows) {
      if (row.kind === 'add') adds += 1;
      else if (row.kind === 'remove') removes += 1;
      else changes += 1;
    }
    return {
      rows,
      stats: { adds, removes, changes },
      normalized: hasActiveNormalization(textOptions) ? { left: l, right: r } : null,
    };
  }, [mode, debouncedLeft, debouncedRight, textOptions]);

  const stats = mode === 'json' ? (results ? diffStats(results.records) : null) : (textDiff?.stats ?? null);

  // ── scroll-lock the two JSON panes so hunks stay aligned ──────────────────
  useEffect(() => {
    if (mode !== 'json' || view !== 'code') return;
    const a = leftEditorRef.current?.scrollerElement();
    const b = rightEditorRef.current?.scrollerElement();
    if (!a || !b) return;
    let locked = false;
    const follow = (source: HTMLElement, target: HTMLElement) => () => {
      if (locked) return;
      locked = true;
      target.scrollTop = source.scrollTop;
      requestAnimationFrame(() => {
        locked = false;
      });
    };
    const fromA = follow(a, b);
    const fromB = follow(b, a);
    a.addEventListener('scroll', fromA);
    b.addEventListener('scroll', fromB);
    return () => {
      a.removeEventListener('scroll', fromA);
      b.removeEventListener('scroll', fromB);
    };
  }, [mode, view, resetToken]);

  // Jumps requested from tree view land after the code editors remount.
  useEffect(() => {
    if (mode !== 'json' || view !== 'code' || !pendingJump) return;
    if (pendingJump.left !== null) leftEditorRef.current?.revealOffset(pendingJump.left);
    if (pendingJump.right !== null) rightEditorRef.current?.revealOffset(pendingJump.right);
    setPendingJump(null);
  }, [mode, view, pendingJump]);

  const jumpToRecord = (record: DiffRecord) => {
    if (!results) return;
    const target = jumpTargetFor(record, results.left, results.right);
    if (view !== 'code') {
      setView('code');
      setPendingJump(target);
      return;
    }
    if (target.left !== null) leftEditorRef.current?.revealOffset(target.left);
    if (target.right !== null) rightEditorRef.current?.revealOffset(target.right);
  };

  const stepChange = (direction: 1 | -1) => {
    if (mode === 'text') {
      textRef.current?.nextChunk(direction);
      return;
    }
    if (!results || results.records.length === 0) return;
    const next =
      (changeCursor + direction + results.records.length) % results.records.length;
    setChangeCursor(next);
    const record = results.records[next];
    if (record) jumpToRecord(record);
  };

  // ── rail actions ──────────────────────────────────────────────────────────
  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    setResults(null);
    setStale(false);
    setFallback(null);
    setResetToken((token) => token + 1);
  };

  const returnToJson = () => {
    setMode('json');
    setFallback(null);
    runCompare();
  };

  const swapPanes = () => {
    const previousLeft = left;
    setLeft(right);
    setRight(previousLeft);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        const l = prev.get('left');
        const r = prev.get('right');
        next.delete('left');
        next.delete('right');
        if (r) next.set('left', r);
        if (l) next.set('right', l);
        return next;
      },
      { replace: true },
    );
    if (results) setStale(true);
    setResetToken((token) => token + 1);
  };

  const formatBoth = () => {
    if (!bothValid) {
      fail('Both sides must be valid JSON to format.');
      return;
    }
    setLeft((pane) => ({ ...pane, text: formatJson(pane.text) }));
    setRight((pane) => ({ ...pane, text: formatJson(pane.text) }));
    if (results) setStale(true);
    setResetToken((token) => token + 1);
    ok('Formatted both sides');
  };

  const clearBoth = () => {
    if (!window.confirm('Clear both panes?')) return;
    setLeft(emptyPane('Original'));
    setRight(emptyPane('Modified'));
    setResults(null);
    setStale(false);
    setFallback(null);
    setSearchParams({}, { replace: true });
    setResetToken((token) => token + 1);
  };

  // ── import & library ──────────────────────────────────────────────────────
  const importInto = (side: Side) => {
    importSideRef.current = side;
    fileInputRef.current?.click();
  };

  const onPickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const side = importSideRef.current;
    const content = await file.text();
    const label = file.name.replace(/\.[^.]+$/, '').trim() || file.name;
    setPane(side, () => ({ text: content, label, source: null, slugError: null }));
    setSlugParam(side, null);
    if (results) setStale(true);
    setResetToken((token) => token + 1);
    ok(`Imported ${file.name}`);
  };

  const onLibraryPick = (doc: RunestoneDoc) => {
    const side = pickerSide;
    setPickerSide(null);
    if (!side) return;
    setPane(side, () => ({
      text: doc.content,
      label: doc.name,
      source: { slug: doc.slug, name: doc.name },
      slugError: null,
    }));
    setSlugParam(side, doc.slug);
    if (results) setStale(true);
    setResetToken((token) => token + 1);
  };

  const canPickFromLibrary =
    !capabilities || capabilities.modules.includes('runestone');

  const empty = left.text.trim() === '' && right.text.trim() === '';

  // ── render helpers ────────────────────────────────────────────────────────
  const paneHeader = (side: Side, pane: PaneState) => (
    <div className="variant-pane__head">
      <input
        className="variant-pane__label"
        value={pane.label}
        maxLength={60}
        aria-label={`${side} pane label`}
        onChange={(event) =>
          setPane(side, (current) => ({ ...current, label: event.target.value }))
        }
      />
      <div className="variant-pane__actions">
        <Button size="sm" variant="ghost" onClick={() => importInto(side)}>
          Import
        </Button>
        {canPickFromLibrary && (
          <Button size="sm" variant="ghost" onClick={() => setPickerSide(side)}>
            Mímir
          </Button>
        )}
      </div>
    </div>
  );

  const paneStatus = (issues: number | null, text: string) => (
    <div className="variant-pane__status caption" aria-live="polite">
      {text.trim() === '' ? (
        <span>Empty</span>
      ) : issues === null ? (
        <span>…</span>
      ) : issues === 0 ? (
        <span className="variant-pane__ok">
          <CheckIcon size={12} /> Valid JSON
        </span>
      ) : (
        <span className="variant-pane__bad">
          <AlertIcon size={12} /> {issues} {issues === 1 ? 'error' : 'errors'}
        </span>
      )}
    </div>
  );

  const jsonPane = (
    side: Side,
    pane: PaneState,
    editorRef: React.RefObject<JsonEditorHandle | null>,
    parsed: unknown,
    issues: number | null,
  ) => {
    return (
      <section className={`variant-pane variant-pane--${side}`}>
        {paneHeader(side, pane)}
        {pane.slugError && <p className="variant-pane__error caption">{pane.slugError}</p>}
        {view === 'code' ? (
          <JsonEditor
            ref={editorRef}
            value={pane.text}
            onChange={onPaneEdit(side)}
            height={EDITOR_HEIGHT}
            placeholder="Paste, type, import — or load from Mímir…"
            highlights={
              highlights ? (side === 'left' ? highlights.left : highlights.right) : undefined
            }
          />
        ) : pane.text.trim() === '' ? (
          <p className="variant-pane__treeempty caption">Nothing here yet.</p>
        ) : parsed !== undefined ? (
          <div className="variant-pane__tree">
            <TreeView value={parsed} onCopyPath={(path) => void copyPath(path)} />
          </div>
        ) : (
          <p className="variant-pane__treeempty caption">
            The tree appears once this side parses.
          </p>
        )}
        {paneStatus(issues, pane.text)}
      </section>
    );
  };

  const rail = (
    <div className="variant-rail" role="toolbar" aria-label="Compare actions">
      <div className="variant-modetoggle" role="group" aria-label="Compare mode">
        <button
          type="button"
          className={`variant-modetoggle__btn${mode === 'json' ? ' is-active' : ''}`}
          onClick={() => switchMode('json')}
        >
          JSON
        </button>
        <button
          type="button"
          className={`variant-modetoggle__btn${mode === 'text' ? ' is-active' : ''}`}
          onClick={() => switchMode('text')}
        >
          Text
        </button>
      </div>

      {mode === 'json' && (
        <Button onClick={() => runCompare()} disabled={empty}>
          Compare
        </Button>
      )}
      {mode === 'json' && stale && (
        <span className="variant-rail__stale caption">stale</span>
      )}

      <Button size="sm" variant="ghost" onClick={swapPanes} disabled={empty} title="Swap sides">
        Swap ⇄
      </Button>
      {mode === 'json' && (
        <Button size="sm" variant="ghost" onClick={formatBoth} disabled={empty}>
          Format both
        </Button>
      )}
      {mode === 'json' && (
        <div className="variant-modetoggle" role="group" aria-label="Pane view">
          <button
            type="button"
            className={`variant-modetoggle__btn${view === 'code' ? ' is-active' : ''}`}
            onClick={() => setView('code')}
          >
            Code
          </button>
          <button
            type="button"
            className={`variant-modetoggle__btn${view === 'tree' ? ' is-active' : ''}`}
            onClick={() => setView('tree')}
          >
            Tree
          </button>
        </div>
      )}
      {mode === 'text' && (
        <div className="variant-modetoggle" role="group" aria-label="Text layout">
          <button
            type="button"
            className={`variant-modetoggle__btn${textView === 'split' ? ' is-active' : ''}`}
            onClick={() => setTextView('split')}
          >
            Split
          </button>
          <button
            type="button"
            className={`variant-modetoggle__btn${textView === 'unified' ? ' is-active' : ''}`}
            onClick={() => setTextView('unified')}
          >
            Unified
          </button>
        </div>
      )}
      {mode === 'text' && (
        <Button
          size="sm"
          variant={wordWrap ? 'primary' : 'ghost'}
          onClick={() => setWordWrap((wrap) => !wrap)}
          title="Toggle word wrap"
        >
          Wrap
        </Button>
      )}

      <div className="variant-rail__nav">
        <Button
          size="sm"
          variant="ghost"
          aria-label="Previous change"
          onClick={() => stepChange(-1)}
          disabled={mode === 'json' && (!results || results.records.length === 0)}
        >
          <ChevronLeftIcon size={14} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Next change"
          onClick={() => stepChange(1)}
          disabled={mode === 'json' && (!results || results.records.length === 0)}
        >
          <ChevronRightIcon size={14} />
        </Button>
      </div>

      <div className="variant-rail__options">
        <Button
          size="sm"
          variant={optionsOpen ? 'primary' : 'ghost'}
          onClick={() => setOptionsOpen((open) => !open)}
          aria-expanded={optionsOpen}
        >
          Options
        </Button>
        {optionsOpen && (
          <div className="variant-rail__popover">
            <OptionsPopover
              mode={mode}
              json={jsonOptions}
              text={textOptions}
              onJsonChange={(next) => {
                setJsonOptions(next);
                if (results) setStale(true);
              }}
              onTextChange={setTextOptions}
            />
          </div>
        )}
      </div>

      <Button size="sm" variant="ghost" onClick={clearBoth} disabled={empty}>
        Clear
      </Button>
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow eyebrow--violet">the variant · two stones, one truth</span>
          <h2>Variant</h2>
          <p>
            Compare JSON structurally — key order and formatting are noise — or fall back to raw
            text for anything else.
          </p>
        </div>
      </div>

      <div className="stack">
        {fallback && (
          <Toast kind="info">
            <span className="variant-fallback">
              {fallbackMessage(fallback)}
              <Button size="sm" onClick={returnToJson} disabled={!bothValid}>
                {bothValid ? 'Back to JSON compare' : 'Fix the JSON to return'}
              </Button>
            </span>
          </Toast>
        )}

        {mode === 'text' && textDiff?.normalized && (
          <Toast kind="info">
            Comparing normalized copies — editing is paused while normalization options are on.
          </Toast>
        )}

        {mode === 'json' ? (
          <div className="variant-grid">
            {jsonPane('left', left, leftEditorRef, leftParsed, leftIssues)}
            {rail}
            {jsonPane('right', right, rightEditorRef, rightParsed, rightIssues)}
          </div>
        ) : (
          <div className="variant-textgrid">
            {rail}
            <div className="variant-textheads">
              <div>{paneHeader('left', left)}</div>
              <div>{paneHeader('right', right)}</div>
            </div>
            {(left.slugError || right.slugError) && (
              <p className="variant-pane__error caption">
                {left.slugError ?? right.slugError}
              </p>
            )}
            <TextCompare
              ref={textRef}
              left={left.text}
              right={right.text}
              onLeftChange={onPaneEdit('left')}
              onRightChange={onPaneEdit('right')}
              view={textView}
              wordWrap={wordWrap}
              normalized={textDiff?.normalized ?? null}
              height={EDITOR_HEIGHT}
              resetToken={resetToken}
            />
          </div>
        )}

        <ResultsDrawer
          mode={mode}
          open={drawerOpen}
          onToggle={() => setDrawerOpen((open) => !open)}
          stale={stale}
          stats={stats}
          records={results?.records ?? null}
          chunks={textDiff?.rows ?? null}
          onJumpRecord={jumpToRecord}
          onJumpChunk={(row) => textRef.current?.scrollToPositions(row.posA, row.posB)}
        />

        {notice && <Toast kind={notice.kind}>{notice.message}</Toast>}
      </div>

      <LibraryPicker
        open={pickerSide !== null}
        side={pickerSide ?? 'left'}
        onPick={onLibraryPick}
        onClose={() => setPickerSide(null)}
      />

      <input ref={fileInputRef} type="file" hidden onChange={(event) => void onPickFile(event)} />
    </>
  );
}
