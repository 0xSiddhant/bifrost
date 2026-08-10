import { describe, expect, it } from 'vitest';
import { LIBRARY_REGISTRY, availableKinds, entryFor } from './registry';
import type { LibraryItem, LibraryKind } from './types';

/**
 * The real registry, not a fake one. `load.test.ts` proves the *mechanism* with
 * an invented kind; this proves the three entries that actually ship are wired
 * to the right module and the right URLs — a typo in `apiRoute` is invisible
 * until someone opens a data URL, and no mechanism test would catch it.
 */

const item = (kind: LibraryKind, slug: string): LibraryItem => ({
  kind,
  id: slug.slice(-6),
  name: 'Something',
  slug,
  authorDeviceId: null,
  sizeBytes: 1,
  createdAt: 0,
  modifiedAt: 0,
});

describe('the shipped registry', () => {
  it('holds one entry per document kind, each gated on its own module', () => {
    expect(LIBRARY_REGISTRY.map((entry) => entry.kind)).toEqual(['runestone', 'edda', 'groot']);
    for (const entry of LIBRARY_REGISTRY) {
      expect(entry.module).toBe(entry.kind);
    }
  });

  it('gives every kind its own badge colour, so a type stays recognisable when re-sorted', () => {
    const tones = LIBRARY_REGISTRY.map((entry) => entry.tone);
    expect(new Set(tones).size).toBe(tones.length);
  });

  it('labels kinds by format rather than by tool name', () => {
    expect(LIBRARY_REGISTRY.map((entry) => entry.label)).toEqual(['JSON', 'Markdown', 'YAML']);
  });

  it('routes groot rows to the editor and to the public data URL', () => {
    const groot = entryFor(LIBRARY_REGISTRY, 'groot');
    expect(groot).toBeDefined();
    const row = item('groot', 'deploy-values-abc123');
    expect(groot!.editorRoute(row)).toBe('/groot/deploy-values-abc123');
    expect(groot!.apiRoute?.(row)).toBe('/groot/api/deploy-values-abc123');
    // YAML has no rendered read-only page the way Edda's preview does.
    expect(groot!.readRoute).toBeUndefined();
  });

  it('subscribes to the events the groot module actually emits', () => {
    expect(entryFor(LIBRARY_REGISTRY, 'groot')!.events).toEqual(['groot.saved', 'groot.deleted']);
  });

  it('drops groot entirely from a profile that does not serve it', () => {
    const kinds = availableKinds(LIBRARY_REGISTRY, (module) => module !== 'groot');
    expect(kinds.map((entry) => entry.kind)).toEqual(['runestone', 'edda']);
  });
});
