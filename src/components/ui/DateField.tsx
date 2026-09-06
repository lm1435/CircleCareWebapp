import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { Icon } from './Icon';
import { RequiredMarker } from './RequiredMarker';
import { Text } from './Text';
import {
  INPUT_ERROR,
  INPUT_HINT,
  INPUT_LABEL,
  INPUT_TEXT,
  fieldShell,
  PICKER_INDICATOR_OVERLAY,
} from './inputStyles';

export interface DateFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  id: string;
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
}

/**
 * `<input type="date">` in the §4.5 shell, with the app's own
 * `calendar-outline` in the trailing slot. The native picker button is not
 * removed — it is made transparent and stretched over that slot
 * (`PICKER_INDICATOR_OVERLAY`), so clicking the glyph still opens the browser's
 * date picker instead of quietly becoming decoration.
 *
 * The value is a `YYYY-MM-DD` string — callers own timezone-correct formatting.
 */
export const DateField = forwardRef<HTMLInputElement, DateFieldProps>(function DateField(
  { id, label, error, hint, className, disabled, required, ...rest },
  ref
) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  const shell = fieldShell({ error: Boolean(error), disabled, extra: 'relative' });

  const control = `${INPUT_TEXT} appearance-none cursor-pointer ${PICKER_INDICATOR_OVERLAY}`;

  return (
    <div>
      <label htmlFor={id} className={INPUT_LABEL}>
        <Text variant="label" as="span">
          {label}
          {required ? <RequiredMarker /> : null}
        </Text>
      </label>
      <div className={shell}>
        <input
          ref={ref}
          id={id}
          type="date"
          disabled={disabled}
          required={required}
          aria-required={required ? true : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={className ? `${control} ${className}` : control}
          {...rest}
        />
        <Icon name="calendar-outline" size="inline" className="text-ink-2 pointer-events-none" />
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
