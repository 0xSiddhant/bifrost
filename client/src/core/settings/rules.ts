/**
 * What a device-local setting may hold (PLAN-35): the same rules the server's
 * Heimdall overlay applies to its stored values (`core/config` OVERLAYS), so
 * the standalone site accepts exactly what the hub would. `rules.cases.json`
 * is one table both test suites run, which is what keeps the two in step.
 *
 * A rule either returns the value, accepted, or `undefined`, in which case the
 * store falls back to the build-time default for that field alone.
 */

export type Rule<T> = (value: unknown) => T | undefined;

const integer =
  (min: number, max: number): Rule<number> =>
  (value) =>
    typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
      ? value
      : undefined;

const oneOf =
  <T extends string>(...values: T[]): Rule<T> =>
  (value) =>
    typeof value === 'string' && (values as string[]).includes(value) ? (value as T) : undefined;

const boolean: Rule<boolean> = (value) => (typeof value === 'boolean' ? value : undefined);

/** A shortcut string the gesture can match: short, and only key-name characters. */
const shortcut: Rule<string> = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 64 &&
  /^[a-z0-9+,.;'/\\[\]`=-]+$/.test(value)
    ? value
    : undefined;

/** Per area, per field. The keys name the server's settings keys (`area.field`). */
export const RULES = {
  screensaver: {
    enabled: boolean,
    idleSeconds: integer(5, 3600),
    density: oneOf('low', 'medium', 'high'),
    motion: oneOf('calm', 'normal', 'lively'),
    connectLines: boolean,
    mouseReactive: boolean,
    showQuotes: boolean,
    quoteRotateSeconds: integer(4, 120),
  },
  loki: {
    executionEnabled: boolean,
    fetchAllowed: boolean,
    runTimeoutMs: integer(250, 30000),
    consoleMaxEntries: integer(10, 5000),
  },
  heimdall: {
    shortcut,
    tapCount: integer(3, 20),
  },
} as const;

export type SettingsArea = keyof typeof RULES;

/** The rule for a server settings key (`screensaver.idleSeconds`), if one exists. */
export function ruleFor(key: string): Rule<unknown> | undefined {
  const [area, field] = key.split('.');
  const rules = RULES[area as SettingsArea] as Record<string, Rule<unknown>> | undefined;
  return field ? rules?.[field] : undefined;
}

/**
 * Keep every field of `stored` that passes its rule, and take `defaults` for
 * the rest: a hand-edited or older value costs that one field, never the lot.
 */
export function sanitize<T extends object>(area: SettingsArea, stored: unknown, defaults: T): T {
  const rules = RULES[area] as Record<string, Rule<unknown>>;
  const source =
    stored !== null && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  const out = { ...defaults } as Record<string, unknown>;
  for (const field of Object.keys(defaults)) {
    const rule = rules[field];
    const value = rule?.(source[field]);
    if (value !== undefined) out[field] = value;
  }
  return out as T;
}
