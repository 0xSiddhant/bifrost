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
