/**
 * RELATIVE DAYS IN ACTIVITY SENTENCES (1.2.2 flip), every registry locale.
 *
 * Before: the capitalised feed-group label was spliced after the date preposition,
 * "Skipped: Aspirin on Today", "Omitido: Aspirin el Hoy", "am Heute", "il Oggi",
 * "em Hoje". Rule (same on backend and mobile): a relative day drops the on-date
 * preposition and starts lowercase; a from-date keeps a preposition, taken from
 * `phrases.fromRelativeDate` (Italian "dal 15 gen" but "da oggi"). Calendar dates
 * are unchanged. Also: a legacy "Logged a dose: X at 2:30 PM" row keeps no English "at".
 */
import { describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { SUPPORTED_LOCALES } from '@/i18n/locales';
import {
  lowerFirst,
  renderActivityDescription,
  translateActivityDescription,
} from '@/components/activity/activityTranslation';
import { installActivityFrame } from './helpers/activityLocaleTwin';
import { NOW, row } from './helpers/activityLocaleProbes';

installActivityFrame();

const TODAY = '2026-10-06'; // NOW = 2026-10-06T18:00Z, Denver
const YESTERDAY = '2026-10-05';
const OLD = '2026-06-10';

const tFor = (code: string) => i18n.getFixedT(code, 'activity');
const keyed = (code: string, key: string, scheduledDate: string) =>
  renderActivityDescription(row('x', 'STORED', key, { title: 'Aspirin', scheduledDate }), tFor(code), {
    timezone: 'America/Denver',
    hourCycle: '12h',
    locale: code,
    now: NOW,
  });

const ON_DATE_KEYS = [
  'entries.medicationNotTaken',
  'entries.medicationOccurrenceRemoved',
  'entries.appointmentOccurrenceRemoved',
  'entries.taskOccurrenceRemoved',
];

describe('explicit expectations', () => {
  it.each([
    ['en', 'Skipped: Aspirin today', 'Stopped recurrence for Aspirin from today'],
    ['es', 'Omitido: Aspirin hoy', 'Detuvo recurrencia de Aspirin desde hoy'],
    ['de', 'Ausgelassen: Aspirin heute', 'Wiederholung beendet für Aspirin ab heute'],
    ['it', 'Evento saltato: Aspirin oggi', 'Ripetizione interrotta per Aspirin da oggi'],
    ['pt', 'Dose pulada: Aspirin (hoje)', 'Interrompeu a repetição de Aspirin (a partir de: hoje)'],
  ])('%s keyed rows', (code, skipped, stopped) => {
    expect(keyed(code, 'entries.medicationNotTaken', TODAY)).toBe(skipped);
    expect(keyed(code, 'entries.recurrenceStopped', TODAY)).toBe(stopped);
  });

  it('a calendar date keeps its preposition', () => {
    expect(keyed('en', 'entries.medicationNotTaken', OLD)).toBe('Skipped: Aspirin on Jun 10');
    expect(keyed('it', 'entries.recurrenceStopped', OLD)).toMatch(/ dal 10 giu/);
  });

  it('legacy path (formatDateShort relative)', () => {
    expect(translateActivityDescription(`Not taken: Aspirin on ${TODAY}`, tFor('en'), 'en')).toBe(
      'Skipped: Aspirin today'
    );
    expect(translateActivityDescription(`Skipped Aspirin on ${YESTERDAY}`, tFor('es'), 'es')).toBe(
      'Omitido: Aspirin ayer'
    );
    expect(
      translateActivityDescription(`Stopped recurrence for Aspirin from ${TODAY}`, tFor('it'), 'it')
    ).toBe('Ripetizione interrotta per Aspirin da oggi');
  });

  it('legacy "Logged a dose: X at <time>" leaves no English "at"', () => {
    expect(translateActivityDescription('Logged a dose: Ibuprofen 200mg at 2:30 PM', tFor('es'), 'es')).toBe(
      'Dosis registrada: Ibuprofen 200mg a las 2:30 PM'
    );
    expect(translateActivityDescription('Logged a dose: Ibuprofen at 14:30', tFor('de'), 'de')).toBe(
      'Dosis eingetragen: Ibuprofen um 14:30'
    );
    expect(translateActivityDescription('Logged a dose: Ibuprofen at 2:30 PM', tFor('en'), 'en')).toBe(
      'Logged a dose: Ibuprofen at 2:30 PM'
    );
    // The plain stored form (no time) is unchanged.
    expect(translateActivityDescription('Logged a dose: Ibuprofen', tFor('es'), 'es')).toBe(
      'Dosis registrada: Ibuprofen'
    );
  });

  it('lowerFirst lowercases only the first character', () => {
    expect(lowerFirst('Aujourd’hui', 'fr')).toBe('aujourd’hui');
    expect(lowerFirst('Heute', 'de')).toBe('heute');
    expect(lowerFirst('', 'en')).toBe('');
  });
});

describe.each([...SUPPORTED_LOCALES])('%s: no "preposition + Capitalised day"', (code) => {
  const t = tFor(code);
  const today = t('today');
  const yesterday = t('yesterday');
  const onDate = t('phrases.onDate');

  it.each([...ON_DATE_KEYS, 'entries.recurrenceStopped'])('%s', (key) => {
    for (const [date, label] of [
      [TODAY, today],
      [YESTERDAY, yesterday],
    ] as const) {
      const out = keyed(code, key, date);
      expect(out, `${code} ${key}`).toContain(lowerFirst(label, code));
      // The capitalised label never appears mid-sentence...
      expect(out.includes(label) && label !== lowerFirst(label, code), out).toBe(false);
      // ...and an on-date preposition never precedes a relative day.
      if (key !== 'entries.recurrenceStopped') {
        expect(out, out).not.toContain(`${onDate} ${lowerFirst(label, code)}`);
      }
    }
  });
});

describe('falsification: the old splice is what these assertions reject', () => {
  it('old en/es output fails the rule', () => {
    const old = (title: string, prep: string, day: string, phrase: string) => `${phrase} ${title} ${prep} ${day}`;
    const en = old('Aspirin', i18n.t('phrases.onDate', { ns: 'activity', lng: 'en' }), 'Today', 'Skipped:');
    expect(en).toBe('Skipped: Aspirin on Today');
    expect(en).not.toBe(keyed('en', 'entries.medicationNotTaken', TODAY));
    expect(en.includes('Today')).toBe(true); // the per-locale check above would flag it
  });
});
