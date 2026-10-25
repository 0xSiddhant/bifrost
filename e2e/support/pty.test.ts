import { describe, expect, it } from 'vitest';
import { ptyCommand, shellQuote } from './pty.js';

describe('ptyCommand', () => {
  it('builds util-linux script arguments on Linux, with the argv shell-quoted', () => {
    expect(ptyCommand(['/opt/bin/bifrost', 'clip', "it's here"], 'linux')).toEqual({
      file: 'script',
      args: ['-qec', `/opt/bin/bifrost clip 'it'\\''s here'`, '/dev/null'],
    });
  });

  it('builds BSD script arguments on macOS, passing the argv through untouched', () => {
    expect(ptyCommand(['/opt/bin/bifrost', 'clip', "it's here"], 'darwin')).toEqual({
      file: 'script',
      args: ['-q', '/dev/null', '/opt/bin/bifrost', 'clip', "it's here"],
    });
  });
});

describe('shellQuote', () => {
  it('leaves plain words alone and single-quotes anything else', () => {
    expect(shellQuote('--host=http://127.0.0.1:4646')).toBe('--host=http://127.0.0.1:4646');
    expect(shellQuote('two words')).toBe(`'two words'`);
    expect(shellQuote('')).toBe(`''`);
  });
});
