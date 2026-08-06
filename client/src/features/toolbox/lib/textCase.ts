/**
 * Identifier case conversion (PLAN-18).
 *
 * Everything runs through one word split, so the tool answers "what are the
 * words here?" once and every form is a join. That is what lets
 * `HTTPResponseCode` and `http_response_code` produce identical output — a
 * per-form regex would get the acronym right in some columns and wrong in
 * others.
 */

export interface CaseForms {
  camel: string;
  pascal: string;
  snake: string;
  kebab: string;
  constant: string;
  title: string;
  sentence: string;
  slug: string;
  lower: string;
  upper: string;
}

/**
 * Split any of the usual conventions into words.
 *
 * The two boundary rules run in order and both are needed: the first cuts
 * `fooBar`, the second cuts the *tail* of a run of capitals (`HTTPResponse` →
 * `HTTP` + `Response`) rather than exploding it into single letters.
 */
export function splitWords(input: string): string[] {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

const lower = (word: string) => word.toLowerCase();
const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

/**
 * A URL/filename slug: diacritics folded to ASCII rather than dropped, so
 * `Crème Brûlée` becomes `creme-brulee` and not `crme-brle`.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function convertCase(input: string): CaseForms {
  const words = splitWords(input);
  const empty = words.length === 0;
  return {
    camel: empty ? '' : words.map((w, i) => (i === 0 ? lower(w) : capitalize(w))).join(''),
    pascal: words.map(capitalize).join(''),
    snake: words.map(lower).join('_'),
    kebab: words.map(lower).join('-'),
    constant: words.map((w) => w.toUpperCase()).join('_'),
    title: words.map(capitalize).join(' '),
    sentence: empty ? '' : [capitalize(words[0] ?? ''), ...words.slice(1).map(lower)].join(' '),
    slug: slugify(input),
    lower: words.map(lower).join(' '),
    upper: words.map((w) => w.toUpperCase()).join(' '),
  };
}
