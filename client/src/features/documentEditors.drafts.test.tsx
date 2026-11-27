// @vitest-environment jsdom
/**
 * The guard every document editor must keep (PLAN-43, after the code review
 * of #122): while a saved document's local edits and a newer server copy
 * disagree, Save stays off until the person picks one, so a click can never
 * put stale local edits over the server's. Each editor builds its own Save
 * button, so this runs against all four rather than trusting that they agree.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const params: { slug?: string } = {};
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => params,
}));

const wire = vi.hoisted(() => ({
  runestone: {
    fetchRunestone: vi.fn(),
    saveRunestone: vi.fn(),
    updateRunestone: vi.fn(),
    RUNESTONE_CONFIG: { maxDocKb: 2048 },
  },
  edda: {
    fetchEdda: vi.fn(),
    saveEdda: vi.fn(),
    updateEdda: vi.fn(),
    EDDA_CONFIG: { maxDocKb: 2048, livePreviewMaxKb: 512 },
  },
  groot: {
    fetchGroot: vi.fn(),
    saveGroot: vi.fn(),
    updateGroot: vi.fn(),
    GROOT_CONFIG: { maxDocKb: 2048 },
  },
  atlas: {
    fetchAtlas: vi.fn(),
    saveAtlas: vi.fn(),
    updateAtlas: vi.fn(),
    ATLAS_CONFIG: { maxDocKb: 2048 },
  },
}));
vi.mock('../core/runestone', () => wire.runestone);
vi.mock('../core/edda', () => wire.edda);
vi.mock('../core/groot', () => wire.groot);
vi.mock('../core/atlas', () => wire.atlas);

import { RunestonePage } from './runestone/RunestonePage';
import { EddaPage } from './edda/EddaPage';
import { GrootPage } from './groot/GrootPage';
import { AtlasPage } from './atlas/AtlasPage';
import { docWorkspace, makeEnvelope, recordKey, type DraftFeature } from '../core/drafts/records';
import { installTestSession, uninstallTestSession } from '../core/drafts/testing';
import type { TextDraft } from '../core/drafts/documents';

const plist = (value: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n  <key>k</key>\n  <string>${value}</string>\n</dict>\n</plist>\n`;

interface Editor {
  feature: Exclude<DraftFeature, 'variant'>;
  Page: ComponentType;
  fetch: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  server: string;
  local: string;
}

const EDITORS: Editor[] = [
  {
    feature: 'runestone',
    Page: RunestonePage,
    fetch: wire.runestone.fetchRunestone,
    update: wire.runestone.updateRunestone,
    server: '{"a":"server"}',
    local: '{"a":"local"}',
  },
  {
    feature: 'edda',
    Page: EddaPage,
    fetch: wire.edda.fetchEdda,
    update: wire.edda.updateEdda,
    server: '# Server\n',
    local: '# Local edits\n',
  },
  {
    feature: 'groot',
    Page: GrootPage,
    fetch: wire.groot.fetchGroot,
    update: wire.groot.updateGroot,
    server: 'source: server\n',
    local: 'source: local\n',
  },
  {
    feature: 'atlas',
    Page: AtlasPage,
    fetch: wire.atlas.fetchAtlas,
    update: wire.atlas.updateAtlas,
    server: plist('server'),
    local: plist('local'),
  },
];

describe.each(EDITORS)('$feature: Save while a draft conflicts with the server', (editor) => {
  let container: HTMLDivElement;
  let root: Root;
  let tab: string;

  const doc = {
    id: `${editor.feature}-1`,
    name: 'On the server',
    slug: `on-the-server-abc123`,
    authorDeviceId: null,
    sizeBytes: editor.server.length,
    createdAt: 0,
    modifiedAt: 5,
    content: editor.server,
    format: editor.feature === 'runestone' ? 'json' : undefined,
  };

  const button = (label: string): HTMLButtonElement => {
    const found = [...container.querySelectorAll('button')].find(
      (el) => el.textContent?.trim() === label,
    );
    if (!found) throw new Error(`no button labelled "${label}"`);
    return found;
  };
  const settle = async (ms = 600) => {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, ms));
    });
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const empty = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] });
    Range.prototype.getClientRects = empty as unknown as () => DOMRectList;
    Range.prototype.getBoundingClientRect = () => new DOMRect();
    localStorage.clear();
    sessionStorage.clear();
    tab = installTestSession().me()?.tab ?? '';
    vi.clearAllMocks();
    editor.fetch.mockResolvedValue(doc);
    params.slug = doc.slug;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    uninstallTestSession();
  });

  it('keeps Save off until the person picks a version, and sends nothing meanwhile', async () => {
    const workspace = docWorkspace(doc.id);
    // Local edits made against an older server copy than the one on the server now.
    const draft: TextDraft = {
      title: 'Local edits',
      text: editor.local,
      ...(editor.feature === 'runestone' ? { format: 'json' } : {}),
      baseline: { hash: 'an older server copy', modifiedAt: 1 },
    };
    localStorage.setItem(
      recordKey(editor.feature, tab, workspace),
      JSON.stringify(makeEnvelope({ feature: editor.feature, tab, workspace }, draft, 1)),
    );
    await act(async () => {
      root.render(<editor.Page />);
    });
    await settle();

    expect(container.textContent).toContain('changed on the server');
    expect(button('Save').disabled).toBe(true);
    await act(async () => {
      button('Save').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(editor.update).not.toHaveBeenCalled();

    await act(async () => {
      button('Keep local draft').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle(400);
    expect(button('Save').disabled).toBe(false);
  });
});
