import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Skeleton, type BadgeVariant } from '@/components/ui';
import { ViewOnlyBanner } from '@/components/ViewOnlyBanner';
import { ReadOnlyCircleBanner } from '@/components/ReadOnlyCircleBanner';
import { useCircles } from '@/hooks/useCircles';
import { useCareRecipientTimezone } from '@/hooks/useCalendarEvents';
import { useTodaysMeds } from '@/hooks/useMedConfirmation';
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

type MedDisplayStatus = 'taken' | 'missed' | 'pending' | 'skipped';

const STATUS_BADGE_VARIANT: Record<MedDisplayStatus, BadgeVariant> = {
  taken: 'moss',
  missed: 'terracotta',
  pending: 'neutral',
  skipped: 'neutral',
};

function getMedDisplayStatus(
  med: TodaysMedication,
  careRecipientTimezone: string
): MedDisplayStatus {
  const confirmation = med.confirmation;
  if (confirmation) {
    if (confirmation.status === 'taken' || confirmation.status === 'taken_late') return 'taken';
    if (confirmation.status === 'skipped') return 'skipped';
    return 'missed'; // legacy auto-marked 'missed'
  }
  return isEventPastDue(med.scheduled_date, med.scheduled_time ?? null, careRecipientTimezone)
    ? 'missed'
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
function MedTileIcon({ status }: { status: MedDisplayStatus }): ReactElement {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (status === 'taken') {
    return (
      <svg {...common}>
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  if (status === 'skipped') {
    return (
      <svg {...common}>
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    );
  }
  // pending / missed — pill glyph
  return (
    <svg {...common}>
      <rect x="3" y="8" width="18" height="8" rx="4" />
      <path d="M12 8v8" />
    </svg>
  );
}

export interface TodaysMedsProps {
  circleId?: string;
}

export function TodaysMeds({ circleId }: TodaysMedsProps): ReactElement | null {
  const { t } = useTranslation('meds');
  const { data: circles } = useCircles();
  const circle = circles?.find((c) => c.id === circleId);
  // The care recipient's timezone is NOT on the circles list — it comes from
  // GET /circles/:circleId. All "today"/past-due math must use it.
  const { timezone } = useCareRecipientTimezone(circleId ?? '');
  const medsQuery = useTodaysMeds(circleId, timezone ?? undefined);
  const [dialog, setDialog] = useState<DialogState | null>(null);

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
    body = (
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {medsQuery.data.map((med) => {
          const status = getMedDisplayStatus(med, timezone);
          const showActions = canEdit && !med.confirmation;
          const isDone = status === 'taken' || status === 'skipped';
          // Leading icon tile mirrors mobile's MedRow: rounded tile, accent
          // surface by default, neutral when done, terracotta-tinted when missed.
          const tileClass = isDone
            ? 'bg-bg-2 text-ink-3'
            : status === 'missed'
              ? 'bg-terracotta-soft text-terracotta-deep'
              : 'bg-clay-soft text-clay-deep';
          return (
            <li key={med.id} className="rounded-xl border border-line-2 bg-cream p-3">
              <div className="flex items-start gap-3">
                {/* Leading status/type icon tile */}
                <span
                  aria-hidden="true"
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] ${tileClass}`}
                >
                  <MedTileIcon status={status} />
                </span>

                {/* The name gets the full column width (no longer competing with
                    the badge on one line) so it stays readable in the sidebar. */}
                <div className="min-w-0 flex-1">
                  <p
                    className={`m-0 text-sm font-medium leading-snug ${
                      isDone ? 'text-ink-3 line-through' : 'text-ink'
                    }`}
                  >
                    {med.medication_name || med.title}
                  </p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="m-0 min-w-0 truncate text-xs text-ink-3">
                      {med.medication_dosage && <span>{med.medication_dosage}</span>}
                      {med.medication_dosage && med.scheduled_time ? <span> · </span> : null}
                      {med.scheduled_time && (
                        <span>{formatEventTimeCompact(med.scheduled_time, timezone)}</span>
                      )}
                    </p>
                    {/* Status badge — reflects the current state. */}
                    <Badge variant={STATUS_BADGE_VARIANT[status]} className="shrink-0">
                      {t(`status.${status}`)}
                    </Badge>
                  </div>
                </div>
              </div>

              {showActions && (
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => setDialog({ med, initialStatus: 'skipped' })}
                    className="min-h-9 flex-1 px-3 text-xs"
                  >
                    {t('skip')}
                  </Button>
                  <Button
                    onClick={() => setDialog({ med, initialStatus: 'taken' })}
                    className="min-h-9 flex-1 px-3 text-xs"
                  >
                    {t('confirm')}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section aria-labelledby="todays-meds-heading" className="flex flex-col gap-2">
      <h2 id="todays-meds-heading" className="eyebrow m-0 px-1">
        {t('title')}
      </h2>

      {circle && !canEdit && (
        circle.view_only ? (
          <ViewOnlyBanner />
        ) : circle.read_only ? (
          <ReadOnlyCircleBanner isOwner={circle.role === 'owner'} />
        ) : null
      )}

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
