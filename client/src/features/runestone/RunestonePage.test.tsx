// @vitest-environment jsdom
/**
 * The "New" head action (one blank buffer without leaving the page). Runestone
 * is the representative editor here: Edda, Groot and Atlas carry the same
 * `startNew` over the same phase/docId/snapshot/draft machinery, so what is
 * pinned is the behaviour they share — a saved document releases its slug, the
 * confirm is honoured, and the cached draft does not come back to haunt it.
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
  fetchRunestoneConfig: vi.fn(),
  saveRunestone: vi.fn(),
  updateRunestone: vi.fn(),
}));
vi.mock('../../core/runestone', () => wire);

import { RunestonePage } from './RunestonePage';
import { clearDraft, loadDraft, saveDraft } from './draft';

const DOC = {
  id: 'doc-1',
  name: 'Gleaming Gungnir',
  slug: 'gleaming-gungnir-abc123',
  authorDeviceId: null,
  sizeBytes: 9,
  createdAt: 0,
  modifiedAt: 0,
  content: '{"a":1}',
};

describe('RunestonePage — New', () => {
  let container: HTMLDivElement;
  let root: Root;

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
    clearDraft();
    vi.clearAllMocks();
    // jsdom's own confirm() is a not-implemented stub; every test says
    // explicitly what the person answered.
    vi.stubGlobal('confirm', vi.fn(() => true));
    wire.fetchRunestoneConfig.mockResolvedValue({ maxDocKb: 2048 });
    wire.fetchRunestone.mockResolvedValue(DOC);
    params.slug = DOC.slug;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
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

  it('drops the cached draft, so the restore prompt does not offer it back', async () => {
    saveDraft({ title: 'Older scratch', text: '{"old":true}', savedAt: Date.now() });

    await render();
    await click(button('New'));

    expect(loadDraft()).toBeNull();
    expect(container.textContent).not.toContain('Restore the draft');
  });
});
