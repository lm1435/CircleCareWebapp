import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Button,
  Eyebrow,
  Icon,
  Modal,
  MoreMenu,
  Sheet,
  Text,
  type IconName,
  type MoreMenuItem,
} from '@/components/ui';
import { getMedicationPhotoUrl, type CalendarEvent } from '@/api/calendarEvents';

export interface MedicationDetailModalProps {
  circleId: string;
  /** Representative event for the medication being described. */
  event: CalendarEvent;
  name: string;
  dosage: string | null;
  /**
   * The dose times ONLY ("8:00 AM · 8:00 PM"), never the recurrence. The
   * recurrence has its own Repeat row; putting it here too printed "Daily"
   * twice ("8:00 PM · Daily" above "Repeat · Daily"). Mobile's sheet never did.
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
  canEdit: boolean;
  onClose: () => void;
  onEdit: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
}

/**
 * Read view for a medication — laid out like mobile's MedicationDetailModal
 * (components/medication/MedicationDetailModal.tsx), top to bottom:
 *
 *   • header — MEDICATION eyebrow (+ Inactive badge) → name → dosage
 *   • the medication photo, when one exists
 *   • inactive only: "Kept for reference. Reminders are off."
 *   • ONE info card of icon · label · value rows, each only when it has content:
 *       TIME    — the dose times (mobile shows the next dose's date + time; web
 *                 has no next-occurrence helper, and a roster group can hold
 *                 several times, so the times are the honest answer here)
 *       REPEAT  — the recurrence, the ONLY place it appears
 *       REFILL  — days of supply left, flagged under the low-stock threshold
 *       NOTES   — the medication's description
 *   • footer — More (Discontinue|Reactivate, Delete) + Edit
 *
 * The dialog's name is still `name`, as the sr-only `<h2>` the Modal renders
 * for `title` when `hideTitle` is set. The visible name in the header is a
 * plain paragraph, so the dialog has exactly one heading.
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

/**
 * One fact in the info card: decorative icon · `mono` label · 14/500 value.
 *
 * `<dt>` and `<dd>` are the ONLY children of the row `<div>` — HTML allows
 * nothing else inside a `<dl>` group, and axe fails anything more as serious
 * (`definition-list` + `dlitem`: the first version wrapped them in an extra
 * `<div>` beside the icon). So the icon lives INSIDE the `<dt>`, hidden from
 * assistive tech, and is positioned into the left gutter the row reserves.
 *
 * THE SEPARATOR IS `SheetRow`'s, COPIED RATHER THAN INHERITED. The rows sit in
 * a `<Sheet>` (spec §4.5, the grouped-row surface), but `SheetRow` itself is
 * `flex items-center`, which would lay `<dt>` beside `<dd>`; this row STACKS
 * them and hangs the icon in an absolute gutter, so it keeps its own metrics
 * and takes only the hairline — `border-t border-line-2 first:border-t-0`,
 * byte-identical to Sheet.tsx's ROW and to mobile's `styles.infoRowBorder`
 * (`borderTopWidth: 1` in `CC.hair` = `--color-line-2`). `first:` is a CSS
 * `:first-child` rule, so the conditional rows below cannot leave a stray rule
 * on top the way a JS index check would.
 */
function InfoRow({
  icon,
  label,
  children,
  danger = false,
}: {
  icon: IconName;
  label: string;
  children: ReactNode;
  danger?: boolean;
}): ReactElement {
  return (
    <div className="relative border-t border-line-2 py-3 pl-14 pr-4 first:border-t-0">
      <Text variant="mono" as="dt">
        <span
          aria-hidden="true"
          className="absolute left-4 top-1/2 flex w-7 -translate-y-1/2 justify-center text-ink-3"
        >
          <Icon name={icon} size="inline" />
        </span>
        {label}
      </Text>
      {/* terracotta-DEEP, not base terracotta, for the low-stock value:
          7.29:1 on the card vs 5.35:1, and base terracotta is reserved for
          glyphs and large type on web (see the web ADA audit). */}
      <dd
        className={`m-0 mt-0.5 break-words text-sm font-medium ${
          danger ? 'text-terracotta-deep' : 'text-ink'
        }`}
      >
        {children}
      </dd>
    </div>
  );
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

  const refillText =
    typeof daysLeft === 'number'
      ? lowStock
        ? `${t('meds:page.stock.lowStock')} · ${t('meds:page.stock.daysLeft', { count: daysLeft })}`
        : t('meds:page.stock.daysLeft', { count: daysLeft })
      : null;

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

  const header = (
    <div className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-center gap-2">
        <Eyebrow color="clay">{t('calendar:eventTypes.medication')}</Eyebrow>
        {inactive && <Badge size="sm">{t('calendar:discontinueMed.inactiveBadge')}</Badge>}
      </div>
      <p className="m-0 mt-1.5 break-words text-lg font-semibold leading-8 text-ink">{name}</p>
      {dosage && <p className="m-0 mt-1 text-base text-ink-2">{dosage}</p>}
    </div>
  );

  return (
    <Modal
      title={name}
      hideTitle
      header={header}
      onClose={onClose}
      closeLabel={t('common:close')}
      size="md"
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

        {inactive && (
          <p className="m-0 rounded-lg bg-bg-2 px-4 py-3 text-sm text-ink-2">
            {t('meds:page.inactiveHint')}
          </p>
        )}

        <Sheet as="dl" padding="none" className="m-0 overflow-hidden">
          <InfoRow icon="time-outline" label={t('meds:page.detail.time')}>
            {times}
          </InfoRow>
          {repeat && (
            <InfoRow icon="repeat-outline" label={t('meds:page.detail.repeat')}>
              {repeat}
            </InfoRow>
          )}
          {refillText && (
            <InfoRow icon="medkit-outline" label={t('meds:page.detail.refill')} danger={lowStock}>
              {refillText}
            </InfoRow>
          )}
          {notes && (
            <InfoRow icon="document-text-outline" label={t('meds:page.detail.notes')}>
              <span className="whitespace-pre-wrap font-normal">{notes}</span>
            </InfoRow>
          )}
        </Sheet>
      </div>
    </Modal>
  );
}
