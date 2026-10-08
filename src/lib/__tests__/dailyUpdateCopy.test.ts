import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import i18n from '@/i18n';
import type { DailyUpdateData } from '@/api/dailyUpdate';
import {
  buildSummaryLines,
  formatItemTime,
  formatNoteAuthors,
  formatStillToDoItem,
  startsWithISound,
} from '../dailyUpdateCopy';

/**
 * Copy twins of the mobile DailyUpdateCard cases (plan §8.2/§8.3): every line and
 * plural in EN + ES, zero counts omitted, a skip never says "Taken", nothing says
 * "missed", and the Spanish "y → e" name rule.
 */
const tFor = (lng: string) => i18n.getFixedT(lng, 'dailyUpdate');
const en = tFor('en');
const es = tFor('es');

function make(over: Partial<DailyUpdateData> = {}): DailyUpdateData {
  return {
    enabled: true,
    date: '2026-10-08',
    is_today: true,
    timezone: 'America/New_York',
    window: { opens_at: '2026-10-08T23:00:00Z', closes_at: '2026-10-09T04:00:00Z' },
    eligible: true,
    has_activity: true,
    recipient_name: 'Rose',
    is_solo: false,
    doses: { taken: 0, taken_late: 0, skipped: 0, not_marked: 0, upcoming: 0 },
    as_needed: null,
    tasks: { done: 0 },
    appointments: { past_count: 0 },
    notes: { count: 0, authors: [], more_authors: 0 },
    still_to_do: [],
    still_to_do_more: 0,
    ...over,
  };
}

const texts = (d: DailyUpdateData, t = en, past = false): string[] =>
  buildSummaryLines(d, t, past).map((l) => l.text);

describe('buildSummaryLines', () => {
  it('omits every zero count (nothing reads "0 doses")', () => {
    expect(texts(make())).toEqual([]);
    expect(texts(make({ as_needed: { given: 0 } }))).toEqual([]);
  });

  it('renders singular and plural EN lines in the plan order', () => {
    const one = make({
      doses: { taken: 1, taken_late: 1, skipped: 1, not_marked: 1, upcoming: 3 },
      as_needed: { given: 1 },
      tasks: { done: 1 },
      appointments: { past_count: 1 },
      notes: { count: 1, authors: ['Ana'], more_authors: 0 },
    });
    expect(texts(one)).toEqual([
      '1 dose taken',
      '1 dose taken late',
      '1 dose skipped',
      '1 dose not marked yet',
      '1 as-needed dose given',
      '1 task done',
      '1 appointment today',
      '1 note from Ana',
    ]);
    const many = make({
      doses: { taken: 3, taken_late: 2, skipped: 2, not_marked: 4, upcoming: 0 },
      as_needed: { given: 2 },
      tasks: { done: 5 },
      appointments: { past_count: 2 },
      notes: { count: 3, authors: ['Ana', 'Luis'], more_authors: 0 },
    });
    expect(texts(many)).toEqual([
      '3 doses taken',
      '2 doses taken late',
      '2 doses skipped',
      '4 doses not marked yet',
      '2 as-needed doses given',
      '5 tasks done',
      '2 appointments today',
      '3 notes from Ana and Luis',
    ]);
  });

  it('renders the ES lines', () => {
    const d = make({
      doses: { taken: 1, taken_late: 2, skipped: 1, not_marked: 2, upcoming: 0 },
      tasks: { done: 2 },
      appointments: { past_count: 1 },
      notes: { count: 2, authors: ['Ana', 'Luis'], more_authors: 1 },
    });
    expect(texts(d, es)).toEqual([
      '1 dosis tomada',
      '2 dosis tomadas tarde',
      '1 dosis omitida',
      '2 dosis sin marcar',
      '2 tareas completadas',
      '1 cita hoy',
      '2 notas de Ana, Luis y 1 más',
    ]);
  });

  it('a past day says "not marked" (not "yet") and "that day"', () => {
    const d = make({
      is_today: false,
      doses: { taken: 0, taken_late: 0, skipped: 0, not_marked: 2, upcoming: 0 },
      appointments: { past_count: 1 },
    });
    expect(texts(d, en, true)).toEqual(['2 doses not marked', '1 appointment that day']);
  });

  it('shows the as-needed line only when the circle has as-needed medications', () => {
    expect(texts(make({ as_needed: null, tasks: { done: 1 } }))).toEqual(['1 task done']);
    expect(texts(make({ as_needed: { given: 3 } }))).toEqual(['3 as-needed doses given']);
  });

  it('a skipped dose is never folded into taken and never says "Taken"', () => {
    const lines = texts(make({ doses: { taken: 0, taken_late: 0, skipped: 2, not_marked: 0, upcoming: 0 } }));
    expect(lines).toEqual(['2 doses skipped']);
    expect(lines.join(' ')).not.toMatch(/taken/i);
  });
});

describe('formatNoteAuthors', () => {
  const n = (authors: string[], more = 0) => ({ count: 1, authors, more_authors: more });

  it('one, two, many and nobody', () => {
    expect(formatNoteAuthors(n(['Ana']), en)).toBe('Ana');
    expect(formatNoteAuthors(n(['Ana', 'Luis']), en)).toBe('Ana and Luis');
    expect(formatNoteAuthors(n(['Ana', 'Luis'], 1), en)).toBe('Ana, Luis and 1 other');
    expect(formatNoteAuthors(n(['Ana', 'Luis'], 3), en)).toBe('Ana, Luis and 3 others');
    expect(formatNoteAuthors(n([]), en)).toBe('a former member');
    expect(formatNoteAuthors(n([]), es)).toBe('un exmiembro');
  });

  it('names a departed author that could not be resolved as a former member', () => {
    expect(formatNoteAuthors(n(['Ana'], 1), en)).toBe('Ana and a former member');
    expect(formatNoteAuthors(n(['Ana'], 3), en)).toBe('Ana, a former member and 2 others');
  });

  it('Spanish writes "e" before an /i/ sound ("Ana e Isabel"), "y" otherwise', () => {
    expect(formatNoteAuthors(n(['Ana', 'Isabel']), es)).toBe('Ana e Isabel');
    expect(formatNoteAuthors(n(['Luis', 'Hilda']), es)).toBe('Luis e Hilda');
    expect(formatNoteAuthors(n(['Ana', 'Íñigo']), es)).toBe('Ana e Íñigo');
    expect(formatNoteAuthors(n(['Ana', 'Luis']), es)).toBe('Ana y Luis');
    expect(formatNoteAuthors(n(['Ana', 'Hiedra']), es)).toBe('Ana y Hiedra');
    // English never changes its conjunction.
    expect(formatNoteAuthors(n(['Ana', 'Isabel']), en)).toBe('Ana and Isabel');
  });

  it('startsWithISound', () => {
    expect(startsWithISound('Isabel')).toBe(true);
    expect(startsWithISound(' hilda')).toBe(true);
    expect(startsWithISound('Ignacio')).toBe(true);
    expect(startsWithISound('Hielo')).toBe(false);
    expect(startsWithISound('Yolanda')).toBe(false);
    expect(startsWithISound('Elena')).toBe(false);
  });
});

describe('still-to-do items', () => {
  const opts = { timezone: 'America/New_York', cycle: '12h' as const, past: false };

  it('formats each kind with the reader\'s hour cycle', () => {
    expect(
      formatStillToDoItem(
        { kind: 'dose', id: 'e1', title: 'Metformin', time: '20:00:00', status: 'upcoming' },
        en,
        opts
      )
    ).toBe('8:00 PM · Metformin');
    expect(
      formatStillToDoItem(
        { kind: 'dose', id: 'e2', title: 'Lisinopril', time: '19:30', status: 'not_marked' },
        en,
        opts
      )
    ).toBe('7:30 PM · Lisinopril · Not marked');
    expect(
      formatStillToDoItem(
        { kind: 'task', id: 't1', title: 'Groceries', time: null, status: 'open' },
        en,
        opts
      )
    ).toBe('Groceries · Due today');
    expect(
      formatStillToDoItem(
        { kind: 'appointment', id: 'a1', title: 'Dr. Lee', time: '21:15', status: 'upcoming' },
        en,
        { ...opts, cycle: '24h' }
      )
    ).toBe('21:15 · Dr. Lee');
  });

  it('an all-day appointment has no time prefix', () => {
    expect(
      formatStillToDoItem(
        { kind: 'appointment', id: 'a2', title: 'Clinic', time: null, status: 'upcoming' },
        en,
        opts
      )
    ).toBe('Clinic');
  });

  it('ES: "Sin marcar" and "Para hoy", with the Spanish meridiem', () => {
    expect(
      formatStillToDoItem(
        { kind: 'dose', id: 'e2', title: 'Lisinopril', time: '19:30', status: 'not_marked' },
        es,
        { ...opts, language: 'es' }
      )
    ).toMatch(/^7:30 p\. m\. · Lisinopril · Sin marcar$/);
    expect(
      formatStillToDoItem(
        { kind: 'task', id: 't1', title: 'Compras', time: null, status: 'open' },
        es,
        opts
      )
    ).toBe('Compras · Para hoy');
  });

  it('a past day drops "Due today" from an open task', () => {
    expect(
      formatStillToDoItem(
        { kind: 'task', id: 't1', title: 'Groceries', time: null, status: 'open' },
        en,
        { ...opts, past: true }
      )
    ).toBe('Groceries');
  });

  it('accepts an ISO instant and renders it in the recipient zone', () => {
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

  it('the turn-off confirm says it also turns off tips (EN + ES)', () => {
    expect(en('turnOffConfirm.body')).toMatch(/also turns off tips/);
    expect(es('turnOffConfirm.body')).toMatch(/desactivan los consejos/);
  });
});
