/**
 * 1.4.2 owner fix (parity with mobile src/__tests__/i18n/doseCardTomorrowNotMorning.test.ts): the first-med card on
 * Today (FirstMedMarkIt) showed a bare "Mañana" (tomorrow) beside "8:00 a. m.", the same word the Morning time chip
 * uses in Spanish. The card label (overview today.markIt.tomorrow) is now "Para mañana" in es.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const LANGS = ['en', 'es', 'de', 'fr', 'fr-CA', 'it', 'pt', 'pt-PT'];
const BASE: Record<string, string> = { 'fr-CA': 'fr', 'pt-PT': 'pt' };
const load = (lng: string, ns: string): Record<string, any> | null => {
  const p = join(ROOT, lng, `${ns}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
};
const get = (o: any, path: string) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const resolve = (lng: string, ns: string, path: string): string => {
  for (const l of [lng, BASE[lng], 'en'].filter(Boolean) as string[]) {
    const v = get(load(l, ns), path);
    if (typeof v === 'string') return v;
  }
  throw new Error(`${lng}: ${ns}:${path} missing`);
};

describe('dose card "tomorrow" never reads as "morning" (1.4.2, web)', () => {
  it('POSITIVE: Spanish card says "Para mañana"', () => {
    expect(resolve('es', 'overview', 'today.markIt.tomorrow')).toBe('Para mañana');
  });

  it('POSITIVE: same label as mobile in every base language', () => {
    expect(resolve('en', 'overview', 'today.markIt.tomorrow')).toBe('Tomorrow');
    expect(resolve('de', 'overview', 'today.markIt.tomorrow')).toBe('Morgen');
    expect(resolve('fr', 'overview', 'today.markIt.tomorrow')).toBe('Demain');
    expect(resolve('it', 'overview', 'today.markIt.tomorrow')).toBe('Domani');
    expect(resolve('pt', 'overview', 'today.markIt.tomorrow')).toBe('Amanhã');
  });

  it.each(LANGS)('NEGATIVE (%s): the card label is never the Morning chip word', (lng) => {
    const label = resolve(lng, 'overview', 'today.markIt.tomorrow').trim().toLowerCase();
    const morning = resolve(lng, 'calendar', 'addEvent.timeChips.morning').trim().toLowerCase();
    expect(label).not.toBe(morning);
  });

  it('NEGATIVE: the appointments "tomorrow" label is untouched', () => {
    expect(resolve('es', 'overview', 'appointments.tomorrow')).toBe('Mañana');
  });
});
