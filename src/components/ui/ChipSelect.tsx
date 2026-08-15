import type { ReactElement } from 'react';

export interface ChipSelectOption {
  /** Value reported through onChange and matched against `value`. */
  value: string;
  /** Visible chip text; defaults to the value. */
  label?: string;
}

export interface ChipSelectProps {
  /** Optional id for the group element. */
  id?: string;
  /** Accessible name for the role="group" chip row (i18n string). */
  label: string;
  options: Array<string | ChipSelectOption>;
  /** Current value; matched against options case-insensitively (trimmed). */
  value: string | null;
  onChange: (next: string | null) => void;
  /**
   * Clicking the already-selected chip clears the selection (default true —
   * the chips ARE the input, e.g. blood type). Pass false for quick-fill rows
   * where a text field stays the source of truth and chips only ever fill it.
   */
  allowDeselect?: boolean;
}

/** Case-insensitive, trimmed comparison — chip selection is forgiving. */
function matches(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Single-select chip row (Round 3 quick-pick chips —
 * docs/plans/condition-tags.md QP1). Extracted from the blood-type chip row:
 * ink/cream selected pill, hairline-outline unselected chip, pill radius,
 * 36px targets (Round 7 slimming — above the 24px SC 2.5.8 minimum),
 * aria-pressed buttons inside a labeled role="group". The
 * global *:focus-visible ring provides focus styling — never suppressed.
 *
 * Legacy/free-text values remain a CALLER concern: include them as an extra
 * option so they stay visible and deselectable.
 */
export function ChipSelect({
  id,
  label,
  options,
  value,
  onChange,
  allowDeselect = true,
}: ChipSelectProps): ReactElement {
  return (
    <div id={id} role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const optionValue = typeof option === 'string' ? option : option.value;
        const optionLabel = typeof option === 'string' ? option : (option.label ?? option.value);
        const selected = value !== null && matches(value, optionValue);
        return (
          <button
            key={optionValue}
            type="button"
            aria-pressed={selected}
            onClick={() => {
              if (selected) {
                if (allowDeselect) onChange(null);
              } else {
                onChange(optionValue);
              }
            }}
            className={
              selected
                ? 'min-h-9 rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-cream'
                : 'min-h-9 rounded-full border border-line bg-transparent px-4 py-1.5 text-sm text-ink hover:bg-bg-2'
            }
          >
            {optionLabel}
          </button>
        );
      })}
    </div>
  );
}
