import { useId, type ReactNode } from 'react';

export interface RadioOption {
  value: string;
  /** Visible option label — supply an i18n string. */
  label: ReactNode;
  /** Optional helper text below the option label. */
  hint?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps {
  /** Group label, exposed as the group's accessible name. */
  label: ReactNode;
  options: RadioOption[];
  value: string;
  onChange: (value: string) => void;
  /** Error message; wires aria-invalid + aria-describedby on the group. */
  error?: string;
  hint?: ReactNode;
  disabled?: boolean;
  /** Shared name for the underlying radio inputs; auto-generated otherwise. */
  name?: string;
}

/**
 * Accessible radio group — `role="radiogroup"` labelled by its heading, native
 * radio inputs (full keyboard support), ≥44px row targets, error wiring. All
 * copy comes from props.
 */
export function RadioGroup({
  label,
  options,
  value,
  onChange,
  error,
  hint,
  disabled = false,
  name,
}: RadioGroupProps): ReactNode {
  const generatedName = useId();
  const groupName = name ?? generatedName;
  const labelId = `${groupName}-label`;
  const errorId = `${groupName}-error`;
  const hintId = `${groupName}-hint`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelId}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
      className="flex flex-col gap-1.5"
    >
      <span id={labelId} className="text-sm font-medium text-ink-2">
        {label}
      </span>
      <div className="flex flex-col gap-1">
        {options.map((option) => {
          const optionId = `${groupName}-${option.value}`;
          const optionDisabled = disabled || option.disabled;
          return (
            <label
              key={option.value}
              htmlFor={optionId}
              className={`flex min-h-[44px] items-start gap-3 rounded-xl border px-4 py-3 ${
                value === option.value ? 'border-terracotta-deep bg-bg-2' : 'border-line'
              } ${optionDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
            >
              <input
                id={optionId}
                type="radio"
                name={groupName}
                value={option.value}
                checked={value === option.value}
                disabled={optionDisabled}
                onChange={() => onChange(option.value)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-terracotta-deep"
              />
              <span className="min-w-0">
                <span className="block text-base text-ink">{option.label}</span>
                {option.hint ? (
                  <span className="mt-0.5 block text-sm text-ink-3">{option.hint}</span>
                ) : null}
              </span>
            </label>
          );
        })}
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
}
