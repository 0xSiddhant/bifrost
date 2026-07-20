import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState, StateEffect, StateField, type Text } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as cmPlaceholder,
  type DecorationSet,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  HighlightStyle,
  bracketMatching,
  foldAll,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
  unfoldAll,
} from '@codemirror/language';
import { json } from '@codemirror/lang-json';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { tags } from '@lezer/highlight';
import { validateJson } from '../json';

/**
 * Reusable CodeMirror 6 JSON editor (PLAN-07). Runestone mounts one; PLAN-08's
 * diff checker mounts two — hence core/ui, not a feature folder. All colors
 * come from theme tokens (--syn-* and friends), so a theme switch recolors the
 * open editor with no re-render.
 */

/**
 * A diff decoration to paint (Variant PLAN-08): `line` tints every line the
 * range touches, `char` marks the exact span for character-level emphasis.
 */
export interface DiffHighlight {
  from: number;
  to: number;
  kind: 'add' | 'remove' | 'change';
  level: 'line' | 'char';
}

export interface JsonEditorProps {
  value: string;
  onChange?: (value: string) => void;
  /** Fires on selection movement with the primary cursor's doc offset. */
  onCursor?: (offset: number) => void;
  readOnly?: boolean;
  /** CSS height of the editor box (it scrolls internally). */
  height?: string;
  placeholder?: string;
  /** Diff decorations bound to the --diff-* theme tokens. */
  highlights?: DiffHighlight[];
}

export interface JsonEditorHandle {
  foldAll(): void;
  unfoldAll(): void;
  /** Move the cursor to a doc offset, scroll it into view, and focus. */
  gotoOffset(offset: number): void;
  /** Scroll a doc offset into view without stealing focus (pane sync jumps). */
  revealOffset(offset: number): void;
  /** The editor's scrolling element — Variant scroll-locks two panes with it. */
  scrollerElement(): HTMLElement | null;
  focus(): void;
}

const setDiffHighlights = StateEffect.define<DiffHighlight[]>();

function buildDiffDecorations(doc: Text, highlights: DiffHighlight[]): DecorationSet {
  const ranges = [];
  const seenLines = new Map<string, Set<number>>();
  for (const h of highlights) {
    const from = Math.max(0, Math.min(h.from, doc.length));
    const to = Math.min(Math.max(h.to, from), doc.length);
    if (h.level === 'char') {
      if (to > from) {
        ranges.push(Decoration.mark({ class: `cm-diffchar-${h.kind}` }).range(from, to));
      }
      continue;
    }
    const painted = seenLines.get(h.kind) ?? new Set<number>();
    seenLines.set(h.kind, painted);
    let line = doc.lineAt(from);
    for (;;) {
      if (!painted.has(line.from)) {
        painted.add(line.from);
        ranges.push(Decoration.line({ class: `cm-diffline-${h.kind}` }).range(line.from));
      }
      if (line.to >= to || line.to >= doc.length) break;
      line = doc.lineAt(line.to + 1);
    }
  }
  return Decoration.set(ranges, true);
}

/** Diff decorations survive edits by mapping until the next compare replaces them. */
const diffHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setDiffHighlights)) deco = buildDiffDecorations(tr.state.doc, effect.value);
    }
    return deco;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** JSON token colors — every value is a theme token (coding rule: no hex here). */
const jsonHighlight = HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--syn-key)' },
  { tag: tags.string, color: 'var(--syn-string)' },
  { tag: tags.number, color: 'var(--syn-number)' },
  { tag: tags.bool, color: 'var(--syn-bool)' },
  { tag: tags.null, color: 'var(--syn-null)' },
  { tag: tags.punctuation, color: 'var(--syn-punct)' },
  { tag: tags.bracket, color: 'var(--syn-punct)' },
  { tag: tags.separator, color: 'var(--syn-punct)' },
  { tag: tags.invalid, color: 'var(--danger)' },
]);

/** Shared editor chrome — Variant's text-mode merge panes reuse it. */
export const editorChrome = (height: string) =>
  EditorView.theme({
    '&': {
      height,
      backgroundColor: 'transparent',
      color: 'var(--text)',
      fontSize: 'var(--text-sm)',
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-mono)',
      lineHeight: '1.55',
      overflow: 'auto',
    },
    '.cm-content': { caretColor: 'var(--accent)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-cursor': { borderLeftColor: 'var(--accent)' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
      {
        background: 'var(--accent-soft)',
      },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '&.cm-focused .cm-activeLine': { backgroundColor: 'var(--accent-soft)' },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: 'var(--text-muted)',
      border: 'none',
      borderRight: '1px solid var(--border)',
    },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text)' },
    '.cm-foldGutter .cm-gutterElement': { cursor: 'pointer' },
    '.cm-foldPlaceholder': {
      background: 'var(--accent-soft)',
      border: '1px solid var(--border)',
      color: 'var(--text-muted)',
    },
    '.cm-matchingBracket': { outline: '1px solid var(--accent)', background: 'transparent' },
    '.cm-lintRange-error': { textDecorationColor: 'var(--danger)' },
    '.cm-lint-marker-error': { color: 'var(--danger)' },
    // Diff decorations (Variant) + @codemirror/merge chunk classes — theme
    // tokens only, so a theme switch recolors an open compare instantly.
    '.cm-diffline-add': { backgroundColor: 'var(--diff-add-soft)' },
    '.cm-diffline-remove': { backgroundColor: 'var(--diff-remove-soft)' },
    '.cm-diffline-change': { backgroundColor: 'var(--diff-change-soft)' },
    '.cm-diffchar-add': {
      backgroundColor: 'var(--diff-add-soft)',
      boxShadow: 'inset 0 -2px 0 var(--diff-add)',
    },
    '.cm-diffchar-remove': {
      backgroundColor: 'var(--diff-remove-soft)',
      boxShadow: 'inset 0 -2px 0 var(--diff-remove)',
    },
    '.cm-diffchar-change': {
      backgroundColor: 'var(--diff-change-soft)',
      boxShadow: 'inset 0 -2px 0 var(--diff-change)',
    },
    '.cm-changedLine': { backgroundColor: 'var(--diff-change-soft)' },
    '.cm-changedText': {
      background: 'var(--diff-add-soft)',
      boxShadow: 'inset 0 -2px 0 var(--diff-add)',
    },
    '.cm-deletedChunk': { backgroundColor: 'var(--diff-remove-soft)' },
    '.cm-deletedChunk .cm-deletedText, .cm-deletedText': {
      background: 'transparent',
      textDecoration: 'line-through',
      textDecorationColor: 'var(--diff-remove)',
    },
    '.cm-insertedLine': { backgroundColor: 'var(--diff-add-soft)' },
    '.cm-tooltip': {
      background: 'var(--surface-2)',
      color: 'var(--text)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)',
    },
    '.cm-panels': { background: 'var(--surface-2)', color: 'var(--text)' },
  });

/** All strict-JSON errors as CM diagnostics; an empty doc is "empty", not broken. */
function jsonDiagnostics(view: EditorView): Diagnostic[] {
  const text = view.state.doc.toString();
  if (text.trim() === '') return [];
  return validateJson(text).map((issue) => ({
    from: Math.min(issue.offset, text.length),
    to: Math.min(issue.offset + issue.length, text.length),
    severity: 'error',
    message: issue.message,
  }));
}

export const JsonEditor = forwardRef<JsonEditorHandle, JsonEditorProps>(function JsonEditor(
  { value, onChange, onCursor, readOnly = false, height = '60vh', placeholder, highlights },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Callbacks live in refs so the view survives parent re-renders untouched.
  const onChangeRef = useRef(onChange);
  const onCursorRef = useRef(onCursor);
  const highlightsRef = useRef(highlights);
  onChangeRef.current = onChange;
  onCursorRef.current = onCursor;

  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        history(),
        foldGutter(),
        drawSelection(),
        indentOnInput(),
        indentUnit.of('  '),
        bracketMatching(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        json(),
        syntaxHighlighting(jsonHighlight),
        linter(jsonDiagnostics, { delay: 300 }),
        lintGutter(),
        diffHighlightField,
        keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
        ...(placeholder ? [cmPlaceholder(placeholder)] : []),
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        editorChrome(height),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current?.(update.state.doc.toString());
          }
          const head = update.state.selection.main.head;
          if (update.docChanged || head !== update.startState.selection.main.head) {
            onCursorRef.current?.(head);
          }
        }),
      ],
    });
    const view = new EditorView({ state, parent });
    viewRef.current = view;
    if (highlightsRef.current && highlightsRef.current.length > 0) {
      view.dispatch({ effects: setDiffHighlights.of(highlightsRef.current) });
    }
    return () => {
      viewRef.current = null;
      view.destroy();
    };
    // The view is created once per structural prop change; `value` flows
    // through the sync effect below instead of re-creating the editor.
  }, [readOnly, height, placeholder]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    highlightsRef.current = highlights;
    viewRef.current?.dispatch({ effects: setDiffHighlights.of(highlights ?? []) });
  }, [highlights]);

  useImperativeHandle(ref, () => ({
    foldAll() {
      const view = viewRef.current;
      if (view) foldAll(view);
    },
    unfoldAll() {
      const view = viewRef.current;
      if (view) unfoldAll(view);
    },
    gotoOffset(offset: number) {
      const view = viewRef.current;
      if (!view) return;
      const at = Math.min(offset, view.state.doc.length);
      view.dispatch({
        selection: { anchor: at },
        scrollIntoView: true,
      });
      view.focus();
    },
    revealOffset(offset: number) {
      const view = viewRef.current;
      if (!view) return;
      const at = Math.min(offset, view.state.doc.length);
      view.dispatch({ effects: EditorView.scrollIntoView(at, { y: 'center' }) });
    },
    scrollerElement() {
      return viewRef.current?.scrollDOM ?? null;
    },
    focus() {
      viewRef.current?.focus();
    },
  }));

  return <div className="json-editor" ref={containerRef} />;
});
