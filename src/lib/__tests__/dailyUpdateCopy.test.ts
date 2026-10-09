import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import i18n from '@/i18n';
import type { DailyUpdateData, DailyUpdateDoseDetail } from '@/api/dailyUpdate';
import {
  buildClauses,
  buildDetailLine,
  buildGlance,
  buildLead,
  capitalizeFirst,
  doseStatusLine,
  formatItemTime,
  leadKindOf,
  countsOf,
  noteFromLine,
  startsWithISound,
} from '../dailyUpdateCopy';

/**
 * Design v2 "B2" sentence templates (docs/plans/daily-update.md; prototype
 * e2e/harness/dailyUpdateDirections.tsx buildSummary()/clausesOf()): every lead
 * variant and clause in EN + ES, zero counts omitted, a skip never "Taken",
 * nothing says "missed".
 */
const tFor = (lng: string) => i18n.getFixedT(lng, 'dailyUpdate');
const en = tFor('en');
const es = tFor('es');

type Doses = DailyUpdateData['doses'];
const D = (over: Partial<Doses> = {}): Doses => ({
  taken: 0,
  taken_late: 0,
  skipped: 0,
  not_marked: 0,
  upcoming: 0,
  ...over,
});

function make(over: Partial<DailyUpdateData> = {}): DailyUpdateData {
  return {
    enabled: true,
    date: '2026-10-08',
    is_today: true,
    timezone: 'America/New_York',
    window: { opens_at: '2026-10-08T23:00:00Z', closes_at: '2026-10-09T04:00:00Z' },
    eligible: true,
    has_activity: true,
    recipient_name: 'Luis',
    is_solo: false,
    doses: D(),
    as_needed: null,
    tasks: { done: 0 },
    appointments: { past_count: 0 },
    notes: { count: 0, authors: [], more_authors: 0 },
    still_to_do: [],
    still_to_do_more: 0,
    ...over,
  };
}

/** The prototype's B2 evening: 1 taken, 1 late, 1 skipped, 1 to come; 2 tasks, 1 appointment, Jennie's note. */
const B2_TODAY = make({
  doses: D({ taken: 1, taken_late: 1, skipped: 1, upcoming: 1 }),
  tasks: { done: 2 },
  appointments: { past_count: 1 },
  notes: { count: 1, authors: ['Jennie'], more_authors: 0 },
});

describe('lead sentence — every variant, EN + ES', () => {
  const cases: Array<[string, DailyUpdateData, boolean, string, string]> = [
    ['nothing today', make(), false, 'Nothing for Luis yet today.', 'Nada registrado para Luis todavía.'],
    ['nothing past', make(), true, 'Nothing was recorded for Luis.', 'No se registró nada para Luis.'],
    [
      'quiet (no dose due) today',
      make({ tasks: { done: 1 } }),
      false,
      'A quiet day for Luis so far.',
      'Un día en calma para Luis, por ahora.',
    ],
    [
      'quiet on a past day drops "so far"',
      make({ notes: { count: 1, authors: ['Ana'], more_authors: 0 } }),
      true,
      'A quiet day for Luis.',
      'Un día en calma para Luis.',
    ],
    [
      'smooth (all on time)',
      make({ doses: D({ taken: 3, upcoming: 1 }) }),
      false,
      'A smooth day for Luis.',
      'Un día tranquilo para Luis.',
    ],
    ['steady (2/3 ok, one late)', B2_TODAY, false, 'A steady day for Luis.', 'Un día estable para Luis.'],
    [
      'mixed (under 2/3)',
      make({ doses: D({ taken: 1, skipped: 1, not_marked: 1 }) }),
      false,
      'A mixed day for Luis.',
      'Un día irregular para Luis.',
    ],
  ];
  it.each(cases)('%s', (_label, data, past, enText, esText) => {
    expect(buildLead(data, en, past)).toBe(enText);
    expect(buildLead(data, es, past)).toBe(esText);
  });

  it('one late dose with nothing skipped is steady, not smooth', () => {
    expect(leadKindOf(countsOf(make({ doses: D({ taken: 2, taken_late: 1 }) })))).toBe(
      'steady'
    );
  });

  it('exactly 2/3 is steady; just under is mixed', () => {
    expect(leadKindOf(countsOf(make({ doses: D({ taken: 2, skipped: 1 }) })))).toBe('steady');
    expect(leadKindOf(countsOf(make({ doses: D({ taken: 1, skipped: 1 }) })))).toBe('mixed');
  });

  it('only upcoming doses and nothing else is still "nothing yet"', () => {
    expect(buildLead(make({ doses: D({ upcoming: 2 }) }), en, false)).toBe(
      'Nothing for Luis yet today.'
    );
  });

  it('an as-needed dose given counts as something happening', () => {
    expect(buildLead(make({ as_needed: { given: 1 } }), en, false)).toBe(
      'A quiet day for Luis so far.'
    );
  });

  it('falls back to "your loved one" when the recipient has no name', () => {
    expect(buildLead(make({ recipient_name: '  ' }), en, true)).toBe(
      'Nothing was recorded for your loved one.'
    );
  });
});

describe('detail clauses (card line, joined " · ")', () => {
  it('B2 evening, EN + ES', () => {
    expect(buildDetailLine(B2_TODAY, en, 'en')).toBe(
      'Most doses taken · 2 tasks done · an appointment · Jennie left a note'
    );
    expect(buildDetailLine(B2_TODAY, es, 'es')).toBe(
      'Casi todas las dosis tomadas · 2 tareas hechas · una cita · Jennie dejó una nota'
    );
  });

  it('dose clause variants', () => {
    const c = (d: Partial<Doses>) => buildClauses(make({ doses: D(d) }), en)[0];
    expect(c({ taken: 3 })).toBe('all doses on time');
    expect(c({ taken: 2, taken_late: 1 })).toBe('every dose taken');
    expect(c({ taken: 2, skipped: 1 })).toBe('most doses on time');
    expect(c({ taken: 1, taken_late: 1, skipped: 1 })).toBe('most doses taken');
    expect(c({ taken: 1, skipped: 1, not_marked: 1 })).toBe('1 of 3 doses taken');
    expect(buildClauses(make({ doses: D({ skipped: 1 }) }), en)[0]).toBe('0 of 1 dose taken');
    expect(buildClauses(make({ doses: D({ taken: 1, skipped: 1, not_marked: 1 }) }), es)[0]).toBe(
      '1 de 3 dosis tomadas'
    );
  });

  it('adds "N not marked" after the dose clause', () => {
    expect(buildClauses(make({ doses: D({ taken: 3, not_marked: 1 }) }), en)).toEqual([
      'most doses on time',
      '1 not marked',
    ]);
    expect(buildClauses(make({ doses: D({ taken: 4, not_marked: 2 }) }), es)).toEqual([
      'casi todas las dosis a tiempo',
      '2 sin marcar',
    ]);
  });

  it('plurals: tasks and appointments, EN + ES', () => {
    expect(buildClauses(make({ tasks: { done: 1 }, appointments: { past_count: 2 } }), en)).toEqual([
      '1 task done',
      '2 appointments',
    ]);
    expect(buildClauses(make({ tasks: { done: 1 }, appointments: { past_count: 2 } }), es)).toEqual([
      '1 tarea hecha',
      '2 citas',
    ]);
  });

  it('note authors: one (with the note count), two (with the Spanish "e"), many, departed', () => {
    const n = (authors: string[], more = 0, count = authors.length + more) =>
      buildClauses(make({ notes: { count, authors, more_authors: more } }), en)[0];
    expect(n(['Ana'])).toBe('Ana left a note');
    expect(n(['Ana'], 0, 3)).toBe('Ana left 3 notes');
    expect(n(['Ana', 'Luis'])).toBe('Ana and Luis left notes');
    expect(n(['Ana', 'Luis'], 2)).toBe('Ana, Luis and 2 others left notes');
    expect(n(['Ana', 'Luis'], 1)).toBe('Ana, Luis and 1 other left notes');
    expect(n([], 0, 2)).toBe('a former member left 2 notes');
    expect(n(['Ana'], 1)).toBe('Ana and a former member left notes');
    expect(
      buildClauses(make({ notes: { count: 2, authors: ['Ana', 'Isabel'], more_authors: 0 } }), es)[0]
    ).toBe('Ana e Isabel dejaron notas');
    expect(
      buildClauses(make({ notes: { count: 2, authors: ['Ana', 'Luis'], more_authors: 0 } }), es)[0]
    ).toBe('Ana y Luis dejaron notas');
  });

  // The author list is the SUBJECT of the notes clause; "from X" takes the object form.
  // German is where the two differ (nominative "ein ehemaliges Mitglied" vs dative "einem").
  it('departed author: subject form in the notes clause, object form after "from"/"von"', () => {
    const line = (lng: string, authors: string[], more: number, count = 1) =>
      buildDetailLine(make({ notes: { count, authors, more_authors: more } }), tFor(lng));
    expect(line('de', [], 1)).toBe('Ein ehemaliges Mitglied hat eine Notiz hinterlassen');
    expect(line('de', ['Ana'], 1, 2)).toBe('Ana und ein ehemaliges Mitglied haben Notizen hinterlassen');
    expect(line('de', ['Ana', 'Luis'], 2, 4)).toBe('Ana, Luis und 2 weitere haben Notizen hinterlassen');
    expect(line('de', ['Ana', 'Luis'], 1, 3)).toBe('Ana, Luis und 1 weitere Person haben Notizen hinterlassen');
    expect(line('es', [], 1)).toBe('Un exmiembro dejó una nota');
    expect(line('en', [], 1)).toBe('A former member left a note');
    expect(line('fr', [], 1)).toBe('Un ancien membre a laissé une note');
    expect(line('it', [], 1)).toBe('Un ex membro ha lasciato una nota');
    expect(line('pt', [], 1)).toBe('Um ex-membro deixou uma nota');
    // After "von" the dative stays.
    expect(noteFromLine(null, tFor('de'))).toBe('Eine Notiz von einem ehemaligen Mitglied');
    expect(noteFromLine(null, en)).toBe('A note from a former member');
    // French never splices a name after "de" (no "de Anne"; glossary elision rule).
    expect(noteFromLine('Anne', tFor('fr'))).toBe('Une note laissée par Anne');
    expect(noteFromLine(null, tFor('fr-CA'))).toBe('Une note laissée par un ancien membre');
  });

  it('omits every zero count and is null when empty', () => {
    expect(buildClauses(make(), en)).toEqual([]);
    expect(buildDetailLine(make(), en)).toBeNull();
    expect(buildDetailLine(make({ tasks: { done: 2 } }), en)).not.toMatch(/\b0\b/);
  });
});

describe('page glance line', () => {
  it('today: "so far", skipped and to come (B2), EN + ES', () => {
    expect(buildGlance(B2_TODAY, en, false)).toBe(
      '2 of 3 doses taken so far · 1 skipped · 1 to come'
    );
    expect(buildGlance(B2_TODAY, es, false)).toBe(
      '2 de 3 dosis tomadas hasta ahora · 1 omitida · 1 pendiente'
    );
  });

  it('past day: no "so far", not marked counted', () => {
    const past = make({ is_today: false, doses: D({ taken: 3, not_marked: 1 }) });
    expect(buildGlance(past, en, true)).toBe('3 of 4 doses taken · 1 not marked');
    expect(buildGlance(past, es, true)).toBe('3 de 4 dosis tomadas · 1 sin marcar');
  });

  it('a day without doses has no glance line (the sections say the rest)', () => {
    expect(buildGlance(make({ tasks: { done: 2 } }), en, false)).toBeNull();
    expect(buildGlance(make(), en, true)).toBeNull();
  });

  it('only doses still to come', () => {
    expect(buildGlance(make({ doses: D({ upcoming: 2 }) }), en, false)).toBe('2 to come');
  });
});

describe('dose status lines', () => {
  const time = (v: string | null) => formatItemTime(v, 'America/New_York', '12h', 'en');
  const dose = (over: Partial<DailyUpdateDoseDetail>): DailyUpdateDoseDetail => ({
    event_id: 'e1',
    medication_id: 'm1',
    medication_name: 'Metformin',
    dosage: null,
    time: '13:00',
    status: 'taken',
    marked_by_name: 'Luis',
    marked_at: '13:05',
    ...over,
  });

  it('taken / late / skipped / not marked / coming up (EN)', () => {
    expect(doseStatusLine(dose({ marked_by_name: 'Jennie' }), en, time)).toBe('Taken by Jennie');
    expect(doseStatusLine(dose({ status: 'taken_late', marked_at: '14:10' }), en, time)).toBe(
      'Taken by Luis at 2:10 PM, a little late'
    );
    expect(doseStatusLine(dose({ status: 'skipped' }), en, time)).toBe('Skipped by Luis');
    expect(doseStatusLine(dose({ status: 'not_marked', marked_by_name: null }), en, time)).toBe(
      'Not marked'
    );
    expect(doseStatusLine(dose({ status: 'upcoming', marked_by_name: null }), en, time)).toBe(
      'Coming up'
    );
  });

  it('a skip never says "Taken"; a departed marker is "someone"; late without a time', () => {
    expect(doseStatusLine(dose({ status: 'skipped' }), en, time)).not.toMatch(/taken/i);
    expect(doseStatusLine(dose({ marked_by_name: null }), en, time)).toBe('Taken by someone');
    expect(doseStatusLine(dose({ status: 'taken_late', marked_at: null }), en, time)).toBe(
      'Taken by Luis, a little late'
    );
  });

  it('ES', () => {
    const esTime = (v: string | null) => formatItemTime(v, 'America/New_York', '12h', 'es');
    expect(doseStatusLine(dose({ marked_by_name: 'Jennie' }), es, esTime)).toBe(
      'Tomada, marcó Jennie'
    );
    expect(doseStatusLine(dose({ status: 'skipped' }), es, esTime)).toBe('Omitida, marcó Luis');
    expect(doseStatusLine(dose({ status: 'taken_late', marked_at: '14:10' }), es, esTime)).toMatch(
      /^Tomada a las 2:10 p\. m\., un poco tarde, marcó Luis$/
    );
  });
});

describe('helpers', () => {
  it('startsWithISound', () => {
    expect(startsWithISound('Isabel')).toBe(true);
    expect(startsWithISound('Hilda')).toBe(true);
    expect(startsWithISound('Íñigo')).toBe(true);
    expect(startsWithISound('Hielo')).toBe(false);
    expect(startsWithISound('Yolanda')).toBe(false);
    expect(startsWithISound('Ana')).toBe(false);
  });

  it('capitalizeFirst', () => {
    expect(capitalizeFirst('jueves, 8 oct', 'es')).toBe('Jueves, 8 oct');
    expect(capitalizeFirst('', 'en')).toBe('');
  });

  it('formatItemTime: wall time in the reader\'s cycle; ISO instant in the recipient zone', () => {
    expect(formatItemTime('20:00', 'America/New_York', '12h')).toBe('8:00 PM');
    expect(formatItemTime('21:15:00', 'America/New_York', '24h')).toBe('21:15');
    expect(formatItemTime('2026-10-09T00:30:00Z', 'America/New_York', '12h')).toBe('8:30 PM');
    expect(formatItemTime('2026-10-09T00:30:00Z', 'Asia/Kolkata', '24h')).toBe('06:00');
    expect(formatItemTime(null, 'America/New_York', '12h')).toBeNull();
    expect(formatItemTime('garbage', 'America/New_York', '12h')).toBeNull();
  });
});

describe('dailyUpdate namespace wording (every locale on disk)', () => {
  const DIR = join(process.cwd(), 'src', 'i18n');
  const codes = readdirSync(DIR).filter((c) => {
    try {
      return readdirSync(join(DIR, c)).includes('dailyUpdate.json');
    } catch {
      return false;
    }
  });

  it('exists for all eight locales', () => {
    expect(codes.sort()).toEqual(['de', 'en', 'es', 'fr', 'fr-CA', 'it', 'pt', 'pt-PT']);
  });

  it.each(codes)('%s never says "missed" or "forgot" and carries no emoji', (code) => {
    const raw = readFileSync(join(DIR, code, 'dailyUpdate.json'), 'utf8');
    expect(raw).not.toMatch(/missed|forgot|olvid|perdid|oubli|vergessen|dimentic|esquec/i);
    expect(raw).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it.each(['fr', 'de', 'it', 'pt', 'pt-PT', 'fr-CA'])(
    '%s renders every lead and the B2 detail line without a raw key',
    (code) => {
      const t = tFor(code);
      const line = buildDetailLine(B2_TODAY, t, code);
      expect(line).not.toMatch(/clause\.|lead\.|\{\{/);
      expect(buildGlance(B2_TODAY, t, false)).not.toMatch(/glance\.|\{\{/);
      for (const past of [false, true]) {
        expect(buildLead(B2_TODAY, t, past)).toContain('Luis');
        expect(buildLead(make(), t, past)).toContain('Luis');
      }
    }
  );

  it('the turn-off confirm says it also turns off tips (EN + ES)', () => {
    expect(en('turnOffConfirm.body')).toMatch(/also turns off tips/);
    expect(es('turnOffConfirm.body')).toMatch(/desactivan los consejos/);
  });
});
