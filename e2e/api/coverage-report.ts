import fs from 'node:fs';
import { RECORD_DIR, readRecords, uncovered } from './support/records.js';
import { loadSpec } from './support/spec.js';

/**
 * The coverage report (PLAN-33, criterion 4): after the API suite, every
 * operation in openapi.json must have produced a success in some journey or
 * fuzz run. An empty report is the pass condition.
 */
const records = readRecords();
fs.rmSync(RECORD_DIR, { recursive: true, force: true });
const never = uncovered(loadSpec(), records);
if (never === null) {
  process.stdout.write('coverage report skipped: the run did not include contract and fuzz\n');
} else if (never.length > 0) {
  process.stderr.write(
    `coverage report: ${never.length} operation(s) never produced a success:\n  - ${never.join('\n  - ')}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `coverage report: all ${loadSpec().operations.length} operations produced a success\n`,
  );
}
