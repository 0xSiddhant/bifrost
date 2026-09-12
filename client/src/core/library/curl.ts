import type { LibraryEntry, LibraryItem } from './types';

/**
 * A copy-paste `curl` command for a document's public raw-data URL (the same
 * URL the row's "API" link already opens) — so it can be tested outside the
 * browser, in a terminal or a tool like Postman, without anyone having to
 * assemble the URL and the right `Accept` header by hand.
 *
 * `null` when the kind publishes no raw-data URL at all (`apiRoute` absent) —
 * there is nothing to build a command for.
 */
export function buildCurlCommand(
  entry: LibraryEntry,
  item: LibraryItem,
  origin: string,
): string | null {
  if (!entry.apiRoute || !entry.mimeType) return null;
  const url = `${origin}${entry.apiRoute(item)}`;
  return `curl -sS -H 'Accept: ${entry.mimeType}' '${url}'`;
}
