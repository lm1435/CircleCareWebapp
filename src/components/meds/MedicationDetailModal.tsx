import { useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button } from '@/components/ui';
import { getMedicationPhotoUrl, type CalendarEvent } from '@/api/calendarEvents';

export interface MedicationDetailModalProps {
  circleId: string;
  /** Representative event for the medication being described. */
  event: CalendarEvent;
  name: string;
  dosage: string | null;
  /** Pre-formatted schedule line ("8:00 AM · 8:00 PM · Daily"). */
  schedule: string;
  inactive: boolean;
  canEdit: boolean;
  onClose: () => void;
  onEdit: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
}

/**
 * Read view for a medication — the thing web has never had.
 *
 * The medications page could only ever EDIT a medication: the card exposes
 * Edit / Discontinue / Delete and nothing else, so details a caregiver might
 * want to check (what the pill looks like, the full schedule) were only visible
 * inside a form, mixed in with inputs. Mobile's rule, arrived at the same way:
 * tapping an item shows it to you, and you act from there.
 *
 * The PHOTO is the reason this fetches anything. It is deliberately absent from
 * the events list response and only exists, signed, on the single-event
 * endpoint — and a signed Storage URL must never reach the React Query cache
 * (same rule `api/documents.ts` follows). So it is fetched on open and held in
 * component state that dies with the modal.
 */
export function MedicationDetailModal({
  circleId,
  event,
  name,
  dosage,
  schedule,
  inactive,
  canEdit,
  onClose,
  onEdit,
  onToggleStatus,
  onDelete,
}: MedicationDetailModalProps): ReactElement {
  const { t } = useTranslation(['meds', 'calendar', 'common']);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getMedicationPhotoUrl(circleId, event.id).then((url) => {
      if (!cancelled) setPhotoUrl(url);
    });
    return () => {
      cancelled = true;
      // Drop the signed URL as soon as the modal goes away.
      setPhotoUrl(null);
    };
  }, [circleId, event.id]);

  const notes = event.description?.trim();

  return (
    <Modal
      title={name}
      onClose={onClose}
      closeLabel={t('common:close')}
      size="sm"
      footer={
        canEdit ? (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={onDelete}>
              {t('meds:page.actions.delete')}
            </Button>
            <Button variant="ghost" onClick={onToggleStatus}>
              {t(
                inactive
                  ? 'meds:page.actions.reactivate'
                  : 'meds:page.actions.discontinue',
              )}
            </Button>
            <Button onClick={onEdit}>{t('meds:page.actions.edit')}</Button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {/* Photo first — it is the fastest way to confirm you have the right
            bottle in your hand, which is the whole reason it gets uploaded. */}
        {photoUrl && (
          <img
            src={photoUrl}
            alt={t('meds:page.detail.photoAlt', { name })}
            className="max-h-56 w-full rounded-xl border border-line object-cover"
          />
        )}

        <dl className="m-0 space-y-3">
          {dosage && (
            <div>
              <dt className="m-0 text-xs uppercase tracking-wide text-ink-3">
                {t('meds:page.detail.dosage')}
              </dt>
              <dd className="m-0 text-sm text-ink">{dosage}</dd>
            </div>
          )}

          <div>
            <dt className="m-0 text-xs uppercase tracking-wide text-ink-3">
              {t('meds:page.detail.schedule')}
            </dt>
            <dd className="m-0 text-sm text-ink">{schedule}</dd>
          </div>

          {notes && (
            <div>
              <dt className="m-0 text-xs uppercase tracking-wide text-ink-3">
                {t('meds:page.detail.notes')}
              </dt>
              <dd className="m-0 whitespace-pre-wrap text-sm text-ink">{notes}</dd>
            </div>
          )}

          {typeof event.quantity_remaining === 'number' && (
            <div>
              <dt className="m-0 text-xs uppercase tracking-wide text-ink-3">
                {t('meds:page.detail.remaining')}
              </dt>
              <dd className="m-0 text-sm text-ink">{event.quantity_remaining}</dd>
            </div>
          )}

          {inactive && (
            <div>
              <dt className="m-0 text-xs uppercase tracking-wide text-ink-3">
                {t('meds:page.detail.status')}
              </dt>
              <dd className="m-0 text-sm text-ink">
                {t('calendar:discontinueMed.inactiveBadge')}
              </dd>
            </div>
          )}
        </dl>
      </div>
    </Modal>
  );
}
