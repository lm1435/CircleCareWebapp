import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent, CreateEventRequest } from '@/api/calendarEvents';
import {
  isShiftInvalidStartError,
  isShiftRescheduleRequiredError,
  type RescheduleShiftBody,
  type ShiftScope,
} from '@/api/shifts';
import {
  Button,
  ChipSelect,
  ChoiceTileButton,
  DateField,
  Icon,
  Modal,
  RadioGroup,
  Text,
  TextField,
  TimeField,
  useToast,
  type FieldErrors,
  RequiredMarker,
} from '@/components/ui';
import { INPUT_ERROR } from '@/components/ui/inputStyles';
import { DaysOfWeekPicker } from '@/components/calendar/DaysOfWeekPicker';
import { DisclosureRow } from '@/components/calendar/DisclosureRow';
import { formatWeekdayList } from '@/components/calendar/recurrenceLabel';
import {
  formatDateForDisplay,
  getDayOfWeek,
  nextDateOnWeekdays,
} from '@/components/calendar/dateMath';
import { useCircle } from '@/hooks/useCircle';
import {
  useCreateShift,
  useHandleShiftFailure,
  useRescheduleShiftSeries,
  useShiftSeriesRootForEdit,
  useUpdateShift,
} from '@/hooks/useShifts';
import { useGuardedSubmit } from '@/hooks/useGuardedSubmit';
import { useHourCycle } from '@/hooks/useHourCycle';
import { useAuthStore } from '@/store/authStore';
import { Analytics } from '@/lib/analytics';
import { resolveShiftsEntry } from '@/lib/shiftsAccess';
import { ShiftCyclePanel } from './ShiftCyclePanel';
import { ShiftInlineError } from './ShiftInlineError';
import {
  cycleBucket,
  cycleRule,
  parseCycleCount,
  parseCycleRule,
} from './shiftRotation';
import { spanMinutes } from '@/lib/eventForm';
import { defaultNewEventDate } from '@/utils/recipientEventDate';
import { formatTimeOfDay, getTimezoneLabel } from '@/utils/timezone';
import {
  DEFAULT_SHIFT_REMINDER_LEAD,
  MAX_SHIFT_MINUTES,
  MIN_SHIFT_MINUTES,
  SHIFT_NAME_MAX,
  formatShiftDuration,
  formatShiftRepeat,
  formatShiftReminder,
  formatShiftReminderChip,
  isShiftRepeating,
  memberShortName,
  recurrenceEnum,
  reminderEnum,
  shiftEnd,
  shiftRootId,
  shiftZonesDiffer,
  canCoverShifts,
} from './shiftUtils';

export type ShiftRepeatChoice =
  | 'none'
  | 'daily'
  | 'every_other_day'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'cycle'
  | 'days_of_week';

export interface ShiftFormPrefill {
  name?: string;
  date?: string;
  /** `HH:MM`. */
  startTime?: string;
  endTime?: string;
  repeat?: ShiftRepeatChoice;
  days?: number[];
  /** Days on / off counts ('add next' keeps the rotation). */
  cycleOn?: string;
  cycleOff?: string;
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
 * This shift PATCHes that occurrence's own id (its date can move). All upcoming PATCHes the
 * series root for content, but a new START DATE or REPEAT goes to POST .../shift/reschedule
 * (the backend splits the series at the date: earlier shifts and their cover are untouched).
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

type StoredSeries = Pick<
  CalendarEvent,
  'recurrence_rule' | 'recurrence_days' | 'recurrence_end_date' | 'parent_event_id'
>;

/** The repeat a stored shift carries, as the form's tiles name it; null = a rule no tile names (custom:N). */
function storedRepeat(shift: StoredSeries): ShiftRepeatChoice | null {
  const rule = shift.recurrence_rule;
  if (rule === 'daily' || rule === 'every_other_day' || rule === 'monthly' || rule === 'yearly') {
    return rule;
  }
  if (rule === 'weekly') {
    return shift.recurrence_days && shift.recurrence_days.length > 0 ? 'days_of_week' : 'weekly';
  }
  if (parseCycleRule(rule)) return 'cycle';
  return isShiftRepeating(shift) ? null : 'none';
}

/** The rule string a tile choice stores (days of the week = weekly + days). */
function ruleOf(choice: ShiftRepeatChoice, on: number | null, off: number | null): string | undefined {
  switch (choice) {
    case 'none':
      return undefined;
    case 'days_of_week':
      return 'weekly';
    case 'cycle':
      return on !== null && off !== null ? cycleRule(on, off) : undefined;
    default:
      return choice;
  }
}

/** A form field that can carry an error, in the order the first one is focused. */
const FOCUS_ORDER = [
  'shift_name',
  'shift_date',
  'shift_start',
  'shift_end',
  'shift_days',
  'cycle_days_on',
  'shift_repeat_end',
] as const;

/**
 * Section heading, the med / appointment simple form's pattern (an h3 the section is named by).
 * `required`: the heading IS the visible label of a required field (the shift name), so it carries
 * the red asterisk (the input itself says aria-required).
 */
const sectionHeading = (headingId: string, text: string, required = false): ReactElement => (
  <Text variant="sectionTitle" as="h3" id={headingId} className="text-lg">
    {text}
    {required ? <RequiredMarker /> : null}
  </Text>
);

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
  const hourCycle = useHourCycle();
  const createShift = useCreateShift(circleId);
  const updateShift = useUpdateShift(circleId);
  const rescheduleShift = useRescheduleShiftSeries(circleId);

  const isEditing = !!shift;
  const repeatingEdit = isEditing && isShiftRepeating(shift);
  const language = i18n.language;
  // A virtual occurrence carries neither the root's days nor its rule shape: hydrate the repeat from the root.
  const rootEdit = useShiftSeriesRootForEdit(circleId, shift ?? null, repeatingEdit);
  const stored: StoredSeries | null = shift ? (rootEdit.root ?? shift) : null;
  const storedChoice = stored ? storedRepeat(stored) : null;
  const storedCycle = parseCycleRule(stored?.recurrence_rule);

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
  // EDIT starts from the stored repeat (editable under "All upcoming shifts"); CREATE from the prefill ("add next") or Once.
  const [repeat, setRepeat] = useState<ShiftRepeatChoice>(
    shift ? (storedChoice ?? 'none') : (prefill?.repeat ?? 'none')
  );
  const [days, setDays] = useState<number[]>(prefill?.days ?? stored?.recurrence_days ?? []);
  const [cycleOn, setCycleOn] = useState(
    storedCycle ? String(storedCycle.on) : (prefill?.cycleOn ?? '7')
  );
  const [cycleOff, setCycleOff] = useState(
    storedCycle ? String(storedCycle.off) : (prefill?.cycleOff ?? '7')
  );
  // Once the person touches the tiles, the root arriving late must not overwrite their choice.
  const repeatTouched = useRef(false);
  const rootRule = rootEdit.root;
  useEffect(() => {
    if (!rootRule || repeatTouched.current) return;
    const choice = storedRepeat(rootRule);
    if (choice) setRepeat(choice);
    setDays(rootRule.recurrence_days ?? []);
    const cy = parseCycleRule(rootRule.recurrence_rule);
    if (cy) {
      setCycleOn(String(cy.on));
      setCycleOff(String(cy.off));
    }
  }, [rootRule]);
  const [repeatEndDate, setRepeatEndDate] = useState(prefill?.repeatEndDate ?? '');
  const [reminder, setReminder] = useState<string>(() => {
    const lead = shift ? (shift.reminder_lead_minutes ?? null) : (prefill?.reminder ?? DEFAULT_SHIFT_REMINDER_LEAD);
    return lead === null ? 'off' : String(lead);
  });
  const initialAssignee = shift?.assigned_to ?? '';
  const [assignedTo, setAssignedTo] = useState<string>(initialAssignee);
  const [editScope, setEditScope] = useState<ShiftScope>('occurrence');
  // "All upcoming shifts" may change the start date and the repeat (the reschedule route).
  const futureEdit = repeatingEdit && editScope === 'future';
  const repeatEditable = !isEditing || futureEdit;
  const [errors, setErrors] = useState<FieldErrors>({});
  // The Starts / Ends tiles reveal their time input in place; a field with an error stays open.
  const [timeOpen, setTimeOpen] = useState({ start: false, end: false });
  const [moreOpen, setMoreOpen] = useState(false);
  // An element to focus once the render that mounted / revealed it has happened.
  const [focusAfter, setFocusAfter] = useState<string | null>(null);
  useEffect(() => {
    if (!focusAfter) return;
    document.getElementById(focusAfter)?.focus();
    setFocusAfter(null);
  }, [focusAfter]);

  // Dropping the dialog entirely for someone who cannot write (the page gates
  // every entry point, this is defence in depth).
  const recipientName = circle?.recipient_name ?? '';

  const span = startTime && endTime ? spanMinutes(startTime, endTime) : null;
  const nextDay = !!startTime && !!endTime && endTime <= startTime;
  const spanValid = span !== null && span >= MIN_SHIFT_MINUTES && span <= MAX_SHIFT_MINUTES;

  // Leave open, Me, then the other members in roster order. The CURRENT holder
  // is always listed ("on it now"); one this editor could not pick is shown, not pickable.
  const assigneeOptions = useMemo(() => {
    const current = t('shifts:assign.current');
    const mark = (id: string): string | undefined =>
      initialAssignee && id === initialAssignee ? current : undefined;
    const opts: Array<{ value: string; label: string; sub?: string; disabled?: boolean }> = [
      { value: '', label: t('shifts:form.leaveOpen') },
    ];
    if (viewerId && canCoverShifts(members, viewerId)) {
      opts.push({ value: viewerId, label: t('shifts:form.me'), sub: mark(viewerId) });
    }
    for (const m of members) {
      if (m.id === viewerId) continue;
      if (m.is_care_recipient === true) continue;
      const isHolder = m.id === initialAssignee;
      const pickable = canManageMembers && m.view_only !== true;
      if (!isHolder && !pickable) continue;
      opts.push({
        value: m.id,
        label: memberShortName(m),
        sub: mark(m.id),
        ...(pickable ? {} : { disabled: true }),
      });
    }
    // A holder who has left the circle still reads (and cannot be picked back).
    if (initialAssignee && !opts.some((o) => o.value === initialAssignee)) {
      const holder = shift?.assigned_to_user?.first_name?.trim() || t('shifts:someone');
      opts.push({ value: initialAssignee, label: holder, sub: current, disabled: true });
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
    if (!date) e.shift_date = t('shifts:validation.dateRequired');
    else if (futureEdit && shift && date < shift.scheduled_date) {
      e.shift_date = t('shifts:validation.startingBefore', {
        date: formatDateForDisplay(
          shift.scheduled_date,
          { month: 'short', day: 'numeric', year: 'numeric' },
          language
        ),
      });
    }
    if (!startTime) e.shift_start = t('shifts:validation.startRequired');
    if (!endTime) e.shift_end = t('shifts:validation.endRequired');
    if (span !== null) {
      if (span < MIN_SHIFT_MINUTES) e.shift_end = t('shifts:validation.tooShort');
      else if (span > MAX_SHIFT_MINUTES) e.shift_end = t('shifts:validation.tooLong');
    }
    if (repeatEditable && repeat === 'days_of_week' && days.length === 0) {
      e.shift_days = t('shifts:validation.daysRequired');
    }
    if (repeatEditable && repeat === 'cycle') {
      if (parseCycleCount(cycleOn) === null || parseCycleCount(cycleOff) === null) {
        e.cycle_days_on = t('shifts:validation.cycleCounts');
      }
    }
    if (!isEditing && repeat !== 'none' && repeatEndDate && date && repeatEndDate < date) {
      e.shift_repeat_end = t('shifts:validation.repeatEndBeforeStart');
    }
    return e;
  }

  /** The rule (+ sorted days, + cycle counts) the tiles currently name; `rule` undefined = Once. */
  function chosenRule(): {
    rule: string | undefined;
    days: number[] | undefined;
    cycle: { on: number; off: number } | null;
  } {
    const on = parseCycleCount(cycleOn);
    const off = parseCycleCount(cycleOff);
    // Same as mobile: days of the week are always weekly + the (sorted) days, even with all 7.
    const sorted = repeat === 'days_of_week' ? [...days].sort((a, b) => a - b) : undefined;
    return {
      rule: ruleOf(repeat, on, off),
      days: sorted,
      cycle: repeat === 'cycle' && on !== null && off !== null ? { on, off } : null,
    };
  }

  /** Did the repeat (rule or days) differ from what the series stores? An unknown stored rule counts only once touched. */
  function patternChanged(rule: string | undefined, nextDays: number[] | undefined): boolean {
    if (storedChoice === null && !repeatTouched.current) return false;
    const storedRule = stored?.recurrence_rule ?? undefined;
    if ((rule ?? undefined) !== storedRule) return true;
    const a = [...(nextDays ?? [])].sort((x, y) => x - y).join(',');
    const b = [...(storedChoice === 'days_of_week' ? (stored?.recurrence_days ?? []) : [])]
      .sort((x, y) => x - y)
      .join(',');
    return a !== b;
  }

  async function handleSubmit(_event?: FormEvent): Promise<void> {
    if (!canEdit || !timezone) return;
    setSaveError('');
    const found = validate();
    if (Object.keys(found).length > 0) {
      setErrors(found);
      // Reveal whatever is folded away so every error is on screen, then focus the first one.
      setTimeOpen((prev) => ({
        start: prev.start || !!found.shift_start,
        end: prev.end || !!found.shift_end,
      }));
      if (found.shift_repeat_end) setMoreOpen(true);
      setFocusAfter(FOCUS_ORDER.find((key) => found[key]) ?? null);
      return;
    }
    const duration = span as number;
    const lead = REMINDER_OPTIONS.find((o) => o.value === reminder)?.lead ?? null;
    const assignee = assignedTo || null;

    if (isEditing && shift) {
      const timeChanged =
        startTime !== hm(shift.scheduled_time) || duration !== (shift.duration_minutes ?? duration);
      const scope: ShiftScope = repeatingEdit ? editScope : 'occurrence';

      // ALL UPCOMING with a new start date and / or repeat: the reschedule route splits the
      // series at the date (earlier shifts and who covered them stay as they are).
      if (futureEdit) {
        const next = chosenRule();
        const startDate = next.days ? (nextDateOnWeekdays(date, next.days) ?? date) : date;
        const dateChanged = startDate !== shift.scheduled_date;
        const repeatChanged = patternChanged(next.rule, next.days);
        const keepStoredRule = storedChoice === null && !repeatTouched.current;
        if (dateChanged || repeatChanged) {
          const body: RescheduleShiftBody = {
            from_date: shift.scheduled_date,
            start_date: startDate,
            // An unknown stored rule (custom:N / RRULE) the tiles were never touched on keeps its rule.
            recurrence_rule: keepStoredRule ? (stored?.recurrence_rule ?? null) : (next.rule ?? null),
            title: name.trim(),
            scheduled_time: startTime,
            duration_minutes: duration,
            reminder_lead_minutes: lead,
          };
          if (next.days && !keepStoredRule) body.recurrence_days = next.days;
          if ((keepStoredRule || next.rule) && stored?.recurrence_end_date) {
            body.recurrence_end_date = stored.recurrence_end_date;
          }
          if (assignee !== (shift.assigned_to ?? null)) body.assigned_to = assignee;
          try {
            await rescheduleShift.mutateAsync({ shift, body });
            Analytics.shiftSeriesRescheduled({
              changed: dateChanged && repeatChanged ? 'both' : dateChanged ? 'date' : 'repeat',
              fromRecurrence: recurrenceEnum(stored?.recurrence_rule, stored?.recurrence_days),
              toRecurrence: recurrenceEnum(next.rule, next.days),
            });
            Analytics.shiftEdited({ timeChanged, scope: 'future', layout: 'simple' });
            onUpdated?.();
            onClose();
          } catch (err) {
            if (isShiftInvalidStartError(err)) {
              setErrors({ shift_date: t('shifts:form.invalidStart') });
              setFocusAfter('shift_date');
            } else if (isShiftRescheduleRequiredError(err)) {
              setSaveError(t('shifts:form.rescheduleRequired'));
            } else {
              failSave(err, 'edit');
            }
          }
          return;
        }
      }

      const data: Parameters<typeof updateShift.mutateAsync>[0]['data'] = {
        title: name.trim(),
        scheduled_time: startTime,
        duration_minutes: duration,
        reminder_lead_minutes: lead,
      };
      // A one-off always sends its date; "This shift" of a series sends it only when it MOVED
      // (that occurrence alone moves). "All upcoming" never sends a date here (see above).
      if (!repeatingEdit || (scope === 'occurrence' && date !== shift.scheduled_date)) {
        data.scheduled_date = date;
      }
      if (assignee !== (shift.assigned_to ?? null)) data.assigned_to = assignee;
      // A virtual / physical id edits ONLY that occurrence; the root id edits the
      // series (today and future).
      const eventId = repeatingEdit && scope === 'future' ? shiftRootId(shift) : shift.id;
      try {
        await updateShift.mutateAsync({ eventId, data });
        Analytics.shiftEdited({
          timeChanged,
          scope: repeatingEdit ? scope : 'occurrence',
          layout: 'simple',
        });
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
    const chosen = chosenRule();
    const rule = chosen.rule;
    const ruleDays = chosen.days;
    if (ruleDays) payload.scheduled_date = nextDateOnWeekdays(date, ruleDays) ?? date;
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
        ...(rule?.startsWith('cycle:') && chosen.cycle
          ? {
              cycleOnBucket: cycleBucket(chosen.cycle.on),
              cycleOffBucket: cycleBucket(chosen.cycle.off),
            }
          : {}),
        assigned: !!assignee,
        assignedSelf: !!assignee && assignee === viewerId,
        reminder: reminderEnum(lead),
        overnight: nextDay,
        durationMinutes: duration,
        source,
        layout: 'simple',
      });
      onCreated?.(created, {
        date,
        startTime: endTime,
        repeat,
        days,
        cycleOn,
        cycleOff,
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
  const busy = createShift.isPending || updateShift.isPending || rescheduleShift.isPending;

  if (!canEdit) return null;

  // The medication picker's order.
  const repeatOptions = [
    { value: 'none', label: t('shifts:form.once') },
    { value: 'daily', label: t('shifts:form.everyDay') },
    { value: 'every_other_day', label: t('shifts:form.everyOtherDay') },
    { value: 'weekly', label: t('shifts:form.everyWeek') },
    { value: 'monthly', label: t('shifts:form.monthly') },
    { value: 'yearly', label: t('shifts:form.yearly') },
    { value: 'cycle', label: t('shifts:form.daysOnOff') },
    { value: 'days_of_week', label: t('shifts:form.someDays') },
  ];
  // The days-of-week start moves to the first selected weekday ("First time: ...").
  const firstTime =
    repeatEditable && repeat === 'days_of_week' && days.length > 0 && date
      ? nextDateOnWeekdays(date, days)
      : null;
  const wasLabel =
    futureEdit && stored && patternChanged(chosenRule().rule, chosenRule().days)
      ? formatShiftRepeat(stored, true, t, (d) => formatWeekdayList(d, language))
      : null;

  // "Who's covering?" when the viewer IS the care recipient (self circle) or there is no name to say.
  const viewerIsRecipient = !!viewerId && members.some((m) => m.id === viewerId && m.is_care_recipient === true);
  const coveringHeading = recipientName && !viewerIsRecipient
    ? t('shifts:form.heading', { name: recipientName })
    : t('shifts:form.covering');
  const repeats = repeat !== 'none';
  const clock = (time: string): string => {
    const [h, m] = time.split(':').map((n) => parseInt(n, 10));
    return formatTimeOfDay(h, m, hourCycle);
  };
  const dayHint =
    span === MAX_SHIFT_MINUTES && startTime && endTime
      ? { start: clock(startTime), end: clock(endTime) }
      : null;
  const startOpen = timeOpen.start || !!errors.shift_start;
  const endOpen = timeOpen.end || !!errors.shift_end;
  const toggleTime = (which: 'start' | 'end'): void => {
    const open = which === 'start' ? startOpen : endOpen;
    setTimeOpen((prev) => ({ ...prev, [which]: !open }));
    if (!open) setFocusAfter(which === 'start' ? 'shift_start' : 'shift_end');
  };

  // "8 hours · Times are for Denver." - the duration only while valid, the zone only when it differs.
  const captionText = [
    spanValid ? formatShiftDuration(span as number, t) : '',
    zonesDiffer && timezone ? t('shifts:form.timezoneNote', { zone: getTimezoneLabel(timezone) }) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  // The folded "More details" line: the reminder, then (only when it repeats) when the repeat ends.
  const reminderLead = REMINDER_OPTIONS.find((o) => o.value === reminder)?.lead ?? null;
  const reminderSummary =
    reminderLead === null
      ? t('shifts:form.summaryReminderOff')
      : t('shifts:form.summaryReminder', { reminder: formatShiftReminder(reminderLead, t) });
  // The repeat-end FIELD exists on create only; the summary also names a repeating shift's stored end (read-only).
  const showRepeatEnd = !isEditing && repeats;
  const summaryRepeats = isEditing ? repeatingEdit : repeats;
  const summaryEndDate = isEditing ? (shift?.recurrence_end_date ?? '') : repeatEndDate;
  const moreSummary = summaryRepeats
    ? `${reminderSummary} · ${
        summaryEndDate
          ? t('shifts:form.summaryRepeatEnds', {
              date: formatDateForDisplay(
                summaryEndDate,
                { month: 'short', day: 'numeric', year: 'numeric' },
                language
              ),
            })
          : t('shifts:form.summaryRepeatEndsNever')
      }`
    : reminderSummary;

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
            {isEditing ? t('shifts:form.saveChanges') : t('shifts:form.save')}
          </Button>
        </>
      }
    >
      <form
        id="shift-form"
        noValidate
        onSubmit={(event: FormEvent) => void guardedSubmit(event)}
        className="flex flex-col gap-6"
        data-testid="shift-form"
      >
        {repeatingEdit && (
          <RadioGroup
            label={t('shifts:form.editScopeLabel')}
            value={editScope}
            onChange={(v) => {
              setEditScope(v as ShiftScope);
              // The date means a different thing per scope (moves THIS shift / starts the new schedule): reset it.
              if (shift) setDate(shift.scheduled_date);
              setErrors({});
              setSaveError('');
            }}
            options={[
              { value: 'occurrence', label: t('shifts:scope.occurrence') },
              { value: 'future', label: t('shifts:scope.allUpcoming') },
            ]}
          />
        )}

        <section aria-labelledby="sf-name" className="flex flex-col gap-3">
          {sectionHeading('sf-name', t('shifts:form.nameQuestion'), true)}
          {/* The heading above IS the question; the field's own label repeats it for assistive tech
              only. The WHOLE label is sr-only, so its asterisk does not show a second time. */}
          <div className="[&_label]:sr-only">
            <TextField
              id="shift_name"
              label={t('shifts:form.nameQuestion')}
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
          </div>
        </section>

        <section aria-labelledby="sf-when" className="flex flex-col gap-3">
          {sectionHeading('sf-when', t('shifts:form.whenQuestion'))}
          <DateField
            id="shift_date"
            label={futureEdit ? t('shifts:form.starting') : t('shifts:form.date')}
            required
            value={date}
            today={recipientToday}
            min={futureEdit ? shift?.scheduled_date : undefined}
            error={errors.shift_date}
            onChange={(e) => {
              setDate(e.target.value);
              clearError('shift_date');
            }}
          />
          {firstTime && firstTime !== date && (
            <Text variant="caption" as="p" aria-live="polite" data-testid="shift-form-first-time">
              {t('shifts:form.firstTime', {
                date: formatDateForDisplay(
                  firstTime,
                  { weekday: 'short', month: 'short', day: 'numeric' },
                  language
                ),
              })}
            </Text>
          )}
          <div className="flex flex-wrap gap-2" data-testid="shift-form-times">
            <ChoiceTileButton
              id="shift-start-tile"
              testId="shift-start-tile"
              hierarchy="value"
              label={t('shifts:form.starts')}
              sub={startTime ? clock(startTime) : t('shifts:form.chooseTime')}
              expanded={startOpen}
              invalid={!!errors.shift_start}
              describedBy="shift-form-duration"
              onClick={() => toggleTime('start')}
            />
            <ChoiceTileButton
              id="shift-end-tile"
              testId="shift-end-tile"
              hierarchy="value"
              label={t('shifts:form.ends')}
              sub={
                endTime
                  ? `${clock(endTime)}${nextDay ? ` ${t('shifts:nextDay')}` : ''}`
                  : t('shifts:form.chooseTime')
              }
              expanded={endOpen}
              invalid={!!errors.shift_end}
              describedBy="shift-form-duration"
              onClick={() => toggleTime('end')}
            />
          </div>
          {(startOpen || endOpen) && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {startOpen && (
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
              )}
              {endOpen && (
                <TimeField
                  id="shift_end"
                  label={t('shifts:form.ends')}
                  required
                  value={endTime}
                  error={errors.shift_end}
                  onChange={(e) => {
                    setEndTime(e.target.value);
                    clearError('shift_end');
                  }}
                />
              )}
            </div>
          )}
          <Text
            variant="caption"
            as="p"
            id="shift-form-duration"
            data-testid="shift-form-duration"
            aria-live="polite"
            className="min-h-[1.25rem]"
          >
            {captionText}
          </Text>
        </section>

        {(!repeatingEdit || futureEdit) && (
          <section aria-labelledby="sf-how-often" className="flex flex-col gap-3">
            {sectionHeading('sf-how-often', t('shifts:form.howOften'))}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 [&_[role=radio]]:w-full">
              <ChipSelect
                id="shift_repeat"
                label={t('shifts:form.howOften')}
                variant="tile"
                contents
                allowDeselect={false}
                // A one-off's repeat is fixed; a series' can change under "All upcoming shifts".
                disabled={!repeatEditable || rootEdit.pending}
                options={repeatOptions}
                value={!repeatTouched.current && isEditing && storedChoice === null ? null : repeat}
                onChange={(next) => {
                  if (!next) return;
                  const choice = next as ShiftRepeatChoice;
                  repeatTouched.current = true;
                  setRepeat(choice);
                  if (choice === 'days_of_week' && days.length === 0 && date) {
                    setDays([getDayOfWeek(date)]);
                  }
                  clearError('shift_days', 'cycle_days_on');
                }}
              />
            </div>
            {repeatEditable && repeat === 'cycle' && (
              <ShiftCyclePanel
                daysOn={cycleOn}
                daysOff={cycleOff}
                onDaysOn={(v) => {
                  repeatTouched.current = true;
                  setCycleOn(v);
                  clearError('cycle_days_on');
                }}
                onDaysOff={(v) => {
                  repeatTouched.current = true;
                  setCycleOff(v);
                  clearError('cycle_days_on');
                }}
                error={errors.cycle_days_on}
                startDate={date}
                language={language}
                was={wasLabel ?? undefined}
                dayHint={dayHint}
              />
            )}
            {repeatEditable && repeat !== 'cycle' && wasLabel && (
              <Text variant="caption" as="p" data-testid="shift-form-was">
                {t('shifts:form.cycleWas', { old: wasLabel })}
              </Text>
            )}
            {repeatEditable && repeat === 'days_of_week' && (
              <div className="flex flex-col gap-2">
                <DaysOfWeekPicker
                  id="shift_days"
                  label={t('calendar:addEvent.daysOfWeek.title')}
                  selected={days}
                  language={language}
                  onChange={(next) => {
                    repeatTouched.current = true;
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
            {futureEdit && shift && (
              <Text variant="caption" as="p" data-testid="shift-form-from-note">
                {t('shifts:form.fromNote', {
                  date: formatDateForDisplay(
                    (firstTime ?? date) >= shift.scheduled_date ? (firstTime ?? date) : shift.scheduled_date,
                    { month: 'short', day: 'numeric', year: 'numeric' },
                    language
                  ),
                })}
              </Text>
            )}
          </section>
        )}

        <section aria-labelledby="sf-who" className="flex flex-col gap-3">
          {sectionHeading('sf-who', coveringHeading)}
          <ChipSelect
            id="shift_assignee"
            label={coveringHeading}
            variant="tile"
            options={assigneeOptions}
            value={assignedTo}
            allowDeselect={false}
            onChange={(next) => setAssignedTo(next ?? '')}
          />
          <Text variant="caption" as="p" data-testid="shift-form-open-hint">
            {t('shifts:form.openHint')}
          </Text>
        </section>

        <DisclosureRow
          id="shift-more-details"
          title={t('shifts:form.moreDetails')}
          summary={moreSummary}
          summaryTestId="shift-form-more-summary"
          wrapSummary
          open={moreOpen}
          onToggle={setMoreOpen}
        >
          <div className="flex flex-col gap-3">
            <Text variant="label" as="h4" id="sf-reminder">
              {t('shifts:form.reminder')}
            </Text>
            <ChipSelect
              id="shift_reminder"
              label={t('shifts:form.reminder')}
              variant="tile"
              allowDeselect={false}
              options={REMINDER_OPTIONS.map((o) => ({
                value: o.value,
                // The short chip wording mobile shows ("1 hour"); the read-only rows
                // elsewhere say "1 hour before".
                label: formatShiftReminderChip(o.lead, t),
              }))}
              value={reminder}
              onChange={(next) => {
                if (next) setReminder(next);
              }}
            />
            <Text variant="caption" as="p" id="shift_reminder-hint">
              {t('shifts:form.reminderHint')}
            </Text>
          </div>
          {showRepeatEnd && (
            <div className="flex flex-col gap-2">
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
              {repeatEndDate && (
                <button
                  type="button"
                  data-testid="shift-form-clear-end"
                  onClick={() => {
                    setRepeatEndDate('');
                    clearError('shift_repeat_end');
                  }}
                  className="min-h-[44px] cursor-pointer self-start border-0 bg-transparent p-0 text-base font-semibold text-moss-deep underline-offset-2 hover:underline"
                >
                  {t('shifts:form.clearEnd')}
                </button>
              )}
            </div>
          )}
        </DisclosureRow>
        <ShiftInlineError message={saveError} testId="shift-form-error" />
      </form>
    </Modal>
  );
}
