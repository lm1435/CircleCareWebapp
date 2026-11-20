/**
 * Vitals trend line through the REAL web adapter: real i18n, real env. Mirrors the mobile
 * suite (mobile/src/__tests__/pdf/vitalsTrend.test.ts) for the pieces that depend on the adapter.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import type { AdherenceReport } from '@/api/medicationConfirmations';
import { generateAdherenceReportHtml } from '../adherenceReportPdf';
import { mapPdfKey } from '../pdfEnv';
import { computeVitalsSummary } from '../shared/vitalsSummary';

const report = {
  period_days: 30, start_date: '2026-09-01', end_date: '2026-09-30',
  summary: { adherence_rate: 90, taken: 9, taken_late: 0, not_marked: 1, skipped: 0, total_scheduled: 10, trend: 'stable', trend_change: 0 },
  by_medication: [], daily_breakdown: [], time_breakdown: [],
} as unknown as AdherenceReport;

const DAY = 86400000;
const at = (i: number) => new Date(Date.UTC(2026, 8, 1, 12) + i * DAY).toISOString();
const readings: any[] = [
  ...Array.from({ length: 10 }, (_, i) => ({ vital_type: 'blood_pressure', value1: 120 + i, value2: 80 - (i % 3), unit: 'mmHg', recorded_at: at(i) })),
  ...Array.from({ length: 5 }, (_, i) => ({ vital_type: 'heart_rate', value1: 70 + i, value2: null, unit: 'bpm', recorded_at: at(i) })),
  { vital_type: 'temperature', value1: 36.8, value2: null, unit: '°C', recorded_at: at(3) },
];

const render = (withVitals: boolean) =>
  generateAdherenceReportHtml({
    report,
    careRecipientName: 'Ada Lovelace',
    circleName: "Ada's Circle",
    careRecipientTimezone: 'America/Denver',
    vitalsData: withVitals ? computeVitalsSummary(readings, (k) => String(i18n.t(mapPdfKey(k)))) : undefined,
  });

const rows = (doc: string) => doc.split('<tbody>').pop()!.split('<tr>').slice(1);

beforeEach(async () => {
  if (i18n.language !== 'en') await i18n.changeLanguage('en');
});
afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('vitals trend line (web adapter)', () => {
  for (const [lang, bp, hr] of [['en', 'Blood pressure', 'Heart rate'], ['es', 'Presión arterial', 'Frecuencia cardíaca']]) {
    it(`P4 ${lang}: vitals with >= 2 readings carry the svg, real labels, no raw keys`, async () => {
      await i18n.changeLanguage(lang);
      const doc = render(true);
      const [bpRow, hrRow, tempRow] = rows(doc);
      expect(bpRow).toContain(bp);
      expect(hrRow).toContain(hr);
      expect(bpRow.match(/<polyline/g)).toHaveLength(2);
      expect(hrRow.match(/<polyline/g)).toHaveLength(1);
      expect(doc).not.toMatch(/NaN|Infinity|vitals\.types|medicationHistory\./);
      // N1 through the adapter: a single reading draws nothing
      expect(tempRow).not.toContain('<svg');
    });
  }

  it('N2 no vitalsData: no Health Vitals section and no svg', () => {
    const doc = render(false);
    expect(doc).not.toContain('<svg');
    expect(doc).not.toContain('Health vitals');
  });
});
