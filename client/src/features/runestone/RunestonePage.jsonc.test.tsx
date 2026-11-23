// @vitest-environment jsdom
/**
 * Runestone's JSON/JSONC mode (PLAN-42): strict JSON by default, a switch that
 * changes how the buffer is read and never the buffer, and the format carried
 * through drafts, hand-offs, saves, imports and exports.
 *
 * The buffer is read back through Export (saveText is mocked), which hands over
 * exactly what the editor holds — no reading CodeMirror's DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const navigate = vi.fn();
const params: { slug?: string } = {};
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useParams: () => params,
}));

const wire = vi.hoisted(() => ({
  fetchRunestone: vi.fn(),
  RUNESTONE_CONFIG: { maxDocKb: 2048 },
  saveRunestone: vi.fn(),
  updateRunestone: vi.fn(),
}));
vi.mock('../../core/runestone', () => wire);

const files = vi.hoisted(() => ({ saveText: vi.fn(), saveBlob: vi.fn() }));
vi.mock('../../core/saveBlob', () => files);

const clipboard = vi.hoisted(() => ({ copyText: vi.fn(() => Promise.resolve(true)) }));
vi.mock('../../core/copy', () => clipboard);

import { RunestonePage } from './RunestonePage';
import { clearDraft, loadDraft, saveDraft } from './draft';
import { putRunestoneSeed } from '../../core/runestoneSeed';
import { takeLeftOpen } from '../../core/draftReturn';

const COMMENTED = '{\n  // the port\n  "port": 4646,\n  "big": 9007199254740993,\n}';

const SAVED = {
  id: 'doc-1',
  name: 'Bridge Settings',
  slug: 'bridge-settings-abc123',
  authorDeviceId: null,
  sizeBytes: 9,
  createdAt: 0,
  modifiedAt: 0,
  content: '{"a":1}',
  format: 'json',
};

describe('RunestonePage — JSON and JSONC', () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = async () => {
    await act(async () => {
      root.render(<RunestonePage />);
    });
  };

  /** Past the 300 ms validation debounce (and the 500 ms draft mirror). */
  const settle = async (ms = 350) => {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, ms));
    });
  };

  const button = (label: string): HTMLButtonElement => {
    const found = [...container.querySelectorAll('button')].find(
      (el) => el.textContent?.trim() === label,
    );
    if (!found) throw new Error(`no button labelled "${label}"`);
    return found;
  };
  const maybeButton = (label: string) =>
    [...container.querySelectorAll('button')].find((el) => el.textContent?.trim() === label);

  const radio = (value: 'json' | 'jsonc'): HTMLInputElement => {
    const found = container.querySelector<HTMLInputElement>(
      `input[name="rune-format"][value="${value}"]`,
    );
    if (!found) throw new Error(`no ${value} radio`);
    return found;
  };

  const click = async (el: HTMLElement) => {
    await act(async () => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  };

  /** What the editor holds, and the name and type it exports under. */
  const exported = async (): Promise<{ text: string; name: string; mime: string }> => {
    files.saveText.mockClear();
    await click(button('Export'));
    const [text, name, mime] = files.saveText.mock.calls[0] as [string, string, string];
    return { text, name, mime };
  };

  const status = () => container.querySelector('.rune-status')?.textContent ?? '';

  const importFile = async (name: string, content: string, type = '') => {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('no file input');
    const file = new File([content], name, { type });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // file.text() resolves on a later task; Export waits for the debounce.
    await settle();
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    // jsdom has no layout; CodeMirror measures text ranges after an edit.
    const empty = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] });
    Range.prototype.getClientRects = empty as unknown as () => DOMRectList;
    Range.prototype.getBoundingClientRect = () => new DOMRect();
    localStorage.clear();
    sessionStorage.clear();
    clearDraft();
    // The previous test's unmount marks the buffer left open (module scope).
    takeLeftOpen('runestone');
    vi.clearAllMocks();
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    delete params.slug;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('opens a new document in strict JSON, which refuses comments', async () => {
    putRunestoneSeed({ title: 'Seeded', text: COMMENTED });
    await render();
    expect(radio('json').checked).toBe(true);
    expect(radio('jsonc').checked).toBe(false);
    await settle();
    expect(status()).toMatch(/errors? in JSON/);
    // The comments are not lost, just not valid here: the hint says where they are.
    expect(status()).toContain('Valid as JSONC');
    expect(button('Save to Pensieve').disabled).toBe(true);
  });

  it('switches to JSONC without touching a byte, and saves in it', async () => {
    putRunestoneSeed({ title: 'Seeded', text: COMMENTED });
    await render();
    await click(radio('jsonc'));
    expect(radio('jsonc').checked).toBe(true);
    await settle();
    expect(status()).toContain('Valid JSONC');
    expect((await exported()).text).toBe(COMMENTED);

    wire.saveRunestone.mockResolvedValue({ ...SAVED, content: COMMENTED, format: 'jsonc' });
    await click(button('Save to Pensieve'));
    expect(wire.saveRunestone).toHaveBeenCalledWith({
      name: 'Seeded',
      content: COMMENTED,
      format: 'jsonc',
    });

    // And back to JSON: still the same bytes, now invalid, and unsaveable.
    await click(radio('json'));
    await settle();
    expect((await exported()).text).toBe(COMMENTED);
    expect(status()).toMatch(/errors? in JSON/);
    expect(button('Save').disabled).toBe(true);
  });

  it('opens a seed in the format it was handed', async () => {
    putRunestoneSeed({ title: 'Handed', text: COMMENTED, format: 'jsonc' });
    await render();
    expect(radio('jsonc').checked).toBe(true);
    await settle();
    expect(status()).toContain('Valid JSONC');
  });

  it('loads a saved JSONC document in JSONC', async () => {
    params.slug = SAVED.slug;
    wire.fetchRunestone.mockResolvedValue({ ...SAVED, content: COMMENTED, format: 'jsonc' });
    await render();
    expect(radio('jsonc').checked).toBe(true);
    expect(button('Saved')).toBeTruthy();
  });

  it('marks a saved document dirty on a mode change alone, and persists it', async () => {
    params.slug = SAVED.slug;
    wire.fetchRunestone.mockResolvedValue(SAVED);
    await render();
    expect(button('Saved').disabled).toBe(true);

    await click(radio('jsonc'));
    await settle();
    expect(container.textContent).toContain('Unsaved changes');
    wire.updateRunestone.mockResolvedValue({ ...SAVED, format: 'jsonc' });
    await click(button('Save'));
    expect(wire.updateRunestone).toHaveBeenCalledWith('doc-1', {
      name: SAVED.name,
      content: SAVED.content,
      format: 'jsonc',
    });
    expect(button('Saved')).toBeTruthy();

    // Switching back is a change again.
    await click(radio('json'));
    expect(button('Save').disabled).toBe(false);
  });

  it('mirrors the format into the scratch draft and brings it back on return', async () => {
    putRunestoneSeed({ title: 'Drafted', text: COMMENTED, format: 'jsonc' });
    await render();
    await settle(600);
    expect(loadDraft()).toMatchObject({ title: 'Drafted', text: COMMENTED, format: 'jsonc' });

    // Leaving and coming back inside the page's lifetime restores it silently.
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    expect(radio('jsonc').checked).toBe(true);
    await settle();
    expect((await exported()).text).toBe(COMMENTED);
  });

  it("restores an earlier visit's JSONC draft in JSONC", async () => {
    saveDraft({ title: 'Earlier', text: COMMENTED, format: 'jsonc', savedAt: 1 });
    await render();
    // Offered, not applied: the editor opens blank in strict JSON.
    expect(radio('json').checked).toBe(true);
    await click(button('Restore'));
    expect(radio('jsonc').checked).toBe(true);
    await settle();
    expect((await exported()).text).toBe(COMMENTED);
  });

  it('reads a draft cached before PLAN-42 as strict JSON', () => {
    localStorage.setItem(
      'bifrost.runestone.draft',
      JSON.stringify({ title: 'Old', text: '{"a":1}', savedAt: 1 }),
    );
    expect(loadDraft()).toEqual({ title: 'Old', text: '{"a":1}', format: 'json', savedAt: 1 });
    saveDraft({ title: 'New', text: '{}', format: 'jsonc', savedAt: 2 });
    expect(loadDraft()?.format).toBe('jsonc');
  });

  it('imports .jsonc as JSONC (strict contents included) and .json as JSON', async () => {
    await render();
    await importFile('settings.jsonc', '{"strict": true}');
    expect(radio('jsonc').checked).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input.rune-title')?.value).toBe('settings');
    expect(await exported()).toEqual({
      text: '{"strict": true}',
      name: 'settings.jsonc',
      mime: 'application/jsonc',
    });

    await importFile('plain.json', '{"a": 1}');
    expect(radio('json').checked).toBe(true);
    expect(await exported()).toEqual({
      text: '{"a": 1}',
      name: 'plain.json',
      mime: 'application/json',
    });
  });

  it('keeps Unescape off in JSONC, with the reason, and offers Copy as strict JSON', async () => {
    putRunestoneSeed({ title: 'Seeded', text: COMMENTED, format: 'jsonc' });
    await render();
    await settle();
    expect(button('Unescape').disabled).toBe(true);
    expect(button('Unescape').title).toMatch(/drop its comments/);

    await click(button('Copy as strict JSON'));
    expect(clipboard.copyText).toHaveBeenCalledWith(
      '{\n  "port": 4646,\n  "big": 9007199254740993\n}',
    );
    expect((await exported()).text).toBe(COMMENTED);

    await click(radio('json'));
    expect(maybeButton('Copy as strict JSON')).toBeUndefined();
  });

  it('copies a JSONC document as JS without touching it', async () => {
    putRunestoneSeed({ title: 'Seeded', text: COMMENTED, format: 'jsonc' });
    await render();
    await settle();
    await click(button('Copy as JS'));
    const [js] = clipboard.copyText.mock.calls[0] as unknown as [string];
    expect(js).toContain('port: 4646');
    expect((await exported()).text).toBe(COMMENTED);
  });

  it('formats, minifies and sorts JSONC with every comment kept', async () => {
    const doc = '{"b": 2, // bee\n"a": [1, 2,], /* ay */ "c": 1.50}';
    putRunestoneSeed({ title: 'Seeded', text: doc, format: 'jsonc' });
    await render();
    await settle();
    const comments = (text: string) => text.match(/\/\/ bee|\/\* ay \*\//g)?.sort();

    await click(button('Format'));
    let text = (await exported()).text;
    expect(comments(text)).toEqual(['/* ay */', '// bee']);
    await settle();

    await click(button('Sort keys'));
    text = (await exported()).text;
    expect(comments(text)).toEqual(['/* ay */', '// bee']);
    expect(text.indexOf('"a"')).toBeLessThan(text.indexOf('"b"'));
    expect(text).toContain('// bee');
    expect(text).toContain('1.50');
    await settle();

    await click(button('Minify'));
    text = (await exported()).text;
    expect(comments(text)).toEqual(['/* ay */', '// bee']);
    expect(text).toContain('// bee\n');
  });
});
