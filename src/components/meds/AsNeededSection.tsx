import { baseLanguage } from '@/i18n/locales';
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  careCardBadgeRow,
  careCardListGap,
  careCardMeta,
  careCardMetaDetail,
  careCardShell,
  careCardTitle,
  STATUS_PILL,
} from '@/components/ui';
import { useCircle } from '@/hooks/useCircle';
import { useAsNeededSummaries } from '@/hooks/useAsNeeded';
import type { TodaysMedication } from '@/api/medicationConfirmations';
import { useAuthStore } from '@/store/authStore';
import { formatGivenWhen } from '@/lib/asNeeded';
import { useHourCycle } from '@/hooks/useHourCycle';
import type { TimeLanguage } from '@/utils/timezone';
import { AsNeededActions, LastGivenLine } from './AsNeededParts';
import { DoseHistoryModal } from './DoseHistoryModal';
import { useAsNeededGive } from './useAsNeededGive';

// Home's "As needed" section: one card per ACTIVE as-needed medication with the
// last-given line and "Gave a dose".
//
// IT IS NOT PART OF TODAY'S DOSES. An as-needed medication has no schedule, so
// it can never be due, overdue, missed or "answered": it lives in its own
// section, outside the `allDone` check and every count in TodaysMeds. A circle
// whose only medications are as-needed shows this section ALONE — no "all done"
// card, no "not marked" rows.
//
// WRITE GATE: `useCircle(circleId).canEdit` — which FAILS CLOSED while the
// circle loads — never the list query's `can_edit` (which fails open). A
// view-only member sees the cards and the last-given line and no button.

/** Rows shown on Home; the rest are one tap away on the Medications tab (mobile parity). */
const MAX_AS_NEEDED_ROWS = 3;

export interface AsNeededSectionProps {
  circleId: string;
  /**
   * The ACTIVE as-needed medications — rows of Today's meds read
   * (`getTodaysMedications(..., { includeAsNeeded: true })`, one request for
   * both), already split from the scheduled doses by the caller.
   */
  meds: TodaysMedication[];
}

export function AsNeededSection({ circleId, meds }: AsNeededSectionProps): ReactElement | null {
  const { t, i18n } = useTranslation('meds');
  const hourCycle = useHourCycle();
  const language: TimeLanguage = baseLanguage(i18n.language);
  const { canEdit, timezone } = useCircle(circleId);
  const myUserId = useAuthStore((s) => s.user?.id ?? null);
  const { summaries, isSuccess: summariesLoaded } = useAsNeededSummaries(circleId, {
    enabled: meds.length > 0,
  });
  const give = useAsNeededGive({ circleId, timezone, summaries, surface: 'home' });
  const [historyFor, setHistoryFor] = useState<{ id: string; name: string } | null>(null);

  if (!circleId || timezone === null || meds.length === 0) return null;

  // NO LIMITS: the eyebrow is only the most recent dose across the as-needed
  // medications ("Last given {time}") or "No doses yet" — never a count. Held
  // back until the summary has answered, so it cannot claim "No doses yet" off
  // a read that has not come back.
  let latest: string | null = null;
  for (const med of meds) {
    const at = summaries[med.id]?.last_dose?.given_at;
    if (at && (!latest || new Date(at) > new Date(latest))) latest = at;
  }
  const eyebrow = !summariesLoaded
    ? null
    : latest
      ? t('asNeeded.section.lastGivenEyebrow', {
          time: formatGivenWhen(latest, timezone, hourCycle, language, {
            today: t('history.today'),
            yesterday: t('history.yesterday'),
          }),
        })
      : t('asNeeded.section.noneYetEyebrow');
  const visible = meds.slice(0, MAX_AS_NEEDED_ROWS);
  const hidden = meds.length - visible.length;

  return (
    <section aria-labelledby="as-needed-heading" className="mt-4 flex flex-col gap-2">
      {eyebrow && (
        <p className="m-0 text-xs font-medium text-ink-3" data-testid="as-needed-eyebrow">
          {eyebrow}
        </p>
      )}
      <h3 id="as-needed-heading" className="m-0 text-sm font-semibold text-ink">
        {t('asNeeded.section.title')}
      </h3>
      <p className="m-0 text-xs text-ink-3">{t('asNeeded.section.hint')}</p>
      <ul className={`m-0 list-none p-0 ${careCardListGap}`}>
        {visible.map((med) => {
          const name = med.medication_name || med.title;
          const summary = summariesLoaded ? (summaries[med.id] ?? { last_dose: null }) : undefined;
          return (
            <li key={med.id} className={careCardShell} data-testid="as-needed-card">
              <p className={`m-0 ${careCardTitle}`}>{name}</p>
              <div className={careCardBadgeRow}>
                <span className={STATUS_PILL.dueSoon}>{t('asNeeded.card.badge')}</span>
                {med.as_needed_reason && (
                  <span className={STATUS_PILL.skipped}>
                    {t('asNeeded.card.forReason', { reason: med.as_needed_reason })}
                  </span>
                )}
              </div>
              <p className={`m-0 ${careCardMeta}`}>
                {med.medication_dosage && (
                  <>
                    <span className={careCardMetaDetail}>{med.medication_dosage}</span>
                    <span aria-hidden="true">·</span>
                  </>
                )}
                <LastGivenLine summary={summary} timezone={timezone} myUserId={myUserId} />
              </p>
              <AsNeededActions
                name={name}
                canEdit={canEdit}
                pending={!!give.pending[med.id]}
                inFlight={!!give.inFlight[med.id]}
                onGive={() => give.requestGive({ id: med.id, name, dosage: med.medication_dosage })}
                onHistory={() => setHistoryFor({ id: med.id, name })}
                onUndo={() => give.undo(med.id)}
                onHoldUndo={(held) => give.hold(med.id, held)}
              />
            </li>
          );
        })}
      </ul>
      {hidden > 0 && (
        <Link
          to={`/circles/${circleId}/meds`}
          data-testid="as-needed-more"
          className="inline-flex min-h-[44px] items-center text-sm font-medium text-ink-2 underline underline-offset-2"
        >
          {t('asNeeded.section.more', { count: hidden })}
        </Link>
      )}
      {give.dialogs}
      {historyFor && (
        <DoseHistoryModal
          circleId={circleId}
          eventId={historyFor.id}
          name={historyFor.name}
          timezone={timezone}
          canEdit={canEdit}
          onClose={() => setHistoryFor(null)}
        />
      )}
    </section>
  );
}
