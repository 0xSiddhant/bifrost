import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  accent,
  bad,
  CliError,
  colourEnabled,
  EXIT,
  fields,
  formatBytes,
  formatWhen,
  heading,
  isJsonMode,
  note,
  ok,
  plural,
  print,
  printError,
  progress,
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
    expect(stderr).toBe('open Send on any device\n⚠ warning: couldn’t save the config\n');
  });

  it('writes errors as one line, never a stack', () => {
    const err = captureStderr();
    printError('pushing files failed: HTTP 400');
    const text = err.text();
    err.restore();

    expect(text).toBe('✗ error: pushing files failed: HTTP 400\n');
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
        '┌────────────────────────┬────────┐',
        // The header sits in its column's alignment too, so a right-aligned
        // SIZE reads over the values rather than off to their left.
        '│ NAME                   │   SIZE │',
        '├────────────────────────┼────────┤',
        '│ notes.txt              │   12 B │',
        '│ a-much-longer-name.bin │ 2.0 KB │',
        '└────────────────────────┴────────┘',
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

describe('colour', () => {
  const restore = { ...process.env };
  afterEach(() => {
    process.env.NO_COLOR = restore.NO_COLOR;
    process.env.FORCE_COLOR = restore.FORCE_COLOR;
    if (restore.NO_COLOR === undefined) delete process.env.NO_COLOR;
    if (restore.FORCE_COLOR === undefined) delete process.env.FORCE_COLOR;
  });

  it('is off when the output is not a terminal — nothing piped ever carries an escape', () => {
    // vitest captures stdout, so isTTY is false here: exactly the piped case.
    delete process.env.FORCE_COLOR;
    expect(colourEnabled('stdout')).toBe(false);
    expect(accent('notes.txt')).toBe('notes.txt');
    expect(ok('done')).toBe('✓ done');
    expect(bad('nope')).toBe('✗ nope');
  });

  it('is on under FORCE_COLOR, and off again under NO_COLOR whatever its value', () => {
    process.env.FORCE_COLOR = '1';
    expect(colourEnabled('stdout')).toBe(true);
    expect(accent('x')).toContain('\u001b[36m');

    // NO_COLOR wins by its presence alone, even set to an empty string.
    process.env.NO_COLOR = '';
    expect(colourEnabled('stdout')).toBe(false);
    expect(accent('x')).toBe('x');
  });

  it('is off in JSON mode even on a terminal, so stdout stays parseable', () => {
    process.env.FORCE_COLOR = '1';
    setJsonMode(true);
    expect(colourEnabled('stdout')).toBe(false);
    expect(accent('x')).toBe('x');
  });

  it('keeps symbols but drops colour, so a ✓ survives into a log file', () => {
    delete process.env.FORCE_COLOR;
    expect(ok('installed')).toBe('✓ installed');
  });
});

describe('heading and fields', () => {
  it('underlines a heading to its own width', () => {
    expect(heading('Downloads')).toBe('Downloads\n─────────');
  });

  it('aligns a key/value block on the longest key', () => {
    expect(
      fields([
        ['host', 'http://bifrost.local:4646'],
        ['profile', 'local'],
      ]),
    ).toBe('host     http://bifrost.local:4646\nprofile  local');
  });

  it('pluralizes, including the irregular case callers pass in', () => {
    expect(plural(1, 'file')).toBe('1 file');
    expect(plural(0, 'file')).toBe('0 files');
    expect(plural(2, 'entry', 'entries')).toBe('2 entries');
  });
});

describe('progress', () => {
  it('is inert when stderr is not a terminal — a pipe never gets a redrawn line', () => {
    const err = captureStderr();
    const bar = progress('sending', 1000);
    bar.update(500);
    bar.stop();
    const text = err.text();
    err.restore();

    expect(text).toBe('');
  });

  it('is inert for an unknown total, rather than drawing a bar against a guess', () => {
    const err = captureStderr();
    progress('pulling', 0).update(10);
    const text = err.text();
    err.restore();

    expect(text).toBe('');
  });
});

describe('CliError', () => {
  it('defaults to exit 1 and carries a specific code when given one', () => {
    expect(new CliError('boom').exitCode).toBe(EXIT.failure);
    expect(new CliError('gone', EXIT.notFound).exitCode).toBe(4);
  });
});
