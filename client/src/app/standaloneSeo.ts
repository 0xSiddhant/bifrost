import { SITE_NAME, seoPageFor } from '../core/seo';

/**
 * Keeps the standalone site's tab title, description and canonical link in
 * step with the page as people move around it. A crawler reads each page's
 * own prerendered file (client/seoBuild.ts), which already carries all three;
 * this is for the person whose tab, history and bookmarks would otherwise
 * name the first page they opened.
 */
export function applyStandaloneSeo(pathname: string, doc: Document = document): void {
  const page = seoPageFor(pathname);
  doc.title = page?.title ?? SITE_NAME;
  if (!page) return;
  const description = doc.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (description) description.content = page.description;
  // Only when the build had a site URL to write one with.
  const canonical = doc.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (canonical) canonical.href = new URL(page.path, canonical.href).href;
}
