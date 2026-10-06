import { describe, expect, it } from 'vitest';
import { uncovered } from './records.js';
import { Spec } from './spec.js';

const spec = new Spec({
  paths: {
    '/api/a': { get: { operationId: 'getA', responses: { 200: {} } } },
    '/api/b/{id}': { delete: { operationId: 'deleteB', responses: { 204: {} } } },
  },
});

describe('the coverage report', () => {
  it('lists every operation no suite saw succeed', () => {
    expect(
      uncovered(spec, [
        { suite: 'contract', covered: ['getA'] },
        { suite: 'fuzz', covered: [] },
      ]),
    ).toEqual(['deleteB (DELETE /api/b/{id})']);
  });

  it('is empty when the suites together covered everything', () => {
    expect(
      uncovered(spec, [
        { suite: 'contract', covered: ['getA'] },
        { suite: 'fuzz', covered: ['deleteB'] },
      ]),
    ).toEqual([]);
  });

  it('does not judge a run without both the contract journeys and the fuzzer', () => {
    expect(uncovered(spec, [{ suite: 'contract', covered: [] }])).toBeNull();
  });
});
