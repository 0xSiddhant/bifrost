import type { XmlSpan } from './index';
import { isBase64, isPlistDate } from './plist';

/**
 * Non-blocking advisories for plist documents (PLAN-23) — the Groot rail's
 * smaller sibling, and deliberately not padded to match its count.
 *
 * XML's grammar is strict enough that most of what YAML treats as a worrying
 * ambiguity is simply a hard parse error here, so there are three real
 * candidates rather than eight. Each one is a document that parses, saves and
 * serves fine but will read differently to `plutil`, `NSPropertyList` or Xcode
 * than it does to the person who wrote it.
 *
 * Nothing here blocks a save and nothing is rewritten for the author — the same
 * contract Groot's rail holds.
 */

export type XmlAdvisoryKind = 'duplicate-key' | 'malformed-date' | 'invalid-base64';

export interface XmlAdvisory {
  kind: XmlAdvisoryKind;
  /** Source offset of the element the advisory is about (click-to-jump). */
  offset: number;
  /** 1-based line, for the rail's left column. */
  line: number;
  message: string;
}

function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

export function advisoriesFor(
  doc: Document,
  spans: Map<Element, XmlSpan>,
  text: string,
): XmlAdvisory[] {
  if (doc.documentElement?.nodeName !== 'plist') return [];
  const out: XmlAdvisory[] = [];
  const at = (element: Element): number => spans.get(element)?.start ?? 0;
  const push = (element: Element, kind: XmlAdvisoryKind, message: string) => {
    const offset = at(element);
    out.push({ kind, offset, line: lineAt(text, offset), message });
  };

  for (const dict of doc.getElementsByTagName('dict')) {
    const seen = new Map<string, number>();
    for (const child of dict.children) {
      if (child.nodeName !== 'key') continue;
      const name = child.textContent ?? '';
      const count = (seen.get(name) ?? 0) + 1;
      seen.set(name, count);
      if (count > 1) {
        // Not an error: XML does not forbid it, and every plist reader takes
        // the last one — so refusing the save would be inventing a rule.
        push(
          child,
          'duplicate-key',
          `“${name}” appears ${count} times in this dictionary — readers keep the last one.`,
        );
      }
    }
  }

  for (const date of doc.getElementsByTagName('date')) {
    const value = (date.textContent ?? '').trim();
    if (isPlistDate(value)) continue;
    push(
      date,
      'malformed-date',
      value === ''
        ? 'Empty date — Apple expects YYYY-MM-DDTHH:MM:SSZ.'
        : `“${value}” is not YYYY-MM-DDTHH:MM:SSZ — readers may see no date at all.`,
    );
  }

  for (const data of doc.getElementsByTagName('data')) {
    const value = data.textContent ?? '';
    if (isBase64(value)) continue;
    push(data, 'invalid-base64', 'This <data> value is not valid base64 — it will not decode.');
  }

  return out.sort((a, b) => a.offset - b.offset);
}
