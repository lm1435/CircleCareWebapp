import { useId, type ReactNode } from 'react';
import { Text } from './Text';
import { INPUT_SHELL_DISABLED } from './inputStyles';

export interface ToggleProps {
  /** Controlled on/off state. */
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible label text — supply an i18n string. */
  label: ReactNode;
  /** Optional helper text below the label (referenced by aria-describedby). */
  hint?: ReactNode;
  disabled?: boolean;
  /** Optional explicit id; auto-generated otherwise. */
  id?: string;
}

/**
 * Accessible switch — `role="switch"` + `aria-checked`, toggled by click or
 * Space/Enter, ≥44px touch target, labelled by a clickable label, disabled
 * state. No copy is hardcoded.
 *
 * The track carries no focus classes of its own: the global `*:focus-visible`
 * ring lands on the button (spec §4.1), and a second, hand-rolled ring on the
 * inner span was drawing a different focus language from the rest of the app.
 */
export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
  id,
}: ToggleProps): ReactNode {
  const generatedId = useId();
  const switchId = id ?? generatedId;
  const labelId = `${switchId}-label`;
  const hintId = `${switchId}-hint`;

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <label
          id={labelId}
          htmlFor={switchId}
          className={disabled ? `block ${INPUT_SHELL_DISABLED}` : 'block'}
        >
          <Text variant="label" as="span">
            {label}
          </Text>
        </label>
        {hint ? (
          <Text variant="caption" id={hintId} className="mt-0.5">
            {hint}
          </Text>
        ) : null}
      </div>
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={hint ? hintId : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`group inline-flex shrink-0 items-center rounded-full py-2.5 disabled:cursor-not-allowed ${
          disabled ? INPUT_SHELL_DISABLED : ''
        }`}
      >
        {/* Transparent py-2.5 keeps a ≥44px touch target; the VISIBLE track is a
            slim h-6 switch (not a fat lozenge). */}
        <span
          aria-hidden="true"
          className={`relative block h-6 w-11 rounded-full transition-colors duration-fast ${
            checked ? 'bg-moss' : 'bg-line'
          }`}
        >
          <span
            className={`absolute left-0.5 top-0.5 block h-5 w-5 rounded-full bg-cream shadow-btn transition-transform duration-fast ease-spring ${
              checked ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </span>
      </button>
    </div>
  );
}
