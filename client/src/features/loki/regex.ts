/**
 * Pure regex-tester compute for Loki's Regex mode (PLAN-12). Builds the RegExp
 * (reporting an invalid pattern/flags instead of throwing) and collects matches
 * with their capture groups, guarding against zero-length-match infinite loops.
 */

export interface RegexMatch {
  index: number;
  end: number;
  text: string;
  groups: (string | undefined)[];
  named: Record<string, string | undefined>;
}

export interface RegexOutcome {
  error: string | null;
  matches: RegexMatch[];
  /** True when the pattern is empty (no evaluation attempted). */
  empty: boolean;
}

const MAX_MATCHES = 500;

export function runRegex(pattern: string, flags: string, subject: string): RegexOutcome {
  if (pattern === '') return { error: null, matches: [], empty: true };

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags);
  } catch (error) {
    return { error: (error as Error).message, matches: [], empty: false };
  }

  const matches: RegexMatch[] = [];
  const global = flags.includes('g');

  if (!global) {
    const m = regex.exec(subject);
    if (m) {
      matches.push({
        index: m.index,
        end: m.index + m[0].length,
        text: m[0],
        groups: m.slice(1),
        named: { ...m.groups },
      });
    }
    return { error: null, matches, empty: false };
  }

  let guard = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(subject)) !== null) {
    matches.push({
      index: m.index,
      end: m.index + m[0].length,
      text: m[0],
      groups: m.slice(1),
      named: { ...m.groups },
    });
    // Zero-length match: advance lastIndex so we don't spin forever.
    if (m.index === regex.lastIndex) regex.lastIndex += 1;
    guard += 1;
    if (guard >= MAX_MATCHES) break;
  }
  return { error: null, matches, empty: false };
}
