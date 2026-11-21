import { describe, expect, it } from 'vitest';
import { checkBudget, firstLoad, packageOf, type BudgetBundle } from './bundleBudget';

const NM = '/repo/node_modules';

function chunk(
  fileName: string,
  moduleIds: string[],
  options: { isEntry?: boolean; imports?: string[]; css?: string[]; code?: string } = {},
): BudgetBundle[string] {
  return {
    type: 'chunk',
    fileName,
    isEntry: options.isEntry ?? false,
    imports: options.imports ?? [],
    moduleIds,
    code: options.code ?? `/* ${fileName} */`,
    viteMetadata: { importedCss: new Set(options.css ?? []) },
  };
}

function bundleOf(...outputs: BudgetBundle[string][]): BudgetBundle {
  return Object.fromEntries(outputs.map((output) => [output.fileName, output]));
}

/** An app whose entry preloads `shared`, and whose Edda page is lazy. */
function app(sharedModules: string[], lazyModules: string[] = []): BudgetBundle {
  return bundleOf(
    chunk('assets/index-a.js', ['/repo/client/src/main.tsx', `${NM}/react-dom/index.js`], {
      isEntry: true,
      imports: ['assets/shared-b.js'],
      css: ['assets/index-a.css'],
    }),
    chunk('assets/shared-b.js', ['/repo/client/src/core/log.ts', ...sharedModules], {
      imports: ['assets/runtime-c.js'],
    }),
    chunk('assets/runtime-c.js', ['\0rolldown/runtime.js']),
    chunk('assets/EddaPage-d.js', ['/repo/client/src/features/edda/EddaPage.tsx', ...lazyModules]),
    { type: 'asset', fileName: 'assets/index-a.css', source: 'body{margin:0}' },
  );
}

describe('the bundle budget (PLAN-40)', () => {
  it('names a package by its node_modules folder, scoped or not', () => {
    expect(packageOf(`${NM}/highlight.js/lib/common.js`)).toBe('highlight.js');
    expect(packageOf(`${NM}/@codemirror/view/dist/index.js`)).toBe('@codemirror/view');
    expect(packageOf(`${NM}/a/node_modules/marked/lib/marked.esm.js`)).toBe('marked');
    expect(packageOf('/repo/client/src/core/markdown/render.ts')).toBeNull();
  });

  it('follows the entry through its static imports, transitively, and their CSS', () => {
    const load = firstLoad(app([]));
    expect(load.chunks).toEqual(['assets/index-a.js', 'assets/shared-b.js', 'assets/runtime-c.js']);
    expect(load.css).toEqual(['assets/index-a.css']);
    expect(load.gzipBytes).toBeGreaterThan(0);
  });

  it('fails a heavy library in a modulepreloaded chunk, naming the package and the chunk', () => {
    const { problems } = checkBudget(app([`${NM}/highlight.js/lib/common.js`]), Infinity);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('highlight.js');
    expect(problems[0]).toContain('assets/shared-b.js');
  });

  it('fails every scoped CodeMirror package, and each forbidden package once', () => {
    const { problems } = checkBudget(
      app([
        `${NM}/@codemirror/view/dist/index.js`,
        `${NM}/qrcode/lib/browser.js`,
        `${NM}/qrcode/lib/core/qrcode.js`,
      ]),
      Infinity,
    );
    expect(problems.map((line) => line.split(' ')[0])).toEqual(['@codemirror/view', 'qrcode']);
  });

  it('passes the same library in a lazy chunk', () => {
    const { problems } = checkBudget(
      app([], [`${NM}/highlight.js/lib/common.js`, `${NM}/marked/lib/marked.esm.js`]),
      Infinity,
    );
    expect(problems).toEqual([]);
  });

  it('fails a first load over budget, with both figures', () => {
    const big = app([]);
    const entry = big['assets/index-a.js'];
    if (entry?.type !== 'chunk') throw new Error('no entry');
    // Incompressible text, so its gzipped size stays near its length.
    entry.code = Array.from({ length: 4000 }, (_, i) => ((i * 7919) % 65521).toString(36)).join('');
    const { load, problems } = checkBudget(big, 1024);
    expect(load.gzipBytes).toBeGreaterThan(1024);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/the first load is \d+\.\d KB gzipped, over its 1\.0 KB budget/);
  });

  // PLAN-41: the shell's CSS has a figure of its own, so page styles drifting
  // back into the global sheets fail even while the total has room.
  it('fails first-load CSS over its own budget, naming the stylesheet and where page styles go', () => {
    const heavy = app([]);
    // Incompressible CSS, as above.
    const css = Array.from({ length: 2000 }, (_, i) => `.c${(i * 7919) % 65521}{x:${i}}`).join('');
    heavy['assets/index-a.css'] = { type: 'asset', fileName: 'assets/index-a.css', source: css };
    const { load, problems } = checkBudget(heavy, Infinity, 1024);
    expect(load.cssGzipBytes).toBeGreaterThan(1024);
    expect(load.gzipBytes).toBeGreaterThan(load.cssGzipBytes);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(
      /the first load's CSS is \d+\.\d KB gzipped, over its 1\.0 KB budget \(assets\/index-a\.css\)/,
    );
    expect(problems[0]).toContain('a stylesheet that page or panel imports');
  });

  it('passes CSS under its budget, and still checks the total', () => {
    const { load, problems } = checkBudget(app([]), 1, Infinity);
    expect(load.cssGzipBytes).toBeGreaterThan(0);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^the first load is /);
  });
});
