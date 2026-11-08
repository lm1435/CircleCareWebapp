import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Eyebrow, Modal } from '@/components/ui';
import { DetailCard, DetailField, DetailSection } from '@/components/ui/DetailCard';
import { getMedicationPhotoUrl, type CalendarEvent } from '@/api/calendarEvents';
import { EntrySourceNote } from '@/components/calendar/EntrySourceNote';

export interface MedicationDetailModalProps {
  circleId: string;
  /** Representative event for the medication being described. */
  event: CalendarEvent;
  name: string;
  dosage: string | null;
  /**
   * The dose times ONLY ("8:00 AM · 8:00 PM"), never the recurrence. The
   * modal joins `repeat` in front of them in the WHEN cell; a caller that put
   * the recurrence here too printed "Daily" twice. Mobile's sheet never did.
   */
  times: string;
  /**
   * Pre-formatted recurrence on its own ("Daily"), or null for a one-off.
   * Formatted by the caller: `formatRecurrenceLabel` reaches `@/i18n` through
   * the calendar module, and this modal stays free of that import so it can be
   * rendered in isolation.
   */
  repeat?: string | null;
  /** Whole days of supply left, or null when the medication is not refill-tracked. */
  daysLeft?: number | null;
  /** True when `daysLeft` is under the low-stock threshold (the page owns the threshold). */
  lowStock?: boolean;
  inactive: boolean;
  /**
   * "Ended <date>" when the medication stopped because its series ENDED (never
   * discontinued); null/undefined otherwise. Replaces the Inactive badge and
   * drops Discontinue/Reactivate (mobile parity): Reactivate cannot restart a
   * series and there is nothing left to discontinue. Edit and Delete stay.
   */
  endedLabel?: string | null;
  /**
   * AS-NEEDED medication: the sheet drops the WHEN cell (there is no
   * schedule), says "Medication · As needed", shows the last-given line and the
   * reason, and offers "Dose history" + "Gave a dose" (the latter only to a
   * writer, on an ACTIVE medication). No limits, no counters.
   */
  asNeeded?: {
    reason: string | null;
    /**
     * The "Last given {time} by {name}" line, rendered by the CALLER (the page
     * owns the summary read and the recipient zone). A node, not data: this
     * modal stays free of the hour-cycle / i18n-bootstrap import chain.
     */
    lastGiven: ReactNode;
    onGive: () => void;
    onHistory: () => void;
  };
  canEdit: boolean;
  onClose: () => void;
  onEdit: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
}

/**
 * Read view for a medication: the approved detail layout (owner design pass 2026-11-08, mock
 * WebMed.dc.html; mobile's MedicationDetailModal draws the same card), top to bottom:
 *
 *   • header: MEDICATION eyebrow (+ Inactive / Ended badge) → name → dosage
 *   • the medication photo, when one exists
 *   • inactive only: "Kept for reference. Reminders are off."
 *   • ONE details card (shared `DetailCard`: uppercase small labels, no per-row icons), each
 *     section only when it has content:
 *       WHEN          the repeat + the dose times ("Daily · 8:00 AM · 8:00 PM"); a one-off shows
 *                     the times alone. As-needed: no schedule, so no When.
 *       LAST GIVEN    as-needed, active only
 *       REFILL | ASSIGNED TO | REMINDERS   the short facts, two per row
 *       WHAT IT IS FOR  as-needed reason
 *       INSTRUCTIONS  the medication's description
 *   • footer: Edit, Discontinue | Reactivate, Delete as visible standard buttons (no More menu);
 *     as-needed adds History and Gave a dose, the ONE filled button when shown.
 *
 * The dialog's name is still `name`, as the sr-only `<h2>` the Modal renders for `title` when
 * `hideTitle` is set. The visible name in the header is a plain paragraph, so the dialog has
 * exactly one heading.
 *
 * The PHOTO is the reason this fetches anything. It is deliberately absent from the events list
 * response and only exists, signed, on the single-event endpoint — and a signed Storage URL must
 * never reach the React Query cache (same rule `api/documents.ts` follows). So it is fetched on
 * open and held in component state that dies with the modal.
 *
 * ASSIGNED TO only when the roster row carries a NAMED assignee (`assigned_to_user`, embedded by
 * the events list). Neither web medication form writes `assigned_to`, so on most medications the
 * cell is simply absent, exactly as on mobile, which reads the same embed.
 */

/** "Rosa" from the embedded assignee (first name, else the email's local part); null when none. */
function assigneeFirstName(event: CalendarEvent): string | null {
  const user = event.assigned_to_user;
  if (!user) return null;
  return user.first_name?.trim() || user.email?.split('@')[0] || null;
}

/** Pairs the short facts two to a row, in order. */
function pairs<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += 2) out.push(items.slice(i, i + 2));
  return out;
}

export function MedicationDetailModal({
  circleId,
  event,
  name,
  dosage,
  times,
  repeat,
  daysLeft = null,
  lowStock = false,
  asNeeded,
  inactive,
  endedLabel = null,
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

  const refillText =
    typeof daysLeft === 'number'
      ? lowStock
        ? `${t('meds:page.stock.lowStock')} · ${t('meds:page.stock.daysLeft', { count: daysLeft })}`
        : t('meds:page.stock.daysLeft', { count: daysLeft })
      : null;

  const assignee = assigneeFirstName(event);
  // WHEN = the repeat and the times in one line ("Daily · 8:00 AM"); the recurrence still appears
  // exactly once (never "8:00 PM · Daily" above a "Repeat · Daily" row).
  const when = [repeat, times].filter(Boolean).join(' · ');

  // The short facts, two per row (the approved mock: REFILL | ASSIGNED TO).
  const shortFacts: Array<{ key: string; label: string; value: ReactNode; danger?: boolean }> = [];
  if (asNeeded) {
    shortFacts.push({
      key: 'reminders',
      label: t('meds:asNeeded.detail.reminders'),
      value: t('meds:asNeeded.detail.remindersNone'),
    });
  }
  if (refillText) {
    shortFacts.push({
      key: 'refill',
      label: t('meds:page.detail.refill'),
      value: refillText,
      danger: lowStock,
    });
  }
  if (assignee) {
    shortFacts.push({
      key: 'assigned',
      label: t('calendar:eventDetail.assignedTo'),
      value: assignee,
    });
  }

  const header = (
    <div className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-center gap-2">
        <Eyebrow color="clay">
          {asNeeded ? t('meds:asNeeded.detail.eyebrow') : t('calendar:eventTypes.medication')}
        </Eyebrow>
        {inactive && (
          <Badge size="sm">{endedLabel ?? t('calendar:discontinueMed.inactiveBadge')}</Badge>
        )}
      </div>
      <p className="m-0 mt-1.5 break-words text-lg font-semibold leading-8 text-ink">{name}</p>
      {dosage && <p className="m-0 mt-1 text-base text-ink-2">{dosage}</p>}
    </div>
  );

  // Footer (owner design pass 2026-11-08): every action in the open as a standard button, no More
  // menu. Edit, then Discontinue | Reactivate (absent on an ENDED series: nothing to stop, and
  // Reactivate cannot restart it), then Delete (soft danger). As-needed adds History and Gave a
  // dose; Gave a dose is the ONE filled button and sits last. A scheduled medication's roster
  // detail logs no dose (see EventDetailActions' header), so it has no filled button at all.
  const showGive = !!asNeeded && canEdit && !inactive;
  const footer =
    canEdit || asNeeded ? (
      <div className="flex flex-wrap items-center justify-end gap-2" data-testid="med-detail-actions">
        {canEdit && (
          <Button variant="secondary" onClick={onEdit} offlineKind="change">
            {t('meds:page.actions.edit')}
          </Button>
        )}
        {canEdit && !endedLabel && (
          <Button variant="secondary" onClick={onToggleStatus} offlineKind="change">
            {t(inactive ? 'meds:page.actions.reactivate' : 'meds:page.actions.discontinue')}
          </Button>
        )}
        {canEdit && (
          <Button variant="danger" onClick={onDelete} offlineKind="change">
            {t('meds:page.actions.delete')}
          </Button>
        )}
        {asNeeded && (
          <Button variant="secondary" onClick={asNeeded.onHistory}>
            {t('meds:asNeeded.card.history')}
          </Button>
        )}
        {showGive && (
          <Button onClick={asNeeded.onGive} offlineKind="mark">
            {t('meds:asNeeded.card.give')}
          </Button>
        )}
      </div>
    ) : undefined;

  return (
    <Modal
      title={name}
      hideTitle
      header={header}
      onClose={onClose}
      closeLabel={t('common:close')}
      size="md"
      footer={footer}
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

        {inactive && (
          <p className="m-0 rounded-lg bg-bg-2 px-4 py-3 text-sm text-ink-2">
            {t('meds:page.inactiveHint')}
          </p>
        )}

        {/* Never empty: a scheduled medication always has WHEN, an as-needed one always REMINDERS. */}
        <DetailCard data-testid="med-detail-card">
            {!asNeeded && (
              <DetailSection>
                <DetailField
                  label={t('calendar:eventDetail.when')}
                  valueTestId="med-detail-when"
                  valueClassName="font-medium tabular-nums"
                >
                  {when}
                </DetailField>
              </DetailSection>
            )}
            {asNeeded && !inactive && (
              <DetailSection>
                <DetailField label={t('meds:asNeeded.detail.lastGiven')} valueTestId="med-detail-last-given">
                  {asNeeded.lastGiven}
                </DetailField>
              </DetailSection>
            )}
            {pairs(shortFacts).map((row) => (
              <DetailSection key={row.map((f) => f.key).join('-')} columns={2}>
                {row.map((fact) => (
                  <DetailField
                    key={fact.key}
                    label={fact.label}
                    valueTestId={`med-detail-${fact.key}`}
                    // terracotta-DEEP, not base terracotta, for the low-stock value: base terracotta
                    // is reserved for glyphs and large type on web (the web ADA audit).
                    valueClassName={
                      fact.danger ? 'font-medium tabular-nums text-terracotta-deep!' : 'font-medium tabular-nums'
                    }
                  >
                    {fact.value}
                  </DetailField>
                ))}
              </DetailSection>
            ))}
            {asNeeded?.reason && (
              <DetailSection>
                <DetailField label={t('meds:asNeeded.detail.reason')} valueTestId="med-detail-reason">
                  {asNeeded.reason}
                </DetailField>
              </DetailSection>
            )}
            {notes && (
              <DetailSection>
                <DetailField
                  label={t('meds:page.detail.instructions')}
                  valueTestId="med-detail-instructions"
                  valueClassName="whitespace-pre-wrap font-normal"
                >
                  {notes}
                </DetailField>
              </DetailSection>
            )}
        </DetailCard>

        {/* "Added by voice" — only for a medication saved by voice. */}
        <EntrySourceNote event={event} />
      </div>
    </Modal>
  );
}
