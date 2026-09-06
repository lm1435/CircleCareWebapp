import { useRef, type KeyboardEvent, type ReactElement } from 'react';
import { chipClass } from './inputStyles';

export interface ChipSelectOption {
  /** Value reported through onChange and matched against `value`. */
  value: string;
  /** Visible chip text; defaults to the value. */
  label?: string;
}

export interface ChipSelectProps {
  /** Optional id for the group element. */
  id?: string;
  /** Accessible name for the radiogroup chip row (i18n string). */
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
 * geometry and the press scale come from `chipClass` (spec §4.5) so every
 * chip in the app — here and in TagInput — moves together; 44px targets, not
 * the old 36. The global *:focus-visible ring provides focus styling — never
 * suppressed.
 *
 * a11y: `role="radiogroup"` of `role="radio"` chips with roving tabindex —
 * only one chip is ever in the Tab order — and ArrowLeft/ArrowRight/Home/End
 * move BOTH the selection and the focus (APG's "selection follows focus"
 * single-select pattern), mirroring `SegmentedControl`. This replaced a plain
 * `role="group"` of `aria-pressed` buttons: a same-named "pressed" state on
 * every chip in the row reads to a screen reader as N independent toggles,
 * not "one of these N", which is what this control actually is.
 * `allowDeselect` is a deliberate escape from strict radio semantics (a
 * native radio group can't go back to nothing selected) — arrow-key
 * navigation never deselects, only a click on the already-selected chip does.
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
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const count = options.length;

  const normalized = options.map((option) => ({
    value: typeof option === 'string' ? option : option.value,
    label: typeof option === 'string' ? option : (option.label ?? option.value),
  }));

  const selectedIndex =
    value !== null ? normalized.findIndex((option) => matches(value, option.value)) : -1;
  // Roving tab stop: the selected chip when there is one, else the first —
  // never leaves the whole row out of the tab order.
  const tabbableIndex = selectedIndex >= 0 ? selectedIndex : 0;

  function selectIndex(index: number, focus: boolean): void {
    const target = normalized[index];
    if (!target) return;
    if (focus) buttonsRef.current[index]?.focus();
    onChange(target.value);
  }

  function onKeyDown(index: number, event: KeyboardEvent<HTMLButtonElement>): void {
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (index + 1) % count;
    else if (event.key === 'ArrowLeft') next = (index - 1 + count) % count;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    if (next === null) return;
    event.preventDefault();
    selectIndex(next, true);
  }

  return (
    <div id={id} role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {normalized.map((option, index) => {
        const selected = index === selectedIndex;
        return (
          <button
            key={option.value}
            ref={(el) => {
              buttonsRef.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={index === tabbableIndex ? 0 : -1}
            onClick={() => {
              if (selected) {
                if (allowDeselect) onChange(null);
              } else {
                selectIndex(index, false);
              }
            }}
            onKeyDown={(event) => onKeyDown(index, event)}
            className={chipClass(selected)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
