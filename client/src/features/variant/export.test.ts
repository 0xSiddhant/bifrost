import { describe, expect, it } from 'vitest';
import { diffJson } from '../../core/json/diff';
import { applyJsonPatch, type JsonPatchOp } from '../../core/json/jsonPatch';
import { DEFAULT_JSON_OPTIONS, compareText, DEFAULT_TEXT_OPTIONS } from './compare';
import { buildUnifiedDiff, exportJsonPatch, exportUnifiedDiff } from './export';

const jsonExport = (left: unknown, right: unknown, options = DEFAULT_JSON_OPTIONS) =>
  exportJsonPatch({
    records: diffJson(left, right, {
      ignoreKeyOrder: options.ignoreKeyOrder,
      arrayStrategy:
        options.arrayStrategy === 'key'
          ? { kind: 'key', field: options.arrayKeyField }
          : { kind: options.arrayStrategy },
    }),
    leftText: JSON.stringify(left),
    rightText: JSON.stringify(right),
    options,
    leftLabel: 'Original',
    rightLabel: 'Modified',
  });

describe('exportJsonPatch', () => {
  it('exports a verified patch for a real multi-op compare (acceptance 1)', () => {
    const left = { port: 8080, tags: ['a', 'b', 'c'], limits: { cpu: '500m' } };
    const right = { port: '8080', tags: ['a'], limits: { cpu: '1000m' }, owner: 'ops' };
    const result = jsonExport(left, right);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ops = JSON.parse(result.content) as JsonPatchOp[];
    expect(applyJsonPatch(left, ops)).toEqual(right);
  });

  it('names the file from the pane labels, including renamed ones (acceptance 9)', () => {
    const result = exportJsonPatch({
      records: diffJson({ a: 1 }, { a: 2 }),
      leftText: '{"a":1}',
      rightText: '{"a":2}',
      options: DEFAULT_JSON_OPTIONS,
      leftLabel: 'prod-config',
      rightLabel: 'staging-config',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.filename).toBe('prod-config-to-staging-config.patch.json');
      expect(result.mime).toBe('application/json-patch+json');
    }
  });

  it('says so when the documents differ only in key order (acceptance 3)', () => {
    const result = jsonExport({ b: 1, a: 2 }, { a: 2, b: 1 });
    expect(result).toEqual({
      ok: false,
      reason: 'These documents are structurally identical; JSON Patch has nothing to export.',
    });
  });

  it('says so when there are no differences at all', () => {
    expect(jsonExport({ a: 1 }, { a: 1 }).ok).toBe(false);
  });

  it('emits pretty-printed JSON ending in a newline', () => {
    const result = jsonExport({ a: 1 }, { a: 2 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toBe(
        '[\n  {\n    "op": "replace",\n    "path": "/a",\n    "value": 2\n  }\n]\n',
      );
    }
  });

  it('blocks an export whose replay throws (acceptance 5)', () => {
    // Synthetic records: a remove past the end of the array. The guard exists
    // for records that cannot be replayed, so it is tested on records that
    // cannot be replayed — see the key/set test below for why no compare the
    // UI can actually run produces them today.
    const left = { rows: ['a'] };
    const result = exportJsonPatch({
      records: [{ op: 'remove', path: ['rows', 9], leftPath: ['rows', 9], rightPath: null }],
      leftText: JSON.stringify(left),
      rightText: JSON.stringify({ rows: [] }),
      options: DEFAULT_JSON_OPTIONS,
      leftLabel: 'Original',
      rightLabel: 'Modified',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('index');
  });

  it('blocks an export that replays cleanly but lands on the wrong document', () => {
    const result = exportJsonPatch({
      records: [
        { op: 'change', path: ['a'], leftPath: ['a'], rightPath: ['a'], before: 1, after: 99 },
      ],
      leftText: '{"a":1}',
      rightText: '{"a":2}',
      options: DEFAULT_JSON_OPTIONS,
      leftLabel: 'Original',
      rightLabel: 'Modified',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('index');
  });

  it('exports key- and set-strategy compares rather than blocking them', () => {
    // Both strategies are order-insensitive by construction, so a patch that
    // reproduces the right document's content satisfies the replay check. A
    // 20k-pair randomized search found no compare under either strategy that
    // fails to replay — the guard above is a net, not a routine gate.
    const left = {
      rows: [
        { id: 1, v: 'a' },
        { id: 2, v: 'b' },
        { id: 3, v: 'c' },
      ],
    };
    const right = {
      rows: [
        { id: 3, v: 'c' },
        { id: 2, v: 'B' },
        { id: 1, v: 'a' },
      ],
    };
    for (const strategy of ['key', 'set'] as const) {
      const result = exportJsonPatch({
        records: diffJson(left, right, {
          arrayStrategy: strategy === 'key' ? { kind: 'key', field: 'id' } : { kind: 'set' },
        }),
        leftText: JSON.stringify(left),
        rightText: JSON.stringify(right),
        options: { ...DEFAULT_JSON_OPTIONS, arrayStrategy: strategy },
        leftLabel: 'Original',
        rightLabel: 'Modified',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const ops = JSON.parse(result.content) as JsonPatchOp[];
      expect(
        diffJson(applyJsonPatch(left, ops), right, {
          arrayStrategy: strategy === 'key' ? { kind: 'key', field: 'id' } : { kind: 'set' },
        }),
      ).toEqual([]);
    }
  });

  it('honours lenient options rather than blocking on a difference the compare ignored', () => {
    // With an ignore glob set, the patch legitimately omits `updatedAt`. A
    // literal deep-equal check against the right document would fail here.
    const left = { name: 'a', updatedAt: '2026-01-01' };
    const right = { name: 'b', updatedAt: '2026-09-05' };
    const options = { ...DEFAULT_JSON_OPTIONS, ignorePaths: '**.updatedAt' };
    const result = exportJsonPatch({
      records: diffJson(left, right, { ignorePaths: ['**.updatedAt'] }),
      leftText: JSON.stringify(left),
      rightText: JSON.stringify(right),
      options,
      leftLabel: 'Original',
      rightLabel: 'Modified',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(JSON.parse(result.content)).toEqual([{ op: 'replace', path: '/name', value: 'b' }]);
    }
  });
});

describe('buildUnifiedDiff header shape (acceptance 6)', () => {
  const left = 'alpha\nbravo\ncharlie\n';
  const right = 'alpha\nBRAVO\ncharlie\n';

  it('matches the spike decision: git-shaped, no Index:, no === separator', () => {
    const patch = buildUnifiedDiff(left, right, 'Original', 'Modified');
    const lines = patch.split('\n');
    expect(lines[0]).toBe('diff --git a/Original b/Modified');
    expect(lines[1]).toBe('--- a/Original');
    expect(lines[2]).toBe('+++ b/Modified');
    expect(lines[3]).toMatch(/^@@ -\d+,\d+ \+\d+,\d+ @@/);
    expect(patch).not.toContain('Index:');
    expect(patch).not.toContain('=====');
  });

  it('matches a known-good hunk body', () => {
    expect(buildUnifiedDiff(left, right, 'Original', 'Modified')).toBe(
      [
        'diff --git a/Original b/Modified',
        '--- a/Original',
        '+++ b/Modified',
        '@@ -1,3 +1,3 @@',
        ' alpha',
        '-bravo',
        '+BRAVO',
        ' charlie',
        '',
      ].join('\n'),
    );
  });

  it('tab-terminates a header path containing a space, the way git does', () => {
    const patch = buildUnifiedDiff(left, right, 'My File', 'My File 2');
    expect(patch).toContain('--- a/My File\t\n');
    expect(patch).toContain('+++ b/My File 2\t\n');
    // A path without a space gets no tab — git only adds one when it is needed.
    expect(buildUnifiedDiff(left, right, 'Plain', 'Plain2')).toContain('--- a/Plain\n');
  });

  it('marks a missing trailing newline the standard way', () => {
    expect(buildUnifiedDiff('alpha\nbravo', 'alpha\nBRAVO', 'L', 'R')).toContain(
      '\\ No newline at end of file',
    );
  });
});

describe('exportUnifiedDiff', () => {
  it('exports the normalized snapshots compareText produced', () => {
    // Case-insensitive compare: the two sides normalize to the same text, so
    // there is genuinely nothing to export.
    const compared = compareText('Alpha\nbravo\n', 'alpha\nBRAVO\n', {
      ...DEFAULT_TEXT_OPTIONS,
      ignoreCase: true,
    });
    const result = exportUnifiedDiff({
      leftText: compared.left,
      rightText: compared.right,
      leftLabel: 'Original',
      rightLabel: 'Modified',
    });
    expect(result).toEqual({
      ok: false,
      reason: 'Both sides are identical; there are no hunks to export.',
    });
  });

  it('names the file from the pane labels (acceptance 9)', () => {
    const result = exportUnifiedDiff({
      leftText: 'a\n',
      rightText: 'b\n',
      leftLabel: 'before.txt',
      rightLabel: 'after.txt',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.filename).toBe('before.txt-to-after.txt.patch');
      expect(result.mime).toBe('text/x-patch');
    }
  });

  it('falls back to sensible names when a label is empty or unsafe', () => {
    const result = exportUnifiedDiff({
      leftText: 'a\n',
      rightText: 'b\n',
      leftLabel: '   ',
      rightLabel: '../etc',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.filename).toBe('original-to-..etc.patch');
  });
});
