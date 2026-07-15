/**
 * Keyboard-shortcut string handling for the Heimdall entry combo. The canonical
 * form is `+`-joined lowercase tokens: modifiers (`ctrl` `alt` `shift` `meta`)
 * then exactly one key token (`comma`, `k`, `f2`, ...), e.g. `shift+meta+comma`.
 * The same string is stored in the DB, sent to clients, and matched against
 * keydown events (the client parses it independently — no shared import).
 */

export const MODIFIERS = ['ctrl', 'alt', 'shift', 'meta'] as const;
export type Modifier = (typeof MODIFIERS)[number];

export interface ParsedShortcut {
  modifiers: Modifier[];
  key: string;
}

const MODIFIER_SET = new Set<string>(MODIFIERS);

/** Named non-alphanumeric keys we accept (subset of KeyboardEvent codes, lowercased). */
const NAMED_KEYS = new Set([
  'comma',
  'period',
  'slash',
  'semicolon',
  'backslash',
  'quote',
  'backquote',
  'bracketleft',
  'bracketright',
  'minus',
  'equal',
  'space',
  'enter',
  'escape',
  'tab',
  'backspace',
  ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`),
  'up',
  'down',
  'left',
  'right',
]);

export class ShortcutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShortcutError';
  }
}

/**
 * Browser/OS combos we refuse so the admin can't lock themselves out of the
 * page (or accidentally shadow a system shortcut). Stored as canonical strings.
 */
const RESERVED = new Set([
  'meta+w',
  'ctrl+w',
  'meta+t',
  'ctrl+t',
  'meta+n',
  'ctrl+n',
  'meta+q',
  'meta+r',
  'ctrl+r',
  'meta+l',
  'ctrl+l',
  // Canonical modifier order is [ctrl, alt, shift, meta].
  'shift+meta+t',
  'ctrl+shift+t',
  'shift+meta+n',
  'ctrl+shift+n',
  'alt+f4',
]);

function isKeyToken(token: string): boolean {
  return /^[a-z0-9]$/.test(token) || NAMED_KEYS.has(token);
}

/** Parse without the reserved-combo check. Throws ShortcutError on bad syntax. */
export function parseShortcut(input: string): ParsedShortcut {
  const tokens = input
    .toLowerCase()
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length < 2) {
    throw new ShortcutError('a shortcut needs at least one modifier and one key');
  }

  const modifiers: Modifier[] = [];
  const keys: string[] = [];
  for (const token of tokens) {
    if (MODIFIER_SET.has(token)) {
      const modifier = token as Modifier;
      if (modifiers.includes(modifier)) throw new ShortcutError(`duplicate modifier "${token}"`);
      modifiers.push(modifier);
    } else if (isKeyToken(token)) {
      keys.push(token);
    } else {
      throw new ShortcutError(`unrecognized key token "${token}"`);
    }
  }

  if (modifiers.length === 0) throw new ShortcutError('a shortcut needs at least one modifier');
  const key = keys[0];
  if (keys.length !== 1 || key === undefined) {
    throw new ShortcutError('a shortcut must have exactly one key');
  }

  // Canonical modifier order regardless of how it was typed.
  modifiers.sort((a, b) => MODIFIERS.indexOf(a) - MODIFIERS.indexOf(b));
  return { modifiers, key };
}

/** Render a parsed shortcut back to its canonical `+`-joined string. */
export function formatShortcut(parsed: ParsedShortcut): string {
  return [...parsed.modifiers, parsed.key].join('+');
}

/**
 * Validate and canonicalize a shortcut string, rejecting reserved browser
 * combos. Returns the canonical form; throws ShortcutError otherwise.
 */
export function normalizeShortcut(input: string): string {
  const canonical = formatShortcut(parseShortcut(input));
  if (RESERVED.has(canonical)) {
    throw new ShortcutError(`"${canonical}" is reserved by the browser — pick another combo`);
  }
  return canonical;
}
