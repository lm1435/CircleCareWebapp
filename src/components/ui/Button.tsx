import { forwardRef, type ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'ghost' | 'terracotta';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /**
   * Padding / font-size / min-height scale. Default `'md'` reproduces the
   * `.btn` base exactly (no extra classes) so existing calls are unchanged.
   * `sm` is a dense 36px control; `md` and `lg` keep a ≥44px touch target.
   */
  size?: ButtonSize;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: 'btn btn-primary',
  ghost: 'btn btn-ghost',
  // .btn-terracotta uses --terracotta-deep background — never raw --terracotta
  // behind text (design system contrast rule).
  terracotta: 'btn btn-terracotta',
};

// `md` is intentionally empty: the `.btn` base already encodes the default
// padding (14px 22px), font-size (--text-sm) and sizing. Emitting no extra
// classes for `md` guarantees byte-identical output to the prior component.
const sizeClass: Record<ButtonSize, string> = {
  sm: 'min-h-[36px] px-[16px] py-[8px] text-xs',
  md: '',
  lg: 'min-h-[52px] px-[28px] py-[18px] text-base',
};

/**
 * Pill button (999px radius) per the CircleCare design system.
 * Defaults to type="button" so forms never submit accidentally.
 * Icon-only usage MUST pass an aria-label.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className, type = 'button', ...rest },
  ref
) {
  const classes = [variantClass[variant], sizeClass[size], className]
    .filter(Boolean)
    .join(' ');
  return <button ref={ref} type={type} className={classes} {...rest} />;
});
