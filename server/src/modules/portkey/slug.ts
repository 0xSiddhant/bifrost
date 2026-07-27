/**
 * Portkey slug rules (PLAN-15). A slug is a *user-chosen memorable word* — the
 * whole point over a generated id is that `bifrost.local/go/router` is something
 * a person can type from memory. Pure and no-IO so the whole corpus (unicode,
 * uppercase, length, reserved words) is unit-testable.
 *
 * Rules: lowercase kebab, `[a-z0-9-]`, 1–32 chars, no leading/trailing dash, and
 * not one of the app's own path roots (see core/reserved-roots).
 */
import { isReservedRoot } from '../../core/reserved-roots.js';

export const SLUG_MAX_LENGTH = 32;

/** Lowercase, digits, internal dashes; must start and end alphanumeric. */
const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export type SlugResult = { ok: true; slug: string } | { ok: false; reason: string };

/**
 * Validates a raw slug, returning the clean slug or a human reason for the 422.
 * Whitespace is trimmed but nothing is silently rewritten — an uppercase or
 * accented slug is rejected, not coerced, so the address the user sees is the
 * address they chose (the client lowercases as they type for convenience).
 */
export function validateSlug(raw: string): SlugResult {
  const slug = raw.trim();
  if (!slug) return { ok: false, reason: 'a portkey needs a name' };
  if (slug.length > SLUG_MAX_LENGTH) {
    return { ok: false, reason: `keep it to ${SLUG_MAX_LENGTH} characters or fewer` };
  }
  if (!SLUG_PATTERN.test(slug)) {
    return {
      ok: false,
      reason: 'use lowercase letters, digits and dashes only — no spaces, no leading or trailing dash',
    };
  }
  if (isReservedRoot(slug)) {
    return { ok: false, reason: `"${slug}" is reserved — it names part of Bifrost itself` };
  }
  return { ok: true, slug };
}

/** Cheap client-shaped check reused by the route param schema's own guard. */
export function looksLikeSlug(raw: string): boolean {
  return raw.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(raw);
}
