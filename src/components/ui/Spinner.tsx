import type { HTMLAttributes, ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

export interface SpinnerProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Accessible label; defaults to the translated "Loading..." */
  label?: string;
  /** Diameter in px */
  size?: number;
  /**
   * Render as pure decoration: `aria-hidden`, no `role`, no label.
   *
   * For a spinner INSIDE a control that already announces its own busy state —
   * `Button`'s `loading` swaps the label for a spinner and sets `aria-busy`, so
   * a `role="status"` here would splice "Loading…" into the button's accessible
   * name ("Loading… Save") and re-announce it as a live region on every press.
   * Standalone spinners (page and Suspense fallbacks) keep the default.
   */
  decorative?: boolean;
  className?: string;
}

/**
 * Accessible loading spinner (no text flash — label is for screen readers).
 *
 * `useSuspense: false` is load-bearing: this component is used as the
 * `fallback` of the app-wide `<Suspense>` in `src/App.tsx` (its `es` locale
 * chunk hasn't loaded yet is exactly the case that boundary exists for). A
 * `fallback` that itself suspends on the default `useSuspense: true` can
 * never paint — React has nothing to fall back TO — so this degrades to the
 * `common:loading` key's already-loaded English text (or the raw key, worst
 * case) for one frame instead, then re-renders once the namespace resolves.
 */
export function Spinner({
  label,
  size = 24,
  decorative = false,
  className,
  ...rest
}: SpinnerProps): ReactElement {
  const { t } = useTranslation('common', { useSuspense: false });
  const accessibleLabel = label ?? t('loading');

  // `rest` is spread LAST so a caller can still override these (e.g. an
  // explicit aria-hidden on a spinner inside an already-announced control).
  const a11y = decorative
    ? ({ 'aria-hidden': true } as const)
    : ({ role: 'status', 'aria-label': accessibleLabel } as const);

  return (
    <span
      {...a11y}
      className={className ? `inline-flex ${className}` : 'inline-flex'}
      {...rest}
    >
      {/* Ring inherits `currentColor` (spec §4.5) so a spinner swapped in for a
          button's label matches that button's text — the old hardcoded
          coral-deep read as an error next to moss and ink grounds. Reduced
          motion keeps the spin (it is the only progress signal) but slows it. */}
      <span
        aria-hidden="true"
        className="inline-block rounded-full border-2 border-current/20 border-t-current animate-spin motion-reduce:animate-[spin_1.5s_linear_infinite]"
        style={{ width: size, height: size }}
      />
    </span>
  );
}
