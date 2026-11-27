import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import type { Logger } from '../../../core/logger/index.js';
import { FsFolderArchiver } from './fs-folder-archiver.js';

describe('FsFolderArchiver', () => {
  let directory: string;

  afterEach(() => {
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  });

  it('fails the archive stream when a listed file has disappeared', async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-archive-'));
    const stream = new FsFolderArchiver(pino({ level: 'silent' }) as Logger).stream(
      directory,
      ['missing.txt'],
    );
    const consume = (async () => {
      for await (const chunk of stream) void chunk;
    })();

    await expect(consume).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
