import type { VitalType } from '@/api/vitals';

// PORT of mobile/src/utils/vitalsChart.ts's `formatAverageDelta` (+ its private
// helpers). Web parity task: replace VitalsPage's percent-of-average trend
// sentence ("Up 6.9% vs previous period", systolic-only for blood pressure)
// with a signed absolute delta in display units, matching mobile.
//
// DELIBERATELY DEPENDENCY-FREE: no React, no i18n — plain numbers/strings in,
// plain strings out, so this is unit-testable without pulling in VitalsPage's
// query hooks or the chart.

export type TrendDirection = 'up' | 'down' | 'same' | 'mixed';

export interface VitalPeriodAverage {
  avg: number;
  /** Diastolic-side average — blood pressure only, `null` otherwise. */
  avg2: number | null;
}

/**
 * Rounds a value to the same precision `formatVitalValue` (lib/vitals.ts) uses
 * for `type`: whole numbers for blood pressure and heart rate, one decimal
 * place for weight and glucose. Mirrors `formatVitalValue`'s own
 * `Number(value.toFixed(1))` so a delta that lands on a whole number (e.g.
 * -2.0) prints as "2", not "2.0".
 */
function roundForType(type: VitalType, value: number): number {
  if (type === 'heart_rate' || type === 'blood_pressure') return Math.round(value);
  return Number(value.toFixed(1));
}

/**
 * `+4`, `−2.1` (U+2212 MINUS SIGN, not a hyphen), or `0`. Sign and "zero"
 * are decided on the ALREADY-ROUNDED number the caller passes in — never
 * re-round here. `-0 === 0` is `true` in JS, so a rounded `-0` (e.g.
 * `Math.round(-0.4)`) also prints as `0`, not `-0`.
 */
function formatSignedNumber(value: number): string {
  if (value === 0) return '0';
  return value > 0 ? `+${value}` : `−${Math.abs(value)}`;
}

/**
 * One direction for a set of rounded per-component deltas: 'same' only when
 * every component is exactly 0, 'up'/'down' when every NON-ZERO component
 * agrees on sign, 'mixed' otherwise (e.g. systolic up, diastolic down).
 */
function directionFromComponents(components: ReadonlyArray<number>): TrendDirection {
  const nonZero = components.filter((c) => c !== 0);
  if (nonZero.length === 0) return 'same';
  if (nonZero.every((c) => c > 0)) return 'up';
  if (nonZero.every((c) => c < 0)) return 'down';
  return 'mixed';
}

/**
 * The hero trend sentence's `{{delta}}` value and its direction.
 *
 * `current`/`previous` are the period's `{ avg, avg2 }` pair, already in
 * DISPLAY units (the caller converts before computing the average) — this
 * function does no unit conversion of its own.
 *
 * Blood pressure prints BOTH components ("+4/−1 mmHg") when both averages
 * carry a diastolic value; if either side is missing one, this falls back to
 * the systolic component alone, both in the text and in the direction it
 * reports.
 */
export function formatAverageDelta(
  type: VitalType,
  current: VitalPeriodAverage,
  previous: VitalPeriodAverage,
  unit: string
): { delta: string; direction: TrendDirection } {
  const useBothComponents =
    type === 'blood_pressure' && current.avg2 != null && previous.avg2 != null;

  const primaryDelta = roundForType(type, current.avg - previous.avg);
  const components = [primaryDelta];
  let deltaText = formatSignedNumber(primaryDelta);

  if (useBothComponents) {
    const secondaryDelta = roundForType(
      type,
      (current.avg2 as number) - (previous.avg2 as number)
    );
    components.push(secondaryDelta);
    deltaText = `${formatSignedNumber(primaryDelta)}/${formatSignedNumber(secondaryDelta)}`;
  }

  return {
    delta: `${deltaText} ${unit}`,
    direction: directionFromComponents(components),
  };
}
