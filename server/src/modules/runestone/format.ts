import { parseTree, type ParseError } from 'jsonc-parser';
import type { RunestoneFormat } from './ports.js';

/**
 * Is this text a valid document in its format (PLAN-42)? Pure, like `slug.ts`.
 *
 * Strict JSON keeps the `JSON.parse` check it always had, so nothing a client
 * could save before changes. JSONC is JSON plus `//` and block comments and
 * trailing commas, and nothing else (no JSON5): `jsonc-parser`, the release the
 * client validates with, configured exactly as the client's JSONC mode is, so
 * the editor and the server agree on what saves.
 */
export function isValidDocument(content: string, format: RunestoneFormat): boolean {
  if (format === 'jsonc') {
    const errors: ParseError[] = [];
    parseTree(content, errors, {
      disallowComments: false,
      allowTrailingComma: true,
      allowEmptyContent: false,
    });
    return errors.length === 0;
  }
  try {
    JSON.parse(content);
    return true;
  } catch {
    // Ordinary control flow: "not JSON" is this function's whole answer.
    return false;
  }
}

/** The media type the public raw URL serves each format as. */
export const RAW_MEDIA_TYPE: Record<RunestoneFormat, string> = {
  json: 'application/json',
  jsonc: 'application/jsonc',
};

/**
 * What the raw URL sends a document as. Strict JSON is always
 * `application/json`, which browsers render. JSONC is `application/jsonc` for
 * every client that asks for it or takes anything (curl, the CLI, fetch), but
 * no browser renders that type: a page navigation — an `Accept` that names
 * `text/html` and not `application/jsonc` — gets the same bytes as
 * `text/plain`, so the Pensieve's API link and `bifrost preview` show the
 * document instead of downloading it.
 */
export function rawMediaType(format: RunestoneFormat, accept: string | undefined): string {
  if (format === 'json') return RAW_MEDIA_TYPE.json;
  const wanted = (accept ?? '').toLowerCase();
  if (wanted.includes('text/html') && !wanted.includes('application/jsonc')) return 'text/plain';
  return RAW_MEDIA_TYPE.jsonc;
}

