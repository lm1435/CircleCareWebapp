import { useId, type ReactNode } from 'react';
import { Icon } from './Icon';
import { Text } from './Text';
import { INPUT_ERROR, INPUT_HINT, INPUT_LABEL, optionRow } from './inputStyles';

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
 * radio inputs (full keyboard support, `accent-ink`), 44px option rows in the
 * §4.5 field language, error wiring. All copy comes from props.
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
    // No spacing class on the wrapper: `INPUT_LABEL`'s mb-2 and the hint/error
    // rows' mt-1 carry the rhythm, exactly as they do on every other §4.5 field.
    <div
      role="radiogroup"
      aria-labelledby={labelId}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
    >
      <span id={labelId} className={INPUT_LABEL}>
        <Text variant="label" as="span">
          {label}
        </Text>
      </span>
      <div className="flex flex-col gap-1">
        {options.map((option) => {
          const optionId = `${groupName}-${option.value}`;
          const optionDisabled = disabled || option.disabled;
          const selected = value === option.value;
          const row = optionRow(selected, optionDisabled);
          return (
            <label key={option.value} htmlFor={optionId} className={row}>
              <input
                id={optionId}
                type="radio"
                name={groupName}
                value={option.value}
                checked={selected}
                disabled={optionDisabled}
                onChange={() => onChange(option.value)}
                className="h-5 w-5 shrink-0 accent-ink"
              />
              <span className="min-w-0">
                <Text variant="bodyDense" as="span" className="block">
                  {option.label}
                </Text>
                {option.hint ? (
                  <Text variant="caption" as="span" className="mt-0.5 block">
                    {option.hint}
                  </Text>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
      {hint ? (
        <Text variant="caption" id={hintId} className={INPUT_HINT}>
          {hint}
        </Text>
      ) : null}
      {error ? (
        <p id={errorId} className={INPUT_ERROR}>
          <Icon name="alert-circle-outline" size="inline" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
