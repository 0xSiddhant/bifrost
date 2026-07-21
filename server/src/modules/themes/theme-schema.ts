/**
 * The theme contract (JSON Schema draft 2020-12), mirrored prose-style in
 * docs/THEME-SPEC.md. A theme JSON is a flat map onto the tokens.css custom
 * properties: required color roles, optional atmosphere / syntax / diff / qr /
 * typography / shape groups. Omitted optional tokens get derived defaults
 * (resolve.ts) so a minimal theme is ~17 lines.
 */

/** Solid or alpha color: #rgb/#rrggbb/#rrggbbaa, rgb()/rgba(), or `transparent`. */
const COLOR_PATTERN =
  '^(#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?([0-9a-fA-F]{2})?|rgba?\\([0-9.,%\\s]+\\)|transparent)$';

/**
 * Free-form CSS value (gradients, shadows, clamp()...). Guard rails, not a
 * parser: no url()/@import/expression — themes must never trigger network
 * fetches (offline-first) or smuggle behavior.
 */
const CSS_VALUE_PATTERN = "^(?!.*[@;{}<>])(?!.*[uU][rR][lL]\\s*\\()[-a-zA-Z0-9#%(),.'\\s/*+]+$";

/** Self-hosted families only — a LAN with no internet must render identically. */
const FONT_PATTERN = "^'(Space Grotesk|Inter|JetBrains Mono)'[-a-zA-Z0-9,'\\s]*$";

const color = { type: 'string', pattern: COLOR_PATTERN, maxLength: 64 } as const;
const cssValue = { type: 'string', pattern: CSS_VALUE_PATTERN, maxLength: 600 } as const;
const font = { type: 'string', pattern: FONT_PATTERN, maxLength: 120 } as const;

export const REQUIRED_COLOR_ROLES = [
  '--bg',
  '--surface',
  '--surface-2',
  '--text',
  '--text-muted',
  '--border',
  '--accent',
  '--accent-2',
  '--ok',
  '--danger',
  '--warn',
  '--accent-soft',
  '--danger-soft',
  '--scrim',
] as const;

export const SYNTAX_TOKENS = [
  '--syn-key',
  '--syn-string',
  '--syn-number',
  '--syn-bool',
  '--syn-null',
  '--syn-punct',
] as const;

export const DIFF_TOKENS = [
  '--diff-add',
  '--diff-remove',
  '--diff-change',
  '--diff-add-soft',
  '--diff-remove-soft',
  '--diff-change-soft',
] as const;

export const QR_TOKENS = ['--qr-module-a', '--qr-module-b', '--qr-bg'] as const;

const ATMOSPHERE_COLOR_TOKENS = [
  '--stars',
  '--tone-teal',
  '--tone-teal-soft',
  '--tone-violet',
  '--tone-violet-soft',
  '--header-veil',
  '--relic-muted',
] as const;

const ATMOSPHERE_CSS_TOKENS = [
  '--bridge',
  '--accent-grad',
  '--sky',
  '--stars-alpha',
  '--glow-teal',
  '--glow-violet',
  '--glow-soft',
  '--card-sheen',
  '--relic-alpha',
  '--shadow-1',
  '--shadow-2',
] as const;

const TYPO_SHAPE_TOKENS = [
  '--text-xs',
  '--text-sm',
  '--text-md',
  '--text-lg',
  '--text-xl',
  '--text-2xl',
  '--space-1',
  '--space-2',
  '--space-3',
  '--space-4',
  '--space-5',
  '--space-6',
  '--space-8',
  '--space-12',
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--radius-full',
  '--dur-1',
  '--dur-2',
  '--ease',
] as const;

const FONT_TOKENS = ['--font-display', '--font-body', '--font-mono'] as const;

export const ALL_TOKEN_KEYS = [
  ...REQUIRED_COLOR_ROLES,
  ...ATMOSPHERE_COLOR_TOKENS,
  ...ATMOSPHERE_CSS_TOKENS,
  ...SYNTAX_TOKENS,
  ...DIFF_TOKENS,
  ...QR_TOKENS,
  ...FONT_TOKENS,
  ...TYPO_SHAPE_TOKENS,
] as const;

const tokenProperties: Record<string, unknown> = {};
for (const key of REQUIRED_COLOR_ROLES) tokenProperties[key] = color;
for (const key of ATMOSPHERE_COLOR_TOKENS) tokenProperties[key] = color;
for (const key of ATMOSPHERE_CSS_TOKENS) tokenProperties[key] = cssValue;
for (const key of SYNTAX_TOKENS) tokenProperties[key] = color;
for (const key of DIFF_TOKENS) tokenProperties[key] = color;
for (const key of QR_TOKENS) tokenProperties[key] = color;
for (const key of FONT_TOKENS) tokenProperties[key] = font;
for (const key of TYPO_SHAPE_TOKENS) tokenProperties[key] = cssValue;

export const themeSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://bifrost.local/theme.schema.json',
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'mode', 'tokens'],
  properties: {
    $schema: { type: 'string' },
    id: { type: 'string', pattern: '^[a-z0-9-]{2,32}$' },
    name: { type: 'string', minLength: 1, maxLength: 48 },
    mode: { enum: ['dark', 'light'] },
    tokens: {
      type: 'object',
      additionalProperties: false,
      required: [...REQUIRED_COLOR_ROLES],
      properties: tokenProperties,
    },
  },
} as const;
