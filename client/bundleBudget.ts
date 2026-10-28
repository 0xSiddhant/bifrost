/**
 * The first-load budget (PLAN-40): what every page of either build downloads
 * before it can paint, checked at build time.
 *
 * The first load is the entry chunk and every chunk it imports statically,
 * followed down transitively: exactly the set `index.html` modulepreloads,
 * plus the CSS those chunks pull in. The build fails when that set holds a
 * module from one of the heavy libraries below (each belongs to a page or a
 * panel and is loaded lazily), or when its gzipped size passes the budget.
 *
 * Lighthouse itself is not a CI gate: on a shared runner two clean runs a
 * minute apart differed fivefold in blocking time, and PLAN-34 already ruled
 * timing an on-demand measurement. What makes the numbers bad can be checked
 * exactly, which is this. The same shape as `scripts/check-standalone.ts`: a
 * build-time assertion whose message names the culprit.
 */
import { gzipSync } from 'node:zlib';
import type { Plugin } from 'vite';

/**
 * Packages that must never reach the first load, by name (`@scope/` matches
 * every package in the scope). The Markdown stack belongs to the Guide panel
 * and the editors, `qrcode` to the Join card and the QR tools, the rest to the
 * pages that use them.
 */
export const FORBIDDEN_PACKAGES = [
  'highlight.js',
  'marked',
  'dompurify',
  'qrcode',
  'mermaid',
  'pdfjs-dist',
  '@codemirror/',
  // CodeMirror's own parser packages: nothing else uses them.
  '@lezer/',
] as const;

/**
 * The first load's gzipped size (JavaScript plus CSS) may not pass this, in
 * either build. Set 2026-10-28, when PLAN-40's code changes landed, to the
 * measured total plus 10%: 120.8 KB (the standalone build; the hub's was
 * 120.3 KB, from 210 KB before the plan) → 133 KB. A change that legitimately
 * needs more raises it in the same PR, so the cost shows in review.
 */
export const FIRST_LOAD_BUDGET_BYTES = 133 * 1024;

/** The parts of Vite's output this reads: a chunk or an emitted asset. */
export type BudgetBundle = Record<
  string,
  | {
      type: 'chunk';
      fileName: string;
      isEntry: boolean;
      imports: readonly string[];
      moduleIds: readonly string[];
      code: string;
      viteMetadata?: { importedCss: Set<string> };
    }
  | { type: 'asset'; fileName: string; source: string | Uint8Array }
>;

export interface FirstLoad {
  /** The chunks, entry first, then in the order they were reached. */
  chunks: string[];
  css: string[];
  gzipBytes: number;
}

/** The npm package a module id belongs to, or null for the app's own source. */
export function packageOf(moduleId: string): string | null {
  const at = moduleId.lastIndexOf('node_modules/');
  if (at === -1) return null;
  const [first = '', second = ''] = moduleId.slice(at + 'node_modules/'.length).split('/');
  return first.startsWith('@') ? `${first}/${second}` : first;
}

function forbidden(pkg: string): boolean {
  return FORBIDDEN_PACKAGES.some((name) =>
    name.endsWith('/') ? pkg.startsWith(name) : pkg === name,
  );
}

/** The entry chunks and their static imports, transitively: what `index.html` preloads. */
export function firstLoad(bundle: BudgetBundle): FirstLoad {
  const chunks: string[] = [];
  const css = new Set<string>();
  const queue = Object.values(bundle)
    .filter((output) => output.type === 'chunk' && output.isEntry)
    .map((output) => output.fileName);
  while (queue.length > 0) {
    const fileName = queue.shift() ?? '';
    const chunk = bundle[fileName];
    if (chunks.includes(fileName) || chunk?.type !== 'chunk') continue;
    chunks.push(fileName);
    for (const sheet of chunk.viteMetadata?.importedCss ?? []) css.add(sheet);
    queue.push(...chunk.imports);
  }
  const gzipBytes = [...chunks, ...css].reduce((sum, fileName) => {
    const output = bundle[fileName];
    if (!output) return sum;
    const text = output.type === 'chunk' ? output.code : output.source;
    return sum + gzipSync(text, { level: 9 }).length;
  }, 0);
  return { chunks, css: [...css], gzipBytes };
}

/** The first load, and what is wrong with it, one line each (none when within budget). */
export function checkBudget(
  bundle: BudgetBundle,
  budgetBytes: number = FIRST_LOAD_BUDGET_BYTES,
): { load: FirstLoad; problems: string[] } {
  const load = firstLoad(bundle);
  const problems: string[] = [];
  for (const fileName of load.chunks) {
    const chunk = bundle[fileName];
    if (chunk?.type !== 'chunk') continue;
    const packages = new Set(chunk.moduleIds.map(packageOf).filter((pkg) => pkg !== null));
    for (const pkg of [...packages].filter(forbidden).sort()) {
      problems.push(
        `${pkg} is in the first load, in ${fileName}: import it lazily (import() or React.lazy) ` +
          'from the page or panel that needs it',
      );
    }
  }
  if (load.gzipBytes > budgetBytes) {
    problems.push(
      `the first load is ${kb(load.gzipBytes)} gzipped, over its ${kb(budgetBytes)} budget ` +
        `(${load.chunks.length} chunks, ${load.css.length} stylesheets). If the growth is meant, ` +
        'raise FIRST_LOAD_BUDGET_BYTES in client/bundleBudget.ts in the same change',
    );
  }
  return { load, problems };
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function bundleBudgetPlugin(budgetBytes: number = FIRST_LOAD_BUDGET_BYTES): Plugin {
  return {
    name: 'bifrost-bundle-budget',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const { load, problems } = checkBudget(bundle as unknown as BudgetBundle, budgetBytes);
      if (problems.length > 0) {
        this.error(`bundle budget:\n  ${problems.join('\n  ')}`);
      }
      this.info(`first load: ${kb(load.gzipBytes)} gzipped of a ${kb(budgetBytes)} budget`);
    },
  };
}
