import type { ReactElement } from 'react';

/**
 * The 30-day adherence dial (spec §6.4, mobile `MedicationHistoryScreen`'s
 * `AdherenceChart`), copied numerically. Trimmed 2026-11-08 (owner: "feels
 * heavy"): 44×44 box, 4px stroke, r20 so the stroke sits inside the box,
 * neutral hairline (`line-2`) track, MOSS progress, round caps, the arc
 * starting at 12 o'clock (`rotate(-90)`), and nothing drawn inside it.
 *
 * This is the ONE hand-drawn `<svg>` allowed outside `components/ui` — a data
 * graphic, not an icon, and allowlisted as such in
 * `src/__tests__/bans/iconNames.test.ts`.
 *
 * a11y: DECORATIVE. The whole dial is `aria-hidden`; the card it sits in
 * (`AdherenceHero`) shows "57% taken" and gives assistive tech one sentence
 * ("Last 30 days, 57% taken").
 */

/** Mobile: CHART_SIZE 44, STROKE_WIDTH 4, RADIUS (44 − 4) / 2 = 20. */
export const CHART_SIZE = 44;
export const STROKE_WIDTH = 4;
export const RADIUS = (CHART_SIZE - STROKE_WIDTH) / 2;
export const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export interface AdherenceRingProps {
  /** Confirmed share of scheduled doses, 0–1. Clamped — never trusted raw. */
  rate: number;
}

export function AdherenceRing({ rate }: AdherenceRingProps): ReactElement {
  // A backend that ever returns 104% (or a negative) must not paint an arc
  // longer than the circle — `strokeDasharray` would simply wrap and the ring
  // would read as a smaller number than it is.
  const clamped = Math.min(1, Math.max(0, Number.isFinite(rate) ? rate : 0));
  const dash = CIRCUMFERENCE * clamped;
  const gap = CIRCUMFERENCE - dash;
  const c = CHART_SIZE / 2;

  return (
    <div className="h-11 w-11 shrink-0" aria-hidden="true">
      <svg
        width={CHART_SIZE}
        height={CHART_SIZE}
        viewBox={`0 0 ${CHART_SIZE} ${CHART_SIZE}`}
        focusable="false"
      >
        <circle
          cx={c}
          cy={c}
          r={RADIUS}
          fill="none"
          stroke="var(--color-line-2)"
          strokeWidth={STROKE_WIDTH}
          data-testid="adherence-ring-track"
        />
        <circle
          cx={c}
          cy={c}
          r={RADIUS}
          fill="none"
          stroke="var(--color-moss)"
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${gap}`}
          transform={`rotate(-90 ${c} ${c})`}
          data-testid="adherence-ring-progress"
        />
      </svg>
    </div>
  );
}
