import { describe, expect, it } from 'vitest';
import { explainCron, nextFireTimes, parseCron } from './cron';

const parse = (expression: string) => {
  const { expression: parsed, error } = parseCron(expression);
  if (!parsed) throw new Error(error ?? `failed to parse ${expression}`);
  return parsed;
};

describe('parseCron fields', () => {
  it('reads wildcards, values, lists, ranges and steps', () => {
    expect(parse('5 * * * *').minute.values).toEqual([5]);
    expect(parse('0,30 * * * *').minute.values).toEqual([0, 30]);
    expect(parse('10-13 * * * *').minute.values).toEqual([10, 11, 12, 13]);
    expect(parse('*/15 * * * *').minute.values).toEqual([0, 15, 30, 45]);
    expect(parse('0-20/10 * * * *').minute.values).toEqual([0, 10, 20]);
    expect(parse('* * * * *').hour.values).toHaveLength(24);
  });

  it('reads a bare value with a step as "from here, every n"', () => {
    expect(parse('5/15 * * * *').minute.values).toEqual([5, 20, 35, 50]);
  });

  it('accepts month and day names', () => {
    expect(parse('0 0 * JAN *').month.values).toEqual([1]);
    expect(parse('0 0 * dec *').month.values).toEqual([12]);
    expect(parse('0 0 * * mon').dayOfWeek.values).toEqual([1]);
    expect(parse('0 0 * * sun').dayOfWeek.values).toEqual([0]);
  });

  it('treats day-of-week 7 as Sunday, like every real cron', () => {
    expect(parse('0 0 * * 7').dayOfWeek.values).toEqual([0]);
  });

  it('expands the @shorthands', () => {
    expect(parse('@daily').hour.values).toEqual([0]);
    expect(parse('@hourly').minute.values).toEqual([0]);
    expect(parse('@weekly').dayOfWeek.values).toEqual([0]);
    expect(parse('@yearly').month.values).toEqual([1]);
  });

  it('tracks which fields are wildcards — the dom/dow rule needs it', () => {
    const expression = parse('0 0 13 * 5');
    expect(expression.dayOfMonth.wildcard).toBe(false);
    expect(expression.dayOfWeek.wildcard).toBe(false);
    expect(expression.month.wildcard).toBe(true);
    // `*/n` is still a wildcard field for the OR rule's purposes.
    expect(parse('*/5 * * * *').minute.wildcard).toBe(true);
  });

  it('rejects out-of-range and malformed fields with a reason', () => {
    expect(parseCron('60 * * * *').error).toMatch(/minute/);
    expect(parseCron('* 24 * * *').error).toMatch(/hour/);
    expect(parseCron('* * 32 * *').error).toMatch(/day of month/);
    expect(parseCron('* * * 13 *').error).toMatch(/month/);
    expect(parseCron('* * * * 8').error).toMatch(/day of week/);
    expect(parseCron('* * * *').error).toMatch(/five fields/);
    expect(parseCron('20-10 * * * *').error).toMatch(/minute/);
    expect(parseCron('*/0 * * * *').error).toMatch(/minute/);
  });

  it('treats empty input as nothing to say, not as an error', () => {
    expect(parseCron('  ')).toEqual({ expression: null, error: null });
  });
});

describe('explainCron', () => {
  it('describes the common expressions in words', () => {
    expect(explainCron(parse('* * * * *'))).toMatch(/Every minute/);
    expect(explainCron(parse('0 9 * * *'))).toMatch(/09:00/);
    expect(explainCron(parse('30 2 * * 1'))).toMatch(/Monday/);
    expect(explainCron(parse('0 0 1 1 *'))).toMatch(/January/);
  });

  it('says out loud that the two day fields are OR, not AND', () => {
    const text = explainCron(parse('0 0 13 * 5'));
    expect(text).toMatch(/OR/);
    expect(text).toMatch(/day 13/);
    expect(text).toMatch(/Friday/);
  });

  it('does not claim an OR when only one day field is restricted', () => {
    expect(explainCron(parse('0 0 13 * *'))).not.toMatch(/OR/);
    expect(explainCron(parse('0 0 * * 5'))).not.toMatch(/OR/);
  });
});

describe('nextFireTimes', () => {
  const from = new Date(2026, 7, 6, 12, 30, 15); // local Thu 6 Aug 2026

  it('lists the next runs in local time, starting after "now"', () => {
    const times = nextFireTimes(parse('0 * * * *'), from, 3);
    expect(times).toHaveLength(3);
    expect(times.map((d) => `${d.getHours()}:${d.getMinutes()}`)).toEqual(['13:0', '14:0', '15:0']);
    expect(times[0]?.getTime()).toBeGreaterThan(from.getTime());
  });

  it('rolls into tomorrow when today has no slot left', () => {
    const [next] = nextFireTimes(parse('0 9 * * *'), from, 1);
    expect(next?.getDate()).toBe(7);
    expect(next?.getHours()).toBe(9);
  });

  it('finds the next matching weekday', () => {
    // 6 Aug 2026 is a Thursday; the next Monday is the 10th.
    const [next] = nextFireTimes(parse('0 0 * * 1'), from, 1);
    expect(next?.getDate()).toBe(10);
    expect(next?.getDay()).toBe(1);
  });

  it('honours the dom/dow OR rule when both are restricted', () => {
    // 13th of the month, or any Friday. The 7th (Friday) comes first.
    const times = nextFireTimes(parse('0 0 13 * 5'), from, 2);
    expect(times[0]?.getDate()).toBe(7);
    expect(times[1]?.getDate()).toBe(13);
  });

  it('jumps months without walking every minute — 29 February', () => {
    const started = Date.now();
    const [next] = nextFireTimes(parse('0 0 29 2 *'), from, 1);
    expect(next?.getMonth()).toBe(1);
    expect(next?.getDate()).toBe(29);
    expect(next?.getFullYear()).toBe(2028); // the next leap year
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('returns nothing for a date that never happens, instead of hanging', () => {
    const started = Date.now();
    expect(nextFireTimes(parse('0 0 30 2 *'), from, 5)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('does not repeat a time when several fields match at once', () => {
    const times = nextFireTimes(parse('0,0 0 * * *'), from, 3);
    const stamps = times.map((d) => d.getTime());
    expect(new Set(stamps).size).toBe(stamps.length);
  });
});
