import { useState } from 'react';
import { formatJsonPath } from '../json';
import { ChevronRightIcon } from './icons';

/**
 * Read-only explorer for a parsed JSON document (PLAN-07): collapsible nodes,
 * type badges, item counts. Tapping a key copies its JSON path, tapping a
 * primitive value copies the value itself — editing happens in code mode only.
 * Expand all / Collapse all fold or unfold the whole tree (incl. the outermost
 * array/object) in one action; per-node toggles still work between bulk actions.
 */

interface TreeViewProps {
  value: unknown;
  onCopyPath: (path: string) => void;
  onCopyValue: (value: string) => void;
  /**
   * Optional per-node label, looked up by the node's own path string. Groot uses
   * it to badge an alias (`*base`): the tree renders **resolved** values, as
   * every YAML consumer sees them, so without a badge an aliased subtree is
   * indistinguishable from a hand-written copy of another one. Undefined for
   * every consumer that has nothing to say, which is all of them but Groot.
   */
  annotationAt?: (path: string) => string | undefined;
}

const MAX_STRING_PREVIEW = 160;

/** How a node decides its initial open state at mount (bulk actions remount). */
type OpenMode = 'auto' | 'all' | 'none';

function defaultOpen(mode: OpenMode, depth: number): boolean {
  if (mode === 'all') return true;
  if (mode === 'none') return false;
  return depth < 2;
}

type Kind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

function kindOf(value: unknown): Kind {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value as Kind;
}

function primitiveLabel(value: unknown): string {
  if (typeof value === 'string') {
    return value.length > MAX_STRING_PREVIEW
      ? JSON.stringify(`${value.slice(0, MAX_STRING_PREVIEW)}…`)
      : JSON.stringify(value);
  }
  return String(value);
}

/** What lands on the clipboard: the whole value, never the truncated preview. */
function copyableValue(value: unknown): string {
  return typeof value === 'string' ? value : String(value);
}

function countLabel(value: object): string {
  if (Array.isArray(value)) {
    return value.length === 1 ? '1 item' : `${value.length} items`;
  }
  const size = Object.keys(value).length;
  return size === 1 ? '1 key' : `${size} keys`;
}

interface TreeNodeProps {
  name: string | number | null;
  value: unknown;
  path: (string | number)[];
  depth: number;
  openMode: OpenMode;
  onCopyPath: (path: string) => void;
  onCopyValue: (value: string) => void;
  annotationAt?: (path: string) => string | undefined;
}

function TreeNode({
  name,
  value,
  path,
  depth,
  openMode,
  onCopyPath,
  onCopyValue,
  annotationAt,
}: TreeNodeProps) {
  const kind = kindOf(value);
  const container = kind === 'object' || kind === 'array';
  // Initialised once per mount; a bulk action bumps the tree key to remount,
  // which re-reads openMode here (and for every descendant).
  const [open, setOpen] = useState(() => defaultOpen(openMode, depth));
  const pathString = formatJsonPath(path);
  const annotation = annotationAt?.(pathString);

  const keyButton = (
    <>
      <button
        type="button"
        className="rune-tree__key"
        title="Copy JSON path"
        onClick={() => onCopyPath(pathString)}
      >
        {name === null ? '$' : typeof name === 'number' ? `[${name}]` : name}
      </button>
      {annotation && <span className="rune-tree__note">{annotation}</span>}
    </>
  );

  if (!container) {
    return (
      <div className="rune-tree__row" style={{ '--tree-depth': depth } as React.CSSProperties}>
        <span className="rune-tree__spacer" aria-hidden="true" />
        {keyButton}
        <button
          type="button"
          className={`rune-tree__value rune-tree__value--${kind}`}
          title="Copy value"
          onClick={() => onCopyValue(copyableValue(value))}
        >
          {primitiveLabel(value)}
        </button>
        <span className="rune-tree__badge">{kind}</span>
      </div>
    );
  }

  const entries: [string | number, unknown][] = Array.isArray(value)
    ? value.map((child, index) => [index, child] as [number, unknown])
    : Object.entries(value as Record<string, unknown>);

  return (
    <div>
      <div className="rune-tree__row" style={{ '--tree-depth': depth } as React.CSSProperties}>
        <button
          type="button"
          className={`rune-tree__toggle${open ? ' rune-tree__toggle--open' : ''}`}
          aria-label={open ? 'Collapse' : 'Expand'}
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <ChevronRightIcon size={14} />
        </button>
        {keyButton}
        <span className="rune-tree__badge">{kind}</span>
        <span className="rune-tree__count">{countLabel(value as object)}</span>
      </div>
      {open &&
        entries.map(([childName, child]) => (
          <TreeNode
            key={String(childName)}
            name={childName}
            value={child}
            path={[...path, childName]}
            depth={depth + 1}
            openMode={openMode}
            onCopyPath={onCopyPath}
            onCopyValue={onCopyValue}
            annotationAt={annotationAt}
          />
        ))}
    </div>
  );
}

export function TreeView({ value, onCopyPath, onCopyValue, annotationAt }: TreeViewProps) {
  const [openMode, setOpenMode] = useState<OpenMode>('auto');
  // Bumped on every bulk action so the node subtree remounts and every node
  // re-initialises its open state from the new mode — no per-node effects.
  const [gen, setGen] = useState(0);

  const setAll = (mode: OpenMode) => {
    setOpenMode(mode);
    setGen((current) => current + 1);
  };

  return (
    <div className="rune-tree" role="tree">
      <div className="rune-tree__controls">
        <button type="button" className="rune-tree__ctl" onClick={() => setAll('all')}>
          Expand all
        </button>
        <button type="button" className="rune-tree__ctl" onClick={() => setAll('none')}>
          Collapse all
        </button>
      </div>
      <TreeNode
        key={gen}
        name={null}
        value={value}
        path={[]}
        depth={0}
        openMode={openMode}
        onCopyPath={onCopyPath}
        onCopyValue={onCopyValue}
        annotationAt={annotationAt}
      />
    </div>
  );
}
