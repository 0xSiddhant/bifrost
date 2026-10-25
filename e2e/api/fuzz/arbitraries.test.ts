import { Ajv } from 'ajv';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { loadSpec, type JsonSchema } from '../support/spec.js';
import { UnsupportedSchemaError, hasLoneSurrogate, mutations, valid } from './arbitraries.js';

/**
 * The translator's own contract (PLAN-33, criterion 6): what `valid` makes,
 * the schema accepts; what `mutations` makes, the schema refuses — both read
 * literally, by ajv with no coercion and no stripping. And a keyword outside
 * the verified set throws.
 */

const literal = new Ajv({ strict: false, allErrors: false });
const accepts = (schema: JsonSchema, value: unknown) =>
  literal.validate(structuredClone(schema), value);

const KEYWORD_CASES: [string, JsonSchema][] = [
  ['type string with min/max length', { type: 'string', minLength: 2, maxLength: 5 }],
  ['a pattern', { type: 'string', pattern: '^[a-z0-9-]{2,32}$' }],
  [
    'the stored-name pattern',
    { type: 'string', minLength: 1, maxLength: 255, pattern: '^[^./\\\\][^/\\\\]*$' },
  ],
  ['an integer range', { type: 'integer', minimum: 1, maximum: 500 }],
  ['a number with a floor', { type: 'number', minimum: 0.01 }],
  ['an enum without a type', { enum: ['asc', 'desc'] }],
  ['a nullable string', { type: ['string', 'null'], maxLength: 32 }],
  ['a boolean', { type: 'boolean' }],
  [
    'an object: required, closed, minProperties',
    {
      type: 'object',
      required: ['a'],
      additionalProperties: false,
      minProperties: 1,
      properties: { a: { type: 'string' }, b: { type: 'integer', default: 3 } },
    },
  ],
  [
    'an array of objects with bounds',
    {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: {
        type: 'object',
        required: ['level'],
        properties: { level: { enum: ['warn', 'error'] } },
      },
    },
  ],
];

/** Every request schema in the committed spec: body, and each parameter. */
function specSchemas(): [string, JsonSchema][] {
  const out: [string, JsonSchema][] = [];
  for (const op of loadSpec().operations) {
    if (op.body) out.push([`${op.operationId} body`, op.body.schema]);
    for (const parameter of op.parameters)
      out.push([`${op.operationId} ${parameter.name}`, parameter.schema]);
  }
  return out;
}

describe('valid()', () => {
  it.each([...KEYWORD_CASES, ...specSchemas()])('%s: every value is accepted', (_label, schema) => {
    fc.assert(
      fc.property(valid(schema), (value) => accepts(schema, value)),
      { numRuns: 60 },
    );
  });

  it('keeps lone surrogates out of anything bound for a URL', () => {
    fc.assert(
      fc.property(
        valid({ type: 'string', maxLength: 20 }, 'url'),
        (value) => !hasLoneSurrogate(value as string),
      ),
      { numRuns: 300 },
    );
  });

  it('counts length in code points, even when two lone surrogates meet', () => {
    // '\ud800' then '\udfff' fuse into one astral character: a two-unit string
    // of one code point, under a minLength of 2 (CI seed 2075279933).
    const lengths = fc
      .sample(valid({ type: 'string', minLength: 2, maxLength: 2 }), { numRuns: 5_000, seed: 1 })
      .map((value) => [...(value as string)].length);
    expect(new Set(lengths)).toEqual(new Set([2]));
  });

  it('does produce the awkward strings for a JSON body', () => {
    const seen = fc
      .sample(valid({ type: 'string', maxLength: 30 }), { numRuns: 2_000, seed: 7 })
      .join('');
    for (const awkward of ['\u0000', ' ', '😀']) expect(seen).toContain(awkward);
    expect(hasLoneSurrogate(seen)).toBe(true);
  });
});

describe('mutations()', () => {
  it.each([...KEYWORD_CASES, ...specSchemas()])(
    '%s: every mutation is refused',
    (_label, schema) => {
      fc.assert(
        fc.property(valid(schema), (value) =>
          mutations(schema, value).every((mutation) => !accepts(schema, mutation.apply(value))),
        ),
        { numRuns: 30 },
      );
    },
  );

  it('covers each kind of mutation the plan lists', () => {
    const schema = KEYWORD_CASES[8]?.[1] as JsonSchema;
    const labels = mutations(schema, { a: 'x', b: 2 }).map((mutation) => mutation.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        'wrong type at /',
        'dropped required /a',
        'an unknown property at /',
        'fewer than minProperties at /',
        'wrong type at /a',
      ]),
    );
    expect(
      mutations({ type: 'string', pattern: '^[a-z]+$', maxLength: 3 }, 'abc').map((m) => m.label),
    ).toEqual(['wrong type at /', 'one past maxLength at /', 'failing the pattern at /']);
  });
});

describe('unknown keywords', () => {
  it.each([
    ['format', { type: 'string', format: 'email' }],
    ['oneOf', { oneOf: [{ type: 'string' }] }],
    ['nested', { type: 'object', properties: { a: { type: 'string', const: 'x' } } }],
  ])('throws on %s', (_label, schema) => {
    expect(() => valid(schema)).toThrow(UnsupportedSchemaError);
  });
});
