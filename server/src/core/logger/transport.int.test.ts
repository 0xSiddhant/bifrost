import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLogger } from './index.js';

/**
 * The one property nothing else checks: lines actually reach the file.
 *
 * Every other logger test writes to an injected in-memory stream, which is a
 * different code path from the real one — `createLogger` builds a
 * `pino.transport()` with TWO targets (the rotating file and, in dev,
 * pino-pretty), and that runs a worker thread which **re-parses each serialized
 * line** to decide which targets it belongs to. Formatters that change the
 * shape of a line can therefore make the router match nothing and drop
 * everything, with no error anywhere: the file simply stays empty. That is
 * exactly what happened when the numeric `level` key was removed.
 */
describe('createLogger → real transport', () => {
  let logsDir: string;

  beforeEach(() => {
    logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-logsink-'));
  });

  afterEach(() => {
    fs.rmSync(logsDir, { recursive: true, force: true });
  });

  const readLines = (): Record<string, unknown>[] =>
    fs
      .readFileSync(path.join(logsDir, 'app.1.log'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);

  // `pretty: true` is the dev shape — two targets, i.e. the routing worker.
  it('writes through the multi-target transport, level names and all', async () => {
    const logger = createLogger({ level: 'trace', logsDir, pretty: true, retainFiles: 3 });
    logger.child({ source: 'server', module: 'boot' }).info('module loaded');
    logger.child({ source: 'server', module: 'boot' }).trace('trace reaches disk');
    await new Promise<void>((resolve) => logger.flush(() => resolve()));
    await new Promise((resolve) => setTimeout(resolve, 300));

    const lines = readLines();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      logLevel: 'info',
      source: 'server',
      module: 'boot',
      msg: 'module loaded',
    });
    // Criterion 10a: trace is not merely configured, it lands.
    expect(lines[1]).toMatchObject({ logLevel: 'trace', msg: 'trace reaches disk' });
  });

  it('writes through a single-target transport too (production shape)', async () => {
    const logger = createLogger({ level: 'trace', logsDir, pretty: false, retainFiles: 3 });
    logger.info('production line');
    await new Promise<void>((resolve) => logger.flush(() => resolve()));
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(readLines()[0]).toMatchObject({ logLevel: 'info', msg: 'production line' });
  });

  it('symlinks current.log at the active file, which npm run logs tails', async () => {
    const logger = createLogger({ level: 'info', logsDir, pretty: false, retainFiles: 3 });
    logger.info('anything');
    await new Promise<void>((resolve) => logger.flush(() => resolve()));
    await new Promise((resolve) => setTimeout(resolve, 300));

    const link = path.join(logsDir, 'current.log');
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(link, 'utf8')).toContain('anything');
  });
});
