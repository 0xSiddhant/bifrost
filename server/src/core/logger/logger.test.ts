import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { Writable } from 'node:stream';
import pino from 'pino';
import { clientLogger, LEVEL_FORMATTER, moduleLogger, rollOptions } from './index.js';

/** Run `fn` against a real pino logger and return what it actually serialized. */
function emit(fn: (log: pino.Logger) => void): { raw: string[]; lines: Record<string, unknown>[] } {
  const raw: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      raw.push(chunk.toString());
      callback();
    },
  });
  fn(pino({ level: 'trace', formatters: LEVEL_FORMATTER }, destination));
  return { raw, lines: raw.map((line) => JSON.parse(line) as Record<string, unknown>) };
}

describe('rollOptions', () => {
  it('rolls daily with a 20MB cap and a stable symlink for tailing', () => {
    const options = rollOptions('/var/bifrost/storage/logs', 30);
    expect(options.file).toBe(path.join('/var/bifrost/storage/logs', 'app'));
    expect(options.extension).toBe('.log');
    expect(options.frequency).toBe('daily');
    expect(options.size).toBe('20m');
    expect(options.symlink).toBe(true);
    expect(options.mkdir).toBe(true);
  });

  it('passes LOG_RETENTION_FILES through as pino-roll’s file-count limit', () => {
    expect(rollOptions('/logs', 7).limit.count).toBe(7);
  });

  // Without this, pino-roll counts only files the CURRENT process wrote — and
  // Bifrost restarts constantly, so every restart would start a fresh tally and
  // old files would accumulate forever, defeating the point of the limit.
  it('sweeps files left by earlier processes, not just this one', () => {
    expect(rollOptions('/logs', 7).limit.removeOtherLogFiles).toBe(true);
  });
});

describe('level formatter', () => {
  it('writes the level as text under `logLevel` at every level', () => {
    const { lines } = emit((log) => {
      log.trace('t');
      log.debug('d');
      log.info('i');
      log.warn('w');
      log.error('e');
      log.fatal('f');
    });
    expect(lines.map((line) => line.logLevel)).toEqual([
      'trace',
      'debug',
      'info',
      'warn',
      'error',
      'fatal',
    ]);
  });

  // The numeric key stays on purpose. `pino.transport()` with more than one
  // target re-parses each serialized line in a worker to route it, and that
  // router keys on the numeric level — with the key gone it matched nothing and
  // dropped EVERY line, so the file and dev stdout both went silently empty.
  // Alloy promotes only `logLevel`, so the pair never reaches Loki.
  it('keeps the numeric `level` beside it, or the transport router drops the line', () => {
    const { lines } = emit((log) => log.info('hello'));
    expect(lines[0]).toHaveProperty('logLevel', 'info');
    expect(lines[0]).toHaveProperty('level', 30);
  });
});

describe('source bindings', () => {
  it('tags server lines with the module name and source=server', () => {
    const { lines } = emit((log) => moduleLogger(log, 'accio').warn('title fetch failed'));
    expect(lines[0]).toMatchObject({ source: 'server', module: 'accio', logLevel: 'warn' });
  });

  it('tags relayed browser lines with the feature name and source=client', () => {
    const { lines } = emit((log) => clientLogger(log, 'accio').error('render blew up'));
    expect(lines[0]).toMatchObject({ source: 'client', module: 'accio', logLevel: 'error' });
  });

  // Criterion 16a. Both loggers are siblings of the root, so each line carries
  // exactly one `source`.
  it('never writes two `source` keys on one line', () => {
    const { raw } = emit((log) => {
      moduleLogger(log, 'client-logs').info('batch accepted');
      clientLogger(log, 'accio').error('boom');
    });
    for (const line of raw) expect(line.match(/"source"/g)).toHaveLength(1);
  });

  // The trap, pinned so that "simplify" doesn't turn clientLogger(root, …) into
  // deps.log.child(…): pino APPENDS child bindings to the parent's rather than
  // overriding them, so a descendant that rebinds `source` emits it twice.
  // Every parser in the chain happens to take the last occurrence, which is why
  // the bug stays invisible until a dashboard panel is quietly mislabelled.
  it('duplicates the key when a DESCENDANT rebinds it — why clientLogger takes the root', () => {
    const { raw } = emit((log) =>
      moduleLogger(log, 'client-logs').child({ source: 'client' }).error('boom'),
    );
    expect(raw[0]?.match(/"source"/g)).toHaveLength(2);
  });
});
