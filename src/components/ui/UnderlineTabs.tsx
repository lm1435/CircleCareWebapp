import { useEffect, useRef, type KeyboardEvent, type ReactElement } from 'react';
import type { SegmentedControlProps } from './SegmentedControl';

/** Same props as `SegmentedControl` so a call site can swap one for the other. */
export type UnderlineTabsProps = SegmentedControlProps;

/**
 * Underline tabs (mobile `UnderlineTabs` twin): text labels in a row, the
 * selected one in ink with a 2px underline, the rest muted. Used for the
 * Day | Week | Month range control on the calendar.
 *
 * a11y: identical to `SegmentedControl` — a `tablist` of `tab` buttons with a
 * roving tabindex; ArrowLeft/ArrowRight/Home/End move selection AND focus
 * (APG automatic-activation tabs). Token classes only, so it themes in dark.
 */
export function UnderlineTabs({
  options,
  value,
  onChange,
  label,
  className,
  focusOnMount = false,
}: UnderlineTabsProps): ReactElement {
  const count = options.length;
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);

  // Mount-only, like SegmentedControl: never steal focus on a later prop change.
  useEffect(() => {
    if (focusOnMount) buttonsRef.current[selectedIndex]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function select(index: number, viaKeyboard = false): void {
    const next = options[index];
    if (!next) return;
    buttonsRef.current[index]?.focus();
    if (next.value !== value) onChange(next.value, { viaKeyboard });
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (selectedIndex + 1) % count;
    else if (event.key === 'ArrowLeft') next = (selectedIndex - 1 + count) % count;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    if (next === null) return;
    event.preventDefault();
    select(next, true);
  }

  return (
    <div className={className}>
      <div role="tablist" aria-label={label} className="flex border-b border-line-2">
        {options.map((option, index) => {
          const selected = index === selectedIndex;
          return (
            <button
              key={option.value}
              ref={(el) => {
                buttonsRef.current[index] = el;
              }}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(index)}
              onKeyDown={onKeyDown}
              className={`relative min-h-[44px] flex-1 px-3 py-2.5 text-sm font-medium tracking-[-0.1px] transition-colors duration-normal ${
                selected ? 'text-ink' : 'text-ink-3 hover:text-ink'
              }`}
            >
              {option.label}
              <span
                aria-hidden="true"
                data-testid={selected ? 'underline-tab-indicator' : undefined}
                className={`absolute inset-x-3 -bottom-px h-0.5 rounded-full ${
                  selected ? 'bg-ink' : 'bg-transparent'
                }`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
