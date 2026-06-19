import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import { Badge } from '@/components/ui';
import { formatEventTimeForDisplay } from '@/utils/timezone';
import { formatDateForDisplay, formatTimestampInTimezone } from './dateMath';
import { EVENT_TYPE_BLOCK_CLASS, getMedicationStatus } from './eventStyles';
import { formatRecurrenceLabel } from './recurrenceLabel';

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
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

const TYPE_BADGE_VARIANT = {
  medication: 'clay',
  appointment: 'dusk',
  task: 'moss',
} as const;

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
}: EventDetailModalProps): ReactElement {
  const { t, i18n } = useTranslation(['calendar', 'common']);
  const locale = i18n.language;
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Focus management: focus the close button on open, restore on close.
  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    return () => {
      previouslyFocused?.focus();
    };
  }, []);

  const handleKeyDown = useCallback(
    (keyEvent: KeyboardEvent<HTMLDivElement>) => {
      if (keyEvent.key === 'Escape') {
        keyEvent.stopPropagation();
        onClose();
        return;
      }
      if (keyEvent.key !== 'Tab') return;

      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (keyEvent.shiftKey && document.activeElement === first) {
        keyEvent.preventDefault();
        last.focus();
      } else if (!keyEvent.shiftKey && document.activeElement === last) {
        keyEvent.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  const handleBackdropClick = useCallback(
    (mouseEvent: MouseEvent<HTMLDivElement>) => {
      if (mouseEvent.target === mouseEvent.currentTarget) onClose();
    },
    [onClose]
  );

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-detail-title"
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl border border-line bg-cream shadow-lg"
      >
        <div className="flex items-start gap-4 border-b border-line-2 p-5">
          {/* Type-colored accent rail — mirrors mobile's color-forward type vocabulary */}
          <span
            aria-hidden="true"
            className={`mt-1 h-10 w-1 shrink-0 rounded-full ${EVENT_TYPE_BLOCK_CLASS[event.event_type]}`}
          />
          <div className="min-w-0 flex-1">
            <Badge variant={TYPE_BADGE_VARIANT[event.event_type]}>
              {t(`calendar:eventTypes.${event.event_type}`)}
            </Badge>
            <h2 id="event-detail-title" className="serif m-0 mt-2 break-words text-lg text-ink">
              {title}
              {dosage ? <span className="text-ink-3"> &middot; {dosage}</span> : null}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label={t('calendar:eventDetail.close')}
            onClick={onClose}
            className="shrink-0 rounded-full px-2 text-xl leading-none text-ink-3 hover:text-ink"
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>

        <dl className="m-0 flex flex-col gap-4 p-5">
          {rows.map((row) => (
            <div key={row.key}>
              <dt className="mono m-0">{row.label}</dt>
              <dd className="m-0 mt-1 whitespace-pre-wrap break-words text-base text-ink">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>

        {/* Footer actions slot — edit buttons slot in here when write features arrive. */}
        <div className="border-t border-line-2 p-5">
          {canEdit && editActions ? (
            editActions
          ) : (
            <div className="rounded-xl bg-bg-2 p-4">
              <p className="m-0 text-sm font-medium text-ink">{t('common:downloadApp.title')}</p>
              <p className="m-0 mt-1 text-sm text-ink-3">{t('common:downloadApp.subtitle')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
