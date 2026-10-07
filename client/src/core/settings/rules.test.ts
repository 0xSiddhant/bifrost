import { describe, expect, it } from 'vitest';
import shared from './rules.cases.json';
import { ruleFor, sanitize } from './rules';

/**
 * The client half of PLAN-35's shared settings rules. The server runs the same
 * table through its Heimdall overlay (`server/src/core/config/settings-rules.test.ts`),
 * so a rule changed on one side only fails one of the two suites.
 */
describe('shared settings rules (PLAN-35): the browser store', () => {
  it('has a case table to run', () => {
    expect(shared.cases.length).toBeGreaterThan(20);
  });

  for (const { key, value, accepted } of shared.cases) {
    it(`${accepted ? 'accepts' : 'refuses'} ${key} = ${JSON.stringify(value)}`, () => {
      const rule = ruleFor(key);
      expect(rule, `no client rule for ${key}`).toBeDefined();
      expect(rule?.(value)).toBe(accepted ? value : undefined);
    });
  }
});

describe('sanitize', () => {
  const defaults = { idleSeconds: 120, density: 'medium', idleMin: 5 };

  it('keeps valid fields and takes the default for each invalid one alone', () => {
    expect(sanitize('screensaver', { idleSeconds: 4, density: 'high' }, defaults)).toEqual({
      idleSeconds: 120,
      density: 'high',
      idleMin: 5,
    });
  });

  it('never lets a stored value overwrite a field with no rule (the bounds)', () => {
    expect(sanitize('screensaver', { idleMin: 1 }, defaults).idleMin).toBe(5);
  });

  it('takes every default for nothing, or something that is not an object', () => {
    expect(sanitize('screensaver', null, defaults)).toEqual(defaults);
    expect(sanitize('screensaver', 'nope', defaults)).toEqual(defaults);
  });

  it('accepts only shortcut strings the gesture can match', () => {
    const rule = ruleFor('heimdall.shortcut');
    expect(rule?.('shift+meta+comma')).toBe('shift+meta+comma');
    expect(rule?.('')).toBeUndefined();
    expect(rule?.('<script>')).toBeUndefined();
    expect(rule?.(42)).toBeUndefined();
  });
});
