import type { ApiClient } from './client.js';

/** Go-links. Every rule (slug shape, reserved roots, target scheme) is the server's. */

export interface Portkey {
  slug: string;
  url: string;
  note: string | null;
  hits: number;
  authorDeviceId: string | null;
  createdAt: number;
  lastUsedAt: number | null;
}

export function listPortkeys(client: ApiClient, q?: string): Promise<Portkey[]> {
  return client.json<Portkey[]>('listing go-links', 'GET', '/api/portkey', {
    query: { q },
  });
}

export function createPortkey(
  client: ApiClient,
  input: { slug: string; url: string; note?: string },
): Promise<Portkey> {
  return client.json<Portkey>('creating a go-link', 'POST', '/api/portkey', { body: input });
}

export function updatePortkey(
  client: ApiClient,
  slug: string,
  patch: { url?: string; note?: string },
): Promise<Portkey> {
  return client.json<Portkey>(
    'updating a go-link',
    'PATCH',
    `/api/portkey/${encodeURIComponent(slug)}`,
    { body: patch },
  );
}

export function removePortkey(client: ApiClient, slug: string): Promise<void> {
  return client.voidCall(
    'removing a go-link',
    'DELETE',
    `/api/portkey/${encodeURIComponent(slug)}`,
  );
}

/**
 * Where a slug actually points, read from the redirect itself.
 *
 * There is no `GET /api/portkey/:slug` to ask instead, and the list endpoint's
 * `q` is a fuzzy search rather than an exact lookup — so `go` follows the real
 * hop with `redirect: 'manual'` and reads `Location`. An unknown slug is never a
 * 404: the server bounces it to `/portkey?go=<slug>` so the management page
 * arrives pre-filled, and that bounce is what "no such link" looks like here.
 * Following it would land in the SPA's HTML, which is the mistake this avoids.
 */
export async function resolvePortkey(client: ApiClient, slug: string): Promise<string | null> {
  const response = await client.probe(`/go/${encodeURIComponent(slug)}`, { redirect: 'manual' });
  const location = response.headers.get('location');
  await response.arrayBuffer();
  if (location === null) return null;
  return isUnknownSlugBounce(location) ? null : location;
}

/** The server's creative 404: `/portkey?go=<slug>`, relative or absolute. */
export function isUnknownSlugBounce(location: string): boolean {
  const withoutOrigin = location.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '');
  return withoutOrigin.startsWith('/portkey?go=');
}
