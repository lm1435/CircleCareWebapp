/**
 * SHARED SOURCE — canonical copy. Mirrored byte-for-byte to webapp/src/pdf/shared/
 * by mobile/scripts/sync-pdf-shared.sh; a webapp test fails on drift. Platform-pure: no
 * imports outside this folder except `import type`. Edit HERE, then run the sync
 * script.
 */
import type { PdfHealthVital, PdfVitalsSummary } from './types';

// Keys only — the labels are resolved through the report's own `t` so the
// vitals section matches every other cell in the PDF, which already uses
// medicationHistory.export.*. These four strings were the last English ones.
export const VITAL_TYPE_LABEL_KEYS: Record<string, string> = {
  blood_pressure: 'vitals.types.blood_pressure',
  heart_rate: 'vitals.types.heart_rate',
  glucose: 'vitals.types.glucose',
  weight: 'vitals.types.weight',
};

/**
 * Collapse a period's recorded vitals into one row per vital type for the
 * adherence report's Health Vitals table: the latest reading (by
 * `recorded_at`), and the average / min / max of `value1` across the period.
 *
 * Rows come out in first-seen order of `vitals`. A vital type without a label
 * key falls back to the raw type string rather than printing a missing key.
 */
export function computeVitalsSummary(
  vitals: PdfHealthVital[],
  t: (key: string) => string
): PdfVitalsSummary[] {
  const grouped = new Map<string, PdfHealthVital[]>();
  for (const v of vitals) {
    const existing = grouped.get(v.vital_type) || [];
    existing.push(v);
    grouped.set(v.vital_type, existing);
  }

  const result: PdfVitalsSummary[] = [];
  for (const [type, entries] of grouped) {
    if (entries.length === 0) continue;
    // Sort by recorded_at descending to get latest
    const sorted = [...entries].sort(
      (a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime()
    );
    const latest = sorted[0];
    const values = entries.map((e) => e.value1);
    const avg = Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10;
    const min = Math.min(...values);
    const max = Math.max(...values);

    result.push({
      type: VITAL_TYPE_LABEL_KEYS[type] ? t(VITAL_TYPE_LABEL_KEYS[type]) : type,
      latest: {
        value1: latest.value1,
        value2: latest.value2 ?? undefined,
        unit: latest.unit,
      },
      average: avg,
      min,
      max,
    });
  }
  return result;
}
