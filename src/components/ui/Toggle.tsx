import { useId, type ReactNode } from 'react';

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
          className={`block text-sm font-medium text-ink-2 ${disabled ? 'opacity-60' : ''}`}
        >
          {label}
        </label>
        {hint ? (
          <p id={hintId} className="m-0 mt-0.5 text-sm text-ink-3">
            {hint}
          </p>
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
        className="group inline-flex shrink-0 items-center rounded-full py-2.5 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {/* Transparent py-2.5 keeps a ≥44px touch target; the VISIBLE track is a
            slim h-6 switch (not a fat lozenge). */}
        <span
          aria-hidden="true"
          className={`relative block h-6 w-11 rounded-full transition-colors group-focus-visible:ring-2 group-focus-visible:ring-terracotta-deep group-focus-visible:ring-offset-2 ${
            checked ? 'bg-terracotta-deep' : 'bg-ink/20'
          }`}
        >
          <span
            className={`absolute left-0.5 top-0.5 block h-5 w-5 rounded-full bg-cream shadow-sm transition-transform ${
              checked ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </span>
      </button>
    </div>
  );
}
