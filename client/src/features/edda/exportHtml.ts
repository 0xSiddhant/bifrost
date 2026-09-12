import { hasMermaid, renderMarkdown, renderMermaidIn, PAPER_PALETTE } from '../../core/markdown';

/**
 * Build a self-contained `.html` export (PLAN-11): the rendered, sanitized body
 * plus a minimal snapshot of the current theme tokens inlined as CSS, so the
 * file opens and reads correctly anywhere with no Bifrost, no network, no theme
 * engine. Uses the same renderMarkdown as the live preview — zero drift.
 *
 * PLAN-20 made it **async** and gave it two more jobs.
 *
 * 1. **Diagrams are inlined as SVG.** An exported file whose diagram is the
 *    literal text `graph TD; A-->B` is a broken artifact, and shipping mermaid's
 *    megabyte into a standalone file to avoid that is worse.
 * 2. **It is also the print document.** `print.ts` loads this string into a
 *    hidden iframe and prints it, so `.html` and `.pdf` are the same artifact
 *    rather than two things that drift. That is why the `@media print` block
 *    below matters as much as the screen styling: browsers drop backgrounds
 *    when printing, so an Aurora-dark export would otherwise print near-white
 *    text on white paper.
 *
 * Each diagram is therefore drawn **twice** — once in the active theme for
 * reading on screen, once ink-on-paper for printing — and the pair is toggled
 * by `@media print`. One copy cannot serve both: the colours are baked into the
 * SVG at render time, so a screen-themed diagram prints as dark ink blocks and
 * a paper-themed one is invisible against the dark page it sits in.
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

/** `<!-- pagebreak -->` alone on a line forces a page break where it appears. */
const PAGEBREAK = /^[ \t]*<!--[ \t]*pagebreak[ \t]*-->[ \t]*$/gim;

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

/**
 * The body: markdown → HTML → diagrams inlined, in a detached container so
 * nothing flickers on the page the user is looking at.
 */
async function renderExportBody(markdown: string): Promise<string> {
  const source = markdown.replace(PAGEBREAK, '<div class="pagebreak"></div>');
  const html = renderMarkdown(source);
  if (!hasMermaid(source)) return html;

  const screen = document.createElement('div');
  screen.innerHTML = html;
  await renderMermaidIn(screen, { module: 'edda' });

  const paper = document.createElement('div');
  paper.innerHTML = html;
  await renderMermaidIn(paper, { palette: PAPER_PALETTE, module: 'edda' });

  const paperFigures = Array.from(paper.querySelectorAll('figure.mermaid'));
  // Materialized before the loop: each `after()` inserts into the same parent.
  Array.from(screen.querySelectorAll('figure.mermaid')).forEach((figure, index) => {
    figure.classList.add('mermaid--screen');
    const printCopy = paperFigures[index];
    if (!printCopy) return;
    printCopy.classList.add('mermaid--print');
    figure.after(printCopy);
  });
  return screen.innerHTML;
}

export async function exportHtmlDocument(title: string, markdown: string): Promise<string> {
  const body = await renderExportBody(markdown);
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
    p, ul, ol, blockquote, table, pre, figure { margin: 0 0 1rem; }
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

    /* Diagrams (PLAN-20). max-width beats mermaid's own inline max-width, so a
       diagram wider than the page scales down instead of being clipped. */
    figure.mermaid { margin: 1.5rem 0; text-align: center; }
    figure.mermaid svg { max-width: 100% !important; height: auto; }
    figure.mermaid--print { display: none; }
    figure.mermaid--error {
      border: 1px solid var(--border, #333);
      border-radius: var(--radius-md, 8px);
      padding: 0.75rem 1rem;
      text-align: left;
    }
    figure.mermaid--error figcaption { font-size: 0.85rem; margin-bottom: 0.5rem; }
    .pagebreak { height: 0; }

    /* Ink on paper, whatever theme this file was exported from — browsers drop
       backgrounds when printing, so the tokens have to be overridden rather
       than relied on. */
    @media print {
      :root {
        --bg: #ffffff;
        --surface: #ffffff;
        --surface-2: #f4f4f5;
        --text: #16181d;
        --text-muted: #52525b;
        --accent: #1f2937;
        --border: #9ca3af;
      }
      body { background: #ffffff; color: #16181d; }
      main { max-width: none; padding: 0; }
      a { color: #1f2937; }
      pre { border: 1px solid #d4d4d8; }
      figure.mermaid--screen { display: none; }
      figure.mermaid--print { display: block; }
      /* Nothing that reads as one unit may be cut in half by a page edge. */
      pre, table, blockquote, figure { break-inside: avoid; }
      h1, h2, h3, h4, h5, h6 { break-after: avoid; }
      .pagebreak { break-after: page; }
    }
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
