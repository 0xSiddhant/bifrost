import { parseYamlDocuments, toValue } from './parse';

export interface YamlDocumentValue {
  /** 1-based position in the `---` stream, for the document switcher's label. */
  index: number;
  /** Materialised value for the tree view, or null when it could not be. */
  value: unknown;
  /** Set when the document is unparseable or expands past the alias cap. */
  error: string | null;
}

/**
 * Every document in the stream, materialised for the tree view.
 *
 * One bad document does not lose the others — the same reasoning as the
 * Pensieve's `allSettled`: a `---` stream is often several unrelated manifests,
 * and blanking the tree because the fourth has a typo hides the three that are
 * fine. Each entry carries its own error instead.
 */
export function documentValues(text: string): YamlDocumentValue[] {
  if (text.trim() === '') return [];
  return parseYamlDocuments(text).map((doc, position) => {
    const index = position + 1;
    if (doc.errors.length > 0) {
      return { index, value: null, error: 'This document has a syntax error.' };
    }
    const materialised = toValue(doc);
    return materialised.ok
      ? { index, value: materialised.value, error: null }
      : { index, value: null, error: materialised.reason };
  });
}
