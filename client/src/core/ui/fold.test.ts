import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { foldable } from '@codemirror/language';
import { javascriptModeExtensions } from './JsonEditor';

/**
 * Loki's editor folds JavaScript through lang-javascript's `foldNodeProp`
 * rather than through indentation. These assertions pin the constructs that
 * matter to the workbench — if a lang-javascript upgrade ever drops one, this
 * fails instead of the gutter quietly losing arrows.
 *
 * `foldable(state, lineStart, lineEnd)` is what the fold gutter itself calls to
 * decide whether a line gets an arrow, so this exercises the real code path
 * with no DOM involved.
 */

const stateFor = (doc: string): EditorState =>
  EditorState.create({ doc, extensions: javascriptModeExtensions() });

/** The fold range offered on the line containing `marker`, or null. */
function foldOnLineWith(doc: string, marker: string): { from: number; to: number } | null {
  const state = stateFor(doc);
  const at = doc.indexOf(marker);
  expect(at, `marker ${marker} not found in fixture`).toBeGreaterThanOrEqual(0);
  const line = state.doc.lineAt(at);
  return foldable(state, line.from, line.to);
}

/** The text a fold would hide — what collapsing actually removes from view. */
function foldedText(doc: string, marker: string): string {
  const range = foldOnLineWith(doc, marker);
  expect(range, `expected a fold range on the line with ${marker}`).not.toBeNull();
  return doc.slice(range!.from, range!.to);
}

describe('javascript folding', () => {
  it('folds a function body', () => {
    const doc = ['function double(n) {', '  return n * 2;', '}'].join('\n');
    expect(foldedText(doc, 'function double')).toContain('return n * 2;');
  });

  it('folds an arrow function body', () => {
    const doc = ['const f = (n) => {', '  return n + 1;', '};'].join('\n');
    expect(foldedText(doc, 'const f')).toContain('return n + 1;');
  });

  it('folds an object literal', () => {
    const doc = ['const conf = {', '  host: "localhost",', '  port: 4646,', '};'].join('\n');
    const hidden = foldedText(doc, 'const conf');
    expect(hidden).toContain('host: "localhost"');
    expect(hidden).toContain('port: 4646');
  });

  it('folds an array literal', () => {
    const doc = ['const xs = [', '  1,', '  2,', '  3,', '];'].join('\n');
    expect(foldedText(doc, 'const xs')).toContain('2,');
  });

  it('folds a bare block and an if block', () => {
    const doc = ['{', '  let scoped = 1;', '}'].join('\n');
    expect(foldedText(doc, '{')).toContain('let scoped = 1;');

    const cond = ['if (ready) {', '  start();', '}'].join('\n');
    expect(foldedText(cond, 'if (ready)')).toContain('start();');
  });

  it('folds a classic IIFE', () => {
    const doc = ['(function () {', '  const secret = 1;', '  return secret;', '})();'].join('\n');
    expect(foldedText(doc, '(function ()')).toContain('const secret = 1;');
  });

  it('folds an arrow IIFE', () => {
    const doc = ['(() => {', '  run();', '})();'].join('\n');
    expect(foldedText(doc, '(() =>')).toContain('run();');
  });

  it('folds nested blocks independently of their parent', () => {
    const doc = [
      'function outer() {',
      '  const inner = {',
      '    deep: [1, 2],',
      '  };',
      '  return inner;',
      '}',
    ].join('\n');

    // The outer function hides everything, including the nested literal.
    const outer = foldedText(doc, 'function outer');
    expect(outer).toContain('const inner');
    expect(outer).toContain('return inner;');

    // The nested object folds on its own line, hiding strictly less.
    const inner = foldedText(doc, 'const inner');
    expect(inner).toContain('deep: [1, 2]');
    expect(inner).not.toContain('return inner;');
    expect(inner.length).toBeLessThan(outer.length);
  });

  it('folds a class body and a switch body', () => {
    const klass = ['class Thing {', '  run() {}', '}'].join('\n');
    expect(foldedText(klass, 'class Thing')).toContain('run() {}');

    const sw = ['switch (k) {', '  case 1:', '    break;', '}'].join('\n');
    expect(foldedText(sw, 'switch (k)')).toContain('case 1:');
  });

  it('folds a block comment', () => {
    const doc = ['/*', ' * notes', ' */', 'run();'].join('\n');
    expect(foldedText(doc, '/*')).toContain('notes');
  });

  it('offers no fold on a single-line statement', () => {
    expect(foldOnLineWith('const n = 1;', 'const n')).toBeNull();
  });
});

/**
 * Parameter-position folding (the `paramFolding` foldService). lang-javascript
 * folds `ObjectExpression` but not `ObjectPattern`, so a destructured signature
 * had no arrow at all until this was added.
 */
describe('parameter folding', () => {
  // The reported case, verbatim in shape: a minified-style function whose
  // parameter is a multi-line destructured object.
  const destructured = [
    'function e({',
    '  color: e,',
    '  strokeColor: t,',
    '  strokeSize: r,',
    '  radius: n,',
    '  radiusConfig: i,',
    '  elevation: o,',
    '  tintColor: a,',
    '  textColor: l,',
    '}) {',
    '  return e;',
    '}',
  ].join('\n');

  it('folds a multi-line destructured parameter', () => {
    const hidden = foldedText(destructured, 'function e({');
    expect(hidden).toContain('color: e,');
    expect(hidden).toContain('textColor: l,');
    // The body is a separate fold — the signature fold must not swallow it.
    expect(hidden).not.toContain('return e;');
  });

  it('keeps the braces visible so the fold reads as ({…})', () => {
    const range = foldOnLineWith(destructured, 'function e({')!;
    expect(destructured[range.from - 1]).toBe('{');
    expect(destructured[range.to]).toBe('}');
  });

  it('still folds the body on the closing `}) {` line', () => {
    // Regression guard: the parameter fold must not hijack the line that opens
    // the function block.
    expect(foldedText(destructured, '}) {')).toContain('return e;');
  });

  it('folds the signature and the body independently', () => {
    const sig = foldedText(destructured, 'function e({');
    const body = foldedText(destructured, '}) {');
    expect(sig).not.toContain('return e;');
    expect(body).not.toContain('color: e,');
  });

  it('folds a plain multi-line parameter list without destructuring', () => {
    const doc = ['function f(', '  a,', '  b,', ') {', '  return a + b;', '}'].join('\n');
    const hidden = foldedText(doc, 'function f(');
    expect(hidden).toContain('a,');
    expect(hidden).toContain('b,');
    expect(hidden).not.toContain('return a + b;');
  });

  it('folds a destructured arrow parameter', () => {
    const doc = ['const g = ({', '  a,', '  b,', '}) => a + b;'].join('\n');
    expect(foldedText(doc, 'const g = ({')).toContain('a,');
  });

  it('folds a multi-line array-destructured parameter', () => {
    const doc = ['function h([', '  first,', '  second,', ']) {', '  return first;', '}'].join('\n');
    expect(foldedText(doc, 'function h([')).toContain('first,');
  });

  it('leaves a single-line parameter list alone', () => {
    // The arrow on this line belongs to the body block, not the parameters.
    const doc = ['function k({ a, b }) {', '  return a;', '}'].join('\n');
    expect(foldedText(doc, 'function k')).toContain('return a;');
  });

  it('does not fold call arguments — the callback body keeps its fold', () => {
    // ArgList is excluded on purpose; this is the idiom it would have broken.
    const doc = ["app.get('/x', function () {", '  reply.send();', '});'].join('\n');
    const hidden = foldedText(doc, 'app.get');
    expect(hidden).toContain('reply.send();');
    expect(hidden).not.toContain("'/x'");
  });
});
