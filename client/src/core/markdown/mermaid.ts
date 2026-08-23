import DOMPurify from 'dompurify';
import { log } from '../log';
import { MERMAID_PLACEHOLDER_CLASS } from './render';

/**
 * The mermaid pass (PLAN-20): turn the `<pre class="mermaid-src">` placeholders
 * `renderMarkdown` leaves behind into real diagrams.
 *
 * It lives in `core/` rather than `features/edda/` because `features/previews/`
 * renders markdown too and features may never import each other — from here the
 * second consumer is one call.
 *
 * Three properties are load-bearing:
 *
 * 1. **Nothing is imported until a document actually has a diagram.** Mermaid is
 *    roughly a megabyte; most eddas have no fence and must pay nothing.
 * 2. **The input is untrusted.** Any device on the LAN can save an edda, and
 *    `/edda/preview/:slug` is public, so a diagram is markup written by someone
 *    else and rendered in *your* browser. See SECURITY below.
 * 3. **Colour is read at render time and cached with the diagram.** Mermaid
 *    bakes colours into the SVG, so a diagram drawn in Aurora would stay dark
 *    after a switch to Daybreak; keying the cache on the palette makes a theme
 *    change invalidate exactly the entries it should.
 *
 * SECURITY — what is pinned and why:
 *
 * - `securityLevel: 'strict'` and `htmlLabels: false`: no HTML inside labels, so
 *   no `foreignObject` surface at all, and no `click`/`callback` directives.
 * - `suppressErrorRendering: true`: a bad diagram gets *our* error block, never
 *   mermaid's own injected graphic.
 * - The output is sanitized with DOMPurify's SVG profile. The spike this plan
 *   demanded found that the profile **keeps a `<style>` element inside the
 *   `<svg>`** — `style` is on the SVG allow-list even though the HTML profile
 *   drops it — so mermaid's diagrams arrive fully coloured and the plan's
 *   `themeVariables`-only fallback is not needed.
 * - `secure` is **extended past mermaid's default**, which is the one place this
 *   file knowingly departs from the plan text. Keeping `<style>` is only safe if
 *   the document cannot write into it, and mermaid's default `secure` list
 *   (`secure`, `securityLevel`, `startOnLoad`, `maxTextSize`,
 *   `suppressErrorRendering`, `maxEdges`) does not cover `themeCSS` — raw CSS,
 *   which an in-document `%%{init: …}%%` directive may therefore set. That is
 *   not theoretical: a diagram carrying
 *   `%%{init: {"themeCSS": "& .node rect { filter: url(http://host/x.png#f) }"}}%%`
 *   made the browser fetch that URL during render, which is both a beacon and a
 *   breach of "Bifrost is offline by design". Locking the styling keys closes it.
 */

/** Mermaid's own default `secure` list, which we extend rather than replace. */
const MERMAID_DEFAULT_SECURE = [
  'secure',
  'securityLevel',
  'startOnLoad',
  'maxTextSize',
  'suppressErrorRendering',
  'maxEdges',
];

/** Everything that can put attacker-chosen CSS or colour into the output. */
const SECURE_KEYS = [
  ...MERMAID_DEFAULT_SECURE,
  'themeCSS',
  'theme',
  'themeVariables',
  'fontFamily',
  'altFontFamily',
  'htmlLabels',
];

/** Bifrost token → mermaid themeVariable. Read fresh on every render pass. */
export interface MermaidPalette {
  background: string;
  surface: string;
  surface2: string;
  text: string;
  textMuted: string;
  accent: string;
  accent2: string;
  border: string;
  font: string;
}

/** Ink on paper — the palette the HTML/PDF export prints with (PLAN-20). */
export const PAPER_PALETTE: MermaidPalette = {
  background: '#ffffff',
  surface: '#f4f4f5',
  surface2: '#e7e7ea',
  text: '#16181d',
  textMuted: '#52525b',
  accent: '#1f2937',
  accent2: '#3f3f46',
  border: '#9ca3af',
  font: 'Georgia, "Times New Roman", serif',
};

function readPalette(): MermaidPalette {
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  return {
    background: read('--surface', '#131824'),
    surface: read('--surface-2', '#1b2233'),
    surface2: read('--surface', '#131824'),
    text: read('--text', '#e9edf5'),
    textMuted: read('--text-muted', '#8b94a7'),
    accent: read('--accent', '#2dd4bf'),
    accent2: read('--accent-2', '#8b7cf6'),
    border: read('--border', '#242e44'),
    font: read('--font-body', 'system-ui, sans-serif'),
  };
}

/**
 * Mermaid's "base" theme derives every other colour from these. Deliberately a
 * small map: the more tokens are pinned, the more a user theme's own palette is
 * overridden by ours.
 */
function themeVariables(palette: MermaidPalette): Record<string, string> {
  return {
    background: palette.background,
    primaryColor: palette.surface,
    primaryTextColor: palette.text,
    primaryBorderColor: palette.accent,
    secondaryColor: palette.surface2,
    secondaryTextColor: palette.text,
    secondaryBorderColor: palette.border,
    tertiaryColor: palette.surface,
    tertiaryTextColor: palette.textMuted,
    tertiaryBorderColor: palette.border,
    lineColor: palette.accent2,
    textColor: palette.text,
    mainBkg: palette.surface,
    nodeBorder: palette.accent,
    noteBkgColor: palette.surface2,
    noteTextColor: palette.text,
    noteBorderColor: palette.border,
  };
}

function paletteKey(palette: MermaidPalette): string {
  return Object.values(palette).join('|');
}

/**
 * Rendered SVG by source text, tagged with the palette it was drawn in. Typing
 * re-renders the preview on a 200 ms debounce and mermaid's layout is dagre —
 * without this, every keystroke batch would re-lay-out every diagram.
 */
const cache = new Map<string, { palette: string; svg: string }>();
/** Bound: a diagram-heavy document plus a few edits, not a session's history. */
const CACHE_MAX = 64;

export function clearMermaidCache(): void {
  cache.clear();
}

type MermaidApi = {
  initialize(config: Record<string, unknown>): void;
  render(id: string, source: string): Promise<{ svg: string }>;
};

let loading: Promise<MermaidApi> | null = null;

/** One import per page life, shared by every surface. */
async function loadMermaid(): Promise<MermaidApi> {
  loading ??= import('mermaid').then((module) => module.default as unknown as MermaidApi);
  return loading;
}

let renderSeq = 0;

/** Mermaid ids leak into the SVG's own CSS selectors, so they must be unique. */
function nextId(): string {
  renderSeq += 1;
  return `bifrost-mermaid-${renderSeq}`;
}

function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
}

/**
 * A diagram that will not parse: bordered, named, with its source below. Never
 * a blank gap — the author has to be able to see what they typed and why it was
 * refused.
 */
function errorFigure(source: string, message: string): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'mermaid mermaid--error';
  const caption = document.createElement('figcaption');
  caption.textContent = `This diagram could not be drawn — ${message}`;
  const pre = document.createElement('pre');
  pre.textContent = source;
  figure.append(caption, pre);
  return figure;
}

function diagramFigure(source: string, svg: string, palette: string): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'mermaid';
  // The source rides along so a theme change can re-draw a figure that has
  // already replaced its placeholder.
  figure.dataset.mermaidSrc = source;
  figure.dataset.mermaidPalette = palette;
  figure.innerHTML = svg;
  return figure;
}

interface PassOptions {
  /** Override the live theme — the export draws a second, paper-coloured copy. */
  palette?: MermaidPalette;
  /** Reporting feature name for any failure line (`edda`, `previews`, …). */
  module?: string;
}

/** What a pass works on: a node, or a getter for one that React may swap. */
export type MermaidTarget = ParentNode | (() => ParentNode | null);

const resolve = (target: MermaidTarget): ParentNode | null =>
  typeof target === 'function' ? target() : target;

const PLACEHOLDERS = `pre.${MERMAID_PLACEHOLDER_CLASS}, figure.mermaid[data-mermaid-src]`;

function pending(container: ParentNode, key: string): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(PLACEHOLDERS)).filter(
    (element) => element.dataset.mermaidPalette !== key,
  );
}

/**
 * Replace every diagram placeholder inside `container` with its rendered SVG.
 * Idempotent and re-runnable: an already-drawn figure is left alone unless the
 * palette has changed under it, which is what makes the theme switch cheap.
 *
 * **Render first, then swap — and never hold a node across an await.** The
 * container belongs to React, which re-sets it from `dangerouslySetInnerHTML`
 * whenever the rendered HTML changes; a pass that captured nodes up front and
 * replaced them after `await` put its diagrams into a subtree that had already
 * been thrown away, leaving the placeholders visible on the live one. So the
 * awaits only ever fill the cache, and the DOM swap at the end is synchronous
 * against a freshly-resolved container, where nothing can move under it.
 *
 * Returns the number of diagrams drawn or redrawn.
 */
export async function renderMermaidIn(
  container: MermaidTarget,
  options: PassOptions = {},
): Promise<number> {
  const palette = options.palette ?? readPalette();
  const key = paletteKey(palette);
  const module = options.module ?? 'edda';

  const first = resolve(container);
  if (!first) return 0;
  const sources = new Set(
    pending(first, key).map((element) => element.dataset.mermaidSrc ?? element.textContent ?? ''),
  );
  if (sources.size === 0) return 0;

  let mermaid: MermaidApi;
  try {
    mermaid = await loadMermaid();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      sequence: { htmlLabels: false },
      class: { htmlLabels: false },
      suppressErrorRendering: true,
      secure: SECURE_KEYS,
      theme: 'base',
      themeVariables: themeVariables(palette),
      fontFamily: palette.font,
    });
  } catch (error) {
    // The chunk failed to arrive or mermaid refused its own config. Every
    // placeholder stays readable as source, which is the honest degradation.
    log.reportError('mermaid failed to load', error, { module });
    return 0;
  }

  const drawings = new Map<string, { svg: string } | { error: string }>();
  for (const source of sources) {
    const cached = cache.get(source);
    if (cached && cached.palette === key) {
      drawings.set(source, { svg: cached.svg });
      continue;
    }
    try {
      const { svg } = await mermaid.render(nextId(), source);
      const clean = sanitizeSvg(svg);
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
      cache.set(source, { palette: key, svg: clean });
      drawings.set(source, { svg: clean });
    } catch (error) {
      // Expected for a typo mid-edit, so this is `warn`, not `error`: it is
      // the author's syntax, not a Bifrost fault, and the block on screen
      // already tells them. Logged all the same — a diagram that fails on
      // one device and not another is otherwise invisible.
      const message = error instanceof Error ? error.message : String(error);
      const summary = firstLine(message);
      log.warn(`mermaid diagram failed to render: ${summary}`, { module });
      drawings.set(source, { error: summary });
    }
  }

  // Everything below here is synchronous, against the container as it is now.
  const live = resolve(container);
  if (!live) return 0;
  let drawn = 0;
  for (const target of pending(live, key)) {
    const source = target.dataset.mermaidSrc ?? target.textContent ?? '';
    const drawing = drawings.get(source);
    if (!drawing) continue;
    target.replaceWith(
      'svg' in drawing ? diagramFigure(source, drawing.svg, key) : errorFigure(source, drawing.error),
    );
    drawn += 1;
  }
  return drawn;
}

function firstLine(message: string): string {
  const line = message.split('\n').find((part) => part.trim() !== '') ?? 'unknown error';
  // Mermaid's first line ends in a colon ("Parse error on line 2:") and the
  // detail after it is the source excerpt, which the block already shows.
  return line.trim().replace(/:$/, '').slice(0, 160);
}
