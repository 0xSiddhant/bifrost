import type { DiffRecord, PathSegment } from './diff';

/**
 * RFC 6902 JSON Patch, built on PLAN-08's diff walker (PLAN-26).
 *
 * Two halves that only make sense together: `toJsonPatch` maps `DiffRecord[]`
 * onto patch operations, and `applyJsonPatch` replays them. The export flow
 * runs both — a generated patch is replayed against the real documents before
 * it is ever offered for download, so "this should be correct" becomes "this
 * was checked, for this exact pair, just now".
 *
 * Only `add`/`remove`/`replace` exist here. The walker never reports that an
 * element moved (`walkArrayByKey`: "moves are no-ops"), so there is nothing to
 * map onto `move`, and `copy`/`test` have no source in a diff at all.
 */

export type JsonPatchOp =
  | { op: 'add'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'replace'; path: string; value: unknown };

/** Thrown when a patch cannot be applied to the document it was handed. */
export class JsonPatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonPatchError';
  }
}

// ── pointers (RFC 6901) ─────────────────────────────────────────────────────

/**
 * `~` → `~0` and `/` → `~1`, per segment, before joining. Keys containing
 * either are ordinary in real JSON (file-path-shaped keys, `~config`), and an
 * unescaped pointer silently addresses the wrong location.
 */
function escapeSegment(segment: PathSegment): string {
  return String(segment).replace(/~/g, '~0').replace(/\//g, '~1');
}

function unescapeSegment(segment: string): string {
  // ~1 before ~0, or an escaped "~1" would decode as "/".
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** A path array → a JSON Pointer. The root path is `''`, not `'/'`. */
export function toJsonPointer(path: readonly PathSegment[]): string {
  return path.map((segment) => `/${escapeSegment(segment)}`).join('');
}

function parsePointer(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) {
    throw new JsonPatchError(`Not a JSON Pointer: ${JSON.stringify(pointer)}`);
  }
  return pointer.slice(1).split('/').map(unescapeSegment);
}

// ── DiffRecord[] → JsonPatchOp[] ────────────────────────────────────────────

/**
 * JSON Patch operations apply **sequentially**, each against the document the
 * previous one left behind. Removing index 3 of an array shifts what was index
 * 4 down into its place, so a later `remove /4` would target the wrong element
 * — or nothing at all. The walker emits its records in ascending index order
 * and makes no ordering promise between them, so the removes within any one
 * array are re-ordered highest-index-first here, which no earlier removal can
 * then invalidate.
 *
 * This closes the hazard for the default "index" array strategy, whose adds and
 * removes are always trailing. It is not a proof for the "key"/"set"
 * strategies, where both can land at arbitrary positions — those are covered by
 * replaying the finished patch (see `applyJsonPatch`), not by this ordering.
 */
function orderArrayRemoves(records: readonly DiffRecord[]): DiffRecord[] {
  const groups = new Map<string, number[]>();
  records.forEach((record, position) => {
    if (record.op !== 'remove') return;
    const last = record.path[record.path.length - 1];
    if (typeof last !== 'number') return;
    const parent = JSON.stringify(record.path.slice(0, -1));
    const bucket = groups.get(parent);
    if (bucket) bucket.push(position);
    else groups.set(parent, [position]);
  });

  const ordered = [...records];
  for (const positions of groups.values()) {
    if (positions.length < 2) continue;
    // Only the group's own slots are rewritten, so every other record keeps
    // the position — and therefore the relative order — the walker gave it.
    const descending = positions
      .map((position) => records[position] as DiffRecord)
      .sort((a, b) => Number(b.path[b.path.length - 1]) - Number(a.path[a.path.length - 1]));
    positions.forEach((position, slot) => {
      ordered[position] = descending[slot] as DiffRecord;
    });
  }
  return ordered;
}

/**
 * Map diff records onto RFC 6902 operations.
 *
 * `DiffRecord.path` is already the right pointer in every case: it is the
 * right-side path for `add` and the left-side path for everything else, which
 * is exactly what a sequentially-applied patch needs — `remove`/`replace`
 * address the source document, `add` addresses where the new value lands.
 *
 * `key-order` records are dropped. JSON considers objects unordered, so a
 * key-order difference is not a semantic one, and RFC 6902 has no operation
 * that could express it.
 */
export function toJsonPatch(records: readonly DiffRecord[]): JsonPatchOp[] {
  const meaningful = records.filter((record) => record.aspect !== 'key-order');
  return orderArrayRemoves(meaningful).map((record): JsonPatchOp => {
    const path = toJsonPointer(record.path);
    if (record.op === 'add') return { op: 'add', path, value: record.after };
    if (record.op === 'remove') return { op: 'remove', path };
    // `change` and `type-change` are both a replacement — RFC 6902 has no
    // concept of a type changing, because replacing a value's type is just
    // replacing the value.
    return { op: 'replace', path, value: record.after };
  });
}

// ── applying ────────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function arrayIndex(token: string, limit: number): number {
  if (!/^(?:0|[1-9]\d*)$/.test(token)) {
    throw new JsonPatchError(`Array index expected, got ${JSON.stringify(token)}`);
  }
  const index = Number(token);
  if (index > limit) throw new JsonPatchError(`Array index ${index} is out of range`);
  return index;
}

/** Walk to the container holding the final token, failing loudly if it is absent. */
function resolveContainer(root: unknown, tokens: readonly string[]): unknown {
  let current = root;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      current = current[arrayIndex(token, current.length - 1)];
      continue;
    }
    if (isPlainObject(current)) {
      if (!Object.hasOwn(current, token)) {
        throw new JsonPatchError(`No such property: ${JSON.stringify(token)}`);
      }
      current = current[token];
      continue;
    }
    throw new JsonPatchError(`Cannot descend into a ${current === null ? 'null' : typeof current}`);
  }
  return current;
}

function applyToContainer(container: unknown, token: string, op: JsonPatchOp): void {
  if (Array.isArray(container)) {
    if (op.op === 'add') {
      // "-" is RFC 6902's append token; an index equal to the length appends too.
      const index = token === '-' ? container.length : arrayIndex(token, container.length);
      container.splice(index, 0, op.value);
      return;
    }
    const index = arrayIndex(token, container.length - 1);
    if (op.op === 'remove') container.splice(index, 1);
    else container[index] = op.value;
    return;
  }
  if (isPlainObject(container)) {
    if (op.op === 'add') {
      container[token] = op.value;
      return;
    }
    if (!Object.hasOwn(container, token)) {
      throw new JsonPatchError(`No such property: ${JSON.stringify(token)}`);
    }
    if (op.op === 'remove') delete container[token];
    else container[token] = op.value;
    return;
  }
  throw new JsonPatchError('Cannot address a member of a primitive value');
}

/**
 * Apply a patch to a **copy** of `doc`, in order, and return the result.
 * Throws `JsonPatchError` the moment an operation does not fit the document —
 * which is the point: this is the check that decides whether a generated patch
 * is fit to hand over, so a bad one has to fail rather than limp.
 */
export function applyJsonPatch(doc: unknown, ops: readonly JsonPatchOp[]): unknown {
  let result = structuredClone(doc);
  for (const op of ops) {
    const tokens = parsePointer(op.path);
    if (tokens.length === 0) {
      if (op.op === 'remove') throw new JsonPatchError('Cannot remove the whole document');
      result = structuredClone(op.value);
      continue;
    }
    const container = resolveContainer(result, tokens.slice(0, -1));
    applyToContainer(container, tokens[tokens.length - 1] as string, op);
  }
  return result;
}
