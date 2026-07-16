/**
 * Single-range `Range: bytes=…` parsing (RFC 9110 §14). Browsers only ever
 * send one range for media seeking; multi-range requests are legal but
 * pointless here, so they fall back to a full 200 like any other ignorable
 * header — only a syntactically valid, unsatisfiable range earns a 416.
 */

export interface ByteRange {
  start: number;
  /** Inclusive, per Content-Range semantics. */
  end: number;
}

export type RangeResult =
  | { kind: 'full' }
  | { kind: 'partial'; range: ByteRange }
  | { kind: 'unsatisfiable' };

const RANGE_SYNTAX = /^bytes=(\d*)-(\d*)$/;

export function parseRange(header: string | undefined, size: number): RangeResult {
  if (header === undefined) return { kind: 'full' };
  const match = RANGE_SYNTAX.exec(header.trim());
  if (!match) return { kind: 'full' }; // malformed or multi-range → ignore
  const [, startRaw, endRaw] = match;
  if (startRaw === '' && endRaw === '') return { kind: 'full' };

  // Suffix form `bytes=-n`: the final n bytes.
  if (startRaw === '') {
    const suffix = Number(endRaw);
    if (suffix === 0) return { kind: 'unsatisfiable' };
    if (size === 0) return { kind: 'unsatisfiable' };
    const start = Math.max(0, size - suffix);
    return { kind: 'partial', range: { start, end: size - 1 } };
  }

  const start = Number(startRaw);
  if (start >= size) return { kind: 'unsatisfiable' };

  // Open-ended `bytes=n-`: from n to the end.
  if (endRaw === '') return { kind: 'partial', range: { start, end: size - 1 } };

  const end = Number(endRaw);
  if (end < start) return { kind: 'full' }; // invalid per spec → ignore header
  return { kind: 'partial', range: { start, end: Math.min(end, size - 1) } };
}
