import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type RefObject,
} from 'react';
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
  /**
   * The most lines the wrapped chips may take. When the options would need more
   * (a long locale, a narrow phone, zoomed text), the row becomes one
   * horizontally scrolling line instead of growing a third. Unset = wrap
   * freely (every existing caller).
   */
  maxRows?: number;
}

/** Wrapped chip row; the default. */
const CHIP_ROW_WRAP = 'flex flex-wrap gap-2';

/**
 * The capped row's fallback: one line that scrolls sideways. Chips keep their
 * width (`shrink-0`, no inner wrap) and the vertical padding keeps the focus
 * ring from being clipped by the scroll box.
 */
const CHIP_ROW_SCROLL =
  'flex flex-nowrap gap-2 overflow-x-auto py-1 [&>*]:shrink-0 [&>*]:whitespace-nowrap';

/** The class for a chip row, given `useChipRowCap`'s verdict. */
export function chipRowClass(overflow: boolean): string {
  return overflow ? CHIP_ROW_SCROLL : CHIP_ROW_WRAP;
}

/**
 * The line cap behind `maxRows` (also used by the composer's category row).
 *
 * Measured, not estimated: before paint, the wrapped chips' distinct
 * `offsetTop`s are the number of lines, and more than `maxRows` flips the row
 * to its scroll fallback. The verdict is keyed to the row's width and to
 * `contentKey` (the option labels), so a resize, zoom or language switch drops
 * it and the row is re-measured as a wrap first.
 */
export function useChipRowCap(
  maxRows: number | undefined,
  contentKey: string
): { ref: RefObject<HTMLDivElement>; overflow: boolean } {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [overflowKey, setOverflowKey] = useState<string | null>(null);
  const measureKey = `${width}|${contentKey}`;
  const overflow = maxRows !== undefined && overflowKey === measureKey;

  useLayoutEffect(() => {
    const el = ref.current;
    if (maxRows === undefined || overflow || !el) return;
    const lines = new Set(Array.from(el.children, (child) => (child as HTMLElement).offsetTop))
      .size;
    if (lines > maxRows) setOverflowKey(measureKey);
  });

  useEffect(() => {
    const el = ref.current;
    if (maxRows === undefined || !el || typeof ResizeObserver === 'undefined') return;
    // Width only: the fallback row is shorter than the wrap, and reacting to
    // that height change would flip it straight back.
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, [maxRows]);

  return { ref, overflow };
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
  maxRows,
}: ChipSelectProps): ReactElement {
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const count = options.length;

  const normalized = options.map((option) => ({
    value: typeof option === 'string' ? option : option.value,
    label: typeof option === 'string' ? option : (option.label ?? option.value),
  }));

  const { ref: rowRef, overflow } = useChipRowCap(
    maxRows,
    normalized.map((option) => option.label).join('\u0001')
  );

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
    <div
      ref={rowRef}
      id={id}
      role="radiogroup"
      aria-label={label}
      data-layout={overflow ? 'scroll' : 'wrap'}
      className={chipRowClass(overflow)}
    >
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
