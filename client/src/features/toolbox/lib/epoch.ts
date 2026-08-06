/**
 * Epoch ⇄ human time (PLAN-18). Everything here is pure and takes `now` as an
 * argument so the conversions can be tested across DST boundaries and before
 * 1970 without waiting for the clock.
 */

export type EpochUnit = 's' | 'ms';

export interface ParsedEpoch {
  ms: number;
  /** Which unit the input was read as — shown back so the guess is visible. */
  unit: EpochUnit;
}

/**
 * Seconds or milliseconds? Decided by magnitude, not by asking: 1e11 seconds is
 * the year 5138 and 1e11 ms is 1973, so anything with 12+ digits is
 * milliseconds in every timeframe a person will type. The guess is displayed,
 * and the unit toggle overrides it.
 */
const MS_THRESHOLD = 1e11;

export function parseEpoch(input: string, forced?: EpochUnit): ParsedEpoch | null {
  const text = input.trim().replace(/[_,\s]/g, '');
  if (!/^-?\d+$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  const unit: EpochUnit = forced ?? (Math.abs(value) >= MS_THRESHOLD ? 'ms' : 's');
  const ms = unit === 's' ? value * 1000 : value;
  // Outside ±8.64e15 the Date is Invalid and every formatter below throws.
  if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return null;
  return { ms, unit };
}

/**
 * A human-typed date back to an instant. Accepts full ISO-8601, the
 * `YYYY-MM-DDTHH:mm` an `<input type="datetime-local">` produces (read as
 * **local** time, which is what the control means), and a bare `YYYY-MM-DD`
 * (read as **UTC** midnight — the same rule the JS spec applies).
 */
export function parseHumanDate(input: string): number | null {
  const text = input.trim();
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : ms;
}

/** Full ISO-8601 with milliseconds, always UTC (`2026-08-06T11:07:00.000Z`). */
export function formatIso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Readable time in a named zone; `undefined` means the viewer's own zone. The
 * zone is part of the output because a timestamp without one is the exact
 * ambiguity this tool exists to remove.
 */
export function formatZoned(ms: number, timeZone?: string): string {
  // Component options rather than dateStyle/timeStyle: the spec forbids
  // combining those with timeZoneName, and the zone name is the point.
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  });
  return formatter.format(new Date(ms));
}

const RELATIVE_STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
  ['second', 1000],
];

/** "3 minutes ago" / "in 2 days" — the answer people actually want first. */
export function relativeTime(ms: number, now: number = Date.now()): string {
  const delta = ms - now;
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, size] of RELATIVE_STEPS) {
    if (Math.abs(delta) >= size) {
      return formatter.format(Math.trunc(delta / size), unit);
    }
  }
  return 'just now';
}

export interface EpochView {
  seconds: number;
  milliseconds: number;
  iso: string;
  utc: string;
  local: string;
  relative: string;
}

/** Every representation of one instant, for the tool's output column. */
export function epochView(ms: number, now: number = Date.now()): EpochView {
  return {
    seconds: Math.floor(ms / 1000),
    milliseconds: ms,
    iso: formatIso(ms),
    utc: formatZoned(ms, 'UTC'),
    local: formatZoned(ms),
    relative: relativeTime(ms, now),
  };
}

/**
 * `2026-08-06T11:07` — the value an `<input type="datetime-local">` wants,
 * built from the *local* wall-clock parts (its own toISOString would silently
 * shift the control by the UTC offset).
 */
export function toDatetimeLocalValue(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
