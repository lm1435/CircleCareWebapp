import { forwardRef, type ReactNode, type SelectHTMLAttributes } from 'react';
import { RequiredMarker } from './RequiredMarker';

export interface SelectOption {
  value: string;
  /** Visible option text — supply an i18n string. */
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  id: string;
  label: ReactNode;
  options: SelectOption[];
  error?: string;
  hint?: ReactNode;
  /** Optional leading placeholder option (e.g. "Choose…"). Empty value. */
  placeholder?: string;
}

/**
 * Accessible controlled native <select>. Keyboard-operable by default; same
 * a11y wiring as TextField. Options + placeholder come from props (no copy).
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { id, label, options, error, hint, placeholder, className, disabled, required, ...rest },
  ref
) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  // appearance-none removes the native caret so we can render our own with
  // controlled spacing. pl-4 matches the field's left padding; pr-11 reserves
  // room so long values never slide under the custom chevron on the right.
  const base =
    'min-h-[44px] w-full appearance-none rounded-xl border bg-cream pl-4 pr-11 py-3 text-base text-ink disabled:cursor-not-allowed disabled:opacity-60 ' +
    (error ? 'border-terracotta-deep' : 'border-line');

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink-2">
        {label}
        {required ? <RequiredMarker /> : null}
      </label>
      <div className="relative">
        <select
          ref={ref}
          id={id}
          disabled={disabled}
          required={required}
          aria-required={required ? true : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={className ? `${base} ${className}` : base}
          {...rest}
        >
          {placeholder !== undefined ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3"
        >
          <path
            d="M6 8l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      {error ? (
        <p id={errorId} className="m-0 text-sm text-terracotta-deep">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="m-0 text-sm text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
