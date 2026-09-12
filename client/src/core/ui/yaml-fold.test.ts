// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { foldable, indentUnit } from '@codemirror/language';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { yamlModeExtensions } from './JsonEditor';

/**
 * Groot's editor folds YAML through lang-yaml's own `foldNodeProp` — no custom
 * `foldService`, unlike Loki. These assertions pin that claim against the real
 * extension list, so a lang-yaml upgrade that dropped a node type fails here
 * rather than quietly costing the gutter its arrows.
 *
 * `foldable(state, lineStart, lineEnd)` is what the fold gutter itself calls,
 * so this exercises the real path with no DOM.
 */

const stateFor = (doc: string): EditorState =>
  EditorState.create({ doc, extensions: yamlModeExtensions() });

function foldOnLineWith(doc: string, marker: string): { from: number; to: number } | null {
  const state = stateFor(doc);
  const at = doc.indexOf(marker);
  expect(at, `marker ${marker} not found in fixture`).toBeGreaterThanOrEqual(0);
  const line = state.doc.lineAt(at);
  return foldable(state, line.from, line.to);
}

function foldedText(doc: string, marker: string): string {
  const range = foldOnLineWith(doc, marker);
  expect(range, `expected a fold range on the line with ${marker}`).not.toBeNull();
  return doc.slice(range!.from, range!.to);
}

/** A shape a person actually opens in this editor. */
const manifest = [
  'apiVersion: apps/v1',
  'kind: Deployment',
  'metadata:',
  '  name: bifrost',
  '  labels:',
  '    app: bifrost',
  'spec:',
  '  replicas: 2',
  '  template:',
  '    spec:',
  '      containers:',
  '        - name: server',
  '          image: bifrost:1.3.0',
  '          ports:',
  '            - containerPort: 4646',
  '        - name: sidecar',
  '          image: busybox:latest',
  '  notes: |',
  '    first line',
  '    second line',
].join('\n');

describe('yaml folding', () => {
  it('folds a block mapping under its key', () => {
    const hidden = foldedText(manifest, 'metadata:');
    expect(hidden).toContain('name: bifrost');
    expect(hidden).toContain('app: bifrost');
    expect(hidden).not.toContain('apiVersion');
  });

  it('folds a nested mapping less than its parent', () => {
    const outer = foldedText(manifest, 'spec:\n  replicas');
    const inner = foldedText(manifest, '  template:');
    expect(outer).toContain('containerPort: 4646');
    expect(inner.length).toBeLessThan(outer.length);
    expect(inner).not.toContain('replicas: 2');
  });

  it('folds one sequence entry on its own', () => {
    const hidden = foldedText(manifest, '- name: server');
    expect(hidden).toContain('image: bifrost:1.3.0');
    // The next entry belongs to a different fold.
    expect(hidden).not.toContain('sidecar');
  });

  it('folds a block literal', () => {
    const hidden = foldedText(manifest, 'notes: |');
    expect(hidden).toContain('first line');
    expect(hidden).toContain('second line');
  });

  it('folds a flow mapping and a flow sequence', () => {
    const flowMap = ['conf: {', '  a: 1,', '  b: 2,', '}'].join('\n');
    expect(foldedText(flowMap, 'conf: {')).toContain('a: 1');

    const flowSeq = ['xs: [', '  1,', '  2,', ']'].join('\n');
    expect(foldedText(flowSeq, 'xs: [')).toContain('1,');
  });

  it('offers no arrow on a single-line pair', () => {
    // `from >= to` for a pair that ends on its own line, so the gutter is bare —
    // which is the behaviour that makes a custom foldService unnecessary.
    expect(foldOnLineWith('name: foo\nother: bar\n', 'name: foo')).toBeNull();
  });

  it('offers no arrow on a single-line sequence entry', () => {
    expect(foldOnLineWith('xs:\n  - one\n  - two\n', '- one')).toBeNull();
  });
});

describe('yaml indentation', () => {
  it('pins the indent unit to two spaces', () => {
    expect(stateFor('a: 1\n').facet(indentUnit)).toBe('  ');
  });

  it('inserts spaces when Tab is pressed, never a tab character', () => {
    // A literal tab in YAML indentation is a hard syntax error, so this is the
    // single easiest way for this editor to produce a file that will not parse.
    // Driven through `runScopeHandlers` — the same dispatch the real keydown
    // takes — because the defect this guards against lives in the keymap, not in
    // any one command: `defaultKeymap` binds Tab to `insertTab`, which inserts a
    // literal "\t" on an empty selection.
    const view = new EditorView({
      state: EditorState.create({ doc: 'root:\n\n', extensions: yamlModeExtensions() }),
    });
    try {
      view.dispatch({ selection: { anchor: view.state.doc.line(2).from } });
      const handled = runScopeHandlers(
        view,
        new KeyboardEvent('keydown', { key: 'Tab', keyCode: 9 }),
        'editor',
      );
      expect(handled).toBe(true);
      expect(view.state.doc.toString()).not.toContain('\t');
      expect(view.state.doc.line(2).text).toBe('  ');
    } finally {
      view.destroy();
    }
  });

  it('un-indents on Shift-Tab rather than leaving the line stranded', () => {
    const view = new EditorView({
      state: EditorState.create({ doc: 'root:\n    deep: 1\n', extensions: yamlModeExtensions() }),
    });
    try {
      view.dispatch({ selection: { anchor: view.state.doc.line(2).from + 4 } });
      runScopeHandlers(
        view,
        new KeyboardEvent('keydown', { key: 'Tab', keyCode: 9, shiftKey: true }),
        'editor',
      );
      expect(view.state.doc.line(2).text).toBe('  deep: 1');
    } finally {
      view.destroy();
    }
  });
});
