import { useMemo, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { shiftTaskMeta } from '@/components/shifts/shiftTasks';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { CircleMember } from '@/api/circleMembers';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { isPlainLeftClick, readFromProviderId } from '@/lib/stackLoop';
import { MapsLink } from '@/components/MapsLink';
import { Badge, Card, Eyebrow, Modal } from '@/components/ui';
import { DetailCard, DetailField, DetailSection, PersonChip } from '@/components/ui/DetailCard';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { useSeriesRoot } from '@/hooks/useSeriesRoot';
import { useHourCycle } from '@/hooks/useHourCycle';
import { useProviders } from '@/hooks/useProviders';
import { formatEventTimeForDisplay, getDateInTimezone } from '@/utils/timezone';
import { formatDateForDisplay, formatTimestampInTimezone } from './dateMath';
import {
  getMedicationStatus,
  hidesUnloggedDoseTime,
  isInactiveMedication,
} from './eventStyles';
import { formatRecurrenceLabel } from './recurrenceLabel';
import { EventNotesPanel } from './EventNotesPanel';
import { EntrySourceNote } from './EntrySourceNote';

/** The section-color eyebrow accent per event type (matches `Eyebrow`'s palette). */
const EVENT_TYPE_EYEBROW_COLOR = {
  medication: 'clay',
  appointment: 'dusk',
  task: 'moss',
  shift: 'moss',
} as const;

function memberDisplayName(member: CircleMember): string {
  return [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email;
}

/** Titles longer than this step down from the large title size (the shift detail's rule). */
const LONG_TITLE_CHARS = 14;

type RuleSource = Pick<CalendarEvent, 'recurrence_rule' | 'recurrence_days'>;

/**
 * Whether the row on screen cannot say how its series repeats by itself. A MATERIALIZED CHILD
 * (`parent_event_id` set, one row per day) stores `recurrence_rule = NULL` — the rule lives on the
 * series root only (see the recurring-instances architecture) — so a daily medication's dose or a
 * daily task's occurrence read as a one-off: no Repeats at all. A VIRTUAL instance carries the
 * root's rule but never its `recurrence_days`, so a weekly one lost its day names.
 */
export function needsSeriesRule(event: CalendarEvent): boolean {
  if (!event.parent_event_id) return false;
  if (!event.recurrence_rule) return true;
  return event.recurrence_rule === 'weekly' && !(event.recurrence_days?.length);
}

/**
 * Resolves the SERIES ROOT's rule for an occurrence (`useSeriesRoot`: the root already in the
 * calendar cache, else one narrowed GET of the existing single-event endpoint) and hands it to
 * `children`. Mounted only when `needsSeriesRule` says the row cannot answer for itself, so a
 * one-off or a root never touches React Query. Until the root is known (or if it fails) the row's
 * own rule is used, which is what the detail showed before.
 */
function SeriesRuleResolver({
  circleId,
  event,
  children,
}: {
  circleId: string;
  event: CalendarEvent;
  children: (source: RuleSource) => ReactElement;
}): ReactElement {
  // The calendar windows already in the cache (what `useCachedCircleEvents` reads), narrowed to the
  // one row wanted: the root of THIS occurrence.
  const queryClient = useQueryClient();
  const cachedRoot = useMemo(() => {
    for (const [, data] of queryClient.getQueriesData<CalendarEvent[]>({
      queryKey: queryKeys.calendarEvents(circleId),
    })) {
      if (!Array.isArray(data)) continue;
      const hit = data.find((e) => e?.id === event.parent_event_id && !e.parent_event_id && !e.is_virtual);
      if (hit) return [hit];
    }
    return [];
  }, [queryClient, circleId, event.parent_event_id]);
  const { root } = useSeriesRoot(circleId, event, cachedRoot);
  return children(root && root.recurrence_rule ? root : event);
}

/**
 * "Dr. Patel · See all visits": the appointment's doctor, linking to that
 * doctor's Visits & notes page (docs/plans/notes-by-doctor.md flow 2b). The name
 * is resolved from the circle's doctors INCLUDING removed ones, so a doctor
 * removed since the link still reads "Dr. Patel (removed)". While the name is
 * unknown the link stands alone as "See all visits" (the id is enough to go).
 */
function EventDoctorLink({
  circleId,
  providerId,
  eventId,
  eventDate,
}: {
  circleId: string;
  providerId: string;
  eventId: string;
  eventDate: string;
}): ReactElement {
  const { t } = useTranslation(['calendar', 'emergency']);
  const location = useLocation();
  const navigate = useNavigate();
  // Reached from this very doctor's Visits & notes? "See all visits" is Back, not another push.
  const cameFromThisDoctor = readFromProviderId(location.state) === providerId;
  const { providers } = useProviders(circleId, { includeArchived: true });
  const provider = providers.find((p) => p.id === providerId);
  const name = provider
    ? provider.archived_at
      ? t('emergency:providers.removedName', { name: provider.name })
      : provider.name
    : null;
  const seeAll = t('calendar:eventDetail.seeAllVisits');
  return (
    <Link
      to={`/circles/${circleId}/providers/${encodeURIComponent(providerId)}`}
      state={{ source: 'appointment', fromEvent: { id: eventId, date: eventDate } }}
      onClick={(e) => {
        if (!cameFromThisDoctor || !isPlainLeftClick(e)) return;
        e.preventDefault();
        navigate(-1);
      }}
      className="inline-flex min-h-[44px] items-center gap-1.5 font-medium text-ink underline underline-offset-2"
    >
      {name ? `${name} · ${seeAll}` : seeAll}
    </Link>
  );
}

export interface EventDetailModalProps {
  event: CalendarEvent;
  careRecipientTimezone: string;
  onClose: () => void;
  /**
   * When true, `editActions` renders in the footer slot (future write
   * features). Currently always false on web → "Download the app to edit" CTA.
   */
  canEdit?: boolean;
  editActions?: ReactNode;
  /**
   * Circle the event belongs to. When provided, the event-notes panel (Task
   * 1.8) is mounted in the body. Falls back to `event.circle_id` so callers
   * that don't pass it still get notes.
   */
  circleId?: string;
  /**
   * Circle roster — used ONLY to attribute a completed task's "Completed by"
   * row when the event has no embedded `completed_by_user` (the calendar GET
   * never embeds it; only the tasks endpoint does — see
   * `CalendarEvent.completed_by_user`). Optional: a caller that omits it still
   * gets the row whenever the embed IS present, and otherwise falls back to an
   * unattributed "Completed on" line rather than an empty name.
   */
  members?: CircleMember[];
}

/**
 * Read-only event detail modal (plan Task 20): title, type badge, date + time
 * in the care recipient's timezone, notes, human-readable recurrence, and
 * medication confirmation status. Footer is a slot: edit buttons when
 * `canEdit` (future), otherwise the download-app CTA.
 *
 * Accessibility: role="dialog" + aria-modal, focus moves to the close button
 * on open, Tab is trapped, Escape closes, focus returns to the trigger.
 */
export function EventDetailModal({
  event,
  careRecipientTimezone,
  onClose,
  canEdit = false,
  editActions,
  circleId,
  members,
}: EventDetailModalProps): ReactElement {
  const { t, i18n } = useTranslation(['calendar', 'common', 'shifts']);
  const locale = i18n.language;
  // Viewer's 12h/24h clock — every rendered time goes through it.
  const hourCycle = useHourCycle();

  const title = event.medication_name || event.title;
  const dosage = event.event_type === 'medication' ? event.medication_dosage : null;
  // A discontinued (inactivated) medication keeps its record but stops firing.
  // This fires from BOTH surfaces now: the medication roster (which asks for
  // discontinued rows explicitly) AND the calendar, whose GET returns every
  // occurrence that was due BEFORE the discontinue instant. Those historical
  // doses keep their confirmation status — the badge below (plus the note in
  // the body) is a TEXT cue, never a color-only one.
  const isInactiveMed = isInactiveMedication(event);

  // scheduled_date is a NAIVE date in the care recipient's timezone — format
  // via the UTC-noon pattern, never new Date(scheduled_date) device-local.
  // Short, like the shift detail ("Fri, Jun 12"); the year only when it is not the recipient's
  // current one, so a past or far-future row is never mistaken for this year's.
  const sameYear =
    event.scheduled_date.slice(0, 4) === getDateInTimezone(careRecipientTimezone).slice(0, 4);
  const dateLabel = formatDateForDisplay(event.scheduled_date, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' as const }),
  });

  const timeLabel = event.scheduled_time
    ? formatEventTimeForDisplay(
        event.scheduled_time,
        careRecipientTimezone,
        undefined,
        // The event's OWN day governs both halves: whether a second time is
        // shown at all, and what that time says. Passing `undefined` judged the
        // first at today and converted at today too. The DAY itself, so the
        // viewer half names its weekday when it falls on another calendar day.
        event.scheduled_date,
        hourCycle
      )
    : t('calendar:allDay');

  const medStatus = getMedicationStatus(event, careRecipientTimezone);
  let statusLabel: string | null = null;
  if (medStatus) {
    const confirmation = event.confirmation;
    if (confirmation) {
      const confirmedTime = formatTimestampInTimezone(
        confirmation.confirmed_at,
        careRecipientTimezone,
        locale,
        // The viewer's resolved 12h/24h clock, like every other time on this
        // screen — not whatever the display locale happens to imply.
        hourCycle
      );
      statusLabel =
        confirmation.status === 'taken'
          ? t('calendar:eventDetail.takenAt', { time: confirmedTime })
          : confirmation.status === 'taken_late'
            ? t('calendar:eventDetail.takenLateAt', { time: confirmedTime })
            : confirmation.status === 'skipped'
              ? t('calendar:eventDetail.skippedAt', { time: confirmedTime })
              : t('calendar:eventDetail.missed');
    } else {
      statusLabel = t(`calendar:status.${medStatus}`);
    }
  }

  // Who completed the task, and when — mirrors `TaskDetailModal`'s fallback
  // chain exactly (Task 16 deletes that modal and routes completed tasks
  // here instead, so the two must agree). The embedded `completed_by_user`
  // only ever arrives from the tasks endpoint; a task opened from the
  // calendar has `completed_at` + `completed_by` (an id) and no embed, so the
  // circle roster is the fallback, then an unattributed "Completed on" line.
  //
  // Review 2026-09-05: backend/src/routes/calendarEvents.ts `listSelect`
  // (~line 1259) selects `completed_at` only — no `completed_by` /
  // `completed_by_user` at all — so a Calendar-opened completed task ALWAYS
  // takes the roster-or-unattributed path below; only the Tasks page (which
  // fetches the tasks endpoint's `completed_by_user`-embedding rows) ever
  // exercises the embedded branch. This is accepted, not a bug to fix here.
  const completedByName = useMemo(() => {
    const embedded = event.completed_by_user;
    if (embedded) {
      const name = [embedded.first_name, embedded.last_name].filter(Boolean).join(' ');
      if (name) return name;
      if (embedded.email) return embedded.email;
    }
    const member = event.completed_by
      ? (members ?? []).find((m) => m.id === event.completed_by)
      : undefined;
    return member ? memberDisplayName(member) : null;
  }, [event.completed_by_user, event.completed_by, members]);

  const completedAtLabel = useMemo(() => {
    if (!event.completed_at) return null;
    const at = new Date(event.completed_at);
    if (Number.isNaN(at.getTime())) return null;
    // The calendar DAY of the instant, in the recipient's timezone — then
    // formatted through the same UTC-noon renderer every naive date uses.
    const dayInTz = getDateInTimezone(careRecipientTimezone, at);
    const dateLabelForCompletion = formatDateForDisplay(
      dayInTz,
      { month: 'short', day: 'numeric', year: 'numeric' },
      locale
    );
    const timeLabelForCompletion = formatTimestampInTimezone(
      event.completed_at,
      careRecipientTimezone,
      locale,
      hourCycle
    );
    return timeLabelForCompletion
      ? `${dateLabelForCompletion}, ${timeLabelForCompletion}`
      : dateLabelForCompletion;
  }, [event.completed_at, careRecipientTimezone, locale, hourCycle]);

  // Who a TASK or APPOINTMENT is assigned to (mobile `TaskDetailSheet` for
  // tasks, the calendar detail sheet for appointments; medications have no
  // assignee row). Same embed-then-roster-then-fallback shape as
  // `completedByName` above; an unassigned TASK still gets a row (the shared
  // "Unassigned" label) while an unassigned appointment omits it, as mobile does.
  //
  // Shown as the PERSON CHIP by the title (owner design pass 2026-11-08): avatar + FIRST name, like
  // the shift detail. A medication shows one too when its row names an assignee (mobile reads the
  // same embed); it has no Unassigned fallback.
  const assignedToName = useMemo(() => {
    const embedded = event.assigned_to_user;
    if (embedded) {
      const name = embedded.first_name?.trim() || embedded.last_name?.trim();
      if (name) return name;
      if (embedded.email) return embedded.email.split('@')[0];
    }
    const member = event.assigned_to
      ? (members ?? []).find((m) => m.id === event.assigned_to)
      : undefined;
    return member ? member.first_name?.trim() || member.email.split('@')[0] : null;
  }, [event.assigned_to_user, event.assigned_to, members]);

  // Screen readers hear the FULL name on the chip (mobile parity); the chip shows the first.
  const assignedToFullName = useMemo(() => {
    const person =
      event.assigned_to_user ??
      (event.assigned_to ? (members ?? []).find((m) => m.id === event.assigned_to) : undefined);
    if (!person) return null;
    const full = [person.first_name?.trim(), person.last_name?.trim()].filter(Boolean).join(' ');
    return full || null;
  }, [event.assigned_to_user, event.assigned_to, members]);

  // WHEN = date · time in ONE cell ("Fri, Jun 12 · 8:00 AM"; "All day" with no time). A past
  // day's dose nobody answered shows the DATE alone: its virtual occurrence carries the
  // medication's CURRENT time, which after a time edit is not the time it was due
  // (`hidesUnloggedDoseTime`; 1.4.1 fixes it).
  const hideTime = hidesUnloggedDoseTime(event, careRecipientTimezone);
  const whenValue = (
    <>
      <span data-testid="event-detail-date">{dateLabel}</span>
      {hideTime ? null : (
        <>
          {' · '}
          <span data-testid="event-detail-time">{timeLabel}</span>
        </>
      )}
    </>
  );

  // The person chip: a shift task names its shift and who covers it ("Afternoons · Lucia"), a
  // task its assignee or "Unassigned", an appointment / medication its assignee when it has one.
  const shiftMeta =
    event.event_type === 'task'
      ? shiftTaskMeta(event, t as unknown as (k: string, o?: Record<string, unknown>) => string)
      : null;
  const chipName =
    shiftMeta ?? assignedToName ?? (event.event_type === 'task' ? t('tasks:row.unassigned') : null);
  const chipHasPerson = !shiftMeta && !!assignedToName;
  const chip = chipName ? (
    <PersonChip
      data-testid="event-detail-who"
      name={chipName}
      spokenName={chipHasPerson ? (assignedToFullName ?? undefined) : undefined}
      avatar={chipHasPerson}
      spokenPrefix={t('calendar:eventDetail.assignedTo')}
    />
  ) : null;

  const completedValue = completedAtLabel
    ? completedByName
      ? {
          label: t('calendar:eventDetail.completedByLabel'),
          value: t('calendar:eventDetail.completedByValue', {
            name: completedByName,
            when: completedAtLabel,
          }),
        }
      : { label: t('calendar:eventDetail.completedLabel'), value: completedAtLabel }
    : null;

  // The first row: WHEN alone, or WHEN | REPEATS side by side when the series repeats.
  const renderWhenRow = (ruleSource: RuleSource): ReactElement => {
    const repeats = formatRecurrenceLabel(ruleSource, t);
    return (
      <DetailSection columns={repeats ? 2 : 1} data-testid="event-detail-when-row">
        <DetailField
          label={t('calendar:eventDetail.when')}
          valueTestId="event-detail-when"
          valueClassName="font-medium tabular-nums"
        >
          {whenValue}
        </DetailField>
        {repeats && (
          <DetailField label={t('calendar:eventDetail.repeats')} valueTestId="event-detail-repeats">
            {repeats}
          </DetailField>
        )}
      </DetailSection>
    );
  };

  // One details card (owner design pass 2026-11-08, mock WebEvent.dc.html; the shift detail's
  // pieces): uppercase small labels, no per-row icons, each section only when it has content.
  const card = (
    <DetailCard data-testid="event-detail-card">
      {needsSeriesRule(event) ? (
        <SeriesRuleResolver circleId={circleId ?? event.circle_id} event={event}>
          {renderWhenRow}
        </SeriesRuleResolver>
      ) : (
        renderWhenRow(event)
      )}
      {event.location && (
        <DetailSection>
          <DetailField label={t('calendar:eventDetail.where')} valueTestId="event-detail-where">
            <MapsLink address={event.location} />
          </DetailField>
        </DetailSection>
      )}
      {event.event_type === 'appointment' && event.provider_id && (
        <DetailSection>
          <DetailField label={t('calendar:eventDetail.doctor')} valueTestId="event-detail-doctor">
            <EventDoctorLink
              circleId={circleId ?? event.circle_id}
              providerId={event.provider_id}
              eventId={event.id}
              eventDate={event.scheduled_date}
            />
          </DetailField>
        </DetailSection>
      )}
      {statusLabel && (
        <DetailSection>
          <DetailField label={t('calendar:eventDetail.status')} valueTestId="event-detail-status">
            {statusLabel}
          </DetailField>
        </DetailSection>
      )}
      {completedValue && (
        <DetailSection>
          <DetailField label={completedValue.label} valueTestId="event-detail-completed">
            {completedValue.value}
          </DetailField>
        </DetailSection>
      )}
      {event.description && (
        // The event's OWN note field, a DIFFERENT thing from the circle-notes panel below (shared,
        // ongoing notes), which has its own "Notes" heading — so this label is never "Notes": a
        // medication's own note is its dosing INSTRUCTIONS, a task/appointment's its DETAILS.
        <DetailSection>
          <DetailField
            label={
              event.event_type === 'medication'
                ? t('calendar:eventDetail.instructions')
                : t('calendar:eventDetail.details')
            }
            valueTestId="event-detail-description"
            valueClassName="whitespace-pre-wrap font-normal"
          >
            {event.description}
          </DetailField>
        </DetailSection>
      )}
    </DetailCard>
  );

  // Header (the shift detail's): the type eyebrow (+ Inactive badge), then the title (+ dosage)
  // and the person chip on ONE row when they fit; the chip wraps under a title that leaves no
  // room. The visible title is presentational: the dialog's sr-only <h2> (Modal `title`) names it.
  const dialogName = dosage ? `${title} ${dosage}` : title;
  const longTitle = title.length > LONG_TITLE_CHARS;
  const header = (
    <div className="flex min-w-0 flex-col gap-1.5" data-testid="event-detail-header">
      <div className="flex flex-wrap items-center gap-2">
        <Eyebrow color={EVENT_TYPE_EYEBROW_COLOR[event.event_type]}>
          {t(`calendar:eventTypes.${event.event_type}`)}
        </Eyebrow>
        {isInactiveMed && (
          <Badge variant="default" size="sm">
            {t('calendar:discontinueMed.inactiveBadge')}
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5">
        <p
          aria-hidden="true"
          data-testid="event-detail-title"
          className={`m-0 min-w-0 break-words font-semibold leading-tight text-ink ${longTitle ? 'text-lg' : 'text-xl'}`}
        >
          {title}
          {dosage ? (
            <span className="ml-2 align-baseline text-base font-normal text-ink-3">{dosage}</span>
          ) : null}
        </p>
        {chip}
      </div>
    </div>
  );

  // Footer actions slot — edit buttons slot in here when write features
  // arrive. No Done/Close button here: the Modal's × already closes this
  // read-only-or-editing view and neither branch has unsaved state to
  // protect, so a second dismiss button was redundant with it.
  const footer =
    canEdit && editActions ? (
      editActions
    ) : (
      <Card variant="filled" padding="sm" className="w-full">
        <p className="m-0 text-sm font-medium text-ink">{t('common:downloadApp.title')}</p>
        <p className="m-0 mt-1 text-sm text-ink-3">{t('common:downloadApp.subtitle')}</p>
      </Card>
    );

  return (
    <Modal
      title={dialogName}
      hideTitle
      header={header}
      onClose={onClose}
      closeLabel={t('calendar:eventDetail.close')}
      footer={footer}
    >
      {card}

      {/* Inactive medication: say in words what the header badge marks.
          Historical doses stay on the calendar with their confirmation status
          intact — that is what the note explains.

          NOTE: the action set is NOT reduced. Edit, Discontinue/Reactivate,
          Delete AND dose confirmation all still render (EventDetailActions) —
          action parity holds with the Meds roster and with mobile. Edit is not
          hidden; it redirects to the reactivate-first prompt, so the affordance
          stays discoverable and the tap has a real outcome instead of a 409.
          Mark taken / Skip dose stay live on an inactive dose on purpose: the
          calendar only shows doses the backend found due, and a dose really
          given must stay loggable or it is counted missed forever in the
          adherence report. Only the medication's own state is inactive — that
          is what the badge and this note say, in TEXT, never colour alone. */}
      {isInactiveMed && (
        <Card variant="filled" padding="sm" className="mt-4">
          <p className="m-0 text-sm text-ink-2">{t('calendar:discontinueMed.inactiveCalendarNote')}</p>
        </Card>
      )}

      {/* "Added by voice" — only for an entry saved by voice (mobile-only
          feature; the note is shown on both platforms). */}
      <EntrySourceNote event={event} className="mb-4 mt-3" />

      {/* Event-notes panel (Task 1.8) — instance-scoped. For ANY recurring row
          — a persisted child, a virtual instance, OR the series ROOT itself
          (recurrence_rule set) rendered on its own start date — we pass the
          row's own scheduled_date so the backend resolves/materializes the
          right physical row for THIS date. Passing nothing for the root was a
          proven bug (2026-09-27): the note attached directly to the root row,
          and GET always unions the root id into every date's query, so a note
          added on the series' first day leaked onto every occurrence. Only a
          genuinely non-recurring event (no recurrence_rule, no
          parent_event_id, not virtual) passes no date — the bare id is enough
          because there is no series to disambiguate within. */}
      <div className="border-t border-line-2 pt-4">
        <EventNotesPanel
          circleId={circleId ?? event.circle_id}
          eventId={event.id}
          scheduledDate={
            event.is_virtual || event.parent_event_id || event.recurrence_rule
              ? event.scheduled_date
              : undefined
          }
        />
      </div>
    </Modal>
  );
}
