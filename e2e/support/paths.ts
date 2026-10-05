import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The repo root, found from this file rather than from `process.cwd()`: the
 * suites run with cwd=e2e/ under the workspace scripts, but a developer may run
 * one spec from the repo root, and the server's own paths are repo-relative.
 */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function fromRepoRoot(...segments: string[]): string {
  return path.resolve(REPO_ROOT, ...segments);
}
