import type { ReactNode } from 'react';
import { useCapabilities } from '../../core/useCapabilities';
import { Portal } from '../../core/ui/Portal';
import {
  ArchiveFileIcon,
  BookmarkIcon,
  BracesIcon,
  CodeIcon,
  DiffIcon,
  DocFileIcon,
  GlobeIcon,
  TreeIcon,
} from '../../core/ui/icons';

/**
 * Ollivanders — the developer tools category ("the tool chooses the maker").
 * A hub of portals for the structured-text tools; each links to its own page.
 *
 * Card colour follows **position**: each visible portal takes the next card-tone
 * slot (1, 2, 3 … wrapping after the last). Reorder this list and the colours
 * reorder with it — no per-card colour is hardcoded.
 */
interface Tool {
  /** Shows when **any** of these modules is loaded. Most tools name one; the
   *  Pensieve is a shell over several, so it appears if any kind exists. */
  modules: string[];
  to: string;
  icon: ReactNode;
  title: string;
  description: string;
  go: string;
}

const TOOLS: Tool[] = [
  {
    modules: ['runestone'],
    to: '/runestone',
    icon: <BracesIcon size={24} />,
    title: 'Runestone',
    description: 'Validate, explore, and shape JSON — code and tree views, saved to the Pensieve.',
    go: 'carve the runes',
  },
  {
    modules: ['variant'],
    to: '/variant',
    icon: <DiffIcon size={24} />,
    title: 'Variant',
    description: 'Compare two JSON or text documents structurally, side by side, and jump between the differences.',
    go: 'find the divergence',
  },
  {
    modules: ['edda'],
    to: '/edda',
    icon: <DocFileIcon size={24} />,
    title: 'Edda',
    description: 'A Markdown workspace with live preview and its own library — write, save, and share rendered pages.',
    go: 'tell the saga',
  },
  {
    modules: ['loki'],
    to: '/loki',
    icon: <CodeIcon size={24} />,
    title: 'Loki',
    description: 'A JavaScript shapeshifter — beautify, minify, and transform code, test regex, and run snippets in a sandbox.',
    go: 'change the shape',
  },
  {
    // The one library over every document kind (PLAN-21). It owns no module of
    // its own — it is a shell over the tools above, so it appears whenever any
    // of them does, and the registry decides which types it can list.
    modules: ['runestone', 'edda', 'groot', 'atlas'],
    to: '/pensieve',
    icon: <BookmarkIcon size={24} />,
    title: 'Pensieve',
    description: 'Every saved document in one basin — JSON, Markdown and more, searchable across all of them.',
    go: 'surface a memory',
  },
  {
    // Appended, not slotted in beside the other editors: colour follows
    // position, so inserting Groot mid-list would silently recolour Loki and
    // the Pensieve on a page people already know by its colours.
    modules: ['groot'],
    to: '/groot',
    icon: <TreeIcon size={24} />,
    title: 'Groot',
    description:
      'A YAML workspace — folding, comment-preserving formatting, a tree view, and advisories for the traps YAML hides in plain sight.',
    go: 'branch by branch',
  },
  {
    // Appended for the same reason Groot was: colour follows position, so
    // slotting Atlas in beside the other editors would silently recolour every
    // card after it on a page people already know by its colours.
    modules: ['atlas'],
    to: '/atlas',
    icon: <GlobeIcon size={24} />,
    title: 'Atlas',
    description:
      'An XML workspace — format, minify and fold any document; an Apple property list also opens as an editable, Xcode-shaped table.',
    go: 'hold the structure',
  },
  {
    // Appended for the same reason Groot and Atlas were: colour follows
    // position, so slotting Brotli in beside the editors would silently
    // recolour every card after it on a page people know by its colours.
    modules: ['brotli'],
    to: '/brotli',
    icon: <ArchiveFileIcon size={24} />,
    title: 'Brotli',
    description:
      'Squeeze text or a file down with Brotli, or open a .br back up — with a gzip comparison, and a way straight into whichever editor the result turns out to suit.',
    go: 'squeeze it down',
  },
];

export function OllivandersPage() {
  const { capabilities } = useCapabilities();
  const has = (module: string) => !capabilities || capabilities.modules.includes(module);
  const tools = TOOLS.filter((tool) => tool.modules.some(has));

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow eyebrow--violet">ollivanders · the tool chooses the maker</span>
          <h2>Ollivanders</h2>
          <p>Instruments for shaping data and documents. Pick the one that fits the job.</p>
        </div>
      </div>

      <div className="portals">
        {tools.map((tool, index) => (
          <Portal key={tool.to} tone={index + 1} {...tool} />
        ))}
      </div>
    </>
  );
}
