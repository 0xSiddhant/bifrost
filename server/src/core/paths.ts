import { fileURLToPath } from 'node:url';
import path from 'node:path';

// This file lives at server/src/core/ (or server/dist/core/ after build) —
// both are exactly three levels below the repo root, so one relative hop works
// for dev (tsx) and production (node dist) alike.
export const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

export const SERVER_ROOT = path.join(REPO_ROOT, 'server');

export function fromRepoRoot(...segments: string[]): string {
  return path.resolve(REPO_ROOT, ...segments);
}
