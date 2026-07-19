import { useState } from 'react';
import { formatJsonPath } from '../../core/json';
import { ChevronRightIcon } from '../../core/ui/icons';

/**
 * Read-only explorer for a parsed JSON document (PLAN-07): collapsible nodes,
 * type badges, item counts. Tapping a key copies its JSON path — editing
 * happens in code mode only.
 */

interface TreeViewProps {
  value: unknown;
  onCopyPath: (path: string) => void;
}

const MAX_STRING_PREVIEW = 160;

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
  onCopyPath: (path: string) => void;
}

function TreeNode({ name, value, path, depth, onCopyPath }: TreeNodeProps) {
  const kind = kindOf(value);
  const container = kind === 'object' || kind === 'array';
  const [open, setOpen] = useState(depth < 2);

  const keyButton = (
    <button
      type="button"
      className="rune-tree__key"
      title="Copy JSON path"
      onClick={() => onCopyPath(formatJsonPath(path))}
    >
      {name === null ? '$' : typeof name === 'number' ? `[${name}]` : name}
    </button>
  );

  if (!container) {
    return (
      <div className="rune-tree__row" style={{ '--tree-depth': depth } as React.CSSProperties}>
        <span className="rune-tree__spacer" aria-hidden="true" />
        {keyButton}
        <span className={`rune-tree__value rune-tree__value--${kind}`}>
          {primitiveLabel(value)}
        </span>
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
            onCopyPath={onCopyPath}
          />
        ))}
    </div>
  );
}

export function TreeView({ value, onCopyPath }: TreeViewProps) {
  return (
    <div className="rune-tree" role="tree">
      <TreeNode name={null} value={value} path={[]} depth={0} onCopyPath={onCopyPath} />
    </div>
  );
}
