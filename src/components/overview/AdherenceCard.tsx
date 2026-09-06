import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Eyebrow, Sheet, Skeleton } from '@/components/ui';
import { useWeeklyAdherence } from '@/hooks/useMedConfirmation';
import type { WeeklyAdherenceDaily } from '@/api/medicationConfirmations';

// Spec §6.3.3 — port of mobile's adherence Sheet + `AdherenceChart`
// (CircleDetailScreen.tsx:117-165 and 1211-1229; styles at :2044-2095).

/** Fixed chart box: 7 bars × 8px + 6 gaps × 6px = 92px, 52px tall. */
const BAR_COUNT = 7;
const CHART_HEIGHT = 52;
/** Mobile's floor: a 0% day still draws a 3px stub so the day is visible. */
const MIN_BAR_HEIGHT = 3;

/**
 * The seven rates (0..1) to draw, oldest→newest, LEFT-PADDED to seven.
 *
 * Mobile takes `daily.slice(-7)` and draws however many it gets, because its
 * container is a flex row that simply holds fewer children. Here the width is
 * a fixed 92px (the bars are a data graphic and must not stretch), so a short
 * week is padded at the FRONT with zero-rate days: the newest day stays the
 * last bar — the one drawn at full opacity — which is what "today" means in
 * this chart. Padding at the end would silently relabel a stale day as today.
 */
export function barRates(daily: WeeklyAdherenceDaily[] | undefined): number[] {
  const recent = (daily ?? []).slice(-BAR_COUNT).map((d) => d.adherence_rate / 100);
  return [...Array(Math.max(0, BAR_COUNT - recent.length)).fill(0), ...recent] as number[];
}

/** Mobile's exact bar geometry: `Math.max(3, 52 * rate)`. */
export function barHeight(rate: number): number {
  return Math.max(MIN_BAR_HEIGHT, CHART_HEIGHT * rate);
}

export interface AdherenceCardProps {
  circleId: string;
}

/**
 * "Past 7 days · N% · Medications on schedule" with the 7-bar mini chart.
 *
 * HIDDEN WHEN `scheduled === 0`, mobile's gate verbatim: a circle with no
 * doses on the books must never be greeted with "0% Medications on schedule".
 * An errored query hides it too — a blank number is worse than no card. The
 * whole block drops out together so nothing collapses oddly.
 */
export function AdherenceCard({ circleId }: AdherenceCardProps): ReactElement | null {
  const { t } = useTranslation(['overview', 'common']);
  const { data, isLoading, isError } = useWeeklyAdherence(circleId);

  if (isLoading) {
    return (
      <div aria-busy="true">
        <span role="status" className="sr-only">
          {t('common:loading')}
        </span>
        <Skeleton className="h-[96px] w-full" />
      </div>
    );
  }

  if (isError || !data || data.scheduled === 0) return null;

  const percent = Math.round(data.adherence_rate);
  const rates = barRates(data.daily_breakdown);

  return (
    <Sheet padding="none" className="flex items-center justify-between px-[22px] py-[22px]">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Eyebrow color="moss">{t('adherence.eyebrow')}</Eyebrow>
        {/* 32/600 lh44 tracking -0.5 beside a 24/400 unit on the same 44px
            line box, so the "%" sits on the number's baseline (mobile
            `adherenceNumber`/`adherenceValue`/`adherenceUnit`). */}
        <p className="m-0 flex items-end gap-0.5">
          <span className="text-xl font-semibold leading-[44px] tracking-tight text-ink">
            {percent}
          </span>
          <span className="text-lg font-normal leading-[44px] text-ink-3">%</span>
        </p>
        <span className="mt-0.5 text-sm text-ink-2">{t('adherence.label')}</span>
      </div>

      {/* Decorative: the sr-only line below states the same data as text. */}
      <div
        aria-hidden="true"
        data-testid="adherence-chart"
        className="flex h-[52px] w-[92px] shrink-0 items-end gap-[6px]"
      >
        {rates.map((rate, i) => (
          <span
            // Position IS the identity here — bar 0 is always the oldest day.
            // eslint-disable-next-line react/no-array-index-key
            key={i}
            data-testid={`adherence-bar-${i}`}
            className="w-2 rounded bg-moss"
            style={{ height: barHeight(rate), opacity: i === rates.length - 1 ? 1 : 0.55 }}
          />
        ))}
      </div>
      <span className="sr-only">
        {t('adherence.chartSummary', {
          values: rates.map((r) => `${Math.round(r * 100)}%`).join(', '),
        })}
      </span>
    </Sheet>
  );
}

export default AdherenceCard;
