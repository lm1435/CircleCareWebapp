import { forwardRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Icon } from './Icon';
import type { IconName } from './iconNames';
import { RequiredMarker } from './RequiredMarker';
import { Text } from './Text';
import {
  INPUT_ERROR,
  INPUT_HINT,
  INPUT_LABEL,
  INPUT_TEXT,
  fieldShell,
  INPUT_TRAILING,
} from './inputStyles';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  /** Visible label text — supply an i18n string. */
  label: ReactNode;
  /** Error message; wires aria-invalid + aria-describedby and the error border. */
  error?: string;
  /** Helper text below the input (always referenced by aria-describedby). */
  hint?: ReactNode;
  /** Glyph for the trailing 44×44 slot (mobile `Field`'s `rightIcon`). */
  rightIcon?: IconName;
  /** Makes `rightIcon` a real button. Without it the glyph is decorative. */
  onRightIconPress?: () => void;
  /** Accessible name for the `rightIcon` button — required when it is one. */
  rightIconLabel?: string;
  /**
   * Renders the show/hide-password eye in the trailing slot of a
   * `type="password"` field (spec §6.1). Needs `toggleLabels`: the button's
   * accessible name is copy, and copy never lives in a primitive — without
   * them the eye would ship an unlabeled button, so it is not rendered.
   */
  showToggle?: boolean;
  /** Localized accessible names for the password eye, e.g. from `t()`. */
  toggleLabels?: { show: string; hide: string };
}

/**
 * The app's text field (spec §4.5) — mobile's `Field` + `Input` in one.
 *
 * The bordered box is a `<div>` around the `<input>` so `focus-within` can
 * animate the border to moss-light the way mobile's `Animated.Value` does, and
 * so a trailing icon sits INSIDE the box rather than floating over it. The a11y
 * contract is unchanged: real `<label htmlFor>`, aria-invalid +
 * aria-describedby → error/hint, forwarded ref, ≥44px target. No copy is
 * hardcoded — `toggleLabels` come from the caller.
 */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  {
    id,
    label,
    error,
    hint,
    className,
    disabled,
    required,
    type = 'text',
    rightIcon,
    onRightIconPress,
    rightIconLabel,
    showToggle,
    toggleLabels,
    ...rest
  },
  ref
) {
  const [revealed, setRevealed] = useState(false);

  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  // The eye owns the trailing slot on a password field; `rightIcon` only fills
  // it when there is no eye.
  const eye = Boolean(showToggle && toggleLabels && type === 'password');
  const inputType = eye && revealed ? 'text' : type;

  // A trailing BUTTON needs an accessible name, and a name is copy, so it can
  // only come from the caller. Without one the glyph degrades to decoration
  // rather than shipping an unlabeled button — and says so in dev, because a
  // silent downgrade is how a caller ends up with a dead icon it believes works.
  const iconButton = Boolean(rightIcon && onRightIconPress && rightIconLabel);
  if (import.meta.env.DEV) {
    if (showToggle && !toggleLabels) {
      console.warn('TextField: showToggle requires toggleLabels');
    }
    if (onRightIconPress && !rightIconLabel) {
      console.warn('TextField: onRightIconPress requires rightIconLabel');
    }
  }

  const shell = fieldShell({ error: Boolean(error), disabled });

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
          type={inputType}
          disabled={disabled}
          required={required}
          aria-required={required ? true : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={className ? `${INPUT_TEXT} ${className}` : INPUT_TEXT}
          {...rest}
        />
        {eye && toggleLabels ? (
          <button
            type="button"
            className={INPUT_TRAILING}
            aria-pressed={revealed}
            aria-label={revealed ? toggleLabels.hide : toggleLabels.show}
            disabled={disabled}
            onClick={() => setRevealed((current) => !current)}
          >
            <Icon name={revealed ? 'eye-off-outline' : 'eye-outline'} size="row" />
          </button>
        ) : iconButton && rightIcon && onRightIconPress ? (
          <button
            type="button"
            className={INPUT_TRAILING}
            aria-label={rightIconLabel}
            disabled={disabled}
            onClick={onRightIconPress}
          >
            <Icon name={rightIcon} size="row" />
          </button>
        ) : rightIcon ? (
          <Icon name={rightIcon} size="row" className="text-ink-2 pointer-events-none" />
        ) : null}
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
