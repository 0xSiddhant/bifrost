import fs from 'node:fs';
import type { TestProject } from 'vitest/node';
import { RECORD_DIR } from './support/records.js';

/**
 * Give every API suite file one folder to leave its coverage record in, empty
 * at the start of each run. `coverage-report.ts` reads it after Vitest exits:
 * a global teardown cannot fail a Vitest run (its error is printed and the
 * exit code stays 0), so the report is its own step in `test:e2e:api`.
 */

declare module 'vitest' {
  export interface ProvidedContext {
    apiRecordDir: string;
  }
}

export function setup(project: TestProject): void {
  fs.rmSync(RECORD_DIR, { recursive: true, force: true });
  fs.mkdirSync(RECORD_DIR, { recursive: true });
  project.provide('apiRecordDir', RECORD_DIR);
}
