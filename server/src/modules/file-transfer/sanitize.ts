/**
 * Filename sanitizer for user-supplied upload names (security default in
 * rules/coding.md). Input is the raw multipart filename exactly as busboy
 * delivered it — we never URL-decode, so `%2e%2e` stays inert text.
 */

const MAX_NAME_LENGTH = 180;
const MAX_EXT_LENGTH = 16;

// C0 controls, DEL, zero-width chars, line/para separators, BOM.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f\u200b-\u200d\u2028\u2029\ufeff]/g;
// Path separators plus unicode glyphs that render as them.
const SEPARATORS = /[/\\\u2044\u2215\u29f8\u29f9\uff0f\uff3c]/g;
// Unicode glyphs that render as a dot.
const DOT_LOOKALIKES = /[\u2024\u3002\uff0e]/g;

export function sanitizeFilename(raw: string): string {
  let name = raw.normalize('NFC');
  name = name.replace(CONTROL_CHARS, '');
  name = name.replace(SEPARATORS, '_');
  name = name.replace(DOT_LOOKALIKES, '.');
  // No dot runs: kills `..` (and windows-style `....`) wherever it appears.
  name = name.replace(/\.{2,}/g, '.');
  // No hidden files, no leading junk; windows also rejects trailing dots/spaces.
  name = name.replace(/^[\s._-]+/, '').replace(/[\s.]+$/, '');
  name = name.trim();

  if (name.length > MAX_NAME_LENGTH) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= MAX_EXT_LENGTH ? name.slice(dot) : '';
    name = name.slice(0, MAX_NAME_LENGTH - ext.length) + ext;
  }

  return name.length > 0 ? name : 'file';
}
