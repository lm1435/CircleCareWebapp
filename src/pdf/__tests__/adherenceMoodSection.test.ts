/**
 * "Day ratings" section through the REAL web adapter: real i18n, real env.
 * Mirrors the mobile template suite; proves the key mapping resolves
 * (`medicationHistory.export.mood*` -> meds:export.*, `notes.moods.*` -> notes:moods.*).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import type { AdherenceReport } from '@/api/medicationConfirmations';
import { generateAdherenceReportHtml } from '../adherenceReportPdf';
import { computeMoodSummary } from '../shared/moodSummary';

const report: AdherenceReport = {
  period_days: 30,
  start_date: '2026-09-01',
  end_date: '2026-09-30',
  summary: {
    adherence_rate: 90, taken: 9, taken_late: 0, not_marked: 1, skipped: 0, total_scheduled: 10,
    trend: 'stable', trend_change: 0,
  },
  by_medication: [],
  daily_breakdown: [],
  time_breakdown: [],
} as unknown as AdherenceReport;

const notes = [
  { id: '1', note_date: '2026-09-01', mood: 'great' },
  { id: '2', note_date: '2026-09-10', mood: 'tough' },
  { id: '3', note_date: '2026-09-21', mood: 'good' },
];

const render = (withMood: boolean) =>
  generateAdherenceReportHtml({
    report,
    careRecipientName: 'Ada Lovelace',
    circleName: "Ada's Circle",
    careRecipientTimezone: 'America/Denver',
    moodSummary: withMood ? computeMoodSummary(notes, '2026-09-01', '2026-09-30') : undefined,
  });

beforeEach(async () => {
  if (i18n.language !== 'en') await i18n.changeLanguage('en');
});
afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('adherence report day ratings (web adapter)', () => {
  it('P6 en: prints the section with real strings, no raw keys', () => {
    const html = render(true);
    expect(html).toContain('Day ratings');
    expect(html).toContain('From daily care notes. Rated notes: 3. Days with a rating: 3 of 30.');
    expect(html).toContain('Great day');
    expect(html).toContain('Tough day');
    expect(html).toContain('Tough days:');
    expect(html).toContain('Total');
    expect(html).not.toMatch(/export\.mood|medicationHistory\.|notes\.moods|moods\./);
  });

  it('P6 es: prints the section with real Spanish strings, no raw keys', async () => {
    await i18n.changeLanguage('es');
    const html = render(true);
    expect(html).toContain('Calificaciones del día');
    expect(html).toContain('Notas calificadas: 3. Días con calificación: 3 de 30.');
    expect(html).toContain('Día difícil');
    expect(html).toContain('Días difíciles:');
    expect(html).not.toMatch(/export\.mood|medicationHistory\.|notes\.moods|moods\./);
  });

  it('N1 no moodSummary: no section and no mood strings', () => {
    const html = render(false);
    expect(html).not.toContain('Day ratings');
    expect(html).not.toContain('Tough days');
    expect(html).not.toContain('Great day');
  });
});
