import { useMemo, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { CircleMember } from '@/api/circleMembers';
import { Badge, Card, Eyebrow, Modal, Text } from '@/components/ui';
import { useHourCycle } from '@/hooks/useHourCycle';
import { formatEventTimeForDisplay, getDateInTimezone, zoneReferenceInstant } from '@/utils/timezone';
import { formatDateForDisplay, formatTimestampInTimezone } from './dateMath';
import {
  EVENT_TYPE_BLOCK_CLASS,
  getMedicationStatus,
  isInactiveMedication,
} from './eventStyles';
import { formatRecurrenceLabel } from './recurrenceLabel';
import { EventNotesPanel } from './EventNotesPanel';

/** The section-color eyebrow accent per event type (matches `Eyebrow`'s palette). */
const EVENT_TYPE_EYEBROW_COLOR = {
  medication: 'clay',
  appointment: 'dusk',
  task: 'moss',
} as const;

function memberDisplayName(member: CircleMember): string {
  return [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email;
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
  const { t, i18n } = useTranslation(['calendar', 'common']);
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
  const dateLabel = formatDateForDisplay(event.scheduled_date, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const timeLabel = event.scheduled_time
    ? formatEventTimeForDisplay(
        event.scheduled_time,
        careRecipientTimezone,
        undefined,
        // The event's OWN day governs both halves: whether a second time is
        // shown at all, and what that time says. Passing `undefined` judged the
        // first at today and converted at today too.
        zoneReferenceInstant(event.scheduled_date),
        hourCycle
      )
    : t('calendar:allDay');

  const recurrenceLabel = formatRecurrenceLabel(event, t);

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

  // Who a TASK is assigned to (mobile `TaskDetailSheet.tsx:323-334`; tasks
  // only — appointments/medications have no assignee row on either
  // surface). Same embed-then-roster-then-fallback shape as `completedByName`
  // above; unlike completion, an unassigned task still gets a row rather than
  // omitting it, so the fallback is the shared "Unassigned" label rather than
  // `null`.
  const assignedToName = useMemo(() => {
    if (event.event_type !== 'task') return null;
    const embedded = event.assigned_to_user;
    if (embedded) {
      const name = [embedded.first_name, embedded.last_name].filter(Boolean).join(' ');
      if (name) return name;
      if (embedded.email) return embedded.email;
    }
    const member = event.assigned_to
      ? (members ?? []).find((m) => m.id === event.assigned_to)
      : undefined;
    return member ? memberDisplayName(member) : null;
  }, [event.event_type, event.assigned_to_user, event.assigned_to, members]);

  const rows: Array<{ key: string; label: string; value: string }> = [
    { key: 'date', label: t('calendar:eventDetail.date'), value: dateLabel },
    { key: 'time', label: t('calendar:eventDetail.time'), value: timeLabel },
  ];
  if (event.event_type === 'task') {
    rows.push({
      key: 'assignedTo',
      label: t('calendar:eventDetail.assignedTo'),
      value: assignedToName ?? t('tasks:row.unassigned'),
    });
  }
  if (completedAtLabel) {
    rows.push(
      completedByName
        ? {
            key: 'completedBy',
            label: t('calendar:eventDetail.completedByLabel'),
            value: t('calendar:eventDetail.completedByValue', {
              name: completedByName,
              when: completedAtLabel,
            }),
          }
        : {
            key: 'completedAt',
            label: t('calendar:eventDetail.completedLabel'),
            value: completedAtLabel,
          }
    );
  }
  if (event.location) {
    rows.push({
      key: 'location',
      label: t('calendar:eventDetail.location'),
      value: event.location,
    });
  }
  if (recurrenceLabel) {
    rows.push({ key: 'repeats', label: t('calendar:eventDetail.repeats'), value: recurrenceLabel });
  }
  if (statusLabel) {
    rows.push({ key: 'status', label: t('calendar:eventDetail.status'), value: statusLabel });
  }
  if (event.description) {
    // This row is the event's OWN note field, which is a DIFFERENT thing from
    // the circle-notes panel rendered below (shared, ongoing notes about the
    // care recipient) — that panel has its own "Notes" heading, so this row
    // must never also say "Notes", for ANY event type, or the dialog shows
    // two "Notes" headings. A medication's own note is its dosing
    // INSTRUCTIONS; a task/appointment's is just its DETAILS.
    rows.push({
      key: 'notes',
      label:
        event.event_type === 'medication'
          ? t('calendar:eventDetail.instructions')
          : t('calendar:eventDetail.details'),
      value: event.description,
    });
  }

  // Name-first header: the entity name is the primary display (inherits the
  // Modal h2's tight semibold treatment — no serif face any more, spec §3.1),
  // with the type as a refined eyebrow accent beneath
  // — a small type-colored dot + uppercase mono label in the deep type color
  // (WCAG AA on cream). The dosage trails as a quiet inline detail. The
  // type-colored rail anchors the whole block to mobile's color-forward
  // type vocabulary.
  const titleContent = (
    <span className="flex items-stretch gap-3.5">
      <span
        aria-hidden="true"
        className={`w-1 shrink-0 self-stretch rounded-full ${EVENT_TYPE_BLOCK_CLASS[event.event_type]}`}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="block break-words leading-tight">
          {title}
          {dosage ? (
            <span className="ml-2 align-baseline font-sans text-base font-normal text-ink-3">
              {dosage}
            </span>
          ) : null}
        </span>
        {/* Type eyebrow: shared `Eyebrow` component, dot + label in the type
            color (spec §6.4 "the type eyebrow uses Eyebrow dot"). */}
        <Eyebrow dot color={EVENT_TYPE_EYEBROW_COLOR[event.event_type]}>
          {t(`calendar:eventTypes.${event.event_type}`)}
        </Eyebrow>
        {isInactiveMed && (
          <Badge variant="default" className="self-start">
            {t('calendar:discontinueMed.inactiveBadge')}
          </Badge>
        )}
      </span>
    </span>
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
      title={titleContent}
      onClose={onClose}
      closeLabel={t('calendar:eventDetail.close')}
      footer={footer}
    >
      <dl className="m-0 flex flex-col gap-4">
        {rows.map((row) => (
          <div key={row.key}>
            <Text variant="label" as="dt">
              {row.label}
            </Text>
            <dd className="m-0 mt-1 whitespace-pre-wrap break-words text-base text-ink">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

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

      {/* Event-notes panel (Task 1.8) — instance-scoped. For a recurring/virtual
          instance we pass scheduled_date so the backend materializes the right
          row; for a plain event the bare id is enough. */}
      <div className="border-t border-line-2 pt-4">
        <EventNotesPanel
          circleId={circleId ?? event.circle_id}
          eventId={event.id}
          scheduledDate={
            event.is_virtual || event.parent_event_id ? event.scheduled_date : undefined
          }
        />
      </div>
    </Modal>
  );
}
