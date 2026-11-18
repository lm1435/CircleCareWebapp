import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fixture from './__fixtures__/firstRunCopyParity.json';

/**
 * PARITY (owner 2026-11-18): the first-run v2 words are the SAME on web and mobile, in every
 * language. The fixture holds mobile's values (mobile/src/i18n/locales: firstRunV2, edit.discard,
 * welcome.haveInviteCode, the appointment / task quick names, the first-run hint). A web value that
 * drifts from it fails here. pt-PT resolves through pt, as i18next does on both.
 */
const ROOT = join(__dirname, '..');

function webValue(locale: string, key: string): string | undefined {
  const [ns, path] = key.split(':');
  const read = (loc: string): unknown => {
    try {
      return JSON.parse(readFileSync(join(ROOT, loc, `${ns}.json`), 'utf8'));
    } catch {
      return undefined;
    }
  };
  const dig = (obj: unknown): string | undefined =>
    path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj) as
      | string
      | undefined;
  return dig(read(locale)) ?? (locale === 'pt-PT' ? dig(read('pt')) : undefined);
}

const locales = fixture.locales as Record<string, Record<string, string>>;

describe('first-run copy: web says what mobile says', () => {
  for (const [locale, entries] of Object.entries(locales)) {
    it.each(Object.entries(entries))(`${locale}: %s`, (key, mobile) => {
      expect(webValue(locale, key)).toBe(mobile);
    });
  }

  it('NEGATIVE: the old web-only Spanish quick names and "en el frasco" are gone', () => {
    const es = readFileSync(join(ROOT, 'es', 'calendar.json'), 'utf8');
    for (const old of ['Visita al doctor', 'Análisis de laboratorio', 'Consulta de seguimiento', 'Recoger las recetas', 'Llamada para ver cómo está', 'grande en el frasco']) {
      expect(es).not.toContain(old);
    }
  });
});
