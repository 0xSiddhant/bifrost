/**
 * Client-side matcher for the Heimdall entry shortcut. The server stores and
 * sends a canonical `+`-joined string (`shift+meta+comma`); this checks a
 * KeyboardEvent against it. Kept independent of the server's parser — the two
 * codebases can't share code, only the string contract.
 */

const MODIFIERS = ['ctrl', 'alt', 'shift', 'meta'] as const;
type Modifier = (typeof MODIFIERS)[number];

/** Normalize a KeyboardEvent.code to the server's key token vocabulary. */
function codeToToken(code: string): string {
  if (code.startsWith('Key')) return code.slice(3).toLowerCase(); // KeyK → k
  if (code.startsWith('Digit')) return code.slice(5); // Digit1 → 1
  if (code === 'ArrowUp') return 'up';
  if (code === 'ArrowDown') return 'down';
  if (code === 'ArrowLeft') return 'left';
  if (code === 'ArrowRight') return 'right';
  return code.toLowerCase(); // Comma → comma, F2 → f2, Slash → slash
}

const MODIFIER_LABELS: Record<Modifier, string> = {
  ctrl: '⌃',
  alt: '⌥',
  shift: '⇧',
  meta: '⌘',
};

const KEY_LABELS: Record<string, string> = {
  comma: ',',
  period: '.',
  slash: '/',
  semicolon: ';',
  quote: "'",
  backquote: '`',
  backslash: '\\',
  bracketleft: '[',
  bracketright: ']',
  minus: '-',
  equal: '=',
  space: 'Space',
  enter: 'Enter',
  escape: 'Esc',
  tab: 'Tab',
  backspace: '⌫',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
};

function keyLabel(token: string): string {
  if (KEY_LABELS[token]) return KEY_LABELS[token];
  if (/^f\d{1,2}$/.test(token)) return token.toUpperCase(); // f2 → F2
  return token.toUpperCase();
}

/** Canonical shortcut string → display chips, e.g. `shift+meta+comma` → ['⇧','⌘',',']. */
export function prettyShortcut(shortcut: string): string[] {
  const tokens = shortcut
    .toLowerCase()
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean);
  return tokens.map((token) =>
    MODIFIERS.includes(token as Modifier) ? MODIFIER_LABELS[token as Modifier] : keyLabel(token),
  );
}

/**
 * A keydown → canonical shortcut string, or null if it isn't a complete combo
 * (a bare modifier press, or a key with no modifier held). Used by the settings
 * "record" control so the admin never types raw tokens.
 */
export function eventToShortcut(event: KeyboardEvent): string | null {
  if (['Shift', 'Meta', 'Control', 'Alt'].includes(event.key)) return null;
  const modifiers = MODIFIERS.filter((modifier) => {
    if (modifier === 'ctrl') return event.ctrlKey;
    if (modifier === 'alt') return event.altKey;
    if (modifier === 'shift') return event.shiftKey;
    return event.metaKey;
  });
  if (modifiers.length === 0) return null;
  const key = codeToToken(event.code);
  if (!key) return null;
  return [...modifiers, key].join('+');
}

export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const tokens = shortcut
    .toLowerCase()
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length < 2) return false;

  const required = new Set(tokens.filter((token): token is Modifier => MODIFIERS.includes(token as Modifier)));
  const keys = tokens.filter((token) => !required.has(token as Modifier));
  if (keys.length !== 1) return false;

  // Every modifier must match exactly — no more, no fewer.
  const held: Record<Modifier, boolean> = {
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
  };
  for (const modifier of MODIFIERS) {
    if (held[modifier] !== required.has(modifier)) return false;
  }
  return codeToToken(event.code) === keys[0];
}
