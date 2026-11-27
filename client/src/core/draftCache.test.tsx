// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, act, useEffect, useMemo } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  useDraftOffer,
  useWorkspaceDraft,
  type Hydration,
  type OfferState,
  type WorkspaceDraft,
} from './draftCache';
import { memoryBackend } from './drafts/coordinator';
import { legacyTextParse, textDraftCodec, type TextDraft } from './drafts/documents';
import { OFFER_GRACE_MS, registerLifetime, writeDeparture } from './drafts/protocol';
import { SCRATCH, makeEnvelope, recordKey } from './drafts/records';
import { browserLocalStorage } from './drafts/storage';
import { installTestSession, uninstallTestSession } from './drafts/testing';
import { draftSession } from './drafts/session';
import { log } from './log';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface Props {
  text: string;
  workspace?: string | null;
  hydrateOn?: string | null;
  onHydrate?: (hydration: Hydration<TextDraft>) => void;
}

let api: WorkspaceDraft<TextDraft>;

function Editor({ text, workspace = SCRATCH, hydrateOn = workspace, onHydrate }: Props) {
  const payload = useMemo<TextDraft>(() => ({ title: 'Now', text, baseline: null }), [text]);
  api = useWorkspaceDraft<TextDraft>({
    feature: 'runestone',
    workspace,
    payload,
    keep: text.trim() !== '',
    codec: textDraftCodec,
  });
  const { ready, hydrate } = api;
  useEffect(() => {
    if (!ready || !hydrateOn) return;
    const hydration = hydrate(hydrateOn);
    onHydrate?.(hydration);
  }, [ready, hydrateOn]);
  return null;
}

describe('useWorkspaceDraft (PLAN-43)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let tab: string;

  const render = async (props: Props, strict = false) => {
    await act(async () => {
      root.render(
        strict ? (
          <StrictMode>
            <Editor {...props} />
          </StrictMode>
        ) : (
          <Editor {...props} />
        ),
      );
    });
  };
  const settle = async (ms = 500) => {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  };
  const stored = (workspace = SCRATCH, owner = tab): string | null => {
    const raw = localStorage.getItem(recordKey('runestone', owner, workspace));
    return raw === null ? null : (JSON.parse(raw) as { payload: TextDraft }).payload.text;
  };
  const putOther = (owner: string, text: string, workspace = SCRATCH) =>
    localStorage.setItem(
      recordKey('runestone', owner, workspace),
      JSON.stringify(
        makeEnvelope(
          { feature: 'runestone', tab: owner, workspace },
          { title: 'O', text, baseline: null },
          1,
        ),
      ),
    );

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    localStorage.clear();
    const session = installTestSession();
    tab = session.me()?.tab ?? '';
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    uninstallTestSession();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('mirrors the buffer into this tab’s own key after the debounce', async () => {
    await render({ text: '' });
    await render({ text: '{"a":1}' });
    await settle(499);
    expect(stored()).toBeNull();
    await settle(1);
    expect(stored()).toBe('{"a":1}');
  });

  it('removes its own record when the buffer is emptied, and nothing else', async () => {
    putOther('tab-other', 'theirs');
    await render({ text: '{"a":1}' });
    await settle();
    await render({ text: '  ' });
    await settle();
    expect(stored()).toBeNull();
    expect(stored(SCRATCH, 'tab-other')).toBe('theirs');
  });

  it('flushes inside the debounce window on unmount and on pagehide, never removing', async () => {
    await render({ text: '{"a":1}' });
    await settle();
    await render({ text: '{"last":1}' });
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    expect(stored()).toBe('{"last":1}');
    await render({ text: '' });
    await act(async () => root.unmount());
    // Unmounted blank inside the window: the flush does not remove.
    expect(stored()).toBe('{"last":1}');
    root = createRoot(container);
  });

  it('writes nothing for a workspace until it is hydrated', async () => {
    putOther(tab, 'restorable');
    await render({ text: '', hydrateOn: null });
    await settle(2000);
    expect(stored()).toBe('restorable');
  });

  it('hydrates once per arrival, StrictMode included, and hands back this tab’s draft', async () => {
    putOther(tab, 'mine before reload');
    const seen: Hydration<TextDraft>[] = [];
    await render({ text: '', onHydrate: (hydration) => seen.push(hydration) }, true);
    expect(seen.map((hydration) => hydration.first)).toEqual([true, false]);
    expect(seen[0]?.own?.payload.text).toBe('mine before reload');
    expect(stored()).toBe('mine before reload');
  });

  it('keeps each workspace under its own key when the page switches between them', async () => {
    await render({ text: 'doc one edits', workspace: 'doc:1' });
    // Straight to another document: the first is flushed under its own key.
    await render({ text: 'doc one edits', workspace: 'doc:2', hydrateOn: 'doc:2' });
    await render({ text: 'doc two edits', workspace: 'doc:2', hydrateOn: 'doc:2' });
    await settle();
    expect(stored('doc:1')).toBe('doc one edits');
    expect(stored('doc:2')).toBe('doc two edits');
  });

  it('clears only this tab’s record for the workspace, and a flush cannot bring it back', async () => {
    putOther('tab-other', 'theirs');
    await render({ text: 'saved now' });
    await settle();
    await act(async () => api.clear());
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    expect(stored()).toBeNull();
    expect(stored(SCRATCH, 'tab-other')).toBe('theirs');
    await render({ text: 'typed after saving' });
    await settle();
    expect(stored()).toBe('typed after saving');
  });

  it('reports a write that failed, and clears the report when one succeeds', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
    const quota = new DOMException('full', 'QuotaExceededError');
    const realSet = Storage.prototype.setItem;
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw quota;
    });
    await render({ text: 'too much' });
    await settle();
    expect(api.writeError).toBe('browser storage is full');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('browser storage is full'), {
      module: 'drafts',
    });
    setItem.mockImplementation(function (this: Storage, key: string, value: string) {
      realSet.call(this, key, value);
    });
    await render({ text: 'fits now' });
    await settle();
    expect(api.writeError).toBeNull();
    expect(stored()).toBe('fits now');
  });
});

describe('useDraftOffer (PLAN-43)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let offers: OfferState<TextDraft>;
  const backend = memoryBackend();
  const LEGACY = legacyTextParse((text) => text.trim() === '');

  function Offering({
    eligible = true,
    workspace = SCRATCH,
    text = '',
  }: {
    eligible?: boolean;
    workspace?: string;
    /** What is on screen. */
    text?: string;
  }) {
    offers = useDraftOffer<TextDraft>({
      feature: 'runestone',
      workspace,
      eligible,
      codec: textDraftCodec,
      worth: (draft) => draft.text.trim() !== '',
      legacy: LEGACY,
      // Rebuilt every render, as a page may: only a change of content counts.
      buffer: { title: '', text },
    });
    return null;
  }

  const render = async (eligible = true) => {
    await act(async () => {
      root.render(<Offering eligible={eligible} />);
    });
    // The search runs over a few promise turns.
    for (let i = 0; i < 5; i += 1) await act(async () => Promise.resolve());
  };

  const closedTab = async (text: string) => {
    const ctx = { local: browserLocalStorage(), backend, now: () => Date.now() };
    const other = { tab: 'tab-closed', instance: 'x1' };
    await registerLifetime(ctx, other);
    localStorage.setItem(
      recordKey('runestone', other.tab, SCRATCH),
      JSON.stringify(
        makeEnvelope(
          { feature: 'runestone', tab: other.tab, workspace: SCRATCH },
          { title: 'C', text, baseline: null },
          7,
        ),
      ),
    );
    writeDeparture(ctx.local, other, Date.now() - OFFER_GRACE_MS);
    return recordKey('runestone', other.tab, SCRATCH);
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    backend.entries.clear();
    installTestSession({ backend });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    uninstallTestSession();
  });

  it('offers a closed tab’s draft and moves it here on Restore', async () => {
    const source = await closedTab('left in a closed tab');
    await render();
    expect(offers.offer).toMatchObject({ kind: 'tab', payload: { text: 'left in a closed tab' } });
    let restored: TextDraft | null = null;
    await act(async () => {
      restored = await offers.accept();
    });
    expect(restored).toMatchObject({ text: 'left in a closed tab' });
    expect(localStorage.getItem(source)).toBeNull();
    expect(offers.offer).toBeNull();
  });

  it('does not offer a dismissed draft again after a reload, and leaves it where it is', async () => {
    const source = await closedTab('not wanted');
    await render();
    await act(async () => offers.dismiss());
    for (let i = 0; i < 5; i += 1) await act(async () => Promise.resolve());
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    expect(offers.offer).toBeNull();
    expect(localStorage.getItem(source)).not.toBeNull();
  });

  it('restores once for a double click, without a false "no longer available"', async () => {
    await closedTab('clicked twice');
    await render();
    let results: (TextDraft | null)[] = [];
    await act(async () => {
      results = await Promise.all([offers.accept(), offers.accept()]);
    });
    expect(results.filter((result) => result !== null)).toHaveLength(1);
    expect(offers.error).toBeNull();
  });

  it('keeps a restore that lands after the page moved on in its own workspace, not on screen', async () => {
    await closedTab('for the scratch editor');
    await render();
    const tab = draftSession().me()?.tab ?? '';
    // Hold the transfer until the person has opened a saved document.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    backend.delay = () => held;
    let pending: Promise<TextDraft | null> = Promise.resolve(null);
    await act(async () => {
      pending = offers.accept();
    });
    await act(async () => {
      root.render(<Offering workspace="doc:1" />);
    });
    backend.delay = () => Promise.resolve();
    release();
    let restored: TextDraft | null | undefined;
    await act(async () => {
      restored = await pending;
    });
    expect(restored).toBeNull();
    expect(localStorage.getItem(recordKey('runestone', tab, SCRATCH))).toContain(
      'for the scratch editor',
    );
  });

  it('never replaces what was typed while the restore ran, and keeps the offered draft', async () => {
    const source = await closedTab('left in a closed tab');
    await render();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    backend.delay = () => held;
    let pending: Promise<TextDraft | null> = Promise.resolve(null);
    await act(async () => {
      pending = offers.accept();
    });
    // Typed while the claim waits; the mirror has not written it yet.
    await act(async () => {
      root.render(<Offering text="typed while restoring" />);
    });
    backend.delay = () => Promise.resolve();
    release();
    let restored: TextDraft | null | undefined;
    await act(async () => {
      restored = await pending;
    });
    expect(restored).toBeNull();
    expect(offers.error).toBeNull();
    expect(localStorage.getItem(source)).toContain('left in a closed tab');
    const tab = draftSession().me()?.tab ?? '';
    expect(localStorage.getItem(recordKey('runestone', tab, SCRATCH))).toBeNull();
  });

  it('restores over a re-render that changed nothing on screen', async () => {
    await closedTab('left in a closed tab');
    await render();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    backend.delay = () => held;
    let pending: Promise<TextDraft | null> = Promise.resolve(null);
    await act(async () => {
      pending = offers.accept();
    });
    await act(async () => {
      root.render(<Offering text="" />);
    });
    backend.delay = () => Promise.resolve();
    release();
    let restored: TextDraft | null | undefined;
    await act(async () => {
      restored = await pending;
    });
    expect(restored).toMatchObject({ text: 'left in a closed tab' });
  });

  it('leaves the draft where it is when dismissed', async () => {
    const source = await closedTab('not now');
    await render();
    await act(async () => offers.dismiss());
    expect(offers.offer).toBeNull();
    expect(localStorage.getItem(source)).not.toBeNull();
  });

  it('offers nothing when the page says not to (its own draft or a hand-off came first)', async () => {
    await closedTab('ignored');
    await render(false);
    expect(offers.offer).toBeNull();
  });

  it('falls back to the draft saved before the update, only when no tab has one', async () => {
    localStorage.setItem(
      'bifrost.runestone.draft',
      JSON.stringify({ title: 'Old', text: '{"o":1}', savedAt: 3 }),
    );
    await render();
    expect(offers.offer).toMatchObject({ kind: 'legacy', payload: { text: '{"o":1}' } });
    await act(async () => root.unmount());
    root = createRoot(container);
    await closedTab('a closed tab first');
    await render();
    expect(offers.offer).toMatchObject({ kind: 'tab' });
  });

  it('says so when the draft was taken elsewhere first', async () => {
    const source = await closedTab('raced');
    await render();
    localStorage.removeItem(source);
    await act(async () => {
      await offers.accept();
    });
    expect(offers.offer).toBeNull();
    expect(offers.error).toMatch(/no longer available/);
  });
});
