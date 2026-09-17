import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { DrugSearchResult } from '@/api/drugs';
import { DrugAutocomplete } from './DrugAutocomplete';
import { NotificationInfoModal } from './NotificationInfoModal';
import {
  eventFormSchema,
  type CalendarEvent,
  type CreateEventRequest,
  type EventType,
} from '@/api/calendarEvents';
import { useCachedCircleEvents, useCreateEvent, useUpdateEvent } from '@/hooks/useCalendarEvents';
import { useCircle } from '@/hooks/useCircle';
import { useGuardedSubmit } from '@/hooks/useGuardedSubmit';
import { APPOINTMENT_TITLE_KEYS, MED_SCHEDULE_PRESETS, TASK_TITLE_KEYS } from '@/lib/quickPicks';
import { deriveTitleSuggestions } from '@/lib/titleSuggestions';
import {
  DEFAULT_DURATION_MINUTES,
  DURATION_PRESETS,
  addMinutesToTimeStr,
  assignedToForSave,
  defaultReminder15mFor,
  hydratedReminder15m,
  matchingDurationIndex,
  reminderFlagsForSave,
  remindersApply,
} from '@/lib/eventForm';
import {
  Button,
  Card,
  Checkbox,
  ChipSelect,
  ConfirmDialog,
  DateField,
  Icon,
  Modal,
  Select,
  Text,
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
  formatTimeOfDay,
  getDateInTimezone,
  getDeviceTimezone,
  getTimezoneLabel,
  isEventPastDue,
  timezonesAreDifferent,
} from '@/utils/timezone';
import {
  clockInZone,
  dayInZone,
  eventDatesForApi,
  eventDatesFromApi,
  viewerInstant,
} from '@/utils/recipientEventDate';
import { useHourCycle } from '@/hooks/useHourCycle';

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
// TIMEZONE (CRITICAL) — mobile is canonical; see utils/recipientEventDate.
//
// The caregiver types in THEIR OWN timezone. The form's date/time fields are
// the VIEWER's wall clock; `scheduled_date` / `scheduled_time` are stored as
// naive values in the CARE RECIPIENT's frame. So the save CONVERTS
// (viewer -> recipient) and hydration converts BACK (recipient -> viewer).
//
//   Caregiver in Denver (MT), recipient in Chicago (CT):
//   types 8:00 PM -> stores 21:00 CT.
//
// Both directions go through ONE module, `eventDatesForApi` /
// `eventDatesFromApi`, because they must be exact inverses and the only way to
// keep two functions inverse is to make them impossible to change separately.
// Mobile shipped the save conversion WITHOUT the hydration conversion, so an
// 8 PM dose reopened as 2 AM the next day and saving it untouched moved the
// real dose. `save(hydrate(stored)) === stored` is the property that matters.
//
// Nothing is hidden from the user: whenever the zones differ the time field
// shows the conversion live ("8:00 PM Denver = 9:00 PM Chicago"). Asking a caregiver to
// convert in their head is where the errors come from.
//
// NEVER new Date(`${d}T${t}`)/.getHours()/.split('T')[0] on these values.

export interface AddEventModalProps {
  circleId: string;
  /** Existing event when editing; omit/undefined for create. */
  event?: CalendarEvent | null;
  /** Pre-select the event type in create mode (e.g. Tasks page → 'task'). */
  initialType?: EventType;
  /**
   * Prefill the title in create mode (R4-3 empty-state starter chips — e.g.
   * Tasks page starter chip → open with that task title). Ignored when editing.
   */
  initialTitle?: string;
  /**
   * Prefills for the FIRST-RUN WIZARD's "Add full details instead" hand-off, and
   * for its constraint-4 gate (a multi-dose preset on a non-daily rule is handed
   * here rather than guessed at). Create mode only; an edit hydrates from the
   * stored event and ignores all three.
   *
   * They exist because mobile learned this the hard way: a user who had chosen
   * "twice daily" and "every other day" and pressed Save landed in the full form
   * with both answers GONE, re-answering the exact questions the wizard exists
   * to spare them, on the one path it deliberately refuses to handle.
   *
   * `initialTime` is a VIEWER-frame `HH:MM` — the same frame this form's time
   * field is in — so it needs no conversion. `initialRecurrence` is a rule
   * string ('daily' | 'every_other_day' | 'weekly') or null for no repeat.
   *
   * KNOWN GAP: only the PRIMARY dose time survives a multi-dose hand-off,
   * because this form has exactly one time field (see quickPicks'
   * MED_SCHEDULE_PRESETS note). The wizard's own save path creates sibling rows
   * for the extra times; the form cannot, on either the wizard's behalf or its
   * own.
   */
  initialDosage?: string;
  initialTime?: string;
  initialRecurrence?: string | null;
  onClose: () => void;
  /** Called after a successful create/update (parent typically closes + toasts). */
  onSaved?: () => void;
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

// Static ids — one AddEventModal is mounted at a time, and the earlier-reminders
// group needs stable targets for aria-labelledby / aria-describedby.
const EARLIER_REMINDERS_LABEL_ID = 'reminders-earlier-label';
const EARLIER_REMINDERS_WARNING_ID = 'reminders-earlier-warning';

/**
 * The viewer's end time for a stored `duration_minutes`, ROLLING OVER midnight.
 *
 * Deliberately NOT `addMinutesToTimeStr`, which clamps at 23:59. That clamp is
 * right where it is used — prefilling a default end when the user picks a start
 * — because it keeps the picker inside the one day the event has. It is wrong
 * here, because this is reconstructing a duration that was already stored.
 *
 * With the clamp, a 22:00 appointment of 180 minutes hydrates as 23:59, passes
 * the `end > start` check, and an untouched Save writes `duration_minutes: 119`
 * — a three-hour appointment silently becomes 1h59m. Rolling over yields 01:00,
 * which fails validation and tells the user, which is the correct failure while
 * this form has a single date field and cannot express a midnight crossing.
 *
 * See the note in the audit: making such events actually editable is a product
 * change (a second date, or an explicit "ends next day"), not a formatting one.
 */
function endTimeForDuration(startStr: string, durationMinutes: number): string {
  const [hh, mm] = startStr.split(':').map(Number);
  const total = (hh * 60 + mm + durationMinutes) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** The reminder controls as one value, for the sync rules below. */
export interface ReminderControlState {
  notificationsEnabled: boolean;
  /** The anchor alert AT the scheduled time — opt-OUT, on by default. */
  reminderAtDue: boolean;
  reminder24h: boolean;
  reminder1h: boolean;
  reminder30m: boolean;
  reminder15m: boolean;
}

export type ReminderControlField = keyof ReminderControlState;

function noEarlierRemindersIn(state: ReminderControlState): boolean {
  return !state.reminder24h && !state.reminder1h && !state.reminder30m && !state.reminder15m;
}

/**
 * Next reminder-control state for one user toggle — pure, so the coupling rules
 * are testable without the modal.
 *
 * MEDICATION IS NEVER COUPLED. `notifications_enabled` alone produces the push
 * at the dose time plus the whole escalation chain, so the master toggle is
 * already honest on its own and the four `reminder_*` flags are genuinely
 * optional extras. Linking them would either invent a pre-reminder the user did
 * not ask for or switch off the missed-dose alerts.
 *
 * For task / appointment the four flags used to be the ONLY notifications, so
 * "master on + all four off" read as "on" and notified nobody. `reminderAtDue`
 * changes that: with it on, the entry still alerts at the scheduled time. What
 * is left is ONE-WAY — the boxes can take the master down, the master never
 * touches a box:
 *
 *  1. GONE. Master off → on used to re-check `reminder15m` whenever nothing
 *     would fire (all four earlier boxes off AND the anchor off), so that the
 *     toggle never read "on" over an entry that could not speak. It was the last
 *     path that could tick a box the user had not tapped, and NO path may do
 *     that any more: "Earlier reminders" is opt-in end to end, from the
 *     fresh-form default (`defaultReminder15mFor`) through the type switcher to
 *     this helper. The honesty it was buying is bought instead by
 *     `showNoneSelectedWarning`, which fires on exactly the state rule 1 used to
 *     paper over — "Select at least one time, or no reminder will be sent."
 *     Telling the user is better than choosing for them, and it is what the edit
 *     form already had to do for a hydrated row it must not auto-correct.
 *  2. the last checked box turned off while the master is on AND `reminderAtDue`
 *     is ALSO off ⇒ master off. The `reminderAtDue` clause is load-bearing: this
 *     rule exists because "no earlier reminders" used to mean "silent", and it
 *     no longer does. Flipping the master off while the at-due alert is armed
 *     would discard an alert the user never asked to lose.
 *  3. master turned off by hand ⇒ the four values are left ALONE, so toggling
 *     back on restores the previous selection, whatever it was — with rule 1
 *     gone that is now unconditional. NOTHING clears them, here or at save time:
 *     `reminderFlagsForSave` used to, which broke this rule as soon as the modal
 *     was reopened. Silence is `notifications_enabled`'s job — every cron
 *     selector filters on it.
 */
export function nextReminderControlState(
  current: ReminderControlState,
  field: ReminderControlField,
  value: boolean,
  isMedication: boolean
): ReminderControlState {
  const next: ReminderControlState = { ...current, [field]: value };
  if (isMedication) return next;

  // Rule 1 is gone: the master NEVER checks an earlier reminder, in either
  // direction. Turning it on over an entry where nothing would fire leaves the
  // four boxes exactly as the user left them and lets `showNoneSelectedWarning`
  // say so out loud. Rule 3 — turning it off touches nothing — is the same
  // statement, and is now all this branch does.
  if (field === 'notificationsEnabled') return next;

  // Rule 2 — only on the way down, so checking a box never touches the master,
  // and only into REAL silence: an armed at-due alert still notifies.
  if (
    !value &&
    field !== 'reminderAtDue' &&
    next.notificationsEnabled &&
    !next.reminderAtDue &&
    noEarlierRemindersIn(next)
  ) {
    return { ...next, notificationsEnabled: false };
  }
  return next;
}

export function AddEventModal({
  circleId,
  event,
  initialType,
  initialTitle,
  initialDosage,
  initialTime,
  initialRecurrence,
  onClose,
  onSaved,
}: AddEventModalProps): ReactElement | null {
  const { t } = useTranslation(['calendar', 'common']);
  const { showToast } = useToast();
  const { circle, timezone, canEdit, members } = useCircle(circleId);

  const createEvent = useCreateEvent(circleId);
  const updateEvent = useUpdateEvent(circleId);

  const isEditing = !!event;
  // Edits ALWAYS target the parent series (mobile has no "this event only" edit).
  const targetEventId = isEditing ? event.parent_event_id || event.id : undefined;
  // Editing any instance of a recurring event rewrites the whole series — warn.
  const isRecurringEdit = isEditing && (!!event.parent_event_id || !!event.recurrence_rule);

  const [eventType, setEventType] = useState<EventType>(
    event?.event_type ?? initialType ?? 'medication'
  );
  const [title, setTitle] = useState(event?.medication_name || event?.title || initialTitle || '');
  const [dosage, setDosage] = useState(event?.medication_dosage ?? initialDosage ?? '');
  /** The RxNorm row behind a PICKED medication name; `null` once it is hand-edited. */
  const [selectedDrug, setSelectedDrug] = useState<DrugSearchResult | null>(null);
  /**
   * The VIEWER-frame values the form's inputs hold, converted OUT of the
   * recipient frame the event is stored in. This is the exact inverse of the
   * save below — see utils/recipientEventDate.
   *
   * Keyed on `timezone` as well as `event` because `useCircle` reports `null`
   * until the circle detail query lands. A one-shot
   * useState would hydrate through the WRONG ZONE and never correct itself, and
   * since the save converts with the RESOLVED zone that is a mixed-frame round
   * trip: it would move the very dose the user opened without editing. The
   * resync effect below closes that.
   *
   * Creating: default to the VIEWER's today, because that is the frame the
   * field is in. (It used to default to the recipient's today, which was right
   * only while the field was read as recipient-frame.)
   */
  const hydrated = useMemo(() => {
    if (event) {
      // GATE: no recipient zone yet means no frame to convert OUT of, so the
      // fields stay EMPTY rather than being filled through a guessed zone. The
      // resync effect below refills them the moment the real zone lands (the
      // modal renders nothing until then — `canEdit` is false while loading).
      if (!timezone) {
        return { dateStr: '', timeStr: '', recurrenceEndDateStr: '' };
      }
      return eventDatesFromApi({
        scheduledDate: event.scheduled_date,
        scheduledTime: event.scheduled_time ?? null,
        recurrenceEndDate: event.recurrence_end_date ?? null,
        timezone,
      });
    }
    return {
      // `initialTime` is already VIEWER-frame `HH:MM` (the wizard's own field
      // frame), so it drops straight in with no conversion — the same value the
      // user would have typed here themselves.
      dateStr: getDateInTimezone(getDeviceTimezone()),
      timeStr: initialTime ?? '',
      recurrenceEndDateStr: '',
    };
  }, [event, timezone, initialTime]);

  const [dateStr, setDateStr] = useState(hydrated.dateStr);
  const [timeStr, setTimeStr] = useState(hydrated.timeStr);
  const [endTimeStr, setEndTimeStr] = useState(() => {
    // `duration_minutes` is a DELTA, so it is frame-independent: the viewer's
    // end time is the viewer's start time plus the duration. Derived from the
    // hydrated (viewer-frame) start, never from the stored recipient string.
    if (!hydrated.timeStr || !event?.duration_minutes) return '';
    return endTimeForDuration(hydrated.timeStr, event.duration_minutes);
  });
  const [location, setLocation] = useState(event?.location ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [assignedTo, setAssignedTo] = useState<string | null>(event?.assigned_to ?? null);

  // An edit hydrates from the stored rule; a create may carry the wizard's
  // hand-off answer. `parseRecurrence` maps null/undefined to 'none', so an
  // ordinary create is unchanged.
  const initialRecurrenceState = parseRecurrence(
    event ? event.recurrence_rule : initialRecurrence
  );
  const [recurrence, setRecurrence] = useState<RecurrenceChoice>(initialRecurrenceState.choice);
  const [daysOn, setDaysOn] = useState(initialRecurrenceState.daysOn);
  const [daysOff, setDaysOff] = useState(initialRecurrenceState.daysOff);
  const [recurrenceEndDate, setRecurrenceEndDate] = useState(hydrated.recurrenceEndDateStr);

  // The six reminder switches hydrate from the event itself — the list response
  // carries all of them (see the block on `CalendarEvent`). NO CAST: this save
  // rewrites every one of them, so the read has to be the one `tsc` checks.
  const reminders: Partial<CalendarEvent> = event ?? {};
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    reminders.notifications_enabled ?? true
  );
  /**
   * The anchor alert, ON by default for EVERY event type.
   *
   * `?? true` is the only defensible fallback: `CalendarEvent` (the list read
   * type) does not carry the reminder flags, and a row written before this
   * column existed — or an API response from a build that predates it — simply
   * omits the key. The column is `NOT NULL DEFAULT TRUE`, so the server WILL
   * send that alert; defaulting the switch to off would show the user a state
   * the backend disagrees with, and an untouched Save would then write the
   * disagreement back as fact.
   */
  const [reminderAtDue, setReminderAtDue] = useState(reminders.reminder_at_due ?? true);
  const [reminder24h, setReminder24h] = useState(reminders.reminder_24h ?? false);
  const [reminder1h, setReminder1h] = useState(reminders.reminder_1h ?? false);
  const [reminder30m, setReminder30m] = useState(reminders.reminder_30m ?? false);
  /**
   * "15 minutes before" — OFF on a fresh form of EVERY type, and whatever the
   * row actually holds on an existing one. Both rules live in
   * `defaultReminder15mFor` / `hydratedReminder15m`, which mobile mirrors by
   * name; read the note there before changing either.
   */
  const [reminder15m, setReminder15m] = useState(
    hydratedReminder15m(eventType, reminders.reminder_15m)
  );
  /**
   * Has the user touched the reminder controls? Governs the type-switch
   * default below — once they have expressed a preference, it is theirs.
   */
  const remindersTouched = useRef(false);

  const [errors, setErrors] = useState<FieldErrors>({});
  // Payload held while the past-time notice is showing (mobile GAP #4 parity):
  // a medication scheduled for TODAY at a time that already passed gets a
  // lightweight confirm, then proceeds. The two paths mean different things:
  //   - creating: the backend does NOT create the med for today at all — it
  //     rolls the start forward to the med's next real occurrence (tomorrow,
  //     the next matching weekday, or +7). Never name a date; the client does
  //     no rolling of its own and keeps sending the date the user picked.
  //   - editing: no roll happens, the row stays on today; the only consequence
  //     is that today's reminder will not fire.
  const [pendingPastTime, setPendingPastTime] = useState<CreateEventRequest | null>(null);
  /** The ⓘ explainer behind the Reminders heading (mobile's info bottom sheet). */
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  /**
   * Re-hydrate once the recipient timezone actually resolves.
   *
   * `useCircle` reports `null` until the circle detail
   * query lands, and the useState initializers above run ONCE — hooks execute
   * even on the renders where this component returns null for `!canEdit`. So a
   * modal mounted mid-flight hydrates through the WRONG ZONE and never corrects
   * itself.
   *
   * That is not cosmetic here: the save converts with the RESOLVED zone, so
   * hydrating in one frame and saving in another rewrites the event by the gap
   * between them — permanently, silently, on an event the user only looked at.
   * Mobile gates its save on `!circle` for the same reason; this form is
   * already gated by `canEdit` (false while loading), so the remaining hole was
   * exactly this stale hydration.
   *
   * Untouched fields only: a user who has picked a date or time owns it.
   */
  const datesTouched = useRef(false);
  useEffect(() => {
    if (datesTouched.current) return;
    setDateStr(hydrated.dateStr);
    setTimeStr(hydrated.timeStr);
    setRecurrenceEndDate(hydrated.recurrenceEndDateStr);
    setEndTimeStr(
      hydrated.timeStr && event?.duration_minutes
        ? endTimeForDuration(hydrated.timeStr, event.duration_minutes)
        : ''
    );
  }, [hydrated, event]);

  /**
   * Re-apply the fresh-form "15 minutes before" default when the TYPE changes.
   *
   * The initializer above runs ONCE, off the type the modal opened with, and the
   * global Create menu opens with no `initialType` — so every type switch is a
   * form the default was computed for under a different type. The default is
   * currently the same for all three (`defaultReminder15mFor` returns false), so
   * this is inert today; it stays because the call site is real. A per-type
   * default reintroduced in the helper has to be re-applied HERE, and it was
   * this exact site being written inline, out of sync with the initializer, that
   * produced the asymmetry this change removes.
   *
   * Creating only, and only while the user has not touched the controls: an
   * edit hydrates from stored flags, and a chosen preference outranks a default.
   *
   * Only `reminder15m` is re-defaulted here. `reminderAtDue` starts true for
   * every type and has no per-type default to re-apply, so a switch of the type
   * selector can never walk over an explicit choice — and `remindersTouched`
   * (set by every `changeReminder` call) guards the whole effect regardless.
   */
  useEffect(() => {
    if (isEditing || remindersTouched.current) return;
    setReminder15m(defaultReminder15mFor(eventType));
  }, [eventType, isEditing]);

  // Keep the assignee selection valid as members load.
  useEffect(() => {
    if (assignedTo && !members.some((m) => m.id === assignedTo)) {
      setAssignedTo(null);
    }
  }, [assignedTo, members]);

  const isMedication = eventType === 'medication';
  const isPending = createEvent.isPending || updateEvent.isPending;

  // ── Reminder messaging (display only — never changes what gets saved) ──────
  // Backend notification semantics are ASYMMETRIC by event type, and the four
  // reminder_* checkboxes alone do not tell that story:
  //   medication → notifications_enabled ALSO drives the whole escalation chain
  //     (care recipient at 15 min late, caregivers at 30, the whole circle at an
  //     hour). None of that reads the reminder_* flags, so unchecking all four
  //     still leaves the missed-dose alerts intact.
  //   task / appointment → no escalation chain; reminder_at_due plus the four
  //     earlier flags are the whole story.
  // What both types now share is the ANCHOR: reminder_at_due sends the alert AT
  // the scheduled time for every type, so "all four earlier reminders off" is no
  // longer a synonym for "silent".
  const noEarlierReminders = !reminder24h && !reminder1h && !reminder30m && !reminder15m;
  // NOT DEAD CODE. The sync rules make "master on + everything off" unreachable
  // by INTERACTION for task/appointment, but it is still reachable by HYDRATION:
  // a task/appointment saved before those rules existed can carry
  // notifications_enabled = true with every flag false, and the edit modal opens
  // straight into it. We deliberately do NOT auto-correct on hydrate — that would
  // silently mutate a saved entry the user never touched — so this warning is the
  // safety net for that one path.
  //
  // GATED ON reminderAtDue. "no reminder will be sent" is simply FALSE while the
  // at-due alert is armed, and a warning that cries wolf trains users to ignore
  // the one case that matters.
  const showNoneSelectedWarning =
    !isMedication && notificationsEnabled && noEarlierReminders && !reminderAtDue;
  const remindersOffNote = notificationsEnabled
    ? null
    : t(isMedication ? 'addEvent.reminders.offMedication' : 'addEvent.reminders.offGeneric');

  // ON A SELF-CARE CIRCLE THE OWNER *IS* THE CARE RECIPIENT.
  //
  // The escalation line names who gets pinged first, and "the care recipient
  // after 15 minutes" reads as a third party to the one person it is actually
  // describing. Mobile has branched this since the chain shipped
  // (AddEventScreen's `circle?.is_self_care` ternary); web never did, and this
  // is the only place in the webapp that was still missing the flag — it is
  // already threaded through CreateCircleModal, InviteMemberModal and CareTeam.
  //
  // DISPLAY ONLY. The push itself has always been right: the tier selectors
  // return `is_self_care` and `backend/src/routes/notifications.ts` picks the
  // recipient from it, so this corrects what the form SAYS, not what it sends.
  const isSelfCare = circle?.is_self_care === true;
  const escalationNote = t(
    isSelfCare ? 'addEvent.reminders.escalationSelf' : 'addEvent.reminders.escalation'
  );

  // THE ANCHOR IS OFF AND NOTHING EARLIER IS PICKED — a state `atTimeOff` lies
  // about, because it points at "the earlier reminders you pick below" when the
  // user has picked none.
  //
  // For a task `showNoneSelectedWarning` above already covers it. A MEDICATION
  // never reaches that warning (it is `!isMedication`) and the omission was
  // correct as far as it went: the escalation chain hangs off
  // notifications_enabled alone, so the dose is not silent. But the only thing
  // left to fire is a MISSED-dose follow-up — the first thing anyone hears is
  // "this is 15 minutes late", which is the exact inversion the at-due anchor
  // was added to fix. Saying so is the honest version of `atTimeOff` here.
  const showNoEarlierBeforeDose =
    isMedication && notificationsEnabled && !reminderAtDue && noEarlierReminders;

  /** Apply one reminder toggle through the sync rules. */
  function changeReminder(field: ReminderControlField, value: boolean): void {
    // A deliberate choice outranks the type-switch default above.
    remindersTouched.current = true;
    const next = nextReminderControlState(
      { notificationsEnabled, reminderAtDue, reminder24h, reminder1h, reminder30m, reminder15m },
      field,
      value,
      isMedication
    );
    setNotificationsEnabled(next.notificationsEnabled);
    setReminderAtDue(next.reminderAtDue);
    setReminder24h(next.reminder24h);
    setReminder1h(next.reminder1h);
    setReminder30m(next.reminder30m);
    setReminder15m(next.reminder15m);
  }

  // ── Dual-timezone conversion (mirrors mobile's getTimezoneConversionText) ──
  //
  // Shown ONLY when the viewer and the recipient are actually in different
  // zones. Single-zone circles are the overwhelming majority and get one time
  // and no zone-label clutter.
  //
  // Gated on the OFFSET, never on the zone NAMES: ICU resolves TZ=Asia/Kolkata
  // to the legacy alias Asia/Calcutta, so a name compare would light this hint
  // up on a circle that is not dual-zone at all.
  const deviceTimezone = getDeviceTimezone();
  const hourCycle = useHourCycle();
  //
  // Evaluated at the EVENT's instant, not at `new Date()`. Two zones can agree
  // today and differ on the date being scheduled: Phoenix and Denver are both
  // -07:00 in January and -07:00/-06:00 in July. A now-based gate meant a
  // Phoenix caregiver scheduling a July event for a Denver recipient saw NO
  // hint while `eventDatesForApi` still shifted the stored time by an hour —
  // the conversion happening silently is precisely the failure the hint exists
  // to prevent. `dateStr` therefore belongs in the deps.
  //
  // GATED on the zone rather than defaulted: with no recipient zone yet there
  // is nothing to compare against, and a fallback would claim "your clock
  // differs from theirs" (or, worse, that it does NOT) off a guess.
  const showDualTimezone = useMemo(
    () =>
      !!timezone &&
      timezonesAreDifferent(
        deviceTimezone,
        timezone,
        dateStr ? viewerInstant(dateStr, timeStr || '12:00') : undefined
      ),
    [deviceTimezone, timezone, dateStr, timeStr]
  );
  // The recipient's zone by NAME — its city ("New York", "Ciudad de México"),
  // localised for the reader. Bare rather than parenthesised: both places this
  // is used already supply their own brackets, and the conversion line below
  // ends in a parenthetical day indicator it must not collide with.
  // Empty until the zone resolves — the only consumers are the dual-timezone
  // hint and the conversion line, both of which are gated off entirely then,
  // and both already handle a nameless zone (see `withZone` below).
  const recipientZone = timezone ? getTimezoneLabel(timezone) : '';
  const recipientName = circle?.recipient_name;

  /**
   * "8:00 PM Denver = 9:00 PM Chicago (+1 day)" — the conversion, live, as the user
   * types. Nothing about the frame is hidden: the caregiver types their own
   * clock and sees the recipient's.
   *
   * The day indicator is derived by comparing the two zones' actual
   * `YYYY-MM-DD` readings of the same instant, rather than mobile's numeric
   * day-of-month compare (which needs a special case for month rollover and
   * still misreads a 2-day gap).
   */
  const conversionText = useMemo(() => {
    // `!timezone` is implied by `!showDualTimezone`; it is spelled out so the
    // recipient-frame conversions below are provably never run on a guess.
    if (!showDualTimezone || !timezone || !timeStr || !dateStr) return null;
    try {
      const instant = viewerInstant(dateStr, timeStr);
      const render = (clock: string): string => {
        const [hh, mm] = clock.split(':').map(Number);
        return formatTimeOfDay(hh, mm, hourCycle);
      };
      const viewerTime = render(clockInZone(instant, deviceTimezone));
      const recipientTime = render(clockInZone(instant, timezone));

      const viewerDay = dayInZone(instant, deviceTimezone);
      const recipientDay = dayInZone(instant, timezone);
      let dayIndicator = '';
      if (viewerDay !== recipientDay) {
        dayIndicator = ` (${t(
          recipientDay > viewerDay ? 'addEvent.dayOffsetNext' : 'addEvent.dayOffsetPrevious'
        )})`;
      }

      // A zone with no city in it (the `Etc/*` family, a bare offset) yields no
      // name at all, and a dangling space is worse than no label.
      const withZone = (time: string, zone: string): string => (zone ? `${time} ${zone}` : time);
      return `${withZone(viewerTime, getTimezoneLabel(deviceTimezone))} = ${withZone(
        recipientTime,
        recipientZone
      )}${dayIndicator}`;
    } catch {
      return null;
    }
  }, [showDualTimezone, dateStr, timeStr, deviceTimezone, timezone, hourCycle, recipientZone, t]);

  /** The label above the time field: "Your time / Margaret's time (New York)". */
  const dualTimezoneLabel = recipientName
    ? t('addEvent.dualTimezoneHint', { name: recipientName, timezone: recipientZone })
    : t('addEvent.dualTimezoneHintGeneric', { timezone: recipientZone });

  // History-based title quick-fill (QP6) — sourced from the circle's ALREADY
  // CACHED calendar events (no new fetching); generics pad the list. The row
  // hides when the title exactly matches a chip (it has done its job).
  const cachedEvents = useCachedCircleEvents(circleId);
  const titleSuggestions = useMemo(() => {
    if (isMedication) return [];
    const generics = (eventType === 'appointment' ? APPOINTMENT_TITLE_KEYS : TASK_TITLE_KEYS).map(
      (key) => t(key)
    );
    return deriveTitleSuggestions(cachedEvents, eventType, Date.now(), generics);
  }, [cachedEvents, eventType, isMedication, t]);
  // Row stays visible when the title matches a chip so the selected chip can be
  // tapped again to clear (accidental-tap undo).
  const showTitleSuggestions = !isMedication && titleSuggestions.length > 0;

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

  function clearError(...fields: string[]): void {
    setErrors((prev) => {
      if (!fields.some((field) => field in prev)) return prev;
      const next = { ...prev };
      for (const field of fields) delete next[field];
      return next;
    });
  }

  /**
   * Map a Zod issue KEY NAME (emitted by `eventFormSchema`, never prose) to a
   * translated message. Same helper shape as VitalFormModal.messageFor —
   * unknown keys degrade to a generic localized line instead of leaking Zod's
   * English default ("String must contain at most 150 character(s)").
   */
  function messageFor(key: string): string {
    return t(`addEvent.validation.${key}`, { defaultValue: t('addEvent.validation.invalid') });
  }

  // Takes the RESOLVED recipient timezone as an argument rather than closing
  // over the nullable hook value: the save converts the viewer's wall clock
  // into the recipient's frame, so "which zone" is not optional here and the
  // gate belongs in the signature. `handleSubmit` is the only caller and it
  // refuses to run until the zone is known.
  function buildPayload(tz: string):
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

    // TZ-correct scheduling: the fields hold the VIEWER's wall clock, so the
    // save converts them into the CARE RECIPIENT's frame — and derives BOTH
    // dates together, because the backend compares them directly
    // (adherenceSchedule.ts: `if (current > recurrence_end_date) break`) and a
    // caller must not be able to derive one and forget the other.
    //
    // The end date is NOT a second instant conversion: its span is counted on
    // the viewer's side and ADDED to the recipient's start day, so "30 days"
    // means 30 doses even when the recipient's zone changes offset mid-series.
    // See utils/recipientEventDate for why that matters.
    const apiDates = eventDatesForApi({
      dateStr,
      timeStr: timeStr || null,
      recurrenceEndDateStr:
        recurrence !== 'none' && recurrenceEndDate ? recurrenceEndDate : null,
      timezone: tz,
    });
    const scheduled_date = apiDates.scheduledDate;
    const scheduled_time = apiDates.scheduledTime;

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
      // ALL FIVE, VERBATIM, ALWAYS. Neither the master toggle nor a missing
      // scheduled time rewrites them any more: the cron filters both
      // `notifications_enabled = true` and `scheduled_time IS NOT NULL`, so an
      // unsendable flag is inert — while overwriting one is permanent, because
      // `reminder_at_due` is NOT NULL DEFAULT TRUE and a stored `false` cannot be
      // told apart from a deliberate opt-out. See `reminderFlagsForSave`.
      ...reminderFlagsForSave(
        {
          reminder_at_due: reminderAtDue,
          reminder_24h: reminder24h,
          reminder_1h: reminder1h,
          reminder_30m: reminder30m,
          reminder_15m: reminder15m,
        },
        notificationsEnabled,
        remindersApply(eventType, timeStr)
      ),
      recurrence_rule,
      // From `eventDatesForApi`, never from the raw field: it must share the
      // start date's frame.
      recurrence_end_date: apiDates.recurrenceEndDate,
    };

    if (isMedication) {
      data.medication_name = trimmedTitle;
      data.medication_dosage = dosage.trim() || undefined;
      // Only a PICKED drug carries its concept id (mobile: `if (selectedDrug?.rxcui)`).
      if (selectedDrug?.rxcui) data.rxcui = selectedDrug.rxcui;
    }
    // Always sent for assignable types, null included — updates are partial
    // patches server-side, so omitting the key left the old assignee in place
    // and made "Anyone" impossible to go back to.
    const assignedToValue = assignedToForSave(eventType, assignedTo);
    if (assignedToValue !== undefined) {
      data.assigned_to = assignedToValue;
    }

    // Final guard: validate against the shared web Zod schema (mirrors backend).
    const result = validateWithZod(eventFormSchema, data);
    if (!result.success) {
      // Zod emits KEY NAMES here — translate before they reach an `error=` prop.
      const mapped: FieldErrors = {};
      for (const [field, msg] of Object.entries(result.errors)) {
        mapped[field] = messageFor(msg);
      }
      return { ok: false, errors: mapped };
    }
    return { ok: true, data };
  }

  async function persist(data: CreateEventRequest): Promise<void> {
    try {
      if (isEditing && targetEventId) {
        await updateEvent.mutateAsync({ eventId: targetEventId, data });
        showToast(t(isRecurringEdit ? 'addEvent.updatedSeries' : 'addEvent.updated'), 'success');
      } else {
        await createEvent.mutateAsync(data);
        showToast(t(createdToastKey(eventType)), 'success');
      }
      onSaved?.();
      onClose();
    } catch {
      // The mutation hooks surface their own permission/subscription/save toasts.
    }
  }

  async function handleSubmit(formEvent: FormEvent): Promise<void> {
    formEvent.preventDefault();
    // GATE, not a fallback: every date below is derived in the CARE
    // RECIPIENT's frame, so saving before the zone resolves would write the
    // event at a New-York-derived instant and silently move it. `canEdit` is
    // already false until the detail query lands, so this is belt-and-braces —
    // but it is the one place where guessing the zone corrupts stored data.
    if (!canEdit || !timezone || isPending) return;

    const built = buildPayload(timezone);
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

    // Mobile parity (AddEventScreen GAP #4): saving a MEDICATION whose time
    // already passed TODAY (care recipient's timezone — never device-local)
    // gets a non-blocking notice first; confirming proceeds with the save.
    // The notice's copy differs by path (see `pendingPastTime` above). Only ONE
    // dose time exists on this surface — the form has a single time field, so
    // there are no BID/TID extras to sweep the way mobile does.
    if (
      built.data.event_type === 'medication' &&
      built.data.scheduled_time &&
      built.data.scheduled_date === getDateInTimezone(timezone) &&
      isEventPastDue(built.data.scheduled_date, built.data.scheduled_time, timezone)
    ) {
      setPendingPastTime(built.data);
      return;
    }

    await persist(built.data);
  }

  // THE SYNCHRONOUS DOUBLE-SUBMIT GUARD. `isPending` above is React Query
  // state, committed a render AFTER the submit that started the request, so two
  // submits dispatched in the SAME tick both re-enter `handleSubmit` with the
  // flag still false — and `disabled` on the footer button is never consulted
  // by implicit form submission (Enter in a field) or a synthetic
  // `requestSubmit()`. The result is TWO CARE RECORDS: two medication series
  // for one drug, each with its own reminder schedule and its own
  // dose-confirmation stream, which doubles the denominator of the adherence
  // figure the clinician-facing report is built from.
  //
  // `handleSubmit` awaits the request, so the promise-holding form of the hook
  // is the right one: the guard is held for exactly as long as the save is in
  // flight, and released in a `finally` so a rejected save, a validation
  // failure, or the past-time notice's early return all leave the form usable.
  // `isPending` stays exactly where it is — it is the VISUAL guard (spinner,
  // disabled styling); this is the correctness one.
  const guardedSubmit = useGuardedSubmit(handleSubmit);

  // Hidden entirely when the user can't edit — the read-only path keeps the
  // EventDetailModal download CTA instead (Task 1.6 gating).
  if (!canEdit) return null;

  const typeOptions = (['medication', 'appointment', 'task'] as EventType[]).map((type) => ({
    value: type,
    label: t(`addEvent.types.${type}`),
  }));

  const titleFieldId = isMedication ? 'medication_name' : 'title';

  return (
    <>
    <Modal
      title={isEditing ? t('addEvent.editTitle') : t('addEvent.newTitle')}
      onClose={onClose}
      closeLabel={t('addEvent.close')}
      size="lg"
      closeOnBackdropClick={false}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            {t('common:cancel')}
          </Button>
          <Button type="submit" form="add-event-form" loading={isPending}>
            {isEditing ? t('addEvent.saveChanges') : t('addEvent.create')}
          </Button>
        </>
      }
    >
      <form id="add-event-form" onSubmit={guardedSubmit} className="flex flex-col gap-4" noValidate>
        {/* Recurring edits rewrite the whole series — keep the warning visible. */}
        {isRecurringEdit && (
          <Card variant="filled" padding="sm" as="p" role="note" className="m-0 text-sm text-ink-2">
            {t('addEvent.recurringEditNotice')}
          </Card>
        )}

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
            if (next !== 'medication') setSelectedDrug(null);
            if (next !== 'task' && next !== 'appointment') setAssignedTo(null);
            if (next === 'medication') setEndTimeStr('');
          }}
        />

        {isMedication ? (
          // Real drug names from RxNorm as you type (mobile parity). For a
          // medication the payload sets BOTH `medication_name` and `title`
          // from this one input, so a schema error can land on either key —
          // bind both so it can never fail silently.
          <DrugAutocomplete
            id={titleFieldId}
            label={t('addEvent.fields.medicationName')}
            required
            value={title}
            maxLength={150}
            error={errors[titleFieldId] ?? errors.title}
            placeholder={t('addEvent.placeholders.medicationName')}
            selectedDrug={selectedDrug}
            onSelectDrug={setSelectedDrug}
            onChange={(next) => {
              setTitle(next);
              clearError(titleFieldId, 'title');
            }}
          />
        ) : (
          <TextField
            id={titleFieldId}
            label={t('addEvent.fields.title')}
            required
            value={title}
            maxLength={150}
            error={errors[titleFieldId] ?? errors.title}
            placeholder={t(
              eventType === 'appointment'
                ? 'addEvent.placeholders.appointmentTitle'
                : 'addEvent.placeholders.taskTitle'
            )}
            onChange={(e) => {
              setTitle(e.target.value);
              clearError(titleFieldId, 'title');
            }}
          />
        )}

        {showTitleSuggestions && (
          <ChipSelect
            id="title-suggestions"
            label={t('addEvent.titleSuggestions.label')}
            options={titleSuggestions}
            value={title}
            onChange={(next) => {
              setTitle(next ?? '');
              if (next) clearError(titleFieldId, 'title');
            }}
          />
        )}

        {isMedication && (
          <TextField
            id="medication_dosage"
            label={t('addEvent.fields.dosage')}
            value={dosage}
            maxLength={100}
            error={errors.medication_dosage}
            placeholder={t('addEvent.placeholders.dosage')}
            onChange={(e) => {
              setDosage(e.target.value);
              clearError('medication_dosage');
            }}
          />
        )}

        {eventType === 'appointment' && (
          <TextField
            id="location"
            label={t('addEvent.fields.location')}
            value={location}
            maxLength={250}
            error={errors.location}
            placeholder={t('addEvent.placeholders.location')}
            onChange={(e) => {
              setLocation(e.target.value);
              clearError('location');
            }}
          />
        )}

        <DateField
          id="scheduled_date"
          label={t('addEvent.fields.date')}
          required
          value={dateStr}
          error={errors.scheduled_date}
          hint={showDualTimezone ? dualTimezoneLabel : undefined}
          onChange={(e) => {
            datesTouched.current = true;
            setDateStr(e.target.value);
            clearError('scheduled_date');
          }}
        />

        {/* Medication SCHEDULE presets (R6-2) — the ONE med chip strip: every
            chip sets a COMPLETE daily schedule (time + daily recurrence) in
            one tap; tapping the selected chip again returns both to unset.
            Selected state is an EXACT match of time + recurrence. Prefill
            only — the save path below is untouched. (Web subset: the form has
            a single time field, so only the single-time presets are offered —
            see MED_SCHEDULE_PRESETS.) */}
        {isMedication && (
          <ChipSelect
            id="schedule-presets"
            label={t('addEvent.schedulePresets.label')}
            options={MED_SCHEDULE_PRESETS.map((preset) => ({
              value: preset.id,
              label: t(preset.labelKey),
            }))}
            value={
              MED_SCHEDULE_PRESETS.find(
                (preset) => preset.time === timeStr && preset.recurrence === recurrence
              )?.id ?? null
            }
            onChange={(next) => {
              const preset = next
                ? MED_SCHEDULE_PRESETS.find((candidate) => candidate.id === next)
                : undefined;
              datesTouched.current = true;
              if (preset) {
                setTimeStr(preset.time);
                setRecurrence(preset.recurrence);
                clearError('scheduled_time');
              } else {
                // Untap — return the preset-controlled fields to unset.
                setTimeStr('');
                setRecurrence('none');
              }
            }}
          />
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TimeField
            id="scheduled_time"
            label={t('addEvent.fields.time')}
            // Mirrors `buildRequest`: a medication cannot be scheduled without
            // a time; appointments and tasks may be all-day.
            required={isMedication}
            value={timeStr}
            error={errors.scheduled_time}
            hint={
              // The live conversion wins over the "optional" note whenever the
              // zones differ — it is the thing the caregiver needs to see while
              // typing, and it is what keeps the frame from being hidden.
              conversionText ?? (isMedication ? undefined : t('addEvent.hints.timeOptional'))
            }
            onChange={(e) => {
              const next = e.target.value;
              datesTouched.current = true;
              setTimeStr(next);
              clearError('scheduled_time');
              if (!next) {
                setEndTimeStr('');
              } else if (!isMedication && !endTimeStr) {
                // An end time is required (the calendar renders these as
                // blocks), so prefill the default rather than making the user
                // supply a second value before they can save.
                setEndTimeStr(addMinutesToTimeStr(next, DEFAULT_DURATION_MINUTES));
                clearError('endTime');
              }
            }}
          />
          {!isMedication && (
            <TimeField
              id="endTime"
              label={t('addEvent.fields.endTime')}
              // Required only once a start time exists (the validator's rule);
              // until then the field is disabled and nothing is asked of it.
              required={Boolean(timeStr)}
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

        {/* Duration presets — the chips cover the common spans; the end-time
            field above stays for anything else. */}
        {!isMedication && timeStr && (
          <ChipSelect
            id="duration-presets"
            label={t('addEvent.fields.duration')}
            options={DURATION_PRESETS.map((mins) => ({
              value: String(mins),
              label: t(`addEvent.durations.${mins}`),
            }))}
            value={(() => {
              const index = matchingDurationIndex(timeStr, endTimeStr);
              return index === -1 ? null : String(DURATION_PRESETS[index]);
            })()}
            onChange={(next) => {
              // Deselect is a no-op: the end time is required once a start
              // time exists, so a chip can be changed but not cleared.
              if (!next) return;
              setEndTimeStr(addMinutesToTimeStr(timeStr, Number(next)));
              clearError('endTime');
            }}
          />
        )}

        {(eventType === 'task' || eventType === 'appointment') && (
          <Select
            id="assigned_to"
            label={t('addEvent.fields.assignedTo')}
            options={assigneeOptions}
            value={assignedTo ?? ''}
            onChange={(e) => setAssignedTo(e.target.value || null)}
          />
        )}

        {/* THE EVENT'S OWN DESCRIPTION FIELD — never labelled "Notes".
            "Notes" already names two other things (the shared event-notes
            thread on the detail dialog, and the Notes tab), so this single
            free-text field is DETAILS — or, for a medication, its dosing
            INSTRUCTIONS. EventDetailModal labels the same field the same way. */}
        <TextArea
          id="description"
          label={isMedication ? t('addEvent.fields.instructions') : t('addEvent.fields.details')}
          value={description}
          rows={3}
          maxLength={850}
          error={errors.description}
          placeholder={
            isMedication ? t('addEvent.placeholders.instructions') : t('addEvent.placeholders.details')
          }
          onChange={(e) => {
            setDescription(e.target.value);
            clearError('description');
          }}
        />

        {/* Recurrence */}
        <Select
          id="recurrence_rule"
          label={t('addEvent.fields.repeat')}
          options={recurrenceOptions}
          value={recurrence}
          error={errors.recurrence_rule}
          onChange={(e) => {
            setRecurrence(e.target.value as RecurrenceChoice);
            clearError('recurrence_rule');
          }}
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
            error={errors.recurrence_end_date}
            onChange={(e) => {
              datesTouched.current = true;
              setRecurrenceEndDate(e.target.value);
              clearError('recurrence_end_date');
            }}
          />
        )}

        {/* Reminders — only once there is a time to fire against. */}
        {remindersApply(eventType, timeStr) && (
        <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
          <Text variant="sectionTitle" as="legend" className="p-0">
            {t('addEvent.reminders.section')}
          </Text>
          {/* WHERE THESE ACTUALLY GO.
              Every control below writes a flag the BACKEND acts on by sending an
              Expo push — and the web app has no push at all: no service worker,
              no Notification API, and it never registers a push token. When a
              user has none, notificationService returns `no_token` and stops;
              there is no email fallback on that path.

              STATES THE DESTINATION, NOT THE LIMITATION. This used to carry a
              second sentence — "The web app cannot send them" — which read as a
              defect of the surface the user is standing on and invited "then why
              am I setting this here?". It also overreached: the reminders are
              mostly NOT for the viewer. The escalation chain pings the care
              recipient and the other caregivers on their phones, so a web-only
              caregiver arranging their mother's doses gets exactly the outcome
              they wanted — the phrasing just implied nothing would happen.

              The case it was protecting is a web-only user with NO device, for
              whom these really do go nowhere. That warning wants
              `GET /push-tokens` (already routed; `queryKeys.pushTokens` is
              reserved and unused), so it can fire only for a viewer with no
              active token and say "you" rather than "no one" — the member
              payload carries no device info, so this surface can never speak for
              anybody else. Until then one true sentence beats a blanket one. */}
          <p className="m-0 text-sm text-ink-3">{t('addEvent.reminders.webDelivery')}</p>
          {/* The explainer trigger, mobile's ⓘ beside the notifications row.
              NOT folded into the `<legend>` above, in either direction: a legend
              must be the fieldset's FIRST child or it stops naming the group, so
              it cannot be wrapped in a flex row, and nesting the button inside it
              instead drags "How notifications work" into the accessible name
              every control in this fieldset inherits.

              Labelled with VISIBLE TEXT rather than an icon alone. Mobile can
              lean on a bare ⓘ because its sheet is one tap from a thumb; here
              the same glyph would be a 16px icon-only control whose only name is
              an `aria-label`, which is the weakest form this could take. */}
          <button
            type="button"
            onClick={() => setShowHowItWorks(true)}
            className="-my-2 inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 self-start rounded-md text-sm font-medium text-ink-2 underline decoration-line underline-offset-2 hover:text-ink"
          >
            <Icon name="help-circle-outline" size="inline" />
            {t('addEvent.reminders.howItWorks.button')}
          </button>
          <Toggle
            id="notifications_enabled"
            label={t('addEvent.reminders.enable')}
            hint={
              remindersOffNote ? (
                <>
                  {t('addEvent.reminders.enableHint')}
                  {/* Wired to the switch through the hint's aria-describedby, so
                      the consequence is announced with the control, not by color. */}
                  <span className="mt-1 block font-medium text-terracotta-deep">
                    {remindersOffNote}
                  </span>
                </>
              ) : (
                t('addEvent.reminders.enableHint')
              )
            }
            checked={notificationsEnabled}
            onChange={(next) => changeReminder('notificationsEnabled', next)}
          />
          {notificationsEnabled && (
            <div className="flex flex-col gap-3 rounded-xl border border-line-2 p-3">
              {/* THE ANCHOR ALERT — every event type, and a real control.
                  Apple's model: the alert at the scheduled time is the primary
                  one and the "earlier reminders" below are the optional extras.
                  It used to be a locked, medication-only statement of fact
                  ("Always on for medications"); `reminder_at_due` makes that
                  sentence false, so it is a checkbox now, first in the group.
                  A CHECKBOX, not a switch, and that distinction is the point:
                  "Send reminders" above is the one kill switch for this entry,
                  and everything below it — the anchor included — is a selection
                  WITHIN that permission. Drawn as six identical lozenges the two
                  kinds read as duplicates of each other, which is exactly how
                  mobile already splits them (Switch vs `CheckboxRow`). */}
              <div className="flex flex-col gap-2 border-b border-line-2 pb-3">
                <Checkbox
                  id="reminder_at_due"
                  label={t('addEvent.reminders.atTime')}
                  hint={
                    reminderAtDue ? (
                      t('addEvent.reminders.atTimeHint')
                    ) : (
                      <>
                        {t('addEvent.reminders.atTimeHint')}
                        {/* Inside the checkbox's own aria-describedby hint, so
                            the consequence is announced with the control rather
                            than carried by color alone. */}
                        <span className="mt-1 block font-medium text-terracotta-deep">
                          {t(
                            showNoEarlierBeforeDose
                              ? 'addEvent.reminders.atTimeOffNoEarlier'
                              : 'addEvent.reminders.atTimeOff'
                          )}
                        </span>
                      </>
                    )
                  }
                  checked={reminderAtDue}
                  onChange={(next) => changeReminder('reminderAtDue', next)}
                />
                {/* Medication only: the escalation chain hangs off
                    notifications_enabled, not off any reminder_* flag. */}
                {isMedication && <p className="m-0 text-sm text-ink-3">{escalationNote}</p>}
              </div>
              <div
                role="group"
                aria-labelledby={EARLIER_REMINDERS_LABEL_ID}
                aria-describedby={
                  showNoneSelectedWarning ? EARLIER_REMINDERS_WARNING_ID : undefined
                }
                className="flex flex-col gap-2"
              >
                <Text variant="label" as="span" id={EARLIER_REMINDERS_LABEL_ID}>
                  {t('addEvent.reminders.additional')}
                </Text>
                <Checkbox
                  label={t('addEvent.reminders.h24')}
                  checked={reminder24h}
                  onChange={(next) => changeReminder('reminder24h', next)}
                />
                <Checkbox
                  label={t('addEvent.reminders.h1')}
                  checked={reminder1h}
                  onChange={(next) => changeReminder('reminder1h', next)}
                />
                <Checkbox
                  label={t('addEvent.reminders.m30')}
                  checked={reminder30m}
                  onChange={(next) => changeReminder('reminder30m', next)}
                />
                <Checkbox
                  label={t('addEvent.reminders.m15')}
                  checked={reminder15m}
                  onChange={(next) => changeReminder('reminder15m', next)}
                />
              </div>
            </div>
          )}
          {/* LIVE REGION, OUTSIDE the `notificationsEnabled` block.
              A screen reader only announces a change inside a region that was
              ALREADY in the accessibility tree; a region that mounts at the same
              moment as its text is typically silent. This previously sat inside
              that conditional under a comment claiming it rendered
              unconditionally, so the whole group — region included — unmounted
              on exactly the interaction whose consequence it exists to announce.
              The CONTENT stays conditional; the region does not. */}
          <div aria-live="polite">
            {showNoneSelectedWarning && (
              <p
                id={EARLIER_REMINDERS_WARNING_ID}
                className="m-0 text-sm font-medium text-terracotta-deep"
              >
                {t('addEvent.reminders.noneSelected')}
              </p>
            )}
          </div>
        </fieldset>
        )}
      </form>
    </Modal>

    {/* "How notifications work" — a sibling of the form's Modal, not a child of
        it, exactly as the past-time confirm below is. */}
    {showHowItWorks && (
      <NotificationInfoModal
        isMedication={isMedication}
        isSelfCare={isSelfCare}
        onClose={() => setShowHowItWorks(false)}
      />
    )}

    {/* Past-time notice — non-blocking: Continue saves anyway (parity with
        mobile's lightweight confirm), Cancel returns to the form. */}
    {pendingPastTime && (
      <ConfirmDialog
        icon="time-outline"
        iconTone="clay"
        title={t(
          isEditing ? 'addEvent.alerts.pastTimeEditTitle' : 'addEvent.alerts.pastTimeTitle'
        )}
        message={t(
          isEditing ? 'addEvent.alerts.pastTimeEditMessage' : 'addEvent.alerts.pastTimeMessage'
        )}
        confirmLabel={t('addEvent.alerts.continue')}
        cancelLabel={t('common:cancel')}
        closeLabel={t('addEvent.alerts.closePastTime')}
        onConfirm={() => {
          const data = pendingPastTime;
          setPendingPastTime(null);
          // RETURNED, not `void`ed. `ConfirmDialog` wraps `onConfirm` in
          // `useGuardedSubmit` and awaits what comes back, so a discarded
          // promise leaves the guard covering only the tick the click landed
          // in — and Continue is a SUBMIT, with the same consequence as the
          // form's own: two medication series for one drug, each with its own
          // reminders and dose-confirmation stream (see the note on
          // `guardedSubmit`). No rejection risk to hand upwards: `persist`
          // wraps its whole body in `try`/`catch` because the mutation hooks
          // raise their own toasts, so it resolves on every path.
          return persist(data);
        }}
        onCancel={() => setPendingPastTime(null)}
      />
    )}
    </>
  );
}

/** Type-aware create-success toast key, falling back to the generic one. */
function createdToastKey(eventType: EventType): string {
  switch (eventType) {
    case 'medication':
      return 'addEvent.createdMedication';
    case 'appointment':
      return 'addEvent.createdAppointment';
    case 'task':
      return 'addEvent.createdTask';
    default:
      return 'addEvent.created';
  }
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
