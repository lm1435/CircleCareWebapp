import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import {
  eventFormSchema,
  type CalendarEvent,
  type CreateEventRequest,
  type EventType,
} from '@/api/calendarEvents';
import { useCreateEvent, useUpdateEvent } from '@/hooks/useCalendarEvents';
import { useCircle } from '@/hooks/useCircle';
import {
  Button,
  DateField,
  Modal,
  Select,
  TextArea,
  TextField,
  TimeField,
  Toggle,
  useToast,
  validateWithZod,
  focusFirstError,
  type FieldErrors,
} from '@/components/ui';
import {
  formatDateTimeForAPI,
  getDateInTimezone,
  getTimezoneAbbreviation,
  getTimezoneLabel,
} from '@/utils/timezone';

// Task 1.4 — create/edit form modal for all three event types.
//
// MIRRORS mobile/src/screens/calendar/AddEventScreen.tsx:
//   - three event_types with a type selector (locked in edit mode, like mobile)
//   - title (medication uses medication_name), date, optional time (→ all-day),
//     end time / duration for appt/task, location, notes, recurrence picker
//     (daily | every_other_day | weekly | monthly | yearly | cycle:N:M) +
//     recurrence end date, assignee picker (task/appt), medication dosage,
//     reminder toggles.
//
// TIMEZONE (CRITICAL): the date + time the form sends are the CARE RECIPIENT's
// naive local values. We combine the picked YYYY-MM-DD + HH:MM into a single
// device-local instant and hand it to formatDateTimeForAPI(instant, recipientTz)
// — which re-reads that instant AS SEEN IN the recipient timezone (mobile's
// handleSubmit formatToParts block). NEVER new Date(`${d}T${t}`)/.getHours()/
// .split('T')[0]. For all-day (no time) we use getDateInTimezone on a noon
// instant so the date never slips across midnight.

export interface AddEventModalProps {
  circleId: string;
  /** Existing event when editing; omit/undefined for create. */
  event?: CalendarEvent | null;
  /** Pre-select the event type in create mode (e.g. Tasks page → 'task'). */
  initialType?: EventType;
  onClose: () => void;
  /** Called after a successful create/update (parent typically closes + toasts). */
  onSaved?: () => void;
}

/** Reminder flags present on the single-event detail response (not on the list type). */
interface EventReminderFields {
  notifications_enabled?: boolean;
  reminder_24h?: boolean;
  reminder_1h?: boolean;
  reminder_30m?: boolean;
  reminder_15m?: boolean;
}

type RecurrenceChoice =
  | 'none'
  | 'daily'
  | 'every_other_day'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'cycle';

const RECURRENCE_CHOICES: RecurrenceChoice[] = [
  'none',
  'daily',
  'every_other_day',
  'weekly',
  'monthly',
  'yearly',
  'cycle',
];

/** Map a stored recurrence_rule back to the form's choice + cycle parts. */
function parseRecurrence(rule: string | null | undefined): {
  choice: RecurrenceChoice;
  daysOn: string;
  daysOff: string;
} {
  if (!rule) return { choice: 'none', daysOn: '7', daysOff: '7' };
  if (rule.startsWith('cycle:')) {
    const [, on, off] = rule.split(':');
    return { choice: 'cycle', daysOn: on || '7', daysOff: off || '7' };
  }
  if ((RECURRENCE_CHOICES as string[]).includes(rule)) {
    return { choice: rule as RecurrenceChoice, daysOn: '7', daysOff: '7' };
  }
  return { choice: 'none', daysOn: '7', daysOff: '7' };
}

/** Combine YYYY-MM-DD + HH:MM into a single device-local instant. */
function combineDateTime(dateStr: string, timeStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

export function AddEventModal({
  circleId,
  event,
  initialType,
  onClose,
  onSaved,
}: AddEventModalProps): ReactElement | null {
  const { t } = useTranslation(['calendar', 'common']);
  const { showToast } = useToast();
  const { timezone, canEdit, members } = useCircle(circleId);

  const createEvent = useCreateEvent(circleId);
  const updateEvent = useUpdateEvent(circleId);

  const isEditing = !!event;
  // Edits ALWAYS target the parent series (mobile has no "this event only" edit).
  const targetEventId = isEditing ? event.parent_event_id || event.id : undefined;

  const [eventType, setEventType] = useState<EventType>(
    event?.event_type ?? initialType ?? 'medication'
  );
  const [title, setTitle] = useState(event?.medication_name || event?.title || '');
  const [dosage, setDosage] = useState(event?.medication_dosage ?? '');
  const [dateStr, setDateStr] = useState(event?.scheduled_date ?? getDateInTimezone(timezone));
  const [timeStr, setTimeStr] = useState(() => {
    const raw = event?.scheduled_time;
    return raw ? raw.slice(0, 5) : '';
  });
  const [endTimeStr, setEndTimeStr] = useState(() => {
    if (!event?.scheduled_time || !event?.duration_minutes) return '';
    const [hh, mm] = event.scheduled_time.split(':').map(Number);
    const total = hh * 60 + mm + event.duration_minutes;
    const eh = Math.floor((total % 1440) / 60);
    const em = total % 60;
    return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
  });
  const [location, setLocation] = useState(event?.location ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [assignedTo, setAssignedTo] = useState<string | null>(event?.assigned_to ?? null);

  const initialRecurrence = parseRecurrence(event?.recurrence_rule);
  const [recurrence, setRecurrence] = useState<RecurrenceChoice>(initialRecurrence.choice);
  const [daysOn, setDaysOn] = useState(initialRecurrence.daysOn);
  const [daysOff, setDaysOff] = useState(initialRecurrence.daysOff);
  const [recurrenceEndDate, setRecurrenceEndDate] = useState(event?.recurrence_end_date ?? '');

  // Reminder flags live on the single-event detail response but aren't on the
  // calendar-list CalendarEvent read type — read them defensively for prefill.
  const reminders = (event ?? {}) as EventReminderFields;
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    reminders.notifications_enabled ?? true
  );
  const [reminder24h, setReminder24h] = useState(reminders.reminder_24h ?? false);
  const [reminder1h, setReminder1h] = useState(reminders.reminder_1h ?? false);
  const [reminder30m, setReminder30m] = useState(reminders.reminder_30m ?? false);
  const [reminder15m, setReminder15m] = useState(reminders.reminder_15m ?? true);

  const [errors, setErrors] = useState<FieldErrors>({});

  // Keep the assignee selection valid as members load.
  useEffect(() => {
    if (assignedTo && !members.some((m) => m.id === assignedTo)) {
      setAssignedTo(null);
    }
  }, [assignedTo, members]);

  const isMedication = eventType === 'medication';
  const isPending = createEvent.isPending || updateEvent.isPending;

  const tzLabel = `${getTimezoneLabel(timezone)} (${getTimezoneAbbreviation(timezone)})`;

  // Assignee options — caregivers only (exclude the care recipient), like mobile.
  const assigneeOptions = useMemo(() => {
    const opts = members
      .filter((m) => !m.is_care_recipient)
      .map((m) => ({
        value: m.id,
        label: m.first_name || m.email.split('@')[0],
      }));
    return [{ value: '', label: t('addEvent.anyone') }, ...opts];
  }, [members, t]);

  const recurrenceOptions = useMemo(
    () =>
      RECURRENCE_CHOICES.map((choice) => ({
        value: choice,
        label:
          choice === 'none'
            ? t('addEvent.recurrence.never')
            : t(`addEvent.recurrence.${recurrenceKey(choice)}`),
      })),
    [t]
  );

  function clearError(field: string): void {
    setErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function buildPayload():
    | { ok: true; data: CreateEventRequest }
    | { ok: false; errors: FieldErrors } {
    const fieldErrors: FieldErrors = {};

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      fieldErrors[isMedication ? 'medication_name' : 'title'] = t(
        isMedication
          ? 'addEvent.validation.medicationRequired'
          : 'addEvent.validation.titleRequired'
      );
    }
    if (!dateStr) {
      fieldErrors.scheduled_date = t('addEvent.validation.dateRequired');
    }
    if (isMedication && !timeStr) {
      fieldErrors.scheduled_time = t('addEvent.validation.timeRequired');
    }
    if (!isMedication) {
      if (timeStr && !endTimeStr) {
        fieldErrors.endTime = t('addEvent.validation.endTimeRequired');
      } else if (timeStr && endTimeStr) {
        const [sh, sm] = timeStr.split(':').map(Number);
        const [eh, em] = endTimeStr.split(':').map(Number);
        if (eh * 60 + em <= sh * 60 + sm) {
          fieldErrors.endTime = t('addEvent.validation.endTimeAfterStart');
        }
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      return { ok: false, errors: fieldErrors };
    }

    // TZ-correct scheduling. With a time, format the combined instant in the
    // recipient's timezone (handles a midnight-crossing TZ shift). Without a
    // time (all-day), format a noon instant so the date never slips a day.
    let scheduled_date: string;
    let scheduled_time: string | undefined;
    if (timeStr) {
      const instant = combineDateTime(dateStr, timeStr);
      const formatted = formatDateTimeForAPI(instant, timezone);
      scheduled_date = formatted.scheduled_date;
      scheduled_time = formatted.scheduled_time;
    } else {
      const noon = combineDateTime(dateStr, '12:00');
      scheduled_date = getDateInTimezone(timezone, noon);
      scheduled_time = undefined;
    }

    let durationMinutes: number | undefined;
    if (!isMedication && timeStr && endTimeStr) {
      const [sh, sm] = timeStr.split(':').map(Number);
      const [eh, em] = endTimeStr.split(':').map(Number);
      durationMinutes = eh * 60 + em - (sh * 60 + sm);
    }

    let recurrence_rule: string | undefined;
    if (recurrence === 'cycle') {
      recurrence_rule = `cycle:${parseInt(daysOn, 10) || 7}:${parseInt(daysOff, 10) || 7}`;
    } else if (recurrence !== 'none') {
      recurrence_rule = recurrence;
    }

    const data: CreateEventRequest = {
      event_type: eventType,
      title: trimmedTitle,
      description: description.trim() || undefined,
      scheduled_date,
      scheduled_time,
      duration_minutes: durationMinutes,
      location: location.trim() || undefined,
      notifications_enabled: notificationsEnabled,
      reminder_24h: notificationsEnabled ? reminder24h : false,
      reminder_1h: notificationsEnabled ? reminder1h : false,
      reminder_30m: notificationsEnabled ? reminder30m : false,
      reminder_15m: notificationsEnabled ? reminder15m : false,
      recurrence_rule,
      recurrence_end_date:
        recurrence !== 'none' && recurrenceEndDate ? recurrenceEndDate : undefined,
    };

    if (isMedication) {
      data.medication_name = trimmedTitle;
      data.medication_dosage = dosage.trim() || undefined;
    }
    if ((eventType === 'task' || eventType === 'appointment') && assignedTo) {
      data.assigned_to = assignedTo;
    }

    // Final guard: validate against the shared web Zod schema (mirrors backend).
    const result = validateWithZod(eventFormSchema, data);
    if (!result.success) {
      return { ok: false, errors: result.errors };
    }
    return { ok: true, data };
  }

  async function handleSubmit(formEvent: FormEvent): Promise<void> {
    formEvent.preventDefault();
    if (!canEdit || isPending) return;

    const built = buildPayload();
    if (!built.ok) {
      setErrors(built.errors);
      // Cover every field that can error so focus always lands on an errored
      // control — including the title id for the OTHER type and the Zod-derived
      // fields (description, location, dosage, recurrence) (WCAG SC 3.3.1).
      focusFirstError(built.errors, [
        'medication_name',
        'title',
        'medication_dosage',
        'scheduled_date',
        'scheduled_time',
        'endTime',
        'location',
        'description',
        'assigned_to',
        'recurrence_rule',
        'recurrence_end_date',
      ]);
      return;
    }
    setErrors({});

    try {
      if (isEditing && targetEventId) {
        await updateEvent.mutateAsync({ eventId: targetEventId, data: built.data });
        showToast(t('addEvent.updated'), 'success');
      } else {
        await createEvent.mutateAsync(built.data);
        showToast(t('addEvent.created'), 'success');
      }
      onSaved?.();
      onClose();
    } catch {
      // The mutation hooks surface their own permission/subscription/save toasts.
    }
  }

  // Hidden entirely when the user can't edit — the read-only path keeps the
  // EventDetailModal download CTA instead (Task 1.6 gating).
  if (!canEdit) return null;

  const typeOptions = (['medication', 'appointment', 'task'] as EventType[]).map((type) => ({
    value: type,
    label: t(`addEvent.types.${type}`),
  }));

  const titleFieldId = isMedication ? 'medication_name' : 'title';

  return (
    <Modal
      title={isEditing ? t('addEvent.editTitle') : t('addEvent.newTitle')}
      onClose={onClose}
      closeLabel={t('addEvent.close')}
      size="lg"
      closeOnBackdropClick={false}
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            {t('common:cancel')}
          </Button>
          <Button type="submit" form="add-event-form" disabled={isPending}>
            {isPending
              ? t('addEvent.creating')
              : isEditing
                ? t('addEvent.saveChanges')
                : t('addEvent.create')}
          </Button>
        </div>
      }
    >
      <form id="add-event-form" onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {/* Type selector — locked in edit mode, like mobile. */}
        <Select
          id="event_type"
          label={t('addEvent.fields.type')}
          options={typeOptions}
          value={eventType}
          disabled={isEditing}
          onChange={(e) => {
            const next = e.target.value as EventType;
            setEventType(next);
            if (next !== 'task' && next !== 'appointment') setAssignedTo(null);
            if (next === 'medication') setEndTimeStr('');
          }}
        />

        <TextField
          id={titleFieldId}
          label={t(isMedication ? 'addEvent.fields.medicationName' : 'addEvent.fields.title')}
          value={title}
          maxLength={150}
          error={errors[titleFieldId]}
          placeholder={t(
            isMedication
              ? 'addEvent.placeholders.medicationName'
              : eventType === 'appointment'
                ? 'addEvent.placeholders.appointmentTitle'
                : 'addEvent.placeholders.taskTitle'
          )}
          onChange={(e) => {
            setTitle(e.target.value);
            clearError(titleFieldId);
          }}
        />

        {isMedication && (
          <TextField
            id="medication_dosage"
            label={t('addEvent.fields.dosage')}
            value={dosage}
            maxLength={100}
            placeholder={t('addEvent.placeholders.dosage')}
            onChange={(e) => setDosage(e.target.value)}
          />
        )}

        {eventType === 'appointment' && (
          <TextField
            id="location"
            label={t('addEvent.fields.location')}
            value={location}
            maxLength={250}
            placeholder={t('addEvent.placeholders.location')}
            onChange={(e) => setLocation(e.target.value)}
          />
        )}

        <DateField
          id="scheduled_date"
          label={t('addEvent.fields.date')}
          value={dateStr}
          error={errors.scheduled_date}
          hint={t('addEvent.hints.timesShownIn', { timezone: tzLabel })}
          onChange={(e) => {
            setDateStr(e.target.value);
            clearError('scheduled_date');
          }}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TimeField
            id="scheduled_time"
            label={t('addEvent.fields.time')}
            value={timeStr}
            error={errors.scheduled_time}
            hint={isMedication ? undefined : t('addEvent.hints.timeOptional')}
            onChange={(e) => {
              setTimeStr(e.target.value);
              clearError('scheduled_time');
              if (!e.target.value) setEndTimeStr('');
            }}
          />
          {!isMedication && (
            <TimeField
              id="endTime"
              label={t('addEvent.fields.endTime')}
              value={endTimeStr}
              error={errors.endTime}
              disabled={!timeStr}
              onChange={(e) => {
                setEndTimeStr(e.target.value);
                clearError('endTime');
              }}
            />
          )}
        </div>

        {(eventType === 'task' || eventType === 'appointment') && (
          <Select
            id="assigned_to"
            label={t('addEvent.fields.assignedTo')}
            options={assigneeOptions}
            value={assignedTo ?? ''}
            onChange={(e) => setAssignedTo(e.target.value || null)}
          />
        )}

        <TextArea
          id="description"
          label={t('addEvent.fields.notes')}
          value={description}
          rows={3}
          maxLength={850}
          placeholder={t('addEvent.placeholders.notes')}
          onChange={(e) => setDescription(e.target.value)}
        />

        {/* Recurrence */}
        <Select
          id="recurrence_rule"
          label={t('addEvent.fields.repeat')}
          options={recurrenceOptions}
          value={recurrence}
          onChange={(e) => setRecurrence(e.target.value as RecurrenceChoice)}
        />

        {recurrence === 'cycle' && (
          <div className="grid grid-cols-2 gap-4">
            <TextField
              id="cycle_days_on"
              label={t('addEvent.fields.daysOn')}
              type="number"
              min={1}
              max={999}
              value={daysOn}
              onChange={(e) => setDaysOn(e.target.value)}
            />
            <TextField
              id="cycle_days_off"
              label={t('addEvent.fields.daysOff')}
              type="number"
              min={1}
              max={999}
              value={daysOff}
              onChange={(e) => setDaysOff(e.target.value)}
            />
          </div>
        )}

        {recurrence !== 'none' && (
          <DateField
            id="recurrence_end_date"
            label={t('addEvent.fields.endDate')}
            value={recurrenceEndDate}
            hint={t('addEvent.hints.endDate')}
            onChange={(e) => setRecurrenceEndDate(e.target.value)}
          />
        )}

        {/* Reminders */}
        <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
          <legend className="section-title p-0">{t('addEvent.reminders.section')}</legend>
          <Toggle
            label={t('addEvent.reminders.enable')}
            hint={t('addEvent.reminders.enableHint')}
            checked={notificationsEnabled}
            onChange={setNotificationsEnabled}
          />
          {notificationsEnabled && (
            <div className="flex flex-col gap-2 rounded-xl border border-line-2 p-3">
              <span className="section-title-sm">{t('addEvent.reminders.additional')}</span>
              <Toggle
                label={t('addEvent.reminders.h24')}
                checked={reminder24h}
                onChange={setReminder24h}
              />
              <Toggle
                label={t('addEvent.reminders.h1')}
                checked={reminder1h}
                onChange={setReminder1h}
              />
              <Toggle
                label={t('addEvent.reminders.m30')}
                checked={reminder30m}
                onChange={setReminder30m}
              />
              <Toggle
                label={t('addEvent.reminders.m15')}
                checked={reminder15m}
                onChange={setReminder15m}
              />
            </div>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}

/** Map a recurrence choice to its i18n key under addEvent.recurrence.*. */
function recurrenceKey(choice: RecurrenceChoice): string {
  switch (choice) {
    case 'every_other_day':
      return 'everyOtherDay';
    default:
      return choice;
  }
}
