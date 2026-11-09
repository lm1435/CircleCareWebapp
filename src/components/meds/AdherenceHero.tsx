import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Eyebrow, Icon, Skeleton } from '@/components/ui';
import { useAdherenceReport } from '@/hooks/useMedConfirmation';
import { useAdherenceExport } from '@/hooks/useAdherenceExport';
import { useCircle } from '@/hooks/useCircle';
import { usePremiumGate } from '@/hooks/usePremiumGate';
import { AdherenceRing } from './AdherenceRing';
import { AdherenceExportDialog } from './AdherenceExportDialog';

/**
 * The History tab's hero (spec §6.4; mobile `renderAdherenceHero`): the 30-day
 * adherence percentage, its trend against the previous month, and a small
 * decorative radial dial — `Card elevated`, standard padding. Trimmed
 * 2026-11-08 (owner: "feels heavy"): "Last 30 days" neutral label, "57% taken",
 * moss ring, Export as a text link in the label row.
 *
 * "EXPORT" (plan docs/plans/pdf-export-parity.md, decision 9): mobile's text
 * link in the card's label row (accessible name "Export report"). It opens
 * `AdherenceExportDialog` (period chooser) and the export itself runs through
 * `useAdherenceExport`, which fetches the CHOSEN period at call time — the
 * 30-day report this hero shows is only one of six. The export is read-only,
 * so view-only members see the button too (mobile parity; there is no
 * `canEdit` gate here on purpose).
 *
 * THE EXPORT IS PREMIUM (mobile parity: `MedicationHistoryScreen`'s export
 * button checks `is_premium_circle` and routes through `useCirclePremiumGate`).
 * On a circle where premium does not apply to the viewer, pressing the button
 * never opens the chooser: the circle-level `usePremiumGate` offers the OWNER
 * the Upgrade action and tells everyone else only the owner can upgrade (a
 * view-only seat gets the seat explanation). No export analytics fire on that
 * path -- nothing was exported. The button itself stays visible, like mobile's,
 * so the feature is discoverable.
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
  // Hooks before the early returns: the export must exist for every render
  // path, and its busy state must survive the report refetching underneath.
  const [exportOpen, setExportOpen] = useState(false);
  const { exportPdf, isExporting } = useAdherenceExport({ circleId });
  const { isPremiumCircle } = useCircle(circleId);
  // A premium-only surface -- FEATURE, what mobile sends from this button.
  const { promptUpgrade } = usePremiumGate('feature', { circleId });
  const handleExportPress = (): void => {
    if (!isPremiumCircle) {
      promptUpgrade();
      return;
    }
    setExportOpen(true);
  };

  if (query.isPending) {
    return (
      <Card className="flex flex-col gap-2" aria-busy="true">
        <span className="sr-only">{t('adherence.loading')}</span>
        <Skeleton className="h-3 w-24" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-11 w-11 rounded-full" />
          <Skeleton className="h-6 w-28" />
        </div>
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
  // PK25: the server says `trend_available: false` when either half of the 30 days had
  // nothing due (a new medication) -- there is no month to compare against, so NO trend row
  // at all (not even "Same as last month", which would be as false as a +80%). Absent on an
  // older server = available.
  const trendAvailable = summary.trend_available !== false;

  return (
    <>
      {/* Trimmed 2026-11-08 (owner: "feels heavy"; mobile renderAdherenceHero):
          neutral "Last 30 days" label with Export as a text link in the same
          row, a small decorative moss ring, the number one size down with
          "taken" beside it. Screen readers get ONE sentence, then the trend,
          then Export. */}
      <Card className="flex items-start justify-between gap-3" data-testid="history-adherence-card">
        <div className="flex min-w-0 flex-1 flex-col gap-2" data-testid="history-adherence-summary">
          <p className="sr-only">
            {t('adherence.summary', { period: t('export.period30'), pct: rate })}
          </p>
          <Eyebrow aria-hidden="true">{t('export.period30')}</Eyebrow>
          <div className="flex items-center gap-3">
            <AdherenceRing rate={rate / 100} />
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="m-0 flex flex-wrap items-baseline gap-x-1.5" aria-hidden="true">
                <span className="text-lg font-semibold tabular-nums leading-tight text-ink">{rate}%</span>
                <span className="text-sm text-ink-3">{t('adherence.taken')}</span>
              </p>

              {/* One row, three mutually exclusive shapes. `stable` says so in words
                  rather than showing a flat arrow nobody can read as "unchanged". */}
              {!trendAvailable ? null : improving || declining ? (
                <p
                  className={`m-0 flex items-center gap-1 text-sm font-medium tabular-nums ${
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
            </div>
          </div>
        </div>

        {/* A text link in the label row. 44px target; the negative top margin
            centres the box on the 12px label line so it does not make the card
            taller. The accessible name stays "Export report" (it contains the
            visible "Export", WCAG 2.5.3). */}
        <button
          type="button"
          onClick={handleExportPress}
          disabled={isExporting}
          aria-label={t('export.button')}
          data-testid="history-export-button"
          className="-mt-3.5 -mr-2 inline-flex min-h-[44px] min-w-[44px] shrink-0 cursor-pointer items-center justify-end border-0 bg-transparent px-2 text-sm font-semibold text-moss-deep underline-offset-2 hover:underline disabled:cursor-default disabled:opacity-50"
        >
          {t('export.link')}
          <span aria-hidden="true"> ›</span>
        </button>
      </Card>

      <AdherenceExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        exportPdf={exportPdf}
        isExporting={isExporting}
      />
    </>
  );
}
