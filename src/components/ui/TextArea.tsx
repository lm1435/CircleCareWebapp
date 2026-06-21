import { forwardRef, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { RequiredMarker } from './RequiredMarker';

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  id: string;
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
}

/**
 * Accessible controlled multi-line text input. Same a11y contract as TextField.
 */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { id, label, error, hint, className, rows = 4, disabled, required, ...rest },
  ref
) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  const base =
    'w-full rounded-xl border bg-cream px-4 py-3 text-base text-ink placeholder:text-ink-3 disabled:cursor-not-allowed disabled:opacity-60 ' +
    (error ? 'border-terracotta-deep' : 'border-line');

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink-2">
        {label}
        {required ? <RequiredMarker /> : null}
      </label>
      <textarea
        ref={ref}
        id={id}
        rows={rows}
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
