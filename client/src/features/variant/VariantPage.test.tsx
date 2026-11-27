// @vitest-environment jsdom
/**
 * Variant keeps its workbench per tab (PLAN-43): both workspaces and the
 * options come back after a reload, the compare results do not, and a
 * hand-off still wins over what was kept.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const search = { params: new URLSearchParams() };
vi.mock('react-router-dom', () => ({
  useSearchParams: () => [search.params, vi.fn()],
}));

const wire = vi.hoisted(() => ({ fetchRunestone: vi.fn() }));
vi.mock('../../core/runestone', () => wire);

import { VariantPage } from './VariantPage';
import { putVariantTextSeed } from '../../core/variantSeed';
import { VARIANT_WORKSPACE, recordKey } from '../../core/drafts/records';
import { installTestSession, uninstallTestSession } from '../../core/drafts/testing';
import { DEFAULT_JSON_OPTIONS, DEFAULT_TEXT_OPTIONS } from './compare';
import type { VariantDraft } from './draft';

const pane = (text: string, label: string) => ({ text, label, source: null });

describe('VariantPage — per-tab drafts', () => {
  let container: HTMLDivElement;
  let root: Root;
  let tab: string;

  const render = async () => {
    await act(async () => {
      root.render(<VariantPage />);
    });
  };
  const settle = async (ms = 600) => {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, ms));
    });
  };
  const key = () => recordKey('variant', tab, VARIANT_WORKSPACE);
  const stored = (): VariantDraft | null => {
    const raw = localStorage.getItem(key());
    return raw === null ? null : (JSON.parse(raw) as { payload: VariantDraft }).payload;
  };
  const editors = () => [...container.querySelectorAll('.cm-content')].map((el) => el.textContent);
  const button = (label: string) =>
    [...container.querySelectorAll('button')].find((el) => el.textContent?.trim() === label);

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const empty = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] });
    Range.prototype.getClientRects = empty as unknown as () => DOMRectList;
    Range.prototype.getBoundingClientRect = () => new DOMRect();
    localStorage.clear();
    sessionStorage.clear();
    search.params = new URLSearchParams();
    tab = installTestSession().me()?.tab ?? '';
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    uninstallTestSession();
  });

  const KEPT: VariantDraft = {
    mode: 'text',
    json: { left: pane('{"a":1}', 'Original'), right: pane('{"a":2}', 'Modified') },
    text: { left: pane('before', 'Before'), right: pane('after', 'After') },
    jsonOptions: { ...DEFAULT_JSON_OPTIONS, ignoreKeyOrder: false },
    textOptions: { ...DEFAULT_TEXT_OPTIONS, ignoreCase: true },
  };
  const keep = (draft: VariantDraft) =>
    localStorage.setItem(
      key(),
      JSON.stringify({
        v: 1,
        tab,
        feature: 'variant',
        workspace: VARIANT_WORKSPACE,
        savedAt: 1,
        payload: draft,
      }),
    );

  it('brings back both workspaces and the mode after a reload, without compare results', async () => {
    keep(KEPT);
    await render();
    // Text mode, as it was left.
    expect(editors()).toEqual(['before', 'after']);
    expect(container.textContent).not.toContain('Restore draft');
    await act(async () =>
      button('JSON')?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    expect(editors()).toEqual(['{"a":1}', '{"a":2}']);
    // No stale results: nothing compared until Compare is pressed again.
    expect(container.querySelector('.variant-drawer')?.textContent ?? '').not.toMatch(
      /\d+ changes?/,
    );
    await settle();
    expect(stored()).toMatchObject({ mode: 'json', text: KEPT.text, json: KEPT.json });
  });

  it('keeps the text panes a hand-off brings, and the JSON workspace it kept', async () => {
    keep(KEPT);
    putVariantTextSeed({ left: 'seed left', right: 'seed right' });
    await render();
    expect(editors()).toEqual(['seed left', 'seed right']);
    await settle();
    expect(stored()?.json).toEqual(KEPT.json);
    expect(stored()?.text.left.text).toBe('seed left');
  });

  it('keeps a restored pane’s unsaved work over the runestone its address names', async () => {
    keep({ ...KEPT, mode: 'json' });
    search.params = new URLSearchParams({ left: 'shared-rune-abc123' });
    wire.fetchRunestone.mockResolvedValue({
      id: 'r1',
      name: 'Shared',
      slug: 'shared-rune-abc123',
      content: '{"from":"link"}',
    });
    await render();
    await settle();
    expect(editors()).toEqual(['{"a":1}', '{"a":2}']);
    expect(container.textContent).toContain('Kept this tab’s unsaved work here instead of loading');
    expect(stored()?.json.left.text).toBe('{"a":1}');
  });

  it('loads the address’s runestone into a pane that came back empty', async () => {
    keep({ ...KEPT, mode: 'json', json: { ...KEPT.json, left: pane('', 'Original') } });
    search.params = new URLSearchParams({ left: 'shared-rune-abc123' });
    wire.fetchRunestone.mockResolvedValue({
      id: 'r1',
      name: 'Shared',
      slug: 'shared-rune-abc123',
      content: '{"from":"link"}',
    });
    await render();
    await settle();
    expect(editors()[0]).toBe('{"from":"link"}');
  });

  it('drops its record when every pane is emptied', async () => {
    keep({
      ...KEPT,
      mode: 'json',
      text: { left: pane('', 'Original'), right: pane('', 'Modified') },
    });
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    await render();
    await act(async () =>
      button('Clear')?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    await settle();
    expect(stored()).toBeNull();
    vi.unstubAllGlobals();
  });
});
