import { describe, expect, it } from 'vitest';
import { DownloadFolderLock } from './download-folder-lock.js';

describe('DownloadFolderLock', () => {
  it('serializes folder publishing and deletion operations by folder name', async () => {
    const lock = new DownloadFolderLock();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = lock.run('Trip photos', async () => {
      order.push('first started');
      await firstCanFinish;
      order.push('first finished');
    });
    const second = lock.run('Trip photos', async () => {
      order.push('second started');
    });

    await Promise.resolve();
    expect(order).toEqual(['first started']);

    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['first started', 'first finished', 'second started']);
  });
});
