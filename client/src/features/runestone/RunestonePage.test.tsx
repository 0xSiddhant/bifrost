// @vitest-environment jsdom
/**
 * The "New" head action (one blank buffer without leaving the page) and the
 * per-tab drafts of saved documents (PLAN-43). Runestone is the representative
 * editor here: Edda, Groot and Atlas carry the same `startNew` and the same
 * `core/documentDrafts` flow, so what is pinned is the behaviour they share — a
 * saved document releases its slug, the confirm is honoured, New discards only
 * this workspace's draft, and a saved document's unsaved edits come back after
 * a reload as unsaved edits, checked against the server copy.
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

import { RunestonePage } from './RunestonePage';
import { putRunestoneSeed } from '../../core/runestoneSeed';
import { baselineOf, type TextDraft } from '../../core/drafts/documents';
import { SCRATCH, docWorkspace, makeEnvelope, recordKey } from '../../core/drafts/records';
import { installTestSession, uninstallTestSession } from '../../core/drafts/testing';

const DOC = {
  id: 'doc-1',
  name: 'Gleaming Gungnir',
  slug: 'gleaming-gungnir-abc123',
  authorDeviceId: null,
  sizeBytes: 9,
  createdAt: 0,
  modifiedAt: 0,
  content: '{"a":1}',
  format: 'json',
};

/** Past the 500 ms draft mirror. */
const settle = async (ms = 600) => {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, ms));
  });
};

describe('RunestonePage — New and saved-document drafts', () => {
  let container: HTMLDivElement;
  let root: Root;
  let tab: string;

  const keyOf = (workspace: string) => recordKey('runestone', tab, workspace);
  const ownDraft = (workspace: string): TextDraft | null => {
    const raw = localStorage.getItem(keyOf(workspace));
    return raw === null ? null : (JSON.parse(raw) as { payload: TextDraft }).payload;
  };
  const putOwn = (workspace: string, payload: TextDraft) =>
    localStorage.setItem(
      keyOf(workspace),
      JSON.stringify(makeEnvelope({ feature: 'runestone', tab, workspace }, payload, 1)),
    );
  const rename = async (value: string) => {
    const input = titleInput();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  /** A reload of this tab: the page goes, this tab's identity stays. */
  const reload = async () => {
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
  };

  const render = async () => {
    await act(async () => {
      root.render(<RunestonePage />);
    });
  };

  const button = (label: string): HTMLButtonElement => {
    const found = [...container.querySelectorAll('button')].find(
      (el) => el.textContent?.trim() === label,
    );
    if (!found) throw new Error(`no button labelled "${label}"`);
    return found;
  };

  const titleInput = (): HTMLInputElement => {
    const input = container.querySelector<HTMLInputElement>('input.rune-title');
    if (!input) throw new Error('no title input');
    return input;
  };

  const click = async (el: HTMLElement) => {
    await act(async () => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    tab = installTestSession().me()?.tab ?? '';
    vi.clearAllMocks();
    // jsdom's own confirm() is a not-implemented stub; every test says
    // explicitly what the person answered.
    vi.stubGlobal('confirm', vi.fn(() => true));
    wire.fetchRunestone.mockResolvedValue(DOC);
    params.slug = DOC.slug;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    uninstallTestSession();
    vi.unstubAllGlobals();
  });

  it('releases a saved document and returns to the scratch URL', async () => {
    await render();
    expect(titleInput().value).toBe(DOC.name);
    expect(button('Saved')).toBeTruthy();

    await click(button('New'));

    // Pushed, not replaced: Back returns to the document that was open.
    expect(navigate).toHaveBeenCalledWith('/runestone');
    expect(titleInput().value).not.toBe(DOC.name);
    expect(titleInput().value).not.toBe('');
    // Bound to nothing again — the next save creates a second document.
    expect(button('Save to Pensieve')).toBeTruthy();
  });

  it('keeps the document when the confirm is declined', async () => {
    await render();
    const input = titleInput();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, 'Renamed but unsaved');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(button('Save')).toBeTruthy();

    vi.stubGlobal('confirm', vi.fn(() => false));
    await click(button('New'));

    expect(navigate).not.toHaveBeenCalled();
    expect(titleInput().value).toBe('Renamed but unsaved');
  });

  it('drops this document’s unsaved edits on New, and keeps this tab’s scratch draft', async () => {
    putOwn(SCRATCH, { title: 'Scratch work', text: '{"scratch":1}', baseline: null });
    await render();
    await rename('Renamed but unsaved');
    await settle();
    expect(ownDraft(docWorkspace(DOC.id))?.title).toBe('Renamed but unsaved');

    await click(button('New'));
    await settle();

    expect(ownDraft(docWorkspace(DOC.id))).toBeNull();
    // Another workspace's draft is not New's to discard: it comes back.
    expect(ownDraft(SCRATCH)?.text).toBe('{"scratch":1}');
    expect(titleInput().value).toBe('Scratch work');
    expect(container.textContent).not.toContain('Restore draft');
  });

  it('brings a saved document’s unsaved edits back after a reload, unsaved', async () => {
    await render();
    await rename('Edited, then reloaded');
    await settle();
    await reload();

    expect(titleInput().value).toBe('Edited, then reloaded');
    expect(button('Save')).toBeTruthy();
    expect(container.textContent).toContain('Unsaved changes');
    expect(wire.updateRunestone).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('changed on the server');
  });

  it('asks which version to keep when the server copy moved on since the edits', async () => {
    const older = { ...DOC, content: '{"a":0}' };
    putOwn(docWorkspace(DOC.id), {
      title: 'Local edits',
      text: '{"a":"local"}',
      format: 'json',
      baseline: baselineOf(older),
    });
    await render();

    expect(container.textContent).toContain('This document changed on the server');
    expect(titleInput().value).toBe('Local edits');
    // Nothing overwritten while the person decides: the server copy is on the server.
    expect(ownDraft(docWorkspace(DOC.id))?.text).toBe('{"a":"local"}');

    await click(button('Keep local draft'));
    await settle();
    expect(container.textContent).not.toContain('changed on the server');
    expect(ownDraft(docWorkspace(DOC.id))?.baseline).toEqual(baselineOf(DOC));

    await reload();
    expect(container.textContent).not.toContain('changed on the server');
    expect(titleInput().value).toBe('Local edits');
  });

  it('takes the server copy instead when asked, and drops the local edits', async () => {
    putOwn(docWorkspace(DOC.id), {
      title: 'Local edits',
      text: '{"a":"local"}',
      format: 'json',
      baseline: { hash: 'stale', modifiedAt: 0 },
    });
    await render();
    await click(button('Use server version'));
    await settle();
    expect(titleInput().value).toBe(DOC.name);
    expect(button('Saved')).toBeTruthy();
    expect(ownDraft(docWorkspace(DOC.id))).toBeNull();
  });

  it('keeps the draft when a save fails, and drops it once one succeeds', async () => {
    delete params.slug;
    putRunestoneSeed({ title: 'Unsaved', text: '{"keep":true}' });
    wire.saveRunestone.mockRejectedValueOnce(new Error('offline'));
    await render();
    await settle();
    expect(ownDraft(SCRATCH)?.text).toBe('{"keep":true}');
    await click(button('Save to Pensieve'));
    await settle(50);
    expect(ownDraft(SCRATCH)?.text).toBe('{"keep":true}');

    wire.saveRunestone.mockResolvedValueOnce({ ...DOC, name: 'Unsaved', content: '{"keep":true}' });
    await click(button('Save to Pensieve'));
    await settle();
    expect(ownDraft(SCRATCH)).toBeNull();
  });

  it('lets a hand-off win over this tab’s own scratch draft', async () => {
    delete params.slug;
    putOwn(SCRATCH, { title: 'Own scratch', text: '{"own":1}', baseline: null });
    putRunestoneSeed({ title: 'Handed over', text: '{"seed":1}' });
    await render();
    expect(titleInput().value).toBe('Handed over');
  });
});
