/**
 * Lightweight JS syntax check for Loki's error banner (PLAN-12). acorn is a
 * new lazy dep (~30 KB) — the JSON stack uses jsonc-parser, not acorn — so it
 * is dynamically imported only when a check actually runs.
 */

export interface JsSyntaxError {
  message: string;
  line: number;
  /** 1-based column. */
  column: number;
}

export async function checkJsSyntax(code: string): Promise<JsSyntaxError | null> {
  if (code.trim() === '') return null;
  const { parse } = await import('acorn');
  try {
    parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      allowImportExportEverywhere: true,
    });
    return null;
  } catch (error) {
    const err = error as { message?: string; loc?: { line: number; column: number } };
    return {
      message: (err.message ?? 'Syntax error').replace(/\s*\(\d+:\d+\)\s*$/, ''),
      line: err.loc?.line ?? 1,
      column: (err.loc?.column ?? 0) + 1,
    };
  }
}
