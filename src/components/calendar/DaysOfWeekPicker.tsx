import type { ReactElement } from 'react';
import { Text } from '@/components/ui';
import { chipClass } from '@/components/ui/inputStyles';
import { getWeekdayName, orderedWeekdays } from './dateMath';

export interface DaysOfWeekPickerProps {
  /** Id of the group — also the focus target when the field errors. */
  id: string;
  /** Visible label and accessible name of the group ("Repeat on"). */
  label: string;
  /** Selected weekdays, 0=Sun..6=Sat (the `recurrence_days` convention). */
  selected: readonly number[];
  /** Next selection, sorted ascending. */
  onChange: (days: number[]) => void;
  /**
   * A weekday that is always ON and cannot be toggled: the start weekday of a
   * series that has already started (removing it would leave the series anchor
   * off its own pattern).
   */
  lockedDay?: number | null;
  /** Id of the note explaining the lock — the locked chip is described by it. */
  lockedHintId?: string;
  /** Extra ids describing the whole group (e.g. the field error). */
  describedBy?: string;
  /** i18n language — decides the week order and the weekday names. */
  language: string;
  disabled?: boolean;
  /**
   * PK23: a one-line note under the chips (the recipient's time-zone frame).
   * The parent passes it ONLY when the viewer's zone differs from the
   * recipient's; the group is `aria-describedby` it.
   */
  note?: string;
  /** Id for the note element (required to reference it). */
  noteId?: string;
}

/**
 * The "Days of the week" chip row — seven independent toggles, one per weekday,
 * in the locale's week order (`es` Monday first, `en` Sunday first). Pure: the
 * form owns the selection, the lock and every note around it.
 *
 * a11y: a labelled `role="group"` of `role="checkbox"` buttons with
 * `aria-checked` — a MULTI-select, so not ChipSelect's radiogroup, and every
 * chip is its own tab stop (Space/Enter toggle, as native buttons do). The
 * visible text is the short weekday ("Mon") and the accessible name the full
 * one ("Monday"), which contains it (label-in-name). The locked chip stays
 * focusable so its explanation can be reached: `aria-disabled`, not
 * `disabled`, plus `aria-describedby` to the lock note.
 *
 * Styling is the app chip (`chipClass`: ink selected / hairline unselected,
 * 44px tall) — the same control language as the schedule-preset chips above it
 * in the form; the global focus-visible ring is never suppressed.
 */
export function DaysOfWeekPicker({
  id,
  label,
  selected,
  onChange,
  lockedDay = null,
  lockedHintId,
  describedBy,
  language,
  disabled = false,
  note,
  noteId,
}: DaysOfWeekPickerProps): ReactElement {
  const labelId = `${id}-label`;
  const isSelected = (day: number): boolean => day === lockedDay || selected.includes(day);

  function toggle(day: number): void {
    if (disabled || day === lockedDay) return;
    const next = new Set(selected);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    if (lockedDay != null) next.add(lockedDay);
    onChange([...next].sort((a, b) => a - b));
  }

  return (
    <div>
      <Text variant="label" as="span" id={labelId} className="mb-2 ml-1 block">
        {label}
      </Text>
      <div
        id={id}
        role="group"
        aria-labelledby={labelId}
        aria-describedby={
          [describedBy, note && noteId ? noteId : undefined].filter(Boolean).join(' ') || undefined
        }
        // Programmatic focus target for the form's first-error focus: a group
        // is not focusable by default, and a field error must move focus.
        tabIndex={-1}
        className="flex flex-wrap gap-2"
      >
        {orderedWeekdays(language).map((day) => {
          const checked = isSelected(day);
          const locked = day === lockedDay;
          const inert = disabled || locked;
          return (
            <button
              key={day}
              type="button"
              role="checkbox"
              aria-checked={checked}
              aria-label={getWeekdayName(day, 'long', language)}
              aria-disabled={inert ? true : undefined}
              aria-describedby={locked && lockedHintId ? lockedHintId : undefined}
              data-day={day}
              onClick={() => toggle(day)}
              className={`${chipClass(checked)} min-w-[44px] justify-center px-3 ${
                inert ? 'cursor-not-allowed opacity-50 active:scale-100' : ''
              }`}
            >
              {getWeekdayName(day, 'short', language)}
            </button>
          );
        })}
      </div>
      {note && (
        <p id={noteId} className="m-0 ml-1 mt-2 text-sm text-ink-2">
          {note}
        </p>
      )}
    </div>
  );
}
