import { type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import { Modal } from '@/components/ui';
import { formatEventTimeForDisplay } from '@/utils/timezone';
import { formatDateForDisplay, formatTimestampInTimezone } from './dateMath';
import { EVENT_TYPE_BLOCK_CLASS, EVENT_TYPE_DEEP_TEXT, getMedicationStatus } from './eventStyles';
import { formatRecurrenceLabel } from './recurrenceLabel';
import { EventNotesPanel } from './EventNotesPanel';

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
}: EventDetailModalProps): ReactElement {
  const { t, i18n } = useTranslation(['calendar', 'common']);
  const locale = i18n.language;

  const title = event.medication_name || event.title;
  const dosage = event.event_type === 'medication' ? event.medication_dosage : null;

  // scheduled_date is a NAIVE date in the care recipient's timezone — format
  // via the UTC-noon pattern, never new Date(scheduled_date) device-local.
  const dateLabel = formatDateForDisplay(event.scheduled_date, locale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const timeLabel = event.scheduled_time
    ? formatEventTimeForDisplay(event.scheduled_time, careRecipientTimezone)
    : t('calendar:allDay');

  const recurrenceLabel = formatRecurrenceLabel(event, t, locale);

  const medStatus = getMedicationStatus(event, careRecipientTimezone);
  let statusLabel: string | null = null;
  if (medStatus) {
    const confirmation = event.confirmation;
    if (confirmation) {
      const confirmedTime = formatTimestampInTimezone(
        confirmation.confirmed_at,
        careRecipientTimezone,
        locale
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

  const rows: Array<{ key: string; label: string; value: string }> = [
    { key: 'date', label: t('calendar:eventDetail.date'), value: dateLabel },
    { key: 'time', label: t('calendar:eventDetail.time'), value: timeLabel },
  ];
  if (event.location) {
    rows.push({ key: 'location', label: t('calendar:eventDetail.location'), value: event.location });
  }
  if (recurrenceLabel) {
    rows.push({ key: 'repeats', label: t('calendar:eventDetail.repeats'), value: recurrenceLabel });
  }
  if (statusLabel) {
    rows.push({ key: 'status', label: t('calendar:eventDetail.status'), value: statusLabel });
  }
  if (event.description) {
    rows.push({ key: 'notes', label: t('calendar:eventDetail.notes'), value: event.description });
  }

  // Name-first header: the entity name is the primary serif display (inherits
  // the Modal h2's serif/2xl), with the type as a refined eyebrow accent beneath
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
        {/* Type eyebrow: type-colored dot + uppercase mono label in the deep
            type color (WCAG AA on cream). We don't use the .eyebrow utility
            here because it hard-sets color: ink-3, which would override the
            type color at equal specificity. */}
        <span
          className={`flex items-center gap-2 font-mono text-xs uppercase tracking-[0.16em] ${EVENT_TYPE_DEEP_TEXT[event.event_type]}`}
        >
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${EVENT_TYPE_BLOCK_CLASS[event.event_type]}`}
          />
          {t(`calendar:eventTypes.${event.event_type}`)}
        </span>
      </span>
    </span>
  );

  // Footer actions slot — edit buttons slot in here when write features arrive.
  const footer =
    canEdit && editActions ? (
      editActions
    ) : (
      <div className="rounded-xl bg-bg-2 p-4">
        <p className="m-0 text-sm font-medium text-ink">{t('common:downloadApp.title')}</p>
        <p className="m-0 mt-1 text-sm text-ink-3">{t('common:downloadApp.subtitle')}</p>
      </div>
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
            <dt className="mono m-0">{row.label}</dt>
            <dd className="m-0 mt-1 whitespace-pre-wrap break-words text-base text-ink">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

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
