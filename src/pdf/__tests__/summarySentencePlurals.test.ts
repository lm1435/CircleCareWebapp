/**
 * The report's summary sentence agrees with its counts ("1 was not marked", "1 no fue marcada")
 * in every locale, through the web app's real i18n resources.
 */
import { describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { generateAdherenceReportHtml } from '../adherenceReportPdf';

const render = async (lang: string, late: number, notMarked: number) => {
  await i18n.changeLanguage(lang);
  const html = generateAdherenceReportHtml({
    report: {
      start_date: '2026-10-01', end_date: '2026-10-30',
      summary: {
        adherence_rate: 90, taken: 9, taken_late: late, not_marked: notMarked, skipped: 0,
        total_scheduled: 10, trend: 'stable', trend_change: 0,
      },
      by_medication: [], daily_breakdown: [], time_breakdown: [],
    } as any,
    careRecipientName: 'Rosa', circleName: 'Familia', careRecipientTimezone: 'America/Denver',
  } as any);
  return html.match(/<div class="summary-sentence">([\s\S]*?)<\/div>/)![1];
};

describe('summary sentence plurals (web)', () => {
  it('en', async () => {
    expect(await render('en', 1, 1)).toContain('1 was taken late. 1 was not marked.');
    expect(await render('en', 2, 3)).toContain('2 were taken late. 3 were not marked.');
    expect(await render('en', 0, 0)).toContain('0 were taken late. 0 were not marked.');
  });
  it('es', async () => {
    expect(await render('es', 1, 1)).toContain('1 se tomó tarde. 1 no fue marcada.');
    expect(await render('es', 2, 2)).toContain('2 se tomaron tarde. 2 no fueron marcadas.');
  });
  it('fr', async () => {
    expect(await render('fr', 1, 1)).toContain('1 en retard. 1 non renseignée.');
    expect(await render('fr', 2, 2)).toContain('2 en retard. 2 non renseignées.');
  });
  it('it', async () => {
    expect(await render('it', 1, 1)).toContain('1 è stata presa in ritardo. 1 non è stata segnata.');
    expect(await render('it', 2, 2)).toContain('2 sono state prese in ritardo. 2 non sono state segnate.');
  });
  it('pt', async () => {
    expect(await render('pt', 1, 1)).toContain('1 foi tomada com atraso. 1 não foi marcada.');
    expect(await render('pt', 2, 2)).toContain('2 foram tomadas com atraso. 2 não foram marcadas.');
  });
  it('de', async () => {
    expect(await render('de', 1, 1)).toContain('1 wurde verspätet eingenommen. 1 wurde nicht eingetragen.');
    expect(await render('de', 2, 2)).toContain('2 wurden verspätet eingenommen. 2 wurden nicht eingetragen.');
  });
});
