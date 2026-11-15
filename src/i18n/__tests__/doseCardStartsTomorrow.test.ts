/**
 * 1.4.2 owner fix (parity with mobile src/__tests__/i18n/doseCardStartsTomorrow.test.ts): the first-med card on Today
 * (FirstMedMarkIt) showed a bare "Mañana" (tomorrow) in the left column beside "8:00 a. m.", the same word the Morning
 * time chip uses in Spanish. The card now shows the time on the left and overview today.markIt.startsTomorrow under
 * the name.
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

const EXPECTED: Record<string, string> = {
  en: 'Starts tomorrow', es: 'Empieza mañana', de: 'Beginnt morgen', fr: 'Commence demain', it: 'Inizia domani', pt: 'Começa amanhã',
};

describe('dose card says "Starts tomorrow" as a phrase (1.4.2, web)', () => {
  it.each(Object.entries(EXPECTED))('POSITIVE (%s): "%s" (same as mobile)', (lng, phrase) => {
    expect(resolve(lng, 'overview', 'today.markIt.startsTomorrow')).toBe(phrase);
  });

  it.each(LANGS)('NEGATIVE (%s): the phrase is never a bare day word or the Morning chip word', (lng) => {
    const phrase = resolve(lng, 'overview', 'today.markIt.startsTomorrow').trim();
    expect(phrase.split(/\s+/).length).toBeGreaterThan(1);
    expect(phrase.toLowerCase()).not.toBe(resolve(lng, 'calendar', 'addEvent.timeChips.morning').trim().toLowerCase());
  });

  it('NEGATIVE: the old bare label key is gone; the appointments "tomorrow" label is untouched', () => {
    for (const lng of LANGS) expect(get(load(lng, 'overview'), 'today.markIt.tomorrow')).toBeUndefined();
    expect(resolve('es', 'overview', 'appointments.tomorrow')).toBe('Mañana');
  });
});
