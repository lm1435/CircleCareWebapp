import { useEffect, useRef, type KeyboardEvent, type ReactElement } from 'react';

export interface SegmentedControlOption {
  value: string;
  label: string;
}

/** Extra detail about how a change happened, passed as `onChange`'s 2nd arg. */
export interface SegmentedControlChangeMeta {
  /** True when the change came from an arrow-key press, not a click. */
  viaKeyboard: boolean;
}

export interface SegmentedControlProps {
  options: SegmentedControlOption[];
  /** Currently selected option value. */
  value: string;
  onChange: (value: string, meta?: SegmentedControlChangeMeta) => void;
  /** Accessible name for the tablist (there is no visible label). */
  label: string;
  className?: string;
  /**
   * Focus the selected segment right after mount. For a control whose
   * `onChange` navigates and whose subtree gets remounted as a result (e.g.
   * keyed by pathname), a keyboard-driven change would otherwise strand focus
   * on <body> — the caller re-requests focus for the instance that replaces
   * it. Consulted once, on mount, and ignored on later prop changes.
   */
  focusOnMount?: boolean;
}

/**
 * STACKED MODE (mirrors mobile `SegmentedControl` `containerStacked`).
 *
 * Mobile stacks the segments into a column once the font scale makes the
 * longest localised label outgrow its 1/n share of the row. The web equivalent
 * is a CONTAINER query — the control stacks when its own wrapper is narrower
 * than roughly 80px per segment — so it reacts to the column it lives in, not
 * the viewport, and needs no JS measurement. 80, not 100: at 100px/segment the
 * four Care tabs (a 350px container) collapsed into a column on a 390px phone
 * viewport, where mobile shows all four in a row (mobile only stacks at
 * fontScale >= 1.15, `mobile/src/components/ui/SegmentedControl.tsx:83`).
 *
 * Tailwind's scanner reads source text; it can never see a class built by
 * interpolation (`@max-[${n * 80}px]:flex-col` compiles to nothing). So the
 * breakpoints are a STATIC map keyed by segment count. n = 2, 3 and 4 covers
 * every shipped call site (Week/Month, Medications/History, the four Care
 * tabs); a control with more segments simply never stacks, which is the safe
 * failure — a too-wide row, not a missing style.
 */
const STACK_CONTROL: Record<number, string> = {
  2: '@max-[160px]:flex-col',
  3: '@max-[240px]:flex-col',
  4: '@max-[320px]:flex-col',
};

/**
 * The sliding thumb is only meaningful in the ROW layout: every segment shares
 * one width there, so a single translate can place it under any index. In the
 * column each segment auto-sizes, so the thumb is hidden and the active segment
 * paints its own moss ground instead (mobile does exactly this).
 */
const STACK_HIDE_THUMB: Record<number, string> = {
  2: '@max-[160px]:hidden',
  3: '@max-[240px]:hidden',
  4: '@max-[320px]:hidden',
};

const STACK_ACTIVE_GROUND: Record<number, string> = {
  2: '@max-[160px]:bg-moss',
  3: '@max-[240px]:bg-moss',
  4: '@max-[320px]:bg-moss',
};

/**
 * SQUEEZE (horizontal padding) — the step BEFORE stacking.
 *
 * `flex-1` is `flex: 1 1 0%`, but a flex item's default `min-width: auto` means
 * it can never shrink below its own min-content width — for a one-word label
 * that is `px` + the whole word. So the widest segment does not clip when the
 * row runs out of room: it takes MORE than its 1/n share and squeezes its
 * siblings. The thumb is hard-wired to `(100% - 8px) / n`, so the moment the
 * segments stop being equal the moss pill stops lining up with the label it is
 * supposed to sit under — which is the bug this map fixes. `Medications` in a
 * 350px container did exactly that; the short `nav.*Short` labels
 * (`CareTabs.tsx`) cut the worst of it, but Spanish `Medicinas` (68px) still
 * needs more than 85px - 2x12px.
 *
 * Shrinking the padding is FREE, visually: once every segment fits its share,
 * `flex-1` makes them all exactly one share wide and the label is centred in
 * it, so the whitespace you see is `(share - label) / 2` either way — `px` only
 * decides WHEN the layout breaks, never how it looks when it doesn't. That is
 * why this is preferred over raising the STACK thresholds: stacking four tabs
 * costs ~130px of vertical space on a phone screen that has none to spare.
 *
 * Each threshold is the container width at which the longest shipped label
 * (`Medicinas`, 67.8px at 14px/500) stops fitting its `(c - 10px) / 4` share at
 * the NEXT padding up, plus ~8px of headroom for a font stack that measures
 * differently (Safari is not Chromium, and the webfont may not have loaded):
 * 12px needs c >= 377 -> step down below 416, 8px needs c >= 345 -> step down
 * below 384. Nothing below 4px is needed because the control stacks below
 * c = 320, and 4px still clears that boundary's 77.5px share. Static per count
 * for the same reason as STACK_CONTROL — Tailwind's scanner cannot see an
 * interpolated class; Tailwind orders `@max-*` variants narrowest-last, so the
 * two entries cascade rather than fight. Only n = 4 is tight enough to need
 * this with today's labels: at n = 2 the widest (`Documentos`, 83.8px) has
 * >30px of slack even in a 294px container.
 */
const SQUEEZE_PADDING: Record<number, string> = {
  4: '@max-[416px]:px-2 @max-[384px]:px-1',
};

/**
 * Editorial segmented control (spec §4.5), mirroring mobile's.
 *
 * a11y: a `tablist` of `tab` buttons with roving tabindex — only the selected
 * segment is in the tab order; ArrowLeft/ArrowRight/Home/End move the selection
 * AND the focus, which is the APG pattern for automatic-activation tabs.
 */
export function SegmentedControl({
  options,
  value,
  onChange,
  label,
  className,
  focusOnMount = false,
}: SegmentedControlProps): ReactElement {
  const count = options.length;
  // An unknown `value` (a stale tab id, say) must not park the thumb off-screen
  // or leave every segment out of the tab order — fall back to the first.
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);

  // Runs once, on mount only (empty deps) — a later `focusOnMount` prop change
  // must not steal focus back from wherever the user has since moved it.
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
    <div className={`[container-type:inline-size]${className ? ` ${className}` : ''}`}>
      <div
        role="tablist"
        aria-label={label}
        className={`relative flex bg-cream rounded-[14px] border border-line-2 p-1 ${
          STACK_CONTROL[count] ?? ''
        }`.trim()}
      >
        <span
          aria-hidden="true"
          data-testid="segmented-thumb"
          className={`absolute top-1 bottom-1 left-1 rounded-[10px] bg-moss transition-transform duration-normal ease-spring motion-reduce:transition-none ${
            STACK_HIDE_THUMB[count] ?? ''
          }`.trim()}
          style={{
            // `100% - 8px` removes the container's 4px padding on each side, so
            // the thumb is exactly one segment wide and `translateX(i * 100%)`
            // (percent of the THUMB's own width) lands it on segment i.
            width: `calc((100% - 8px) / ${count})`,
            transform: `translateX(${selectedIndex * 100}%)`,
          }}
        />
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
              // Same path as the arrow keys, so a click and a keyboard move
              // cannot drift apart (the roving tab stop follows either way).
              onClick={() => select(index)}
              onKeyDown={onKeyDown}
              className={`relative z-[1] flex-1 min-h-[44px] px-3 py-2.5 rounded-[10px] text-sm font-medium tracking-[-0.1px] transition-colors duration-normal ${
                SQUEEZE_PADDING[count] ?? ''
              } ${
                selected
                  ? `text-cream ${STACK_ACTIVE_GROUND[count] ?? ''}`
                  : 'text-ink-2 hover:text-ink'
              }`.trim()}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
