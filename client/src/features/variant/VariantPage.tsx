import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCapabilities } from '../../core/useCapabilities';
import { copyText } from '../../core/copy';
import { formatJson, sortKeysDeep, validateJson } from '../../core/json';
import type { DiffRecord } from '../../core/json/diff';
import { fetchRunestone, type RunestoneDoc } from '../../core/runestone';
import { usePanelFont } from '../../core/panelFont';
import { Button } from '../../core/ui/Button';
import { Toast } from '../../core/ui/Toast';
import { TreeView } from '../../core/ui/TreeView';
import { PanelFontControl, UndoRedoControl } from '../../core/ui/PanelControls';
import { JsonEditor, type JsonEditorHandle } from '../../core/ui/JsonEditor';
import { CheckIcon, AlertIcon, ChevronLeftIcon, ChevronRightIcon } from '../../core/ui/icons';
import {
  compareJson,
  compareText,
  DEFAULT_JSON_OPTIONS,
  DEFAULT_TEXT_OPTIONS,
  diffStats,
  type InvalidSide,
  type TextChunkRow,
  type TextCompareResult,
  type VariantJsonOptions,
  type VariantTextOptions,
} from './compare';
import { jumpTargetFor, recordsToHighlights } from './highlights';
import { crossPaneOffset } from './search';
import { LibraryPicker } from './LibraryPicker';
import { OptionsPopover } from './OptionsPopover';
import { ResultsDrawer } from './ResultsDrawer';
import { hasActiveNormalization } from '../../core/textNormalize';
import { takeVariantTextSeed } from '../../core/variantSeed';

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

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

const startsMobile = () => window.innerWidth < 768;

function invalidMessage(side: InvalidSide): string {
  if (side === 'both') return 'Neither side is valid JSON.';
  return `The ${side} side isn't valid JSON.`;
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
  const font = usePanelFont();
  const [searchParams, setSearchParams] = useSearchParams();

  const [mode, setMode] = useState<Mode>('json');
  // JSON and text mode are separate workspaces — content never carries over
  // between them (owner requirement): a mode switch keeps each side's own
  // buffers, and invalid JSON stays in the JSON workspace rather than being
  // copied into the text panes.
  const [panes, setPanes] = useState<Record<Mode, { left: PaneState; right: PaneState }>>(() => ({
    json: { left: emptyPane('Original'), right: emptyPane('Modified') },
    text: { left: emptyPane('Original'), right: emptyPane('Modified') },
  }));
  const { left, right } = panes[mode];
  const jsonLeftText = panes.json.left.text;
  const jsonRightText = panes.json.right.text;
  const [jsonOptions, setJsonOptions] = useState<VariantJsonOptions>(DEFAULT_JSON_OPTIONS);
  const [textOptions, setTextOptions] = useState<VariantTextOptions>(DEFAULT_TEXT_OPTIONS);
  const [results, setResults] = useState<CompareResults | null>(null);
  const [textResult, setTextResult] = useState<TextCompareResult | null>(null);
  const [view, setView] = useState<'code' | 'tree'>('code');
  const [drawerOpen, setDrawerOpen] = useState(startsMobile);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [pickerSide, setPickerSide] = useState<Side | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger'; message: string } | null>(null);
  const [changeCursor, setChangeCursor] = useState(-1);
  const [pendingJump, setPendingJump] = useState<{ left: number | null; right: number | null } | null>(null);

  const leftEditorRef = useRef<JsonEditorHandle>(null);
  const rightEditorRef = useRef<JsonEditorHandle>(null);
  const textLeftRef = useRef<JsonEditorHandle>(null);
  const textRightRef = useRef<JsonEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importSideRef = useRef<Side>('left');
  // Held true while a cross-pane search reveal scrolls the opposite pane, so
  // the scroll-lock below doesn't drag both panes back to one position.
  const scrollLockSuspended = useRef(false);

  const editorRefFor = (side: Side): React.RefObject<JsonEditorHandle | null> =>
    mode === 'json'
      ? side === 'left'
        ? leftEditorRef
        : rightEditorRef
      : side === 'left'
        ? textLeftRef
        : textRightRef;

  // Owner's special condition: a find match on one side reveals the same string
  // on the other side when present, in both JSON and text modes. Pure scroll —
  // it never re-runs the diff.
  const revealAcross = (fromSide: Side, matchText: string) => {
    const otherSide: Side = fromSide === 'left' ? 'right' : 'left';
    const offset = crossPaneOffset(panes[mode][otherSide].text, matchText);
    if (offset === null) return;
    scrollLockSuspended.current = true;
    editorRefFor(otherSide).current?.revealOffset(offset);
    window.setTimeout(() => {
      scrollLockSuspended.current = false;
    }, 150);
  };

  const setPane = (side: Side, update: (pane: PaneState) => PaneState, target?: Mode) => {
    setPanes((prev) => {
      const which = target ?? mode;
      return { ...prev, [which]: { ...prev[which], [side]: update(prev[which][side]) } };
    });
  };

  const ok = (message: string) => setNotice({ kind: 'ok', message });
  const fail = (message: string) => setNotice({ kind: 'danger', message });

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

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 2400);
    return () => window.clearTimeout(id);
  }, [notice]);

  // ── shareable compare URLs: ?left=<slug>&right=<slug> ─────────────────────
  const leftParam = searchParams.get('left');
  const rightParam = searchParams.get('right');
  const leftLoadedSlug = panes.json.left.source?.slug ?? null;
  const rightLoadedSlug = panes.json.right.source?.slug ?? null;

  useEffect(() => {
    let cancelled = false;
    const load = async (side: Side, slug: string | null, loaded: string | null) => {
      if (!slug || slug === loaded) return null;
      try {
        const doc = await fetchRunestone(slug);
        if (cancelled) return null;
        if (!doc) {
          setPane(
            side,
            (pane) => ({
              ...pane,
              slugError: `No runestone answers to “${slug}” — it was never carved, or has crumbled.`,
            }),
            'json',
          );
          return null;
        }
        setPane(
          side,
          () => ({
            text: doc.content,
            label: doc.name,
            source: { slug: doc.slug, name: doc.name },
            slugError: null,
          }),
          'json',
        );
        return doc;
      } catch {
        if (!cancelled) {
          setPane(
            side,
            (pane) => ({ ...pane, slugError: 'Could not load that runestone.' }),
            'json',
          );
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
      // Acceptance 5: a URL naming both sides opens pre-loaded AND compared.
      const l = leftDoc?.content ?? (leftParam === leftLoadedSlug ? jsonLeftText : null);
      const r = rightDoc?.content ?? (rightParam === rightLoadedSlug ? jsonRightText : null);
      if (l !== null && r !== null) runCompare(l, r);
    })();
    return () => {
      cancelled = true;
    };
    // The slug params are the real dependencies; pane text is read fresh inside.
  }, [leftParam, rightParam]);

  // Loki hands raw before/after JS in through a sessionStorage text seed (the
  // slug params only carry runestones). Consume it once: fill the text panes,
  // switch to text mode, and compare.
  useEffect(() => {
    const seed = takeVariantTextSeed();
    if (!seed) return;
    setMode('text');
    setPanes((prev) => ({
      ...prev,
      text: {
        left: { ...emptyPane('Before'), text: seed.left },
        right: { ...emptyPane('After'), text: seed.right },
      },
    }));
    setTextResult(compareText(seed.left, seed.right, textOptions));
    if (startsMobile()) setDrawerOpen(true);
    // Runs once on mount; the seed clears itself when taken.
  }, []);

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

  // ── compare flow — diffing runs ONLY here, never per keystroke ────────────
  const runTextCompare = (l = panes.text.left.text, r = panes.text.right.text) => {
    setTextResult(compareText(l, r, textOptions));
    if (startsMobile()) setDrawerOpen(true);
  };

  const runCompare = (l = jsonLeftText, r = jsonRightText) => {
    const outcome = compareJson(l, r, jsonOptions);
    if (!outcome.ok) {
      // Invalid JSON stays in the JSON workspace — we flag which side is
      // broken (pane status also shows the error count) and never touch the
      // separate text workspace. The old auto-switch clobbered the user's
      // text-mode content, so it's gone (owner).
      setResults(null);
      fail(invalidMessage(outcome.invalid));
      return;
    }
    setResults({ records: outcome.records, left: l, right: r });
    setChangeCursor(-1);
    if (startsMobile()) setDrawerOpen(true);
  };

  // Owner's model: the first real edit after a compare removes the markers
  // and the results entirely — they only return on the next Compare click.
  const dropResults = () => {
    if (mode === 'json') setResults(null);
    else setTextResult(null);
    setChangeCursor(-1);
  };

  const onPaneEdit = (side: Side) => (value: string) => {
    // The editors also fire onChange for programmatic doc syncs — an
    // unchanged buffer must not clear fresh compare results.
    const current = side === 'left' ? left.text : right.text;
    if (current === value) return;
    setPane(side, (pane) => ({ ...pane, text: value, slugError: null }));
    dropResults();
  };

  const highlights = useMemo(
    () => (results ? recordsToHighlights(results.records, results.left, results.right) : null),
    [results],
  );

  // ── per-side validity (JSON workspace only — drives Compare + return) ─────
  const debouncedLeft = useDebounced(jsonLeftText, 300);
  const debouncedRight = useDebounced(jsonRightText, 300);
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

  const stats =
    mode === 'json' ? (results ? diffStats(results.records) : null) : (textResult?.stats ?? null);

  // Text-pane decorations are only honest when the buffers equal the compared
  // snapshots — destructive normalization breaks that, so the drawer carries
  // those results alone.
  const textHighlights =
    textResult && !hasActiveNormalization(textOptions) ? textResult.highlights : null;

  // ── scroll-lock the two panes (either mode) so hunks stay aligned ─────────
  useEffect(() => {
    if (mode === 'json' && view !== 'code') return;
    const a = (mode === 'json' ? leftEditorRef : textLeftRef).current?.scrollerElement();
    const b = (mode === 'json' ? rightEditorRef : textRightRef).current?.scrollerElement();
    if (!a || !b) return;
    let locked = false;
    const follow = (source: HTMLElement, target: HTMLElement) => () => {
      if (locked || scrollLockSuspended.current) return;
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
  }, [mode, view]);

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

  const jumpToChunk = (row: TextChunkRow) => {
    textLeftRef.current?.revealOffset(row.posA);
    textRightRef.current?.revealOffset(row.posB);
  };

  const stepChange = (direction: 1 | -1) => {
    if (mode === 'text') {
      if (!textResult || textResult.rows.length === 0) return;
      const next =
        (changeCursor + direction + textResult.rows.length) % textResult.rows.length;
      setChangeCursor(next);
      const row = textResult.rows[next];
      if (row) jumpToChunk(row);
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
    // Separate workspaces: each mode keeps its own buffers AND results.
    setMode(next);
  };

  const swapPanes = () => {
    setPanes((prev) => ({
      ...prev,
      [mode]: { left: prev[mode].right, right: prev[mode].left },
    }));
    if (mode === 'json') {
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
    }
    dropResults();
  };

  const formatBoth = () => {
    if (!bothValid) {
      fail('Both sides must be valid JSON to format.');
      return;
    }
    setPane('left', (pane) => ({ ...pane, text: formatJson(pane.text) }), 'json');
    setPane('right', (pane) => ({ ...pane, text: formatJson(pane.text) }), 'json');
    setResults(null);
    ok('Formatted both sides');
  };

  const sortKeysBoth = () => {
    if (!bothValid) {
      fail('Both sides must be valid JSON to sort keys.');
      return;
    }
    const sorted = (text: string) =>
      JSON.stringify(sortKeysDeep(JSON.parse(text)), null, 2);
    setPane('left', (pane) => ({ ...pane, text: sorted(pane.text) }), 'json');
    setPane('right', (pane) => ({ ...pane, text: sorted(pane.text) }), 'json');
    setResults(null);
    ok('Keys sorted A→Z on both sides');
  };

  const clearBoth = () => {
    if (!window.confirm('Clear both panes?')) return;
    setPanes((prev) => ({
      ...prev,
      [mode]: { left: emptyPane('Original'), right: emptyPane('Modified') },
    }));
    if (mode === 'json') setSearchParams({}, { replace: true });
    dropResults();
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
    if (mode === 'json') setSlugParam(side, null);
    dropResults();
    ok(`Imported ${file.name}`);
  };

  const onLibraryPick = (doc: RunestoneDoc) => {
    const side = pickerSide;
    setPickerSide(null);
    if (!side) return;
    setPane(
      side,
      () => ({
        text: doc.content,
        label: doc.name,
        source: { slug: doc.slug, name: doc.name },
        slugError: null,
      }),
      'json',
    );
    setSlugParam(side, doc.slug);
    setResults(null);
  };

  const canPickFromLibrary =
    !capabilities || capabilities.modules.includes('runestone');

  const empty = left.text.trim() === '' && right.text.trim() === '';

  // ── render helpers ────────────────────────────────────────────────────────
  const paneHeader = (side: Side, pane: PaneState) => (
    <div className="variant-pane__head">
      {/* Display-only: imports and Pensieve picks set it, users don't (owner). */}
      <span className="variant-pane__label" title={pane.label}>
        {pane.label}
      </span>
      <div className="variant-pane__actions">
        {/* Find is only present where an editor is mounted (not JSON tree view). */}
        {(mode === 'text' || view === 'code') && (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => editorRefFor(side).current?.openSearch()}
            >
              Find
            </Button>
            <UndoRedoControl editor={editorRefFor(side)} />
          </>
        )}
        <Button size="sm" variant="ghost" onClick={() => importInto(side)}>
          Import
        </Button>
        {/* Runestones are JSON documents — the picker has no business in text mode. */}
        {mode === 'json' && canPickFromLibrary && (
          <Button size="sm" variant="ghost" onClick={() => setPickerSide(side)}>
            Pensieve
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
            onSearchMatch={(text) => revealAcross(side, text)}
            height={EDITOR_HEIGHT}
            placeholder="Paste, type, import — or load from the Pensieve…"
            highlights={
              highlights ? (side === 'left' ? highlights.left : highlights.right) : undefined
            }
          />
        ) : pane.text.trim() === '' ? (
          <p className="variant-pane__treeempty caption">Nothing here yet.</p>
        ) : parsed !== undefined ? (
          <div className="variant-pane__tree">
            <TreeView
              value={parsed}
              onCopyPath={(path) => void copyPath(path)}
              onCopyValue={(value) => void copyValue(value)}
            />
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

      <Button
        onClick={() => (mode === 'json' ? runCompare() : runTextCompare())}
        disabled={empty}
      >
        Compare
      </Button>

      <Button size="sm" variant="ghost" onClick={swapPanes} disabled={empty} title="Swap sides">
        Swap ⇄
      </Button>
      {mode === 'json' && (
        <Button size="sm" variant="ghost" onClick={formatBoth} disabled={empty}>
          Format both
        </Button>
      )}
      {mode === 'json' && (
        <Button size="sm" variant="ghost" onClick={sortKeysBoth} disabled={empty}>
          Sort keys
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
      <div className="variant-rail__nav">
        <Button
          size="sm"
          variant="ghost"
          aria-label="Previous change"
          onClick={() => stepChange(-1)}
          disabled={
            mode === 'json' ? !results || results.records.length === 0 : textResult === null
          }
        >
          <ChevronLeftIcon size={14} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Next change"
          onClick={() => stepChange(1)}
          disabled={
            mode === 'json' ? !results || results.records.length === 0 : textResult === null
          }
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
                // Options changes invalidate a shown result; recompare.
                setResults(null);
              }}
              onTextChange={(next) => {
                setTextOptions(next);
                setTextResult(null);
              }}
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
      <div className="page-head variant-head">
        <div>
          <span className="eyebrow eyebrow--violet">the variant · two stones, one truth</span>
          <h2>Variant</h2>
          <p>
            Compare JSON structurally — key order and formatting are noise — or fall back to raw
            text for anything else.
          </p>
        </div>
        <PanelFontControl font={font} />
      </div>

      <div
        className="stack variant-stack panel-scope"
        style={{ '--panel-font': `${font.px}px` } as CSSProperties}
      >
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
            {/* Always-editable panes; Compare paints decorations onto them,
                and the first real edit removes them again (owner's model). */}
            <div className="variant-textedit">
              <JsonEditor
                ref={textLeftRef}
                plain
                value={left.text}
                onChange={onPaneEdit('left')}
                onSearchMatch={(text) => revealAcross('left', text)}
                height={EDITOR_HEIGHT}
                placeholder="Paste or type any text…"
                highlights={textHighlights?.left}
              />
              <JsonEditor
                ref={textRightRef}
                plain
                value={right.text}
                onChange={onPaneEdit('right')}
                onSearchMatch={(text) => revealAcross('right', text)}
                height={EDITOR_HEIGHT}
                placeholder="Paste or type any text…"
                highlights={textHighlights?.right}
              />
            </div>
          </div>
        )}

        <ResultsDrawer
          mode={mode}
          open={drawerOpen}
          onToggle={() => setDrawerOpen((open) => !open)}
          stats={stats}
          records={results?.records ?? null}
          chunks={textResult?.rows ?? null}
          onJumpRecord={jumpToRecord}
          onJumpChunk={jumpToChunk}
        />

        {notice && (
          <Toast kind={notice.kind} floating>
            {notice.message}
          </Toast>
        )}
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
