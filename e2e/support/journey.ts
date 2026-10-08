/**
 * Journey ↔ route bookkeeping for `routes.spec.ts`.
 *
 * A journey declares the client routes it covers as Playwright tags
 * (`@route:/edda/:slug`), written exactly as `App.tsx` writes them, so the
 * coverage check is a plain text comparison and needs no import of client
 * source. Nested child routes are written in full (`/upload/:name/preview`).
 */
export function routes(...paths: string[]): { tag: string[] } {
  return { tag: paths.map((path) => `@route:${path}`) };
}

/**
 * Every `<Route path="…">` in `App.tsx`, with nested relative children joined
 * onto their parent (`/upload` + `:name/preview` → `/upload/:name/preview`).
 * Reads the file as text: the e2e workspace never imports product source.
 */
export function routesInAppSource(source: string): string[] {
  const found: string[] = [];
  const stack: string[] = [];
  const tokens = /<Route\b|<\/Route>/g;
  for (let token = tokens.exec(source); token; token = tokens.exec(source)) {
    if (token[0] === '</Route>') {
      stack.pop();
      continue;
    }
    // Scan to the tag's own closing `>`, skipping any inside `{…}` — an
    // `element={<Page />}` attribute holds a `>` of its own.
    let depth = 0;
    let index = token.index + token[0].length;
    for (; index < source.length; index += 1) {
      const char = source[index];
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      else if (char === '>' && depth === 0) break;
    }
    const tag = source.slice(token.index, index + 1);
    tokens.lastIndex = index + 1;
    const raw = /\bpath="([^"]+)"/.exec(tag)?.[1];
    if (raw === undefined) continue;
    const selfClosing = source[index - 1] === '/';
    const parent = stack[stack.length - 1];
    const full =
      raw.startsWith('/') || raw === '*' || parent === undefined ? raw : `${parent}/${raw}`;
    found.push(full);
    if (!selfClosing) stack.push(full);
  }
  return found;
}

/**
 * Every route a spec file's text declares through `routes(...)` — the string
 * literals inside each call. Literal, not computed: a template literal there
 * would be invisible to this check, so specs spell their routes out.
 */
export function routeTagsInSpec(source: string): string[] {
  const found: string[] = [];
  for (const call of source.matchAll(/\broutes\(([^)]*)\)/g)) {
    for (const literal of (call[1] ?? '').matchAll(/'([^']*)'|"([^"]*)"/g)) {
      found.push(literal[1] ?? literal[2] ?? '');
    }
  }
  return found;
}

export interface DeclaredFeature {
  id: string;
  roots: string[];
  needsHub: boolean;
}

/**
 * Every feature `client/src/core/features.ts` declares (PLAN-35), read as
 * text like `App.tsx`: its id, the URL roots it owns, and whether it needs
 * the hub. Each `{ id: '…', … }` literal is one feature.
 */
export function featuresInSource(source: string): DeclaredFeature[] {
  const list = /FEATURES:[^=]*=\s*\[([\s\S]*?)\n\];/.exec(source)?.[1] ?? '';
  return [...list.matchAll(/\{([^{}]*)\}/g)].flatMap((match) => {
    const body = match[1] ?? '';
    const id = /\bid:\s*'([^']+)'/.exec(body)?.[1];
    const roots = /\broots:\s*\[([^\]]*)\]/.exec(body)?.[1];
    const needsHub = /\bneedsHub:\s*(true|false)/.exec(body)?.[1];
    if (id === undefined || roots === undefined || needsHub === undefined) return [];
    return [
      {
        id,
        roots: [...roots.matchAll(/'([^']+)'/g)].map((root) => root[1] ?? ''),
        needsHub: needsHub === 'true',
      },
    ];
  });
}

/** A root counts as covered by a journey tagged with it or any route beneath it. */
export function rootIsCovered(root: string, tags: Iterable<string>): boolean {
  for (const tag of tags) if (tag === root || tag.startsWith(`${root}/`)) return true;
  return false;
}
