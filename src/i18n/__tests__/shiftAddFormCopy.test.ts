/**
 * "Add to this shift" forms, UX fixes 1-4 (owner 2026-11-21): the exact copy in all 8 languages (the regional files
 * fr-CA / pt-PT hold only what differs from fr / pt, so a key resolves along variant -> base). Mobile twin:
 * mobile/src/__tests__/i18n/shiftAddFormCopy.test.ts.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const NB = ' ';
const load = (lang: string): any =>
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', lang, 'shifts.json'), 'utf8'));
const pick = (o: any, p: string) => p.split('.').reduce((a, k) => a?.[k], o);
const BASE: Record<string, string | null> = {
  en: null, es: null, fr: null, 'fr-CA': 'fr', de: null, it: null, pt: null, 'pt-PT': 'pt',
};
const copy = (lang: string, key: string): string =>
  (pick(load(lang), key) ?? (BASE[lang] ? pick(load(BASE[lang] as string), key) : undefined)) as string;

const WANT: Record<string, Record<string, string>> = {
  'add.lockedHint': {
    en: 'For this day only. The date comes from the shift.',
    es: 'Solo para este día. La fecha viene del turno.',
    fr: 'Pour ce jour seulement. La date vient de la garde.',
    'fr-CA': 'Pour ce jour seulement. La date vient du quart.',
    de: 'Nur für diesen Tag. Das Datum kommt von der Schicht.',
    it: 'Solo per questo giorno. La data viene dal turno.',
    pt: 'Só para este dia. A data vem do plantão.',
    'pt-PT': 'Só para este dia. A data vem do turno.',
  },
  'tasks.form.onlyDate': {
    en: "For this day only. It won't repeat with the shift.",
    es: 'Solo para este día. No se repite con el turno.',
    fr: 'Pour ce jour seulement. Ne se répète pas avec la garde.',
    'fr-CA': 'Pour ce jour seulement. Ne se répète pas avec le quart.',
    de: 'Nur für diesen Tag. Wiederholt sich nicht mit der Schicht.',
    it: 'Solo per questo giorno. Non si ripete con il turno.',
    pt: 'Só para este dia. Não se repete com o plantão.',
    'pt-PT': 'Só para este dia. Não se repete com o turno.',
  },
  'tasks.form.errorOutsideTimes': {
    en: 'Outside this shift: {{times}}. Pick a time inside the shift hours.',
    es: 'Fuera de este turno: {{times}}. Elige una hora dentro del horario del turno.',
    fr: `En dehors de cette garde${NB}: {{times}}. Choisissez une heure pendant la garde.`,
    'fr-CA': `En dehors de ce quart${NB}: {{times}}. Choisissez une heure pendant le quart.`,
    de: 'Außerhalb dieser Schicht: {{times}}. Wählen Sie eine Uhrzeit innerhalb der Schichtzeiten.',
    it: "Fuori da questo turno: {{times}}. Scegli un'ora dentro l'orario del turno.",
    pt: 'Fora deste plantão: {{times}}. Escolha um horário dentro do plantão.',
    'pt-PT': 'Fora deste turno: {{times}}. Escolha uma hora dentro do turno.',
  },
};

describe('shift add forms: the new copy, every language', () => {
  for (const [key, byLang] of Object.entries(WANT)) {
    it.each(Object.entries(byLang))(`${key} (%s)`, (lang, text) => {
      expect(copy(lang, key)).toBe(text);
    });
  }

  it.each(Object.keys(BASE))('%s: the outside-times line has {{times}} and French keeps U+202F before ":"', (lang) => {
    const text = copy(lang, 'tasks.form.errorOutsideTimes');
    expect(text).toContain('{{times}}');
    if (lang.startsWith('fr')) expect(text).toMatch(new RegExp(`${NB}: \\{\\{times\\}\\}`));
  });

  it.each(Object.keys(BASE))('%s FIX 3: the chip carries no hours and no {{window}}', (lang) => {
    const chip = copy(lang, 'tasks.editor.onShift');
    expect(chip).toContain('{{shift}}');
    expect(chip).not.toMatch(/window|·|\d/);
  });

  it('N the bare outside line is kept for the no-time-picked case, and the old locked text is gone', () => {
    expect(copy('en', 'tasks.form.errorOutside')).toBe('Pick a time inside this shift.');
    for (const lang of Object.keys(BASE)) {
      expect(copy(lang, 'add.lockedHint')).not.toMatch(/^(Locked to shift|Fijado al turno|Lié à la garde|Lié au quart|An die Schicht gebunden|Legato al turno|Fixado no)/);
    }
  });
});
