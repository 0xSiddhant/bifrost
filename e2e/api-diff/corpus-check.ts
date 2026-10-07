import fs from 'node:fs';

/**
 * The corpus check (PLAN-32c): every `GET` route in the candidate's
 * `server/openapi.json` must be reached by at least one read in the corpus, or
 * be excluded by nature with its reason. A route the corpus never reads is a
 * route the diff never compared, which would make "zero differences" mean
 * less than it says.
 */

interface Spec {
  paths?: Record<string, Record<string, unknown>>;
}

/** `/api/runestone/{slug}` → a regex matching one concrete path segment per parameter. */
function templateRegex(template: string): RegExp {
  const pattern = template
    .split(/\{[^}]+\}/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]+');
  return new RegExp(`^${pattern}$`);
}

/** The GET templates no corpus path reaches and no exclusion names, in spec order. */
export function uncoveredReads(
  spec: Spec,
  corpusPaths: readonly string[],
  excluded: readonly string[],
): string[] {
  const concrete = corpusPaths.map((path) => path.split('?')[0] ?? path);
  return Object.entries(spec.paths ?? {})
    .filter(([, operations]) => 'get' in operations)
    .map(([template]) => template)
    .filter((template) => !excluded.includes(template))
    .filter((template) => {
      const regex = templateRegex(template);
      return !concrete.some((path) => regex.test(path));
    });
}

/** The spec a build root carries, or null for a ref older than PLAN-32b. */
export function readSpec(file: string): Spec | null {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Spec;
}
