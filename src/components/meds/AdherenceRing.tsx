import type { ReactElement } from 'react';
import { Text } from '@/components/ui';

/**
 * The 30-day adherence dial (spec §6.4, mobile `MedicationHistoryScreen`'s
 * `AdherenceChart`), copied numerically: 84×84 box, 6px stroke, r39 so the
 * stroke sits inside the box, `line` track, `clay` progress, round caps, and
 * the arc starting at 12 o'clock (`rotate(-90)`).
 *
 * This is the ONE hand-drawn `<svg>` allowed outside `components/ui` — a data
 * graphic, not an icon, and allowlisted as such in
 * `src/__tests__/bans/iconNames.test.ts`. Nothing about it is decorative
 * chrome: the arc IS the number.
 *
 * a11y: the drawing is `aria-hidden` and the value reaches assistive tech as
 * one sentence in the sr-only summary. A ring read as a bag of circles tells a
 * screen-reader user nothing, and the visible "30d" in the middle is a period
 * label, not the value.
 */

/** Mobile: CHART_SIZE 84, STROKE_WIDTH 6, RADIUS (84 − 6) / 2 = 39. */
export const CHART_SIZE = 84;
export const STROKE_WIDTH = 6;
export const RADIUS = (CHART_SIZE - STROKE_WIDTH) / 2;
export const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export interface AdherenceRingProps {
  /** Confirmed share of scheduled doses, 0–1. Clamped — never trusted raw. */
  rate: number;
  /** Screen-reader sentence for the value. Supply an i18n string. */
  summary: string;
  /** Visible centre label ("30d"). Supply an i18n string. */
  periodLabel: string;
}

export function AdherenceRing({ rate, summary, periodLabel }: AdherenceRingProps): ReactElement {
  // A backend that ever returns 104% (or a negative) must not paint an arc
  // longer than the circle — `strokeDasharray` would simply wrap and the ring
  // would read as a smaller number than it is.
  const clamped = Math.min(1, Math.max(0, Number.isFinite(rate) ? rate : 0));
  const dash = CIRCUMFERENCE * clamped;
  const gap = CIRCUMFERENCE - dash;

  return (
    <div className="relative h-[84px] w-[84px] shrink-0">
      <svg
        width={CHART_SIZE}
        height={CHART_SIZE}
        viewBox="0 0 84 84"
        aria-hidden="true"
        focusable="false"
      >
        <circle
          cx={42}
          cy={42}
          r={RADIUS}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth={STROKE_WIDTH}
        />
        <circle
          cx={42}
          cy={42}
          r={RADIUS}
          fill="none"
          stroke="var(--color-clay)"
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${gap}`}
          transform="rotate(-90 42 42)"
          data-testid="adherence-ring-progress"
        />
      </svg>
      <Text variant="mono" as="span" className="absolute inset-0 grid place-items-center">
        {periodLabel}
      </Text>
      <span className="sr-only">{summary}</span>
    </div>
  );
}
