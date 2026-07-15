import { describe, expect, it } from 'vitest';
import { matchesShortcut } from './shortcut';

type Mods = Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>>;

function keyEvent(code: string, mods: Mods = {}): KeyboardEvent {
  return {
    code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...mods,
  } as unknown as KeyboardEvent;
}

describe('matchesShortcut', () => {
  it('matches the default combo', () => {
    const event = keyEvent('Comma', { shiftKey: true, metaKey: true });
    expect(matchesShortcut(event, 'shift+meta+comma')).toBe(true);
  });

  it('requires modifiers to match exactly — no extras', () => {
    const event = keyEvent('Comma', { shiftKey: true, metaKey: true, ctrlKey: true });
    expect(matchesShortcut(event, 'shift+meta+comma')).toBe(false);
  });

  it('requires all named modifiers to be held', () => {
    const event = keyEvent('Comma', { metaKey: true });
    expect(matchesShortcut(event, 'shift+meta+comma')).toBe(false);
  });

  it('maps letter and function key codes', () => {
    expect(matchesShortcut(keyEvent('KeyK', { ctrlKey: true, altKey: true }), 'ctrl+alt+k')).toBe(
      true,
    );
    expect(matchesShortcut(keyEvent('F2', { ctrlKey: true }), 'ctrl+f2')).toBe(true);
  });

  it('rejects the wrong key even with the right modifiers', () => {
    expect(matchesShortcut(keyEvent('Period', { shiftKey: true, metaKey: true }), 'shift+meta+comma')).toBe(
      false,
    );
  });

  it('ignores malformed shortcut strings', () => {
    expect(matchesShortcut(keyEvent('KeyK'), 'k')).toBe(false);
    expect(matchesShortcut(keyEvent('KeyK'), '')).toBe(false);
  });
});
