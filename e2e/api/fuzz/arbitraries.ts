import fc from 'fast-check';
import type { JsonSchema } from '../support/spec.js';

/**
 * Request schemas → fast-check arbitraries (PLAN-33).
 *
 * The translator covers exactly the keywords the server's request schemas use
 * (verified when the plan was written) and **throws on any other**: a future
 * schema using `format` or `oneOf` must break the fuzzer loudly, not be fuzzed
 * as if the keyword were not there.
 */

const VALIDATION_KEYWORDS = new Set([
  'type',
  'enum',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'pattern',
  'required',
  'properties',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'minProperties',
  'default',
]);
/** Annotations: they describe, they never constrain. */
const ANNOTATIONS = new Set(['description', 'title']);

export class UnsupportedSchemaError extends Error {}

export function assertSupported(schema: JsonSchema, at = '#'): void {
  for (const [key, value] of Object.entries(schema)) {
    if (ANNOTATIONS.has(key)) continue;
    if (!VALIDATION_KEYWORDS.has(key)) {
      throw new UnsupportedSchemaError(`the fuzzer does not know the keyword "${key}" (at ${at})`);
    }
    if (key === 'properties') {
      for (const [name, inner] of Object.entries(value as Record<string, JsonSchema>)) {
        assertSupported(inner, `${at}/properties/${name}`);
      }
    }
    if (key === 'items') assertSupported(value as JsonSchema, `${at}/items`);
    if (key === 'additionalProperties' && typeof value === 'object') {
      assertSupported(value as JsonSchema, `${at}/additionalProperties`);
    }
  }
}

/** Where a string will travel: a JSON body carries anything; a URL cannot carry a lone surrogate. */
export type Channel = 'json' | 'url';

/**
 * One code point per unit, so fast-check's lengths are the code-point lengths
 * ajv checks (but for two lone surrogates meeting: see stringArbitrary). Weighted towards the cases where fast-json-stringify's escaping
 * could part ways with JSON.stringify — PLAN-32's guard then catches it.
 */
function units(channel: Channel): fc.Arbitrary<string> {
  const awkward = [
    '\u0000', // NUL
    ' ', // line separator
    ' ', // paragraph separator
    '‏', // right-to-left mark
    '‮', // right-to-left override
    '"',
    '\\',
    '/',
    '\n',
    '\t',
    'é',
    '😀', // astral
    '𐍈', // astral
    ...(channel === 'json' ? ['\ud800', '\udfff'] : []), // lone surrogates
  ];
  return fc.oneof(
    { weight: 6, arbitrary: fc.constantFrom('a', 'b', 'z', '0', '9', '-', ' ', 'X') },
    { weight: 3, arbitrary: fc.constantFrom(...awkward) },
    {
      weight: 2,
      arbitrary: fc
        .string({ unit: channel === 'json' ? 'binary' : 'grapheme', minLength: 1, maxLength: 1 })
        .filter((s) => [...s].length === 1),
    },
  );
}

const GENERATED_MAX_LENGTH = 48;
const BIG = 1_000_000;

function lengthOf(value: string): number {
  return [...value].length;
}

/** A UTF-16 surrogate with no partner: JSON can carry one, a URL cannot. */
export function hasLoneSurrogate(value: string): boolean {
  return /[\ud800-\udfff]/.test(value.replace(/[\ud800-\udbff][\udc00-\udfff]/g, ''));
}

function stringArbitrary(schema: JsonSchema, channel: Channel): fc.Arbitrary<string> {
  const min = (schema.minLength as number | undefined) ?? 0;
  const max = (schema.maxLength as number | undefined) ?? Math.max(min, GENERATED_MAX_LENGTH);
  if (typeof schema.pattern === 'string') {
    const regex = new RegExp(schema.pattern, 'u');
    return fc
      .stringMatching(regex)
      .filter((value) => lengthOf(value) >= min && lengthOf(value) <= max)
      .filter((value) => channel === 'json' || !hasLoneSurrogate(value));
  }
  const generatedMax = Math.min(max, Math.max(min, GENERATED_MAX_LENGTH));
  const any = fc.string({ unit: units(channel), minLength: min, maxLength: generatedMax });
  const edges: fc.Arbitrary<string>[] = [
    fc.string({ unit: units(channel), minLength: min, maxLength: min }),
  ];
  if (max <= GENERATED_MAX_LENGTH * 4) {
    edges.push(fc.string({ unit: units(channel), minLength: max, maxLength: max }));
  }
  // Each unit is one code point, except that a lone high surrogate followed by
  // a lone low one fuses into a single astral character, one short of the
  // length fast-check counted. Measure as ajv does, in code points.
  return fc
    .oneof({ weight: 4, arbitrary: any }, ...edges.map((arbitrary) => ({ weight: 1, arbitrary })))
    .filter((value) => lengthOf(value) >= min && lengthOf(value) <= max);
}

function numberArbitrary(schema: JsonSchema, integer: boolean): fc.Arbitrary<number> {
  const min = (schema.minimum as number | undefined) ?? -BIG;
  const max = (schema.maximum as number | undefined) ?? BIG;
  if (integer) {
    return fc.oneof(fc.integer({ min, max }), fc.constantFrom(min, max));
  }
  return fc.oneof(
    fc
      .double({ min, max, noNaN: true, noDefaultInfinity: true })
      .map((n) => (Object.is(n, -0) ? 0 : n)),
    fc.constantFrom(min, max),
  );
}

function typesOf(schema: JsonSchema): string[] {
  if (Array.isArray(schema.type)) return schema.type as string[];
  if (typeof schema.type === 'string') return [schema.type];
  if (Array.isArray(schema.enum)) return [];
  throw new UnsupportedSchemaError(
    `a schema with neither type nor enum: ${JSON.stringify(schema)}`,
  );
}

/** Values the schema accepts, read literally (no coercion). */
export function valid(schema: JsonSchema, channel: Channel = 'json'): fc.Arbitrary<unknown> {
  assertSupported(schema);
  if (Array.isArray(schema.enum)) return fc.constantFrom(...(schema.enum as unknown[]));
  const options = typesOf(schema).map((type): fc.Arbitrary<unknown> => {
    switch (type) {
      case 'string':
        return stringArbitrary(schema, channel);
      case 'integer':
        return numberArbitrary(schema, true);
      case 'number':
        return numberArbitrary(schema, false);
      case 'boolean':
        return fc.boolean();
      case 'null':
        return fc.constant(null);
      case 'array': {
        const items = schema.items as JsonSchema | undefined;
        if (!items) throw new UnsupportedSchemaError('an array schema without items');
        const minLength = (schema.minItems as number | undefined) ?? 0;
        const maxLength = Math.min(
          (schema.maxItems as number | undefined) ?? 4,
          Math.max(minLength, 4),
        );
        return fc.array(valid(items, channel), { minLength, maxLength });
      }
      case 'object': {
        const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
        const required = (schema.required ?? []) as string[];
        const minProperties = (schema.minProperties as number | undefined) ?? 0;
        const record = fc.record(
          Object.fromEntries(
            Object.entries(properties).map(([name, inner]) => [name, valid(inner, channel)]),
          ),
          { requiredKeys: required.filter((name) => name in properties) },
        );
        return record.filter((value) => Object.keys(value).length >= minProperties);
      }
      default:
        throw new UnsupportedSchemaError(`the fuzzer does not know the type "${type}"`);
    }
  });
  return options.length === 1 ? (options[0] as fc.Arbitrary<unknown>) : fc.oneof(...options);
}

/** One way to make a valid value invalid. `apply` returns a changed copy. */
export interface Mutation {
  label: string;
  apply(root: unknown): unknown;
}

function setAt(root: unknown, path: (string | number)[], value: unknown, remove = false): unknown {
  if (path.length === 0) return value;
  const copy = Array.isArray(root) ? [...root] : { ...(root as Record<string, unknown>) };
  const [head, ...rest] = path as [string | number, ...(string | number)[]];
  if (rest.length === 0) {
    if (remove) delete (copy as Record<string | number, unknown>)[head];
    else (copy as Record<string | number, unknown>)[head] = value;
    return copy;
  }
  (copy as Record<string | number, unknown>)[head] = setAt(
    (root as Record<string | number, unknown>)[head],
    rest,
    value,
    remove,
  );
  return copy;
}

/** A value of a different JSON type than every type the schema allows. */
function wrongType(schema: JsonSchema): unknown {
  const allowed = new Set(Array.isArray(schema.enum) ? [] : typesOf(schema));
  if (!allowed.has('object')) return { not: 'this' };
  if (!allowed.has('array')) return [1, 2];
  return 'not-this';
}

/**
 * Every single mutation of `value` that the schema, read literally, refuses:
 * a dropped required field, a wrong type, one past a bound, a value outside
 * an enum, an unknown property under `additionalProperties: false`, a string
 * failing its pattern — at any depth the value reaches.
 */
export function mutations(
  schema: JsonSchema,
  value: unknown,
  path: (string | number)[] = [],
): Mutation[] {
  const at = path.length ? `/${path.join('/')}` : '/';
  const out: Mutation[] = [
    { label: `wrong type at ${at}`, apply: (root) => setAt(root, path, wrongType(schema)) },
  ];
  if (Array.isArray(schema.enum)) {
    out.push({
      label: `outside the enum at ${at}`,
      apply: (root) => setAt(root, path, '__not_in_enum__'),
    });
  }
  if (typeof value === 'string') {
    if (typeof schema.maxLength === 'number') {
      const longer = 'x'.repeat(schema.maxLength + 1);
      out.push({
        label: `one past maxLength at ${at}`,
        apply: (root) => setAt(root, path, longer),
      });
    }
    if (typeof schema.minLength === 'number' && schema.minLength > 0) {
      const shorter = 'x'.repeat(schema.minLength - 1);
      out.push({
        label: `one under minLength at ${at}`,
        apply: (root) => setAt(root, path, shorter),
      });
    }
    if (typeof schema.pattern === 'string') {
      const regex = new RegExp(schema.pattern, 'u');
      const failing = ['../escape', '/', '', '.hidden', '!!', '\\'].find(
        (candidate) => !regex.test(candidate),
      );
      if (failing !== undefined) {
        out.push({
          label: `failing the pattern at ${at}`,
          apply: (root) => setAt(root, path, failing),
        });
      }
    }
  }
  if (typeof value === 'number') {
    if (typeof schema.maximum === 'number') {
      const above = schema.maximum + 1;
      out.push({ label: `one past maximum at ${at}`, apply: (root) => setAt(root, path, above) });
    }
    if (typeof schema.minimum === 'number') {
      const below = schema.minimum - 1;
      out.push({ label: `one under minimum at ${at}`, apply: (root) => setAt(root, path, below) });
    }
  }
  if (Array.isArray(value)) {
    const items = schema.items as JsonSchema | undefined;
    if (typeof schema.maxItems === 'number' && value.length > 0) {
      const more = Array.from({ length: schema.maxItems + 1 }, () => value[0]);
      out.push({ label: `one past maxItems at ${at}`, apply: (root) => setAt(root, path, more) });
    }
    if (typeof schema.minItems === 'number' && schema.minItems > 0) {
      const fewer = value.slice(0, schema.minItems - 1);
      out.push({ label: `one under minItems at ${at}`, apply: (root) => setAt(root, path, fewer) });
    }
    if (items && value.length > 0) out.push(...mutations(items, value[0], [...path, 0]));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
    for (const name of (schema.required ?? []) as string[]) {
      out.push({
        label: `dropped required ${at}${name}`,
        apply: (root) => setAt(root, [...path, name], undefined, true),
      });
    }
    if (schema.additionalProperties === false) {
      out.push({
        label: `an unknown property at ${at}`,
        apply: (root) => setAt(root, [...path, '__unknown__'], 1),
      });
    }
    if (typeof schema.minProperties === 'number' && schema.minProperties > 0) {
      out.push({
        label: `fewer than minProperties at ${at}`,
        apply: (root) => setAt(root, path, {}),
      });
    }
    for (const [name, inner] of Object.entries(value as Record<string, unknown>)) {
      const innerSchema = properties[name];
      if (innerSchema) out.push(...mutations(innerSchema, inner, [...path, name]));
    }
  }
  return out;
}
