import type { ApiClient } from './client.js';
import { CliError, EXIT } from './output.js';

/**
 * Slug → document, shared by `open` and `preview`.
 *
 * A slug names a document but not which *kind* — ids are only unique within a
 * kind — so a bare slug is resolved by asking all four raw endpoints at once and
 * seeing which answers. Exactly one 200 is the overwhelmingly common case; zero
 * is a clean "not found"; more than one is a genuine cross-kind collision and is
 * reported rather than silently resolved one way. `--type` skips the fan-out.
 *
 * The content-type check is load-bearing, not belt-and-braces: these endpoints
 * live *outside* `/api/`, so on a profile where a kind's module isn't loaded the
 * SPA fallback answers `index.html` with a 200. Matching the kind's own media
 * type is what tells a real document from the app's shell.
 */

export const DOCUMENT_KINDS = ['runestone', 'edda', 'groot', 'atlas'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** The media type each kind's raw endpoint really sends, read from its route. */
const CONTENT_TYPE: Record<DocumentKind, string> = {
  runestone: 'application/json',
  edda: 'text/markdown',
  groot: 'application/yaml',
  atlas: 'application/xml',
};

export function isDocumentKind(value: string): value is DocumentKind {
  return (DOCUMENT_KINDS as readonly string[]).includes(value);
}

export function rawPath(kind: DocumentKind, slug: string): string {
  return `/${kind}/api/${encodeURIComponent(slug)}`;
}

export interface ResolvedDocument {
  kind: DocumentKind;
  /** Canonical slug — a stale slug 301s, and `fetch` follows it. */
  slug: string;
  /** The stored bytes as text. `preview` discards this rather than re-fetching. */
  body: string;
}

async function tryKind(
  client: ApiClient,
  kind: DocumentKind,
  slug: string,
): Promise<ResolvedDocument | null> {
  const response = await client.probe(rawPath(kind, slug));
  if (!response.ok) {
    await response.arrayBuffer();
    return null;
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith(CONTENT_TYPE[kind])) {
    // The SPA fallback answering, or a proxy in the way. Not this kind.
    await response.arrayBuffer();
    return null;
  }
  return { kind, slug: slugFromUrl(response.url) ?? slug, body: await response.text() };
}

/** After a 301 the response URL carries the canonical slug; before one it is the same. */
function slugFromUrl(url: string): string | null {
  try {
    const segments = new URL(url).pathname.split('/');
    const last = segments[segments.length - 1];
    return last !== undefined && last.length > 0 ? decodeURIComponent(last) : null;
  } catch {
    // A URL we cannot parse only costs the canonical-slug refinement; the slug
    // the caller typed is still correct enough to report and to build a URL from.
    return null;
  }
}

export async function resolveDocument(
  client: ApiClient,
  slug: string,
  type?: string,
): Promise<ResolvedDocument> {
  if (type !== undefined) {
    if (!isDocumentKind(type)) {
      throw new CliError(`unknown --type "${type}" — one of ${DOCUMENT_KINDS.join(', ')}`);
    }
    const found = await tryKind(client, type, slug);
    if (found === null) {
      throw new CliError(`no ${type} with the slug "${slug}"`, EXIT.notFound);
    }
    return found;
  }

  const settled = await Promise.all(DOCUMENT_KINDS.map((kind) => tryKind(client, kind, slug)));
  const matches = settled.filter((entry): entry is ResolvedDocument => entry !== null);
  if (matches.length === 1) return matches[0] as ResolvedDocument;
  if (matches.length === 0) {
    throw new CliError(`no document with the slug "${slug}"`, EXIT.notFound);
  }
  const kinds = matches.map((match) => match.kind).join(', ');
  throw new CliError(
    `"${slug}" exists as more than one kind (${kinds}) — pass --type <kind> to choose`,
    EXIT.conflict,
  );
}

/**
 * The URL a browser should land on for a resolved document.
 *
 * Only `edda` has a rendered read-only page today (`/edda/preview/:slug`, a real
 * client route). The other three get their raw content URL, which a browser
 * already renders readably — Chrome's JSON viewer, highlighted text for YAML and
 * XML. That is the honest closest thing, not a rendered page pretending; the day
 * one of them gains a read route, it is one entry here and nothing else changes.
 */
export function previewUrl(baseUrl: string, document: ResolvedDocument): string {
  const slug = encodeURIComponent(document.slug);
  return document.kind === 'edda'
    ? `${baseUrl}/edda/preview/${slug}`
    : `${baseUrl}${rawPath(document.kind, document.slug)}`;
}

/** True when `previewUrl` returned a real rendered page rather than raw bytes. */
export function hasRenderedPage(kind: DocumentKind): boolean {
  return kind === 'edda';
}
