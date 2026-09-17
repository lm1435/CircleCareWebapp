import { useId, type ReactNode } from 'react';
import { Icon } from './Icon';
import { Text } from './Text';
import { INPUT_SHELL_DISABLED } from './inputStyles';

export interface CheckboxProps {
  /** Controlled checked state. */
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
 * Accessible checkbox — the SELECTION half of the pair whose other half is
 * `Toggle`. A switch says "is this thing allowed to act at all"; a checkbox
 * says "which of these". Drawing both as the same lozenge is what made the
 * reminders fieldset unreadable: six identical switches, two of which meant
 * different kinds of thing. Port of mobile's `CheckboxRow`
 * (mobile/src/screens/calendar/AddEventScreen.tsx), same hierarchy, same box.
 *
 * A `role="checkbox"` button rather than a native `<input type="checkbox">`,
 * for the two reasons `ChipSelect` reaches for `role="radio"` buttons while
 * `RadioGroup` keeps native inputs: globals.css deliberately suppresses
 * `input:focus-visible` (fields animate a border instead, spec §4.5), so a
 * native box would be the one control in the app with NO visible focus
 * affordance; and the check glyph has to be ours (`Icon`), which means owning
 * the box anyway. The native element's only remaining advantage — form
 * submission — is moot here: every consumer is controlled state.
 *
 * Like `Toggle`, the button carries no focus classes of its own. The global
 * `*:focus-visible` ring lands on it (spec §4.1); a second hand-rolled ring on
 * the inner span drew a different focus language from the rest of the app.
 */
export function Checkbox({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
  id,
}: CheckboxProps): ReactNode {
  const generatedId = useId();
  const checkboxId = id ?? generatedId;
  const labelId = `${checkboxId}-label`;
  const hintId = `${checkboxId}-hint`;

  return (
    // items-start, not items-center: with a `hint` the label is a two-line
    // column and the box must stay pinned to line ONE (mobile's `baselineRow`).
    // Spanish runs 15-30% longer, so the wrapped case is the common case, not
    // the edge case. gap-0.5 (2px) + the button's own px-2.5 (10px) is the 12px
    // mobile draws between box and label — see the margin note below.
    <div className="flex items-start gap-0.5">
      <button
        id={checkboxId}
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={hint ? hintId : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`group inline-flex shrink-0 items-center rounded-sm -ml-2.5 px-2.5 py-2.5 disabled:cursor-not-allowed ${
          disabled ? INPUT_SHELL_DISABLED : ''
        }`}
      >
        {/* Transparent 10px on all four sides keeps a 44×44 target around a
            VISIBLE 24×24 box (Toggle's technique, now on both axes because a
            square box has no w-11 track to borrow width from). The -ml-2.5
            cancels the left half back out so the box still sits flush with the
            block's left edge instead of indenting every row by 10px. */}
        <span
          aria-hidden="true"
          className={`flex h-6 w-6 items-center justify-center rounded-sm border transition-colors duration-fast ${
            checked ? 'border-moss bg-moss text-cream' : 'border-line bg-cream'
          }`}
        >
          {checked ? <Icon name="checkmark" size="meta" /> : null}
        </span>
      </button>
      {/* py-2.5 mirrors the button's, which is the whole alignment trick: both
          columns start 10px down, and `bodyDense`'s 24px line box is exactly the
          box's 24px, so the two centres land on the same pixel — with or without
          a hint, and after the label wraps. */}
      <div className="min-w-0 flex-1 py-2.5">
        <label
          id={labelId}
          htmlFor={checkboxId}
          className={disabled ? `block ${INPUT_SHELL_DISABLED}` : 'block cursor-pointer'}
        >
          <Text variant="bodyDense" as="span" className="block">
            {label}
          </Text>
        </label>
        {hint ? (
          <Text variant="caption" id={hintId} className="mt-0.5">
            {hint}
          </Text>
        ) : null}
      </div>
    </div>
  );
}
