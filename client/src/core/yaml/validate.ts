import { lineAt, parseYamlDocuments, shortMessage } from './parse';
import type { YamlIssue } from './types';

/**
 * A duplicate key is a **library error but a Groot advisory**. It is
 * syntactically legal YAML that every parser accepts (last one wins), so
 * treating it as an error would refuse to save a document the user's own tools
 * read fine. It is reported by `advisories()` instead — see PLAN-19's table.
 */
const ADVISORY_CODES = new Set(['DUPLICATE_KEY']);

/**
 * Every syntax error in the stream, positioned for the lint gutter.
 *
 * Multi-document is handled here rather than by the caller: a `---` stream is
 * one buffer to the editor, so an error in the third document has to arrive
 * with an offset into the whole text — which `parseAllDocuments` already gives,
 * since every document shares the source.
 */
export function validateYaml(text: string): YamlIssue[] {
  if (text.trim() === '') return [];

  const issues: YamlIssue[] = [];
  for (const doc of parseYamlDocuments(text)) {
    for (const error of doc.errors) {
      if (ADVISORY_CODES.has(error.code)) continue;
      const [from, to] = error.pos;
      const offset = Math.min(from, text.length);
      issues.push({
        offset,
        length: Math.max(1, Math.min(to, text.length) - offset),
        message: shortMessage(error.message),
        line: error.linePos?.[0]?.line ?? lineAt(text, offset),
      });
    }
  }
  return issues.sort((a, b) => a.offset - b.offset);
}

/** True when the buffer would save — the editor's gate, and the save button's. */
export function isValidYaml(text: string): boolean {
  return validateYaml(text).length === 0;
}
