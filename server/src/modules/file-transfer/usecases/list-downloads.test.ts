import { describe, expect, it } from 'vitest';
import type { DownloadEntry } from '../../../core/bus/events.js';
import type { DownloadRegistry } from '../ports.js';
import { ListDownloadsUseCase } from './list-downloads.js';

const entry = (over: Partial<DownloadEntry> & { id: string; name: string }): DownloadEntry => ({
  size: 1,
  mtime: 1,
  ext: '',
  type: 'file',
  parent: null,
  ...over,
});

/**
 * PLAN-24 keeps **one** listing endpoint: root files, folder rows and nested
 * files all come back in one flat array, sorted the same way as before, and the
 * client filters by `parent` for whichever view is open. Pinned rather than
 * assumed, since "the usecase is unaffected" is exactly the kind of claim that
 * quietly stops being true.
 */
describe('ListDownloadsUseCase', () => {
  it('returns folders and nested files in the one flat, mtime-desc array', () => {
    const list: DownloadEntry[] = [
      entry({ id: 'a', name: 'a.jpg', parent: 'Trip photos', mtime: 30 }),
      entry({ id: 'f', name: 'Trip photos', type: 'folder', size: 0, mtime: 20 }),
      entry({ id: 'r', name: 'loose.txt', mtime: 10 }),
    ];
    const registry: DownloadRegistry = { list: () => list, resolveEntry: () => null };

    const result = new ListDownloadsUseCase(registry).execute();

    expect(result.map((e) => e.name)).toEqual(['a.jpg', 'Trip photos', 'loose.txt']);
    expect(result.find((e) => e.name === 'Trip photos')).toMatchObject({
      type: 'folder',
      parent: null,
    });
    expect(result.find((e) => e.name === 'a.jpg')).toMatchObject({ parent: 'Trip photos' });
  });

  it('does not mutate the registry’s own array while sorting', () => {
    const list = [entry({ id: 'a', name: 'a', mtime: 1 }), entry({ id: 'b', name: 'b', mtime: 9 })];
    const registry: DownloadRegistry = { list: () => list, resolveEntry: () => null };

    new ListDownloadsUseCase(registry).execute();

    expect(list.map((e) => e.name)).toEqual(['a', 'b']);
  });
});
