/**
 * Blood pressure in the report's Health Vitals table: Average is "sys/dia", Min/Max are the WHOLE
 * reading with the lowest/highest systolic (never two independent extremes). Mirror of the mobile
 * suite; the shared template is byte-identical on both platforms.
 */
import { describe, expect, it } from 'vitest';
import { computeVitalsSummary } from '../shared/vitalsSummary';
import { generateAdherenceReportHtml } from '../adherenceReportPdf';

const t = (key: string) => `[${key}]`;
const at = (day: number) => `2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`;
const bp = (value1: number, value2: number | null, day: number) => ({
  vital_type: 'blood_pressure',
  value1,
  value2,
  unit: 'mmHg',
  recorded_at: at(day),
});

const html = (vitalsData: any[]) =>
  generateAdherenceReportHtml({
    report: {
      start_date: '2026-09-01',
      end_date: '2026-09-30',
      summary: {
        adherence_rate: 90, taken: 9, taken_late: 0, not_marked: 1, skipped: 0, total_scheduled: 10,
        trend: 'stable', trend_change: 0,
      },
      by_medication: [],
      daily_breakdown: [],
      time_breakdown: [],
    } as any,
    careRecipientName: 'Rosa',
    circleName: 'Familia',
    careRecipientTimezone: 'America/Denver',
    vitalsData,
  } as any);

describe('computeVitalsSummary: blood pressure', () => {
  it('averages systolic and diastolic separately, rounded to one decimal', () => {
    const [row] = computeVitalsSummary([bp(118, 74, 1), bp(131, 82, 2), bp(142, 88, 3)], t);
    expect(row.average).toBe(130); // whole numbers, like the in-app screens
    expect(row.average2).toBe(81);
  });

  it('Min/Max are the whole reading, never independent minimums', () => {
    const [row] = computeVitalsSummary([bp(150, 70, 1), bp(100, 95, 2)], t);
    expect(row.minReading).toEqual({ value1: 100, value2: 95 });
    expect(row.maxReading).toEqual({ value1: 150, value2: 70 });
  });

  it('systolic ties: Min takes the lower diastolic, Max the higher', () => {
    const [row] = computeVitalsSummary(
      [bp(120, 80, 1), bp(120, 70, 2), bp(120, 90, 3), bp(140, 85, 4), bp(140, 95, 5), bp(140, 88, 6)],
      t
    );
    expect(row.minReading).toEqual({ value1: 120, value2: 70 });
    expect(row.maxReading).toEqual({ value1: 140, value2: 95 });
  });

  it('a reading without a diastolic is skipped for the diastolic mean and loses a tie', () => {
    const [row] = computeVitalsSummary([bp(120, null, 1), bp(120, 80, 2), bp(130, 90, 3)], t);
    expect(row.average2).toBe(85);
    expect(Number.isInteger(row.average)).toBe(true);
    expect(row.minReading).toEqual({ value1: 120, value2: 80 });
  });

  it('non-BP vitals carry no BP fields', () => {
    const [row] = computeVitalsSummary(
      [
        { vital_type: 'heart_rate', value1: 60, value2: null, unit: 'bpm', recorded_at: at(1) },
        { vital_type: 'heart_rate', value1: 80, unit: 'bpm', recorded_at: at(2) },
      ],
      t
    );
    expect([row.average, row.min, row.max]).toEqual([70, 60, 80]);
    expect(row.average2).toBeUndefined();
    expect(row.minReading).toBeUndefined();
    expect(row.maxReading).toBeUndefined();
  });
});

describe('the report table renders blood pressure', () => {
  it('Average "sys/dia", Min and Max whole readings', () => {
    const out = html([
      {
        type: 'Blood pressure', latest: { value1: 131, value2: 82, unit: 'mmHg' },
        average: 130, average2: 81, min: 118, max: 142,
        minReading: { value1: 118, value2: 74 }, maxReading: { value1: 142, value2: 88 },
      },
    ]);
    expect(out).toContain('>131/82 mmHg<');
    expect(out).toContain('>130/81 mmHg<');
    expect(out).toContain('>118/74 mmHg<');
    expect(out).toContain('>142/88 mmHg<');
  });

  it('missing diastolic falls back to systolic only, never "/undefined" or "/null"', () => {
    const out = html([
      {
        type: 'Blood pressure', latest: { value1: 120, unit: 'mmHg' },
        average: 120, min: 120, max: 120,
        minReading: { value1: 120 }, maxReading: { value1: 120, value2: null },
      },
    ]);
    expect(out).not.toContain('/undefined');
    expect(out).not.toContain('/null');
    expect(out).toContain('>120 mmHg<');
  });

  it('other vitals print plain numbers', () => {
    const out = html([{ type: 'Heart rate', latest: { value1: 70, unit: 'bpm' }, average: 71, min: 60, max: 80 }]);
    expect(out).toContain('>71 bpm<');
    expect(out).toContain('>60 bpm<');
    expect(out).toContain('>80 bpm<');
  });
});
