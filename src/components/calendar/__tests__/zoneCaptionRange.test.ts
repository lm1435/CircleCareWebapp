import { afterEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { clockRangeText, clockText, viewerRangeForCaption } from '../zoneCaptionRange';

// BC-4: the caption's "your time" END is the circle's end wall time resolved to an instant, read on the viewer's
// clock. Expected strings are the spec's (computed from the circle end wall time with the repo resolver). Pure and
// zone-independent: both zones are arguments.
const NNBSP = /[  ]/g;
const norm = (text: string) => text.replace(NNBSP, ' ');

describe('BC-4 viewerRangeForCaption', () => {
  it.each([
    // viewer, circle, circle start date, start, duration, expected (12h)
    ['America/Denver', 'Asia/Tokyo', '2026-03-08', '17:00', 120, '1:00 – 4:00 AM'],
    ['America/Denver', 'Asia/Tokyo', '2026-11-01', '16:00', 120, '1:00 – 2:00 AM'],
    ['America/New_York', 'America/Phoenix', '2026-03-07', '23:00', 120, '1:00 – 4:00 AM'],
    ['Europe/London', 'America/Denver', '2026-03-28', '17:00', 180, '11:00 PM – 3:00 AM'],
    ['America/Phoenix', 'America/Denver', '2026-03-08', '01:00', 120, '1:00 – 2:00 AM'],
    ['America/Denver', 'Asia/Tokyo', '2026-06-10', '17:00', 120, '2:00 – 4:00 AM'],
  ] as const)('%s viewer, %s circle, %s %s +%s min', (viewerZone, circleZone, scheduledDate, startHm, durationMinutes, expected) => {
    expect(
      norm(viewerRangeForCaption({ scheduledDate, startHm, durationMinutes, circleZone, viewerZone, cycle: '12h' }))
    ).toBe(expected);
  });
});

// FIX 6 (owner 2026-11-21, mobile parity): a day-period marker with its own space or dots ("p. m.", "a. m.") must be
// said once and WHOLE: "11:00 – 11:30 p. m.", never "11:00 p. – 11:30 p. m.". Every language, 12 and 24 hour.
describe('FIX 6 clockRangeText keeps the whole day-period marker', () => {
  const LANGS = ['en', 'es', 'de', 'fr', 'it', 'pt', 'fr-CA', 'pt-PT'];
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });
  const range = async (lang: string, from: string, to: string, cycle: '12h' | '24h') => {
    await i18n.changeLanguage(lang);
    return norm(clockRangeText(from, to, cycle));
  };

  it.each(LANGS)('%s 12h: 11:00 PM - 11:30 PM names the marker once, whole, after the second time', async (lang) => {
    await i18n.changeLanguage(lang);
    const to = norm(clockText('23:30', '12h'));
    const out = await range(lang, '23:00', '23:30', '12h');
    expect(out).toBe(`11:00 – ${to}`);
    expect(out.split(' – ')[0]).toBe('11:00');
  });

  it('es: literally "11:00 – 11:30 p. m." and "9:00 – 9:30 a. m."', async () => {
    expect(await range('es', '23:00', '23:30', '12h')).toBe('11:00 – 11:30 p. m.');
    expect(await range('es', '09:00', '09:30', '12h')).toBe('9:00 – 9:30 a. m.');
  });

  it('en keeps the compact form', async () => {
    expect(await range('en', '15:30', '16:00', '12h')).toBe('3:30 – 4:00 PM');
  });

  it.each(LANGS)('%s: different periods (11:30 AM - 12:30 PM) stay in full on both sides', async (lang) => {
    await i18n.changeLanguage(lang);
    const a = norm(clockText('11:30', '12h'));
    const b = norm(clockText('12:30', '12h'));
    expect(await range(lang, '11:30', '12:30', '12h')).toBe(`${a} – ${b}`);
  });

  it.each(LANGS)('%s 24h: both clocks in full', async (lang) => {
    expect(await range(lang, '23:00', '23:30', '24h')).toBe('23:00 – 23:30');
  });
});
