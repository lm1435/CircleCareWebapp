/**
 * The web `PdfEnv` adapter: mobile-namespace keys land on the web namespaces,
 * times follow the SAME clock resolution as `useHourCycle` (the cached
 * `/users/me` row), and the recurrence label is '' for an event with no rule.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { buildPdfEnv, mapPdfKey } from '../pdfEnv';

const DENVER = 'America/Denver';

beforeEach(async () => {
  if (i18n.language !== 'en') await i18n.changeLanguage('en');
  queryClient.clear();
});

afterEach(async () => {
  queryClient.clear();
  if (i18n.language !== 'en') await i18n.changeLanguage('en');
});

describe('mapPdfKey', () => {
  it('maps careSummary.* onto the emergency namespace', () => {
    expect(mapPdfKey('careSummary.pdf.confidentiality')).toBe(
      'emergency:careSummary.pdf.confidentiality'
    );
  });

  it('maps medicationHistory.export.* onto meds:export.*', () => {
    expect(mapPdfKey('medicationHistory.export.confidential')).toBe('meds:export.confidential');
  });

  it('maps vitals.types.* onto the vitals namespace', () => {
    expect(mapPdfKey('vitals.types.blood_pressure')).toBe('vitals:types.blood_pressure');
  });

  // notes-first-class (task 30): the care summary template labels a Daily
  // Care Note's mood with `notes.moods.<mood>` — the SAME flat mobile key the
  // Notes tab / NotesPage already render from the `notes` namespace. Without
  // this mapping `i18n.t('notes.moods.great')` resolves against the i18next
  // DEFAULT namespace ('common'), which has no such key, and prints the raw
  // key on the PDF instead of "Great day".
  it('maps notes.* onto the notes namespace', () => {
    expect(mapPdfKey('notes.moods.great')).toBe('notes:moods.great');
  });

  it('passes every other key through untouched', () => {
    expect(mapPdfKey('calendar:recurrence.daily')).toBe('calendar:recurrence.daily');
    expect(mapPdfKey('common.ok')).toBe('common.ok');
  });
});

describe('buildPdfEnv().t', () => {
  it('resolves the care summary strings (EN) with interpolation', () => {
    const env = buildPdfEnv();
    expect(env.t('careSummary.sections.medications')).toBe('Current medications');
    expect(env.t('careSummary.pdf.confidentiality')).toBe(
      'Confidential: contains personal health information'
    );
    expect(env.t('careSummary.fields.stopped', { date: 'Sep 1' })).toBe('Stopped Sep 1');
  });

  it('resolves the adherence export strings and vital type labels', () => {
    const env = buildPdfEnv();
    expect(env.t('medicationHistory.export.title')).toBe('Adherence report');
    expect(env.t('medicationHistory.export.confidential')).toBe(
      'Confidential: protected health information'
    );
    expect(env.t('vitals.types.blood_pressure')).toBe('Blood pressure');
  });

  it('resolves the visit/care note section headings and a mood label (task 30)', () => {
    const env = buildPdfEnv();
    expect(env.t('careSummary.sections.visitNotes')).toBe('Visit notes');
    expect(env.t('careSummary.sections.careNotes')).toBe('Daily care notes');
    expect(env.t('careSummary.fields.date')).toBe('Date');
    expect(env.t('careSummary.fields.note')).toBe('Note');
    expect(env.t('notes.moods.great')).toBe('Great day');
  });

  it('follows the active language', async () => {
    await i18n.changeLanguage('es');
    const env = buildPdfEnv();
    expect(env.t('careSummary.sections.medications')).toBe('Medicamentos actuales');
    expect(env.locale.toLowerCase().startsWith('es')).toBe(true);
  });
});

describe('buildPdfEnv() clock', () => {
  it('honours a 24h user synced from the phone (the useHourCycle source)', () => {
    queryClient.setQueryData(queryKeys.currentUser, {
      id: 'u1',
      email: 'u@example.com',
      uses_24h_clock: true,
      timezone: DENVER,
      notification_preferences: {},
    });
    const env = buildPdfEnv();
    expect(env.formatTimeOfDay(14, 5, DENVER)).toBe('14:05');
    // 2025-06-15T20:05:00Z is 14:05 in Denver (MDT).
    expect(env.formatInstantTimeOfDay(new Date('2025-06-15T20:05:00Z'), DENVER)).toBe('14:05');
  });

  it('renders 12h for a user whose phone reported a 12h clock', () => {
    queryClient.setQueryData(queryKeys.currentUser, {
      id: 'u1',
      email: 'u@example.com',
      uses_24h_clock: false,
      timezone: DENVER,
      notification_preferences: {},
    });
    const env = buildPdfEnv();
    expect(env.formatTimeOfDay(14, 5, DENVER)).toBe('2:05 PM');
    expect(env.formatInstantTimeOfDay(new Date('2025-06-15T20:05:00Z'), DENVER)).toBe('2:05 PM');
  });

  it('falls back to the browser locale (jsdom en-US → 12h) with no cached user', () => {
    const env = buildPdfEnv();
    expect(env.formatTimeOfDay(9, 30, DENVER)).toBe('9:30 AM');
  });

  it('uses the RAE meridiem in Spanish', async () => {
    await i18n.changeLanguage('es');
    queryClient.setQueryData(queryKeys.currentUser, {
      id: 'u1',
      email: 'u@example.com',
      uses_24h_clock: false,
      notification_preferences: {},
    });
    const env = buildPdfEnv();
    expect(env.formatTimeOfDay(14, 5, DENVER)).toBe('2:05 p. m.');
  });
});

describe('buildPdfEnv() keeps a regional variant\'s own format rows (1.2.2)', () => {
  const twelveHour = () =>
    queryClient.setQueryData(queryKeys.currentUser, {
      id: 'u1',
      email: 'u@example.com',
      uses_24h_clock: false,
      notification_preferences: {},
    });

  // normalizeLocale, not baseLanguage: collapsing fr-CA to fr (or pt-PT to pt) would
  // print the base's "PM" / "Moscou" in a Canadian / European document.
  it.each([
    ['fr', '2:05 PM'],
    ['fr-CA', '2:05 p.m.'],
    ['pt', '2:05 PM'],
    ['pt-PT', '2:05 p.m.'],
  ])('%s meridiem -> %s', async (lng, expected) => {
    await i18n.changeLanguage(lng);
    twelveHour();
    expect(buildPdfEnv().formatTimeOfDay(14, 5, DENVER)).toBe(expected);
  });

  it('pt-PT place names override the Brazilian base', async () => {
    await i18n.changeLanguage('pt-PT');
    const env = buildPdfEnv();
    expect(env.getTimezoneLabel('Europe/Moscow', 'pt-PT')).toBe('Moscovo');
    expect(env.getTimezoneLabel('Europe/Moscow', 'pt')).toBe('Moscou');
    // Untouched rows resolve through the base.
    expect(env.getTimezoneLabel('Asia/Tokyo', 'pt-PT')).toBe('Tóquio');
  });
});

describe('buildPdfEnv() helpers', () => {
  it('formatRecurrence is "" for an event with no rule, and a label otherwise', () => {
    const env = buildPdfEnv();
    expect(env.formatRecurrence({ recurrence_rule: null })).toBe('');
    expect(env.formatRecurrence({})).toBe('');
    expect(env.formatRecurrence({ recurrence_rule: 'daily' })).toBe('Daily');
    expect(env.formatRecurrence({ recurrence_rule: 'weekly', recurrence_days: [1, 3] })).toContain(
      'Mon'
    );
  });

  it('getDateInTimezone / getTimezoneLabel delegate to the web timezone module', () => {
    const env = buildPdfEnv();
    expect(env.getDateInTimezone(DENVER, new Date('2025-06-15T05:30:00Z'))).toBe('2025-06-14');
    expect(env.getTimezoneLabel(DENVER, 'en')).toBe('Denver');
    expect(env.getTimezoneLabel('America/Mexico_City', 'es')).toBe('Ciudad de México');
  });

  it('carries the logo <img> tag', () => {
    const env = buildPdfEnv();
    expect(env.logoImg).toMatch(/^<img src="data:image\/png;base64,/);
    expect(env.logoImg).toContain('alt="CircleCare"');
  });
});
