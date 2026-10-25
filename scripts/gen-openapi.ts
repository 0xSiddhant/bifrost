/**
 * `npm run api:spec` — regenerates `server/openapi.json` from the app's own
 * route schemas (PLAN-32). Run it after changing any route; `npm test` fails
 * while the committed file is stale.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  OPENAPI_FILE,
  formatOpenApiSpec,
  generateOpenApiSpec,
} from '../server/src/openapi-spec.js';

const spec = await generateOpenApiSpec();
fs.writeFileSync(OPENAPI_FILE, formatOpenApiSpec(spec));
const paths = Object.keys((spec.paths ?? {}) as Record<string, unknown>).length;
console.log(`wrote ${path.relative(process.cwd(), OPENAPI_FILE)} (${paths} paths)`);
