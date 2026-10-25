/**
 * What search engines and link previews read of the public standalone site:
 * one entry per page it ships. Only pages that work without the hub are here
 * (`needsHub: false` in core/features.ts, plus the three category hubs and
 * Diagon Alley's in-place tools); hub-only pages are never listed, so they
 * are never prerendered, never in the sitemap, and answer 404 on the
 * standalone site. `seo.test.ts` holds this list and the features in step.
 *
 * Pure data, no DOM and no build globals: `client/seoBuild.ts` imports it in
 * Node to write each page's HTML, and the standalone app reads it to keep the
 * tab title in step as people move between pages.
 */

export const SITE_NAME = 'Bifrost';

export interface SeoPage {
  /** The page's path, no trailing slash ('/' for the home page). */
  path: string;
  /** The whole `<title>`: what people search for first, then the name. */
  title: string;
  /** The meta description and preview text: one or two plain sentences. */
  description: string;
  /** The prerendered page's `<h1>`, and its link text from every other page. */
  heading: string;
}

function tool(id: string, heading: string, description: string): SeoPage {
  return { path: `/diagon-alley/${id}`, title: `${heading} | ${SITE_NAME}`, description, heading };
}

export const SEO_PAGES: readonly SeoPage[] = [
  {
    path: '/',
    title: 'Bifrost — free developer tools that run in your browser',
    description:
      'JSON, Markdown, YAML and XML editors, a diff checker, JavaScript tools, a slide presenter and quick utilities like Base64, JWT and UUID. Everything runs in your browser.',
    heading: 'Bifrost — developer tools in your browser',
  },
  {
    path: '/ollivanders',
    title: 'Code editors for JSON, Markdown, YAML and XML | Bifrost',
    description:
      'Browser editors for JSON, Markdown, YAML and XML, a JSON and text diff checker, and JavaScript beautify, minify and regex tools. Your documents stay in your browser.',
    heading: 'Code editors for JSON, Markdown, YAML and XML',
  },
  {
    path: '/diagon-alley',
    title: 'Developer utilities: Base64, JWT, UUID, cron and more | Bifrost',
    description:
      'Quick developer utilities: Base64, URL encoding, UUID v4 and v7, Unix time, JWT decoding, colour contrast, CIDR, cron, passwords, SHA-256 and QR codes.',
    heading: 'Developer utilities',
  },
  {
    path: '/runestone',
    title: 'JSON editor, formatter and validator — Runestone | Bifrost',
    description:
      'Validate, format, minify and explore JSON with code and tree views, folding and find. Large numbers keep their precision, and nothing leaves your browser.',
    heading: 'Runestone — JSON editor, formatter and validator',
  },
  {
    path: '/variant',
    title: 'JSON and text diff checker — Variant | Bifrost',
    description:
      'Compare two JSON or text documents side by side, jump between the differences, and export them as a JSON Patch or a unified diff.',
    heading: 'Variant — JSON and text diff checker',
  },
  {
    path: '/edda',
    title: 'Markdown editor with live preview — Edda | Bifrost',
    description:
      'Write Markdown with a live preview, Mermaid diagrams and print to PDF, right in your browser.',
    heading: 'Edda — Markdown editor with live preview',
  },
  {
    path: '/groot',
    title: 'YAML editor, formatter and validator — Groot | Bifrost',
    description:
      'Edit YAML with folding, comment-preserving formatting, a tree view, and advisories for the traps YAML hides in plain sight.',
    heading: 'Groot — YAML editor, formatter and validator',
  },
  {
    path: '/atlas',
    title: 'XML and plist editor and formatter — Atlas | Bifrost',
    description:
      'Format, minify and fold any XML document. An Apple property list (plist) also opens as an editable, Xcode-style table.',
    heading: 'Atlas — XML and plist editor',
  },
  {
    path: '/loki',
    title: 'JavaScript beautifier, minifier and regex tester — Loki | Bifrost',
    description:
      'Beautify, minify and transform JavaScript, test regular expressions, and run snippets in a sandbox, all in your browser.',
    heading: 'Loki — JavaScript beautifier, minifier and regex tester',
  },
  {
    path: '/saga',
    title: 'Present Markdown and PDF slides — Saga | Bifrost',
    description:
      'Turn a Markdown deck or a PDF into full-screen slides with presenter notes. Drop a file and present; it never leaves your browser.',
    heading: 'Saga — present Markdown and PDF slides',
  },
  tool(
    'qr',
    'QR code generator',
    'Turn text or a URL into a scannable QR code, right in your browser.',
  ),
  tool(
    'base64',
    'Base64 encoder and decoder',
    'Encode and decode Base64, standard or URL-safe, right in your browser.',
  ),
  tool(
    'uuid',
    'UUID generator (v4 and v7)',
    'Generate v4 and v7 UUIDs, one or a hundred at a time, right in your browser.',
  ),
  tool(
    'epoch',
    'Unix timestamp converter',
    'Convert Unix time to a human-readable date and back again, right in your browser.',
  ),
  tool(
    'url',
    'URL encoder, decoder and parser',
    'Encode and decode URL components, and take a URL apart into its pieces.',
  ),
  tool(
    'bytes',
    'Text to hex, binary and ASCII converter',
    'Convert text to bytes, switch between number bases, and count characters and bytes.',
  ),
  tool(
    'jwt',
    'JWT decoder',
    "Read a JSON Web Token's header and payload. Decode only: it never verifies the token or sends it anywhere.",
  ),
  tool(
    'iris',
    'Colour converter and contrast checker',
    'Convert colours between formats, check contrast, and build palettes.',
  ),
  tool(
    'cidr',
    'CIDR and subnet calculator',
    'Turn a CIDR block into its netmask, address range and host count.',
  ),
  tool(
    'case',
    'Text case converter',
    'Convert text between camelCase, snake_case, kebab-case and URL slugs.',
  ),
  tool(
    'secret',
    'Password generator',
    'Generate random passwords, with an honest entropy figure for each one.',
  ),
  tool(
    'cron',
    'Cron expression explainer',
    'See what a cron expression means in plain words, and when it runs next.',
  ),
  tool(
    'hash',
    'SHA-256 hash generator',
    "Digest text with SHA-256 using your browser's own Web Crypto.",
  ),
];

/** The page for a path, ignoring a trailing slash; undefined when it is not public. */
export function seoPageFor(pathname: string): SeoPage | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return SEO_PAGES.find((page) => page.path === path);
}
