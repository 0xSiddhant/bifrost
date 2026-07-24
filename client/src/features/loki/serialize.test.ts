import { describe, expect, it } from 'vitest';
import { formatConsoleArgs, inspect } from './serialize';

describe('inspect', () => {
  it('handles primitives and the tricky ones', () => {
    expect(inspect(undefined)).toBe('undefined');
    expect(inspect(null)).toBe('null');
    expect(inspect(42)).toBe('42');
    expect(inspect(-0)).toBe('-0');
    expect(inspect(true)).toBe('true');
    expect(inspect('hi')).toBe('"hi"');
    expect(inspect(10n)).toBe('10n');
    expect(inspect(Symbol('x'))).toBe('Symbol(x)');
    expect(inspect(NaN)).toBe('NaN');
    expect(inspect(Infinity)).toBe('Infinity');
  });

  it('represents functions and classes', () => {
    expect(inspect(function foo() {})).toBe('ƒ foo()');
    expect(inspect(() => {})).toBe('ƒ (anonymous)()');
    expect(inspect(class Bar {})).toBe('class Bar()');
  });

  it('renders arrays and objects', () => {
    expect(inspect([1, 'a', true])).toBe('[ 1, "a", true ]');
    expect(inspect([])).toBe('[]');
    expect(inspect({ a: 1, 'b-c': 2 })).toBe('{ a: 1, "b-c": 2 }');
    expect(inspect({})).toBe('{}');
  });

  it('handles Error, Date, RegExp, Map, Set', () => {
    expect(inspect(new Error('boom'))).toBe('Error: boom');
    expect(inspect(new Date('2026-07-24T00:00:00.000Z'))).toBe('2026-07-24T00:00:00.000Z');
    expect(inspect(/ab+c/gi)).toBe('/ab+c/gi');
    expect(inspect(new Map([['k', 1]]))).toBe('Map(1) { "k" => 1 }');
    expect(inspect(new Set([1, 2]))).toBe('Set(2) { 1, 2 }');
  });

  it('is cycle-safe', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    expect(inspect(a)).toBe('{ name: "a", self: [Circular] }');
  });

  it('is depth-limited', () => {
    const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } };
    // 5 levels deep, the 6th collapses to [Object]
    expect(inspect(deep)).toContain('[Object]');
  });

  it('caps large collections', () => {
    const big = Array.from({ length: 250 }, (_, i) => i);
    const out = inspect(big);
    expect(out).toContain('… 150 more');
  });

  it('does not throw on any of a wild corpus', () => {
    const corpus: unknown[] = [
      {}, [], new Map(), new Set(), new Date(), /x/, () => {}, Symbol(), 0n,
      { nested: [1, [2, [3, [4, [5, [6]]]]]] },
      new Proxy({}, {}),
      Object.create(null),
      { toJSON() { throw new Error('nope'); } },
    ];
    for (const value of corpus) expect(() => inspect(value)).not.toThrow();
  });
});

describe('formatConsoleArgs', () => {
  it('prints top-level strings raw and inspects the rest', () => {
    expect(formatConsoleArgs(['count', 3, { a: 1 }])).toBe('count 3 { a: 1 }');
  });

  it('quotes strings nested inside objects', () => {
    expect(formatConsoleArgs([{ msg: 'hi' }])).toBe('{ msg: "hi" }');
  });
});
