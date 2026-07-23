/**
 * Convert a cURL command to a `fetch()` snippet (Loki, PLAN-12). Unsupported
 * flags are never silently dropped — they are listed back to the caller so the
 * page can surface them.
 */

import { stringifyJs } from './strings';

export interface CurlResult {
  code: string;
  /** Flags recognised but not translatable to fetch, reported to the user. */
  unsupported: string[];
}

/** Tokenize a shell-ish command: honours quotes and `\`-newline continuations. */
export function tokenizeShell(input: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let has = false;
  let i = 0;
  const n = input.length;
  while (i < n) {
    const ch = input.charAt(i);
    if (ch === '\\' && input[i + 1] === '\n') {
      i += 2; // line continuation
      continue;
    }
    if (ch === '\\' && i + 1 < n) {
      cur += input[i + 1];
      has = true;
      i += 2;
      continue;
    }
    if (ch === "'") {
      has = true;
      i += 1;
      while (i < n && input[i] !== "'") cur += input[i++];
      i += 1;
      continue;
    }
    if (ch === '"') {
      has = true;
      i += 1;
      while (i < n && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < n) {
          cur += input[i + 1];
          i += 2;
        } else {
          cur += input[i++];
        }
      }
      i += 1;
      continue;
    }
    if (/\s/.test(ch)) {
      if (has) {
        tokens.push(cur);
        cur = '';
        has = false;
      }
      i += 1;
      continue;
    }
    cur += ch;
    has = true;
    i += 1;
  }
  if (has) tokens.push(cur);
  return tokens;
}

const VALUE_FLAGS = new Set([
  '-X', '--request', '-H', '--header', '-d', '--data', '--data-raw',
  '--data-binary', '--data-urlencode', '-u', '--user', '-A', '--user-agent',
  '-e', '--referer', '-b', '--cookie',
]);
const BOOLEAN_IGNORED = new Set(['--compressed', '-L', '--location', '-s', '--silent', '-i', '--include', '-#']);

export function curlToFetch(command: string): CurlResult {
  const tokens = tokenizeShell(command.trim());
  if (tokens[0] === 'curl') tokens.shift();

  let url = '';
  let method = '';
  const headers: [string, string][] = [];
  const dataParts: string[] = [];
  const unsupported: string[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i] ?? '';
    const takeValue = () => tokens[++i] ?? '';
    if (tok === '-X' || tok === '--request') {
      method = takeValue().toUpperCase();
    } else if (tok === '-H' || tok === '--header') {
      const raw = takeValue();
      const idx = raw.indexOf(':');
      if (idx !== -1) headers.push([raw.slice(0, idx).trim(), raw.slice(idx + 1).trim()]);
    } else if (tok === '-d' || tok === '--data' || tok === '--data-raw' || tok === '--data-binary' || tok === '--data-urlencode') {
      dataParts.push(takeValue());
    } else if (tok === '-u' || tok === '--user') {
      headers.push(['Authorization', `Basic ${btoaSafe(takeValue())}`]);
    } else if (tok === '-A' || tok === '--user-agent') {
      headers.push(['User-Agent', takeValue()]);
    } else if (tok === '-e' || tok === '--referer') {
      headers.push(['Referer', takeValue()]);
    } else if (tok === '-b' || tok === '--cookie') {
      headers.push(['Cookie', takeValue()]);
    } else if (BOOLEAN_IGNORED.has(tok)) {
      // silently harmless for fetch
    } else if (tok.startsWith('-')) {
      unsupported.push(tok);
      // Skip a following value for unknown value-taking flags we can't classify.
      if (VALUE_FLAGS.has(tok)) i += 1;
    } else if (!url) {
      url = tok;
    }
  }

  const body = dataParts.length > 0 ? dataParts.join('&') : null;
  if (!method) method = body !== null ? 'POST' : 'GET';

  const lines: string[] = [];
  for (const flag of unsupported) lines.push(`// unsupported cURL flag: ${flag}`);

  const optionParts: string[] = [`method: ${stringifyJs(method, 'single')}`];
  if (headers.length > 0) {
    const headerLines = headers
      .map(([k, v]) => `    ${stringifyJs(k, 'single')}: ${stringifyJs(v, 'single')},`)
      .join('\n');
    optionParts.push(`headers: {\n${headerLines}\n  }`);
  }
  if (body !== null) optionParts.push(`body: ${stringifyJs(body, 'single')}`);

  lines.push(
    `const response = await fetch(${stringifyJs(url, 'single')}, {\n  ${optionParts.join(
      ',\n  ',
    )},\n});`,
    'const data = await response.json();',
  );

  return { code: lines.join('\n'), unsupported };
}

/** btoa that also works on non-Latin1 input (encode to UTF-8 bytes first). */
function btoaSafe(text: string): string {
  if (typeof btoa === 'function') {
    try {
      return btoa(text);
    } catch {
      // fall through for non-Latin1
    }
  }
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return typeof btoa === 'function' ? btoa(binary) : binary;
}
