import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { DrugSearchResult } from '@/api/drugs';
import { DrugAutocomplete } from './DrugAutocomplete';
import { DoctorField } from './DoctorField';
import { NotificationInfoModal } from './NotificationInfoModal';
import { DoseQuietHoursNote } from './DoseQuietHoursNote';
import { DosePastTimeNote } from './DosePastTimeNote';
import { DoseDuplicateNote, DoseSummaryLine } from './DoseSummaryLine';
import { MedicationPhotoField, MedicationRefillFields } from './MedicationMoreDetails';
import {
  deleteMedicationPhoto,
  getMedicationFormDetails,
  uploadMedicationPhoto,
} from '@/api/medicationPhoto';
import {
  EMPTY_MEDICATION_DETAILS,
  daysSupplyRate,
  derivedPillsPerDay,
  isCountableForm,
  medicationDetailsFromEvent,
  medicationDetailsPayload,
  type MedicationDetailsHydration,
  type MedicationDetailsState,
} from '@/utils/medicationDetailsForm';
import { siblingDosePayload } from '@/utils/firstRunMedication';
import { clearOnEdit, editPatch } from '@/utils/editPatch';
import { recurrenceForSave } from '@/utils/recurrenceForSave';
import {
  deleteEvent as deleteEventRequest,
  updateEvent as updateEventRequest,
  eventFormSchema,
  SERIES_ROOT_CONTENT_FIELDS,
  type CalendarEvent,
  type CreateEventRequest,
  type EventsPresence,
  type EventType,
  type SeriesRoot,
} from '@/api/calendarEvents';
import { useCachedCircleEvents, useCreateEvent, useUpdateEvent } from '@/hooks/useCalendarEvents';
import { writeFirstMedNote } from '@/lib/firstMedNote';
import { markItEligible, toWireTime, type SavedMedicationInfo } from '@/utils/firstMedSaved';
import { useProviders } from '@/hooks/useProviders';
import type { Provider } from '@/api/providers';
import { WEB_ENTRY_SOURCE } from '@/utils/entrySource';
import { useCircle } from '@/hooks/useCircle';
import { apiErrorStatus, classifyFailureCode } from '@/lib/apiErrors';
import { useSessionDraft } from '@/hooks/useSessionDraft';
import { useGuardedSubmit } from '@/hooks/useGuardedSubmit';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import {
  Analytics,
  type AppointmentAbandonField,
  type DoseDuplicateSource,
  type EntryFormOrigin,
  type EntryFormStep,
  type TimeChipId,
} from '@/lib/analytics';
import { chipForTime } from '@/lib/medTimeOfDay';
import { useAuthStore } from '@/store/authStore';
import { useLargeTextLayoutEvent } from '@/lib/largeText';
import { TimeChips } from './TimeChips';
import { PickerTile } from '@/components/ui/PickerTile';
import { VALUE_TILE_LABEL } from '@/components/ui/ChoiceTileButton';
import { DisclosureRow } from './DisclosureRow';
import { RemindersSummaryRow } from './RemindersSummaryRow';
import { prefersReducedMotion } from '@/components/ui/motion';
import { reminderSummary } from '@/lib/reminderSummary';
import { APPOINTMENT_TITLE_KEYS, TASK_TITLE_KEYS } from '@/lib/quickPicks';
import { deriveTitleSuggestions } from '@/lib/titleSuggestions';
import {
  DEFAULT_DURATION_MINUTES,
  assignedToForSave,
  defaultReminder15mFor,
  hydratedReminder15m,
  reminderFlagsForSave,
  remindersApply,
  shiftEndTimeStr,
  presetEndTimeStr,
  spanMinutes,
} from '@/lib/eventForm';
import {
  CHIP_UNSELECTED,
  CHOICE_TILE_BOX,
  CHOICE_TILE_LABEL,
  INPUT_ERROR,
  VALUE_TILE_CLEARABLE_BODY,
  VALUE_TILE_CLEARABLE_BOX,
  VALUE_TILE_CLEAR_BUTTON,
  choiceTileClass,
  choiceTileSubClass,
} from '@/components/ui/inputStyles';
import {
  Button,
  Card,
  Checkbox,
  ChipSelect,
  ChoiceTileButton,
  ConfirmDialog,
  Eyebrow,
  Icon,
  Modal,
  RequiredMarker,
  Spinner,
  Text,
  TextArea,
  TextField,
  Toggle,
  useToast,
  validateWithZod,
  focusFirstError,
  type FieldErrors,
} from '@/components/ui';
import {
  getDateInTimezone,
  getDeviceTimezone,
  getTimezoneLabel,
  isEventPastDue,
  timezonesAreDifferent,
} from '@/utils/timezone';
import {
  defaultNewEventDate,
  eventDatesForApi,
  eventDatesFromApi,
  extraDoseForApi,
  viewerInstant,
} from '@/utils/recipientEventDate';
import { useHourCycle } from '@/hooks/useHourCycle';
import { useSeriesRoot } from '@/hooks/useSeriesRoot';
import { DaysOfWeekPicker } from './DaysOfWeekPicker';
import {
  clockRangeText as clockRangeTextFor,
  clockText as clockTextFor,
  viewerRangeForCaption,
} from './zoneCaptionRange';
import {
  addDays,
  daysBetween,
  formatDateForDisplay,
  getDayOfWeek,
  getWeekdayName,
  nextDateOnWeekdays,
} from './dateMath';
import { formatRecurrenceLabel, formatWeekdayList } from './recurrenceLabel';

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

/** The three types this form creates and edits. Shifts have their own form. */
export type FormKind = 'medication' | 'appointment' | 'task';

export interface AddEventModalProps {
  circleId: string;
  /** Existing event when editing; omit/undefined for create. */
  event?: CalendarEvent | null;
  /**
   * The type to create. Required in create mode: there is no type switcher (one form per type);
   * ignored when editing (the event's own type decides).
   */
  initialType?: FormKind;
  /**
   * Preselect a doctor on a NEW appointment (the doctor's Visits & notes page
   * "Add an appointment"). The doctor's address fills an empty location, as when
   * it is picked. Ignored when editing (the stored link is the value).
   */
  initialProviderId?: string;
  onClose: () => void;
  /**
   * Called after a successful create/update (parent typically closes + toasts). A NEW
   * medication passes what it saved (onboarding 1.3.1: the first-run payoff and Today's
   * Mark it note are built from it); every other save passes nothing.
   */
  onSaved?: (saved?: SavedMedicationInfo) => void;
  /**
   * FIRST-RUN MODE (onboarding 1.3.1): the setup wizard's "Add {{name}}'s first med" opens
   * THIS form (the real one, not a copy) headed by "{{NAME}}'S FIRST MED" / "What does
   * {{name}} take?" with the hint, "Skip for now" in place of Cancel. Only meaningful on a
   * NEW simple medication; ignored everywhere else. `onClose` without a save = skipped.
   */
  firstRun?: boolean;
  /**
   * How the form was opened, for the form-funnel analytics (`entry_form_opened`
   * and the abandon events). Defaults to 'other'.
   */
  entry?: EntryFormOrigin;
}

type RecurrenceChoice =
  | 'none'
  | 'daily'
  | 'every_other_day'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'cycle'
  // Not a stored rule: `weekly` + `recurrence_days`. LAST, after Cycle — the
  // same position as mobile's Repeat sheet tile.
  | 'days_of_week'
  // Not a stored rule either: the form's name for `as_needed: true` (a
  // medication with NO schedule). Offered on a NEW medication only, and locked
  // once saved (the server answers AS_NEEDED_IMMUTABLE to a flip either way).
  | 'as_needed';

const RECURRENCE_CHOICES: RecurrenceChoice[] = [
  'none',
  'daily',
  'every_other_day',
  'weekly',
  'monthly',
  'yearly',
  'cycle',
  'days_of_week',
  'as_needed',
];

/**
 * A stored `recurrence_days` as a clean set: integers 0..6 (0=Sun — never 7),
 * deduped, ascending. Anything else in the column is dropped, not guessed at.
 */
function cleanRecurrenceDays(days: readonly number[] | null | undefined): number[] {
  if (!days) return [];
  return [...new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(
    (a, b) => a - b
  );
}

/**
 * Map a stored recurrence_rule (+ days) back to the form's choice, cycle parts
 * and day set. `weekly` with a non-empty day set IS "Days of the week" — a
 * single day included ("Weekly on Mon" reopens on the days picker, as on mobile).
 */
function parseRecurrence(
  rule: string | null | undefined,
  recurrenceDays?: readonly number[] | null
): {
  choice: RecurrenceChoice;
  daysOn: string;
  daysOff: string;
  days: number[];
} {
  if (!rule) return { choice: 'none', daysOn: '7', daysOff: '7', days: [] };
  if (rule.startsWith('cycle:')) {
    const [, on, off] = rule.split(':');
    return { choice: 'cycle', daysOn: on || '7', daysOff: off || '7', days: [] };
  }
  if (rule === 'weekly') {
    const days = cleanRecurrenceDays(recurrenceDays);
    if (days.length > 0) return { choice: 'days_of_week', daysOn: '7', daysOff: '7', days };
  }
  if (rule !== 'days_of_week' && rule !== 'as_needed' && (RECURRENCE_CHOICES as string[]).includes(rule)) {
    return { choice: rule as RecurrenceChoice, daysOn: '7', daysOff: '7', days: [] };
  }
  return { choice: 'none', daysOn: '7', daysOff: '7', days: [] };
}

// Static ids — one AddEventModal is mounted at a time, and the earlier-reminders
// group needs stable targets for aria-labelledby / aria-describedby.
/** The Reminders fieldset the summary row scrolls to (stable for tests and the e2e spec). */
const REMINDERS_FIELDSET_ID = 'reminders-fieldset';
/** The simple forms' Reminders accordion panel (the summary row's aria-controls target). */
const REMINDERS_PANEL_ID = 'reminders-summary-panel';
const EARLIER_REMINDERS_LABEL_ID = 'reminders-earlier-label';
const EARLIER_REMINDERS_WARNING_ID = 'reminders-earlier-warning';
const FOLLOW_UP_ONLY_TITLE_ID = 'reminders-follow-up-only-title';
// The days-of-week picker: its group id doubles as the field-error focus target.
const RECURRENCE_DAYS_ID = 'recurrence_days';

const RECURRENCE_DAYS_ERROR_ID = 'recurrence_days-error';
/** Where focus goes first after a refused save: the form's fields in reading order. */
const FOCUS_ORDER = [
  'medication_name',
  'title',
  'medication_dosage',
  'time-chips-morning',
  'scheduled_date',
  'scheduled_time',
  'endTime',
  'location',
  'description',
  'assigned_to',
  'recurrence_rule',
  'as_needed_reason',
  'alert_days_before',
  RECURRENCE_DAYS_ID,
  'recurrence_end_date',
];
/**
 * The simple forms' fields drawn as PickerTiles (owner 2026-11-10): the hidden input keeps the field id, the
 * tile button is `${id}-tile` and is what an error focuses (the input is out of the tab order).
 */
const PICKER_TILE_FIELDS = new Set(['scheduled_date', 'recurrence_end_date', 'scheduled_time', 'endTime']);
const SIMPLE_FOCUS_ORDER = FOCUS_ORDER.flatMap((id) => (PICKER_TILE_FIELDS.has(id) ? [`${id}-tile`, id] : [id]));
/** A refused simple save's errors, keyed where focus should land: the first chip, a tile. */
function simpleFocusErrors(
  errors: FieldErrors,
  kind: 'medication' | 'appointment' | 'task'
): FieldErrors {
  const mapped: FieldErrors = { ...errors };
  // An unset medication time points at the first chip ("Other…" is the custom-time picker).
  if (kind === 'medication' && errors.scheduled_time) mapped['time-chips-morning'] = errors.scheduled_time;
  for (const id of PICKER_TILE_FIELDS) if (errors[id]) mapped[`${id}-tile`] = errors[id];
  return mapped;
}
const RECURRENCE_DAYS_LOCK_ID = 'recurrence_days-lock';
const RECURRENCE_DAYS_NOTE_ID = 'recurrence_days-tznote';

/**
 * The viewer's end time for a stored `duration_minutes`, ROLLING OVER midnight.
 *
 * Deliberately NOT `addMinutesToTimeStr`, which clamps at 23:59. That clamp is
 * wrong here, because this is reconstructing a duration that was already stored
 * (the duration chips / default end do not clamp either: `presetEndTimeStr`).
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

interface AddEventDraft {
  eventType: EventType;
  title: string;
  dosage: string;
  dateStr: string;
  timeStr: string;
  endTimeStr: string;
  location: string;
  description: string;
  assignedTo: string | null;
}

/**
 * The occurrence the user opened, with its SERIES CONTENT (title, notes,
 * location, assignee, reminders — `SERIES_ROOT_CONTENT_FIELDS`) replaced by the
 * root's. Identity, dates and completion stay the occurrence's own: the form
 * still knows which row was opened, and the schedule hydrates from the root
 * separately (`useSeriesRoot` inside the form).
 *
 * Why: a completed or past occurrence can be its own frozen child row that
 * KEEPS the values it had on that day. Edits always save to the ROOT, so
 * hydrating the form from that snapshot would push the day's stale title (etc.)
 * back onto every upcoming occurrence.
 *
 * A root without content (an older narrowed shape) contributes nothing. A
 * field the root leaves `undefined` keeps the occurrence's value; an explicit
 * `null` is the root's real answer and wins.
 */
export function withSeriesContent(
  event: CalendarEvent,
  root: SeriesRoot | CalendarEvent
): CalendarEvent {
  if (root === event || !('title' in root) || root.title === undefined) return event;
  const merged: CalendarEvent = { ...event };
  const target = merged as unknown as Record<string, unknown>;
  const source = root as unknown as Record<string, unknown>;
  for (const field of SERIES_ROOT_CONTENT_FIELDS) {
    if (source[field] !== undefined) target[field] = source[field];
  }
  return merged;
}

/**
 * HYDRATION GATE for editing a series from one of its occurrences.
 *
 * The form's fields are one-shot `useState` initializers, so they must be
 * seeded from the ROOT on first render — never rendered from the occurrence
 * and swapped later. While an occurrence's root is still resolving
 * (`useSeriesRoot` → `undefined`) this renders a loading modal and no form at
 * all, so there is nothing to type into or save. A failed root fetch resolves
 * to the occurrence itself (the hook's documented fallback) rather than
 * locking the user out.
 */
export function AddEventModal(props: AddEventModalProps): ReactElement | null {
  const { circleId, event, onClose } = props;
  const { t } = useTranslation(['calendar', 'common']);
  const { canEdit } = useCircle(circleId);
  const cachedEvents = useCachedCircleEvents(circleId);
  const { root } = useSeriesRoot(circleId, event, cachedEvents);
  const formEvent = useMemo(
    () => (event && root ? withSeriesContent(event, root) : event),
    [event, root]
  );

  if (!canEdit) return null;
  // One form per type: anything that is not a medication, appointment or task (a shift) has no form here.
  const kind = event ? event.event_type : props.initialType;
  if (kind !== 'medication' && kind !== 'appointment' && kind !== 'task') return null;
  if (event && root === undefined) {
    return (
      <Modal
        title={t('addEvent.editTitle')}
        onClose={onClose}
        closeLabel={t('addEvent.close')}
        size="lg"
      >
        <div className="flex justify-center py-8" data-testid="series-root-loading">
          <Spinner size={28} />
        </div>
      </Modal>
    );
  }
  return <AddEventForm {...props} event={formEvent} kind={kind} />;
}

function AddEventForm({
  circleId,
  event,
  kind: simpleKind,
  initialProviderId,
  onClose,
  onSaved,
  firstRun: firstRunProp = false,
  entry: entryOrigin = 'other',
}: AddEventModalProps & { kind: FormKind }): ReactElement | null {
  const { t, i18n } = useTranslation(['calendar', 'common']);
  const { showToast } = useToast();
  const { circle, timezone, canEdit, members } = useCircle(circleId);
  // On a phone the on-screen keyboard covers half the screen: the footer's
  // "what is missing" line steps aside (kept for screen readers) while it is up.

  const createEvent = useCreateEvent(circleId);
  const updateEvent = useUpdateEvent(circleId);

  const isEditing = !!event;
  // Edits ALWAYS target the parent series (mobile has no "this event only" edit).
  const targetEventId = isEditing ? event.parent_event_id || event.id : undefined;
  // Editing any instance of a recurring event rewrites the whole series — warn.
  const isRecurringEdit = isEditing && (!!event.parent_event_id || !!event.recurrence_rule);
  // A recurring series can be edited from ANY occurrence, completed and past ones
  // included (owner decision 2026-10-10). The save rewrites the series but the
  // backend leaves completed/past days as they were — say so, calmly, ONCE, above
  // Save (owner 2026-11-08: the same line on the medication, appointment and task
  // forms, in that type's words; no notice card at the top).
  const showSeriesEditNote = isRecurringEdit;
  const seriesEditNoteText = !isEditing
    ? ''
    : event.event_type === 'medication'
      ? t('addEvent.seriesEditNoteMedication')
      : event.event_type === 'appointment'
        ? t('addEvent.seriesEditNoteAppointment')
        : t('addEvent.seriesEditNote');

  // History-based title quick-fill source (QP6) — and the first place the
  // series root is looked for, below. Cache read only, no fetching.
  const cachedEvents = useCachedCircleEvents(circleId);
  /**
   * THE ROW THIS FORM EDITS IS THE SERIES ROOT, so its SCHEDULE hydrates from
   * the root — never from the tapped occurrence. The Calendar opens this form
   * with a virtual instance, which carries neither the root's `scheduled_date`
   * (the series anchor) nor `recurrence_days`; hydrating from it showed the
   * occurrence's date and PATCHed it onto the root (moving the whole series'
   * start) and showed a Mon/Wed/Fri series as plain "Weekly". See
   * `useSeriesRoot`. `undefined` = still resolving: the schedule fields stay
   * empty and Save is refused until it lands (the same gate as the timezone).
   */
  const { root: seriesRoot } = useSeriesRoot(circleId, event, cachedEvents);
  const scheduleSource = isEditing ? seriesRoot : null;
  const seriesRootPending = isEditing && seriesRoot === undefined;
  // PK21: editing a row stored WITHOUT a duration. It saves with no end time:
  // no silent 30-minute default on edit, and no "end time required" refusal.
  const isEditingWithoutDuration =
    isEditing && !!scheduleSource && !scheduleSource.duration_minutes;

  const eventType: FormKind = simpleKind;
  const firstRun = firstRunProp && simpleKind === 'medication';
  const [title, setTitle] = useState(event?.medication_name || event?.title || '');
  const [dosage, setDosage] = useState(event?.medication_dosage ?? '');
  /** The RxNorm row behind a PICKED medication name; `null` once it is hand-edited. */
  const [selectedDrug, setSelectedDrug] = useState<DrugSearchResult | null>(null);
  /**
   * The "Use "x" as typed" row was chosen and the name not edited since (feeds
   * `med_name_suggestion_outcome`). Cleared by any keystroke or a picked suggestion.
   */
  const usedAsTypedRef = useRef(false);
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
   * Creating: default to the CARE RECIPIENT's today (user-approved 2026-10-01),
   * so a date-only task for a recipient far ahead of / behind the caregiver
   * lands on the recipient's today. (History: it was the recipient's today, then
   * the viewer's; the viewer's default put a Midway caregiver's task for a
   * Kiritimati recipient a day before the recipient's today.)
   */
  const hydrated = useMemo<ReturnType<typeof eventDatesFromApi>>(() => {
    if (event) {
      // GATE: no recipient zone yet means no frame to convert OUT of, so the
      // fields stay EMPTY rather than being filled through a guessed zone. The
      // resync effect below refills them the moment the real zone lands (the
      // modal renders nothing until then — `canEdit` is false while loading).
      // Same for a series root still being resolved (`scheduleSource`
      // undefined): empty, never the occurrence's date standing in for it.
      if (!timezone || !scheduleSource) {
        return { dateStr: '', timeStr: '', recurrenceEndDateStr: '' };
      }
      return eventDatesFromApi({
        scheduledDate: scheduleSource.scheduled_date,
        scheduledTime: scheduleSource.scheduled_time ?? null,
        recurrenceEndDate: scheduleSource.recurrence_end_date ?? null,
        timezone,
      });
    }
    return {
      // The CARE RECIPIENT's today; '' while the zone is still loading (the same
      // gate as an edit), so no wrong day is shown and then replaced. The resync
      // effect below fills it the moment the zone lands.
      dateStr: defaultNewEventDate(timezone),
      timeStr: '',
      recurrenceEndDateStr: '',
    };
  }, [event, timezone, scheduleSource]);

  const [dateStr, setDateStr] = useState(hydrated.dateStr);
  const [timeStr, setTimeStr] = useState(hydrated.timeStr);
  /**
   * The exact instant a time chip filled the fields with (see `chooseTimeChip`). The fields alone are the
   * viewer's wall clock, which cannot name the SECOND reading of a repeated (fall-back) hour; an edit's
   * hydrated time has the same problem and carries `hydrated.instant`. Either is passed to every
   * conversion as `heldInstant`, which only applies while the fields still read exactly that instant.
   */
  const [chipInstant, setChipInstant] = useState<Date | null>(null);
  const heldInstant = chipInstant ?? hydrated.instant ?? null;
  /**
   * The STORED pair an edit opened with and the instant it names (BC-2). While the fields still read that instant the
   * save sends the stored strings verbatim, so a time inside the circle's spring-forward gap (02:30 stored, 03:30 on
   * the clock) is not "rescheduled" by an untouched save. See `eventDatesForApi`.
   */
  const heldStored = useMemo(
    () =>
      event && scheduleSource?.scheduled_time && hydrated.instant
        ? {
            scheduledDate: scheduleSource.scheduled_date,
            scheduledTime: scheduleSource.scheduled_time,
            instant: hydrated.instant,
          }
        : null,
    [event, scheduleSource?.scheduled_date, scheduleSource?.scheduled_time, hydrated.instant]
  );
  const [endTimeStr, setEndTimeStr] = useState(() => {
    // `duration_minutes` is a DELTA, so it is frame-independent: the viewer's
    // end time is the viewer's start time plus the duration. Derived from the
    // hydrated (viewer-frame) start, never from the stored recipient string.
    if (!hydrated.timeStr || !scheduleSource?.duration_minutes) return '';
    return endTimeForDuration(hydrated.timeStr, scheduleSource.duration_minutes);
  });
  const [location, setLocation] = useState(event?.location ?? '');
  /**
   * The appointment's doctor (notes by doctor). An edit starts from the STORED
   * link and echoes it on every save, so a doctor removed since keeps its link
   * unless the user changes it. null = None.
   */
  const storedProviderId = event?.provider_id ?? null;
  const [providerId, setProviderId] = useState<string | null>(
    isEditing ? storedProviderId : (initialProviderId ?? null)
  );
  /** Whose address filled the location (for the hint); cleared when the user types there. */
  const [locationFilledFrom, setLocationFilledFrom] = useState<string | null>(null);
  // A doctor preselected by the caller (the doctor's own Visits & notes page):
  // once its row arrives, its address fills the empty location, as if picked.
  // Reads the cache DoctorField already fills (same query key: no extra request).
  const presetProviders = useProviders(circleId, {
    includeArchived: true,
    enabled: !isEditing && !!initialProviderId,
  });
  const presetApplied = useRef(false);
  const [description, setDescription] = useState(event?.description ?? '');
  const [assignedTo, setAssignedTo] = useState<string | null>(event?.assigned_to ?? null);

  // An edit hydrates from the stored rule; a create may carry the wizard's
  // hand-off answer. `parseRecurrence` maps null/undefined to 'none', so an
  // ordinary create is unchanged.
  //
  // An edit reads the rule AND day set off the series root (see
  // `scheduleSource`); while the root is still resolving it starts from the
  // occurrence's rule and the resync effect below corrects it once it lands.
  const initialRecurrenceState = event
    ? parseRecurrence(
        scheduleSource ? scheduleSource.recurrence_rule : event.recurrence_rule,
        scheduleSource ? scheduleSource.recurrence_days : null
      )
    : parseRecurrence(undefined);
  // AS NEEDED is a property of the row, not of a rule: an as-needed medication
  // has none, so `parseRecurrence` would call it "Never". Opening one
  // for edit starts (and stays) on `as_needed`; `isAsNeededEdit` locks it.
  const isAsNeededEdit = isEditing && event.as_needed === true;
  const [recurrence, setRecurrence] = useState<RecurrenceChoice>(
    isAsNeededEdit
      ? 'as_needed'
      : // A new simple medication starts on "Every day": the pills below always have one answer. An edit
        // keeps its stored rule.
        !isEditing && simpleKind === 'medication'
        ? 'daily'
        : initialRecurrenceState.choice
  );
  const [asNeededReason, setAsNeededReason] = useState(event?.as_needed_reason ?? '');

  // ── More details: photo, refill tracking, prescription details (mobile parity, owner 2026-11-08) ──
  // An EDIT hydrates them from the single-event GET (the events list omits these columns). Until that lands
  // (or when it fails) the save sends NONE of these keys: an update is a partial patch, so the stored
  // values stay, instead of the form's empty defaults overwriting them (`medicationDetailsPayload`).
  const [medDetails, setMedDetails] = useState<MedicationDetailsState>(EMPTY_MEDICATION_DETAILS);
  const [medHydration, setMedHydration] = useState<MedicationDetailsHydration | null>(null);
  const editsMedication = isEditing && event.event_type === 'medication';
  const [medDetailsLoad, setMedDetailsLoad] = useState<'ready' | 'loading' | 'error'>(
    editsMedication ? 'loading' : 'ready'
  );
  /** A newly picked photo, uploaded after the save (mobile's order). */
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoObjectUrl, setPhotoObjectUrl] = useState<string | null>(null);
  /** The stored photo's SIGNED url: component state only, never the query cache. */
  const [storedPhotoUrl, setStoredPhotoUrl] = useState<string | null>(null);
  /** "Remove photo" on a stored photo: the save then deletes it. */
  const [photoRemoved, setPhotoRemoved] = useState(false);
  useEffect(() => {
    if (!editsMedication || !targetEventId) return;
    let cancelled = false;
    getMedicationFormDetails(circleId, targetEventId)
      .then(({ details, photoUrl }) => {
        if (cancelled) return;
        const hydrated = medicationDetailsFromEvent(details);
        setMedDetails(hydrated.state);
        setMedHydration(hydrated.hydration);
        setStoredPhotoUrl(photoUrl);
        setMedDetailsLoad('ready');
      })
      .catch(() => {
        if (!cancelled) setMedDetailsLoad('error');
      });
    return () => {
      cancelled = true;
      setStoredPhotoUrl(null);
    };
  }, [editsMedication, circleId, targetEventId]);
  useEffect(
    () => () => {
      if (photoObjectUrl) URL.revokeObjectURL(photoObjectUrl);
    },
    [photoObjectUrl]
  );
  function pickPhoto(file: File): void {
    setPhotoFile(file);
    setPhotoObjectUrl(URL.createObjectURL(file));
  }
  function removePhoto(): void {
    setPhotoFile(null);
    setPhotoObjectUrl(null);
    if (storedPhotoUrl) setPhotoRemoved(true);
  }
  const photoPreviewUrl = photoObjectUrl ?? (photoRemoved ? null : storedPhotoUrl);
  const [daysOn, setDaysOn] = useState(initialRecurrenceState.daysOn);
  const [daysOff, setDaysOff] = useState(initialRecurrenceState.daysOff);
  /** The "Days of the week" selection, 0=Sun..6=Sat (used only in that mode). */
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>(initialRecurrenceState.days);
  /** Has the user touched the Repeat controls? Then the root resync keeps off. */
  const recurrenceTouched = useRef(false);
  /** The same fact as state, for what the form SHOWS (a ref change does not re-render). */
  const [recurrenceTouchedShown, setRecurrenceTouchedShown] = useState(false);
  const touchRecurrence = (): void => {
    recurrenceTouched.current = true;
    setRecurrenceTouchedShown(true);
  };
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

  // `medication_form_abandoned` bookkeeping: when the form opened, the last
  // field the user touched, whether it was saved, and whether it already fired
  // (once per form session). Refs, not state: none of it renders.
  const openedAtRef = useRef(Date.now());
  const lastFieldRef = useRef<AbandonField>('none');
  const savedRef = useRef(false);
  const abandonReportedRef = useRef(false);

  // PK9: a NEW event survives a forced sign-out (sessionStorage, same user,
  // 30 min). The core fields only; recurrence/reminder choices are cheap to
  // redo and tie to rules that must be re-derived. Edits are not drafts.
  useSessionDraft<AddEventDraft>(
    isEditing ? null : `calendar:addEvent:${circleId}:${eventType}`,
    () =>
      title.trim() || dosage.trim() || location.trim() || description.trim()
        ? {
            eventType,
            title,
            dosage,
            dateStr,
            timeStr,
            endTimeStr,
            location,
            description,
            assignedTo,
          }
        : null,
    (d) => {
      setTitle(d.title);
      setDosage(d.dosage);
      setDateStr(d.dateStr);
      setTimeStr(d.timeStr);
      setEndTimeStr(d.endTimeStr);
      setLocation(d.location);
      setDescription(d.description);
      setAssignedTo(d.assignedTo);
    }
  );
  // Payload held while the past-time notice is showing (mobile GAP #4 parity):
  // a medication scheduled for TODAY at a time that already passed gets a
  // lightweight confirm, then proceeds. The two paths mean different things:
  // EDIT ONLY: no roll happens, the row stays on today; the only consequence is that today's
  // reminder will not fire. (Creating shows an inline note instead; see `startsNextDose`.)
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
      hydrated.timeStr && scheduleSource?.duration_minutes
        ? endTimeForDuration(hydrated.timeStr, scheduleSource.duration_minutes)
        : ''
    );
  }, [hydrated, scheduleSource]);

  /**
   * Re-hydrate the Repeat controls when the series root resolves AFTER mount
   * (an occurrence whose root was not in the cache). Untouched controls only —
   * the same "a user who has chosen owns it" rule as the dates above.
   */
  useEffect(() => {
    // An as-needed row has no rule to re-derive: leave its locked choice alone.
    if (!event || !scheduleSource || recurrenceTouched.current || event.as_needed === true) return;
    const parsed = parseRecurrence(scheduleSource.recurrence_rule, scheduleSource.recurrence_days);
    setRecurrence(parsed.choice);
    setDaysOn(parsed.daysOn);
    setDaysOff(parsed.daysOff);
    setRecurrenceDays(parsed.days);
  }, [event, scheduleSource]);

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

  // Which field the user changed last, for `medication_form_abandoned`.
  useNoteFieldChange(lastFieldRef, title, 'name');
  useNoteFieldChange(lastFieldRef, dosage, 'dosage');
  useNoteFieldChange(lastFieldRef, timeStr, 'time');
  useNoteFieldChange(lastFieldRef, recurrence, 'repeat');
  useNoteFieldChange(lastFieldRef, recurrenceEndDate, 'repeat');
  useNoteFieldChange(lastFieldRef, location, 'more_details');
  useNoteFieldChange(lastFieldRef, description, 'more_details');
  useNoteFieldChange(lastFieldRef, notificationsEnabled, 'more_details');
  // Same idea for `appointment_form_abandoned`.
  const apptLastFieldRef = useRef<AppointmentAbandonField>('none');
  useNoteFieldChange(apptLastFieldRef, title, 'title');
  useNoteFieldChange(apptLastFieldRef, dateStr, 'date');
  useNoteFieldChange(apptLastFieldRef, timeStr, 'time');
  useNoteFieldChange(apptLastFieldRef, assignedTo, 'who');
  useNoteFieldChange(apptLastFieldRef, location, 'more_details');
  useNoteFieldChange(apptLastFieldRef, description, 'more_details');
  useNoteFieldChange(apptLastFieldRef, providerId, 'more_details');
  useNoteFieldChange(apptLastFieldRef, recurrence, 'more_details');

  // ── Form funnel (docs/plans/simple-ui-1-3-1.md) ────────────────────────────
  // `entry_form_opened` once per CREATE session; each step completes once.
  // Enums only, no circle_id.
  const openedReportedRef = useRef(false);
  useEffect(() => {
    if (isEditing || openedReportedRef.current) return;
    openedReportedRef.current = true;
    Analytics.entryFormOpened({ type: eventType, entry: entryOrigin });
    // Once per mount: the type/entry at open time are what the funnel wants.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const stepsDoneRef = useRef(new Set<EntryFormStep>());
  function completeStep(step: EntryFormStep): void {
    if (isEditing || stepsDoneRef.current.has(step)) return;
    // The task funnel is the simple task form's (a full-layout task has no such steps).
    const funnelType =
      eventType === 'medication' ||
      eventType === 'appointment' ||
      (eventType === 'task' && simpleKind === 'task');
    if (!funnelType) return;
    stepsDoneRef.current.add(step);
    Analytics.entryFormStepCompleted({ type: eventType, step });
  }
  // `large_text_layout` for the two simple forms (once per screen per session).
  // The task form has no `large_text_layout` screen of its own (the enum is shared with mobile).
  const largeText = useLargeTextLayoutEvent(
    simpleKind === 'appointment' ? 'appt_form' : 'med_form',
    simpleKind === 'medication' || simpleKind === 'appointment'
  );
  // The simple forms' "More details": collapsed by default, on new AND edit (owner 2026-11-10, build 11: edit is
  // new, pre-filled). The panel stays mounted; this only shows it. A refused save that errors a field inside it
  // opens it (`revealErrorFields`), and so does a doctor preset filling the location.
  const [moreOpen, setMoreOpen] = useState(false);
  // The simple forms' "Reminders" row (owner 2026-11-10, second pass): an accordion. Tapping it expands the
  // full Reminders card inline, directly under the row, and tapping again folds it; it never routes the
  // user down the page. Collapsed by default on new and edit (no save error lives inside the card: the
  // validator never errors a reminder field, so nothing has to force it open).
  const [remindersOpen, setRemindersOpen] = useState(false);
  // THE NUDGE (owner 2026-11-10, build 11): after an expand, the card's first control (the "Enable
  // notifications" switch) is brought into view with `block: 'nearest'`, so the page moves only by what is
  // hidden (behind the pinned footer or below the dialog's fold), never when it already shows, and never past
  // the row (it sits directly above the switch). Instant under Reduce Motion. A counter: it runs after the
  // commit that unhides the panel (a hidden element has no box to scroll to). Focus stays on the row.
  const [remindersNudge, setRemindersNudge] = useState(0);
  useEffect(() => {
    if (!remindersNudge) return;
    document
      .getElementById('notifications_enabled')
      ?.scrollIntoView?.({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [remindersNudge]);
  // The pick-time variant's tap (a task / appointment with no time yet): a counter, so the scroll + focus to the
  // form's "Pick a time" choice runs after the commit.
  const [timeJump, setTimeJump] = useState(0);
  useEffect(() => {
    if (!timeJump) return;
    const target = document.querySelector<HTMLElement>(
      '#task-time [role="radio"], #appt-time [role="radio"]'
    );
    target?.scrollIntoView?.({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    target?.focus({ preventScroll: true });
  }, [timeJump]);
  // The medication's "Other…" time picker: which time it is setting. `primary` = the form's own time (an edit, or
  // a new medication with no time yet); a number = that extra dose (a new medication's next time). Set when the
  // picker opens; `null` = decide on the first pick.
  const [otherTarget, setOtherTarget] = useState<'primary' | number | null>(null);
  /**
   * "9:00 AM is already a dose time" (owner 2026-11-11, mobile parity): a custom pick on dose `slot` (0 = the form's
   * own time; `extraTimes.length + 1` = a new one) landed on `time` (the circle's clock), which the medication already
   * has, so nothing changed. Kept only while the doses are the ones it was said about (`signature`); the picker that
   * tried it shows `time`, so the next column click builds on what was dialled.
   */
  const [doseDuplicate, setDoseDuplicate] = useState<{ slot: number; time: string; signature: string } | null>(
    null
  );
  // The task / appointment forms' "Pick a time" (reveals the time tiles) and every simple form's "Custom…"
  // (reveals the rarer repeat rules). One form is mounted at a time, so they share the state.
  const [pickTimeOpen, setPickTimeOpen] = useState(false);
  const [taskCustomOpen, setTaskCustomOpen] = useState(false);
  // "+ Another dose" (NEW medication only): extra dose times, viewer-frame HH:MM. Each one is saved
  // as its OWN medication row after the primary (the same sequence as mobile's AddEventScreen and
  // the first-run wizard), pointing at the primary's bottle through `refill_group_id`.
  // The extra doses of a NEW medication: the viewer-frame clock the save converts, and the exact INSTANT it was
  // made from (a chip / the picker) when known. The clock alone cannot name the SECOND reading of the viewer's
  // repeated (fall-back) hour; `instant` rides alongside so the save does (see `extraDoseForApi`).
  const [extraDoses, setExtraDoses] = useState<Array<{ time: string; instant: Date | null }>>([]);
  const extraTimes = useMemo(() => extraDoses.map((d) => d.time), [extraDoses]);
  /** The medication has NO schedule: no date, time, repeat, end date or reminders. */
  const isAsNeeded = isMedication && recurrence === 'as_needed';
  const isPending = createEvent.isPending || updateEvent.isPending;
  /** The primary plus each filled extra dose time (create only: an edit cannot see its siblings). */
  const doseTimeCount = 1 + extraTimes.filter((time) => time !== '').length;
  const pillsCountable = isCountableForm(selectedDrug?.dosageForm);
  const derivedPerDay = derivedPillsPerDay(medDetails.pillsPerDose, doseTimeCount);
  const supplyRate = daysSupplyRate({
    isEditing,
    derivedPillsPerDay: derivedPerDay,
    storedPillsPerDay: medHydration?.storedPillsPerDay ?? null,
    pillsPerDose: medDetails.pillsPerDose,
    hydratedPillsPerDose: medHydration?.hydratedPillsPerDose ?? '',
  });

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
        dateStr ? viewerInstant(dateStr, timeStr || '12:00', heldInstant) : undefined
      ),
    [deviceTimezone, timezone, dateStr, timeStr, heldInstant]
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

  /** The label above the time field: "Your time / Margaret's time (New York)". */
  const daysTimezoneNote = recipientName
    ? t('addEvent.daysOfWeek.timezoneNote', { name: recipientName, timezone: recipientZone })
    : t('addEvent.daysOfWeek.timezoneNoteGeneric', { timezone: recipientZone });

  // History-based title quick-fill (QP6) — sourced from the circle's ALREADY CACHED calendar events (no new
  // fetching); generics pad the list.
  const titleSuggestions = useMemo(() => {
    if (isMedication) return [];
    const generics = (eventType === 'appointment' ? APPOINTMENT_TITLE_KEYS : TASK_TITLE_KEYS).map(
      (key) => t(key)
    );
    return deriveTitleSuggestions(cachedEvents, eventType, Date.now(), generics);
  }, [cachedEvents, eventType, isMedication, t]);

  /**
   * The simple task form's "Who's doing it?" tiles (mobile parity): Anyone (unassigned), Me (the signed-in
   * viewer, when a member), then every other member in the circle's order, the care recipient included with
   * the "Care recipient" caption as the tile's second line. The same values as the Assigned-to select.
   */
  const viewerId = useAuthStore((s) => s.user?.id ?? null);
  const taskWhoOptions = useMemo(() => {
    const role = t('members:roles.careRecipient');
    const me = viewerId ? members.find((m) => m.id === viewerId) : undefined;
    const others = members
      .filter((m) => m.id !== viewerId)
      .map((m) => ({
        value: m.id,
        label: m.first_name || m.email.split('@')[0],
        sub: m.is_care_recipient ? role : undefined,
      }));
    return [
      { value: '', label: t('addEvent.anyone') },
      ...(me
        ? [{ value: me.id, label: t('addEvent.simple.me'), sub: me.is_care_recipient ? role : undefined }]
        : []),
      ...others,
    ];
  }, [members, viewerId, t]);

  const recurrenceOptions = useMemo(
    () =>
      // "As needed" is offered on a NEW medication only: it is locked after
      // create, so an edit of a scheduled medication never lists it, and an
      // as-needed one never reaches this Select (see the locked block below).
      RECURRENCE_CHOICES.filter(
        (choice) => choice !== 'as_needed' || (isMedication && !isEditing)
      ).map((choice) => ({
        value: choice,
        label:
          choice === 'none'
            ? t('addEvent.recurrence.never')
            : t(`addEvent.recurrence.${recurrenceKey(choice)}`),
      })),
    [t, isMedication, isEditing]
  );

  // A STORED rule no Repeat option names (an imported `custom:14`, every 14
  // days) parses to 'none', which used to LIGHT "Once" (and read "Never" in the
  // full layout's select) on a series that repeats. While the control is
  // untouched it shows no choice and names the rule instead (mobile parity:
  // AddEventScreen's `how-often-summary`). Display only: the save's
  // `keepUnshownRule` guard below still leaves the rule alone.
  const unshownRuleLabel = useMemo(() => {
    if (!isEditing || event?.as_needed === true || recurrenceTouchedShown) return null;
    if (recurrence !== 'none') return null;
    const rule = scheduleSource?.recurrence_rule ?? null;
    if (!rule || parseRecurrence(rule, scheduleSource?.recurrence_days).choice !== 'none') return null;
    return formatRecurrenceLabel(
      { recurrence_rule: rule, recurrence_days: scheduleSource?.recurrence_days ?? null },
      t,
      i18n.language
    );
  }, [isEditing, event?.as_needed, recurrenceTouchedShown, recurrence, scheduleSource, t, i18n.language]);

  // ── Days of the week ─────────────────────────────────────────────────────
  //
  // Every date below is a NAIVE 'YYYY-MM-DD' in the CARE RECIPIENT's frame —
  // the frame `recurrence_days` is evaluated in (backend `is_recurrence_date`,
  // the crons, the materializer). Weekdays come from `getDayOfWeek` on the
  // string (0=Sun), never `getDay()` on a local Date.
  const language = i18n.language;
  /** The start date the save would send, in the recipient's frame. */
  const recipientStartDate = useMemo(() => {
    if (!timezone || !dateStr) return null;
    try {
      return eventDatesForApi({
        dateStr,
        timeStr: timeStr || null,
        recurrenceEndDateStr: null,
        timezone,
        heldInstant,
        heldStored,
      }).scheduledDate;
    } catch {
      return null;
    }
  }, [timezone, dateStr, timeStr, heldInstant, heldStored]);
  /**
   * The RECIPIENT's wall clock the form's time names (`HH:MM`, what the save sends), or '' with no time
   * or no zone yet. The time chips mean the recipient's clock (mobile parity), so this is what lights one.
   */
  const recipientClock = useMemo(() => {
    if (!timezone || !dateStr || !timeStr) return '';
    try {
      return (
        eventDatesForApi({ dateStr, timeStr, recurrenceEndDateStr: null, timezone, heldInstant, heldStored })
          .scheduledTime ?? ''
      );
    } catch {
      return '';
    }
  }, [timezone, dateStr, timeStr, heldInstant, heldStored]);
  /**
   * The end a duration chip or the default length gives the viewer-frame start `viewerStart`: the full length,
   * an end past midnight carrying to the next day (mobile's rule, no 23:59 cap): see `presetEndTimeStr`.
   */
  function presetEndFor(viewerStart: string, minutes: number): string {
    return presetEndTimeStr(viewerStart, minutes);
  }
  /** The time chip the form's time sits on, or null ("Other time" / no time). */
  const litChip = chipForTime(recipientClock);
  /**
   * CREATE only: this medication's start rolls to the next dose (the backend does it,
   * `medicationStartRoll.ts`) because its time already passed today in the recipient's zone.
   * Drives the inline note under the time field; never blocks Save. One time field on this surface.
   */
  const doseStartsNext = useCallback(
    (time: string): boolean => {
      if (isEditing || !isMedication || isAsNeeded || !timezone || !dateStr || !time) return false;
      try {
        const api = eventDatesForApi({
          dateStr,
          timeStr: time,
          recurrenceEndDateStr: null,
          timezone,
          heldInstant,
        });
        return (
          !!api.scheduledTime &&
          api.scheduledDate === getDateInTimezone(timezone) &&
          isEventPastDue(api.scheduledDate, api.scheduledTime, timezone)
        );
      } catch {
        return false;
      }
    },
    [isEditing, isMedication, isAsNeeded, timezone, dateStr, heldInstant]
  );
  const startsNextDose = useMemo(() => doseStartsNext(timeStr), [doseStartsNext, timeStr]);
  /** "Today" in the circle's (recipient's) timezone — never the device's. */
  const recipientToday = timezone ? getDateInTimezone(timezone) : null;
  /**
   * The simple task form's "When?" day, on the RECIPIENT's calendar: the day the save sends
   * (`recipientStartDate`), matched against the recipient's today and tomorrow (string date arithmetic,
   * never an instant + 24h). Any other day lights "Other day", which then names it.
   */
  useEffect(() => {
    if (timeStr) setPickTimeOpen(true);
  }, [timeStr]);
  const showTaskTimeField = pickTimeOpen || timeStr !== '';
  /** The task form's pickers ring the RECIPIENT's today (its fields name recipient days). */
  const recipientPickerToday = defaultNewEventDate(timezone) || undefined;
  /**
   * The repeat end date on the RECIPIENT's calendar, for the task form: the save keeps the span counted on
   * the viewer's side (`eventDatesForApi`), so the recipient's end is their start plus that span, and a typed
   * one converts back by the same span. Identity whenever the two start days agree (no time, or near zones).
   */
  const recipientRepeatEnd =
    recurrenceEndDate && dateStr && recipientStartDate
      ? addDays(recipientStartDate, daysBetween(dateStr, recurrenceEndDate))
      : recurrenceEndDate;
  /** The repeat end (when the series repeats at all) falls before its start: refused at the "Repeats until" tile. */
  const repeatEndBeforeStart =
    recurrence !== 'none' &&
    recurrence !== 'as_needed' &&
    recurrenceEndDate !== '' &&
    dateStr !== '' &&
    recurrenceEndDate < dateStr;
  function chooseRecipientRepeatEnd(next: string): void {
    setRecurrenceEndDate(
      next && dateStr && recipientStartDate ? addDays(dateStr, daysBetween(recipientStartDate, next)) : next
    );
  }
  /**
   * The series ANCHOR: the ROOT's stored `scheduled_date` when editing (never
   * the tapped occurrence's — see `useSeriesRoot`); the form's own start date
   * when creating.
   */
  const seriesAnchorDate = isEditing ? (scheduleSource?.scheduled_date ?? null) : recipientStartDate;
  /**
   * A STARTED series keeps its start weekday: dropping it would leave the anchor
   * off its own pattern, which hides the whole series (`seriesStartMatchesOwnPattern`)
   * and silences its reminders (`recurrence_start_is_valid`). The backend
   * refuses it (`RECURRENCE_DAYS_EXCLUDE_START`); the form makes it impossible.
   */
  const seriesStarted =
    isEditing && !!seriesAnchorDate && !!recipientToday && seriesAnchorDate <= recipientToday;
  const lockedDay = seriesStarted && seriesAnchorDate ? getDayOfWeek(seriesAnchorDate) : null;
  /** The effective selection — the locked weekday is always part of it. */
  const selectedDays = useMemo(
    () =>
      lockedDay == null ? recurrenceDays : cleanRecurrenceDays([...recurrenceDays, lockedDay]),
    [recurrenceDays, lockedDay]
  );
  /** Did the ROOT this form hydrated from carry a day set? (Clearing it needs `null`.) */
  const storedHadDays =
    isEditing &&
    scheduleSource?.recurrence_rule === 'weekly' &&
    cleanRecurrenceDays(scheduleSource.recurrence_days).length > 0;
  /**
   * The start date's weekday is not in the set: the series cannot start there,
   * so the save moves it forward to the next selected day (at most six days —
   * the backend create normalizer does exactly the same). Shown as "First time".
   * `null` when no move is needed, or with 7 days (saved as Daily).
   */
  const firstTimeShiftDays = useMemo(() => {
    if (recurrence !== 'days_of_week' || !recipientStartDate) return null;
    if (selectedDays.length === 0 || selectedDays.length === 7) return null;
    const next = nextDateOnWeekdays(recipientStartDate, selectedDays);
    if (!next || next === recipientStartDate) return null;
    return daysBetween(recipientStartDate, next);
  }, [recurrence, recipientStartDate, selectedDays]);
  // Displayed in the same frame as the form's Date field: the VIEWER's, except on the simple task
  // form, whose day tiles and date field name the RECIPIENT's day (the frame `recurrence_days` is in).
  const firstTimeBase = simpleKind === 'task' ? recipientStartDate : dateStr;
  const firstTimeLabel =
    firstTimeShiftDays !== null && firstTimeBase
      ? formatDateForDisplay(
          addDays(firstTimeBase, firstTimeShiftDays),
          { weekday: 'short', month: 'short', day: 'numeric' },
          language
        )
      : null;
  const lockedDayName = lockedDay == null ? '' : getWeekdayName(lockedDay, 'long', language);

  /** Choosing a Repeat option — "Days of the week" pre-selects if nothing is. */
  function chooseRecurrence(next: RecurrenceChoice): void {
    touchRecurrence();
    setRecurrence(next);
    if (next === 'as_needed') setExtraDoses([]);
    clearError('recurrence_rule', RECURRENCE_DAYS_ID);
    if (isMedication) completeStep('how_often');
    if (next === 'days_of_week' && recurrenceDays.length === 0) {
      // Existing days are kept; otherwise the start date's weekday (the
      // anchor's, for a started series — the one that cannot be removed).
      const start =
        lockedDay ?? (recipientStartDate ? getDayOfWeek(recipientStartDate) : null);
      if (start !== null) setRecurrenceDays([start]);
    }
  }

  function clearError(...fields: string[]): void {
    setErrors((prev) => {
      if (!fields.some((field) => field in prev)) return prev;
      const next = { ...prev };
      for (const field of fields) delete next[field];
      return next;
    });
  }

  /**
   * Picking a doctor whose address is on file FILLS AN EMPTY location (and says
   * so, under the field). A location the user already typed is never touched,
   * None / a doctor without an address leave it alone, and an address longer than
   * the field allows is skipped rather than cut mid-word. The user can edit the
   * filled text freely. (docs/plans/notes-by-doctor.md flow 3.)
   */
  function chooseDoctorLocation(provider: Provider | null): void {
    if (!provider || location.trim() !== '') return;
    // The doctor form's address is multi-line; the location is one line.
    const address = (provider.address ?? '').replace(/\s*\n+\s*/g, ', ').trim();
    if (!address || address.length > 250) return;
    setLocation(address);
    setLocationFilledFrom(provider.name);
    clearError('location');
    // The simple form's More details opens on what it was filled with (mobile parity).
    if (simpleKind === 'appointment') setMoreOpen(true);
  }

  useEffect(() => {
    if (presetApplied.current || isEditing || !initialProviderId) return;
    const preset = presetProviders.providers.find((p) => p.id === initialProviderId);
    if (!preset) return;
    presetApplied.current = true;
    chooseDoctorLocation(preset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetProviders.providers, initialProviderId, isEditing]);

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
    if (!dateStr && !isAsNeeded) {
      fieldErrors.scheduled_date = t('addEvent.validation.dateRequired');
    }
    if (isMedication && !timeStr && !isAsNeeded) {
      fieldErrors.scheduled_time = t('addEvent.validation.timeRequired');
    }
    if (recurrence === 'days_of_week' && selectedDays.length === 0) {
      fieldErrors[RECURRENCE_DAYS_ID] = t('addEvent.daysOfWeek.noneSelected');
    }
    // An end before the start (owner 2026-11-10, build 11: said at the "Repeats until" tile, not by the server's
    // RECURRENCE_END_BEFORE_START after a round trip). Only refuses what the server refuses: both days are the
    // form's viewer-side pair, whose span the save keeps, so "end < start" here is "end < start" there.
    if (repeatEndBeforeStart) {
      fieldErrors.recurrence_end_date = t('shifts:validation.repeatEndBeforeStart');
    }
    if (!isMedication) {
      if (timeStr && !endTimeStr) {
        // PK21: an EDIT of a row stored without a duration saves with no end. The simple task's end is optional
        // (build 11, "No end"): it saves without one.
        if (!isEditingWithoutDuration && simpleKind !== 'task') {
          fieldErrors.endTime = t('addEvent.validation.endTimeRequired');
        }
      } else if (timeStr && endTimeStr) {
        // Same rule as mobile: an end at or before the start reads as the NEXT
        // day (a span past midnight), so this only trips on an unparseable value.
        if (spanMinutes(timeStr, endTimeStr) === null) {
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
      // The instant an edit opened with, or a chip set, while the fields still read it (fall-back hour).
      heldInstant,
      // The stored pair, verbatim, while the fields still read the instant the edit opened with (BC-2).
      heldStored,
    });
    let scheduled_date = apiDates.scheduledDate;
    const scheduled_time = apiDates.scheduledTime;

    let durationMinutes: number | undefined;
    if (!isMedication && timeStr && endTimeStr) {
      // Midnight-crossing spans count as mobile counts them (see spanMinutes).
      durationMinutes = spanMinutes(timeStr, endTimeStr) ?? undefined;
    }
    // THE STORED VALUES an emptied field is measured against (utils/editPatch):
    // content from `event` (the series root's content, see `withSeriesContent`),
    // the clock and length from the root the schedule hydrated from.
    const patchOpts = { isEditing };

    let recurrence_rule: string | undefined;
    // `undefined` = key omitted (the stored value stays); `null` = explicit
    // "no specific days", which CLEARS a stored set on PATCH.
    let recurrence_days: number[] | null | undefined;
    if (recurrence === 'cycle') {
      recurrence_rule = `cycle:${parseInt(daysOn, 10) || 7}:${parseInt(daysOff, 10) || 7}`;
    } else if (recurrence === 'days_of_week') {
      if (selectedDays.length === 7) {
        // Every day IS daily — same schedule, simpler label.
        recurrence_rule = 'daily';
      } else {
        recurrence_rule = 'weekly';
        recurrence_days = selectedDays;
        // The series cannot start on an unselected weekday: move the start to
        // the next selected day (the "First time" the form shows). A started
        // series never needs this — its start weekday is locked in the set.
        const next = nextDateOnWeekdays(scheduled_date, selectedDays);
        if (next) scheduled_date = next;
      }
    } else if (recurrence !== 'none') {
      recurrence_rule = recurrence;
    }
    // Leaving a days series (plain Weekly, Daily, …) must clear the stored set
    // explicitly — omitting the key would keep it. ONLY when the root we
    // hydrated from actually had one: an occurrence carries no `recurrence_days`
    // at all, so "we saw none" must never be written back as "there are none".
    if (recurrence_days === undefined && storedHadDays) {
      recurrence_days = null;
    }

    // A STORED rule the Repeat control cannot show (an imported `custom:14`
    // reads as "Once") must never be cleared by a save that did not touch the
    // Repeat control — that would end a series the user left alone (mobile hit
    // exactly this: recurrenceLabelParity.test.ts). Its keys are left out.
    const storedRule = isEditing ? (scheduleSource?.recurrence_rule ?? null) : null;
    const keepUnshownRule =
      !!storedRule &&
      recurrence === 'none' &&
      !recurrenceTouched.current &&
      parseRecurrence(storedRule, scheduleSource?.recurrence_days).choice === 'none';

    const data: CreateEventRequest = {
      event_type: eventType,
      title: trimmedTitle,
      // CLEARABLE ON EDIT (sweep 2026-11-08): an emptied field is `null`, an
      // unchanged one is left out, a create never sends null. See utils/editPatch.
      description: editPatch(event?.description, description, patchOpts),
      scheduled_date,
      // "Any time" on an edit of a timed task / appointment is `null`, and so is
      // its end (`duration_minutes`). A set time and length always TRAVEL (they
      // are derived together: the time with its date from one instant, the
      // length from the start/end pair), so they use `clearOnEdit`, not the
      // differ-only `editPatch`. A medication always has a time (refused above)
      // and no length, so it never clears either.
      scheduled_time: isMedication
        ? scheduled_time
        : clearOnEdit(scheduleSource?.scheduled_time, scheduled_time, patchOpts),
      duration_minutes: isMedication
        ? undefined
        : clearOnEdit(scheduleSource?.duration_minutes, durationMinutes, patchOpts),
      location: editPatch(event?.location, location, patchOpts),
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
      // "Once" on an edit is `recurrence_rule: null` (the series ends; the
      // server clears its days and end date and prunes the children), and a
      // cleared end date on an edit is `recurrence_end_date: null`. Omitting
      // them, as before, left the series running. Mobile's rule, ported
      // (utils/recurrenceForSave). The end date comes from `eventDatesForApi`,
      // never the raw field: it must share the start date's frame.
      ...(keepUnshownRule
        ? {}
        : recurrenceForSave(recurrence_rule, apiDates.recurrenceEndDate, { clearing: isEditing })),
    };
    if (recurrence_days !== undefined) data.recurrence_days = recurrence_days;

    // AS NEEDED: the SERVER pins the schedule (no time / repeat / end date /
    // reminders; "added on" = today in the recipient's zone), so none of those
    // are sent — and on an edit a null/echoed schedule field would only be
    // dropped or refused (AS_NEEDED_UNSCHEDULED). Only `as_needed` (create only:
    // it is locked afterwards) and the optional plain reason travel.
    if (isAsNeeded) {
      delete data.scheduled_time;
      delete data.recurrence_rule;
      delete data.recurrence_days;
      delete data.recurrence_end_date;
      delete data.duration_minutes;
      delete data.reminder_at_due;
      delete data.reminder_24h;
      delete data.reminder_1h;
      delete data.reminder_30m;
      delete data.reminder_15m;
      data.scheduled_date = getDateInTimezone(tz);
      const reason = asNeededReason.trim();
      if (isEditing) {
        // null CLEARS a stored reason on PATCH.
        data.as_needed_reason = reason ? reason : null;
      } else {
        data.as_needed = true;
        if (reason) data.as_needed_reason = reason;
      }
    }

    if (isMedication) {
      data.medication_name = trimmedTitle;
      data.medication_dosage = editPatch(event?.medication_dosage, dosage, patchOpts);
      // Only a PICKED drug carries its concept id (mobile: `if (selectedDrug?.rxcui)`).
      if (selectedDrug?.rxcui) data.rxcui = selectedDrug.rxcui;
      // Refill tracking + prescription details: mobile's keys and rules (utils/medicationDetailsForm).
      Object.assign(
        data,
        medicationDetailsPayload(medDetails, {
          isEditing,
          asNeeded: isAsNeeded || isAsNeededEdit,
          hydration: isEditing ? (medDetailsLoad === 'ready' ? medHydration : null) : null,
          doseTimeCount,
          recurrenceRule: data.recurrence_rule ?? null,
          recurrenceDays: data.recurrence_days ?? null,
        })
      );
    }
    // Always sent for assignable types, null included — updates are partial
    // patches server-side, so omitting the key left the old assignee in place
    // and made "Anyone" impossible to go back to.
    const assignedToValue = assignedToForSave(eventType, assignedTo);
    if (assignedToValue !== undefined) {
      data.assigned_to = assignedToValue;
    }

    // The doctor (notes by doctor), APPOINTMENTS ONLY — any other type is refused
    // PROVIDER_NOT_ALLOWED. An edit ALWAYS echoes the form's value: the stored
    // link when untouched (an unchanged id is never re-validated server side, so a
    // doctor removed since is kept), another id, or null = None, which clears it.
    // A create names a doctor only when one was picked. On an occurrence the server
    // writes the link to the series ROOT.
    if (eventType === 'appointment') {
      if (isEditing) data.provider_id = providerId;
      else if (providerId) data.provider_id = providerId;
    }

    // How this entry was added, on a CREATE only (the backend ignores it on an
    // edit). The web form is always typed: voice add and the label scan are
    // mobile-only. Mobile shows "Added by voice" from the same field.
    if (!isEditing) {
      data.entry_source = WEB_ENTRY_SOURCE;
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

  /**
   * The extra dose rows of a NEW medication ("+ Another dose"), one request per time: the
   * primary's payload with its OWN clock, no refill state of its own, and `refill_group_id` set to the
   * primary's id once that is known. Every row of one medication starts on the SAME circle-zone day, the
   * primary's: an extra is held as a viewer-frame clock with no day of its own, so `extraDoseForApi` finds the
   * viewer day whose instant falls on the primary's circle day (re-placing it on the primary's VIEWER day moved
   * a dose a whole circle day, BC-1). The repeat-end date is the primary's (same start day, same span). Same
   * helper the first-run wizard uses (mobile's `siblingDosePayload`).
   */
  function buildSiblingRequests(
    primary: CreateEventRequest,
    tz: string,
    primaryId: string | undefined
  ): CreateEventRequest[] {
    if (isEditing || !isMedication || isAsNeeded) return [];
    const repeatEnd = recurrence !== 'none' && recurrenceEndDate ? recurrenceEndDate : null;
    const primaryDates = eventDatesForApi({
      dateStr,
      timeStr: timeStr || null,
      recurrenceEndDateStr: repeatEnd,
      timezone: tz,
      heldInstant,
    });
    // One row per circle clock, never the primary's own (a payload-time guard: two rows at one time would be double
    // reminders and two doses to mark; the chips refuse a repeat, this keeps any other path from sending one).
    const seenClocks = new Set([primaryDates.scheduledTime ?? '']);
    return extraDoses
      .filter((d) => d.time !== '')
      .map(({ time, instant }) =>
        extraDoseForApi({
          dateStr,
          timeStr,
          extraTimeStr: time,
          timezone: tz,
          heldInstant,
          heldExtraInstant: instant,
        })
      )
      .filter((dose) => {
        if (seenClocks.has(dose.scheduledTime)) return false;
        seenClocks.add(dose.scheduledTime);
        return true;
      })
      .map((dose) => {
        let rowDate = dose.scheduledDate;
        if (recurrence === 'days_of_week' && selectedDays.length > 0 && selectedDays.length < 7) {
          rowDate = nextDateOnWeekdays(rowDate, selectedDays) ?? rowDate;
        }
        return siblingDosePayload(primary, {
          scheduledTime: dose.scheduledTime,
          scheduledDate: rowDate,
          recurrenceEndDate: primaryDates.recurrenceEndDate ?? undefined,
          refillGroupId: primaryId,
        });
      });
  }

  /**
   * After the medication row saved: upload a newly picked photo (signed upload, then PATCH the storage
   * path — mobile's sequence), or delete a stored one the user removed. A failure never undoes the save;
   * it returns what failed, and the caller says so instead of the success toast.
   */
  async function savePhoto(eventId: string): Promise<'upload' | 'remove' | null> {
    if (photoFile) {
      try {
        const { storagePath } = await uploadMedicationPhoto(circleId, eventId, photoFile);
        await updateEventRequest(circleId, eventId, { medication_photo_url: storagePath });
        void queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvents(circleId) });
        return null;
      } catch {
        return 'upload';
      }
    }
    if (photoRemoved && isEditing) {
      try {
        await deleteMedicationPhoto(circleId, eventId);
        void queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvents(circleId) });
        return null;
      } catch {
        return 'remove';
      }
    }
    return null;
  }

  function photoFailureMessage(failure: 'upload' | 'remove'): string {
    return failure === 'upload'
      ? t('addEvent.alerts.photoUploadFailed')
      : t('addEvent.alerts.photoRemoveFailed');
  }

  async function persist(data: CreateEventRequest, withExtraDoses = false): Promise<void> {
    let savedInfo: SavedMedicationInfo | undefined;
    try {
      if (isEditing && targetEventId) {
        await updateEvent.mutateAsync({ eventId: targetEventId, data });
        const photoFailure =
          data.event_type === 'medication' ? await savePhoto(targetEventId) : null;
        // Notes by doctor: counted once the save succeeded, enums only (never
        // the doctor). Moving to another doctor is a (re)link; None is an unlink.
        if (data.event_type === 'appointment' && data.provider_id !== storedProviderId) {
          if (data.provider_id) Analytics.providerLinked({ source: 'edit' });
          else if (storedProviderId) Analytics.providerUnlinked();
        }
        if (photoFailure) showToast(photoFailureMessage(photoFailure), 'error');
        else showToast(t(isRecurringEdit ? 'addEvent.updatedSeries' : 'addEvent.updated'), 'success');
      } else {
        const created = await createEvent.mutateAsync(data);
        if (data.event_type === 'appointment' && data.provider_id) {
          Analytics.providerLinked({ source: 'add' });
        }
        // OLD-BACKEND GUARD. A backend that predates as-needed strips the
        // unknown `as_needed` key and answers 200 with an ordinary one-time
        // medication — a silent wrong record. Undo it and say so.
        if (data.as_needed === true && created && created.as_needed !== true) {
          Analytics.entryValidationBlocked('as_needed_unsupported', eventType);
          try {
            await deleteEventRequest(circleId, created.id);
          } catch {
            // Best effort: the explanation below still holds.
          }
          void queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvents(circleId) });
          showToast(t('addEvent.asNeeded.updateOldBackend'), 'error');
          return;
        }
        if (data.as_needed === true) {
          Analytics.asNeededMedicationCreated({
            source: 'form',
            has_reason: !!data.as_needed_reason,
          });
        }
        // A medication row was persisted (create only; never the name or dose).
        if (data.event_type === 'medication') {
          Analytics.medicationCreated(
            circleId,
            !!data.recurrence_rule && !data.as_needed,
            firstRun ? 'wizard' : 'form',
            startsNextDose
          );
          // How the NAME was chosen (onboarding 1.3.1): enum only, never the name.
          Analytics.medNameSuggestionOutcome(
            selectedDrug?.rxcui ? 'suggestion' : usedAsTypedRef.current ? 'as_typed' : 'typed'
          );
        }
        // The photo goes onto the PRIMARY row once it exists (mobile: before the extra doses).
        const photoFailure =
          data.event_type === 'medication' && created?.id ? await savePhoto(created.id) : null;
        // The extra dose rows, after the primary (the wizard's and mobile's sequence). A miss is
        // NOT a success: the caregiver is told which times are missing.
        const failedDoseTimes: string[] = [];
        const savedDoses: SavedMedicationInfo['doses'] = [];
        if (data.event_type === 'medication' && data.scheduled_date && data.scheduled_time) {
          savedDoses.push({
            scheduledDate: data.scheduled_date,
            scheduledTime: data.scheduled_time,
          });
        }
        if (withExtraDoses && data.event_type === 'medication' && timezone) {
          for (const sibling of buildSiblingRequests(data, timezone, created?.id)) {
            try {
              await createEvent.mutateAsync(sibling);
              savedDoses.push({
                scheduledDate: sibling.scheduled_date as string,
                scheduledTime: sibling.scheduled_time as string,
              });
            } catch {
              failedDoseTimes.push(sibling.scheduled_time as string);
            }
          }
        }
        // WHAT SAVED, for whoever follows up (first-run payoff / Today's Mark it note). A
        // scheduled medication only: as-needed has no dose to mark and no start to roll.
        if (data.event_type === 'medication' && !data.as_needed && timezone && savedDoses.length > 0) {
          savedInfo = {
            eventId: created?.id ?? null,
            name: data.title,
            dosage: data.medication_dosage ?? '',
            doses: savedDoses,
            timezone,
            recurrenceRule: data.recurrence_rule ?? null,
            recurrenceDays: data.recurrence_days ?? null,
            startsNextDose,
            startDate: created?.scheduled_date ?? null,
            today: getDateInTimezone(timezone),
          };
          if (
            !firstRun &&
            circleHadNoMedication(circleId, savedInfo.today) &&
            savedInfo.eventId &&
            markItEligible(savedInfo)
          ) {
            // The add-menu path (43 of 58 first meds): Today shows the "Tomorrow" row with
            // the Mark it line for the rest of the recipient's day.
            writeFirstMedNote(circleId, {
              eventId: savedInfo.eventId,
              name: savedInfo.name,
              dosage: savedInfo.dosage,
              time: toWireTime(savedInfo.doses[0].scheduledTime),
              day: savedInfo.today,
              startDate: savedInfo.startDate ?? savedInfo.today,
              marked: false,
            });
          }
        }
        // The first-run funnel's save event: enums, a boolean and a count (never the name).
        if (firstRun && data.event_type === 'medication') {
          Analytics.firstRunMedicationSaved({
            circleId,
            preset: litChip ?? 'other',
            recurrence:
              recurrence === 'days_of_week' || recurrence === 'as_needed' ? recurrence : 'daily',
            dosageFilled: dosage.trim().length > 0,
            doseCount: Math.max(1, savedDoses.length),
          });
        }
        if (failedDoseTimes.length > 0) {
          Analytics.entrySaveFailed(circleId, eventType, 'additional_dose_create_failed');
          showToast(
            t('addEvent.alerts.someDoseTimesFailed', {
              count: failedDoseTimes.length,
              times: failedDoseTimes.join(', '),
            }),
            'error'
          );
        } else if (photoFailure) {
          showToast(photoFailureMessage(photoFailure), 'error');
        } else {
          showToast(t(createdToastKey(eventType)), 'success');
        }
      }
      savedRef.current = true;
      onSaved?.(savedInfo);
      onClose();
    } catch (error) {
      // The mutation hooks surface their own permission/subscription/save toasts.
      // A REAL failure (the API refused or was unreachable): `error_code` is
      // the closed-set classifier, never a message.
      const httpStatus = apiErrorStatus(error);
      Analytics.entrySaveFailed(circleId, eventType, 'api_error', {
        errorCode: classifyFailureCode(error),
        ...(httpStatus !== undefined ? { httpStatus } : {}),
      });
    }
  }

  /**
   * The simple forms keep optional fields in collapsed rows. A refused save that
   * errored one of them opens its row so the message (and focus) can be seen.
   * Returns true when something was opened.
   */
  function revealErrorFields(fieldErrors: FieldErrors): boolean {
    let revealed = false;
    if (simpleKind === 'medication') {
      // The repeat end is the "Repeats until" tile in When? now (owner 2026-11-10), not in More details.
      const hidden = ['description', 'alert_days_before'];
      if (hidden.some((k) => fieldErrors[k]) && !moreOpen) {
        setMoreOpen(true);
        revealed = true;
      }
    } else if (simpleKind === 'task') {
      const hidden = ['description', 'endTime', 'recurrence_rule'];
      if (hidden.some((k) => fieldErrors[k]) && !moreOpen) {
        setMoreOpen(true);
        revealed = true;
      }
      if (fieldErrors.scheduled_time && !showTaskTimeField) {
        setPickTimeOpen(true);
        revealed = true;
      }
    } else {
      // From | To live under "What time?" and the repeat end in When? (owner 2026-11-10), not in More details.
      const hidden = ['provider_id', 'location', 'description'];
      if (hidden.some((k) => fieldErrors[k]) && !moreOpen) {
        setMoreOpen(true);
        revealed = true;
      }
      if ((fieldErrors.scheduled_time || fieldErrors.endTime) && !showTaskTimeField) {
        setPickTimeOpen(true);
        revealed = true;
      }
    }
    return revealed;
  }

  async function handleSubmit(formEvent: FormEvent): Promise<void> {
    formEvent.preventDefault();
    // GATE, not a fallback: every date below is derived in the CARE
    // RECIPIENT's frame, so saving before the zone resolves would write the
    // event at a New-York-derived instant and silently move it. `canEdit` is
    // already false until the detail query lands, so this is belt-and-braces —
    // but it is the one place where guessing the zone corrupts stored data.
    // Likewise the series ROOT: this save PATCHes it with the form's schedule,
    // so it must not run on an occurrence's values standing in for the root's.
    if (!canEdit || !timezone || isPending || seriesRootPending) return;

    // Before validation, so it counts EVERY attempt (mobile parity).
    Analytics.entrySaveTapped(circleId, eventType, 'form', isEditing, 'simple');

    const built = buildPayload(timezone);
    if (!built.ok) {
      setErrors(built.errors);
      Analytics.entryValidationBlocked(
        validationReason({
          hasTitle: title.trim().length > 0,
          isMedication,
          hasTime: !!timeStr,
          hasEndTime: !!endTimeStr,
          errors: built.errors,
        }),
        eventType
      );
      // Cover every field that can error so focus always lands on an errored
      // control — including the title id for the OTHER type and the Zod-derived
      // fields (description, location, dosage, recurrence) (WCAG SC 3.3.1).
      const revealed = revealErrorFields(built.errors);
      const focusErrors = (): void =>
        focusFirstError(simpleFocusErrors(built.errors, simpleKind), SIMPLE_FOCUS_ORDER);
      if (revealed) setTimeout(focusErrors, 0);
      else focusErrors();
      return;
    }
    setErrors({});

    // EDIT only (mobile parity): saving a MEDICATION whose time already passed TODAY (care
    // recipient's timezone — never device-local) gets a non-blocking notice first; confirming
    // proceeds. CREATE has no prompt: the backend rolls the start to the next dose and the form
    // shows `startsNextDose`'s inline note under the time field.
    if (
      isEditing &&
      built.data.event_type === 'medication' &&
      built.data.scheduled_time &&
      built.data.scheduled_date === getDateInTimezone(timezone) &&
      isEventPastDue(built.data.scheduled_date, built.data.scheduled_time, timezone)
    ) {
      setPendingPastTime(built.data);
      return;
    }

    await persist(built.data, extraTimes.length > 0);
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

  // Every user-initiated close (×, Cancel, Escape) comes through here; a
  // successful save calls the `onClose` prop directly and is never an abandon.
  function handleClose(): void {
    if (!isEditing && !savedRef.current && !abandonReportedRef.current) {
      if (isMedication) {
        abandonReportedRef.current = true;
        Analytics.medicationFormAbandoned({
          lastField: lastFieldRef.current,
          hasName: title.trim().length > 0,
          hasSchedule: !!timeStr,
          entry: 'form',
          entrySource: entryOrigin,
          secondsOpen: (Date.now() - openedAtRef.current) / 1000,
        });
      } else if (eventType === 'appointment') {
        abandonReportedRef.current = true;
        Analytics.appointmentFormAbandoned({
          lastField: apptLastFieldRef.current,
          entrySource: entryOrigin,
          secondsOpen: (Date.now() - openedAtRef.current) / 1000,
        });
      }
    }
    onClose();
  }

  // Hidden entirely when the user can't edit — the read-only path keeps the
  // EventDetailModal download CTA instead (Task 1.6 gating).
  if (!canEdit) return null;

  const titleFieldId = isMedication ? 'medication_name' : 'title';

  // Save sits in the dialog's pinned footer (always on screen, in add AND
  // edit) and stays disabled until every ALWAYS-required field is filled: the
  // name/title, the date, and a medication's time (an as-needed medication has
  // neither date nor time). These are exactly the fields `buildPayload` refuses
  // unconditionally; the conditional rules (end time once a start is set,
  // at least one weekday) still answer on submit with their own message.
  const requiredFilled =
    title.trim().length > 0 &&
    (isAsNeeded || dateStr !== '') &&
    (!isMedication || isAsNeeded || timeStr !== '');
  // The first required field still empty, in the order the form lists them.
  const missingField: 'title' | 'date' | 'time' | null = requiredFilled
    ? null
    : title.trim().length === 0
      ? 'title'
      : !isAsNeeded && dateStr === ''
        ? 'date'
        : 'time';
  // Save is always the solid primary button. Pressing it with a field missing
  // does not save: it records WHICH field was missing (`pressedMissing`), focuses
  // it, and that field shows its normal inline error. The error is shown only
  // while that same field is still the missing one, so it clears the moment the
  // field is satisfied and never jumps to the next missing field by itself.
  const [pressedMissing, setPressedMissing] = useState<'title' | 'date' | 'time' | null>(null);
  useEffect(() => {
    if (pressedMissing !== null && pressedMissing !== missingField) setPressedMissing(null);
  }, [pressedMissing, missingField]);
  const missingMessage =
    missingField === null
      ? undefined
      : missingField === 'title'
        ? t(isMedication ? 'addEvent.validation.medicationRequired' : 'addEvent.validation.titleRequired')
        : missingField === 'date'
          ? t('addEvent.validation.dateRequired')
          : t('addEvent.validation.timeRequired');
  const missingErrorFor = (field: 'title' | 'date' | 'time'): string | undefined =>
    pressedMissing === field && missingField === field ? missingMessage : undefined;

  // Save cannot do anything yet: the recipient's zone (every date is converted
  // into it) or the series root (an edit PATCHes it) is still loading. There
  // is nothing to point the user at, so this one is a real `disabled`.
  const setupBlocked = !timezone || seriesRootPending;

  // Save pressed with a required field missing: show that field's error and
  // scroll to AND focus it. Ids match the inputs (`title` / `medication_name`,
  // `scheduled_date`, `scheduled_time`).
  function focusMissingField(): void {
    if (missingField === null) return;
    setPressedMissing(missingField);
    const id =
      missingField === 'title'
        ? titleFieldId
        : missingField === 'date'
          ? 'scheduled_date'
          : simpleKind === 'medication'
            ? 'time-chips-morning'
            : 'scheduled_time';
    const focusIt = (): void => {
      // The simple forms' day and time are tiles over hidden inputs: the TILE takes focus (see PickerTile).
      const el =
        (PICKER_TILE_FIELDS.has(id) ? document.getElementById(`${id}-tile`) : null) ??
        document.getElementById(id);
      if (!el) return;
      el.scrollIntoView?.({ block: 'center' });
      el.focus({ preventScroll: true });
    };
    focusIt();
  }

  const asNeededReasonBlock = (
    <>
        {/* AS NEEDED details: ONE optional plain note. No minimum interval, no
            maximum per day — the family decides when a dose is right, the app
            only records it. */}
        {isAsNeeded && (
          <TextField
            id="as_needed_reason"
            // No "(optional)" fragment: required fields carry the red asterisk instead (owner 2026-11-07).
            label={t('addEvent.asNeeded.reason')}
            value={asNeededReason}
            maxLength={100}
            error={errors.as_needed_reason}
            placeholder={t('addEvent.asNeeded.reasonPlaceholder')}
            hint={t('addEvent.asNeeded.repeatHint')}
            onChange={(e) => {
              setAsNeededReason(e.target.value);
              clearError('as_needed_reason');
            }}
          />
        )}
    </>
  );

  const daysBlock = (
    <>
        {/* "Days of the week" — the chips reveal inline under the select, the
            way Cycle reveals its on/off inputs (mobile shows the same chips as
            a step of its Repeat sheet). */}
        {recurrence === 'days_of_week' && (
          <div className="flex flex-col gap-2">
            <DaysOfWeekPicker
              id={RECURRENCE_DAYS_ID}
              label={t('addEvent.daysOfWeek.title')}
              selected={selectedDays}
              lockedDay={lockedDay}
              lockedHintId={lockedDay != null ? RECURRENCE_DAYS_LOCK_ID : undefined}
              describedBy={errors[RECURRENCE_DAYS_ID] ? RECURRENCE_DAYS_ERROR_ID : undefined}
              // PK23: the chips are in the RECIPIENT's frame; say so only when
              // the viewer's zone differs (the dual-time hint's condition).
              note={showDualTimezone ? daysTimezoneNote : undefined}
              noteId={RECURRENCE_DAYS_NOTE_ID}
              language={language}
              onChange={(days) => {
                touchRecurrence();
                setRecurrenceDays(days);
                clearError(RECURRENCE_DAYS_ID);
              }}
            />
            {errors[RECURRENCE_DAYS_ID] && (
              <p id={RECURRENCE_DAYS_ERROR_ID} className={INPUT_ERROR}>
                <Icon name="alert-circle-outline" size="inline" />
                {errors[RECURRENCE_DAYS_ID]}
              </p>
            )}
            {/* Polite live region, always mounted while the picker is: the
                "First time" move is a consequence of a chip toggle that a
                screen-reader user would otherwise never hear about. */}
            <div aria-live="polite" className="ml-1 flex flex-col gap-1">
              {selectedDays.length > 0 && (
                <p className="m-0 text-sm text-ink-2">
                  {formatWeekdayList(selectedDays, language)}
                </p>
              )}
              {firstTimeLabel && (
                <p className="m-0 text-sm font-medium text-ink">
                  {t('addEvent.daysOfWeek.firstTime', { date: firstTimeLabel })}
                </p>
              )}
              {lockedDay != null && (
                <p id={RECURRENCE_DAYS_LOCK_ID} className="m-0 text-sm text-ink-3">
                  {t('addEvent.daysOfWeek.startLocked', { day: lockedDayName })}
                </p>
              )}
            </div>
          </div>
        )}
    </>
  );

  const cycleBlock = (
    <>
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
    </>
  );

  const asNeededNoRemindersNote = isAsNeeded ? (
    <p className="m-0 text-sm text-ink-3" data-testid="as-needed-no-reminders">
      {t('addEvent.asNeeded.remindersNone')}
    </p>
  ) : null;
  /**
   * The Reminders card. `inRow`: the simple forms' accordion under the summary row, which already says
   * "Reminders" — so the legend is visually hidden there but STAYS the fieldset's first child, keeping every
   * control in it named by the group ("Reminders").
   */
  const reminderBlockFor = (inRow: boolean) => (
    <>
        {/* Reminders — only once there is a time to fire against. */}
        {!inRow && asNeededNoRemindersNote}
        {remindersApply(eventType, timeStr) && !isAsNeeded && (
        <fieldset
          id={REMINDERS_FIELDSET_ID}
          data-testid="reminders-fieldset"
          className="m-0 flex flex-col gap-3 border-0 p-0"
        >
          <Text
            variant="sectionTitle"
            as="legend"
            className={inRow ? 'sr-only' : 'p-0 text-base!'}
          >
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
                  "Enable notifications" above is the one kill switch for this entry,
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
            {/* FOLLOW-UP ALERTS ONLY (owner 2026-11-09, mobile parity, copy
                locked). Medication, master ON, "at the scheduled time" OFF and
                all four earlier reminders OFF: users read this as "fully off",
                but notifications_enabled alone still drives the 15 / 30 / 60
                minute missed-dose chain. A prominent card, not a hint line.
                ADA: amber-deep icon on amber-soft, text in ink tokens — never
                terracotta as text. */}
            {showNoEarlierBeforeDose && (
              <div
                role="note"
                aria-labelledby={FOLLOW_UP_ONLY_TITLE_ID}
                data-testid="reminders-follow-up-only-warning"
                className="flex items-start gap-2.5 rounded-xl border border-amber/40 bg-amber-soft p-3"
              >
                <span className="mt-0.5 shrink-0 text-amber-deep" aria-hidden="true">
                  <Icon name="alert-circle-outline" size="inline" />
                </span>
                <div className="min-w-0 flex-1">
                  <p id={FOLLOW_UP_ONLY_TITLE_ID} className="m-0 text-sm font-semibold text-ink">
                    {t('addEvent.reminders.followUpOnlyTitle')}
                  </p>
                  <p className="m-0 mt-1 text-sm text-ink">
                    {t('addEvent.reminders.followUpOnlyBody')}
                  </p>
                </div>
              </div>
            )}
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
    </>
  );
  // ── The "Reminders" summary row (owner 2026-11-10, mobile parity) ──────────────────────────────────
  // Directly ABOVE each simple form's More details, always visible, live from the card's own state. An
  // accordion: tapping it expands the full Reminders card inline under it (and folds it again), outside More
  // details. As-needed medications have no reminders at all: no row. A task / appointment without a time cannot
  // remind yet: the muted pick-time row, which goes to the time choice and expands nothing.
  const simpleReminderSummary = reminderSummary({
    eventType,
    notificationsEnabled,
    reminderAtDue,
    reminder24h,
    reminder1h,
    reminder30m,
    reminder15m,
  });
  const remindersSummaryRow =
    isAsNeeded ? null : remindersApply(eventType, timeStr) ? (
      <RemindersSummaryRow
        variant="summary"
        summary={simpleReminderSummary}
        expanded={remindersOpen}
        panelId={REMINDERS_PANEL_ID}
        onPress={() => {
          Analytics.remindersSummaryToggled(
            simpleKind,
            simpleReminderSummary.state,
            remindersOpen ? 'collapse' : 'expand'
          );
          if (!remindersOpen) setRemindersNudge((n) => n + 1);
          setRemindersOpen(!remindersOpen);
        }}
      >
        {reminderBlockFor(true)}
      </RemindersSummaryRow>
    ) : (
      <RemindersSummaryRow variant="pickTime" onPress={() => setTimeJump((n) => n + 1)} />
    );

  // SIMPLE-UI FIELDS (new medication / new appointment): defined below.
  /**
   * The end time a NEW viewer-frame start brings (the full form's time-field rules, verbatim): no start, no
   * end; a moved start moves the end (the duration is kept, PK21); a first start gets the default duration,
   * except on an edit of a row saved without one. A medication has no end.
   */
  function followEndTime(prevStart: string, nextStart: string): void {
    if (!nextStart) {
      setEndTimeStr('');
    } else if (!isMedication && endTimeStr && prevStart) {
      const shifted = shiftEndTimeStr(prevStart, nextStart, endTimeStr);
      if (shifted) setEndTimeStr(shifted);
      clearError('endTime');
    } else if (!isMedication && !endTimeStr && !isEditingWithoutDuration) {
      // A first start gets the default length, as the form always did (the task too: its To tile shows it, and
      // "No end" clears it, owner 2026-11-10).
      setEndTimeStr(presetEndFor(nextStart, DEFAULT_DURATION_MINUTES));
      clearError('endTime');
    }
  }

  // ── SIMPLE LAYOUT (medication / appointment / task; owner 2026-11-10, build 11) ──────────────────────
  // Same state, same `buildPayload`, same Save: only the arrangement differs, so the API payload for a
  // given set of answers is IDENTICAL to the full form's (the payload-equality suites pin it). One order on
  // all three, on new AND edit: What → When? (Starts | Repeats until, then How often?) → What time? → Who →
  // Reminders → More details.
  const timeErrorText = errors.scheduled_time ?? missingErrorFor('time');
  const sectionHeading = (headingId: string, text: string, required = false): ReactElement => (
    <Text variant="sectionTitle" as="h3" id={headingId} className="text-base!">
      {text}
      {required && <RequiredMarker />}
    </Text>
  );

  /**
   * A chip names the RECIPIENT's wall clock ("Evening 6:00 PM" is 6 PM where the person lives), exactly
   * as on mobile. The fields hold the viewer's clock and the save converts, so the chip is converted the
   * other way with the inverse the edit hydration uses (`eventDatesFromApi`). The day is the recipient's
   * day the form is on: the start date while there is no time (it opens on the recipient's today), else
   * the recipient's day of the current time, since a chip in a far zone moves the viewer-frame date. The
   * exact instant is kept too (`chipInstant`): inside the viewer's repeated hour the fields cannot name it.
   */
  function chooseTimeChip(chip: TimeChipId | null, time: string): void {
    datesTouched.current = true;
    if (chip === null) {
      // With no time the date IS the recipient's day (`eventDatesForApi`'s date-only branch), so the day stays
      // the recipient day the time was on: the viewer-frame day of a far-zone chip would otherwise become it, and
      // the next chip would land a day off (untap-then-tap is how the multi-select chips switch).
      if (recipientStartDate) moveViewerDay(recipientStartDate);
      setTimeStr('');
      setChipInstant(null);
      setExtraDoses([]);
      return;
    }
    if (!timezone) return;
    const viewer = eventDatesFromApi({
      // A cleared start date falls back to the recipient's today, the day the form opened on.
      scheduledDate: recipientStartDate ?? defaultNewEventDate(timezone),
      scheduledTime: time,
      timezone,
    });
    if (!viewer.timeStr) return;
    moveViewerDay(viewer.dateStr);
    setTimeStr(viewer.timeStr);
    setChipInstant(viewer.instant ?? null);
    clearError('scheduled_time');
    completeStep('when');
    // The add-form funnel only: an edit never counts as a chip pick.
    if (!isEditing) Analytics.timeChipSelected({ chip });
  }

  /**
   * The viewer-frame start day moved because a TIME was resolved on the circle's clock (a chip, Other…, From /
   * At, a cleared time): in far zones that instant falls on another viewer day. The repeat end is held as a
   * viewer-side span from that day, so it moves by the same days: the "Repeats until" day the user picked (the
   * circle's day) stays put. A no-op when the day does not move (same / near zones, every payload suite case).
   */
  function moveViewerDay(next: string, nextCircleDay: string | null = recipientStartDate): void {
    if (next !== dateStr && dateStr && next && recurrenceEndDate) {
      // The end is held as a viewer-frame day = its circle day + (viewer start day - circle start day). It moves
      // only by the CHANGE in that offset, never by a start change the user made (`nextCircleDay` is the circle
      // day the start lands on: unchanged for a time change, the picked day for `chooseTaskDay`).
      const shift =
        recipientStartDate && nextCircleDay
          ? daysBetween(nextCircleDay, next) - daysBetween(recipientStartDate, dateStr)
          : daysBetween(dateStr, next);
      if (shift !== 0) setRecurrenceEndDate(addDays(recurrenceEndDate, shift));
    }
    setDateStr(next);
  }
  /**
   * An EXTRA dose's viewer-frame HH:MM on the RECIPIENT's clock: the clock the save sends for it, on the primary's
   * circle day (`extraDoseForApi`: the extra's own viewer day is found, never assumed to be the primary's).
   */
  function viewerToRecipient(time: string, extraInstant?: Date | null): string {
    if (!timezone || !dateStr || !time) return time;
    try {
      return timeStr
        ? extraDoseForApi({
            dateStr,
            timeStr,
            extraTimeStr: time,
            timezone,
            heldInstant,
            heldExtraInstant: extraInstant ?? extraDoses.find((d) => d.time === time)?.instant ?? null,
          }).scheduledTime
        : (eventDatesForApi({ dateStr, timeStr: time, recurrenceEndDateStr: null, timezone }).scheduledTime ?? time);
    } catch {
      return time;
    }
  }
  /**
   * A recipient HH:MM as an EXTRA dose's viewer-frame clock: the conversion "+ Another dose" made (the day is
   * the recipient's start day), so a chip picked as a second time saves exactly what that tile saved.
   */
  /** The same, with the exact instant the dose names (kept so the viewer's repeated hour survives the save). */
  function recipientToExtraDose(time: string): { time: string; instant: Date | null } {
    if (!timezone || !recipientStartDate) return { time, instant: null };
    const viewer = eventDatesFromApi({ scheduledDate: recipientStartDate, scheduledTime: time, timezone });
    return { time: viewer.timeStr || time, instant: viewer.instant ?? null };
  }
  /**
   * Every dose time the medication form holds, on the RECIPIENT's clock, one per SLOT: index 0 the primary, then the
   * extras ('' while there is no time). The chips address a custom dose by its slot.
   */
  const doseRecipientTimes = [recipientClock, ...extraDoses.map((d) => viewerToRecipient(d.time, d.instant))];
  const doseSignature = doseRecipientTimes.join(',');
  // A duplicate note is about the doses it was said for: the first change to them retires it (React's
  // "adjust state while rendering" pattern, so it can never come back when the doses later return to that set).
  if (doseDuplicate && doseDuplicate.signature !== doseSignature) setDoseDuplicate(null);
  const shownDuplicate = doseDuplicate && doseDuplicate.signature === doseSignature ? doseDuplicate : null;
  /**
   * Dose times are UNIQUE: a custom pick for `slot` on circle clock `clock` that another dose already has (a preset,
   * the first time, another custom) is refused, said, and counted. True = refused; the caller changes nothing.
   */
  function refuseDuplicateDose(slot: number, clock: string, source: DoseDuplicateSource): boolean {
    if (isEditing || !clock) return false;
    const hhmm = clock.slice(0, 5);
    if (!doseRecipientTimes.some((other, i) => i !== slot && other !== '' && other.slice(0, 5) === hhmm)) return false;
    // Once per attempt: the column picker commits on every click, so dwelling on the same time counts once.
    if (!(doseDuplicate && doseDuplicate.slot === slot && doseDuplicate.time === hhmm)) {
      Analytics.doseTimeDuplicateBlocked({ source });
    }
    setDoseDuplicate({ slot, time: hhmm, signature: doseSignature });
    return true;
  }
  /** A custom dose chip's picker (Fix13): change THAT dose's time in place. */
  function changeDoseTime(slot: number, next: string): void {
    setOtherTarget(null);
    if (slot === 0) {
      if (refuseDuplicateDose(0, next, 'custom_chip')) return;
      chooseRecipientTime(next);
      return;
    }
    const dose = recipientToExtraDose(next);
    if (refuseDuplicateDose(slot, viewerToRecipient(dose.time, dose.instant), 'custom_chip')) return;
    setExtraDoses((prev) => prev.map((d, i) => (i === slot - 1 ? dose : d)));
  }
  /** A custom dose chip's "×": remove that dose (the medication's own time hands over to the next, as untapping). */
  function removeDose(slot: number, time: string): void {
    if (slot === 0) {
      toggleDoseChip(time, null, true);
      return;
    }
    setOtherTarget(null);
    setExtraDoses((prev) => prev.filter((_, i) => i !== slot - 1));
  }
  /** One medication row per time (create only): the primary plus at most three extras. */
  const doseTimesFull = !isEditing && timeStr !== '' && extraTimes.length >= 3;

  /**
   * A tap on a "What time?" chip (owner 2026-11-10, A2). A NEW medication's chips are multi-select: the first
   * time chosen is the form's own (`chooseTimeChip`, as before), each further one an extra dose saved as its own
   * medication (what "+ Another dose" did, at that chip's time); un-choosing the primary moves the next time up.
   * An EDIT holds one dose (it cannot see its siblings): a chip replaces the time, the lit chip clears it.
   */
  function toggleDoseChip(time: string, chip: TimeChipId | null, wasOn: boolean): void {
    setOtherTarget(null);
    const pick = (): void => {
      if (chip) chooseTimeChip(chip, time);
      else chooseRecipientTime(time);
    };
    if (isEditing || !timeStr) {
      if (wasOn) chooseTimeChip(null, '');
      else pick();
      return;
    }
    if (!wasOn) {
      if (extraTimes.length < 3) setExtraDoses((prev) => [...prev, recipientToExtraDose(time)]);
      return;
    }
    if (time === recipientClock) {
      if (extraTimes.length === 0) {
        chooseTimeChip(null, '');
        return;
      }
      const [next, ...rest] = extraDoses;
      chooseRecipientTime(viewerToRecipient(next.time, next.instant));
      setExtraDoses(rest);
      return;
    }
    const index = extraTimes.findIndex((extra) => viewerToRecipient(extra) === time);
    if (index !== -1) setExtraDoses((prev) => prev.filter((_, i) => i !== index));
  }

  /** "Other…" opened: it sets the form's own time (an edit, or no time yet), else the next extra dose. */
  function openOtherTime(): void {
    setDoseDuplicate(null);
    if (!isEditing) Analytics.timeChipSelected({ chip: 'other' });
    setOtherTarget(isEditing || !timeStr ? 'primary' : extraTimes.length);
  }
  const otherTargetResolved: 'primary' | number =
    otherTarget ?? (isEditing || !timeStr ? 'primary' : extraTimes.length);
  /** What the "Other…" picker shows: its target's time on the RECIPIENT's clock ('' for a new extra). */
  const otherTargetSlot = otherTargetResolved === 'primary' ? 0 : otherTargetResolved + 1;
  const otherTimeValue =
    shownDuplicate && shownDuplicate.slot === otherTargetSlot
      ? shownDuplicate.time
      : otherTargetResolved === 'primary'
        ? recipientClock
        : viewerToRecipient(extraTimes[otherTargetResolved] ?? '');
  /** A time from "Other…" (the RECIPIENT's clock): it becomes its own chip ("2:30 PM / Other"). */
  function chooseOtherTime(next: string): void {
    const target = otherTargetResolved;
    setOtherTarget(target);
    if (target === 'primary') {
      chooseRecipientTime(next);
      if (next) completeStep('when');
      return;
    }
    if (!next) {
      setExtraDoses((prev) => prev.filter((_, i) => i !== target));
      setOtherTarget(null);
      return;
    }
    const dose = recipientToExtraDose(next);
    if (refuseDuplicateDose(target + 1, viewerToRecipient(dose.time, dose.instant), 'other')) return;
    setExtraDoses((prev) =>
      target < prev.length ? prev.map((d, i) => (i === target ? dose : d)) : prev.length < 3 ? [...prev, dose] : prev
    );
  }

  /**
   * The "Other time" field's value, typed on the RECIPIENT's clock: the SAME conversion a chip makes
   * (`chooseTimeChip`), so typing 7:15 saves exactly what a "7:15" chip would, and exactly what typing the viewer's
   * converted clock in the old viewer-frame field saved (the stored pair is the recipient's naive `HH:MM` on the
   * recipient's day either way). The day is the recipient's day the form is on; the viewer-frame date moves with it
   * in far-apart zones. The exact instant is held (`chipInstant`), so a time in the VIEWER's repeated hour keeps its
   * own reading. Re-typing the current value changes nothing.
   */
  function chooseRecipientTime(next: string): void {
    datesTouched.current = true;
    clearError('scheduled_time');
    if (!next) {
      // With no time the date IS the circle's day: restore it (a far-zone time had moved the viewer day).
      if (recipientStartDate) moveViewerDay(recipientStartDate);
      setTimeStr('');
      setChipInstant(null);
      setEndTimeStr('');
      return;
    }
    if (!timezone || next === recipientClock) return;
    const viewer = eventDatesFromApi({
      scheduledDate: recipientStartDate ?? defaultNewEventDate(timezone),
      scheduledTime: next,
      timezone,
    });
    if (!viewer.timeStr) return;
    moveViewerDay(viewer.dateStr);
    setTimeStr(viewer.timeStr);
    setChipInstant(viewer.instant ?? null);
    // A task's end follows its start exactly as the full form's time field made it (the med form has none).
    if (!isMedication) followEndTime(timeStr, viewer.timeStr);
  }

  /**
   * The simple task form's day ("Today" / "Tomorrow" / the "Other day" field): a day on the RECIPIENT's
   * calendar, the day the save sends. With no time a date-only value IS the recipient's day. With a time, the
   * same recipient wall clock is re-resolved on the new day (as a chip or the time field resolves one), which
   * can move the viewer-frame date and, across a DST change, the viewer clock; the end follows so the
   * duration is kept.
   */
  function chooseTaskDay(day: string): void {
    datesTouched.current = true;
    clearError('scheduled_date');
    if (day) completeStep('when');
    if (!day || !timeStr || !timezone || !recipientClock) {
      setDateStr(day);
      return;
    }
    const viewer = eventDatesFromApi({ scheduledDate: day, scheduledTime: recipientClock, timezone });
    if (!viewer.timeStr) return;
    moveViewerDay(viewer.dateStr, day);
    setTimeStr(viewer.timeStr);
    setChipInstant(viewer.instant ?? null);
    followEndTime(timeStr, viewer.timeStr);
  }

  /**
   * The task's end on the RECIPIENT's clock (the clock its start is typed on): the recipient start plus the
   * duration the viewer-frame pair holds (a delta, frame-independent). Typing one converts back the same way,
   * so the saved `duration_minutes` is the span between the two times as typed.
   */
  const recipientEndClock = (() => {
    if (!recipientClock || !timeStr || !endTimeStr) return '';
    const span = spanMinutes(timeStr, endTimeStr);
    return span === null ? '' : endTimeForDuration(recipientClock, span);
  })();
  function chooseRecipientEndTime(next: string): void {
    clearError('endTime');
    if (!next || !recipientClock || !timeStr) {
      setEndTimeStr(next);
      return;
    }
    const span = spanMinutes(recipientClock, next);
    setEndTimeStr(span === null ? next : endTimeForDuration(timeStr, span));
  }

  /** An HH:MM as the viewer reads it (12 / 24 hour). */
  const clockText = (hhmm: string): string => clockTextFor(hhmm, hourCycle);
  /** "11:00 – 11:30 AM": the shared AM / PM said once when both ends have it (else both in full). */
  const clockRangeText = (from: string, to: string): string => clockRangeTextFor(from, to, hourCycle);
  /** "a, b and c" with the locale's joiner. */
  const listText = (items: string[]): string =>
    items.length <= 1
      ? (items[0] ?? '')
      : `${items.slice(0, -1).join(', ')} ${t('addEvent.simple.listAnd')} ${items[items.length - 1]}`;
  /**
   * The new medication's dose summary under "What time?" (owner 2026-11-11, mobile parity): what the save creates,
   * in time order ("2 doses a day · 8:00 AM, 9:00 PM"). "a day" only on Every day; any other repeat says "2 doses ·
   * …", which stays true. Its note is its own line (`doseSummaryNote`, design B). None with no dose, on When needed,
   * or on an edit (it holds one row of a medication whose other doses it cannot see).
   */
  const summaryClocks = [...new Set(doseRecipientTimes.filter(Boolean).map((time) => time.slice(0, 5)))].sort();
  const doseSummaryText = ((): string | null => {
    if (isEditing || !isMedication || isAsNeeded || summaryClocks.length === 0) return null;
    const count = summaryClocks.length;
    const times = summaryClocks.map(clockText).join(', ');
    return recurrence === 'daily'
      ? t('addEvent.simple.doseSummaryDaily', { count, times })
      : t('addEvent.simple.doseSummary', { count, times });
  })();
  /**
   * The summary's own second line (design B, owner 2026-11-11, mobile parity): one dose invites a second ("Taken more
   * than once a day? Tap another time."; a non-daily repeat drops "a day"), announced with the summary; two or more
   * with a preset among them say how to remove one (never announced); at the 4-dose limit, or custom doses only,
   * nothing.
   */
  const doseSummaryNote = ((): { text: string; announce: boolean } | null => {
    const count = summaryClocks.length;
    if (!doseSummaryText || count === 0 || count >= 4) return null;
    if (count === 1) {
      return {
        text: recurrence === 'daily' ? t('addEvent.simple.doseSummaryAddDaily') : t('addEvent.simple.doseSummaryAdd'),
        announce: true,
      };
    }
    return summaryClocks.some((clock) => chipForTime(clock) !== null)
      ? { text: t('addEvent.simple.doseSummaryRemoveHint'), announce: false }
      : null;
  })();
  /**
   * "Tap every time it's taken." under "What time?" (owner 1.4.1 (15), design B, mobile parity): the chips are
   * multi-select on a NEW scheduled medication. The summary's rules minus the dose count (an edit holds one time;
   * When needed has no chips). Plain text read in order, and the chips group's description (aria-describedby).
   */
  const doseTimesHint = isEditing || !isMedication || isAsNeeded ? null : t('addEvent.simple.doseTimesHint');
  /** The doses whose time already passed today (they start with the next dose), as circle clocks in time order. */
  const pastDoseClocks = [
    ...new Set(
      doseRecipientTimes.flatMap((clock, slot) =>
        clock && (slot === 0 ? startsNextDose : doseStartsNext(extraTimes[slot - 1] ?? '')) ? [clock.slice(0, 5)] : []
      )
    ),
  ].sort();
  /**
   * THE ZONE CAPTION under "What time?" (owner 2026-11-10, build 11), ONLY when the viewer's zone differs from
   * the circle's: the circle's time first (the tiles and chips are on its clock), then the same instant on the
   * viewer's: "Denver time · 10:00 AM your time (New York)", "… 10:00 AM and 8:00 PM your time (New York)",
   * "… 11:00 – 11:30 AM your time (New York)". The viewer's clock is the fields' own (the viewer-frame state), so
   * nothing is converted here. Replaces the older "Your time / X's time" and "Times are for X" lines.
   */
  /**
   * The caption's "your time" range for a timed appointment / task (BC-4): the START is the viewer's own clock, the
   * END is the circle's end wall time (circle start + the duration, wall minutes) resolved to an instant and read on
   * the viewer's clock. "Viewer start clock + duration" is an hour off when exactly one of the two zones changes
   * clocks inside the span. Null (the caller falls back to the viewer-frame pair) while a piece is missing.
   */
  function viewerCaptionRange(): string | null {
    if (!timezone || !recipientStartDate || !recipientClock || !timeStr || !endTimeStr) return null;
    const durationMinutes = spanMinutes(timeStr, endTimeStr);
    if (durationMinutes === null) return null;
    try {
      return viewerRangeForCaption({
        scheduledDate: recipientStartDate,
        startHm: recipientClock,
        durationMinutes,
        circleZone: timezone,
        viewerZone: deviceTimezone,
        cycle: hourCycle,
      });
    } catch {
      return null;
    }
  }
  const zoneCaptionTimes =
    simpleKind === 'medication'
      ? listText([timeStr, ...extraTimes].filter(Boolean).map(clockText))
      : timeStr
        ? endTimeStr
          ? (viewerCaptionRange() ?? clockRangeText(timeStr, endTimeStr))
          : clockText(timeStr)
        : '';
  const zoneCaption =
    showDualTimezone && timezone && zoneCaptionTimes
      ? t('addEvent.simple.zoneCaption', {
          circleZone: recipientZone || timezone,
          times: zoneCaptionTimes,
          yourZone: getTimezoneLabel(deviceTimezone) || deviceTimezone,
        })
      : null;
  const zoneCaptionLine = zoneCaption ? (
    <Text variant="caption" as="p" id="time-zone-caption" data-testid="time-zone-caption">
      {zoneCaption}
    </Text>
  ) : null;

  /** A value tile's look (owner 2026-11-10): outlined, label small over the value, a trailing chevron. */
  const valueTileClass = (invalid: boolean, disabled: boolean): string =>
    `${CHOICE_TILE_BOX} w-full min-w-0 ${invalid ? 'border-terracotta text-ink hover:bg-bg-2' : CHIP_UNSELECTED}${disabled ? ' cursor-default opacity-50' : ' cursor-pointer'}`;
  const valueTileContent = (label: string, value: string, chevron = true): ReactElement => (
    <>
      <span className={VALUE_TILE_LABEL}>{label}</span>
      {/* The name reads "Starts Tue, Nov 10": a space between the lines in every accessibility tree. */}{' '}
      <span className="flex max-w-full items-center gap-1 text-base font-medium text-ink">
        <span className="min-w-0 tabular-nums">{value}</span>
        {chevron && <Icon name="chevron-forward" size="inline" className="text-ink-2" />}
      </span>
    </>
  );
  /**
   * A value tile that IS its picker (PickerTile). `clear` (owner 2026-11-10, Fix13): an OPTIONAL value is cleared
   * INSIDE the tile, by a trailing "×" that is its own 44px button with its own name ("Clear repeat end"),
   * replacing the chevron while there is a value; the picker itself has no separate clear. Clearing returns
   * focus to the tile (the × is gone).
   */
  const valueTile = (p: {
    kind: 'date' | 'time';
    inputId: string;
    label: string;
    testId: string;
    value: string;
    display: string;
    onChange: (next: string) => void;
    today?: string;
    min?: string;
    disabled?: boolean;
    invalid?: boolean;
    describedBy?: string;
    clear?: string;
  }): ReactElement => {
    const clearable = !!p.clear && p.value !== '' && !p.disabled;
    const tile = (className: string): ReactElement => (
      <PickerTile
        kind={p.kind}
        inputId={p.inputId}
        inputLabel={p.label}
        testId={p.testId}
        value={p.value}
        today={p.today}
        min={p.min}
        clearLabel={null}
        disabled={p.disabled}
        invalid={p.invalid}
        describedBy={p.describedBy}
        className={className}
        onChange={p.onChange}
      >
        {valueTileContent(p.label, p.display, !clearable)}
      </PickerTile>
    );
    if (!clearable) return tile(valueTileClass(!!p.invalid, !!p.disabled));
    return (
      <div
        data-testid={`${p.testId}-box`}
        className={`${VALUE_TILE_CLEARABLE_BOX} ${p.invalid ? 'border-terracotta' : 'border-line-strong'}`}
      >
        {tile(VALUE_TILE_CLEARABLE_BODY)}
        <button
          type="button"
          aria-label={p.clear}
          data-testid={`${p.testId}-clear`}
          onClick={() => {
            p.onChange('');
            requestAnimationFrame(() => document.getElementById(`${p.inputId}-tile`)?.focus());
          }}
          className={VALUE_TILE_CLEAR_BUTTON}
        >
          <Icon name="close-outline" size="row" />
        </button>
      </div>
    );
  };
  const fieldError = (id: string, text: string | undefined): ReactElement | null =>
    text ? (
      <p id={`${id}-error`} role="alert" className={INPUT_ERROR}>
        <Icon name="alert-circle-outline" size="inline" />
        {text}
      </p>
    ) : null;
  const dayText = (day: string): string =>
    day
      ? formatDateForDisplay(day, { weekday: 'short', month: 'short', day: 'numeric' }, language)
      : t('common:datePicker.open');

  // ── When?: Starts | Repeats until (owner 2026-11-10, build 11) ──────────────────────────────────────
  // Two value tiles side by side, each the date picker itself (PickerTile). On all three forms the days are the
  // CIRCLE's (recipient's) calendar, as the times are its clock (owner: the tiles show and pick the circle's
  // date and time). The state stays the viewer-frame pair: a picked day is re-resolved with the same recipient
  // clock (`chooseTaskDay`, the task form's converter) and the repeat end keeps its span (`recipientRepeatEnd`
  // / `chooseRecipientRepeatEnd`), so the save is the circle-local pair it always was. "Repeats until" reads
  // "Never" when blank (its picker's clear is "No end date"); with Once it stays in place, disabled, "Doesn't
  // repeat" (no layout jump). An end before the start is said at that tile, live and on Save.
  const startTileValue = recipientStartDate ?? '';
  const startTileToday = recipientPickerToday;
  const repeatsAtAll = recurrence !== 'none' && recurrence !== 'as_needed';
  const repeatEndTileValue = repeatsAtAll ? recipientRepeatEnd : '';
  const startTileError = errors.scheduled_date ?? missingErrorFor('date');
  const repeatEndError =
    errors.recurrence_end_date ??
    (repeatEndBeforeStart ? t('shifts:validation.repeatEndBeforeStart') : undefined);
  const whenDateTiles = (
    <div className="grid grid-cols-2 gap-2" data-testid="when-date-tiles">
      <div className="flex min-w-0 flex-col gap-1">
        {valueTile({
          kind: 'date',
          inputId: 'scheduled_date',
          label: t('addEvent.simple.starts'),
          testId: 'starts-tile',
          value: startTileValue,
          display: dayText(startTileValue),
          today: startTileToday,
          invalid: !!startTileError,
          describedBy: startTileError ? 'scheduled_date-error' : undefined,
          onChange: chooseTaskDay,
        })}
        {fieldError('scheduled_date', startTileError)}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        {valueTile({
          kind: 'date',
          inputId: 'recurrence_end_date',
          label: t('addEvent.simple.repeatsUntil'),
          testId: 'repeats-until-tile',
          value: repeatEndTileValue,
          display: !repeatsAtAll
            ? t('addEvent.simple.doesntRepeat')
            : repeatEndTileValue
              ? dayText(repeatEndTileValue)
              : t('addEvent.simple.never'),
          min: startTileValue || undefined,
          today: startTileToday,
          disabled: !repeatsAtAll,
          invalid: !!repeatEndError,
          describedBy: repeatEndError ? 'recurrence_end_date-error' : undefined,
          // Optional: "Mar 1 ×", and × back to "Never".
          clear: t('addEvent.simple.clearRepeatEnd'),
          onChange: (next) => {
            datesTouched.current = true;
            chooseRecipientRepeatEnd(next);
            clearError('recurrence_end_date');
          },
        })}
        {fieldError('recurrence_end_date', repeatEndError)}
      </div>
    </div>
  );

  // ── What time? on the appointment and task forms (owner 2026-11-10, build 11) ─────────────────────
  // A small choice, "Pick a time | Any time"; with Pick a time, value tiles that ARE the time picker: the
  // appointment's From | To, the task's At. Every time is on the CIRCLE's (recipient's) clock, as the
  // medication chips are, with the viewer's under them in the zone caption; the state stays the viewer-frame
  // pair (`chooseRecipientTime` / `chooseRecipientEndTime`, the task form's converters), so the save is
  // unchanged. To starts at From + 30 minutes and keeps the length when From moves (`followEndTime`, as today).
  // No length chips.
  const timeChoice = (id: 'appt-time' | 'task-time'): ReactElement => (
    <ChipSelect
      id={id}
      label={t('addEvent.simple.whatTime')}
      allowDeselect={false}
      options={[
        { value: 'pick', label: t('addEvent.simple.pickTime') },
        { value: 'any', label: t('addEvent.simple.anyTime') },
      ]}
      value={showTaskTimeField ? 'pick' : 'any'}
      onChange={(next) => {
        if (next === 'pick') {
          setPickTimeOpen(true);
          requestAnimationFrame(() => document.getElementById('scheduled_time-tile')?.focus());
          return;
        }
        if (next !== 'any') return;
        setPickTimeOpen(false);
        chooseRecipientTime('');
        completeStep('when');
      }}
    />
  );
  const fromTileError = errors.scheduled_time ?? (simpleKind === 'medication' ? undefined : missingErrorFor('time'));
  const startTimeTile = (label: string, testId: string): ReactElement => (
    <div className="flex min-w-0 flex-col gap-1">
      {valueTile({
        kind: 'time',
        inputId: 'scheduled_time',
        label,
        testId,
        value: recipientClock,
        display: recipientClock ? clockText(recipientClock) : t('shifts:form.chooseTime'),
        invalid: !!fromTileError,
        describedBy:
          [fromTileError ? 'scheduled_time-error' : '', zoneCaption ? 'time-zone-caption' : '']
            .filter(Boolean)
            .join(' ') || undefined,
        onChange: (next) => {
          chooseRecipientTime(next);
          if (next) completeStep('when');
        },
      })}
      {fieldError('scheduled_time', fromTileError)}
    </div>
  );


  const detailsBlock = (
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
  );

  // ── "How often?" on the medication and appointment forms (owner 2026-11-08, "cohesiveness") ──
  // The task / shift form's grid: the common answers as tiles, then "Custom…" opening the rarer repeats in
  // place (the day chips and the cycle inputs under it). Same `chooseRecurrence` as the Repeat select it
  // replaces, so the save is unchanged (medPayloadEquality / apptPayloadEquality pin it).
  const sharedCustomRepeatOptions = [
    { value: 'every_other_day', label: t('addEvent.simple.everyOtherDay') },
    { value: 'cycle', label: t('addEvent.simple.daysOnOff') },
    { value: 'days_of_week', label: t('addEvent.simple.someDays') },
    { value: 'monthly', label: t('addEvent.simple.monthly') },
    { value: 'yearly', label: t('addEvent.simple.yearly') },
  ];
  function howOftenGrid(
    main: Array<{ value: string; label: string }>,
    custom: Array<{ value: string; label: string }>,
    locked: boolean
  ): ReactElement {
    // A stored rule no tile names lights nothing (it is named under the grid).
    const mainValue = !unshownRuleLabel && main.some((o) => o.value === recurrence) ? recurrence : null;
    const customSelected = !unshownRuleLabel && custom.some((o) => o.value === recurrence);
    const customShown = !locked && (taskCustomOpen || customSelected);
    const pick = (next: string | null): void => {
      if (!next) return;
      chooseRecurrence(next as RecurrenceChoice);
      completeStep('how_often');
    };
    return (
      <>
        <div className="grid grid-cols-2 gap-2 [&_[role=radio]]:w-full [&>button]:w-full">
          <ChipSelect
            id="how-often"
            label={t('addEvent.simple.howOften')}
            variant="tile"
            contents
            allowDeselect={false}
            disabled={locked}
            options={main}
            value={mainValue}
            onChange={(next) => {
              pick(next);
              if (next) setTaskCustomOpen(false);
            }}
          />
          <ChoiceTileButton
            testId="repeat-custom"
            label={t('addEvent.simple.custom')}
            selected={customSelected}
            expanded={customShown}
            disabled={locked}
            onClick={() => {
              // While a custom rule is the answer the options stay open (the choice lives there).
              if (customSelected) return;
              setTaskCustomOpen(!taskCustomOpen);
            }}
          />
        </div>
        {customShown && (
          <Card
            variant="outlined"
            padding="none"
            className="flex flex-col gap-2 p-3"
            data-testid="repeat-custom-panel"
          >
            <Eyebrow id="sf-repeat-custom">{t('addEvent.simple.customHeading')}</Eyebrow>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 [&_[role=radio]]:w-full">
              <ChipSelect
                id="how-often-custom"
                label={t('addEvent.simple.customHeading')}
                variant="tile"
                contents
                allowDeselect={false}
                options={custom}
                value={customSelected ? recurrence : null}
                onChange={pick}
              />
            </div>
          </Card>
        )}
        {unshownRuleLabel && (
          <Text variant="caption" data-testid="how-often-summary">
            {unshownRuleLabel}
          </Text>
        )}
        {daysBlock}
        {cycleBlock}
      </>
    );
  }

  // The photo, refill tracking and prescription details (mobile's `medPhotoRow` + `medAdditionalFields`).
  // On an edit they appear once the stored values have loaded; if that read failed they stay hidden
  // (and the save leaves those columns alone) rather than show empty fields that would not save.
  const medicationExtraFields =
    isMedication && medDetailsLoad === 'ready' ? (
      <>
        <MedicationPhotoField
          previewUrl={photoPreviewUrl}
          onPick={pickPhoto}
          onRemove={removePhoto}
          disabled={isPending}
        />
        <MedicationRefillFields
          state={medDetails}
          onChange={(next) => {
            setMedDetails((prev) => ({ ...prev, ...next }));
            if ('alertDaysBefore' in next) clearError('alert_days_before');
          }}
          asNeeded={isAsNeeded || isAsNeededEdit}
          refillsManagedElsewhere={medHydration?.refillsManagedElsewhere ?? false}
          countable={pillsCountable}
          isEditing={isEditing}
          doseTimeCount={doseTimeCount}
          derivedPerDay={derivedPerDay}
          supplyRate={supplyRate}
          alertDaysError={errors.alert_days_before}
          disabled={isPending}
        />
      </>
    ) : null;

  const simpleMedicationFields = (
    <div className="flex flex-col gap-6" data-testid="simple-medication-form" data-large-text={largeText}>
      <section
        aria-labelledby="sf-what"
        className="flex flex-col gap-3"
        onBlur={() => {
          if (title.trim()) completeStep('what');
        }}
      >
        {firstRun ? (
          // First-run mode: the dialog's own big title ("What does Mom take?") is the
          // heading, so this one stays for assistive tech only.
          <span id="sf-what" className="sr-only">
            {t('addEvent.simple.whatIsIt')}
          </span>
        ) : (
          sectionHeading('sf-what', t('addEvent.simple.whatIsIt'))
        )}
        <DrugAutocomplete
          id={titleFieldId}
          label={t('addEvent.fields.medicationName')}
          required
          value={title}
          maxLength={150}
          error={errors[titleFieldId] ?? errors.title ?? missingErrorFor('title')}
          placeholder={t('addEvent.placeholders.medicationName')}
          selectedDrug={selectedDrug}
          onSelectDrug={(drug) => {
            if (drug) usedAsTypedRef.current = false;
            setSelectedDrug(drug);
          }}
          onUseAsTyped={() => {
            usedAsTypedRef.current = true;
          }}
          onChange={(next) => {
            usedAsTypedRef.current = false;
            setTitle(next);
            clearError(titleFieldId, 'title');
          }}
        />
        {/* The dose on its own full-width line under the name (long drug names, owner 2026-11-10). */}
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
      </section>

      <section aria-labelledby="sf-when" className="flex flex-col gap-3">
        {sectionHeading('sf-when', t('addEvent.simple.when'), true)}
        {/* As needed has no start, end or time (the server pins it): the tiles go, How often? stays. */}
        {!isAsNeeded && whenDateTiles}
        {/* Every day / Every week / When needed / Custom… (Once and the rarer repeats). Scheduled <-> as
            needed is locked after create (the server refuses it): an edit of a scheduled medication never
            offers "When needed"; an as-needed one shows it lit and the whole choice disabled. */}
        {howOftenGrid(
          [
            { value: 'daily', label: t('addEvent.simple.everyDay') },
            { value: 'weekly', label: t('addEvent.simple.everyWeek') },
            ...(isEditing && !isAsNeededEdit
              ? []
              : [{ value: 'as_needed', label: t('addEvent.simple.whenNeeded') }]),
          ],
          // "Once" (a one-off dose) has no tile of its own on a medication: it lives behind Custom….
          [{ value: 'none', label: t('addEvent.simple.once') }, ...sharedCustomRepeatOptions],
          isAsNeededEdit
        )}
        {isAsNeededEdit && (
          <p className="m-0 text-sm text-ink-2" data-testid="as-needed-locked-how-often">
            {t('addEvent.asNeeded.lockedRepeat')}
          </p>
        )}
        {asNeededReasonBlock}
      </section>

      {!isAsNeeded && (
        <section aria-labelledby="sf-what-time" className="flex flex-col gap-3">
          {/* Design B: the hint sits 3px under the question (the section's gap follows it). */}
          <div>
            {sectionHeading('sf-what-time', t('addEvent.simple.whatTime'))}
            {doseTimesHint && (
              <p id="time-chips-hint" data-testid="dose-times-hint" className="m-0 mt-[3px] text-sm leading-[21px] text-ink-3">
                {doseTimesHint}
              </p>
            )}
          </div>
          <TimeChips
            id="time-chips"
            values={doseRecipientTimes}
            hourCycle={hourCycle}
            multiple={!isEditing}
            full={doseTimesFull}
            describedBy={
              [
                doseTimesHint ? 'time-chips-hint' : '',
                timeErrorText ? 'scheduled_time-error' : '',
                zoneCaption ? 'time-zone-caption' : '',
              ]
                .filter(Boolean)
                .join(' ') || undefined
            }
            onToggle={toggleDoseChip}
            onChangeCustom={changeDoseTime}
            onRemoveCustom={removeDose}
            heldValue={shownDuplicate ?? undefined}
            other={
              <PickerTile
                kind="time"
                inputId="scheduled_time"
                inputLabel={t('addEvent.simple.otherTime')}
                testId="time-chip-other"
                value={otherTimeValue}
                disabled={doseTimesFull}
                onOpen={openOtherTime}
                onChange={chooseOtherTime}
                className={`${choiceTileClass(false)}${doseTimesFull ? ' cursor-default opacity-50' : ' cursor-pointer'}`}
              >
                <span className={CHOICE_TILE_LABEL}>{t('addEvent.simple.otherEllipsis')}</span>
                {/* An empty second line: "Other…" is as tall as the two-line chips at every text size. */}
                <span aria-hidden="true" className={`${choiceTileSubClass(false)} invisible`}>
                  {' '}
                </span>
              </PickerTile>
            }
          />
          {timeErrorText && (
            <p id="scheduled_time-error" role="alert" className={INPUT_ERROR}>
              <Icon name="alert-circle-outline" size="inline" />
              {timeErrorText}
            </p>
          )}
          <DoseSummaryLine
            text={doseSummaryText}
            note={doseSummaryNote?.text ?? null}
            announceNote={!!doseSummaryNote?.announce}
          />
          <DoseDuplicateNote time={shownDuplicate ? clockText(shownDuplicate.time) : null} />
          <DoseQuietHoursNote
            applies={isMedication && notificationsEnabled && reminderAtDue}
            dateStr={dateStr}
            timeStr={timeStr}
            heldInstant={heldInstant}
            members={members}
            ownerId={circle?.owner_id}
          />
          {/* The extra doses' own quiet-hours notes (each is its own medication row, saved after the primary). */}
          {extraTimes.map((time, index) => (
            <div key={index} data-testid={`extra-dose-${index + 1}`} className="contents">
              <DoseQuietHoursNote
                applies={isMedication && notificationsEnabled && reminderAtDue}
                dateStr={dateStr}
                timeStr={time}
                members={members}
                ownerId={circle?.owner_id}
              />
            </div>
          ))}
          {/* ONE past-time note for all the doses, naming the times (owner 2026-11-11: it was repeated per dose). */}
          <DosePastTimeNote
            visible={pastDoseClocks.length > 0}
            times={listText(pastDoseClocks.map(clockText))}
            count={pastDoseClocks.length}
          />
          {zoneCaptionLine}
        </section>
      )}

      {remindersSummaryRow}
      <DisclosureRow
        id="more-details"
        title={t('addEvent.simple.moreDetails')}
        summary={t('addEvent.simple.moreDetailsSummary')}
        wrapSummary
        open={moreOpen}
        onToggle={setMoreOpen}
      >
        {medicationExtraFields}
        {detailsBlock}
        {/* The Reminders card lives in the summary row's accordion above; an as-needed medication has none. */}
        {asNeededNoRemindersNote}
      </DisclosureRow>
    </div>
  );

  // The To on the CIRCLE's clock; at or before From (on that same clock: the tiles' frame) it is the next day
  // (the save's PK21 rule). Both start at From + 30; the task's To is OPTIONAL (owner 2026-11-10): its "×"
  // clears it, and the tile then reads "No end".
  const toTileText = recipientEndClock
    ? `${clockText(recipientEndClock)}${recipientClock && recipientEndClock <= recipientClock ? ` ${t('shifts:nextDay')}` : ''}`
    : simpleKind === 'task'
      ? t('addEvent.simple.noEnd')
      : t('shifts:form.chooseTime');
  const fromToTiles = (testIdPrefix: 'appt' | 'task'): ReactElement => (
    <div className="grid grid-cols-2 gap-2" data-testid={`${testIdPrefix}-from-to`}>
      {startTimeTile(t('addEvent.simple.from'), `${testIdPrefix}-from-tile`)}
      <div className="flex min-w-0 flex-col gap-1">
        {valueTile({
          kind: 'time',
          inputId: 'endTime',
          label: t('addEvent.simple.to'),
          testId: `${testIdPrefix}-to-tile`,
          value: recipientEndClock,
          display: toTileText,
          disabled: !timeStr,
          invalid: !!errors.endTime,
          describedBy: errors.endTime ? 'endTime-error' : undefined,
          // The task's To is optional ("9:30 AM ×", × back to "No end"); the appointment's is required (no ×).
          clear: simpleKind === 'task' ? t('addEvent.simple.clearEndTime') : undefined,
          onChange: chooseRecipientEndTime,
        })}
        {fieldError('endTime', errors.endTime)}
      </div>
    </div>
  );
  const simpleAppointmentFields = (
    <div className="flex flex-col gap-6" data-testid="simple-appointment-form" data-large-text={largeText}>
      <section
        aria-labelledby="sf-what"
        className="flex flex-col gap-3"
        onBlur={() => {
          if (title.trim()) completeStep('what');
        }}
      >
        {sectionHeading('sf-what', t('addEvent.simple.whatIsIt'))}
        <TextField
          id={titleFieldId}
          label={t('addEvent.fields.title')}
          required
          value={title}
          maxLength={150}
          error={errors[titleFieldId] ?? errors.title ?? missingErrorFor('title')}
          placeholder={t('addEvent.placeholders.appointmentTitle')}
          onChange={(e) => {
            setTitle(e.target.value);
            clearError(titleFieldId, 'title');
          }}
        />
        {/* At most 3, on a NEW appointment, only while the title is empty (the task form's rule). */}
        {!isEditing && title.trim() === '' && titleSuggestions.length > 0 && (
          <ChipSelect
            id="title-suggestions"
            label={t('addEvent.titleSuggestions.label')}
            options={titleSuggestions.slice(0, 3)}
            value={title}
            onChange={(next) => {
              setTitle(next ?? '');
              if (next) {
                clearError(titleFieldId, 'title');
                completeStep('what');
              }
            }}
          />
        )}
      </section>

      <section aria-labelledby="sf-when" className="flex flex-col gap-3">
        {sectionHeading('sf-when', t('addEvent.simple.when'), true)}
        {whenDateTiles}
        {howOftenGrid(
          [
            { value: 'none', label: t('addEvent.simple.once') },
            { value: 'daily', label: t('addEvent.simple.everyDay') },
            { value: 'weekly', label: t('addEvent.simple.everyWeek') },
          ],
          sharedCustomRepeatOptions,
          false
        )}
      </section>

      <section aria-labelledby="sf-what-time" className="flex flex-col gap-3">
        {sectionHeading('sf-what-time', t('addEvent.simple.whatTime'))}
        {timeChoice('appt-time')}
        {showTaskTimeField && fromToTiles('appt')}
        {zoneCaptionLine}
      </section>

      <section aria-labelledby="sf-who" className="flex flex-col gap-3">
        {sectionHeading('sf-who', t('addEvent.simple.whoIsGoing'))}
        {/* The task's "Who's doing it?" tiles: Anyone, Me (the signed-in member), then every other member. */}
        <ChipSelect
          id="assigned_to"
          label={t('addEvent.simple.whoIsGoing')}
          variant="tile"
          allowDeselect={false}
          options={taskWhoOptions}
          value={assignedTo ?? ''}
          onChange={(next) => {
            setAssignedTo(next || null);
            completeStep('who');
          }}
        />
      </section>

      {remindersSummaryRow}
      <DisclosureRow
        id="more-details"
        title={t('addEvent.simple.moreDetails')}
        summary={t('addEvent.simple.apptMoreHint')}
        wrapSummary
        open={moreOpen}
        onToggle={setMoreOpen}
      >
        <DoctorField
          circleId={circleId}
          value={providerId}
          storedValue={isEditing ? storedProviderId : null}
          appliesToSeries={isRecurringEdit}
          busy={isPending}
          onChange={(id, provider) => {
            setProviderId(id);
            chooseDoctorLocation(provider);
          }}
        />
        <TextField
          id="location"
          label={t('addEvent.fields.location')}
          value={location}
          maxLength={250}
          error={errors.location}
          hint={
            locationFilledFrom
              ? t('addEvent.doctor.filledFrom', { name: locationFilledFrom })
              : undefined
          }
          placeholder={t('addEvent.placeholders.location')}
          onChange={(e) => {
            setLocation(e.target.value);
            setLocationFilledFrom(null);
            clearError('location');
          }}
        />
        {detailsBlock}
      </DisclosureRow>
    </div>
  );

  // ── SIMPLE TASK FORM (owner 1.4.0, mobile parity: AddEventScreen; build 11 order) ───────────────────
  // "What needs doing? / When? / What time? / Who's doing it? / Reminders / More details". Every day it names is
  // the RECIPIENT's (the Starts and Repeats until tiles), and its time is on the recipient's clock (the At tile),
  // so nothing on it is in the viewer's frame except the zone caption. Same state and payload as the full form
  // (AddEventModal.taskPayloadEquality pins it).
  const taskHowOftenValue = ['none', 'daily', 'weekly'].includes(recurrence) ? recurrence : null;
  // The rarer rules live behind "Custom…" (shift form parity); the panel is open while one is the answer.
  const taskCustomOptions = [
    { value: 'every_other_day', label: t('addEvent.simple.everyOtherDay') },
    { value: 'cycle', label: t('addEvent.simple.daysOnOff') },
    { value: 'days_of_week', label: t('addEvent.simple.someDays') },
    { value: 'monthly', label: t('addEvent.simple.monthly') },
    { value: 'yearly', label: t('addEvent.simple.yearly') },
  ];
  const taskCustomSelected = taskCustomOptions.some((o) => o.value === recurrence);
  const taskCustomShown = taskCustomOpen || taskCustomSelected;
  const pickTaskRepeat = (next: string | null): void => {
    if (!next) return;
    chooseRecurrence(next as RecurrenceChoice);
    completeStep('how_often');
  };
  const simpleTaskFields = (
    <div className="flex flex-col gap-6" data-testid="simple-task-form">
      <section
        aria-labelledby="sf-what"
        className="flex flex-col gap-3"
        onBlur={() => {
          if (title.trim()) completeStep('what');
        }}
      >
        {sectionHeading('sf-what', t('addEvent.simple.whatNeedsDoing'))}
        <TextField
          id={titleFieldId}
          label={t('addEvent.fields.title')}
          required
          value={title}
          maxLength={150}
          error={errors[titleFieldId] ?? errors.title ?? missingErrorFor('title')}
          placeholder={t('addEvent.placeholders.taskTitle')}
          onChange={(e) => {
            setTitle(e.target.value);
            clearError(titleFieldId, 'title');
          }}
        />
        {!isEditing && title.trim() === '' && titleSuggestions.length > 0 && (
          <ChipSelect
            id="title-suggestions"
            label={t('addEvent.titleSuggestions.label')}
            options={titleSuggestions.slice(0, 3)}
            value={title}
            onChange={(next) => {
              setTitle(next ?? '');
              if (next) {
                clearError(titleFieldId, 'title');
                completeStep('what');
              }
            }}
          />
        )}
      </section>

      <section aria-labelledby="sf-when" className="flex flex-col gap-3">
        {sectionHeading('sf-when', t('addEvent.simple.when'), true)}
        {whenDateTiles}
        <div className="grid grid-cols-2 gap-2 [&_[role=radio]]:w-full [&>button]:w-full">
          <ChipSelect
            id="how-often"
            label={t('addEvent.simple.howOften')}
            variant="tile"
            contents
            allowDeselect={false}
            options={[
              { value: 'none', label: t('addEvent.simple.once') },
              { value: 'daily', label: t('addEvent.simple.everyDay') },
              { value: 'weekly', label: t('addEvent.simple.everyWeek') },
            ]}
            value={taskCustomSelected || unshownRuleLabel ? null : taskHowOftenValue}
            onChange={(next) => {
              pickTaskRepeat(next);
              if (next) setTaskCustomOpen(false);
            }}
          />
          <ChoiceTileButton
            testId="task-repeat-custom"
            label={t('addEvent.simple.custom')}
            selected={taskCustomSelected}
            expanded={taskCustomShown}
            onClick={() => {
              // While a custom rule is the answer the options stay open (the choice lives there).
              if (taskCustomSelected) return;
              setTaskCustomOpen(!taskCustomOpen);
            }}
          />
        </div>
        {taskCustomShown && (
          <Card
            variant="outlined"
            padding="none"
            className="flex flex-col gap-2 p-3"
            data-testid="task-repeat-custom-panel"
          >
            <Eyebrow id="sf-task-repeat-custom">{t('addEvent.simple.customHeading')}</Eyebrow>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 [&_[role=radio]]:w-full">
              <ChipSelect
                id="how-often-custom"
                label={t('addEvent.simple.customHeading')}
                variant="tile"
                contents
                allowDeselect={false}
                options={taskCustomOptions}
                value={taskCustomSelected ? recurrence : null}
                onChange={pickTaskRepeat}
              />
            </div>
          </Card>
        )}
        {/* A rule nothing names (a legacy custom:N) lights nothing and is named here. */}
        {(unshownRuleLabel || (taskHowOftenValue === null && !taskCustomSelected)) && (
          <Text variant="caption" data-testid="how-often-summary">
            {unshownRuleLabel ?? recurrenceOptions.find((o) => o.value === recurrence)?.label}
          </Text>
        )}
        {daysBlock}
        {cycleBlock}
      </section>

      <section aria-labelledby="sf-what-time" className="flex flex-col gap-3">
        {sectionHeading('sf-what-time', t('addEvent.simple.whatTime'))}
        {timeChoice('task-time')}
        {showTaskTimeField && fromToTiles('task')}
        {zoneCaptionLine}
      </section>

      <section aria-labelledby="sf-who" className="flex flex-col gap-3">
        {sectionHeading('sf-who', t('addEvent.simple.whoDoingIt'))}
        <ChipSelect
          id="assigned_to"
          label={t('addEvent.simple.whoDoingIt')}
          variant="tile"
          allowDeselect={false}
          options={taskWhoOptions}
          value={assignedTo ?? ''}
          onChange={(next) => {
            setAssignedTo(next || null);
            completeStep('who');
          }}
        />
      </section>

      {remindersSummaryRow}
      <DisclosureRow
        id="more-details"
        title={t('addEvent.simple.moreDetails')}
        summary={t('addEvent.simple.taskMoreHint')}
        wrapSummary
        open={moreOpen}
        onToggle={setMoreOpen}
      >
        {detailsBlock}
      </DisclosureRow>
    </div>
  );

  const simpleFields =
    simpleKind === 'medication'
      ? simpleMedicationFields
      : simpleKind === 'task'
        ? simpleTaskFields
        : simpleAppointmentFields;


  return (
    <>
    <Modal
      title={
        isEditing
          ? simpleKind === 'medication'
            ? t('addEvent.simple.editMedication')
            : simpleKind === 'appointment'
              ? t('addEvent.simple.editAppointment')
              : simpleKind === 'task'
                ? t('addEvent.simple.edit.task')
                : t('addEvent.editTitle')
          : simpleKind === 'medication'
            ? t('addEvent.simple.newMedication')
            : simpleKind === 'appointment'
              ? t('addEvent.simple.newAppointment')
              : simpleKind === 'task'
                ? t('addEvent.simple.new.task')
                : t('addEvent.newTitle')
      }
      hideTitle={firstRun}
      onClose={handleClose}
      closeLabel={t('addEvent.close')}
      size="lg"
      closeOnBackdropClick={false}
      footer={
        <>
          {showSeriesEditNote && (
            <Text
              variant="caption"
              id="series-edit-note"
              data-testid="series-edit-note"
              className="mr-auto self-center"
            >
              {seriesEditNoteText}
            </Text>
          )}
          <Button
            variant="secondary"
            onClick={handleClose}
            disabled={isPending}
            data-testid={firstRun ? 'first-run-skip' : undefined}
          >
            {firstRun ? t('addEvent.firstRun.skip') : t('common:cancel')}
          </Button>
          {/* Save is always the solid primary button. With a required field
              missing a press does not save: it cancels the submit, focuses the
              field and shows its inline error (`focusMissingField`). It is
              truly `disabled` only while the zone / series root is still
              loading (nothing to point at), and `loading` (save in flight)
              disables it as before. */}
          <Button
            type="submit"
            offlineKind="save"
            form="add-event-form"
            loading={isPending}
            disabled={setupBlocked}
            onClick={
              !requiredFilled
                ? (event) => {
                    event.preventDefault();
                    focusMissingField();
                  }
                : undefined
            }
            data-testid="add-event-save"
            // Same 1.5px edge as the secondary beside it (transparent), so the pair is one height.
            className="border-[1.5px] border-transparent"
          >
            {isEditing
              ? t('addEvent.saveChanges')
              : simpleKind === 'medication'
                ? t('addEvent.simple.addMedication')
                : simpleKind === 'appointment'
                  ? t('addEvent.simple.addAppointment')
                  : simpleKind === 'task'
                    ? t('addEvent.simple.addTask')
                    : t('addEvent.create')}
          </Button>
        </>
      }
    >
      <form
        id="add-event-form"
        onSubmit={guardedSubmit}
        className="flex flex-col gap-4"
        noValidate
        aria-describedby={showSeriesEditNote ? 'series-edit-note' : undefined}
      >
        {firstRun && (
          <header className="flex flex-col gap-1.5" data-testid="first-run-form-heading">
            <Eyebrow>
              {circle?.is_self_care
                ? t('addEvent.firstRun.eyebrowSelf')
                : t('addEvent.firstRun.eyebrow', {
                    name: (circle?.recipient_name ?? '').toLocaleUpperCase(i18n.language),
                  })}
            </Eyebrow>
            <Text variant="h2" as="h3">
              {circle?.is_self_care
                ? t('addEvent.firstRun.titleSelf')
                : t('addEvent.firstRun.title', { name: circle?.recipient_name ?? '' })}
            </Text>
            <Text variant="caption">{t('addEvent.firstRun.hint')}</Text>
          </header>
        )}
        {simpleFields}
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
        offlineKind="save"
        icon="time-outline"
        iconTone="clay"
        title={t('addEvent.alerts.pastTimeEditTitle')}
        message={t('addEvent.alerts.pastTimeEditMessage')}
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
        onCancel={() => {
          // A cancel, not a failure (mobile parity): the user chose not to save.
          Analytics.entryValidationBlocked('past_time_cancelled', eventType);
          setPendingPastTime(null);
        }}
      />
    )}
    </>
  );
}

type AbandonField = 'name' | 'dosage' | 'time' | 'repeat' | 'more_details' | 'none';

/** Record `field` in `ref` whenever `value` changes after the first render. */
function useNoteFieldChange<R extends string>(
  ref: { current: R },
  value: unknown,
  field: R
): void {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    ref.current = field;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `value` is the trigger
  }, [value]);
}

/**
 * Why `buildPayload` refused, as an `entry_validation_blocked.reason`. The
 * first four mirror mobile's values; `invalid_field` is the Zod-schema catch-all
 * (a value too long, a malformed field, no days chosen) that mobile has no
 * reason for.
 */
function validationReason(input: {
  hasTitle: boolean;
  isMedication: boolean;
  hasTime: boolean;
  hasEndTime: boolean;
  errors: FieldErrors;
}):
  | 'missing_name'
  | 'missing_time'
  | 'missing_end_time'
  | 'end_time_after_start'
  | 'invalid_field' {
  if (!input.hasTitle) return 'missing_name';
  if (input.isMedication && input.errors.scheduled_time) return 'missing_time';
  if (!input.isMedication && input.errors.endTime) {
    return input.hasTime && !input.hasEndTime ? 'missing_end_time' : 'end_time_after_start';
  }
  return 'invalid_field';
}

/** Type-aware create-success toast key, falling back to the generic one. */
/**
 * Did the circle have NO medication before this save, according to the presence answer Today's
 * next-step card already cached (same query, same window)? A cold or unknown cache answers
 * false: an unknown never writes Today's Mark it note. Cache read only, no fetching.
 */
function circleHadNoMedication(circleId: string, today: string): boolean {
  const cached = queryClient.getQueryData<EventsPresence | null>(
    queryKeys.calendarEventsPresence(circleId, {
      start_date: addDays(today, -30),
      end_date: addDays(today, 180),
    })
  );
  return !!cached && cached.medication === false;
}

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
    case 'days_of_week':
      return 'daysOfWeek';
    case 'as_needed':
      return 'asNeeded';
    default:
      return choice;
  }
}
