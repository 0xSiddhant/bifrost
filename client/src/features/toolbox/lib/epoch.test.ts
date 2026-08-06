import { describe, expect, it } from 'vitest';
import {
  epochView,
  formatIso,
  formatZoned,
  parseEpoch,
  parseHumanDate,
  relativeTime,
  toDatetimeLocalValue,
} from './epoch';

describe('parseEpoch', () => {
  it('reads 10-digit input as seconds and 13-digit as milliseconds', () => {
    expect(parseEpoch('1754478420')).toEqual({ ms: 1754478420000, unit: 's' });
    expect(parseEpoch('1754478420000')).toEqual({ ms: 1754478420000, unit: 'ms' });
  });

  it('lets the unit toggle override the guess', () => {
    expect(parseEpoch('1754478420', 'ms')).toEqual({ ms: 1754478420, unit: 'ms' });
    expect(parseEpoch('1000', 's')).toEqual({ ms: 1_000_000, unit: 's' });
  });

  it('handles pre-1970 negatives', () => {
    expect(parseEpoch('-1')).toEqual({ ms: -1000, unit: 's' });
    expect(formatIso(parseEpoch('-86400')?.ms as number)).toBe('1969-12-31T00:00:00.000Z');
    expect(parseEpoch('-1000000000000')).toEqual({ ms: -1000000000000, unit: 'ms' });
  });

  it('tolerates the separators people paste', () => {
    expect(parseEpoch(' 1 754 478 420 ')?.ms).toBe(1754478420000);
    expect(parseEpoch('1_754_478_420')?.ms).toBe(1754478420000);
  });

  it('rejects anything that is not a whole number', () => {
    expect(parseEpoch('')).toBeNull();
    expect(parseEpoch('now')).toBeNull();
    expect(parseEpoch('12.5')).toBeNull();
    expect(parseEpoch('0x1f')).toBeNull();
  });

  it('rejects a value outside the Date range instead of formatting Invalid Date', () => {
    expect(parseEpoch('99999999999999999')).toBeNull();
  });

  it('reads zero as the epoch itself', () => {
    expect(parseEpoch('0')).toEqual({ ms: 0, unit: 's' });
    expect(formatIso(0)).toBe('1970-01-01T00:00:00.000Z');
  });
});

describe('parseHumanDate', () => {
  it('accepts ISO-8601 with a zone', () => {
    expect(parseHumanDate('2026-08-06T11:07:00.000Z')).toBe(Date.UTC(2026, 7, 6, 11, 7, 0));
  });

  it('reads a bare date as UTC midnight', () => {
    expect(parseHumanDate('2026-08-06')).toBe(Date.UTC(2026, 7, 6));
  });

  it('reads a datetime-local value as local wall-clock time', () => {
    const ms = parseHumanDate('2026-08-06T11:07') as number;
    expect(new Date(ms).getHours()).toBe(11);
    expect(new Date(ms).getMinutes()).toBe(7);
  });

  it('returns null for junk', () => {
    expect(parseHumanDate('sometime tuesday')).toBeNull();
    expect(parseHumanDate('')).toBeNull();
  });
});

describe('formatZoned across a DST boundary', () => {
  // 2026-03-08 in America/New_York: 06:59Z is 01:59 EST, 07:00Z is 03:00 EDT.
  const beforeDst = Date.UTC(2026, 2, 8, 6, 59);
  const afterDst = Date.UTC(2026, 2, 8, 7, 0);

  it('shows the offset shifting by an hour across the jump', () => {
    // en-GB renders American zones as an offset ("GMT-5"), not "EST" — which is
    // the unambiguous form anyway, and the one every locale gets.
    expect(formatZoned(beforeDst, 'America/New_York')).toContain('GMT-5');
    expect(formatZoned(afterDst, 'America/New_York')).toContain('GMT-4');
  });

  it('skips the hour that does not exist locally', () => {
    expect(formatZoned(beforeDst, 'America/New_York')).toContain('01:59');
    expect(formatZoned(afterDst, 'America/New_York')).toContain('03:00');
  });

  it('is unaffected in UTC, which has no DST', () => {
    expect(formatZoned(beforeDst, 'UTC')).toContain('06:59');
    expect(formatZoned(afterDst, 'UTC')).toContain('07:00');
  });
});

describe('relativeTime', () => {
  const now = Date.UTC(2026, 7, 6, 12, 0, 0);

  it('names the largest unit that fits, in both directions', () => {
    expect(relativeTime(now - 3 * 60 * 1000, now)).toBe('3 minutes ago');
    expect(relativeTime(now + 2 * 86400_000, now)).toBe('in 2 days');
    expect(relativeTime(now - 400 * 86400_000, now)).toBe('last year');
    expect(relativeTime(now + 5 * 3600_000, now)).toBe('in 5 hours');
  });

  it('collapses sub-second differences', () => {
    expect(relativeTime(now, now)).toBe('just now');
    expect(relativeTime(now - 400, now)).toBe('just now');
  });
});

describe('epochView', () => {
  it('gives every representation of one instant', () => {
    const now = Date.UTC(2026, 7, 6, 12, 0, 0);
    const view = epochView(Date.UTC(2026, 7, 6, 11, 0, 0), now);
    expect(view.seconds).toBe(Date.UTC(2026, 7, 6, 11, 0, 0) / 1000);
    expect(view.milliseconds).toBe(Date.UTC(2026, 7, 6, 11, 0, 0));
    expect(view.iso).toBe('2026-08-06T11:00:00.000Z');
    expect(view.utc).toContain('UTC');
    expect(view.relative).toBe('1 hour ago');
  });

  it('floors seconds towards the past for negative instants', () => {
    // -1500ms is 1969-12-31T23:59:58.5Z — the containing second is -2, not -1.
    expect(epochView(-1500).seconds).toBe(-2);
  });
});

describe('toDatetimeLocalValue', () => {
  it('renders local wall-clock parts the control can consume', () => {
    const ms = new Date(2026, 7, 6, 11, 7).getTime();
    expect(toDatetimeLocalValue(ms)).toBe('2026-08-06T11:07');
  });

  it('zero-pads every field', () => {
    const ms = new Date(2026, 0, 2, 3, 4).getTime();
    expect(toDatetimeLocalValue(ms)).toBe('2026-01-02T03:04');
  });
});
