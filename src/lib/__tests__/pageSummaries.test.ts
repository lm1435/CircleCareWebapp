import i18n from '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { CareNote } from '@/api/careNotes';
import type { HealthVital, LatestVitals } from '@/api/vitals';
import {
  activitySummary,
  calendarSummary,
  documentsSummary,
  notesSummary,
  tasksSummary,
  vitalsSummary,
} from '../pageSummaries';

const t = (key: string, opts?: Record<string, unknown>): string => i18n.t(key, opts) as string;

function ev(over: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'e',
    circle_id: 'c',
    event_type: 'task',
    title: 'x',
    scheduled_date: '2026-03-17',
    scheduled_time: null,
    created_at: '',
    updated_at: '',
    ...over,
  };
}

describe('page summaries (en)', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });
  afterAll(async () => {
    await i18n.changeLanguage('en');
  });

  describe('calendarSummary', () => {
    const events = [
      ev({ id: '1', event_type: 'medication' }),
      ev({ id: '2', event_type: 'medication' }),
      ev({ id: '3', event_type: 'medication' }),
      ev({ id: '4', event_type: 'appointment' }),
      ev({ id: '5', event_type: 'task', scheduled_date: '2026-03-18' }),
    ];
    const day = (d: string) => (x: string) => x === d;

    it('day, today: "3 doses and 1 appointment today"', () => {
      expect(
        calendarSummary(t, events, { view: 'day', isToday: true, inRange: day('2026-03-17'), locale: 'en' })
      ).toBe('3 doses and 1 appointment today');
    });
    it('day, another day', () => {
      expect(
        calendarSummary(t, events, { view: 'day', isToday: false, inRange: day('2026-03-18'), locale: 'en' })
      ).toBe('1 task on this day');
    });
    it('week and month use their own scope; three kinds read as a list', () => {
      expect(
        calendarSummary(t, events, { view: 'week', isToday: false, inRange: () => true, locale: 'en' })
      ).toBe('3 doses, 1 appointment, and 1 task this week');
      expect(
        calendarSummary(t, events, { view: 'month', isToday: false, inRange: () => true, locale: 'en' })
      ).toBe('3 doses, 1 appointment, and 1 task this month');
    });
    it('empty variants, per view', () => {
      const opts = { isToday: false, inRange: () => false, locale: 'en' };
      expect(calendarSummary(t, events, { ...opts, view: 'day', isToday: true })).toBe('Nothing scheduled today');
      expect(calendarSummary(t, events, { ...opts, view: 'day' })).toBe('Nothing scheduled on this day');
      expect(calendarSummary(t, events, { ...opts, view: 'week' })).toBe('Nothing scheduled this week');
      expect(calendarSummary(t, events, { ...opts, view: 'month' })).toBe('Nothing scheduled this month');
    });
  });

  describe('tasksSummary', () => {
    const open = (id: string, date: string) => ev({ id, scheduled_date: date, completed_at: null });
    it('"4 open · 1 due today"', () => {
      const tasks = [open('1', '2026-03-17'), open('2', '2026-03-20'), open('3', '2026-03-21'), open('4', '2026-03-22')];
      expect(tasksSummary(t, tasks, { status: 'open', today: '2026-03-17' })).toBe('4 open · 1 due today');
    });
    it('omits "due today" when nothing is due; counts only open rows on All', () => {
      const tasks = [open('1', '2026-03-20'), ev({ id: '2', completed_at: '2026-03-01T00:00:00Z' })];
      expect(tasksSummary(t, tasks, { status: 'all', today: '2026-03-17' })).toBe('1 open');
    });
    it('empty variants and the Completed filter', () => {
      expect(tasksSummary(t, [], { status: 'open', today: '2026-03-17' })).toBe('Nothing open right now');
      expect(tasksSummary(t, [], { status: 'completed', today: '2026-03-17' })).toBe('None completed yet');
      expect(tasksSummary(t, [ev({}), ev({ id: '2' })], { status: 'completed', today: undefined })).toBe('2 completed');
    });
  });

  describe('notesSummary', () => {
    const note = (over: Partial<CareNote>): CareNote =>
      ({
        id: 'n',
        circle_id: 'c',
        author_id: 'u',
        note_date: '2026-03-17',
        body: 'b',
        mood: null,
        categories: [],
        created_at: '2026-03-17T20:10:00Z',
        updated_at: '2026-03-17T20:10:00Z',
        author: { id: 'u', first_name: 'Jordan', last_name: null },
        ...over,
      }) as CareNote;
    const fmt = { formatTime: () => '2:10 PM', formatDate: () => 'Mar 15' };

    it('today / yesterday / earlier, newest note, with the author', () => {
      expect(notesSummary(t, [note({})], { today: '2026-03-17', ...fmt })).toBe('Last note today at 2:10 PM by Jordan');
      expect(notesSummary(t, [note({ note_date: '2026-03-16' })], { today: '2026-03-17', ...fmt })).toBe(
        'Last note yesterday at 2:10 PM by Jordan'
      );
      expect(notesSummary(t, [note({ note_date: '2026-03-15' })], { today: '2026-03-17', ...fmt })).toBe(
        'Last note on Mar 15 at 2:10 PM by Jordan'
      );
    });
    it('picks the newest by created_at; a departed author reads "Former member"; empty', () => {
      const older = note({ id: 'a', created_at: '2026-03-10T10:00:00Z' });
      const newer = note({ id: 'b', author: null });
      expect(notesSummary(t, [older, newer], { today: '2026-03-17', ...fmt })).toContain('by Former member');
      expect(notesSummary(t, [], { today: '2026-03-17', ...fmt })).toBe('Nothing written yet');
    });
  });

  describe('vitalsSummary', () => {
    const reading = (type: HealthVital['vital_type'], at: string): HealthVital =>
      ({ id: type, circle_id: 'c', vital_type: type, value1: 1, value2: null, unit: '', recorded_at: at }) as HealthVital;
    const latest = (over: Partial<LatestVitals>): LatestVitals =>
      ({ blood_pressure: null, heart_rate: null, glucose: null, weight: null, ...over }) as LatestVitals;
    const opts = {
      today: '2026-03-17',
      toWall: (iso: string) => ({ date: iso.slice(0, 10), time: iso.slice(11, 16) }),
      formatTime: () => '8:05 AM',
      formatDate: () => 'Mar 10',
      locale: 'en',
    };
    it('"Last reading: blood pressure, today 8:05 AM" - the newest across types', () => {
      const l = latest({
        blood_pressure: reading('blood_pressure', '2026-03-17T08:05:00Z'),
        weight: reading('weight', '2026-03-12T08:05:00Z'),
      });
      expect(vitalsSummary(t, l, opts)).toBe('Last reading: blood pressure, today 8:05 AM');
    });
    it('yesterday, earlier and empty', () => {
      const y = latest({ glucose: reading('glucose', '2026-03-16T08:05:00Z') });
      expect(vitalsSummary(t, y, opts)).toBe('Last reading: glucose, yesterday 8:05 AM');
      const o = latest({ weight: reading('weight', '2026-03-10T08:05:00Z') });
      expect(vitalsSummary(t, o, opts)).toBe('Last reading: weight, Mar 10 8:05 AM');
      expect(vitalsSummary(t, latest({}), opts)).toBe('Nothing logged yet');
      expect(vitalsSummary(t, undefined, opts)).toBe('Nothing logged yet');
    });
  });

  it('documentsSummary: plural count and empty', () => {
    expect(documentsSummary(t, 1)).toBe('1 document');
    expect(documentsSummary(t, 12)).toBe('12 documents');
    expect(documentsSummary(t, 0)).toBe('Nothing uploaded yet');
  });

  describe('activitySummary', () => {
    const now = new Date('2026-03-17T12:00:00Z');
    const at = (daysAgo: number) => ({ created_at: new Date(now.getTime() - daysAgo * 86_400_000).toISOString() });
    it('counts the last 7 days; a floor ("+") while more pages exist and all loaded rows are inside the week', () => {
      expect(activitySummary(t, [at(0), at(2), at(9)], { now, hasMore: false })).toBe('2 updates this week');
      expect(activitySummary(t, [at(1)], { now, hasMore: false })).toBe('1 update this week');
      expect(activitySummary(t, [at(0), at(1)], { now, hasMore: true })).toBe('2+ updates this week');
      expect(activitySummary(t, [at(0), at(9)], { now, hasMore: true })).toBe('1 update this week');
      expect(activitySummary(t, [at(9)], { now, hasMore: false })).toBe('No updates this week');
    });
  });
});

describe('page summaries (es, de, pt)', () => {
  afterAll(async () => {
    await i18n.changeLanguage('en');
  });
  it('Spanish plurals and word order', async () => {
    await i18n.changeLanguage('es');
    const tasks = [ev({ id: '1', scheduled_date: '2026-03-17' }), ev({ id: '2', scheduled_date: '2026-03-17' })];
    expect(tasksSummary(t, tasks, { status: 'open', today: '2026-03-17' })).toBe('2 abiertas · 2 vencen hoy');
    expect(tasksSummary(t, [tasks[0]], { status: 'open', today: '2026-03-17' })).toBe('1 abierta · 1 vence hoy');
  });
  it('German keeps the capital on the vital type; Portuguese 0/1 read as a label', async () => {
    await i18n.changeLanguage('de');
    const l = { blood_pressure: { vital_type: 'blood_pressure', recorded_at: '2026-03-17T08:05:00Z' } } as unknown as LatestVitals;
    expect(
      vitalsSummary(t, l, {
        today: '2026-03-17',
        toWall: () => ({ date: '2026-03-17', time: '08:05' }),
        formatTime: () => '08:05',
        formatDate: () => '',
        locale: 'de',
      })
    ).toBe('Letzte Messung: Blutdruck, heute 08:05');
    await i18n.changeLanguage('pt');
    expect(documentsSummary(t, 0)).toBe('Nada enviado ainda');
    expect(tasksSummary(t, [ev({ completed_at: null })], { status: 'open', today: undefined })).toBe('Abertas: 1');
  });
});
