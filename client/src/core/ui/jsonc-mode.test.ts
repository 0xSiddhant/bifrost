// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { ensureSyntaxTree, foldable, matchBrackets } from '@codemirror/language';
import { toggleComment } from '@codemirror/commands';
import { diagnosticCount, forEachDiagnostic, forceLinting } from '@codemirror/lint';
import { highlightTree, tags } from '@lezer/highlight';
import { jsoncHighlight, jsoncModeExtensions, jsonModeExtensions } from './JsonEditor';

/**
 * Runestone's JSONC mode (PLAN-42) against the real extension list: valid
 * JSONC must show no false syntax or lint errors, broken JSONC must still be
 * reported where it breaks, and comments must highlight, fold and pair like
 * the rest of the editor.
 */

const VALID = [
  '// a header comment',
  '{',
  '  /* the port */ "port": 4646, // the default',
  '  "url": "http://bifrost.local/*not-a-comment*/",',
  '  "path": "C://still/a/string",',
  '  "list": [',
  '    1,',
  '    2,',
  '  ],',
  '}',
].join('\n');

const stateFor = (doc: string, extensions: Extension[] = jsoncModeExtensions()) =>
  EditorState.create({ doc, extensions });

/** Error nodes in the fully parsed syntax tree. */
function syntaxErrors(state: EditorState): number[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 5000);
  expect(tree).not.toBeNull();
  const errors: number[] = [];
  tree?.iterate({
    enter(node) {
      if (node.type.isError) errors.push(node.from);
    },
  });
  return errors;
}

/** The highlight class at each character, as the editor's highlighter paints it. */
function classAt(state: EditorState, offset: number): string {
  const tree = ensureSyntaxTree(state, state.doc.length, 5000);
  let found = '';
  if (!tree) return found;
  highlightTree(tree, jsoncHighlight, (from, to, classes) => {
    if (offset >= from && offset < to) found = classes;
  });
  return found;
}

async function lintCount(doc: string): Promise<{ count: number; first: number | null }> {
  const view = new EditorView({ state: stateFor(doc), parent: document.body });
  forceLinting(view);
  // The lint source is synchronous; its result lands a microtask later.
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  let first: number | null = null;
  forEachDiagnostic(view.state, (diagnostic) => {
    first ??= diagnostic.from;
  });
  const count = diagnosticCount(view.state);
  view.destroy();
  return { count, first };
}

describe('JSONC editor mode', () => {
  it('parses valid JSONC with no syntax errors', () => {
    expect(syntaxErrors(stateFor(VALID))).toEqual([]);
    expect(syntaxErrors(stateFor('[1, 2, 3,]'))).toEqual([]);
  });

  it('pins why it exists: the JSON grammar marks the same text broken', () => {
    expect(syntaxErrors(stateFor(VALID, jsonModeExtensions())).length).toBeGreaterThan(0);
  });

  it('still marks JSON5-only syntax as broken', () => {
    expect(syntaxErrors(stateFor("{'a': 1}")).length).toBeGreaterThan(0);
    expect(syntaxErrors(stateFor('{a: 1}')).length).toBeGreaterThan(0);
    expect(syntaxErrors(stateFor('{"a": NaN}')).length).toBeGreaterThan(0);
  });

  it('lints valid JSONC clean and broken JSONC where it breaks', async () => {
    expect((await lintCount(VALID)).count).toBe(0);
    const broken = '{\n  // fine\n  "a": 1,,\n}';
    const result = await lintCount(broken);
    expect(result.count).toBeGreaterThan(0);
    expect(result.first).toBe(broken.indexOf(',,') + 1);
    const json5 = "{\n  'a': 1 // single quotes\n}";
    expect((await lintCount(json5)).first).toBe(json5.indexOf("'a'"));
  });

  it('highlights comments as comments and look-alikes inside strings as strings', () => {
    const state = stateFor(VALID);
    const comment = jsoncHighlight.style([tags.lineComment]);
    const block = jsoncHighlight.style([tags.blockComment]);
    const string = jsoncHighlight.style([tags.string]);
    const key = jsoncHighlight.style([tags.propertyName]);
    const number = jsoncHighlight.style([tags.number]);
    expect(comment).toBeTruthy();
    expect(classAt(state, VALID.indexOf('// a header'))).toBe(comment);
    expect(classAt(state, VALID.indexOf('// the default'))).toBe(comment);
    expect(classAt(state, VALID.indexOf('/* the port */'))).toBe(block);
    expect(classAt(state, VALID.indexOf('/*not-a-comment*/'))).toBe(string);
    expect(classAt(state, VALID.indexOf('//still'))).toBe(string);
    expect(classAt(state, VALID.indexOf('"port"'))).toBe(key);
    expect(classAt(state, VALID.indexOf('4646'))).toBe(number);
  });

  it('folds objects and arrays, trailing comma and all', () => {
    const state = stateFor(VALID);
    const lineWith = (marker: string) => state.doc.lineAt(VALID.indexOf(marker));
    const outer = lineWith('{');
    const outerFold = foldable(state, outer.from, outer.to);
    expect(outerFold && VALID.slice(outerFold.from, outerFold.to)).toContain('"list"');
    const list = lineWith('"list"');
    const listFold = foldable(state, list.from, list.to);
    expect(listFold && VALID.slice(listFold.from, listFold.to).replace(/\s/g, '')).toBe('1,2,');
  });

  it('matches brackets past braces inside strings and comments', () => {
    const doc = '{ "a": "}", /* } */ "b": [1, // ]\n 2,] }';
    const state = stateFor(doc);
    const brace = matchBrackets(state, 0, 1);
    expect(brace?.matched).toBe(true);
    expect(brace?.end?.from).toBe(doc.lastIndexOf('}'));
    const bracket = matchBrackets(state, doc.indexOf('['), 1);
    expect(bracket?.matched).toBe(true);
    expect(bracket?.end?.from).toBe(doc.lastIndexOf(']'));
  });

  it('toggles a line comment with the editor command', () => {
    const doc = '{\n  "a": 1\n}';
    let state = stateFor(doc);
    const line = state.doc.line(2);
    state = state.update({ selection: EditorSelection.cursor(line.from + 3) }).state;
    toggleComment({
      state,
      dispatch: (transaction) => {
        state = transaction.state;
      },
    });
    expect(state.doc.line(2).text).toBe('  // "a": 1');
  });
});
