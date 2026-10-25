import fs from 'node:fs';
import path from 'node:path';
import { fromRepoRoot } from '../../support/paths.js';
import type { RecordFile } from './http.js';
import type { Spec } from './spec.js';

/** Where suite files leave their coverage records (gitignored, with test-results/). */
export const RECORD_DIR = fromRepoRoot('e2e', 'test-results', 'api-records');

export function readRecords(dir = RECORD_DIR): RecordFile[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as RecordFile);
}

/**
 * The operations no suite ever saw succeed, or null when the run did not
 * include both the contract journeys and the fuzzer (a narrowed local run is
 * not judged on what it never tried).
 */
export function uncovered(spec: Spec, records: RecordFile[]): string[] | null {
  const suites = new Set(records.map((record) => record.suite));
  if (!suites.has('contract') || !suites.has('fuzz')) return null;
  const covered = new Set(records.flatMap((record) => record.covered));
  return spec.operations
    .filter((op) => !covered.has(op.operationId))
    .map((op) => `${op.operationId} (${op.method} ${op.template})`);
}
