import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { RequiredMarker } from './RequiredMarker';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  /** Visible label text — supply an i18n string. */
  label: ReactNode;
  /** Error message; wires aria-invalid + aria-describedby and red styling. */
  error?: string;
  /** Helper text below the input (always referenced by aria-describedby). */
  hint?: ReactNode;
}

/**
 * Accessible controlled text input. Mirrors the auth `FormField` pattern:
 * real <label htmlFor>, aria-invalid + aria-describedby → error/hint wiring,
 * ≥44px touch target, disabled styling. No copy is hardcoded.
 */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { id, label, error, hint, className, disabled, required, ...rest },
  ref
) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  const base =
    'min-h-[44px] w-full rounded-xl border bg-cream px-4 py-3 text-base text-ink placeholder:text-ink-3 disabled:cursor-not-allowed disabled:opacity-60 ' +
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
