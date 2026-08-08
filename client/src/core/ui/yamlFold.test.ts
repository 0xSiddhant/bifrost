// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { foldable, indentUnit } from '@codemirror/language';
import { indentWithTab } from '@codemirror/commands';
import { EditorView, keymap } from '@codemirror/view';
import { yamlModeExtensions } from './JsonEditor';

/**
 * Groot's editor folds YAML through lang-yaml's own `foldNodeProp` — no custom
 * `foldService`, unlike Loki. These assertions pin the constructs a manifest
 * actually uses, so a lang-yaml upgrade that dropped one fails here instead of
 * the gutter quietly losing its arrows.
 *
 * `foldable(state, lineStart, lineEnd)` is exactly what the fold gutter calls,
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
  return doc.slice(range?.from ?? 0, range?.to ?? 0);
}

/** A cut-down but realistic Kubernetes manifest — criterion 1's shape. */
const MANIFEST = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: bifrost
  labels:
    app: bifrost
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: server
          image: bifrost:1.3.0
          ports:
            - containerPort: 4646
        - name: sidecar
          image: busybox
      script: |
        echo one
        echo two
`;

describe('yaml folding', () => {
  it('folds a mapping pair and everything nested under it', () => {
    const hidden = foldedText(MANIFEST, 'spec:\n  replicas');
    expect(hidden).toContain('replicas: 2');
    expect(hidden).toContain('containerPort: 4646');
  });

  it('folds a nested pair without taking its siblings', () => {
    const hidden = foldedText(MANIFEST, 'metadata:');
    expect(hidden).toContain('name: bifrost');
    expect(hidden).toContain('app: bifrost');
    expect(hidden).not.toContain('replicas');
  });

  it('folds an individual sequence item', () => {
    const hidden = foldedText(MANIFEST, '- name: server');
    expect(hidden).toContain('image: bifrost:1.3.0');
    // The next list entry is a separate fold, not part of this one.
    expect(hidden).not.toContain('sidecar');
  });

  it('folds a block literal', () => {
    const hidden = foldedText(MANIFEST, 'script: |');
    expect(hidden).toContain('echo one');
    expect(hidden).toContain('echo two');
  });

  // The counterpart assertion: a fold arrow where nothing can be folded is
  // worse than none, because every single-line key would grow one.
  it('offers no fold on a single-line pair', () => {
    expect(foldOnLineWith('name: foo\nother: bar\n', 'name: foo')).toBeNull();
  });

  it('offers no fold on a blank line or a comment', () => {
    expect(foldOnLineWith('a: 1\n\n# just a note\nb: 2\n', '# just a note')).toBeNull();
  });

  it('folds flow collections too', () => {
    const doc = 'conf: {\n  host: localhost,\n  port: 4646\n}\n';
    expect(foldedText(doc, 'conf: {')).toContain('port: 4646');
  });
});

/**
 * Criterion 4: pressing Tab must never put a literal tab in the document,
 * because a tab in YAML indentation is a hard syntax error — the single easiest
 * way for this editor to produce a file that will not parse.
 *
 * The mechanism is narrower than it looks, and worth writing down because
 * PLAN-19 named the wrong command for it. The editor binds `indentWithTab`,
 * which is `{ key: 'Tab', run: indentMore }` — **not** `insertTab`. `indentMore`
 * inserts whatever the `indentUnit` facet holds, so `indentUnit.of('  ')` is
 * what makes the criterion true. (`insertTab` really would insert `"\t"` on a
 * collapsed cursor whatever `indentUnit` said, but nothing binds it here.)
 *
 * The negative case below is the point: without it, this suite would pass just
 * as happily against a mode that had never configured the facet at all.
 */
describe('yaml indentation', () => {
  it('configures a two-space indent unit', () => {
    expect(stateFor('a: 1\n').facet(indentUnit)).toBe('  ');
  });

  /** A real Tab keypress through the keymap — calling the command directly
   *  would bypass the binding, which is the thing under test. */
  function pressTab(doc: string, at: number, extensions = yamlModeExtensions()): string {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const view = new EditorView({
      state: EditorState.create({ doc, extensions: [...extensions, keymap.of([indentWithTab])] }),
      parent: host,
    });
    try {
      view.dispatch({ selection: { anchor: at } });
      view.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true, cancelable: true }),
      );
      return view.state.doc.toString();
    } finally {
      view.destroy();
      host.remove();
    }
  }

  it('inserts spaces, never a tab character', () => {
    const text = pressTab('a:\nb: 2\n', 'a:\n'.length);
    expect(text).not.toContain('\t');
    expect(text).toBe('a:\n  b: 2\n');
  });

  it('still indents mid-line without producing a tab', () => {
    expect(pressTab('key: value\n', 'key:'.length)).not.toContain('\t');
  });

  /**
   * Proves the test above has teeth: the same keypress against a state whose
   * indent unit is a tab does produce one. If this ever stops failing to insert
   * a tab, the assertions above have stopped measuring anything.
   */
  it('would insert a tab if the indent unit were one — the facet is what decides', () => {
    const text = pressTab('a:\nb: 2\n', 'a:\n'.length, [indentUnit.of('\t')]);
    expect(text).toContain('\t');
  });
});
