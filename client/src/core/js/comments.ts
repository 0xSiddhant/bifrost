/**
 * Strip `//` and `/* *\/` comments from JS source (Loki, PLAN-12), preserving
 * strings, template literals, and regex literals. Block comments that spanned
 * a line break collapse to a newline (keeps ASI honest); inline block comments
 * collapse to a space (never glues two tokens together).
 */

import { scanJs } from './scan';

export function stripComments(code: string): string {
  let out = '';
  for (const seg of scanJs(code)) {
    if (seg.type === 'line-comment') continue;
    if (seg.type === 'block-comment') {
      const body = code.slice(seg.start, seg.end);
      out += body.includes('\n') ? '\n' : ' ';
      continue;
    }
    out += code.slice(seg.start, seg.end);
  }
  // Tidy the whitespace the removed comments left behind, without touching
  // blank-line structure elsewhere.
  return out
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n');
}
