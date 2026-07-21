import { SECTIONS } from './sections';

/** A search hit: either a whole section or one control inside a section. */
export interface SearchHit {
  sectionId: string;
  sectionLabel: string;
  controlId?: string;
  label: string;
}

/** Case-insensitive substring OR subsequence match — a light fuzzy test. */
export function fuzzy(needle: string, haystack: string): boolean {
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
  if (n === '') return true;
  if (h.includes(n)) return true;
  let i = 0;
  for (const ch of h) {
    if (ch === n[i]) i += 1;
    if (i === n.length) return true;
  }
  return false;
}

/**
 * Matches a query against section names AND each section's searchable control
 * manifest. Section hits come first, then per-control hits (so "tap" surfaces
 * the Settings tap-count control the modal can jump to and highlight).
 */
export function searchSections(query: string): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const section of SECTIONS) {
    if (fuzzy(q, section.label)) {
      hits.push({ sectionId: section.id, sectionLabel: section.label, label: section.label });
    }
    for (const item of section.manifest) {
      const hay = [item.label, ...(item.keywords ?? [])].join(' ');
      if (fuzzy(q, hay)) {
        hits.push({
          sectionId: section.id,
          sectionLabel: section.label,
          controlId: item.controlId,
          label: item.label,
        });
      }
    }
  }
  return hits.slice(0, 12);
}
