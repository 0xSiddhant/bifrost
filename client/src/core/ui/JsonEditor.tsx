import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import {
  EditorState,
  StateEffect,
  StateField,
  type Extension,
  type Text,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as cmPlaceholder,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  isolateHistory,
  redo,
  undo,
} from '@codemirror/commands';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import {
  HighlightStyle,
  bracketMatching,
  foldAll,
  foldGutter,
  foldInside,
  foldKeymap,
  foldService,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
  syntaxTree,
  unfoldAll,
} from '@codemirror/language';
import { json } from '@codemirror/lang-json';
import { markdown as markdownLang } from '@codemirror/lang-markdown';
import { javascript } from '@codemirror/lang-javascript';
import { yaml } from '@codemirror/lang-yaml';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import {
  getSearchQuery,
  openSearchPanel,
  search,
  searchKeymap,
  searchPanelOpen,
} from '@codemirror/search';
import { tags } from '@lezer/highlight';
import { validateJson } from '../json';
import { validateYaml } from '../yaml';

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

export type EditorMode = 'json' | 'markdown' | 'javascript' | 'plain' | 'yaml';

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
  /**
   * What the buffer holds. One prop rather than a boolean per language: the
   * modes are mutually exclusive by nature, and as booleans that could only be
   * said in a doc comment — nothing stopped `markdown` and `javascript` both
   * being passed, and the resolution order silently picked a winner.
   *
   * - `json` (default, Runestone/Variant) — lint + fold + bracket pairing
   * - `markdown` (Edda) — lang-markdown tinting via `--syn-*`, no lint/fold
   * - `javascript` (Loki) — lang-javascript tinting, bracket pairing, folding
   * - `yaml` (Groot) — lang-yaml tinting, lint + fold, two-space indent
   * - `plain` (Variant's text panes) — nothing at all; typing costs nothing
   */
  mode?: EditorMode;
  /**
   * Fires when the in-editor find widget lands on a match (the matched text).
   * Variant uses it to reveal the same string in the opposite pane.
   */
  onSearchMatch?: (matchText: string) => void;
}

export interface JsonEditorHandle {
  foldAll(): void;
  unfoldAll(): void;
  /** Open the in-editor find panel (a discoverable button; ⌘/Ctrl-F also works). */
  openSearch(): void;
  /** Undo the last change (a discoverable button; ⌘/Ctrl-Z also works). */
  undo(): void;
  /** Redo the last undone change (⌘/Ctrl-Shift-Z / Ctrl-Y also work). */
  redo(): void;
  /**
   * Apply a pure selection edit (Edda's markdown toolbar/shortcuts): `next`
   * receives the current doc + selection and returns the replacement doc +
   * selection. The editor commits it as a minimal change so undo stays one step
   * and large documents don't re-flow the whole buffer.
   */
  applyEdit(next: (current: { doc: string; from: number; to: number }) => {
    doc: string;
    from: number;
    to: number;
  }): void;
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

/** Markdown token colors (Edda) — every value is a theme token, no hex here. */
const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--syn-key)', fontWeight: '600' },
  { tag: tags.strong, fontWeight: '700', color: 'var(--text)' },
  { tag: tags.emphasis, fontStyle: 'italic', color: 'var(--text)' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--syn-string)' },
  { tag: tags.url, color: 'var(--syn-string)', textDecoration: 'underline' },
  { tag: tags.monospace, color: 'var(--syn-number)' },
  { tag: tags.quote, color: 'var(--text-muted)', fontStyle: 'italic' },
  { tag: tags.list, color: 'var(--syn-punct)' },
  { tag: tags.processingInstruction, color: 'var(--syn-punct)' },
  { tag: tags.contentSeparator, color: 'var(--syn-punct)' },
]);

/** JavaScript token colors (Loki) — every value is a theme token, no hex here. */
const jsHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--syn-key)' },
  { tag: tags.controlKeyword, color: 'var(--syn-key)' },
  { tag: tags.definitionKeyword, color: 'var(--syn-key)' },
  { tag: tags.moduleKeyword, color: 'var(--syn-key)' },
  { tag: tags.operatorKeyword, color: 'var(--syn-key)' },
  { tag: tags.string, color: 'var(--syn-string)' },
  { tag: tags.special(tags.string), color: 'var(--syn-string)' },
  { tag: tags.regexp, color: 'var(--syn-number)' },
  { tag: tags.number, color: 'var(--syn-number)' },
  { tag: tags.bool, color: 'var(--syn-bool)' },
  { tag: tags.null, color: 'var(--syn-null)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--syn-null)', fontStyle: 'italic' },
  { tag: tags.propertyName, color: 'var(--syn-key)' },
  { tag: tags.function(tags.variableName), color: 'var(--syn-string)' },
  { tag: tags.variableName, color: 'var(--text)' },
  { tag: tags.typeName, color: 'var(--syn-bool)' },
  { tag: [tags.punctuation, tags.bracket, tags.separator, tags.operator], color: 'var(--syn-punct)' },
  { tag: tags.invalid, color: 'var(--danger)' },
]);

/** YAML token colors (Groot) — every value is a theme token, no hex here. */
const yamlHighlight = HighlightStyle.define([
  // In YAML a mapping key is the structure, so it takes the key colour that
  // JSON's property names take — the two editors read the same at a glance.
  { tag: tags.definition(tags.propertyName), color: 'var(--syn-key)' },
  { tag: tags.propertyName, color: 'var(--syn-key)' },
  { tag: tags.atom, color: 'var(--syn-bool)' },
  { tag: tags.bool, color: 'var(--syn-bool)' },
  { tag: tags.null, color: 'var(--syn-null)' },
  { tag: tags.number, color: 'var(--syn-number)' },
  { tag: tags.string, color: 'var(--syn-string)' },
  { tag: tags.special(tags.string), color: 'var(--syn-string)' },
  { tag: tags.comment, color: 'var(--syn-null)', fontStyle: 'italic' },
  // Anchors and aliases are references, not values — the type colour keeps
  // them visibly distinct from the string beside them.
  { tag: tags.labelName, color: 'var(--syn-bool)' },
  { tag: tags.typeName, color: 'var(--syn-bool)' },
  { tag: tags.meta, color: 'var(--syn-punct)' },
  { tag: [tags.punctuation, tags.bracket, tags.separator, tags.operator], color: 'var(--syn-punct)' },
  { tag: tags.contentSeparator, color: 'var(--syn-punct)' },
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
    // In-editor find widget — theme tokens so a theme switch recolors it live.
    // CM's inputs carry class .cm-textfield (no type=text attr), so target that.
    '.cm-panel.cm-search': {
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: '6px 8px',
      padding: '8px 10px',
      fontFamily: 'var(--font-mono)',
    },
    '.cm-panel.cm-search .cm-textfield': {
      background: 'var(--surface)',
      color: 'var(--text)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)',
      padding: '4px 8px',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-sm)',
    },
    '.cm-panel.cm-search .cm-textfield:focus': {
      outline: 'none',
      borderColor: 'var(--accent)',
      boxShadow: '0 0 0 2px var(--accent-soft)',
    },
    '.cm-panel.cm-search .cm-textfield::placeholder': { color: 'var(--text-muted)' },
    // "N of M" match counter injected by searchMatchCount.
    '.cm-panel.cm-search .cm-search-count': {
      color: 'var(--text-muted)',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      alignSelf: 'center',
      whiteSpace: 'nowrap',
      marginRight: '2px',
    },
    '.cm-panel.cm-search .cm-button': {
      background: 'var(--surface)',
      backgroundImage: 'none',
      color: 'var(--text)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)',
      padding: '3px 10px',
      fontSize: 'var(--text-sm)',
      cursor: 'pointer',
    },
    '.cm-panel.cm-search .cm-button:hover': {
      background: 'var(--surface-2)',
      borderColor: 'var(--accent)',
    },
    '.cm-panel.cm-search label': {
      color: 'var(--text-muted)',
      fontSize: 'var(--text-sm)',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
    },
    '.cm-panel.cm-search input[type=checkbox]': { accentColor: 'var(--accent)' },
    '.cm-panel.cm-search [name=close]': {
      color: 'var(--text-muted)',
      background: 'transparent',
      border: 'none',
      cursor: 'pointer',
      fontSize: '18px',
      lineHeight: '1',
    },
    '.cm-panel.cm-search [name=close]:hover': { color: 'var(--text)' },
    '.cm-searchMatch': {
      backgroundColor: 'var(--accent-soft)',
      outline: '1px solid var(--accent)',
      borderRadius: '2px',
    },
    '.cm-searchMatch-selected': { backgroundColor: 'var(--accent)', color: 'var(--bg)' },
  });

/**
 * A "current of total" counter for the find panel (every consumer inherits it:
 * Runestone / Variant JSON+text / Loki / Edda). CM6's default search panel has
 * no match count, so this plugin injects a small label into the panel DOM and
 * keeps it in sync as the query, selection, or document changes.
 */
const MATCH_COUNT_CAP = 1000;

const searchMatchCount = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      this.render(view);
    }

    update(update: ViewUpdate): void {
      // The query lives in editor state (setSearchQuery is a transaction), so a
      // doc edit, selection move, or any transaction can change the count.
      if (update.docChanged || update.selectionSet || update.transactions.length > 0) {
        this.render(update.view);
      }
    }

    render(view: EditorView): void {
      const panel = view.dom.querySelector('.cm-panel.cm-search');
      if (!panel) return;
      let label = panel.querySelector<HTMLElement>('.cm-search-count');
      if (!searchPanelOpen(view.state)) {
        label?.remove();
        return;
      }
      if (!label) {
        label = document.createElement('span');
        label.className = 'cm-search-count';
        const field = panel.querySelector('.cm-textfield');
        if (field) field.insertAdjacentElement('afterend', label);
        else panel.appendChild(label);
      }
      const query = getSearchQuery(view.state);
      if (!query.valid || query.search.length === 0) {
        label.textContent = '';
        return;
      }
      const sel = view.state.selection.main;
      let count = 0;
      let current = 0;
      let capped = false;
      try {
        const cursor = query.getCursor(view.state) as Iterator<{ from: number; to: number }>;
        for (let next = cursor.next(); !next.done; next = cursor.next()) {
          count += 1;
          if (next.value.from === sel.from && next.value.to === sel.to) current = count;
          if (count >= MATCH_COUNT_CAP) {
            capped = true;
            break;
          }
        }
      } catch {
        label.textContent = '';
        return;
      }
      const total = capped ? `${MATCH_COUNT_CAP}+` : String(count);
      label.textContent =
        count === 0 ? 'No results' : current > 0 ? `${current} of ${total}` : `${total} found`;
    }
  },
);

/**
 * Parameter-position nodes lang-javascript's `foldNodeProp` does not cover: it
 * folds `ObjectExpression` (a value) but not `ObjectPattern` (a destructuring
 * target), so the very common
 *
 *     function make({
 *       color, radius, elevation,
 *     }) {
 *
 * offered no fold arrow at all — the signature stayed expanded while the body
 * collapsed. `ParamList` covers the same shape without destructuring.
 *
 * `ArgList` is deliberately **excluded**. Call arguments overlap the callback
 * idiom `app.get('/x', function () {`, where the line already folds the
 * callback's `Block`; folding the argument list instead would silently change
 * long-standing behaviour for a case nobody asked about.
 */
const FOLDABLE_PARAM_NODES = new Set(['ObjectPattern', 'ArrayPattern', 'ParamList']);

/**
 * `foldService` is consulted before the grammar's own `foldNodeProp`, and a
 * `null` falls through to it — so this adds parameter folding without
 * disturbing any existing fold (blocks, objects, arrays, comments).
 */
const paramFolding = foldService.of((state, lineStart, lineEnd) => {
  const tree = syntaxTree(state);
  if (tree.length < lineEnd) return null;
  let found: { from: number; to: number } | null = null;
  tree.iterate({
    from: lineStart,
    to: lineEnd,
    enter(node) {
      // Only a construct that *opens* on this line gets this line's arrow;
      // otherwise the closing `}) {` line would steal the body's fold.
      if (node.from < lineStart || node.from > lineEnd) return;
      if (!FOLDABLE_PARAM_NODES.has(node.name)) return;
      const range = foldInside(node.node);
      if (!range) return;
      // Nothing to gain from folding something that already fits on one line.
      if (state.doc.lineAt(range.from).number === state.doc.lineAt(range.to).number) return;
      // Keep descending: the innermost match wins, so a destructured parameter
      // folds as `({…})` — braces kept as a cue — rather than the whole `(…)`.
      found = range;
    },
  });
  return found;
});

/**
 * JavaScript mode (Loki). Exported so the fold test can assert against the real
 * editor configuration rather than a hand-rolled copy of it.
 *
 * Folding comes from lang-javascript's `foldNodeProp`, which covers `Block`,
 * `ClassBody`, `SwitchBody`, `ObjectExpression`, `ArrayExpression` and
 * `BlockComment` — so one gutter folds function bodies, objects, arrays, nested
 * blocks and IIFEs alike. The ranges come from the syntax tree, not from
 * indentation, so a fold survives reformatting and nesting depth.
 */
export function javascriptModeExtensions(): Extension[] {
  return [
    foldGutter(),
    paramFolding,
    indentOnInput(),
    indentUnit.of('  '),
    bracketMatching(),
    closeBrackets(),
    javascript(),
    syntaxHighlighting(jsHighlight),
  ];
}

/** JSON mode (Runestone, Variant's JSON panes) — the default. */
export function jsonModeExtensions(): Extension[] {
  return [
    foldGutter(),
    indentOnInput(),
    indentUnit.of('  '),
    bracketMatching(),
    // Typing {[" inserts the closing pair; backspacing an empty pair removes
    // both (closeBracketsKeymap precedes defaultKeymap).
    closeBrackets(),
    json(),
    syntaxHighlighting(jsonHighlight),
    linter(jsonDiagnostics, { delay: 300 }),
    lintGutter(),
  ];
}

/** Markdown mode (Edda) — tinting only; no lint, fold or bracket pairing. */
export function markdownModeExtensions(): Extension[] {
  return [markdownLang(), syntaxHighlighting(markdownHighlight)];
}

/**
 * YAML mode (Groot). Exported so the fold test can assert against the real
 * editor configuration rather than a hand-rolled copy of it.
 *
 * Folding comes from lang-yaml's own `foldNodeProp`, which covers `Pair`,
 * `Item` and `BlockLiteral` in block style (folding from the end of the first
 * line to the node's end) and `FlowMapping`/`FlowSequence` in flow style. **No
 * custom `foldService` is needed** — Loki needed one because lang-javascript
 * genuinely omits `ObjectPattern`, and the temptation is to assume every
 * language has an equivalent gap. This one does not; a single-line `name: foo`
 * yields `from >= to` and correctly offers no arrow.
 *
 * `indentUnit.of('  ')` is load-bearing rather than cosmetic. A tab character
 * in YAML indentation is a **hard syntax error**, and the editor binds
 * `indentWithTab` for every mode — which is `{ key: 'Tab', run: indentMore }`,
 * and `indentMore` inserts whatever this facet says. Set it to a tab and the
 * Tab key would produce documents that cannot parse; `yamlFold.test.ts` pins
 * both halves of that.
 */
export function yamlModeExtensions(): Extension[] {
  return [
    foldGutter(),
    indentOnInput(),
    indentUnit.of('  '),
    bracketMatching(),
    closeBrackets(),
    yaml(),
    syntaxHighlighting(yamlHighlight),
    linter(yamlDiagnostics, { delay: 300 }),
    lintGutter(),
  ];
}


/**
 * One table per mode, replacing the nested ternary the boolean props needed.
 * A new language adds a row here and a member to `EditorMode`; the component
 * body does not change, and `Record` makes a forgotten row a type error rather
 * than a silent fall-through to JSON.
 */
const MODE_EXTENSIONS: Record<EditorMode, () => Extension[]> = {
  json: jsonModeExtensions,
  markdown: markdownModeExtensions,
  javascript: javascriptModeExtensions,
  yaml: yamlModeExtensions,
  // Variant's text panes: no parsing, linting, folding, highlighting or
  // bracket pairing, so typing in a large buffer costs nothing.
  plain: () => [],
};

const CLOSE_BRACKET_MODES: ReadonlySet<EditorMode> = new Set(['json', 'javascript', 'yaml']);
const FOLD_MODES: ReadonlySet<EditorMode> = new Set(['json', 'javascript', 'yaml']);

/** YAML syntax errors as CM diagnostics, from the shared `core/yaml` validator. */
function yamlDiagnostics(view: EditorView): Diagnostic[] {
  const text = view.state.doc.toString();
  if (text.trim() === '') return [];
  return validateYaml(text).map((issue) => ({
    from: Math.min(issue.offset, text.length),
    to: Math.min(issue.offset + issue.length, text.length),
    severity: 'error',
    message: issue.message,
  }));
}

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
  {
    value,
    onChange,
    onCursor,
    readOnly = false,
    height = '60vh',
    placeholder,
    highlights,
    mode = 'json',
    onSearchMatch,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Callbacks live in refs so the view survives parent re-renders untouched.
  const onChangeRef = useRef(onChange);
  const onCursorRef = useRef(onCursor);
  const onSearchMatchRef = useRef(onSearchMatch);
  const highlightsRef = useRef(highlights);
  onChangeRef.current = onChange;
  onCursorRef.current = onCursor;
  onSearchMatchRef.current = onSearchMatch;

  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;

    const modeExtensions = MODE_EXTENSIONS[mode]();
    // Bracket auto-close and folding both apply to JSON and JS; markdown and
    // plain get neither.
    const closeBracketsMode = CLOSE_BRACKET_MODES.has(mode);
    const foldMode = FOLD_MODES.has(mode);
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        ...modeExtensions,
        diffHighlightField,
        // In-editor find for every consumer (Runestone / Variant / Edda). The
        // browser's own find can't reach text in a large scrolled buffer; this
        // can. Works in every mode alike. The count plugin adds "N of M".
        search({ top: true }),
        searchMatchCount,
        keymap.of([
          ...searchKeymap,
          ...(closeBracketsMode ? closeBracketsKeymap : []),
          ...defaultKeymap,
          ...historyKeymap,
          ...(foldMode ? foldKeymap : []),
          indentWithTab,
        ]),
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
          // A find navigation moves the selection onto the match. When the
          // panel is open and the selection equals the query, report the
          // matched text (Variant reveals it in the opposite pane).
          if (onSearchMatchRef.current && (update.selectionSet || update.docChanged)) {
            const sel = update.state.selection.main;
            if (!sel.empty && searchPanelOpen(update.state)) {
              const query = getSearchQuery(update.state);
              if (query.valid) {
                const selected = update.state.sliceDoc(sel.from, sel.to);
                const isMatch = query.regexp
                  ? true
                  : query.caseSensitive
                    ? selected === query.search
                    : selected.toLowerCase() === query.search.toLowerCase();
                if (isMatch) onSearchMatchRef.current(selected);
              }
            }
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
  }, [readOnly, height, placeholder, mode]);

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
    openSearch() {
      const view = viewRef.current;
      if (!view) return;
      openSearchPanel(view);
      view.focus();
    },
    undo() {
      const view = viewRef.current;
      if (!view) return;
      undo(view);
      view.focus();
    },
    redo() {
      const view = viewRef.current;
      if (!view) return;
      redo(view);
      view.focus();
    },
    applyEdit(next) {
      const view = viewRef.current;
      if (!view) return;
      const doc = view.state.doc.toString();
      const sel = view.state.selection.main;
      const result = next({ doc, from: sel.from, to: sel.to });
      // Minimal change: shrink to the differing middle so undo is one step and
      // a huge document isn't wholesale-replaced on a single toolbar click.
      let start = 0;
      const maxStart = Math.min(doc.length, result.doc.length);
      while (start < maxStart && doc[start] === result.doc[start]) start += 1;
      let endOld = doc.length;
      let endNew = result.doc.length;
      while (endOld > start && endNew > start && doc[endOld - 1] === result.doc[endNew - 1]) {
        endOld -= 1;
        endNew -= 1;
      }
      view.dispatch({
        changes: { from: start, to: endOld, insert: result.doc.slice(start, endNew) },
        selection: { anchor: result.from, head: result.to },
        scrollIntoView: true,
        // Isolate each programmatic edit as its own undo group, so a transform
        // never merges with the typing before it — one transform, one ⌘Z.
        annotations: isolateHistory.of('full'),
      });
      view.focus();
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
