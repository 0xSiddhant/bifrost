/**
 * Pure text mechanics for the comma-separated tag field (PLAN-13). Suggestions
 * have to reason about *the tag being typed*, not the whole field value, so
 * that logic lives here as plain functions the component just renders.
 */

/** The fragment after the last comma — what the user is typing right now. */
export function activeFragment(value: string): string {
  return (value.split(',').at(-1) ?? '').trim().toLowerCase();
}

/** The completed tags in the field, normalized the way the server will store them. */
export function committedTags(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Which known tags to offer: everything already on the shelf, minus what this
 * field already holds, narrowed by whatever is being typed. An empty field
 * offers the whole list — clicking the input should show what exists.
 */
export function suggestFor(value: string, known: readonly string[]): string[] {
  const fragment = activeFragment(value);
  const chosen = new Set(committedTags(value));
  // The fragment is itself a chosen tag only once a comma follows it, so drop
  // it from the exclusion set while it is still being typed.
  if (fragment) chosen.delete(fragment);
  return known.filter((tag) => !chosen.has(tag) && (!fragment || tag.includes(fragment)));
}

/**
 * Replace the fragment being typed with `tag`, leaving a trailing ", " so the
 * next tag can be typed straight away.
 */
export function applySuggestion(value: string, tag: string): string {
  const parts = value.split(',');
  parts[parts.length - 1] = ` ${tag}`;
  return `${parts.join(',').trimStart()}, `;
}
