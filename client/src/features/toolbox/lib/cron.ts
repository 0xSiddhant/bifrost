/**
 * Five-field cron: explain it in words, and say when it next fires (PLAN-18).
 *
 * Everything is computed in the viewer's own timezone, because that is the
 * question being asked ("when will this actually run for me?") and a UTC answer
 * would be wrong by an offset nobody wants to do in their head.
 */

export interface CronField {
  label: string;
  /** Every matching value, ascending. */
  values: number[];
  /** True when the field is `*` — needed for cron's dom/dow OR rule. */
  wildcard: boolean;
}

export interface CronExpression {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

export interface CronParseResult {
  expression: CronExpression | null;
  error: string | null;
}

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const SHORTHAND: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

interface FieldSpec {
  label: string;
  min: number;
  max: number;
  names?: string[];
}

const SPECS: FieldSpec[] = [
  { label: 'minute', min: 0, max: 59 },
  { label: 'hour', min: 0, max: 23 },
  { label: 'day of month', min: 1, max: 31 },
  { label: 'month', min: 1, max: 12, names: MONTH_NAMES },
  { label: 'day of week', min: 0, max: 6, names: DAY_NAMES },
];

function parseValue(token: string, spec: FieldSpec): number | null {
  const named = spec.names?.indexOf(token.toLowerCase());
  if (named !== undefined && named >= 0) return named + (spec.min === 1 ? 1 : 0);
  if (!/^\d+$/.test(token)) return null;
  const value = Number(token);
  // Cron accepts 7 for Sunday as well as 0; normalise so both fire.
  if (spec.label === 'day of week' && value === 7) return 0;
  if (value < spec.min || value > spec.max) return null;
  return value;
}

function parseField(raw: string, spec: FieldSpec): CronField | null {
  const values = new Set<number>();
  const wildcard = raw === '*' || /^\*\/\d+$/.test(raw);

  for (const part of raw.split(',')) {
    const [rangePart, stepPart] = part.split('/');
    if (rangePart === undefined) return null;
    let step = 1;
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart) || Number(stepPart) === 0) return null;
      step = Number(stepPart);
    }

    let start: number;
    let end: number;
    if (rangePart === '*') {
      start = spec.min;
      end = spec.max;
    } else if (rangePart.includes('-')) {
      const [from, to] = rangePart.split('-');
      const a = parseValue(from ?? '', spec);
      const b = parseValue(to ?? '', spec);
      if (a === null || b === null || a > b) return null;
      start = a;
      end = b;
    } else {
      const single = parseValue(rangePart, spec);
      if (single === null) return null;
      start = single;
      // `5/15` means "from 5, every 15" — a bare value with no step is itself.
      end = stepPart === undefined ? single : spec.max;
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }

  if (values.size === 0) return null;
  return { label: spec.label, values: [...values].sort((a, b) => a - b), wildcard };
}

export function parseCron(input: string): CronParseResult {
  const text = input.trim().toLowerCase();
  if (!text) return { expression: null, error: null };
  const normalized = SHORTHAND[text] ?? text;
  const parts = normalized.split(/\s+/);
  if (parts.length !== 5) {
    return {
      expression: null,
      error: `A cron expression has five fields (minute hour day-of-month month day-of-week) — this has ${parts.length}.`,
    };
  }
  const fields: CronField[] = [];
  for (let i = 0; i < 5; i += 1) {
    const spec = SPECS[i];
    if (!spec) return { expression: null, error: 'Malformed expression.' };
    const field = parseField(parts[i] ?? '', spec);
    if (!field) {
      return { expression: null, error: `"${parts[i]}" is not a valid ${spec.label} (${spec.min}–${spec.max}).` };
    }
    fields.push(field);
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields as [
    CronField,
    CronField,
    CronField,
    CronField,
    CronField,
  ];
  return { expression: { minute, hour, dayOfMonth, month, dayOfWeek }, error: null };
}

function listOf(values: number[], labels?: string[], offset = 0): string {
  const named = values.map((value) => labels?.[value - offset] ?? String(value));
  if (named.length === 1) return named[0] ?? '';
  return `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
}

function two(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Plain English. Deliberately describes the *dom/dow OR rule* out loud when it
 * applies: `0 0 13 * 5` fires on the 13th **and** every Friday, not only on
 * Friday the 13th, which is the single most misread thing about cron.
 */
export function explainCron(expression: CronExpression): string {
  const { minute, hour, dayOfMonth, month, dayOfWeek } = expression;

  let time: string;
  if (minute.wildcard && hour.wildcard) {
    time = 'Every minute';
  } else if (minute.wildcard) {
    time = `Every minute of ${hour.values.length === 1 ? '' : 'hours '}${listOf(hour.values)}:00`;
  } else if (hour.wildcard) {
    time =
      minute.values.length === 1
        ? `At ${listOf(minute.values)} minutes past every hour`
        : `At minutes ${listOf(minute.values)} past every hour`;
  } else {
    const stamps: string[] = [];
    for (const h of hour.values) for (const m of minute.values) stamps.push(`${two(h)}:${two(m)}`);
    time = stamps.length <= 6 ? `At ${listOf2(stamps)}` : `At ${stamps.length} times a day`;
  }

  const parts = [time];
  const dayClauses: string[] = [];
  if (!dayOfMonth.wildcard) dayClauses.push(`on day ${listOf(dayOfMonth.values)} of the month`);
  if (!dayOfWeek.wildcard) dayClauses.push(`on ${listOf(dayOfWeek.values, DAY_LABELS)}`);
  if (dayClauses.length === 2) {
    // Vixie cron: when both day fields are restricted they are OR'd.
    parts.push(`${dayClauses[0]} **or** ${dayClauses[1]} (cron treats the two day fields as OR)`);
  } else if (dayClauses.length === 1) {
    parts.push(dayClauses[0] ?? '');
  } else {
    parts.push('every day');
  }
  if (!month.wildcard) parts.push(`in ${listOf(month.values, MONTH_LABELS, 1)}`);

  return parts.join(', ') + '.';
}

function listOf2(values: string[]): string {
  if (values.length === 1) return values[0] ?? '';
  return `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;
}

function matchesDay(expression: CronExpression, date: Date): boolean {
  const dom = expression.dayOfMonth;
  const dow = expression.dayOfWeek;
  const domMatch = dom.values.includes(date.getDate());
  const dowMatch = dow.values.includes(date.getDay());
  // Both restricted → OR. Otherwise the restricted one decides.
  if (!dom.wildcard && !dow.wildcard) return domMatch || dowMatch;
  if (!dom.wildcard) return domMatch;
  if (!dow.wildcard) return dowMatch;
  return true;
}

/**
 * The next `count` fire times, in local time.
 *
 * Steps by field rather than by minute: a wrong month jumps to the 1st of the
 * next month, a wrong day to the next midnight, a wrong hour to the next hour.
 * `0 0 29 2 *` (29 February) would otherwise mean walking two million minutes
 * one at a time before the first answer appeared.
 */
export function nextFireTimes(expression: CronExpression, from: Date, count = 5): Date[] {
  const results: Date[] = [];
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  // Cron itself gives up after ~4 years for an unsatisfiable date (Feb 30).
  const limit = new Date(from.getTime());
  limit.setFullYear(limit.getFullYear() + 5);

  while (results.length < count && cursor.getTime() < limit.getTime()) {
    if (!expression.month.values.includes(cursor.getMonth() + 1)) {
      cursor.setMonth(cursor.getMonth() + 1, 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    if (!matchesDay(expression, cursor)) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    if (!expression.hour.values.includes(cursor.getHours())) {
      cursor.setHours(cursor.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!expression.minute.values.includes(cursor.getMinutes())) {
      cursor.setMinutes(cursor.getMinutes() + 1, 0, 0);
      continue;
    }
    results.push(new Date(cursor.getTime()));
    cursor.setMinutes(cursor.getMinutes() + 1, 0, 0);
  }
  return results;
}
