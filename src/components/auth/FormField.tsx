import { forwardRef, type InputHTMLAttributes } from 'react';
import { RequiredMarker } from '@/components/ui';

export interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  error?: string;
  /** Extra description rendered below the input (always referenced by aria-describedby). */
  hint?: string;
}

/**
 * Accessible labeled input for auth forms:
 * - real <label htmlFor>
 * - aria-invalid + aria-describedby pointing at the error message
 * - error text is a live region target the pages can focus via the input ref
 */
export const FormField = forwardRef<HTMLInputElement, FormFieldProps>(function FormField(
  { id, label, error, hint, className, required, ...rest },
  ref
) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  const base =
    'w-full rounded-xl border bg-cream px-4 py-3 text-base text-ink placeholder:text-ink-3/60 ' +
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
