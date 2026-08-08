import { stringify } from 'yaml';
import { parseYamlDocuments, toValue } from './parse';
import { isValidYaml } from './validate';

export type ConversionResult = { ok: true; text: string } | { ok: false; reason: string };

/**
 * YAML → JSON.
 *
 * A `---` stream becomes a **JSON array of documents**, because JSON has no
 * multi-document form and silently keeping only the first would lose data
 * without saying so. A single document stays a bare value, so the common case
 * round-trips exactly.
 *
 * **Comments are lost**, unavoidably — JSON has nowhere to put them. The UI
 * says so before converting rather than after.
 */
export function yamlToJson(text: string, indent = 2): ConversionResult {
  if (text.trim() === '') return { ok: true, text: '' };
  if (!isValidYaml(text)) return { ok: false, reason: 'Fix the YAML errors before converting.' };

  const docs = parseYamlDocuments(text);
  const values: unknown[] = [];
  for (const doc of docs) {
    const materialised = toValue(doc);
    if (!materialised.ok) return { ok: false, reason: materialised.reason };
    values.push(materialised.value);
  }
  const value = values.length === 1 ? values[0] : values;
  try {
    return { ok: true, text: `${JSON.stringify(value, null, indent)}\n` };
  } catch (error) {
    // Reached by a structure JSON cannot express — a circular reference built
    // from anchors is the realistic one. Returned, never swallowed.
    return {
      ok: false,
      reason:
        error instanceof Error && /circular/i.test(error.message)
          ? 'This document contains a cycle (an anchor referring to its own parent), which JSON cannot represent.'
          : 'This document could not be written as JSON.',
    };
  }
}

/** JSON → YAML. Block style, the same indent the formatter uses. */
export function jsonToYaml(text: string): ConversionResult {
  if (text.trim() === '') return { ok: true, text: '' };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? `Not valid JSON: ${error.message}` : 'Not valid JSON.',
    };
  }
  return { ok: true, text: stringify(value, { indent: 2, lineWidth: 0 }) };
}
