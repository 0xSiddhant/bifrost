import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  addEntryChange,
  isContainerType,
  keyChange,
  nodeAtPath,
  PLIST_TYPES,
  PLIST_TYPE_LABEL,
  removeEntryChange,
  reorderChange,
  typeChange,
  valueChange,
  type PlistNode,
  type PlistType,
  type XmlChange,
} from '../xml/plist';
import { DisclosureIcon, GripIcon, MinusIcon, PlusIcon, StepperIcon } from './icons';

/**
 * The editable, Xcode-shaped property list table (PLAN-23).
 *
 * Not a `TreeView` extension: `TreeView` renders a read-only JS value, and this
 * shows *declared XML types* and writes back to the document. What it renders
 * is a flattened `PlistNode` tree; what it emits is one `XmlChange` per edit,
 * which the page dispatches as a real CodeMirror transaction against the same
 * buffer the code pane shows. That is the whole reason there is no second
 * source of truth and no second undo stack: an edit here and a keystroke there
 * land in one history.
 *
 * Layout follows the reference screenshot rather than a generic table: a
 * `Key | Type | Value` header, a shaded root group row carrying the document's
 * title, an item count and a "+", plain indented leaf rows below it, and the
 * stepper-chevron control on Type and Value — a bare `<select>` would work and
 * would not read as the Xcode editor, which was the ask.
 */

/**
 * One edit, as an *intent* rather than a computed replacement.
 *
 * The table renders from a debounced analysis, so its spans describe the buffer
 * as it was up to 300ms ago. Handing the page a ready-made `{from, to}` would
 * mean a click landing just after a keystroke wrote bytes at the wrong offsets.
 * Instead the page re-parses when the buffer has moved, finds the node again by
 * `path`, and calls `apply` — so the offsets are always the live ones.
 */
export interface PlistEdit {
  /** The node this applies to — the *container* for an add or a reorder. */
  path: readonly number[];
  apply: (node: PlistNode, text: string, indentUnit: string) => XmlChange | null;
}

export interface PlistTableProps {
  root: PlistNode;
  /** Shown on the root group row, where Xcode shows the file's name. */
  title: string;
  /** Commit one edit. The page turns it into an editor transaction. */
  onEdit: (edit: PlistEdit) => void;
  /** Reveal a node's source in the code pane (click-to-jump). */
  onReveal: (offset: number) => void;
}

const pathKey = (path: readonly number[]): string => path.join('.');

interface Row {
  node: PlistNode;
  depth: number;
  key: string;
  /** The container this row sits in, and where — null for the root. */
  parent: PlistNode | null;
  index: number;
}

function flatten(
  node: PlistNode,
  expanded: ReadonlySet<string>,
  depth: number,
  parent: PlistNode | null,
  index: number,
  out: Row[],
): void {
  const key = pathKey(node.path);
  out.push({ node, depth, key, parent, index });
  if (!isContainerType(node.type) || !expanded.has(key)) return;
  node.children.forEach((child, childIndex) => {
    flatten(child, expanded, depth + 1, node, childIndex, out);
  });
}

function itemCount(node: PlistNode): string {
  const count = node.children.length;
  return `(${count} ${count === 1 ? 'item' : 'items'})`;
}

/** base64 length → decoded byte count, without decoding a megabyte to count it. */
export function base64Bytes(value: string): number {
  const compact = value.replace(/\s+/g, '');
  if (compact === '') return 0;
  const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
  return Math.max(0, (compact.length / 4) * 3 - padding);
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/**
 * `<date>` is stored as UTC and `<input type="datetime-local">` speaks local
 * time, so the two conversions below are a real timezone round trip, not a
 * string reformat — showing the stored UTC digits in a local-time picker would
 * silently shift every date by the viewer's offset.
 */
export function plistDateToLocalInput(value: string): string {
  const at = Date.parse(value.trim());
  if (Number.isNaN(at)) return '';
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function localInputToPlistDate(value: string): string | null {
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  return `${new Date(at).toISOString().slice(0, 19)}Z`;
}

/** Step a scalar by one: booleans flip, numbers ±1, dates ±1 day. */
export function stepValue(type: PlistType, value: string, direction: 1 | -1): string | null {
  switch (type) {
    case 'boolean':
      return String(value !== 'true');
    case 'integer': {
      const parsed = Number.parseInt(value.trim(), 10);
      return String((Number.isFinite(parsed) ? parsed : 0) + direction);
    }
    case 'real': {
      const parsed = Number.parseFloat(value.trim());
      return String((Number.isFinite(parsed) ? parsed : 0) + direction);
    }
    case 'date': {
      const at = Date.parse(value.trim());
      if (Number.isNaN(at)) return null;
      return `${new Date(at + direction * 86_400_000).toISOString().slice(0, 19)}Z`;
    }
    default:
      // A string or a blob has no next value; the control stays visible and
      // disabled rather than inventing one.
      return null;
  }
}

function encodeBase64(bytes: Uint8Array): string {
  // Chunked: `String.fromCharCode(...bytes)` blows the argument limit on
  // anything past a few hundred kilobytes, which is exactly the size a person
  // imports into a <data> field.
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

interface Editing {
  key: string;
  field: 'key' | 'value';
  draft: string;
}

interface Dragging {
  /** Path of the row being dragged. */
  key: string;
  parent: PlistNode;
  from: number;
  /** Where it would land if released now. */
  to: number;
}

export function PlistTable({ root, title, onEdit, onReveal }: PlistTableProps) {
  // Root open, nested containers closed — Xcode's own opening state.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(['']));
  const [editing, setEditing] = useState<Editing | null>(null);
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingDataPath = useRef<readonly number[] | null>(null);

  const rows: Row[] = [];
  flatten(root, expanded, 0, null, 0, rows);

  const toggle = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const emit = (path: readonly number[], apply: PlistEdit['apply']) => onEdit({ path, apply });

  const commitEdit = () => {
    if (!editing) return;
    const path = editing.key === '' ? [] : editing.key.split('.').map(Number);
    const node = nodeAtPath(root, path);
    const { field, draft } = editing;
    setEditing(null);
    if (!node) return;
    if (field === 'key') {
      // A rename that collides is allowed through: XML does not forbid a
      // duplicate <key>, every reader takes the last one, and the advisory rail
      // already says so. A blocking dialog here would be a second, worse copy
      // of that rule.
      if ((node.key ?? '') !== draft) emit(path, (fresh) => keyChange(fresh, draft));
    } else if (node.value !== draft) {
      emit(path, (fresh) => valueChange(fresh, draft));
    }
  };

  const onDataFile = async (file: File, path: readonly number[]) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const encoded = encodeBase64(bytes);
    emit(path, (fresh) => valueChange(fresh, encoded));
  };

  // Pointer-based drag, the split-panel divider's mechanism rather than native
  // HTML5 DnD: this drags a row *within* the page, and native DnD in this
  // codebase is reserved for OS files dropped *onto* it.
  const onHandleDown = (event: ReactPointerEvent<HTMLButtonElement>, row: Row) => {
    if (!row.parent) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging({ key: row.key, parent: row.parent, from: row.index, to: row.index });
  };

  const onHandleMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragging) return;
    const y = event.clientY;
    let target = dragging.to;
    dragging.parent.children.forEach((sibling, index) => {
      const element = rowRefs.current.get(pathKey(sibling.path));
      if (!element) return;
      const rect = element.getBoundingClientRect();
      if (y >= rect.top && y <= rect.bottom) target = index;
      else if (index === 0 && y < rect.top) target = 0;
      else if (index === dragging.parent.children.length - 1 && y > rect.bottom) target = index;
    });
    if (target !== dragging.to) setDragging({ ...dragging, to: target });
  };

  const onHandleUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (dragging) {
      const { parent, from, to } = dragging;
      emit(parent.path, (fresh, source) => reorderChange(fresh, from, to, source));
    }
    setDragging(null);
  };

  const renderValue = (row: Row) => {
    const { node } = row;
    if (isContainerType(node.type)) {
      return <span className="plist-count caption">{itemCount(node)}</span>;
    }
    const isEditing = editing?.key === row.key && editing.field === 'value';

    if (node.type === 'boolean') {
      // Apple's own convention: <true/> and <false/> read as the words YES and
      // NO here, never as a checkbox or a switch.
      return (
        <button
          type="button"
          className="plist-bool"
          onClick={() => emit(node.path, (fresh) => valueChange(fresh, String(fresh.value !== 'true')))}
          title="Toggle"
        >
          {node.value === 'true' ? 'YES' : 'NO'}
        </button>
      );
    }

    if (node.type === 'data') {
      const bytes = base64Bytes(node.value);
      return (
        <span className="plist-data">
          <span className="caption">
            {bytes} {bytes === 1 ? 'byte' : 'bytes'}
          </span>
          <button
            type="button"
            className="plist-linkbtn"
            onClick={() => {
              pendingDataPath.current = node.path;
              fileInputRef.current?.click();
            }}
          >
            Import…
          </button>
        </span>
      );
    }

    if (node.type === 'date') {
      return (
        <input
          className="plist-input"
          type="datetime-local"
          step={1}
          aria-label="Value"
          value={
            isEditing ? editing.draft : plistDateToLocalInput(node.value)
          }
          onChange={(event) =>
            setEditing({ key: row.key, field: 'value', draft: event.target.value })
          }
          onBlur={() => {
            if (!isEditing) return;
            const iso = localInputToPlistDate(editing.draft);
            setEditing(null);
            if (iso && iso !== node.value) emit(node.path, (fresh) => valueChange(fresh, iso));
          }}
        />
      );
    }

    return (
      <input
        className="plist-input"
        type="text"
        inputMode={node.type === 'integer' || node.type === 'real' ? 'decimal' : undefined}
        aria-label="Value"
        value={isEditing ? editing.draft : node.value}
        onChange={(event) =>
          setEditing({ key: row.key, field: 'value', draft: event.target.value })
        }
        // Committed on blur and Enter, never per keystroke: a transaction per
        // character would flood the undo history and re-flow the code pane on
        // every letter typed.
        onBlur={commitEdit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') setEditing(null);
        }}
      />
    );
  };

  const renderKeyCell = (row: Row) => {
    const { node } = row;
    if (row.depth === 0) return <span className="plist-rootname">{title || 'Root'}</span>;
    if (!row.parent || row.parent.type === 'array') {
      return (
        <button type="button" className="plist-keybtn" onClick={() => onReveal(node.span.start)}>
          <span className="plist-itemname">Item {row.index}</span>
        </button>
      );
    }
    if (editing?.key === row.key && editing.field === 'key') {
      return (
        <input
          className="plist-input plist-input--key"
          autoFocus
          aria-label="Key"
          value={editing.draft}
          onChange={(event) => setEditing({ ...editing, draft: event.target.value })}
          onBlur={commitEdit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') setEditing(null);
          }}
        />
      );
    }
    // Single click jumps the code pane to this node's source; **double** click
    // starts editing. Xcode behaves the same way, and it is what lets a click
    // on a key be a navigation rather than an accidental edit.
    return (
      <button
        type="button"
        className="plist-keybtn"
        onClick={() => onReveal(node.span.start)}
        onDoubleClick={() => setEditing({ key: row.key, field: 'key', draft: node.key ?? '' })}
        title="Click to find it in the code · double-click to rename"
      >
        {node.key || <span className="plist-itemname">(empty key)</span>}
      </button>
    );
  };

  const changeType = (row: Row, next: PlistType) => {
    emit(row.node.path, (fresh) => (next === fresh.type ? null : typeChange(fresh, next)));
  };

  const stepValueBy = (row: Row, direction: 1 | -1) => {
    emit(row.node.path, (fresh) => {
      const next = stepValue(fresh.type, fresh.value, direction);
      return next === null ? null : valueChange(fresh, next);
    });
  };

  return (
    <div className="plist-table" role="table" aria-label="Property list">
      <div className="plist-row plist-row--head" role="row">
        <span className="plist-cell plist-cell--key" role="columnheader">
          Key
        </span>
        <span className="plist-cell plist-cell--type" role="columnheader">
          Type
        </span>
        <span className="plist-cell plist-cell--value" role="columnheader">
          Value
        </span>
        <span className="plist-cell plist-cell--actions" role="columnheader" aria-label="Actions" />
      </div>

      {rows.map((row) => {
        const { node } = row;
        const isRoot = row.depth === 0;
        const container = isContainerType(node.type);
        const open = expanded.has(row.key);
        const classes = ['plist-row'];
        if (isRoot) classes.push('plist-row--root');
        if (dragging?.key === row.key) classes.push('is-dragging');
        if (
          dragging &&
          dragging.key !== row.key &&
          row.parent === dragging.parent &&
          row.index === dragging.to
        ) {
          classes.push('is-drop-target');
        }

        return (
          <div
            key={row.key}
            role="row"
            className={classes.join(' ')}
            ref={(element) => {
              if (element) rowRefs.current.set(row.key, element);
              else rowRefs.current.delete(row.key);
            }}
          >
            <span
              className="plist-cell plist-cell--key"
              role="cell"
              style={{ paddingLeft: `calc(var(--space-2) + ${row.depth} * 1.1rem)` }}
            >
              {container ? (
                <button
                  type="button"
                  className={`plist-disclosure${open ? ' is-open' : ''}`}
                  aria-expanded={open}
                  aria-label={open ? 'Collapse' : 'Expand'}
                  onClick={() => toggle(row.key)}
                >
                  <DisclosureIcon size={12} />
                </button>
              ) : (
                <span className="plist-disclosure plist-disclosure--empty" aria-hidden="true" />
              )}
              {renderKeyCell(row)}
            </span>

            <span className="plist-cell plist-cell--type" role="cell">
              {isRoot ? (
                // The root's type is not changeable — a plist's body is
                // whatever it is, and Xcode disables the control too.
                <span className="plist-typelabel is-disabled">{PLIST_TYPE_LABEL[node.type]}</span>
              ) : (
                // A popup, not a stepper. Xcode's own Type control wears the
                // ⌃⌄ glyph and opens a menu, and stepping eight types one
                // chevron-click at a time is slow enough to be the wrong
                // control however right it looks. A native `<select>` keeps
                // the glyph, and brings keyboard navigation, type-ahead and a
                // real picker on a phone with it.
                <span className="plist-typeselect">
                  <select
                    className="plist-typeselect__input"
                    aria-label={`Type of ${node.key ?? `item ${row.index}`}`}
                    value={node.type}
                    onChange={(event) => changeType(row, event.target.value as PlistType)}
                  >
                    {PLIST_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {PLIST_TYPE_LABEL[type]}
                      </option>
                    ))}
                  </select>
                  <StepperIcon size={16} />
                </span>
              )}
            </span>

            <span className="plist-cell plist-cell--value" role="cell">
              {isRoot ? (
                <span className="plist-count caption">{itemCount(node)}</span>
              ) : (
                <>
                  {renderValue(row)}
                  <Stepper
                    label={`Step the value of ${node.key ?? `item ${row.index}`}`}
                    disabled={stepValue(node.type, node.value, 1) === null}
                    onStep={(direction) => stepValueBy(row, direction)}
                  />
                </>
              )}
            </span>

            <span className="plist-cell plist-cell--actions" role="cell">
              {container && (
                <button
                  type="button"
                  className="plist-action"
                  aria-label="Add an entry"
                  title="Add an entry"
                  onClick={() => {
                    setExpanded((current) => new Set(current).add(row.key));
                    emit(node.path, (fresh, source, unit) => addEntryChange(fresh, source, unit));
                  }}
                >
                  <PlusIcon size={13} />
                </button>
              )}
              {!isRoot && (
                <>
                  <button
                    type="button"
                    className="plist-action"
                    aria-label="Delete this entry"
                    title="Delete this entry"
                    onClick={() => emit(node.path, (fresh, source) => removeEntryChange(fresh, source))}
                  >
                    <MinusIcon size={13} />
                  </button>
                  <button
                    type="button"
                    className="plist-action plist-grip"
                    aria-label="Drag to reorder"
                    title="Drag to reorder"
                    onPointerDown={(event) => onHandleDown(event, row)}
                    onPointerMove={onHandleMove}
                    onPointerUp={onHandleUp}
                  >
                    <GripIcon size={13} />
                  </button>
                </>
              )}
            </span>
          </div>
        );
      })}

      <input
        ref={fileInputRef}
        type="file"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          const path = pendingDataPath.current;
          event.target.value = '';
          pendingDataPath.current = null;
          if (file && path) void onDataFile(file, path);
        }}
      />
    </div>
  );
}

/**
 * Xcode's ⌃⌄ control: one glyph, two hit targets. Reproduced closely because a
 * plain `<select>` — which would work — is the single thing that would stop the
 * table reading as the Property List editor.
 */
function Stepper({
  label,
  disabled = false,
  onStep,
}: {
  label: string;
  disabled?: boolean;
  onStep: (direction: 1 | -1) => void;
}) {
  return (
    <span className={`plist-stepper${disabled ? ' is-disabled' : ''}`} aria-hidden={disabled}>
      <StepperIcon size={16} />
      <button
        type="button"
        className="plist-stepper__half plist-stepper__half--up"
        disabled={disabled}
        aria-label={`${label} — previous`}
        onClick={() => onStep(-1)}
      />
      <button
        type="button"
        className="plist-stepper__half plist-stepper__half--down"
        disabled={disabled}
        aria-label={`${label} — next`}
        onClick={() => onStep(1)}
      />
    </span>
  );
}
