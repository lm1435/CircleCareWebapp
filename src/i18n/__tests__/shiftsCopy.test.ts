// Care shifts copy (web): open-shift plurals and no sentence period glued to a formatted time.
import fs from 'fs';
import path from 'path';
import i18next from 'i18next';

const load = (l: string) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', l, 'shifts.json'), 'utf8'));
const LOCALES = ['en', 'es', 'fr', 'de', 'it', 'pt', 'pt-PT', 'fr-CA'];

describe('shifts open-count plurals', () => {
  const i18n = i18next.createInstance();
  beforeAll(async () => {
    await i18n.init({
      resources: Object.fromEntries(LOCALES.map((l) => [l, { shifts: load(l) }])),
      lng: 'en',
      ns: ['shifts'],
      defaultNS: 'shifts',
      fallbackLng: { 'fr-CA': ['fr', 'en'], 'pt-PT': ['pt', 'en'], default: ['en'] },
      interpolation: { escapeValue: false },
    });
  });

  it.each([
    ['en', 0, 'none open'],
    ['en', 1, '1 open'],
    ['en', 2, '2 open'],
    ['es', 0, 'ninguno abierto'],
    ['es', 1, '1 abierto'],
    ['es', 2, '2 abiertos'],
  ])('%s openCount at %i reads "%s"', (lng, count, expected) => {
    expect(i18n.getFixedT(lng)('openCount', { count })).toBe(expected);
  });

  it.each([
    ['en', 1, '1 open'],
    ['en', 2, '2 open'],
    ['es', 1, '1 abierto'],
    ['es', 2, '2 abiertos'],
  ])('%s mode.openBadge at %i reads "%s"', (lng, count, expected) => {
    expect(i18n.getFixedT(lng)('mode.openBadge', { count })).toBe(expected);
  });

  it('composes the day summaries with the plural open phrase', () => {
    const es = i18n.getFixedT('es');
    expect(es('summary', { count: 3, open: es('openCount', { count: 1 }) })).toBe('3 turnos · 1 abierto.');
    expect(es('summaryShort', { count: 1, open: es('openCount', { count: 2 }) })).toBe('1 turno · 2 abiertos');
    expect(es('month.cell', { date: 'lunes', count: 2, open: es('openCount', { count: 0 }) })).toBe(
      'lunes, 2 turnos, ninguno abierto'
    );
    const en = i18n.getFixedT('en');
    expect(en('summary', { count: 3, open: en('openCount', { count: 2 }) })).toBe('3 shifts · 2 open.');
  });
});

describe('shifts saved dialog: a formatted time is never sentence-final', () => {
  it.each(LOCALES)('%s: {{range}} / {{time}} is not followed by a period', (l) => {
    for (const [k, v] of Object.entries<string>(load(l).saved ?? {})) {
      expect(`${k}: ${v}`).not.toMatch(/\{\{(range|time)\}\}\s*[.!]/);
    }
  });

  it('es renders the Night summary without a double period', () => {
    const i18n = i18next.createInstance();
    i18n.init({
      resources: { es: { shifts: load('es') } },
      lng: 'es',
      ns: ['shifts'],
      defaultNS: 'shifts',
      interpolation: { escapeValue: false },
    });
    const out = i18n.t('saved.summaryOpenOnce', { range: '8:00 p. m. – 8:00 a. m.' });
    expect(out).not.toMatch(/\.\./);
    expect(out).toBe('8:00 p. m. – 8:00 a. m. · Abierto para que cualquiera lo tome.');
  });
});
