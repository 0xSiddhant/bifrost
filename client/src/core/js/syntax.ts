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

/**
 * REPL completion value (Loki Part B). If the last top-level statement is an
 * expression (a bare call, literal, etc.), rewrite it to `return (…)` so the
 * runner captures and shows its value — the way a console/REPL does. Anything
 * else (a declaration, loop, if) yields no value. Returns the code unchanged
 * when it can't be parsed (the runner then surfaces the syntax error).
 */
export async function wrapLastExpression(code: string): Promise<string> {
  if (code.trim() === '') return code;
  const { parse } = await import('acorn');
  let body: Array<{ type: string; start: number; end: number; expression?: { start: number; end: number } }>;
  try {
    const ast = parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      allowImportExportEverywhere: true,
    }) as unknown as { body: typeof body };
    body = ast.body;
  } catch {
    return code;
  }
  const last = body[body.length - 1];
  if (!last || last.type !== 'ExpressionStatement' || !last.expression) return code;
  // `before` ends exactly where the last statement began (same line), so line
  // numbers in a thrown stack stay aligned.
  const before = code.slice(0, last.start);
  const exprSrc = code.slice(last.expression.start, last.expression.end);
  return `${before}return (${exprSrc});`;
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
