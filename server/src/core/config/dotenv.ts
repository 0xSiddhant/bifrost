import dotenv from 'dotenv';
import { fromRepoRoot } from '../paths.js';

/**
 * Load the repo-root .env regardless of cwd — workspace scripts run with
 * cwd=server/, so a bare `import 'dotenv/config'` would miss it.
 */
export function loadDotenv(): void {
  dotenv.config({ path: fromRepoRoot('.env'), quiet: true });
}
