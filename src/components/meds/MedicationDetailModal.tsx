import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Modal, Button, MoreMenu, Text, type MoreMenuItem } from '@/components/ui';
import { getMedicationPhotoUrl, type CalendarEvent } from '@/api/calendarEvents';

export interface MedicationDetailModalProps {
  circleId: string;
  /** Representative event for the medication being described. */
  event: CalendarEvent;
  name: string;
  dosage: string | null;
  /** Pre-formatted schedule line ("8:00 AM · 8:00 PM · Daily"). */
  schedule: string;
  /**
   * Pre-formatted recurrence on its own ("Daily"), or null for a one-off.
   * Formatted by the caller: `formatRecurrenceLabel` reaches `@/i18n` through
   * the calendar module, and this modal stays free of that import so it can be
   * rendered in isolation.
   */
  repeat?: string | null;
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
 * The medications page could only ever EDIT a medication: the card exposed
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
 *
 * NO "ASSIGNED TO" ROW. `assigned_to` exists on `CalendarEvent`, but it is a
 * TASK field: neither medication form ever writes it and mobile's medication
 * surfaces never read it, so the row would be permanently blank.
 */

/** One labelled fact: `mono` label above a 16/500 value (spec §4.5). */
function InfoRow({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div>
      <Text variant="mono" as="dt">
        {label}
      </Text>
      <dd className="m-0 mt-0.5 text-md font-medium text-ink">{children}</dd>
    </div>
  );
}

export function MedicationDetailModal({
  circleId,
  event,
  name,
  dosage,
  schedule,
  repeat,
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

  // Two-or-more secondary actions (Discontinue/Reactivate + Delete) live
  // inside the MoreMenu overflow, Delete last as the danger item; Edit is the
  // named button and stays last in DOM order.
  const menuItems: MoreMenuItem[] = [
    {
      id: 'toggle-status',
      label: t(inactive ? 'meds:page.actions.reactivate' : 'meds:page.actions.discontinue'),
      onSelect: onToggleStatus,
    },
    { id: 'delete', label: t('meds:page.actions.delete'), onSelect: onDelete, danger: true },
  ];

  return (
    <Modal
      title={name}
      onClose={onClose}
      closeLabel={t('common:close')}
      size="sm"
      footer={
        canEdit ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <MoreMenu items={menuItems} />
            <Button variant="secondary" onClick={onEdit}>
              {t('meds:page.actions.edit')}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        {/* Photo first — it is the fastest way to confirm you have the right
            bottle in your hand, which is the whole reason it gets uploaded. */}
        {photoUrl && (
          <img
            src={photoUrl}
            alt={t('meds:page.detail.photoAlt', { name })}
            className="max-h-56 w-full rounded-xl object-cover"
          />
        )}

        <Card variant="filled" padding="sm">
          <dl className="m-0 flex flex-col gap-3">
            {dosage && <InfoRow label={t('meds:page.detail.dosage')}>{dosage}</InfoRow>}
            <InfoRow label={t('meds:page.detail.schedule')}>{schedule}</InfoRow>
            {/* The recurrence on its own line. `schedule` already ends with it,
                but "REPEAT · Daily" is what a caregiver checking whether a
                medication is still a daily one actually scans for. */}
            {repeat && <InfoRow label={t('meds:page.detail.repeat')}>{repeat}</InfoRow>}
            {typeof event.quantity_remaining === 'number' && (
              <InfoRow label={t('meds:page.detail.remaining')}>{event.quantity_remaining}</InfoRow>
            )}
            {inactive && (
              <InfoRow label={t('meds:page.detail.status')}>
                {t('calendar:discontinueMed.inactiveBadge')}
              </InfoRow>
            )}
          </dl>
        </Card>

        {notes && (
          <Card variant="filled" padding="sm">
            <dl className="m-0">
              <InfoRow label={t('meds:page.detail.notes')}>
                <span className="whitespace-pre-wrap font-normal">{notes}</span>
              </InfoRow>
            </dl>
          </Card>
        )}
      </div>
    </Modal>
  );
}
