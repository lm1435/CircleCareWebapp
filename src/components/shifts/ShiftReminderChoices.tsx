import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox, Text, Toggle } from '@/components/ui';
import {
  SHIFT_LEAD_ROWS,
  formatShiftReminder,
  setShiftRemindersEnabled,
  toggleShiftLead,
  type ShiftReminderState,
} from './shiftUtils';

export interface ShiftReminderChoicesProps {
  value: ShiftReminderState;
  onChange: (next: ShiftReminderState) => void;
  disabled?: boolean;
  /** Element ids (`shift_reminder` on the form; the Take dialog passes its own). */
  idPrefix?: string;
  /** Test ids (`shift-form-reminder` on the form). */
  testIdPrefix?: string;
  /** The hint under the card (the form's "Sent to whoever is on the shift."), referenced by the group. */
  describedBy?: string;
}

/**
 * The shift Reminders card's contents, drawn like the task card (AddEventModal): "Enable notifications", then
 * "Remind before the shift" and one checkbox per lead, longest first. Since 1.4.2 a shift keeps SEVERAL lead
 * times (`reminder_leads_minutes`), so each row checks on its own; unchecking the last one turns the toggle off
 * (the task card's rule). Off keeps the list shown, greyed, with its checks; back on restores them (1 hour if
 * none). The parent saves `shiftRemindersForSave(value)`: the leads, or `null`. Mobile twin:
 * mobile/src/components/shifts/ShiftReminderChoices.tsx.
 */
export function ShiftReminderChoices({
  value,
  onChange,
  disabled = false,
  idPrefix = 'shift_reminder',
  testIdPrefix = 'shift-form-reminder',
  describedBy,
}: ShiftReminderChoicesProps): ReactElement {
  const { t } = useTranslation(['shifts', 'calendar']);
  const rowsDisabled = disabled || !value.enabled;
  return (
    <>
      <Toggle
        id={`${idPrefix}_enabled`}
        label={t('calendar:addEvent.reminders.enable')}
        checked={value.enabled}
        disabled={disabled}
        onChange={(on) => onChange(setShiftRemindersEnabled(value, on))}
      />
      <div
        role="group"
        aria-labelledby={`${idPrefix}-label`}
        aria-describedby={describedBy}
        aria-disabled={rowsDisabled ? true : undefined}
        data-testid={testIdPrefix}
        className={`flex flex-col gap-2 rounded-xl border border-line-2 p-3 ${rowsDisabled ? 'opacity-60' : ''}`}
      >
        <Text variant="label" as="span" id={`${idPrefix}-label`}>
          {t('shifts:form.remindBefore')}
        </Text>
        {SHIFT_LEAD_ROWS.map((lead) => (
          <Checkbox
            key={lead}
            data-testid={`${testIdPrefix}-${lead}`}
            label={formatShiftReminder(lead, t)}
            // Off keeps the checks on screen (greyed): the toggle restores exactly these.
            checked={value.leads.includes(lead)}
            disabled={rowsDisabled}
            onChange={() => onChange(toggleShiftLead(value, lead))}
          />
        ))}
      </div>
    </>
  );
}
