import type { DailyUpdateData } from '@/api/dailyUpdate';
import {
  appointmentTarget,
  calendarEventPath,
  dailyUpdatePagePath,
  dayNav,
  doseTarget,
  eventPathById,
  latestDailyUpdatePath,
  noteTarget,
  taskTarget,
  tasksRowTarget,
} from '../dailyUpdateLinks';

/** Tap targets, day arrows and the way back (docs/plans/daily-update.md "Design v2 B2"). */

function data(over: Partial<DailyUpdateData> = {}): DailyUpdateData {
  return {
    enabled: true,
    date: '2026-10-08',
    is_today: true,
    timezone: 'America/Denver',
    window: { opens_at: '2026-10-09T01:00:00Z', closes_at: '2026-10-09T06:00:00Z' },
    eligible: true,
    has_activity: true,
    recipient_name: 'Luis',
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

const task = (id: string | null, title = 'Groceries') => ({
  event_id: id,
  title,
  completed_by_name: 'Luis',
  completed_at: '11:20',
});

describe('item targets (existing web routes)', () => {
  it('completed task → the calendar, by id (its date read from the row, never the update date)', () => {
    expect(taskTarget('c1', task('k1'))).toBe('/circles/c1/calendar?eventId=k1');
  });

  it('appointment → the calendar event detail on the update date', () => {
    expect(
      appointmentTarget('c1', '2026-10-08', { event_id: 'a1', title: 'Dr', time: '10:30', location: null })
    ).toBe('/circles/c1/calendar?date=2026-10-08&eventId=a1');
  });

  it('a virtual occurrence id opened by id keeps its own date', () => {
    expect(eventPathById('c1', 'root-1_2026-10-06', 'notes')).toBe(
      '/circles/c1/calendar?date=2026-10-06&eventId=root-1_2026-10-06&panel=notes'
    );
  });

  it('a virtual occurrence id is URL-encoded intact', () => {
    expect(calendarEventPath('c1', '2026-10-08', 'abc_2026-10-08')).toBe(
      '/circles/c1/calendar?date=2026-10-08&eventId=abc_2026-10-08'
    );
  });

  it('care note → that day on Notes; event note → its event, notes panel', () => {
    const base = { note_id: 'n1', author_name: 'Ana', created_at: '16:10', excerpt: 'x' };
    expect(noteTarget('c1', '2026-10-08', { ...base, kind: 'care', event_id: null })).toBe(
      '/circles/c1/notes?date=2026-10-08'
    );
    expect(noteTarget('c1', '2026-10-08', { ...base, kind: 'event', event_id: 'e7' })).toBe(
      '/circles/c1/calendar?eventId=e7&panel=notes'
    );
  });

  it('dose → the medication detail on the Medications page', () => {
    expect(
      doseTarget('c1', {
        event_id: 'd1',
        medication_id: 'm1',
        medication_name: 'Sertraline',
        dosage: null,
        time: '08:00',
        status: 'taken',
        marked_by_name: 'Ana',
        marked_at: '08:00',
      })
    ).toBe('/circles/c1/meds?medication=m1');
  });

  it('a missing target is not a link (null)', () => {
    expect(taskTarget('c1', task(null))).toBeNull();
    expect(
      appointmentTarget('c1', '2026-10-08', { event_id: null, title: 'Dr', time: null, location: null })
    ).toBeNull();
    expect(
      noteTarget('c1', '2026-10-08', {
        note_id: 'n',
        kind: 'event',
        event_id: null,
        author_name: null,
        created_at: '10:00',
        excerpt: '',
      })
    ).toBeNull();
    expect(
      doseTarget('c1', {
        event_id: 'd1',
        medication_id: null,
        medication_name: 'X',
        dosage: null,
        time: null,
        status: 'taken',
        marked_by_name: null,
        marked_at: null,
      })
    ).toBeNull();
  });
});

describe('card tasks row', () => {
  it('exactly one task → that task', () => {
    expect(tasksRowTarget('c1', data({ tasks: { done: 1 }, tasks_done_detail: [task('k1')] }))).toBe(
      '/circles/c1/calendar?eventId=k1'
    );
  });

  it('two or more → the full update at Tasks', () => {
    expect(
      tasksRowTarget('c1', data({ tasks: { done: 2 }, tasks_done_detail: [task('k1'), task('k2')] }))
    ).toBe('/circles/c1/daily-update#tasks');
  });

  it('one task whose target is gone → the full update', () => {
    expect(tasksRowTarget('c1', data({ tasks: { done: 1 }, tasks_done_detail: [task(null)] }))).toBe(
      '/circles/c1/daily-update#tasks'
    );
  });

  it('older backend (counts only) → the full update, no anchor', () => {
    expect(tasksRowTarget('c1', data({ tasks: { done: 1 } }))).toBe('/circles/c1/daily-update');
  });
});

describe('day arrows', () => {
  const today = '2026-10-08';
  it('today: previous day, no next', () => {
    expect(dayNav(today, today)).toEqual({ prev: '2026-10-07', next: null });
  });
  it('a middle day: both', () => {
    expect(dayNav('2026-10-05', today)).toEqual({ prev: '2026-10-04', next: '2026-10-06' });
  });
  it('the oldest day in range (today - 7): no previous', () => {
    expect(dayNav('2026-10-01', today)).toEqual({ prev: null, next: '2026-10-02' });
  });
  it('one day inside the edge still has a previous', () => {
    expect(dayNav('2026-10-02', today).prev).toBe('2026-10-01');
  });
  it('crosses a month boundary', () => {
    expect(dayNav('2026-11-01', '2026-11-03')).toEqual({ prev: '2026-10-31', next: '2026-11-02' });
  });
  it("the server's nav wins when sent", () => {
    expect(dayNav('2026-10-05', today, { prev_date: null, next_date: '2026-10-06' })).toEqual({
      prev: null,
      next: '2026-10-06',
    });
  });
});

describe('the way back: latest update', () => {
  it('19:00+ with activity today → today', () => {
    expect(latestDailyUpdatePath('c1', '2026-10-08', true, true)).toBe('/circles/c1/daily-update');
  });
  it('19:00+ without activity → yesterday', () => {
    expect(latestDailyUpdatePath('c1', '2026-10-08', true, false)).toBe(
      '/circles/c1/daily-update/2026-10-07'
    );
  });
  it('before 19:00 → yesterday, even with activity', () => {
    expect(latestDailyUpdatePath('c1', '2026-10-01', false, true)).toBe(
      '/circles/c1/daily-update/2026-09-30'
    );
  });
  it('page path helper', () => {
    expect(dailyUpdatePagePath('c1', '2026-10-07', 'notes')).toBe(
      '/circles/c1/daily-update/2026-10-07#notes'
    );
  });
});
