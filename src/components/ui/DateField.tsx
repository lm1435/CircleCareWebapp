import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { RequiredMarker } from './RequiredMarker';

export interface DateFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  id: string;
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
}

/**
 * Accessible controlled `<input type="date">`. Keyboard-operable native picker;
 * same a11y wiring as TextField. The value is a `YYYY-MM-DD` string — callers
 * are responsible for timezone-correct formatting (Stage 0 formatters).
 */
export const DateField = forwardRef<HTMLInputElement, DateFieldProps>(function DateField(
  { id, label, error, hint, className, disabled, required, ...rest },
  ref
) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  const base =
    'min-h-[44px] w-full rounded-xl border bg-cream px-4 py-3 text-base text-ink disabled:cursor-not-allowed disabled:opacity-60 ' +
    (error ? 'border-terracotta-deep' : 'border-line');

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink-2">
        {label}
        {required ? <RequiredMarker /> : null}
      </label>
      <input
        ref={ref}
        id={id}
        type="date"
        disabled={disabled}
        required={required}
        aria-required={required ? true : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={className ? `${base} ${className}` : base}
        {...rest}
      />
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
