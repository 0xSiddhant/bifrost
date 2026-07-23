/**
 * Loki's JavaScript transform toolkit (PLAN-12) — all pure, offline-safe, and
 * `eval`-free. The heavy formatters (Prettier/Terser) and the acorn syntax
 * check are lazy and imported from their own modules on demand.
 */

export { scanJs, type Segment, type SegmentType } from './scan';
export {
  stringifyJs,
  destringifyJs,
  htmlEscape,
  htmlUnescape,
  uriEncode,
  uriDecode,
  convertQuotes,
  isSingleStringLiteral,
  type QuoteStyle,
} from './strings';
export { stripComments } from './comments';
export { wrapIife, unwrapIife } from './iife';
export { curlToFetch, tokenizeShell, type CurlResult } from './curl';
export { jsonToJs } from './jsonToJs';
export {
  beautifyJs,
  minifyJs,
  type BeautifyOptions,
  type MinifyOptions,
  type MinifyResult,
} from './format';
export { checkJsSyntax, type JsSyntaxError } from './syntax';
