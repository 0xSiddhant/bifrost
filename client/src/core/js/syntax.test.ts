import { describe, expect, it } from 'vitest';
import { wrapLastExpression } from './syntax';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => () => Promise<unknown>;
const runBody = (body: string): Promise<unknown> => new AsyncFunction(body)();

describe('wrapLastExpression', () => {
  it('wraps a single expression to return its value', async () => {
    expect(await wrapLastExpression('40 + 2')).toBe('return (40 + 2);');
    expect(await runBody(await wrapLastExpression('40 + 2'))).toBe(42);
  });

  it('captures the last expression after other statements (REPL completion value)', async () => {
    const code = `function double(n){ return n * 2; }\ndouble(21)`;
    const body = await wrapLastExpression(code);
    expect(body).toContain('return (double(21));');
    expect(await runBody(body)).toBe(42);
  });

  it('captures the return of a call that produces a value (the reported case)', async () => {
    const code = [
      'function make() {',
      '  const json = { a: 1, b: [2, 3] };',
      '  return JSON.stringify(json);',
      '}',
      'make();',
    ].join('\n');
    const body = await wrapLastExpression(code);
    expect(await runBody(body)).toBe('{"a":1,"b":[2,3]}');
  });

  it('leaves code ending in a declaration untouched (no value)', async () => {
    const code = 'const a = 1;';
    expect(await wrapLastExpression(code)).toBe(code);
    expect(await runBody(await wrapLastExpression(code))).toBeUndefined();
  });

  it('leaves code ending in a control statement untouched', async () => {
    const code = 'let total = 0;\nfor (let i = 0; i < 3; i++) total += i;';
    expect(await wrapLastExpression(code)).toBe(code);
  });

  it('returns the input unchanged when it cannot be parsed', async () => {
    const code = 'const a = (';
    expect(await wrapLastExpression(code)).toBe(code);
  });

  it('supports top-level await in the trailing expression', async () => {
    const code = 'await Promise.resolve(7)';
    expect(await runBody(await wrapLastExpression(code))).toBe(7);
  });

  it('returns empty input unchanged', async () => {
    expect(await wrapLastExpression('   ')).toBe('   ');
  });
});
