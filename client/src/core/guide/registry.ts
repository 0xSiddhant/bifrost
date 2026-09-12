/**
 * Which format guide belongs to which page (PLAN-30).
 *
 * One registry rather than a bulb wired into six pages: `GuideButton` is
 * mounted once, in the header, for every route, and asks this map what — if
 * anything — the page in front of the user works with. A route with no entry
 * gets no button at all.
 *
 * The guides themselves are static `.md` files bundled with the client, not
 * server content. Every page that has one is already in the offline-mode
 * warm-load registry precisely because it keeps working with no server
 * round-trip; a guide fetched over HTTP would be the one part of such a page
 * that quietly stopped working the moment the LAN dropped.
 *
 * Each is loaded through its own `import()` so it lands in its own chunk: a
 * guide nobody opens costs no bytes on any page load.
 */

export type GuideId = 'json' | 'markdown' | 'xml' | 'yaml' | 'javascript' | 'brotli';

export interface Guide {
  id: GuideId;
  /** The format's name — the panel's heading and part of the button's label. */
  title: string;
  /** The route root this guide belongs to, matched with its sub-routes. */
  route: string;
  /** The guide's markdown source, fetched on first open. */
  load: () => Promise<string>;
}

export const GUIDES: Guide[] = [
  {
    id: 'json',
    title: 'JSON',
    route: '/runestone',
    load: () => import('../../assets/guides/json.md?raw').then((m) => m.default),
  },
  {
    id: 'markdown',
    title: 'Markdown',
    route: '/edda',
    load: () => import('../../assets/guides/markdown.md?raw').then((m) => m.default),
  },
  {
    id: 'xml',
    title: 'XML',
    route: '/atlas',
    load: () => import('../../assets/guides/xml.md?raw').then((m) => m.default),
  },
  {
    // Groot already carries an advisory rail (PLAN-19) that reads the document
    // actually in the editor. This is the other kind of help — background on
    // the format itself, true whatever is open — and `yaml.md` says so, naming
    // the rail rather than quietly duplicating what it already does.
    id: 'yaml',
    title: 'YAML',
    route: '/groot',
    load: () => import('../../assets/guides/yaml.md?raw').then((m) => m.default),
  },
  {
    id: 'javascript',
    title: 'JavaScript',
    route: '/loki',
    load: () => import('../../assets/guides/javascript.md?raw').then((m) => m.default),
  },
  {
    id: 'brotli',
    title: 'Brotli',
    route: '/brotli',
    load: () => import('../../assets/guides/brotli.md?raw').then((m) => m.default),
  },
];

/**
 * The guide for a page, or `null` where there is nothing to explain.
 *
 * Prefix matching, the same shape the header's own nav-tab matching uses, so a
 * sub-route inherits its root's guide (`/edda/preview/:slug` is still Markdown)
 * without `/lokistuff` ever matching `/loki`.
 *
 * Pensieve, Variant and the hubs deliberately have no entry: the button's whole
 * premise is "the format this page works with", and a document library or a
 * diff tool has no single format to point at.
 */
export function guideForRoute(pathname: string): Guide | null {
  return (
    GUIDES.find((guide) => pathname === guide.route || pathname.startsWith(`${guide.route}/`)) ??
    null
  );
}
