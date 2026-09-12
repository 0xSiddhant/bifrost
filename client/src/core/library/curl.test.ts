import { describe, expect, it } from 'vitest';
import { buildCurlCommand } from './curl';
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
    list: async () => [],
    remove: async () => null,
    editorRoute: (i) => `/runestone/${i.slug}`,
    ...partial,
  };
}

describe('buildCurlCommand', () => {
  it('builds an absolute-URL curl with an Accept header matching the endpoint', () => {
    const withRoute = entry({
      apiRoute: (i) => `/runestone/api/${i.slug}`,
      mimeType: 'application/json',
    });
    expect(buildCurlCommand(withRoute, item, 'http://bifrost.local:4646')).toBe(
      "curl -sS -H 'Accept: application/json' 'http://bifrost.local:4646/runestone/api/beta-config-aaa111'",
    );
  });

  it('returns null when the kind publishes no raw-data URL', () => {
    expect(buildCurlCommand(entry({}), item, 'http://bifrost.local:4646')).toBeNull();
  });

  it('returns null if apiRoute exists but mimeType was left off — the pairing is enforced at build time, not just by convention', () => {
    const missingMime = entry({ apiRoute: (i) => `/runestone/api/${i.slug}` });
    expect(buildCurlCommand(missingMime, item, 'http://bifrost.local:4646')).toBeNull();
  });
});
