import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  accent,
  bad,
  CliError,
  colourEnabled,
  EXIT,
  fields,
  fileTint,
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
  tintUrl,
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

/**
 * Strips SGR escapes so a coloured render can be compared against its plain
 * one. The ESC byte is exactly what these assertions are about, hence the
 * targeted disable rather than a looser pattern.
 */
// eslint-disable-next-line no-control-regex
const SGR = /\u001b\[\d+m/g;
const strip = (text: string): string => text.replace(SGR, '');

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

  it('leaves a styled column byte-identical when the output is piped', () => {
    // vitest captures stdout, so this is the piped case: a `style` must add
    // nothing at all rather than an empty escape pair.
    delete process.env.FORCE_COLOR;
    const rows = [{ name: 'notes.txt' }];
    const plain = table(rows, [{ header: 'NAME', value: (row) => row.name }]);
    const styled = table(rows, [
      { header: 'NAME', value: (row) => row.name, style: accent },
    ]);
    expect(styled).toBe(plain);
  });
});

describe('table styling', () => {
  const restore = { FORCE_COLOR: process.env.FORCE_COLOR };
  afterEach(() => {
    process.env.FORCE_COLOR = restore.FORCE_COLOR;
    if (restore.FORCE_COLOR === undefined) delete process.env.FORCE_COLOR;
  });

  it('colours cells without moving a column — the whole point of padding first', () => {
    process.env.FORCE_COLOR = '1';
    const rows = [
      { name: 'notes.txt', kind: 'file' },
      { name: 'a-much-longer-name.bin', kind: 'folder' },
    ];
    const columns = [
      { header: 'NAME', value: (row: (typeof rows)[number]) => row.name },
      { header: 'KIND', value: (row: (typeof rows)[number]) => row.kind },
    ];
    const coloured = table(rows, [
      { ...columns[0]!, style: (text: string) => accent(text) },
      columns[1]!,
    ]);

    // The escape is present…
    expect(coloured).toContain('\u001b[36m');
    // …and stripping it back out reproduces the uncoloured table exactly, which
    // is only true if padding happened before styling.
    process.env.FORCE_COLOR = '0';
    expect(strip(coloured)).toBe(table(rows, columns));
  });

  it('hands the row to the style, so a folder can look different from a file', () => {
    process.env.FORCE_COLOR = '1';
    const rows = [{ name: 'Trip', type: 'folder' as const }, { name: 'a.txt', type: 'file' as const }];
    const rendered = table(rows, [
      {
        header: 'NAME',
        value: (row) => row.name,
        style: (text, row) => (row.type === 'folder' ? accent(text) : text),
      },
    ]);
    const [, , , folderLine, fileLine] = rendered.split('\n');
    expect(folderLine).toContain('\u001b[36m');
    expect(fileLine).not.toContain('\u001b[36m');
  });
});

describe('content tints', () => {
  const restore = { FORCE_COLOR: process.env.FORCE_COLOR };
  afterEach(() => {
    process.env.FORCE_COLOR = restore.FORCE_COLOR;
    if (restore.FORCE_COLOR === undefined) delete process.env.FORCE_COLOR;
  });

  it('tints a filename by what the file is, and leaves the unknown plain', () => {
    process.env.FORCE_COLOR = '1';
    expect(fileTint('shot.png', 'shot.png')).toContain('\u001b[35m');
    expect(fileTint('clip.mp4', 'clip.mp4')).toContain('\u001b[35m');
    expect(fileTint('src.zip', 'src.zip')).toContain('\u001b[33m');
    // No colour of its own — a listing where everything is coloured says nothing.
    expect(fileTint('notes.txt', 'notes.txt')).toBe('notes.txt');
    expect(fileTint('big.bin', 'big.bin')).toBe('big.bin');
  });

  it('matches on the extension, not anywhere in the name', () => {
    process.env.FORCE_COLOR = '1';
    expect(fileTint('png-notes.txt', 'png-notes.txt')).toBe('png-notes.txt');
  });

  it('dims only a URL scheme, so the padded width is untouched', () => {
    process.env.FORCE_COLOR = '1';
    const padded = 'https://example.com/x  ';
    const tinted = tintUrl(padded);
    expect(tinted.startsWith('\u001b[2mhttps://\u001b[0m')).toBe(true);
    expect(strip(tinted)).toBe(padded);
    // Not a URL: nothing to dim, nothing changed.
    expect(tintUrl('never')).toBe('never');
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
