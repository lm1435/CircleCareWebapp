import { forwardRef, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Icon } from './Icon';
import { RequiredMarker } from './RequiredMarker';
import { Text } from './Text';
import {
  INPUT_ERROR,
  INPUT_HINT,
  INPUT_LABEL,
  INPUT_TEXT,
  fieldShell,
} from './inputStyles';

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
 * Native `<select>` in the §4.5 shell. `appearance-none` drops the platform
 * caret so the trailing slot can carry the app's own `chevron-down`; the
 * chevron is `pointer-events-none` so clicking it still opens the menu.
 * Options + placeholder come from props (no copy).
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { id, label, options, error, hint, placeholder, className, disabled, required, ...rest },
  ref
) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  const shell = fieldShell({ error: Boolean(error), disabled });

  const control = `${INPUT_TEXT} appearance-none cursor-pointer`;

  return (
    <div>
      <label htmlFor={id} className={INPUT_LABEL}>
        <Text variant="label" as="span">
          {label}
          {required ? <RequiredMarker /> : null}
        </Text>
      </label>
      <div className={shell}>
        <select
          ref={ref}
          id={id}
          disabled={disabled}
          required={required}
          aria-required={required ? true : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={className ? `${control} ${className}` : control}
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
        <Icon name="chevron-down" size="inline" className="text-ink-2 pointer-events-none" />
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
});
