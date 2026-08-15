import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Button,
  Skeleton,
  SectionHeader,
  careCardShell,
  careCardNameRow,
  careCardTitle,
  careCardStatusPush,
  careCardMeta,
  careCardActions,
  type BadgeVariant,
} from '@/components/ui';
import { ViewOnlyBanner } from '@/components/ViewOnlyBanner';
import { ReadOnlyCircleBanner } from '@/components/ReadOnlyCircleBanner';
import { useCircles } from '@/hooks/useCircles';
import { useCareRecipientTimezone } from '@/hooks/useCalendarEvents';
import { useTodaysMeds } from '@/hooks/useMedConfirmation';
import { useHourCycle } from '@/hooks/useHourCycle';
import { formatEventTimeCompact, isEventPastDue } from '@/utils/timezone';
import type { TodaysMedication } from '@/api/medicationConfirmations';
import { ConfirmMedDialog } from './ConfirmMedDialog';

// Plan Tasks 22 + 39 — compact sidebar widget: today's medications with
// scheduled time, status badge, and confirm/skip buttons (opening
// ConfirmMedDialog). "Today" and past-due checks use the CARE RECIPIENT'S
// timezone (circle.timezone) — never device-local date math.
//
// Gating (Task 39): when circle.can_edit === false the buttons are hidden
// (covers both view_only and read_only) and the matching banner renders.
// Backend enforces access via requireCircleEditAccess regardless.

type MedDisplayStatus = 'taken' | 'missed' | 'pending' | 'skipped' | 'unconfirmed';

const STATUS_BADGE_VARIANT: Record<MedDisplayStatus, BadgeVariant> = {
  taken: 'moss',
  missed: 'terracotta',
  pending: 'neutral',
  skipped: 'neutral',
  unconfirmed: 'neutral',
};

function getMedDisplayStatus(
  med: TodaysMedication,
  careRecipientTimezone: string
): MedDisplayStatus {
  const confirmation = med.confirmation;
  if (confirmation) {
    if (confirmation.status === 'taken' || confirmation.status === 'taken_late') return 'taken';
    if (confirmation.status === 'skipped') return 'skipped';
    return 'missed'; // explicitly recorded 'missed' (incl. legacy auto-marked)
  }
  // Past due with NO recorded confirmation — we don't know what happened, so
  // show a neutral "Not confirmed" instead of asserting it was missed.
  return isEventPastDue(med.scheduled_date, med.scheduled_time ?? null, careRecipientTimezone)
    ? 'unconfirmed'
    : 'pending';
}

interface DialogState {
  med: TodaysMedication;
  initialStatus: 'taken' | 'skipped';
}

/**
 * Leading tile glyph mirroring mobile's MedRow icon set (Ionicons): a checkmark
 * for taken, an x for skipped, otherwise a pill/medical glyph for pending and
 * missed. Inline SVG (no icon dependency); inherits color via currentColor.
 */

export interface TodaysMedsProps {
  circleId?: string;
  /**
   * When set, only the first N meds show by default with a "Show all" toggle that
   * expands the rest in place — keeps a long med day from dominating a dashboard
   * card while keeping every confirm/skip action one click away.
   */
  limit?: number;
}

export function TodaysMeds({ circleId, limit }: TodaysMedsProps): ReactElement | null {
  const { t } = useTranslation('meds');
  const { data: circles } = useCircles();
  const circle = circles?.find((c) => c.id === circleId);
  // The care recipient's timezone is NOT on the circles list — it comes from
  // GET /circles/:circleId. All "today"/past-due math must use it.
  const { timezone } = useCareRecipientTimezone(circleId ?? '');
  const medsQuery = useTodaysMeds(circleId, timezone ?? undefined);
  // Viewer's 12h/24h clock — every rendered time goes through it.
  const hourCycle = useHourCycle();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [expanded, setExpanded] = useState(false);

  if (!circleId) return null;

  // Default to no edit affordances until access flags are known.
  const canEdit = circle ? circle.can_edit !== false : false;

  let body: ReactElement;
  if (medsQuery.isPending || !circle || !timezone) {
    body = (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  } else if (medsQuery.isError) {
    body = (
      <div>
        <p className="m-0 mb-2 text-sm text-ink-3">{t('loadError')}</p>
        <Button
          variant="ghost"
          onClick={() => void medsQuery.refetch()}
          className="min-h-9 w-full text-sm"
        >
          {t('common:retry')}
        </Button>
      </div>
    );
  } else if (medsQuery.data.length === 0) {
    body = <p className="m-0 text-sm text-ink-3">{t('empty')}</p>;
  } else {
    const allMeds = medsQuery.data;
    const collapsed = limit != null && !expanded && allMeds.length > limit;
    const visibleMeds = collapsed ? allMeds.slice(0, limit) : allMeds;
    body = (
      <>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {visibleMeds.map((med) => {
          const status = getMedDisplayStatus(med, timezone);
          const showActions = canEdit && !med.confirmation;
          const isDone = status === 'taken' || status === 'skipped';
          // Leading icon tile mirrors mobile's MedRow: rounded tile, accent
          // surface by default (incl. past-due-unconfirmed), neutral when done,
          // terracotta-tinted only for explicitly recorded misses.
          return (
            <li key={med.id} className={careCardShell}>
              {/* No decorative icon tile. A 10x10 tinted square per row is the
                  same pattern the mobile medication card dropped — it labels
                  nothing the name doesn't already say, and an icon-per-row is
                  what makes a list feel busy. The status pill carries the state. */}
              <div className={careCardNameRow}>
                <p
                  className={`m-0 ${careCardTitle} ${
                    isDone ? 'text-ink-3 line-through' : 'text-ink'
                  }`}
                >
                  {med.medication_name || med.title}
                </p>
                {/* Status sits at the END of the title row, so a column of them
                    lines up instead of stair-stepping with each name's width. */}
                <Badge
                  variant={STATUS_BADGE_VARIANT[status]}
                  className={careCardStatusPush}
                >
                  {t(`status.${status}`)}
                </Badge>
              </div>

              <p className={`m-0 ${careCardMeta}`}>
                {med.scheduled_time && (
                  <span>{formatEventTimeCompact(med.scheduled_time, timezone, hourCycle)}</span>
                )}
                {med.scheduled_time && med.medication_dosage ? <span>·</span> : null}
                {med.medication_dosage && <span>{med.medication_dosage}</span>}
              </p>

              {showActions && (
                <div className={careCardActions}>
                  <Button
                    variant="ghost"
                    onClick={() => setDialog({ med, initialStatus: 'skipped' })}
                    className="min-h-11 px-4 text-xs"
                  >
                    {t('skip')}
                  </Button>
                  <Button
                    onClick={() => setDialog({ med, initialStatus: 'taken' })}
                    className="min-h-11 px-4 text-xs"
                  >
                    {t('confirm')}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {limit != null && allMeds.length > limit && (
        <Button
          variant="ghost"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 min-h-9 w-full text-sm"
        >
          {expanded ? t('showLess') : t('showAll', { count: allMeds.length })}
        </Button>
      )}
      </>
    );
  }

  return (
    <section aria-labelledby="todays-meds-heading" className="flex flex-col gap-2">
      {/* Shared header — this used to be a bespoke <h2> with a px-1 offset,
          leaving this card's heading 4px off from its neighbours'. */}
      <SectionHeader id="todays-meds-heading" title={t('title')} />

      {circle &&
        !canEdit &&
        (circle.view_only ? (
          <ViewOnlyBanner />
        ) : circle.read_only ? (
          <ReadOnlyCircleBanner isOwner={circle.role === 'owner'} />
        ) : null)}

      {body}

      {dialog && circle && timezone && (
        <ConfirmMedDialog
          circleId={circle.id}
          med={dialog.med}
          careRecipientTimezone={timezone}
          initialStatus={dialog.initialStatus}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}
