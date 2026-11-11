import type { ReactElement } from 'react';
import {
  CHIP_SELECTED,
  CHIP_UNSELECTED,
  CHOICE_TILE_BOX,
  CHOICE_TILE_LABEL,
  choiceTileSubClass,
} from './inputStyles';

/**
 * The caption line of a VALUE tile (13/500 muted: `hierarchy="value"`'s label size), shared with the simple forms'
 * picker value tiles ("Starts", "Repeats until", "From", "To"; owner 2026-11-10).
 */
export const VALUE_TILE_LABEL = 'max-w-full text-[13px] font-medium text-ink-2';

/** The unselected tile with the error border instead of the resting one (one border color per class string). */
const TILE_INVALID = 'border-terracotta text-ink hover:bg-bg-2';

/**
 * ONE choice tile that is a BUTTON, not a radio: the SAME box as the time chips and `ChipSelect variant="tile"`
 * (`choiceTileClass`), label over an optional second line, selected = dark. For the simple forms' controls that
 * open something ("Starts" / "Ends" on the shift form, "Other day" / "Pick a time" on the task form, "Other time"
 * is TimeChips' own). Mobile twin: `ChoiceTile` in StackedChoice.tsx.
 *
 * `subSpacer` keeps an invisible second line when there is none, so a one-line tile stays as tall as its two-line
 * neighbours. The accessible name reads both lines ("Ends, 6:00 AM next day").
 */
export interface ChoiceTileButtonProps {
  label: string;
  sub?: string;
  subSpacer?: boolean;
  onClick: () => void;
  selected?: boolean;
  disabled?: boolean;
  /** `aria-expanded` when the tile reveals something in place. */
  expanded?: boolean;
  /** Extra description ids (an error line, a hint). */
  describedBy?: string;
  /** Draw the error border (a required answer missing). */
  invalid?: boolean;
  id?: string;
  testId?: string;
  ariaLabel?: string;
  /**
   * `value`: the second line is the MAIN text (Starts / Ends: the time is what you read), the label a small
   * muted caption above it (13/500 vs body size 500). Default `label`: the label leads.
   */
  hierarchy?: 'label' | 'value';
}

export function ChoiceTileButton({
  label,
  sub,
  subSpacer,
  onClick,
  selected = false,
  disabled = false,
  expanded,
  describedBy,
  invalid = false,
  id,
  testId,
  ariaLabel,
  hierarchy = 'label',
}: ChoiceTileButtonProps): ReactElement {
  return (
    <button
      type="button"
      id={id}
      data-testid={testId}
      aria-label={ariaLabel ?? (sub ? `${label}, ${sub}` : undefined)}
      aria-expanded={expanded}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      disabled={disabled}
      onClick={onClick}
      className={`${CHOICE_TILE_BOX} ${selected ? CHIP_SELECTED : invalid ? TILE_INVALID : CHIP_UNSELECTED}${disabled ? ' cursor-default opacity-50' : ' cursor-pointer'}`}
    >
      <span
        className={
          hierarchy === 'value'
            ? `max-w-full text-[13px] font-medium ${selected ? 'text-cream/80' : 'text-ink-2'}`
            : CHOICE_TILE_LABEL
        }
      >
        {label}
      </span>
      {sub ? (
        <span
          className={
            hierarchy === 'value'
              ? `max-w-full text-base font-medium ${selected ? 'text-cream' : 'text-ink'}`
              : choiceTileSubClass(selected)
          }
        >
          {sub}
        </span>
      ) : subSpacer ? (
        <span aria-hidden="true" className={`${choiceTileSubClass(false)} invisible`}>
          {' '}
        </span>
      ) : null}
    </button>
  );
}
