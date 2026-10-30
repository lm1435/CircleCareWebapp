import { describe, expect, it } from 'vitest';
import { buildNextUp } from '../nextUpItems';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { TodaysMedication } from '@/api/medicationConfirmations';

// Pure ordering and "late" rules for Today's Next up. "Now" is pinned, so the
// suite never depends on the machine's clock or zone (dev machine = Denver).

const TZ = 'America/Denver';
const TODAY = '2026-10-28';
// 10:00 AM in Denver (MDT, UTC-6).
const NOW = new Date('2026-10-28T16:00:00Z');

const med = (id: string, time: string | null, over: Partial<TodaysMedication> = {}): TodaysMedication =>
  ({
    id,
    event_type: 'medication',
    title: `title-${id}`,
    medication_name: `Med ${id}`,
    medication_dosage: '10mg',
    scheduled_date: TODAY,
    scheduled_time: time,
    ...over,
  }) as TodaysMedication;

const ev = (id: string, type: 'appointment' | 'task', time: string | null, over: Partial<CalendarEvent> = {}): CalendarEvent =>
  ({
    id,
    event_type: type,
    title: `${type}-${id}`,
    scheduled_date: TODAY,
    scheduled_time: time,
    ...over,
  }) as CalendarEvent;

const build = (input: Partial<Parameters<typeof buildNextUp>[0]>) =>
  buildNextUp({ meds: [], events: [], tasks: [], timezone: TZ, today: TODAY, now: NOW, ...input });

describe('buildNextUp', () => {
  it('merges doses, appointments and tasks in time order', () => {
    const items = build({
      meds: [med('m2', '20:00:00'), med('m1', '08:00:00')],
      events: [ev('a1', 'appointment', '14:30:00')],
      tasks: [ev('t1', 'task', '12:00:00')],
    });
    expect(items.map((i) => i.key)).toEqual([
      'medication:m1',
      'task:t1',
      'appointment:a1',
      'medication:m2',
    ]);
  });

  it('untimed items go after timed ones on the same day', () => {
    const items = build({
      meds: [med('m1', '23:00:00')],
      tasks: [ev('t1', 'task', null)],
    });
    expect(items.map((i) => i.type)).toEqual(['medication', 'task']);
  });

  it('a dose already answered is not next up; one marked missed still is', () => {
    const items = build({
      meds: [
        med('taken', '08:00:00', { confirmation: { status: 'taken', confirmed_at: 'x', confirmed_by: 'u' } }),
        med('skipped', '08:00:00', { confirmation: { status: 'skipped', confirmed_at: 'x', confirmed_by: 'u' } }),
        med('auto', '08:00:00', { confirmation: { status: 'missed', confirmed_at: 'x', confirmed_by: 'u' } }),
      ],
    });
    expect(items.map((i) => i.id)).toEqual(['auto']);
  });

  it('as-needed (PRN) rows are never doses', () => {
    expect(build({ meds: [med('prn', null, { as_needed: true })] })).toEqual([]);
  });

  it('only TODAY\'s upcoming appointments: not tomorrow, not finished, not already past', () => {
    const items = build({
      events: [
        ev('later', 'appointment', '14:30:00'),
        ev('tomorrow', 'appointment', '09:00:00', { scheduled_date: '2026-10-29' }),
        ev('done', 'appointment', '15:00:00', { completed_at: '2026-10-28T00:00:00Z' }),
        ev('past', 'appointment', '09:00:00'),
        ev('note', 'task', '15:00:00'),
      ],
    });
    expect(items.map((i) => i.id)).toEqual(['later']);
  });

  it('tasks: due today or overdue, not future, not completed', () => {
    const items = build({
      tasks: [
        ev('overdue', 'task', null, { scheduled_date: '2026-10-26' }),
        ev('today', 'task', '18:00:00'),
        ev('future', 'task', '09:00:00', { scheduled_date: '2026-10-30' }),
        ev('done', 'task', '09:00:00', { completed_at: 'x' }),
      ],
    });
    expect(items.map((i) => i.id)).toEqual(['overdue', 'today']);
    expect(items[0].late).toBe(true);
  });

  it('yesterday\'s unanswered dose sorts first and reads late without an hour count', () => {
    const items = build({
      meds: [med('now', '09:00:00'), med('old', '21:00:00', { scheduled_date: '2026-10-27' })],
    });
    expect(items.map((i) => i.id)).toEqual(['old', 'now']);
    expect(items[0]).toMatchObject({ late: true, lateHours: null });
  });

  describe('late is text, with whole hours from one hour on', () => {
    it('10:00 now: an 8:00 dose is 2 hours late', () => {
      const [item] = build({ meds: [med('m', '08:00:00')] });
      expect(item).toMatchObject({ late: true, lateHours: 2 });
    });

    it('a dose 30 minutes past is late but under an hour', () => {
      const [item] = build({ meds: [med('m', '09:30:00')] });
      expect(item).toMatchObject({ late: true, lateHours: null });
    });

    it('a dose later today is not late', () => {
      const [item] = build({ meds: [med('m', '20:00:00')] });
      expect(item).toMatchObject({ late: false, lateHours: null });
    });
  });

  it('breaks ties on key so the order is total', () => {
    const items = build({ meds: [med('b', '20:00:00'), med('a', '20:00:00')] });
    expect(items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('carries the dose as detail and the place for an appointment', () => {
    const items = build({
      meds: [med('m', '20:00:00')],
      events: [ev('a', 'appointment', '14:30:00', { location: 'Valley Clinic' })],
    });
    expect(items.find((i) => i.type === 'medication')?.detail).toBe('10mg');
    expect(items.find((i) => i.type === 'appointment')?.detail).toBe('Valley Clinic');
  });
});
