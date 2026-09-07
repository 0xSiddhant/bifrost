import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CliError,
  EXIT,
  formatBytes,
  formatWhen,
  isJsonMode,
  note,
  print,
  printError,
  setJsonMode,
  table,
  warn,
} from './output.js';

function captureStdout(): { text: () => string; restore: () => void } {
  let text = '';
  const spy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      text += String(chunk);
      return true;
    });
  return { text: () => text, restore: () => spy.mockRestore() };
}

function captureStderr(): { text: () => string; restore: () => void } {
  let text = '';
  const spy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      text += String(chunk);
      return true;
    });
  return { text: () => text, restore: () => spy.mockRestore() };
}

afterEach(() => {
  setJsonMode(false);
  vi.restoreAllMocks();
});

describe('json mode', () => {
  it('serializes the data and never calls the human renderer', () => {
    setJsonMode(true);
    expect(isJsonMode()).toBe(true);
    const render = vi.fn(() => 'a human sentence');
    const out = captureStdout();

    print({ ok: true, count: 2 }, render);
    const text = out.text();
    out.restore();

    expect(render).not.toHaveBeenCalled();
    expect(JSON.parse(text)).toEqual({ ok: true, count: 2 });
    expect(text).not.toContain('a human sentence');
  });

  it('keeps chatter off stdout entirely', () => {
    setJsonMode(true);
    const out = captureStdout();
    const err = captureStderr();

    note('pulling notes.txt…');
    const stdout = out.text();
    const stderr = err.text();
    out.restore();
    err.restore();

    expect(stdout).toBe('');
    expect(stderr).toBe('');
  });

  it('reports errors as JSON on stderr, leaving stdout parseable', () => {
    setJsonMode(true);
    const out = captureStdout();
    const err = captureStderr();

    printError('no such file');
    const stdout = out.text();
    const stderr = err.text();
    out.restore();
    err.restore();

    expect(stdout).toBe('');
    expect(JSON.parse(stderr)).toEqual({ error: 'no such file' });
  });
});

describe('human mode', () => {
  it('prints the rendered text on stdout and chatter on stderr', () => {
    const out = captureStdout();
    const err = captureStderr();

    print({ count: 2 }, (value) => `${value.count} accepted`);
    note('open Send on any device');
    warn('couldn’t save the config');

    const stdout = out.text();
    const stderr = err.text();
    out.restore();
    err.restore();

    expect(stdout).toBe('2 accepted\n');
    expect(stderr).toBe('open Send on any device\nwarning: couldn’t save the config\n');
  });

  it('writes errors as one line, never a stack', () => {
    const err = captureStderr();
    printError('pushing files failed: HTTP 400');
    const text = err.text();
    err.restore();

    expect(text).toBe('error: pushing files failed: HTTP 400\n');
  });
});

describe('table', () => {
  it('aligns a known fixture, right-aligning the numeric column', () => {
    const rows = [
      { name: 'notes.txt', size: '12 B' },
      { name: 'a-much-longer-name.bin', size: '2.0 KB' },
    ];
    expect(
      table(rows, [
        { header: 'NAME', value: (row) => row.name },
        { header: 'SIZE', value: (row) => row.size, align: 'right' },
      ]),
    ).toBe(
      [
        // The header sits in its column's alignment too, so a right-aligned
        // SIZE reads over the values rather than off to their left.
        'NAME                      SIZE',
        '----------------------  ------',
        'notes.txt                 12 B',
        'a-much-longer-name.bin  2.0 KB',
      ].join('\n'),
    );
  });

  it('is empty for no rows, so the caller can say something better', () => {
    expect(table([], [{ header: 'NAME', value: () => '' }])).toBe('');
  });
});

describe('formatting helpers', () => {
  it('scales bytes into binary units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(2000)).toBe('2.0 KB');
    expect(formatBytes(1024 * 1024 * 3.5)).toBe('3.5 MB');
    expect(formatBytes(-1)).toBe('—');
  });

  it('renders an em dash rather than 1970 for a missing timestamp', () => {
    expect(formatWhen(0)).toBe('—');
    expect(formatWhen(Number.NaN)).toBe('—');
    expect(formatWhen(Date.now())).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});

describe('CliError', () => {
  it('defaults to exit 1 and carries a specific code when given one', () => {
    expect(new CliError('boom').exitCode).toBe(EXIT.failure);
    expect(new CliError('gone', EXIT.notFound).exitCode).toBe(4);
  });
});
