// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { foldable } from '@codemirror/language';
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
