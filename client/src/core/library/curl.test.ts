import { describe, expect, it } from 'vitest';
import { buildCurlCommand } from './curl';
import { LIBRARY_REGISTRY, entryFor } from './registry';
import type { LibraryEntry, LibraryItem } from './types';

const item: LibraryItem = {
  kind: 'runestone',
  id: 'aaa111',
  name: 'Beta config',
  slug: 'beta-config-aaa111',
  authorDeviceId: null,
  sizeBytes: 100,
  createdAt: 1_000,
  modifiedAt: 1_000,
};

function entry(partial: Partial<LibraryEntry>): LibraryEntry {
  return {
    kind: 'runestone',
    label: 'JSON',
    module: 'runestone',
    tone: 1,
    icon: null,
    events: [],
    noun: 'stone',
    newRoute: '/runestone',
    newLabel: 'New',
    listPage: async () => ({ items: [], total: 0, limit: 30, offset: 0, authors: [] }),
    remove: async () => null,
    editorRoute: (i) => `/runestone/${i.slug}`,
    ...partial,
  };
}

describe('buildCurlCommand', () => {
  it('builds an absolute-URL curl with an Accept header matching the endpoint', () => {
    const withRoute = entry({
      apiRoute: (i) => `/runestone/api/v1/${i.slug}`,
      mimeType: 'application/json',
    });
    expect(buildCurlCommand(withRoute, item, 'http://bifrost.local:4646')).toBe(
      "curl -sS -H 'Accept: application/json' 'http://bifrost.local:4646/runestone/api/v1/beta-config-aaa111'",
    );
  });

  it('returns null when the kind publishes no raw-data URL', () => {
    expect(buildCurlCommand(entry({}), item, 'http://bifrost.local:4646')).toBeNull();
  });

  it('returns null if apiRoute exists but mimeType was left off — the pairing is enforced at build time, not just by convention', () => {
    const missingMime = entry({ apiRoute: (i) => `/runestone/api/v1/${i.slug}` });
    expect(buildCurlCommand(missingMime, item, 'http://bifrost.local:4646')).toBeNull();
  });

  it('asks for each runestone in its own format (PLAN-42)', () => {
    const runestone = entryFor(LIBRARY_REGISTRY, 'runestone');
    if (!runestone) throw new Error('runestone entry missing');
    const origin = 'http://bifrost.local:4646';
    expect(buildCurlCommand(runestone, { ...item, format: 'jsonc' }, origin)).toBe(
      "curl -sS -H 'Accept: application/jsonc' 'http://bifrost.local:4646/runestone/api/v1/beta-config-aaa111'",
    );
    expect(buildCurlCommand(runestone, { ...item, format: 'json' }, origin)).toContain(
      "'Accept: application/json'",
    );
    // A row from a hub before PLAN-42 carries no format: strict JSON.
    expect(buildCurlCommand(runestone, item, origin)).toContain("'Accept: application/json'");
  });

  it('keeps one media type for a kind without per-row formats', () => {
    const edda = entryFor(LIBRARY_REGISTRY, 'edda');
    if (!edda) throw new Error('edda entry missing');
    expect(buildCurlCommand(edda, { ...item, kind: 'edda' }, 'http://h')).toContain(
      "'Accept: text/markdown'",
    );
  });
});
