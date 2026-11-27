import { describe, expect, it } from 'vitest';
import { DEFAULT_JSON_OPTIONS, DEFAULT_TEXT_OPTIONS } from './compare';
import { variantDraftCodec, variantHasContent, type VariantDraft } from './draft';

const pane = (text: string, label = 'L') => ({ text, label, source: null });

const DRAFT: VariantDraft = {
  mode: 'text',
  json: { left: { text: '{"a":1}', label: 'Pinned', source: { slug: 'pinned-abc123', name: 'Pinned' } }, right: pane('{"a":2}') },
  text: { left: pane('before'), right: pane('after') },
  jsonOptions: { ...DEFAULT_JSON_OPTIONS, arrayStrategy: 'set', ignorePaths: 'meta.*' },
  textOptions: { ...DEFAULT_TEXT_OPTIONS, ignoreCase: true },
};

describe('Variant drafts (PLAN-43)', () => {
  it('round-trips both workspaces, their sources and the options', () => {
    expect(variantDraftCodec(JSON.parse(JSON.stringify(DRAFT)))).toEqual(DRAFT);
  });

  it('keeps no compare results, whatever is stored beside the panes', () => {
    const stored = { ...DRAFT, results: { records: [1, 2, 3] } };
    expect(variantDraftCodec(stored)).not.toHaveProperty('results');
  });

  it('rejects a draft without its panes, and repairs options it cannot read', () => {
    expect(variantDraftCodec({ mode: 'json' })).toBeNull();
    expect(variantDraftCodec({ ...DRAFT, json: { left: pane('x') } })).toBeNull();
    const repaired = variantDraftCodec({
      ...DRAFT,
      jsonOptions: { arrayStrategy: 'sideways', epsilon: 3 },
      textOptions: 'nope',
    });
    expect(repaired?.jsonOptions).toEqual(DEFAULT_JSON_OPTIONS);
    expect(repaired?.textOptions).toEqual(DEFAULT_TEXT_OPTIONS);
  });

  it('counts any pane with text, in either workspace, as worth keeping', () => {
    const empty: VariantDraft = {
      ...DRAFT,
      json: { left: pane(''), right: pane(' ') },
      text: { left: pane(''), right: pane('') },
    };
    expect(variantHasContent(empty)).toBe(false);
    expect(variantHasContent({ ...empty, text: { left: pane(''), right: pane('x') } })).toBe(true);
  });
});
