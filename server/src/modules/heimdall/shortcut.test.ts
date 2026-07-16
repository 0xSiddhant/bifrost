import { describe, expect, it } from 'vitest';
import { normalizeShortcut, parseShortcut, ShortcutError } from './shortcut.js';

describe('parseShortcut', () => {
  it('parses modifiers + key and canonicalizes modifier order', () => {
    expect(parseShortcut('meta+shift+comma')).toEqual({
      modifiers: ['shift', 'meta'],
      key: 'comma',
    });
  });

  it('is case- and whitespace-insensitive', () => {
    expect(parseShortcut(' CTRL + Alt + K ')).toEqual({ modifiers: ['ctrl', 'alt'], key: 'k' });
  });

  it('accepts function keys and named keys', () => {
    expect(parseShortcut('ctrl+f2').key).toBe('f2');
    expect(parseShortcut('meta+slash').key).toBe('slash');
  });

  it('rejects a bare key with no modifier', () => {
    expect(() => parseShortcut('comma')).toThrow(ShortcutError);
  });

  it('rejects more than one key', () => {
    expect(() => parseShortcut('ctrl+a+b')).toThrow(ShortcutError);
  });

  it('rejects unknown key tokens and duplicate modifiers', () => {
    expect(() => parseShortcut('ctrl+notakey')).toThrow(/unrecognized/);
    expect(() => parseShortcut('ctrl+ctrl+a')).toThrow(/duplicate/);
  });
});

describe('normalizeShortcut', () => {
  it('returns the canonical form regardless of input order or case', () => {
    expect(normalizeShortcut('meta+shift+comma')).toBe('shift+meta+comma');
    expect(normalizeShortcut('Comma+Meta+Shift')).toBe('shift+meta+comma');
  });

  it('refuses reserved browser combos', () => {
    expect(() => normalizeShortcut('meta+w')).toThrow(/reserved/);
    expect(() => normalizeShortcut('ctrl+r')).toThrow(/reserved/);
    expect(() => normalizeShortcut('meta+shift+t')).toThrow(/reserved/);
  });

  it('allows the default combo', () => {
    expect(normalizeShortcut('shift+meta+comma')).toBe('shift+meta+comma');
  });
});
