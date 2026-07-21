import { describe, expect, it } from 'vitest';
import { LogTap, parseLogLine } from './logtap.js';

function line(obj: Record<string, unknown>): string {
  return `${JSON.stringify(obj)}\n`;
}

describe('parseLogLine', () => {
  it('parses a pino JSON line into a readable entry', () => {
    const entry = parseLogLine(
      line({ level: 40, time: 1700, module: 'heimdall', msg: 'bad pin', ip: '1.2.3.4', pid: 9 }),
    );
    expect(entry).toMatchObject({
      level: 40,
      levelLabel: 'warn',
      module: 'heimdall',
      msg: 'bad pin',
      time: 1700,
    });
    // pid/hostname/standard keys are stripped; structured extras are kept.
    expect(entry?.extra).toEqual({ ip: '1.2.3.4' });
  });

  it('returns null for blank or non-JSON lines', () => {
    expect(parseLogLine('')).toBeNull();
    expect(parseLogLine('   ')).toBeNull();
    expect(parseLogLine('not json')).toBeNull();
  });

  it('defaults a missing module to null and unknown level to info', () => {
    const entry = parseLogLine(line({ msg: 'hi' }));
    expect(entry?.module).toBeNull();
    expect(entry?.levelLabel).toBe('info');
    expect(entry?.extra).toBeUndefined();
  });
});

describe('LogTap', () => {
  it('buffers recent lines oldest-first and trims to capacity', () => {
    const tap = new LogTap(2);
    tap.writeLine(line({ level: 30, msg: 'a' }));
    tap.writeLine(line({ level: 30, msg: 'b' }));
    tap.writeLine(line({ level: 30, msg: 'c' }));
    expect(tap.recent().map((e) => e.msg)).toEqual(['b', 'c']);
  });

  it('ignores unparseable lines', () => {
    const tap = new LogTap();
    tap.writeLine('garbage');
    expect(tap.recent()).toHaveLength(0);
  });

  it('fans new lines out to live subscribers until unsubscribed', () => {
    const tap = new LogTap();
    const seen: string[] = [];
    const off = tap.subscribe((e) => seen.push(e.msg));
    tap.writeLine(line({ level: 30, msg: 'first' }));
    off();
    tap.writeLine(line({ level: 30, msg: 'second' }));
    expect(seen).toEqual(['first']);
  });
});
