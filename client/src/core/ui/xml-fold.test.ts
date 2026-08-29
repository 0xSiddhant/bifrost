// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { foldable } from '@codemirror/language';
import { CompletionContext, type CompletionSource } from '@codemirror/autocomplete';
import { xmlModeExtensions } from './JsonEditor';

/**
 * Atlas's editor folds XML through lang-xml's own `foldNodeProp` — no custom
 * `foldService`, the same claim the YAML fold test pins for Groot. Asserted
 * against the real extension list so a lang-xml upgrade that dropped a node
 * type fails here rather than quietly costing the gutter its arrows.
 *
 * This matters more than usual for `@codemirror/lang-xml`: its upstream repo
 * was archived in April 2026, so a future breaking change would arrive with
 * nobody to report it to.
 */

const stateFor = (doc: string): EditorState =>
  EditorState.create({ doc, extensions: xmlModeExtensions() });

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
const plist = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
  '<plist version="1.0">',
  '<dict>',
  '\t<key>CFBundleName</key>',
  '\t<string>Bifrost</string>',
  '\t<key>NSAppTransportSecurity</key>',
  '\t<dict>',
  '\t\t<key>NSAllowsLocalNetworking</key>',
  '\t\t<true/>',
  '\t</dict>',
  '\t<key>Seeds</key>',
  '\t<array>',
  '\t\t<string>alpha</string>',
  '\t\t<string>beta</string>',
  '\t</array>',
  '</dict>',
  '</plist>',
].join('\n');

describe('xml folding', () => {
  it('folds an element from the end of its start tag', () => {
    const hidden = foldedText(plist, '<plist version="1.0">');
    expect(hidden).toContain('CFBundleName');
    expect(hidden).not.toContain('<!DOCTYPE');
  });

  it('folds a nested dict less than its parent', () => {
    const outer = foldedText(plist, '\n<dict>');
    const inner = foldedText(plist, '\t<dict>');
    expect(outer).toContain('NSAllowsLocalNetworking');
    expect(inner.length).toBeLessThan(outer.length);
    expect(inner).not.toContain('CFBundleName');
  });

  it('folds an array on its own', () => {
    const hidden = foldedText(plist, '<array>');
    expect(hidden).toContain('alpha');
    expect(hidden).toContain('beta');
    expect(hidden).not.toContain('CFBundleName');
  });

  it('offers no arrow on a single-line leaf or a self-closing tag', () => {
    expect(foldOnLineWith(plist, '<key>CFBundleName</key>')).toBeNull();
    expect(foldOnLineWith(plist, '<true/>')).toBeNull();
  });
});

describe('xml lint', () => {
  it('is configured with a linter and a fold gutter, not a bare language', () => {
    // A cheap structural assertion: the mode is meant to bring more than
    // highlighting, and an accidental `return [xmlLang()]` would still tint.
    expect(xmlModeExtensions().length).toBeGreaterThan(5);
  });
});

/**
 * Completion is offered for **property lists only** — Atlas knows Apple's
 * vocabulary and nothing about anyone's own schema, so proposing `<dict>`
 * inside someone's `<config>` would be inventing a document shape for them.
 *
 * Driven through the real language-data facet rather than a hand-held source,
 * so a mis-registered extension fails here.
 */
function completionsAt(doc: string, marker: string): string[] {
  const state = EditorState.create({ doc, extensions: xmlModeExtensions() });
  const at = doc.indexOf(marker) + marker.length;
  expect(at, `marker ${marker} not found`).toBeGreaterThan(marker.length - 1);
  const context = new CompletionContext(state, at, true);
  // Every source, not the first that answers: `xml()` registers its own
  // empty-schema source alongside ours, and CodeMirror merges them all — so a
  // helper that stopped at the first result would only ever see the empty one.
  return state
    .languageDataAt<CompletionSource>('autocomplete', at)
    .flatMap((source) => {
      const result = source(context);
      return result && 'options' in result ? (result.options ?? []) : [];
    })
    .map((option) => option.label);
}

describe('xml completion', () => {
  const PLIST = '<plist version="1.0">\n<dict>\n\t<key>a</key>\n\t<st\n</dict>\n</plist>';

  it('offers the whole plist vocabulary, each element exactly once', () => {
    const labels = completionsAt(PLIST, '\t<st');
    expect([...labels].sort()).toEqual([
      'array',
      'data',
      'date',
      'dict',
      'false',
      'integer',
      'key',
      'plist',
      'real',
      'string',
      'true',
    ]);
    // The schema is flat on purpose — see the note on PLIST_SCHEMA. A nested
    // one listed dict and array twice, which is what this pins.
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('offers nothing at all for XML that is not a property list', () => {
    // The same line the table draws: this document's shape is its author's,
    // and proposing <dict> inside someone's <config> would be inventing one.
    expect(completionsAt('<config>\n  <na\n</config>', '  <na')).toEqual([]);
  });

  it('completes the version attribute value on the root element', () => {
    const labels = completionsAt('<plist version="', '<plist version="');
    expect(labels).toContain('"1.0"');
  });
});
