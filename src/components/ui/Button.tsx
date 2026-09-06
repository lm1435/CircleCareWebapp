import {
  forwardRef,
  type ComponentPropsWithRef,
  type ComponentPropsWithoutRef,
  type ElementType,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Spinner } from './Spinner';

/** Canonical variants (spec §4.5 — mobile parity). */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex items-center justify-center gap-2 font-semibold ' +
  'transition-[transform,background-color,box-shadow] duration-fast ease-spring ' +
  'active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none ' +
  'whitespace-nowrap select-none';

const VARIANT = {
  primary: 'bg-moss text-cream shadow-md hover:bg-moss-mid',
  // Cream fill + `border-line` (14% ink): the same resting treatment as an
  // unselected chip, so a secondary button and a chip in one dialog read as
  // one family. The earlier `bg-bg-2` tan fill was 1.09:1 against the page
  // and 1.15:1 against a cream modal — no shape without the border, and a
  // muddy one with it. Hover borrows the chip's `bg-bg-2` too.
  secondary: 'bg-cream text-ink border-[1.5px] border-line hover:bg-bg-2',
  ghost: 'bg-transparent text-moss hover:bg-moss-soft',
  danger:
    'bg-terracotta-soft text-terracotta-deep hover:bg-[color-mix(in_oklab,var(--color-terracotta-soft),black_6%)]',
} as const;

const SIZE = {
  sm: 'min-h-[44px] px-4 py-2 rounded-md text-sm',
  md: 'min-h-[44px] px-6 py-4 rounded-lg text-md',
  lg: 'min-h-[52px] px-8 py-5 rounded-xl text-md',
} as const;

/** Every accepted variant name → its class set. */
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: VARIANT.primary,
  secondary: VARIANT.secondary,
  ghost: VARIANT.ghost,
  danger: VARIANT.danger,
};

type ButtonOwnProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Swaps the label for a Spinner, sets `aria-busy`, and disables the control. */
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
  /**
   * Owned rather than forwarded: on a non-`button` element it becomes
   * `aria-disabled` + `tabIndex={-1}`, since anchors reject `disabled`.
   */
  disabled?: boolean;
};

/**
 * Props for `Button`. Generic over the rendered element so `as={Link}` accepts
 * `Link`'s props (`to`) while a plain `<Button>` accepts `<button>`'s. Bare
 * `ButtonProps` still means the `<button>` case, so existing imports of the
 * type are unaffected.
 */
export type ButtonProps<E extends ElementType = 'button'> = ButtonOwnProps & {
  as?: E;
} & Omit<ComponentPropsWithoutRef<E>, keyof ButtonOwnProps | 'as'>;

/**
 * Inner shape — the exported generic signature below is the one callers are
 * checked against. No index signature here: `forwardRef`'s `PropsWithoutRef`
 * collapses any props type that has one down to the index signature alone,
 * which erases every declared prop.
 */
type InnerProps = ButtonOwnProps & {
  as?: ElementType;
  className?: string;
  children?: ReactNode;
  type?: 'button' | 'submit' | 'reset';
  'aria-busy'?: boolean | 'true' | 'false';
};

const SPINNER_PX: Record<ButtonSize, number> = { sm: 16, md: 18, lg: 20 };

/**
 * The one button primitive (spec §4.5). Mobile-parity shapes (r12/16/20), a
 * 44px minimum touch target at every size, and `type="button"` by default so
 * a button inside a form never submits by accident.
 *
 * Icon-only usage MUST pass an `aria-label`.
 */
const ButtonInner = forwardRef<HTMLButtonElement, InnerProps>(function Button(props, ref) {
  const {
    variant = 'primary',
    size = 'md',
    loading = false,
    leftIcon,
    rightIcon,
    fullWidth = false,
    as,
    className,
    children,
    disabled,
    type,
    'aria-busy': ariaBusy,
    // Everything the caller passed for the underlying element (onClick, href,
    // `to`, aria-*, form, …). The cast only widens the rest bucket — the
    // declared props above keep their real types.
    ...rest
  } = props as InnerProps & Record<string, unknown>;

  const Component = (as ?? 'button') as ElementType;
  const isNativeButton = Component === 'button';
  const isDisabled = Boolean(disabled) || loading;

  const classes = [
    BASE,
    VARIANT_CLASSES[variant] ?? VARIANT_CLASSES.primary,
    SIZE[size],
    fullWidth ? 'w-full' : null,
    // Positioning context for the loading overlay. Kept out of BASE because
    // BASE is the spec's literal, unconditional class list.
    loading ? 'relative' : null,
    // `:disabled` never matches an <a>, so a disabled link needs the dim and
    // the pointer-event kill applied unconditionally instead.
    !isNativeButton && isDisabled ? 'opacity-50 pointer-events-none' : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  // Anchors reject `type` and `disabled`; they get the ARIA equivalents.
  const elementProps = isNativeButton
    ? { type: type ?? 'button', disabled: isDisabled }
    : isDisabled
      ? { 'aria-disabled': true as const, tabIndex: -1 }
      : {};

  return (
    <Component
      ref={ref}
      className={classes}
      aria-busy={loading ? true : ariaBusy}
      {...elementProps}
      {...rest}
    >
      {loading ? (
        <>
          {/* The label (and icons) stay IN FLOW so the button keeps its exact
              resting width while busy — `sr-only` would collapse the box and
              make the button snap to spinner-plus-padding mid-action.
              `visibility: hidden` also drops the node from the accessibility
              tree, hence the sr-only copy below. */}
          <span aria-hidden="true" className="invisible inline-flex items-center gap-2">
            {leftIcon}
            {children}
            {rightIcon}
          </span>
          <span className="sr-only">{children}</span>
          {/* Centred over the hidden label rather than replacing it. */}
          <span className="absolute inset-0 grid place-items-center">
            {/* `decorative`: the button already announces `aria-busy`, and a
                role="status" here would splice "Loading…" into the accessible
                name and fire a live region on every press. */}
            <Spinner decorative size={SPINNER_PX[size]} />
          </span>
        </>
      ) : (
        <>
          {leftIcon}
          {children}
          {rightIcon}
        </>
      )}
    </Component>
  );
});

export const Button = ButtonInner as unknown as <E extends ElementType = 'button'>(
  props: ButtonProps<E> & { ref?: ComponentPropsWithRef<E>['ref'] }
) => ReactElement | null;
