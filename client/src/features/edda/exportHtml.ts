import { renderMarkdown } from '../../core/markdown';

/**
 * Build a self-contained `.html` export (PLAN-11): the rendered, sanitized body
 * plus a minimal snapshot of the current theme tokens inlined as CSS, so the
 * file opens and reads correctly anywhere with no Bifrost, no network, no theme
 * engine. Uses the same renderMarkdown as the live preview — zero drift.
 */

const TOKENS = [
  '--bg',
  '--surface',
  '--surface-2',
  '--text',
  '--text-muted',
  '--accent',
  '--border',
  '--radius-md',
  '--font-body',
  '--font-mono',
] as const;

function readTokens(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const out: Record<string, string> = {};
  for (const token of TOKENS) out[token] = style.getPropertyValue(token).trim();
  return out;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function exportHtmlDocument(title: string, markdown: string): string {
  const body = renderMarkdown(markdown);
  const t = readTokens();
  const vars = TOKENS.map((token) => `      ${token}: ${t[token] || 'initial'};`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
${vars}
    }
    body {
      margin: 0;
      background: var(--bg, #0b0e14);
      color: var(--text, #e6e9ef);
      font-family: var(--font-body, system-ui, sans-serif);
      line-height: 1.65;
    }
    main { max-width: 46rem; margin: 0 auto; padding: 3rem 1.25rem 6rem; }
    h1, h2, h3, h4 { line-height: 1.25; margin: 1.6em 0 0.6em; }
    a { color: var(--accent, #6ad); }
    p, ul, ol, blockquote, table, pre { margin: 0 0 1rem; }
    ul, ol { padding-left: 1.5rem; }
    blockquote {
      border-left: 3px solid var(--border, #333);
      margin-left: 0;
      padding-left: 1rem;
      color: var(--text-muted, #99a);
    }
    code { font-family: var(--font-mono, ui-monospace, monospace); font-size: 0.9em; }
    pre {
      background: var(--surface-2, #12161f);
      border-radius: var(--radius-md, 8px);
      padding: 1rem;
      overflow-x: auto;
    }
    pre code { font-size: 0.85rem; }
    img { max-width: 100%; }
    table { border-collapse: collapse; }
    td, th { border: 1px solid var(--border, #333); padding: 0.35rem 0.6rem; }
  </style>
</head>
<body>
  <main>
${body}
  </main>
</body>
</html>
`;
}
