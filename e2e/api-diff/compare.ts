/**
 * The API diff's pure half: what a captured response is, how two of them are
 * compared, and how the write sequence's generated values are normalised.
 * No I/O here, so every rule is unit-tested (compare.test.ts).
 */

export interface Captured {
  /** `GET /api/edda?sort=name` — the request, as a stable label. */
  request: string;
  status: number;
  /** Only the headers the diff compares (see COMPARED_HEADERS). */
  headers: Record<string, string>;
  body: Buffer;
}

/**
 * The response headers a client or a script acts on. `date`, `etag`,
 * `content-length` (it follows the body), `keep-alive` and the like are left
 * out: they differ by nature or restate the body.
 */
export const COMPARED_HEADERS = [
  'content-type',
  'location',
  'content-disposition',
  'access-control-allow-origin',
] as const;

export interface Difference {
  request: string;
  what: 'status' | 'header' | 'body' | 'missing';
  detail: string;
}

/** First byte offset where two buffers differ, or -1 when they are equal. */
export function firstDifference(a: Buffer, b: Buffer): number {
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) if (a[index] !== b[index]) return index;
  return a.length === b.length ? -1 : length;
}

function excerpt(buffer: Buffer, at: number): string {
  const from = Math.max(0, at - 40);
  return JSON.stringify(buffer.subarray(from, at + 40).toString('utf8'));
}

/**
 * A zip compared by what it holds, not by its byte order: the folder archive
 * lists its files in the downloads watcher's insertion order, which follows
 * chokidar's boot scan and can differ between two boots of the *same* build
 * (found by this tool, reported in PLAN-32a). Each entry's name, CRC-32 and
 * size are compared — the contents themselves, byte for byte, via the CRC.
 */
export function canonicalZip(zip: Buffer): Buffer {
  const entries: string[] = [];
  for (
    let offset = zip.indexOf('PK\x01\x02');
    offset !== -1;
    offset = zip.indexOf('PK\x01\x02', offset + 4)
  ) {
    const crc = zip.readUInt32LE(offset + 16);
    const size = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    entries.push(`${name}\t${crc.toString(16)}\t${size}`);
  }
  return Buffer.from(`zip entries:\n${entries.sort().join('\n')}`);
}

function comparable(captured: Captured): Buffer {
  return (captured.headers['content-type'] ?? '').startsWith('application/zip')
    ? canonicalZip(captured.body)
    : captured.body;
}

export function compareCaptured(base: Captured, candidate: Captured): Difference[] {
  const differences: Difference[] = [];
  const request = base.request;
  if (base.status !== candidate.status) {
    differences.push({ request, what: 'status', detail: `${base.status} → ${candidate.status}` });
  }
  for (const name of COMPARED_HEADERS) {
    const before = base.headers[name];
    const after = candidate.headers[name];
    if (before !== after)
      differences.push({
        request,
        what: 'header',
        detail: `${name}: ${String(before)} → ${String(after)}`,
      });
  }
  const before = comparable(base);
  const after = comparable(candidate);
  const at = firstDifference(before, after);
  if (at !== -1) {
    differences.push({
      request,
      what: 'body',
      detail: `bytes differ at offset ${at} (base ${before.length} B, candidate ${after.length} B)\n      base:      ${excerpt(before, at)}\n      candidate: ${excerpt(after, at)}`,
    });
  }
  return differences;
}

export function compareRuns(base: Captured[], candidate: Captured[]): Difference[] {
  const byRequest = new Map(candidate.map((entry) => [entry.request, entry]));
  const differences: Difference[] = [];
  for (const entry of base) {
    const other = byRequest.get(entry.request);
    if (!other) {
      differences.push({
        request: entry.request,
        what: 'missing',
        detail: 'the candidate never answered this request',
      });
      continue;
    }
    differences.push(...compareCaptured(entry, other));
  }
  return differences;
}

/**
 * Normalising the write sequence. Each side mints its own ids, slugs and
 * timestamps, so the same scripted writes cannot produce the same bytes —
 * but they must produce the same *shape*. Only this short, explicit list of
 * generated values is rewritten; everything else is compared byte for byte.
 */
export const TIME_KEYS = new Set([
  'ts',
  'createdAt',
  'modifiedAt',
  'updatedAt',
  'lastUsedAt',
  'lastSeen',
  'mtime',
  'at',
  'expiresAt',
  'checkedAt',
]);
export const GENERATED_KEYS = new Set(['id', 'slug', 'storedName', 'deviceId']);

/**
 * A per-side table of generated tokens, numbered in order of first sight, so
 * `abc123` on one side and `xyz789` on the other both become `<id:1>` when they
 * are the first id each side minted — and every later mention of it (a
 * `location` header, a `go` URL) is rewritten the same way.
 */
export class TokenTable {
  private readonly tokens = new Map<string, string>();

  learn(value: string, kind: string): void {
    if (value.length < 4 || this.tokens.has(value)) return;
    this.tokens.set(value, `<${kind}:${this.tokens.size + 1}>`);
  }

  /** Replace every learned token inside `text`, longest first. */
  rewrite(text: string): string {
    let out = text;
    for (const [token, label] of [...this.tokens].sort((a, b) => b[0].length - a[0].length)) {
      out = out.split(token).join(label);
    }
    return out;
  }
}

export function learnTokens(value: unknown, table: TokenTable): void {
  if (Array.isArray(value)) {
    for (const item of value) learnTokens(item, table);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      if (GENERATED_KEYS.has(key) && typeof inner === 'string') table.learn(inner, key);
      else learnTokens(inner, table);
    }
  }
}

function normaliseValue(value: unknown, table: TokenTable): unknown {
  if (Array.isArray(value)) return value.map((item) => normaliseValue(item, table));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key,
        TIME_KEYS.has(key) && typeof inner === 'number' ? '<time>' : normaliseValue(inner, table),
      ]),
    );
  }
  if (typeof value === 'string') return table.rewrite(value);
  return value;
}

/**
 * The normalised form of one write-sequence response. JSON keeps its key
 * order (it is re-serialised from the parse, which preserves order), so a
 * reordering is still a difference.
 */
export function normaliseCaptured(captured: Captured, table: TokenTable): Captured {
  const text = captured.body.toString('utf8');
  let body = captured.body;
  if ((captured.headers['content-type'] ?? '').includes('json') && text.length > 0) {
    try {
      const parsed: unknown = JSON.parse(text);
      learnTokens(parsed, table);
      body = Buffer.from(JSON.stringify(normaliseValue(parsed, table)));
    } catch {
      body = Buffer.from(table.rewrite(text));
    }
  }
  const headers = Object.fromEntries(
    Object.entries(captured.headers).map(([key, value]) => [key, table.rewrite(value)]),
  );
  return { ...captured, request: table.rewrite(captured.request), headers, body };
}
