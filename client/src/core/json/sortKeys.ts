/**
 * Recursively sort object keys A→Z (code-unit order — deterministic and
 * idempotent; property-tested). Arrays keep their element order. Shared with
 * PLAN-08: sorting both sides before diffing kills key-ordering noise.
 *
 * Its own module so `jsonc.ts` can check a comment-safe sort against it
 * without importing the index that re-exports both.
 */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([key, child]) => [key, sortKeysDeep(child)]));
  }
  return value;
}
