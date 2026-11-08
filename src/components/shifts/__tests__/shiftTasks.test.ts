import { describe, expect, it } from 'vitest';
import type { CalendarEvent, ShiftTaskLink } from '@/api/calendarEvents';
import {
  buildShiftList,
  countTasksAffectedByEdit,
  doneBucket,
  shiftTaskMeta,
  shiftWindow,
  tasksBucket,
} from '../shiftTasks';

// docs/plans/shift-tasks.md: the list rules, mirrored client-side from the owner's edge-case fixture:
// repeating shift Mon/Wed/Fri 12-6 PM covered by Lucia + (a) linked repeating 2 PM task, (b) linked one-off
// 3 PM, (c) UNLINKED task 2:30 PM for Lucia, (d) unlinked tasks for someone else and "Anyone",
// (e) unlinked repeating task overlapping the shift, (f) completed past occurrences.

const LUCIA = 'u-lucia';
const MARCO = 'u-marco';
const DAY = '2026-11-09';

const shift = {
  id: 'root_2026-11-09',
  event_type: 'shift',
  title: 'Afternoons',
  scheduled_date: DAY,
  scheduled_time: '12:00:00',
  duration_minutes: 360,
  parent_event_id: 'root',
  assigned_to: LUCIA,
} as CalendarEvent;

function link(over: Partial<ShiftTaskLink> = {}): ShiftTaskLink {
  return {
    root_id: 'root',
    date: DAY,
    title: 'Afternoons',
    assignee: { id: LUCIA, first_name: 'Lucia' },
    status: 'covered',
    window_start: `${DAY}T12:00:00`,
    window_end: `${DAY}T18:00:00`,
    ...over,
  };
}

function ev(id: string, over: Partial<CalendarEvent>): CalendarEvent {
  return {
    id,
    circle_id: 'c',
    event_type: 'task',
    title: id,
    scheduled_date: DAY,
    scheduled_time: '14:00:00',
    assigned_to: null,
    created_at: '',
    updated_at: '',
    ...over,
  } as CalendarEvent;
}

const a = ev('a-linked-repeating', { scheduled_time: '14:00:00', shift: link() });
const b = ev('b-linked-oneoff', { scheduled_time: '15:00:00', shift: link() });
const c = ev('c-unlinked-lucia', { scheduled_time: '14:30:00', assigned_to: LUCIA });
const dMarco = ev('d-unlinked-marco', { scheduled_time: '16:00:00', assigned_to: MARCO });
const dAnyone = ev('d-unlinked-anyone', { scheduled_time: '17:00:00' });
const eOverlap = ev('e-overlap-anyone', { scheduled_time: '13:00:00', assigned_to: null });
const outside = ev('z-before-window', { scheduled_time: '09:00:00', assigned_to: LUCIA });
const outsideLinked = ev('y-outside-status', {
  scheduled_time: '19:00:00',
  assigned_to: LUCIA,
  shift: link({ status: 'outside', window_start: null, window_end: null }),
});
const med = (id: string, time: string, status?: 'taken' | 'skipped' | 'missed') =>
  ev(id, {
    event_type: 'medication',
    scheduled_time: time,
    confirmation: status
      ? ({ status, confirmed_at: '', confirmed_by: 'x' } as CalendarEvent['confirmation'])
      : null,
  });
const appt = ev('appt', { event_type: 'appointment', scheduled_time: '16:30:00' });

describe('shiftWindow', () => {
  it('is start .. start + duration, naive', () => {
    expect(shiftWindow(shift)).toEqual({ start: `${DAY}T12:00`, end: `${DAY}T18:00` });
  });
  it('rolls past midnight', () => {
    expect(shiftWindow({ ...shift, scheduled_time: '20:00:00', duration_minutes: 600 })).toEqual({
      start: `${DAY}T20:00`,
      end: '2026-11-10T06:00',
    });
  });
});

describe('buildShiftList: whose list it is', () => {
  it('holds linked tasks, meds due in the window and the on-shift person\'s overlapping regular task', () => {
    const m1 = med('med-1pm', '13:00:00', 'taken');
    const model = buildShiftList(shift, [a, b, c, m1, dMarco, dAnyone, outside, outsideLinked]);
    expect(model.rows.map((r) => r.event.id)).toEqual([
      'med-1pm',
      'a-linked-repeating',
      'c-unlinked-lucia',
      'b-linked-oneoff',
    ]);
    expect(model.rows.find((r) => r.event.id === 'c-unlinked-lucia')?.linked).toBe(false);
  });

  it('puts other people\'s and Anyone\'s regular tasks, and appointments, under Also happening', () => {
    const model = buildShiftList(shift, [a, c, dMarco, dAnyone, eOverlap, appt]);
    expect(model.also.map((e) => e.id)).toEqual([
      'e-overlap-anyone',
      'd-unlinked-marco',
      'appt',
      'd-unlinked-anyone',
    ]);
    expect(model.rows.map((r) => r.event.id)).toEqual(['a-linked-repeating', 'c-unlinked-lucia']);
  });

  it('never lists a regular task outside the window, and a task whose link says "outside" is a plain task', () => {
    const model = buildShiftList(shift, [outside, outsideLinked]);
    expect(model.rows).toEqual([]);
    expect(model.also).toEqual([]);
  });

  it('an OPEN shift still lists its linked tasks and meds; no regular task is "its person\'s"', () => {
    const open = { ...shift, assigned_to: null } as CalendarEvent;
    const openLinked = ev('a-open', { shift: link({ status: 'open', assignee: null }) });
    const model = buildShiftList(open, [openLinked, c, med('m', '13:00:00')]);
    expect(model.open).toBe(true);
    expect(model.rows.map((r) => r.event.id)).toEqual(['m', 'a-open']);
    expect(model.also.map((e) => e.id)).toEqual(['c-unlinked-lucia']);
  });

  it('a task linked to ANOTHER shift on the same day is not this list\'s', () => {
    const other = ev('other-shift-task', {
      shift: link({ root_id: 'other-root', title: 'Mornings', window_start: `${DAY}T06:00:00`, window_end: `${DAY}T12:00:00` }),
      scheduled_time: '12:00:00',
    });
    const model = buildShiftList(shift, [other]);
    expect(model.rows).toEqual([]);
    expect(model.also.map((e) => e.id)).toEqual(['other-shift-task']);
  });

  it('a task on the next day of an overnight shift is in the list through its link (day offset)', () => {
    const night = {
      ...shift,
      scheduled_time: '20:00:00',
      duration_minutes: 600,
    } as CalendarEvent;
    const t = ev('after-midnight', {
      scheduled_date: '2026-11-10',
      scheduled_time: '02:00:00',
      shift: link({ window_start: `${DAY}T20:00:00`, window_end: '2026-11-10T06:00:00' }),
    });
    const reg = ev('regular-after-midnight', { scheduled_date: '2026-11-10', scheduled_time: '03:00:00', assigned_to: LUCIA });
    const model = buildShiftList(night, [t, reg]);
    expect(model.rows.map((r) => r.event.id)).toEqual(['after-midnight', 'regular-after-midnight']);
  });

  it('skips as-needed, discontinued and out-of-window meds', () => {
    const model = buildShiftList(shift, [
      ev('prn', { event_type: 'medication', as_needed: true }),
      ev('stopped', { event_type: 'medication', discontinued_at: '2026-11-01T00:00:00Z' }),
      med('late-med', '22:00:00'),
    ]);
    expect(model.rows).toEqual([]);
  });
});

describe('buildShiftList: n of N done', () => {
  it('counts completed tasks, taken doses and SKIPPED doses as handled; a missed dose is not', () => {
    const done = { ...a, completed_at: '2026-11-09T20:00:00Z' } as CalendarEvent;
    const model = buildShiftList(shift, [
      done,
      b,
      med('m-taken', '12:30:00', 'taken'),
      med('m-skipped', '13:00:00', 'skipped'),
      med('m-missed', '13:30:00', 'missed'),
      med('m-pending', '17:00:00'),
    ]);
    expect(model.total).toBe(6);
    expect(model.done).toBe(3);
    expect(model.rows.find((r) => r.event.id === 'm-skipped')).toMatchObject({ done: true, skipped: true });
    expect(model.rows.find((r) => r.event.id === 'm-missed')).toMatchObject({ done: false, skipped: false, missed: true });
  });

  it('the card counts TASKS only (linked + the person\'s regular ones), matching the list', () => {
    const done = { ...c, completed_at: 'x' } as CalendarEvent;
    const model = buildShiftList(shift, [a, b, done, dMarco, med('m', '13:00:00', 'taken')]);
    expect(model.taskTotal).toBe(3);
    expect(model.taskDone).toBe(1);
    expect(model.total).toBe(4);
    expect(model.done).toBe(2);
  });

  it('marks only the FIRST not-done row as the primary action (one accent)', () => {
    const model = buildShiftList(shift, [
      med('m-taken', '12:30:00', 'taken'),
      a,
      b,
    ]);
    expect(model.primaryKey).toBe('a-linked-repeating');
    expect(buildShiftList(shift, []).primaryKey).toBeNull();
  });
});

describe('shiftTaskMeta: "<shift title> · <first_name>" where a Task chip shows; withType keeps "Task ·"', () => {
  const t = (key: string, o?: Record<string, unknown>) =>
    key === 'shifts:tasks.meta.line'
      ? `Task · ${o?.who} · ${o?.title}`
      : key === 'shifts:tasks.meta.compact'
        ? `${o?.title} · ${o?.who}`
        : key === 'shifts:tasks.meta.open'
          ? 'Open shift'
          : key === 'shifts:someone'
            ? 'Someone'
            : key;

  it('names the shift first, then the coverer (the name is what truncates)', () => {
    expect(shiftTaskMeta(a, t)).toBe('Afternoons · Lucia');
  });
  it('an open shift reads "<title> · Open shift"', () => {
    expect(shiftTaskMeta(ev('o', { shift: link({ status: 'open', assignee: null }) }), t)).toBe(
      'Afternoons · Open shift'
    );
  });
  it('withType (Today\'s Next up, no chip) keeps the word: "Task · Lucia · Afternoons"', () => {
    expect(shiftTaskMeta(a, t, { withType: true })).toBe('Task · Lucia · Afternoons');
    expect(shiftTaskMeta(ev('o', { shift: link({ status: 'open', assignee: null }) }), t, { withType: true })).toBe(
      'Task · Open shift · Afternoons'
    );
  });
  it('outside the window, or unlinked, is a plain task (no label)', () => {
    expect(shiftTaskMeta(outsideLinked, t)).toBeNull();
    expect(shiftTaskMeta(c, t)).toBeNull();
  });
});

describe('buckets', () => {
  it('tasks_bucket', () => {
    expect([0, 1, 2, 3, 4, 9].map(tasksBucket)).toEqual(['0', '1', '2-3', '2-3', '4+', '4+']);
  });
  it('done_bucket', () => {
    expect(doneBucket(0, 4)).toBe('none');
    expect(doneBucket(2, 4)).toBe('some');
    expect(doneBucket(4, 4)).toBe('all');
    expect(doneBucket(0, 0)).toBe('none');
  });
});

describe('countTasksAffectedByEdit', () => {
  const linked = (id: string, time: string, k = 0, over: Partial<ShiftTaskLink> = {}) =>
    ev(id, {
      scheduled_time: time,
      scheduled_date: k ? '2026-11-10' : DAY,
      shift: link(over),
    });
  const tasks = [linked('t2pm', '14:00:00'), linked('t3pm', '15:00:00'), linked('t1am', '01:00:00', 1)];
  const dup = ev('t2pm-next', { ...tasks[0], id: 'x', parent_event_id: 't2pm', scheduled_date: '2026-11-11', shift: link({ date: '2026-11-11' }) });

  it('time edit: counts linked tasks whose clock time falls outside the new window (day offset kept)', () => {
    // 12:00-18:00 -> 15:00-18:00: only t3pm... (t2pm at 14:00 is out), t1am (k=1) is out too
    expect(
      countTasksAffectedByEdit({ kind: 'time', shift, startTime: '15:00', durationMinutes: 180, scope: 'future' }, tasks)
    ).toBe(2);
    // widening never warns
    expect(
      countTasksAffectedByEdit({ kind: 'time', shift, startTime: '10:00', durationMinutes: 480, scope: 'future' }, tasks)
    ).toBe(1); // t1am at +1d 01:00 = 25:00 is still beyond 18:00
  });
  it('counts a repeating task once, however many occurrences are loaded', () => {
    expect(
      countTasksAffectedByEdit({ kind: 'time', shift, startTime: '15:00', durationMinutes: 180, scope: 'future' }, [
        tasks[0],
        { ...dup, parent_event_id: 't2pm' } as CalendarEvent,
      ])
    ).toBe(1);
  });
  it('"this shift" only looks at that occurrence\'s tasks', () => {
    const other = linked('other-day', '14:00:00', 0, { date: '2026-11-11' });
    expect(
      countTasksAffectedByEdit({ kind: 'time', shift, startTime: '15:00', durationMinutes: 180, scope: 'occurrence' }, [tasks[0], other])
    ).toBe(1);
  });
  it('a date move or a repeat change affects every linked task of the scope; unlinked and outside never count', () => {
    const regular = [c, dMarco, outsideLinked];
    expect(countTasksAffectedByEdit({ kind: 'date', shift, scope: 'occurrence' }, [...tasks, ...regular])).toBe(3);
    expect(countTasksAffectedByEdit({ kind: 'repeat', shift, scope: 'future' }, [...tasks, ...regular])).toBe(3);
  });
  it('two shifts with the SAME title and time: only the edited shift\'s link (root_id) is counted', () => {
    const twin = (id: string, time: string) => linked(id, time, 0, { root_id: 'twin-root' }); // same title, date and window
    const mixed = [tasks[0], tasks[1], twin('tw1', '14:00:00'), twin('tw2', '15:00:00'), twin('tw3', '16:00:00')];
    expect(
      countTasksAffectedByEdit({ kind: 'time', shift, startTime: '15:00', durationMinutes: 180, scope: 'future' }, mixed)
    ).toBe(1); // only our t2pm (14:00); t3pm is inside
    expect(countTasksAffectedByEdit({ kind: 'date', shift, scope: 'occurrence' }, mixed)).toBe(2);
    expect(countTasksAffectedByEdit({ kind: 'repeat', shift, scope: 'future' }, mixed)).toBe(2);
  });
  it('tasks of another shift never count', () => {
    const foreign = linked('foreign', '14:00:00', 0, { root_id: 'other' });
    expect(countTasksAffectedByEdit({ kind: 'repeat', shift, scope: 'future' }, [foreign])).toBe(0);
  });
});
