import { describe, expect, it } from 'vitest';
import { runCommand, type DocSelection, type MarkdownCommand } from './commands';

/** Build a selection from a string with `|` marking the anchors (stripped). */
function sel(spec: string): DocSelection {
  const from = spec.indexOf('|');
  const rest = spec.slice(0, from) + spec.slice(from + 1);
  const to = rest.indexOf('|');
  if (to === -1) return { doc: rest, from, to: from };
  return { doc: rest.slice(0, to) + rest.slice(to + 1), from, to };
}

describe('inline wrap commands round-trip', () => {
  const cases: Array<[MarkdownCommand, string]> = [
    ['bold', '**'],
    ['italic', '_'],
    ['strikethrough', '~~'],
    ['code', '`'],
  ];

  for (const [command, marker] of cases) {
    it(`${command} wraps then unwraps the selection`, () => {
      const start = sel('say |hello| there');
      const wrapped = runCommand(command, start);
      expect(wrapped.doc).toBe(`say ${marker}hello${marker} there`);
      // the selection lands on the inner text, markers just outside
      expect(wrapped.doc.slice(wrapped.from, wrapped.to)).toBe('hello');

      const unwrapped = runCommand(command, wrapped);
      expect(unwrapped.doc).toBe('say hello there');
      expect(unwrapped.doc.slice(unwrapped.from, unwrapped.to)).toBe('hello');
    });
  }

  it('unwraps when the markers are inside the selection', () => {
    const spec = sel('a |**bold**| b');
    const out = runCommand('bold', spec);
    expect(out.doc).toBe('a bold b');
  });
});

describe('heading commands', () => {
  it('applies then toggles off an H2', () => {
    const start = sel('|Title|');
    const h2 = runCommand('h2', start);
    expect(h2.doc).toBe('## Title');
    expect(runCommand('h2', h2).doc).toBe('Title');
  });

  it('replaces an existing heading level', () => {
    expect(runCommand('h1', sel('|### Deep|')).doc).toBe('# Deep');
  });
});

describe('block prefix commands', () => {
  it('bullets and un-bullets multiple lines', () => {
    const start = sel('|one\ntwo|');
    const list = runCommand('bulletList', start);
    expect(list.doc).toBe('- one\n- two');
    expect(runCommand('bulletList', list).doc).toBe('one\ntwo');
  });

  it('numbers lines incrementally', () => {
    expect(runCommand('numberList', sel('|a\nb\nc|')).doc).toBe('1. a\n2. b\n3. c');
  });

  it('adds task checkboxes', () => {
    expect(runCommand('taskList', sel('|do it|')).doc).toBe('- [ ] do it');
  });

  it('quotes and unquotes', () => {
    const q = runCommand('quote', sel('|cite me|'));
    expect(q.doc).toBe('> cite me');
    expect(runCommand('quote', q).doc).toBe('cite me');
  });
});

describe('insert commands', () => {
  it('link inserts [text](https://) with a collapsed cursor after the scheme', () => {
    const out = runCommand('link', sel('see |Bifrost| now'));
    expect(out.doc).toBe('see [Bifrost](https://) now');
    // Collapsed cursor (not a selection) sitting right after `https://`, so the
    // next keystroke extends the URL instead of deleting the placeholder.
    expect(out.from).toBe(out.to);
    expect(out.doc.slice(0, out.from)).toBe('see [Bifrost](https://');
  });

  it('code fence wraps the selected lines', () => {
    expect(runCommand('codeFence', sel('|const x = 1|')).doc).toBe('```\nconst x = 1\n```');
  });

  it('table inserts a starter grid on its own line', () => {
    const out = runCommand('table', sel('intro|'));
    expect(out.doc).toContain('| Column A | Column B |');
    expect(out.doc.startsWith('intro\n|')).toBe(true);
  });
});

// Regression: applying a tag on an empty selection must leave a collapsed
// cursor, so the first keystroke extends the tag rather than wiping it (bug:
// "select a tag, type, and only the typed text is left").
describe('block/insert commands leave a collapsed cursor, not a selection', () => {
  const type = (r: { doc: string; from: number; to: number }, ch: string) =>
    r.doc.slice(0, r.from) + ch + r.doc.slice(r.to);

  const cases: Array<[MarkdownCommand, string]> = [
    ['h1', '# X'],
    ['h2', '## X'],
    ['h3', '### X'],
    ['bulletList', '- X'],
    ['numberList', '1. X'],
    ['taskList', '- [ ] X'],
    ['quote', '> X'],
  ];

  for (const [command, expected] of cases) {
    it(`${command}: typing after keeps the marker`, () => {
      const out = runCommand(command, sel('|'));
      expect(out.from).toBe(out.to);
      expect(type(out, 'X')).toBe(expected);
    });
  }

  it('link: typing after extends the URL, keeping [text](https://', () => {
    const out = runCommand('link', sel('|'));
    expect(out.from).toBe(out.to);
    expect(type(out, 'x')).toBe('[link text](https://x)');
  });
});

describe('presenterNote', () => {
  it('inserts an empty note with the caret inside it', () => {
    const out = runCommand('presenterNote', sel('|'));
    expect(out.doc).toBe('<!-- notes:  -->\n');
    expect(out.from).toBe(out.to);
    // Typing continues the note rather than replacing it.
    const typed = out.doc.slice(0, out.from) + 'breathe' + out.doc.slice(out.to);
    expect(typed).toBe('<!-- notes: breathe -->\n');
  });

  it('turns a selection into the note’s text', () => {
    const out = runCommand('presenterNote', sel('|say this out loud|'));
    expect(out.doc).toBe('<!-- notes: say this out loud -->\n');
  });

  it('always lands on its own line, never inline', () => {
    // Inline is legal markdown and parses, but it eats the spacing either side,
    // so the toolbar must not be able to produce it.
    const out = runCommand('presenterNote', sel('Some text|'));
    expect(out.doc).toBe('Some text\n<!-- notes:  -->\n');
  });

  it('does not add a second newline when already at a line start', () => {
    const out = runCommand('presenterNote', sel('# Title\n|'));
    expect(out.doc).toBe('# Title\n<!-- notes:  -->\n');
  });
});
