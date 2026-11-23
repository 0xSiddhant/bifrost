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
