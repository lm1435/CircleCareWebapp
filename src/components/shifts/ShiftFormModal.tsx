import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent, CreateEventRequest } from '@/api/calendarEvents';
import type { ShiftScope } from '@/api/shifts';
import {
  Button,
  ChipSelect,
  DateField,
  Icon,
  Modal,
  RadioGroup,
  Select,
  TextField,
  TimeField,
  focusFirstError,
  useToast,
  type FieldErrors,
} from '@/components/ui';
import { INPUT_ERROR } from '@/components/ui/inputStyles';
import { DaysOfWeekPicker } from '@/components/calendar/DaysOfWeekPicker';
import { formatWeekdayList } from '@/components/calendar/recurrenceLabel';
import { getDayOfWeek, nextDateOnWeekdays } from '@/components/calendar/dateMath';
import { useCircle } from '@/hooks/useCircle';
import { useCreateShift, useHandleShiftFailure, useUpdateShift } from '@/hooks/useShifts';
import { useGuardedSubmit } from '@/hooks/useGuardedSubmit';
import { useAuthStore } from '@/store/authStore';
import { Analytics } from '@/lib/analytics';
import { resolveShiftsEntry } from '@/lib/shiftsAccess';
import { ShiftInlineError } from './ShiftInlineError';
import { spanMinutes } from '@/lib/eventForm';
import { defaultNewEventDate } from '@/utils/recipientEventDate';
import { getTimezoneLabel } from '@/utils/timezone';
import {
  DEFAULT_SHIFT_REMINDER_LEAD,
  MAX_SHIFT_MINUTES,
  MIN_SHIFT_MINUTES,
  SHIFT_NAME_MAX,
  formatShiftDuration,
  isShiftRepeating,
  memberShortName,
  recurrenceEnum,
  reminderEnum,
  shiftEnd,
  shiftRootId,
  shiftZonesDiffer,
  canCoverShifts,
} from './shiftUtils';

export type ShiftRepeatChoice = 'none' | 'daily' | 'weekly' | 'days_of_week';

export interface ShiftFormPrefill {
  name?: string;
  date?: string;
  /** `HH:MM`. */
  startTime?: string;
  endTime?: string;
  repeat?: ShiftRepeatChoice;
  days?: number[];
  repeatEndDate?: string;
  reminder?: number | null;
}

export type ShiftFormSource = 'add_menu' | 'shifts_view' | 'empty_state' | 'add_next';

export interface ShiftFormModalProps {
  circleId: string;
  /** Present when editing. */
  shift?: CalendarEvent | null;
  /** Create mode only: the date the calendar is on (defaults to the recipient's today). */
  initialDate?: string;
  prefill?: ShiftFormPrefill;
  source?: ShiftFormSource;
  onClose: () => void;
  /** Called with the saved shift on a CREATE (the composer then shows "saved"). */
  onCreated?: (shift: CalendarEvent, prefillNext: ShiftFormPrefill) => void;
  onUpdated?: () => void;
}

const REMINDER_OPTIONS: Array<{ value: string; lead: number | null }> = [
  { value: 'off', lead: null },
  { value: '60', lead: 60 },
  { value: '120', lead: 120 },
  { value: '240', lead: 240 },
  { value: '1440', lead: 1440 },
];

const DEFAULT_START = '08:00';
const DEFAULT_END = '14:00';

const hm = (time: string | null | undefined): string => (time ? time.slice(0, 5) : '');

/**
 * New / edit shift (docs/plans/care-shifts.md, step 5). A modal on web.
 *
 * TIME FRAME: the times, the date and the repeat days are entered in the CARE
 * RECIPIENT's timezone (the frame shifts are stored and shown in), and the form
 * says so when the viewer's zone differs. Unlike the event form there is no
 * viewer-to-recipient conversion: "Night 8 PM - 8 AM" is the recipient's night,
 * and a conversion would also rotate the weekdays of a days-of-week series.
 *
 * EDIT: a repeating shift asks "This shift / All upcoming shifts" first.
 * This shift PATCHes that occurrence's own id; future PATCHes the series root.
 * Date and repeat are not editable on a series (delete it and add a new one).
 */
export function ShiftFormModal(props: ShiftFormModalProps): ReactElement | null {
  const { t } = useTranslation(['shifts', 'common']);
  const { circle, timezone, canEdit, isError, viewOnly, isPremiumCircle, isOwner, hasShifts } =
    useCircle(props.circleId);
  const { showToast } = useToast();

  // PREMIUM LAPSED WHILE THIS FORM IS OPEN ('readonly'): saving would only hit a 402/403. Close
  // it and say why (the toast outlives the dialog), instead of letting the save fail.
  const readonly =
    resolveShiftsEntry({ viewOnly, isPremiumCircle, isOwner, hasShifts }) === 'readonly';
  const { onClose: closeForm } = props;
  const readonlyHandled = useRef(false);
  useEffect(() => {
    if (!readonly || readonlyHandled.current) return;
    readonlyHandled.current = true;
    showToast(isOwner ? t('shifts:readOnly.owner') : t('shifts:readOnly.other'), 'error');
    closeForm();
  }, [readonly, isOwner, showToast, t, closeForm]);
  if (readonly) return null;

  // HYDRATION GATE: the form's initial state (the default date in the RECIPIENT's
  // zone, the assignee list, the heading) is read once on mount, so nothing
  // renders until the circle (zone + members) is held. Gate on "do we hold the
  // data", not on isLoading: a failed fetch must not resolve into a blank form.
  if (!circle || !timezone) {
    return (
      <Modal
        size="md"
        title={props.shift ? t('shifts:form.editTitle') : t('shifts:form.newTitle')}
        closeLabel={t('shifts:close')}
        onClose={props.onClose}
      >
        <p role="status" data-testid="shift-form-loading" className="m-0 text-base text-ink-2">
          {isError ? t('shifts:loadError') : t('common:loading')}
        </p>
      </Modal>
    );
  }
  if (!canEdit) return null;
  return <ShiftFormBody {...props} />;
}

function ShiftFormBody({
  circleId,
  shift,
  initialDate,
  prefill,
  source = 'shifts_view',
  onClose,
  onCreated,
  onUpdated,
}: ShiftFormModalProps): ReactElement | null {
  const { t, i18n } = useTranslation(['shifts', 'calendar', 'common']);
  const { circle, timezone, members, canEdit, canManageMembers } = useCircle(circleId);
  const viewerId = useAuthStore((s) => s.user?.id ?? null);
  const createShift = useCreateShift(circleId);
  const updateShift = useUpdateShift(circleId);

  const isEditing = !!shift;
  const repeatingEdit = isEditing && isShiftRepeating(shift);
  const language = i18n.language;

  const [name, setName] = useState(shift?.title ?? prefill?.name ?? '');
  const [date, setDate] = useState(
    shift?.scheduled_date ?? prefill?.date ?? initialDate ?? defaultNewEventDate(timezone)
  );
  // New shifts start from 08:00 - 14:00; "add next" carries start = previous end, end empty.
  const [startTime, setStartTime] = useState(
    hm(shift?.scheduled_time) || prefill?.startTime || (prefill ? '' : DEFAULT_START)
  );
  const [endTime, setEndTime] = useState(() => {
    if (shift?.scheduled_time && shift.duration_minutes) {
      return shiftEnd(shift.scheduled_date, shift.scheduled_time, shift.duration_minutes).time;
    }
    return prefill ? (prefill.endTime ?? '') : DEFAULT_END;
  });
  const [repeat, setRepeat] = useState<ShiftRepeatChoice>(prefill?.repeat ?? 'none');
  const [days, setDays] = useState<number[]>(prefill?.days ?? []);
  const [repeatEndDate, setRepeatEndDate] = useState(prefill?.repeatEndDate ?? '');
  const [reminder, setReminder] = useState<string>(() => {
    const lead = shift ? (shift.reminder_lead_minutes ?? null) : (prefill?.reminder ?? DEFAULT_SHIFT_REMINDER_LEAD);
    return lead === null ? 'off' : String(lead);
  });
  const initialAssignee = shift?.assigned_to ?? '';
  const [assignedTo, setAssignedTo] = useState<string>(initialAssignee);
  const [editScope, setEditScope] = useState<ShiftScope>('occurrence');
  const [errors, setErrors] = useState<FieldErrors>({});

  // Dropping the dialog entirely for someone who cannot write (the page gates
  // every entry point, this is defence in depth).
  const recipientName = circle?.recipient_name ?? '';

  const span = startTime && endTime ? spanMinutes(startTime, endTime) : null;
  const nextDay = !!startTime && !!endTime && endTime <= startTime;

  // Leave open, Me, then the other members in roster order. The CURRENT holder
  // is always listed (even if this editor could not pick them) and marked.
  const assigneeOptions = useMemo(() => {
    const mark = (label: string, id: string): string =>
      initialAssignee && id === initialAssignee ? `${label} · ${t('shifts:assign.current')}` : label;
    const opts = [{ value: '', label: t('shifts:form.leaveOpen') }];
    if (viewerId && canCoverShifts(members, viewerId)) opts.push({ value: viewerId, label: mark(t('shifts:form.me'), viewerId) });
    for (const m of members) {
      if (m.id === viewerId) continue;
      if (m.is_care_recipient === true) continue;
      const isHolder = m.id === initialAssignee;
      if (!isHolder && (!canManageMembers || m.view_only === true)) continue;
      const label = memberShortName(m);
      opts.push({ value: m.id, label: mark(label, m.id) });
    }
    // A holder who has left the circle still reads.
    if (initialAssignee && !opts.some((o) => o.value === initialAssignee)) {
      const name = shift?.assigned_to_user?.first_name?.trim() || t('shifts:someone');
      opts.push({ value: initialAssignee, label: mark(name, initialAssignee) });
    }
    return opts;
  }, [t, viewerId, canManageMembers, members, initialAssignee, shift]);

  // Judged at the shift's own date (Phoenix and Denver agree in January only).
  const zonesDiffer = shiftZonesDiffer(date, timezone);
  // Shift dates are RECIPIENT-frame (stored naive, shown in the recipient's
  // zone), so the picker's "Today" must be the recipient's today, not ours.
  const recipientToday = defaultNewEventDate(timezone) || undefined;

  const handleFailure = useHandleShiftFailure();
  const [saveError, setSaveError] = useState('');
  const failSave = (err: unknown, verb: 'edit' | 'save'): void => {
    const outcome = handleFailure(err, verb);
    if (outcome.close) onClose();
    else setSaveError(outcome.message);
  };

  const clearError = (...fields: string[]): void =>
    setErrors((prev) => {
      if (!fields.some((f) => f in prev)) return prev;
      const next = { ...prev };
      for (const f of fields) delete next[f];
      return next;
    });

  function validate(): FieldErrors {
    const e: FieldErrors = {};
    const trimmed = name.trim();
    if (!trimmed) e.shift_name = t('shifts:validation.nameRequired');
    else if (trimmed.length > SHIFT_NAME_MAX) e.shift_name = t('shifts:validation.nameTooLong');
    if (!repeatingEdit && !date) e.shift_date = t('shifts:validation.dateRequired');
    if (!startTime) e.shift_start = t('shifts:validation.startRequired');
    if (!endTime) e.shift_end = t('shifts:validation.endRequired');
    if (span !== null) {
      if (span < MIN_SHIFT_MINUTES) e.shift_end = t('shifts:validation.tooShort');
      else if (span > MAX_SHIFT_MINUTES) e.shift_end = t('shifts:validation.tooLong');
    }
    if (!isEditing && repeat === 'days_of_week' && days.length === 0) {
      e.shift_days = t('shifts:validation.daysRequired');
    }
    if (!isEditing && repeat !== 'none' && repeatEndDate && date && repeatEndDate < date) {
      e.shift_repeat_end = t('shifts:validation.repeatEndBeforeStart');
    }
    return e;
  }

  async function handleSubmit(_event?: FormEvent): Promise<void> {
    if (!canEdit || !timezone) return;
    setSaveError('');
    const found = validate();
    if (Object.keys(found).length > 0) {
      setErrors(found);
      focusFirstError(found, [
        'shift_name',
        'shift_date',
        'shift_start',
        'shift_end',
        'shift_days',
        'shift_repeat_end',
      ]);
      return;
    }
    const duration = span as number;
    const lead = REMINDER_OPTIONS.find((o) => o.value === reminder)?.lead ?? null;
    const assignee = assignedTo || null;

    if (isEditing && shift) {
      const timeChanged =
        startTime !== hm(shift.scheduled_time) || duration !== (shift.duration_minutes ?? duration);
      const data: Parameters<typeof updateShift.mutateAsync>[0]['data'] = {
        title: name.trim(),
        scheduled_time: startTime,
        duration_minutes: duration,
        reminder_lead_minutes: lead,
      };
      if (!repeatingEdit) data.scheduled_date = date;
      if (assignee !== (shift.assigned_to ?? null)) data.assigned_to = assignee;
      const scope: ShiftScope = repeatingEdit ? editScope : 'occurrence';
      // A virtual / physical id edits ONLY that occurrence; the root id edits the
      // series (today and future).
      const eventId = repeatingEdit && scope === 'future' ? shiftRootId(shift) : shift.id;
      try {
        await updateShift.mutateAsync({ eventId, data });
        Analytics.shiftEdited({ timeChanged, scope: repeatingEdit ? scope : 'occurrence' });
        onUpdated?.();
        onClose();
      } catch (err) {
        failSave(err, 'edit');
      }
      return;
    }

    const payload: Omit<CreateEventRequest, 'event_type'> = {
      title: name.trim(),
      scheduled_date: date,
      scheduled_time: startTime,
      duration_minutes: duration,
      reminder_lead_minutes: lead,
      assigned_to: assignee,
    };
    let rule: string | undefined;
    let ruleDays: number[] | undefined;
    if (repeat === 'daily') rule = 'daily';
    else if (repeat === 'weekly') rule = 'weekly';
    else if (repeat === 'days_of_week') {
      // Same as mobile: always weekly + the (sorted) days, even with all 7.
      rule = 'weekly';
      ruleDays = [...days].sort((a, b) => a - b);
      payload.scheduled_date = nextDateOnWeekdays(date, ruleDays) ?? date;
    }
    if (rule) {
      payload.recurrence_rule = rule;
      if (ruleDays) payload.recurrence_days = ruleDays;
      if (repeatEndDate) payload.recurrence_end_date = repeatEndDate;
    }
    try {
      const created = await createShift.mutateAsync(payload);
      Analytics.shiftCreated({
        repeats: !!rule,
        recurrence: recurrenceEnum(rule, ruleDays),
        assigned: !!assignee,
        assignedSelf: !!assignee && assignee === viewerId,
        reminder: reminderEnum(lead),
        overnight: nextDay,
        durationMinutes: duration,
        source,
      });
      onCreated?.(created, {
        date,
        startTime: endTime,
        repeat,
        days,
        repeatEndDate,
        reminder: lead,
      });
    } catch (err) {
      // A classified failure closes with a toast; a network / server failure
      // keeps the form open with its input and the message inline.
      failSave(err, 'save');
    }
  }

  const guardedSubmit = useGuardedSubmit(handleSubmit);
  const busy = createShift.isPending || updateShift.isPending;

  if (!canEdit) return null;

  const repeatOptions = [
    { value: 'none', label: t('calendar:addEvent.recurrence.never') },
    { value: 'daily', label: t('calendar:addEvent.recurrence.daily') },
    { value: 'weekly', label: t('calendar:addEvent.recurrence.weekly') },
    { value: 'days_of_week', label: t('calendar:addEvent.recurrence.daysOfWeek') },
  ];

  const coveringHeading = recipientName
    ? t('shifts:form.heading', { name: recipientName })
    : t('shifts:form.covering');
  const showScheduleFields = !repeatingEdit;
  const showRepeat = !isEditing;

  return (
    <Modal
      size="md"
      title={isEditing ? t('shifts:form.editTitle') : t('shifts:form.newTitle')}
      closeLabel={t('shifts:close')}
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common:cancel')}
          </Button>
          <Button type="submit" form="shift-form" loading={busy} offlineKind="save">
            {t('shifts:form.save')}
          </Button>
        </>
      }
    >
      <form
        id="shift-form"
        noValidate
        onSubmit={(event: FormEvent) => void guardedSubmit(event)}
        className="flex flex-col gap-4"
      >
        {repeatingEdit && (
          <RadioGroup
            label={t('shifts:form.editScopeLabel')}
            value={editScope}
            onChange={(v) => setEditScope(v as ShiftScope)}
            options={[
              { value: 'occurrence', label: t('shifts:scope.occurrence') },
              { value: 'future', label: t('shifts:scope.allUpcoming') },
            ]}
          />
        )}

        <TextField
          id="shift_name"
          label={t('shifts:form.name')}
          required
          value={name}
          maxLength={SHIFT_NAME_MAX + 20}
          placeholder={t('shifts:form.namePlaceholder')}
          error={errors.shift_name}
          onChange={(e) => {
            setName(e.target.value);
            clearError('shift_name');
          }}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TimeField
            id="shift_start"
            label={t('shifts:form.starts')}
            required
            value={startTime}
            error={errors.shift_start}
            onChange={(e) => {
              setStartTime(e.target.value);
              clearError('shift_start', 'shift_end');
            }}
          />
          <TimeField
            id="shift_end"
            label={t('shifts:form.ends')}
            required
            value={endTime}
            error={errors.shift_end}
            hint={nextDay ? t('shifts:nextDay') : undefined}
            onChange={(e) => {
              setEndTime(e.target.value);
              clearError('shift_end');
            }}
          />
        </div>

        <p
          aria-live="polite"
          data-testid="shift-duration"
          className="m-0 min-h-[1.25rem] text-sm text-ink-2"
        >
          {span !== null && span >= MIN_SHIFT_MINUTES && span <= MAX_SHIFT_MINUTES
            ? formatShiftDuration(span, t)
            : ''}
        </p>

        {zonesDiffer && timezone && (
          <p className="m-0 text-sm text-ink-3">
            {t('shifts:form.timezoneNote', { zone: getTimezoneLabel(timezone) })}
          </p>
        )}

        {showScheduleFields && (
          <DateField
            id="shift_date"
            label={t('shifts:form.date')}
            required
            value={date}
            today={recipientToday}
            error={errors.shift_date}
            onChange={(e) => {
              setDate(e.target.value);
              clearError('shift_date');
            }}
          />
        )}

        {showRepeat && (
          <Select
            id="shift_repeat"
            label={t('shifts:form.repeats')}
            options={repeatOptions}
            value={repeat}
            onChange={(e) => {
              const next = e.target.value as ShiftRepeatChoice;
              setRepeat(next);
              if (next === 'days_of_week' && days.length === 0 && date) {
                setDays([getDayOfWeek(date)]);
              }
              clearError('shift_days');
            }}
          />
        )}

        {showRepeat && repeat === 'days_of_week' && (
          <div className="flex flex-col gap-2">
            <DaysOfWeekPicker
              id="shift_days"
              label={t('calendar:addEvent.daysOfWeek.title')}
              selected={days}
              language={language}
              onChange={(next) => {
                setDays(next);
                clearError('shift_days');
              }}
            />
            {errors.shift_days && (
              <p className={INPUT_ERROR}>
                <Icon name="alert-circle-outline" size="inline" />
                {errors.shift_days}
              </p>
            )}
            {days.length > 0 && (
              <p aria-live="polite" className="m-0 ml-1 text-sm text-ink-2">
                {formatWeekdayList(days, language)}
              </p>
            )}
          </div>
        )}

        {showRepeat && repeat !== 'none' && (
          <DateField
            id="shift_repeat_end"
            label={t('shifts:form.endsOn')}
            value={repeatEndDate}
            today={recipientToday}
            hint={t('calendar:addEvent.hints.endDate')}
            error={errors.shift_repeat_end}
            onChange={(e) => {
              setRepeatEndDate(e.target.value);
              clearError('shift_repeat_end');
            }}
          />
        )}

        {repeatingEdit && <p className="m-0 text-sm text-ink-3">{t('shifts:form.seriesNote')}</p>}

        <Select
          id="shift_reminder"
          label={t('shifts:form.reminder')}
          options={REMINDER_OPTIONS.map((o) => ({
            value: o.value,
            // The short chip wording mobile shows ("1 hour"); the read-only rows
            // elsewhere say "1 hour before".
            label:
              o.lead === null
                ? t('shifts:reminder.off')
                : o.lead === 60
                  ? t('shifts:reminder.chip1h')
                  : o.lead === 120
                    ? t('shifts:reminder.chip2h')
                    : o.lead === 240
                      ? t('shifts:reminder.chip4h')
                      : t('shifts:reminder.chip1d'),
          }))}
          value={reminder}
          hint={t('shifts:form.reminderHint')}
          onChange={(e) => setReminder(e.target.value)}
        />

        <div className="flex flex-col gap-2">
        <p className="m-0 font-display text-lg font-medium text-ink">{coveringHeading}</p>
        <ChipSelect
          id="shift_assignee"
          label={coveringHeading}
          options={assigneeOptions}
          value={assignedTo}
          allowDeselect={false}
          onChange={(next) => setAssignedTo(next ?? '')}
        />
        </div>
        <ShiftInlineError message={saveError} testId="shift-form-error" />
      </form>
    </Modal>
  );
}
