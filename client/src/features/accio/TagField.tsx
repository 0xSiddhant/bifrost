import { useId, useRef, useState } from 'react';
import { applySuggestion, suggestFor } from './tagInput';

interface TagFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Every tag already on the shelf — the suggestion pool. */
  known: readonly string[];
  placeholder?: string;
  /** Fired on Enter when no suggestion is highlighted (the add bar submits). */
  onSubmit?: () => void;
}

/**
 * The comma-separated tag input, with suggestions drawn from the tags already
 * on the shelf. Focusing or clicking the field offers the whole list; typing
 * narrows it to the fragment after the last comma. Deliberately not a
 * `<datalist>`: that matches against the entire field value, so it stops
 * suggesting the moment the field holds more than one tag.
 */
export function TagField({ label, value, onChange, known, placeholder, onSubmit }: TagFieldProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  // A suggestion is picked on mousedown, which fires before blur — without
  // that ordering the list would close before the click ever landed.
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = suggestFor(value, known);
  const visible = open && suggestions.length > 0;

  const pick = (tag: string) => {
    onChange(applySuggestion(value, tag));
    setActive(-1);
    // Stay open: picking a tag usually means picking another, and the list has
    // already dropped the one just taken.
    setOpen(true);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && visible) {
      event.stopPropagation();
      setOpen(false);
      setActive(-1);
      return;
    }
    if (event.key === 'ArrowDown' && suggestions.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((index) => (index + 1) % suggestions.length);
      return;
    }
    if (event.key === 'ArrowUp' && suggestions.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
      return;
    }
    if (event.key === 'Enter') {
      const chosen = visible && active >= 0 ? suggestions[active] : undefined;
      if (chosen) {
        // Enter completes the highlighted suggestion instead of submitting —
        // otherwise picking a tag by keyboard would also save the link.
        event.preventDefault();
        pick(chosen);
        return;
      }
      onSubmit?.();
    }
  };

  return (
    <div className="field tag-field">
      <span className="field__label">{label}</span>
      <input
        ref={inputRef}
        className="field__input"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={visible}
        aria-controls={visible ? listId : undefined}
        onChange={(event) => {
          onChange(event.target.value);
          setActive(-1);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
      />
      {visible && (
        <ul className="tag-suggest" id={listId} role="listbox">
          {suggestions.map((tag, index) => (
            <li key={tag}>
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                className={index === active ? 'tag-suggest__item is-active' : 'tag-suggest__item'}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(tag);
                }}
              >
                {tag}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
