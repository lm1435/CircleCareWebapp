import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Eyebrow, Icon, Skeleton } from '@/components/ui';
import { useAdherenceReport } from '@/hooks/useMedConfirmation';
import { AdherenceRing } from './AdherenceRing';

/**
 * The History tab's hero (spec §6.4; mobile `renderAdherenceHero`): the 30-day
 * adherence percentage, its trend against the previous month, and the radial
 * dial — `Card elevated`, padding 22/24.
 *
 * WHAT IS DELIBERATELY MISSING: mobile's "Export report" `ghost` button. The
 * PDF export is deferred on web (spec §6.4: "omitted (deferred) — leave 16px
 * space"), so the `mt-4` spacer below keeps the card the shape the button will
 * drop into rather than reflowing every history page when it lands.
 *
 * HIDDEN WHEN NOTHING WAS SCHEDULED. A "0% adherence" hero over a circle whose
 * medications were only added yesterday is a false accusation, not a statistic;
 * `HistoryList`'s empty state says the true thing instead.
 */

export interface AdherenceHeroProps {
  circleId: string;
}

export function AdherenceHero({ circleId }: AdherenceHeroProps): ReactElement | null {
  const { t } = useTranslation('meds');
  const query = useAdherenceReport(circleId, '30d');

  if (query.isPending) {
    return (
      <Card className="flex items-center justify-between px-6 py-[22px]" aria-busy="true">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="sr-only">{t('adherence.loading')}</span>
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-[84px] w-[84px] rounded-full" />
      </Card>
    );
  }

  const summary = query.data?.summary;
  // No report (error, or a circle with no medications at all) and a report with
  // an empty denominator are the same thing to a reader: there is nothing to
  // report on yet.
  if (!summary || summary.total_scheduled === 0) return null;

  const rate = Math.round(summary.adherence_rate);
  const change = summary.trend_change ?? 0;

  // THE NUMBER DECIDES, NOT THE `trend` WORD.
  //
  // The backend calls anything inside ±5 points 'stable' while still sending
  // the real `trend_change` (backend/src/routes/medicationConfirmations.ts), so
  // keying off `trend` printed "Same as last month" over a genuine five-point
  // slide — the size of change a caregiver most needs to catch, because it is
  // the one that is still recoverable. Mobile shows the signed figure whenever
  // `trend_change !== 0` (MedicationHistoryScreen.tsx:1167) and this matches it;
  // "Same as last month" is reserved for an actual zero.
  //
  // The direction (arrow + colour) follows the SIGN for the same reason: a
  // 'stable' +5 has to read as the improvement it is.
  const improving = change > 0;
  const declining = change < 0;

  return (
    <Card className="flex items-center justify-between gap-4 px-6 py-[22px]">
      <div className="flex min-w-0 flex-col gap-1">
        <Eyebrow color="clay">{t('adherence.eyebrow')}</Eyebrow>
        <span className="text-xl font-semibold leading-[52px] text-ink">{rate}%</span>

        {/* One row, three mutually exclusive shapes. `stable` says so in words
            rather than showing a flat arrow nobody can read as "unchanged". */}
        {improving || declining ? (
          <p
            className={`m-0 flex items-center gap-1 text-sm font-medium ${
              improving ? 'text-moss' : 'text-terracotta'
            }`}
          >
            {/* The SOLID glyphs, matching mobile's `trending-up`/`trending-down`
                (MedicationHistoryScreen.tsx) — `components/ui/iconNames.ts`
                dropped the `-outline` spellings, which mobile never used. */}
            <Icon name={improving ? 'trending-up' : 'trending-down'} size="inline" />
            {t('adherence.vsLastMonth', {
              sign: improving ? '+' : '-',
              pct: Math.abs(change),
            })}
          </p>
        ) : (
          <p className="m-0 flex items-center gap-1 text-sm font-medium text-ink-2">
            {t('adherence.sameAsLastMonth')}
          </p>
        )}

        {/* Reserved for the deferred Export Report button — see the header. */}
        <div className="mt-4" aria-hidden="true" />
      </div>

      <AdherenceRing
        rate={rate / 100}
        periodLabel={t('adherence.ringLabel')}
        summary={t('adherence.ringSummary', { rate })}
      />
    </Card>
  );
}
