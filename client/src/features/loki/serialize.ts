/**
 * The load-bearing part of Calcifer (PLAN-12 Part B): turn any runtime value
 * into a display string the worker can postMessage. structuredClone throws on
 * functions and silently loses `undefined`, so nothing crosses the channel raw
 * — everything is inspected here first. Cycle-safe and depth-limited.
 */

const MAX_DEPTH = 5;
const MAX_ITEMS = 100;

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function quoteKey(key: string): string {
  return IDENTIFIER.test(key) ? key : JSON.stringify(key);
}

/** Inspect a value into a display string (nested strings are quoted). */
export function inspect(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'number':
      return Object.is(value, -0) ? '-0' : String(value);
    case 'boolean':
      return String(value);
    case 'bigint':
      return `${value}n`;
    case 'symbol':
      return value.toString();
    case 'function': {
      const name = (value as { name?: string }).name;
      const kind = value.toString().startsWith('class') ? 'class' : 'ƒ';
      return `${kind} ${name || '(anonymous)'}()`;
    }
  }

  // Objects from here down.
  const obj = value as object;
  if (seen.has(obj)) return '[Circular]';

  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  }
  if (value instanceof RegExp) {
    return value.toString();
  }

  if (depth >= MAX_DEPTH) {
    if (Array.isArray(value)) return '[Array]';
    if (value instanceof Map) return '[Map]';
    if (value instanceof Set) return '[Set]';
    return '[Object]';
  }

  seen.add(obj);
  try {
    if (Array.isArray(value)) {
      if (value.length === 0) return '[]';
      const shown = value.slice(0, MAX_ITEMS).map((item) => inspect(item, depth + 1, seen));
      if (value.length > MAX_ITEMS) shown.push(`… ${value.length - MAX_ITEMS} more`);
      return `[ ${shown.join(', ')} ]`;
    }
    if (value instanceof Map) {
      const entries = [...value.entries()].slice(0, MAX_ITEMS);
      const shown = entries.map(([k, v]) => `${inspect(k, depth + 1, seen)} => ${inspect(v, depth + 1, seen)}`);
      if (value.size > MAX_ITEMS) shown.push(`… ${value.size - MAX_ITEMS} more`);
      return `Map(${value.size}) { ${shown.join(', ')} }`;
    }
    if (value instanceof Set) {
      const items = [...value.values()].slice(0, MAX_ITEMS);
      const shown = items.map((v) => inspect(v, depth + 1, seen));
      if (value.size > MAX_ITEMS) shown.push(`… ${value.size - MAX_ITEMS} more`);
      return `Set(${value.size}) { ${shown.join(', ')} }`;
    }

    const entries = Object.entries(value as Record<string, unknown>);
    const ctor = (value as { constructor?: { name?: string } }).constructor;
    const prefix = ctor && ctor.name && ctor.name !== 'Object' ? `${ctor.name} ` : '';
    if (entries.length === 0) return `${prefix}{}`;
    const shown = entries
      .slice(0, MAX_ITEMS)
      .map(([k, v]) => `${quoteKey(k)}: ${inspect(v, depth + 1, seen)}`);
    if (entries.length > MAX_ITEMS) shown.push(`… ${entries.length - MAX_ITEMS} more`);
    return `${prefix}{ ${shown.join(', ')} }`;
  } finally {
    seen.delete(obj);
  }
}

/**
 * Format console arguments the way a devtools console would: a top-level string
 * prints raw (not quoted), everything else is inspected. Joined by spaces.
 */
export function formatConsoleArgs(args: unknown[]): string {
  return args
    .map((arg) => (typeof arg === 'string' ? arg : inspect(arg)))
    .join(' ');
}
