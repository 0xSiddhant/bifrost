import path from 'node:path';
import { CliError } from './output.js';

/**
 * Which tool opens a local file (PLAN-28, PLAN-29).
 *
 * `bifrost preview` has two jobs that look the same from a terminal — "show me
 * this saved document" and "show me this file on my disk" — and only the second
 * one needs this table. Extension and destination are both validated here,
 * **before** any port is opened or any browser is launched, so a typo costs a
 * sentence rather than a stray server and a blank tab.
 *
 * A destination is a client route that knows how to read a URL. Saga is the
 * only one so far (`/saga?source=…`, PLAN-28), and it now presents two kinds of
 * file rather than one (PLAN-29). Others are one row each: an Edda destination
 * that seeds the editor from a URL would land as another entry in
 * `destinations`.
 */

export const PREVIEW_DESTINATIONS = ['saga'] as const;
export type PreviewDestination = (typeof PREVIEW_DESTINATIONS)[number];

interface Destination {
  id: PreviewDestination;
  /** What this destination presents, for the refusal wording. */
  presents: string;
  /** The extensions it accepts, named in a refusal so it is actionable. */
  extensions: readonly string[];
  /** The client path that reads a served URL. */
  clientPath(payloadUrl: string): string;
}

const MARKDOWN_EXTENSIONS = ['.md', '.markdown'] as const;
const PDF_EXTENSIONS = ['.pdf'] as const;

const SAGA: Destination = {
  id: 'saga',
  presents: 'markdown and pdf',
  extensions: [...MARKDOWN_EXTENSIONS, ...PDF_EXTENSIONS],
  clientPath: (payloadUrl) => `/saga?source=${encodeURIComponent(payloadUrl)}`,
};

const DESTINATIONS: Record<PreviewDestination, Destination> = { saga: SAGA };

interface FileRoute {
  extensions: readonly string[];
  destinations: readonly PreviewDestination[];
  /**
   * Used when `--type` is omitted. `null` means the flag is required.
   *
   * Markdown is `null` deliberately rather than defaulting to Saga: PLAN-28
   * states Edda as markdown's intended default ("presenting is the deliberate
   * ask, not the assumption"), and the hand-off that would seed Edda's editor
   * from a URL does not exist yet. Defaulting to Saga now would have to be
   * taken back later; requiring the flag leaves that default free to arrive.
   */
  fallback: PreviewDestination | null;
}

const ROUTES: readonly FileRoute[] = [
  { extensions: MARKDOWN_EXTENSIONS, destinations: ['saga'], fallback: null },
  /**
   * A PDF needs no `--type`, where markdown does. The reasoning above is about
   * markdown having a second plausible destination worth leaving room for; a
   * PDF has exactly one thing `preview` can do with it, so demanding a flag to
   * pick from a list of one would be ceremony. PLAN-27's table pointed `.pdf`
   * at the read-only `PdfViewer`; presenting it is the whole point of PLAN-29.
   */
  { extensions: PDF_EXTENSIONS, destinations: ['saga'], fallback: 'saga' },
];

/** Every extension `preview` can open from disk, for the error wording. */
export const PREVIEWABLE_EXTENSIONS: readonly string[] = ROUTES.flatMap(
  (route) => route.extensions,
);

export function isPreviewDestination(value: string): value is PreviewDestination {
  return (PREVIEW_DESTINATIONS as readonly string[]).includes(value);
}

/** A trailing `.ext` — how a bare filename is told from a bare slug. */
const HAS_EXTENSION = /\.[a-z0-9]{1,8}$/i;

/**
 * Whether the argument names a file on disk rather than a saved document's slug.
 *
 * A slug is a bare memorable word (`sublime-usecase-ueyqid`); a path has a
 * separator, a leading `.` or `~`, or **any** extension at all. Deliberately not
 * just the extensions this table knows: `bifrost preview data.json --type saga`
 * has to reach the file branch to be told what Saga actually presents — routing
 * it to the slug branch instead answers with the wrong error entirely, naming
 * document kinds nobody asked about. Caught by live-verify, not by a test.
 *
 * PLAN-27's `preview <slug>` is untouched: a slug carries no extension, so
 * nothing that resolved as a document before starts looking on disk now.
 */
export function looksLikeFilePath(target: string): boolean {
  if (target.includes('/') || target.includes('\\')) return true;
  if (target.startsWith('.') || target.startsWith('~')) return true;
  return HAS_EXTENSION.test(path.basename(target));
}

/**
 * Resolve a local file plus an optional `--type` to the destination that opens
 * it, or refuse with a sentence naming what would have worked.
 */
export function routeLocalFile(filePath: string, type?: string): Destination {
  const extension = path.extname(filePath).toLowerCase();
  const route = ROUTES.find((candidate) => candidate.extensions.includes(extension));

  if (type !== undefined) {
    if (!isPreviewDestination(type)) {
      throw new CliError(
        `unknown --type "${type}" for a file — one of ${PREVIEW_DESTINATIONS.join(', ')}`,
      );
    }
    const destination = DESTINATIONS[type];
    if (!route || !route.destinations.includes(type)) {
      throw new CliError(
        `--type ${type} presents ${destination.presents} — ` +
          `${destination.extensions.join(', ')} — not ${extension || 'a file with no extension'}`,
      );
    }
    return destination;
  }

  if (!route) {
    throw new CliError(
      `bifrost preview opens ${PREVIEWABLE_EXTENSIONS.join(', ')} files from disk — ` +
        `not ${extension || 'a file with no extension'}`,
    );
  }
  if (route.fallback === null) {
    throw new CliError(
      `${extension} files have no default view yet — ` +
        `pass --type ${route.destinations.join(' or --type ')} to choose one`,
    );
  }
  return DESTINATIONS[route.fallback];
}
