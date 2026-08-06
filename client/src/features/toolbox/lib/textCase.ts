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
 *
 * Unicode-aware (`\p{L}`, not `A-Za-z`): with an ASCII class, `Crème` splits on
 * its own accent into `Cr` + `me`, so every form below would mangle a word the
 * user typed correctly.
 */
export function splitWords(input: string): string[] {
  return input
    .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

const lower = (word: string) => word.toLowerCase();
const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

/**
 * A URL/filename slug: ASCII only, diacritics folded rather than dropped
 * (`Crème Brûlée` → `creme-brulee`, not `crme-brle`).
 *
 * Runs through the same word split as every other form, so `HTTPResponseCode`
 * slugs to `http-response-code`. Slugging the raw string instead — the obvious
 * implementation — has no separators to work with in a camelCase input and
 * returns the whole thing as one word, which is exactly what live verification
 * caught.
 */
export function slugify(input: string): string {
  return splitWords(input.normalize('NFD').replace(/\p{M}/gu, ''))
    .map((word) => word.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
    .join('-');
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
