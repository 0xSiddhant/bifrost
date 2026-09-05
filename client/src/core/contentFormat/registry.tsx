import { validateYaml, parseDocuments } from '../yaml';
import { parseXml } from '../xml';
import { putAtlasSeed } from '../atlasSeed';
import { putEddaSeed } from '../eddaSeed';
import { putGrootSeed } from '../grootSeed';
import { putRunestoneSeed } from '../runestoneSeed';
import { BracesIcon, DocFileIcon, GlobeIcon, TreeIcon } from '../ui/icons';
import { looksLikeMarkdown } from './markdownHeuristic';
import type { ContentFormatEntry } from './types';

/**
 * The content-format registry behind Brotli's "Open in <tool>" offer (PLAN-25),
 * built to the shape `core/library/registry.tsx` already proved twice: Groot
 * and Atlas each joined the Pensieve as one array element and no page changed.
 * A fifth format here is the same — one element, no page change.
 *
 * Everything below runs **client-side, on bytes the browser already holds**.
 * The Brotli server never looks inside what it moves, the same posture Groot
 * states for YAML and Atlas for XML.
 */

const jsonEntry: ContentFormatEntry = {
  kind: 'json',
  label: 'JSON',
  toolName: 'Runestone',
  module: 'runestone',
  route: '/runestone',
  icon: <BracesIcon size={14} />,
  test: (text) => {
    try {
      const value: unknown = JSON.parse(text);
      // A bare scalar is valid JSON and never what "open this in Runestone"
      // should fire for — `"hello"` is a string that happens to parse.
      return typeof value === 'object' && value !== null;
    } catch {
      // Ordinary control flow: "not JSON" is this function's whole answer.
      return false;
    }
  },
  seed: (text) => putRunestoneSeed({ title: '', text }),
};

const xmlEntry: ContentFormatEntry = {
  kind: 'xml',
  label: 'XML',
  toolName: 'Atlas',
  module: 'atlas',
  route: '/atlas',
  icon: <GlobeIcon size={14} />,
  // `parseXml`'s own issue check is already the namespace-scoped `parsererror`
  // detection PLAN-23 built and pinned, so this inherits that correctness
  // instead of re-solving it. XML needs a root element to parse at all, so
  // unlike JSON there is no bare-scalar case left to exclude.
  test: (text) => parseXml(text).issue === null,
  seed: (text) => putAtlasSeed({ title: '', text }),
};

const yamlEntry: ContentFormatEntry = {
  kind: 'yaml',
  label: 'YAML',
  toolName: 'Groot',
  module: 'groot',
  route: '/groot',
  icon: <TreeIcon size={14} />,
  test: (text) => {
    if (text.trim() === '' || validateYaml(text).length > 0) return false;
    // Same "is the root a container" discrimination Groot's own tree view does.
    // This is the weakest of the three real signals and worth saying so: a chat
    // log written as `Name: message` per line *is* a YAML mapping and will
    // match. Accepted as residual fuzziness rather than papered over, the same
    // way Groot's advisory rail accepts the Norway Problem.
    return parseDocuments(text).some((document) => {
      const value = document.value;
      return typeof value === 'object' && value !== null;
    });
  },
  seed: (text) => putGrootSeed({ title: '', text }),
};

const markdownEntry: ContentFormatEntry = {
  kind: 'markdown',
  label: 'Markdown',
  toolName: 'Edda',
  module: 'edda',
  route: '/edda',
  icon: <DocFileIcon size={14} />,
  test: looksLikeMarkdown,
  seed: (text) => putEddaSeed({ title: '', text }),
};

/**
 * Order is rigid → fuzzy, and first match wins. It settles two real overlaps,
 * both the same way — the entry with a real parser behind it beats the one
 * relying on a heuristic:
 *
 * - JSON is valid YAML 1.2, so JSON-shaped content passes the YAML test too.
 *   Checking JSON first offers it to Runestone (the specific, correct read).
 * - A Markdown document of nothing but a heading and a bullet list is *also* a
 *   valid YAML sequence with a comment on top, so it is offered to Groot. Real
 *   Markdown reaches its own entry anyway: a prose paragraph makes the YAML
 *   root a plain scalar (which the YAML entry refuses) and a fenced code block
 *   fails the YAML parse outright.
 */
export const CONTENT_FORMATS: readonly ContentFormatEntry[] = [
  jsonEntry,
  xmlEntry,
  yamlEntry,
  markdownEntry,
];

/** The first format this text really looks like, or null — no fallback guess. */
export function detectFormat(
  text: string,
  registry: readonly ContentFormatEntry[] = CONTENT_FORMATS,
): ContentFormatEntry | null {
  return registry.find((entry) => entry.test(text)) ?? null;
}

/** The formats this deploy profile actually serves, mirroring `availableKinds`. */
export function availableFormats(
  registry: readonly ContentFormatEntry[],
  hasModule: (module: string) => boolean,
): ContentFormatEntry[] {
  return registry.filter((entry) => hasModule(entry.module));
}
