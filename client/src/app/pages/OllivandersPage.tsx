import type { ReactNode } from 'react';
import { useCapabilities } from '../../core/useCapabilities';
import { Portal } from '../../core/ui/Portal';
import { BracesIcon, CodeIcon, DiffIcon, DocFileIcon } from '../../core/ui/icons';

/**
 * Ollivanders — the developer tools category ("the tool chooses the maker").
 * A hub of portals for the structured-text tools; each links to its own page.
 *
 * Card colour follows **position**: each visible portal takes the next card-tone
 * slot (1, 2, 3 … wrapping after the last). Reorder this list and the colours
 * reorder with it — no per-card colour is hardcoded.
 */
interface Tool {
  module: string;
  to: string;
  icon: ReactNode;
  title: string;
  description: string;
  go: string;
}

const TOOLS: Tool[] = [
  {
    module: 'runestone',
    to: '/runestone',
    icon: <BracesIcon size={24} />,
    title: 'Runestone',
    description: 'Validate, explore, and shape JSON — code and tree views, saved to the Pensieve.',
    go: 'carve the runes',
  },
  {
    module: 'variant',
    to: '/variant',
    icon: <DiffIcon size={24} />,
    title: 'Variant',
    description: 'Compare two JSON or text documents structurally, side by side, and jump between the differences.',
    go: 'find the divergence',
  },
  {
    module: 'edda',
    to: '/edda',
    icon: <DocFileIcon size={24} />,
    title: 'Edda',
    description: 'A Markdown workspace with live preview and its own library — write, save, and share rendered pages.',
    go: 'tell the saga',
  },
  {
    module: 'loki',
    to: '/loki',
    icon: <CodeIcon size={24} />,
    title: 'Loki',
    description: 'A JavaScript shapeshifter — beautify, minify, and transform code, test regex, and run snippets in a sandbox.',
    go: 'change the shape',
  },
];

export function OllivandersPage() {
  const { capabilities } = useCapabilities();
  const has = (module: string) => !capabilities || capabilities.modules.includes(module);
  const tools = TOOLS.filter((tool) => has(tool.module));

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
          <Portal key={tool.module} tone={index + 1} {...tool} />
        ))}
      </div>
    </>
  );
}
