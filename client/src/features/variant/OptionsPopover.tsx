import type { VariantJsonOptions, VariantTextOptions } from './compare';

/**
 * Mode-aware comparison options (PLAN-08). JSON options feed the structural
 * walker; text options feed the normalizers. Rendered inside the rail's
 * popover — the parent owns open/close.
 */

interface OptionsPopoverProps {
  mode: 'json' | 'text';
  json: VariantJsonOptions;
  text: VariantTextOptions;
  onJsonChange: (options: VariantJsonOptions) => void;
  onTextChange: (options: VariantTextOptions) => void;
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="variant-opt">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export function OptionsPopover({ mode, json, text, onJsonChange, onTextChange }: OptionsPopoverProps) {
  if (mode === 'text') {
    return (
      <div className="variant-options" role="group" aria-label="Text compare options">
        <p className="variant-options__head caption">Line endings are always normalized.</p>
        <Check
          label="Ignore leading/trailing whitespace"
          checked={text.trimLines}
          onChange={(trimLines) => onTextChange({ ...text, trimLines })}
        />
        <Check
          label="Ignore all whitespace"
          checked={text.stripWhitespace}
          onChange={(stripWhitespace) => onTextChange({ ...text, stripWhitespace })}
        />
        <Check
          label="Ignore case"
          checked={text.ignoreCase}
          onChange={(ignoreCase) => onTextChange({ ...text, ignoreCase })}
        />
        <Check
          label="Ignore blank lines"
          checked={text.dropBlankLines}
          onChange={(dropBlankLines) => onTextChange({ ...text, dropBlankLines })}
        />
        <p className="caption">
          With any of these on, the panes show read-only normalized copies.
        </p>
      </div>
    );
  }

  return (
    <div className="variant-options" role="group" aria-label="JSON compare options">
      <Check
        label="Ignore key order"
        checked={json.ignoreKeyOrder}
        onChange={(ignoreKeyOrder) => onJsonChange({ ...json, ignoreKeyOrder })}
      />
      <Check
        label="Case-insensitive strings"
        checked={json.caseInsensitiveStrings}
        onChange={(caseInsensitiveStrings) => onJsonChange({ ...json, caseInsensitiveStrings })}
      />
      <fieldset className="variant-opt-group">
        <legend className="caption">Match array items</legend>
        {(
          [
            ['index', 'By position'],
            ['key', 'By key field'],
            ['set', 'As a set (order-free)'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="variant-opt">
            <input
              type="radio"
              name="array-strategy"
              checked={json.arrayStrategy === value}
              onChange={() => onJsonChange({ ...json, arrayStrategy: value })}
            />
            <span>{label}</span>
          </label>
        ))}
        {json.arrayStrategy === 'key' && (
          <input
            className="variant-opt-input mono"
            type="text"
            value={json.arrayKeyField}
            placeholder="id"
            aria-label="Identity key field"
            onChange={(event) => onJsonChange({ ...json, arrayKeyField: event.target.value })}
          />
        )}
      </fieldset>
      <label className="variant-opt variant-opt--stack">
        <span>Numeric tolerance (ε, blank = exact)</span>
        <input
          className="variant-opt-input mono"
          type="text"
          inputMode="decimal"
          placeholder="0.0001"
          value={json.epsilon}
          onChange={(event) => onJsonChange({ ...json, epsilon: event.target.value })}
        />
      </label>
      <label className="variant-opt variant-opt--stack">
        <span>Ignore paths (one glob per line)</span>
        <textarea
          className="variant-opt-input mono"
          rows={2}
          placeholder={'**.updatedAt\nitems[*].etag'}
          value={json.ignorePaths}
          onChange={(event) => onJsonChange({ ...json, ignorePaths: event.target.value })}
        />
      </label>
    </div>
  );
}
