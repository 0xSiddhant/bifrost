import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { logsDirProblem } from './logger.js';

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('logsDirProblem (PLAN-39)', () => {
  it('creates a missing logs folder and finds no problem', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-web-logs-'));
    made.push(root);
    const logs = path.join(root, 'storage', 'logs');
    expect(logsDirProblem(logs)).toBeNull();
    expect(fs.statSync(logs).isDirectory()).toBe(true);
  });

  it('names the folder, the error and the fix when it cannot be written', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-web-logs-'));
    made.push(root);
    // A file where the folder should be: unwritable whatever user runs the test.
    const blocker = path.join(root, 'storage');
    fs.writeFileSync(blocker, '');
    const problem = logsDirProblem(path.join(blocker, 'logs'));
    expect(problem).toContain(path.join(blocker, 'logs'));
    expect(problem).toMatch(/ENOTDIR|EEXIST/);
    expect(problem).toContain('chown -R 1000 storage');
  });
});
