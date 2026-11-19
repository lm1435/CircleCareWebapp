import { describe, expect, it } from 'vitest';
import type { CalendarEvent, ShiftTaskLink } from '@/api/calendarEvents';
import {
  buildShiftList,
  countTasksAffectedByEdit,
  crossesMidnightSide,
  defaultShiftTaskTime,
  doneBucket,
  isShiftItemLate,
  nowInZone,
  rowMatchesHighlight,
  shiftContextFromLink,
  shiftContextFromShift,
  shiftTaskMeta,
  shiftWindow,
  tasksBucket,
  timeInsideShiftWindow,
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


describe('isShiftItemLate (1.4.3): 15 min past due in the RECIPIENT zone', () => {
  const M = 60_000;
  const it0 = (date: string, time: string | null) => ({ scheduled_date: date, scheduled_time: time }) as never;

  it('P-LATE-U1 exactly 15 minutes is late; 14 minutes is not (N-LATE-U1)', () => {
    const due = Date.parse('2026-11-09T17:00:00Z'); // 12:00 in New York (EST)
    expect(isShiftItemLate(it0('2026-11-09', '12:00:00'), 'America/New_York', due + 15 * M)).toBe(true);
    expect(isShiftItemLate(it0('2026-11-09', '12:00:00'), 'America/New_York', due + 14 * M + 59_000)).toBe(false);
    expect(isShiftItemLate(it0('2026-11-09', '12:00:00'), 'America/New_York', due)).toBe(false);
  });

  it('P-LATE-U2 uses the recipient zone, not the machine zone (machine is Denver): Tokyo and New York', () => {
    // 12:00 Tokyo (JST, +9) = 03:00Z; 15 min later = 03:15Z, which is still the evening before in Denver.
    expect(isShiftItemLate(it0('2026-11-09', '12:00:00'), 'Asia/Tokyo', Date.parse('2026-11-09T03:15:00Z'))).toBe(true);
    // Read as Denver wall time (19:00Z) the same instant would not be late yet, and 12:00 in Tokyo is not 12:00 Denver.
    expect(isShiftItemLate(it0('2026-11-09', '12:00:00'), 'America/Denver', Date.parse('2026-11-09T03:15:00Z'))).toBe(false);
    expect(isShiftItemLate(it0('2026-11-09', '12:00:00'), 'America/New_York', Date.parse('2026-11-09T17:15:00Z'))).toBe(true);
  });

  it('N-LATE-U2 a Tokyo due time is NOT late 14 minutes after it, whatever the machine zone says', () => {
    expect(isShiftItemLate(it0('2026-11-09', '12:00:00'), 'Asia/Tokyo', Date.parse('2026-11-09T03:14:00Z'))).toBe(false);
  });

  it('N-LATE-U3 an overnight item (00:30 tomorrow) is not late at 23:00 today, and is late at 00:45', () => {
    // Shift 22:00 -> 06:00 in New York; the task is due 00:30 on the NEXT calendar date (05:30Z).
    const task = it0('2026-11-10', '00:30:00');
    expect(isShiftItemLate(task, 'America/New_York', Date.parse('2026-11-10T04:00:00Z'))).toBe(false); // 23:00 on the 9th
    expect(isShiftItemLate(task, 'America/New_York', Date.parse('2026-11-10T05:44:00Z'))).toBe(false);
    expect(isShiftItemLate(task, 'America/New_York', Date.parse('2026-11-10T05:45:00Z'))).toBe(true); // 00:45
  });

  it('P-LATE-U4 DST fall-back (New York 2026-11-01): the repeated 01:30 is the SECOND one (06:30Z), like the cron', () => {
    const t = it0('2026-11-01', '01:30:00');
    expect(isShiftItemLate(t, 'America/New_York', Date.parse('2026-11-01T06:45:00Z'))).toBe(true);
    expect(isShiftItemLate(t, 'America/New_York', Date.parse('2026-11-01T06:44:00Z'))).toBe(false);
  });

  it('N-LATE-U4 DST fall-back: the first 01:30 pass (05:45Z, 15 min after 05:30Z) does not make it late', () => {
    expect(isShiftItemLate(it0('2026-11-01', '01:30:00'), 'America/New_York', Date.parse('2026-11-01T05:45:00Z'))).toBe(false);
  });

  it('N-LATE-U5 no scheduled_time is never late, however old', () => {
    expect(isShiftItemLate(it0('2020-01-01', null), 'America/New_York', Date.parse('2026-11-09T17:00:00Z'))).toBe(false);
  });

  it('N-LATE-U6 an invalid zone-resolved instant (NaN) is never late', () => {
    expect(isShiftItemLate(it0('not-a-date', '12:00:00'), 'America/New_York', Date.parse('2026-11-09T17:00:00Z'))).toBe(false);
  });
});


// ── 1.4.3: the shift mode of the full task editor ────────────────────────────────────────────────────
describe('timeInsideShiftWindow (moved here from the retired ShiftTaskFormModal)', () => {
  it('P the window is inclusive at both ends', () => {
    expect(timeInsideShiftWindow('14:00', '14:00', 360)).toBe(true);
    expect(timeInsideShiftWindow('20:00', '14:00', 360)).toBe(true);
    expect(timeInsideShiftWindow('17:30', '14:00', 360)).toBe(true);
  });
  it('N before the start and after the end are outside', () => {
    expect(timeInsideShiftWindow('13:59', '14:00', 360)).toBe(false);
    expect(timeInsideShiftWindow('20:01', '14:00', 360)).toBe(false);
    expect(timeInsideShiftWindow('', '14:00', 360)).toBe(false);
  });
  it('P overnight: earlier than the start is the NEXT day and is inside until the end', () => {
    expect(timeInsideShiftWindow('02:00', '20:00', 600)).toBe(true);
    expect(timeInsideShiftWindow('06:00', '20:00', 600)).toBe(true);
    expect(timeInsideShiftWindow('06:01', '20:00', 600)).toBe(false);
    expect(timeInsideShiftWindow('19:59', '20:00', 600)).toBe(false);
  });
});

describe('crossesMidnightSide (the overnight edit rule)', () => {
  it('N moving from before to after midnight, or back, is refused', () => {
    expect(crossesMidnightSide('22:00', '02:00', '20:00', 600)).toBe(true);
    expect(crossesMidnightSide('02:00', '22:00', '20:00', 600)).toBe(true);
  });
  it('P staying on the same side is fine, and a same-day window never crosses', () => {
    expect(crossesMidnightSide('22:00', '23:30', '20:00', 600)).toBe(false);
    expect(crossesMidnightSide('01:00', '05:00', '20:00', 600)).toBe(false);
    expect(crossesMidnightSide('15:00', '18:00', '14:00', 360)).toBe(false);
  });
});

describe('defaultShiftTaskTime', () => {
  const afternoon = { scheduledDate: '2026-11-10', startTime: '14:00', durationMinutes: 360 };
  const chicago = 'America/Chicago';
  const at = (iso: string) => new Date(iso);
  it('P shift today, now inside: the next half hour', () => {
    expect(defaultShiftTaskTime(afternoon, chicago, at('2026-11-10T21:10:00Z'))).toEqual({ time: '15:30', source: 'next_half_hour' });
    // Exactly on the half hour moves to the NEXT one (never "now").
    expect(defaultShiftTaskTime(afternoon, chicago, at('2026-11-10T21:30:00Z'))).toEqual({ time: '16:00', source: 'next_half_hour' });
  });
  it('P clamped at the window end', () => {
    expect(defaultShiftTaskTime(afternoon, chicago, at('2026-11-11T01:50:00Z'))).toEqual({ time: '20:00', source: 'next_half_hour' });
    expect(defaultShiftTaskTime(afternoon, chicago, at('2026-11-11T01:59:00Z'))).toEqual({ time: '20:00', source: 'next_half_hour' });
  });
  it('N before the start, after the end and another day: the shift start', () => {
    for (const iso of ['2026-11-10T19:00:00Z', '2026-11-11T02:01:00Z', '2026-11-09T21:00:00Z', '2026-11-12T21:00:00Z']) {
      expect(defaultShiftTaskTime(afternoon, chicago, at(iso))).toEqual({ time: '14:00', source: 'shift_start' });
    }
  });
  it('the recipient zone decides, not the runner: 3:10 PM Chicago is 9:10 PM in Berlin', () => {
    expect(defaultShiftTaskTime(afternoon, 'Europe/Berlin', at('2026-11-10T21:10:00Z')).source).toBe('shift_start');
    expect(defaultShiftTaskTime(afternoon, chicago, at('2026-11-10T21:10:00Z')).source).toBe('next_half_hour');
  });
  it('P overnight shift: after midnight, on the next day, is still inside', () => {
    const night = { scheduledDate: '2026-11-10', startTime: '20:00', durationMinutes: 600 };
    expect(defaultShiftTaskTime(night, chicago, at('2026-11-11T07:10:00Z'))).toEqual({ time: '01:30', source: 'next_half_hour' });
    expect(defaultShiftTaskTime(night, chicago, at('2026-11-11T11:45:00Z'))).toEqual({ time: '06:00', source: 'next_half_hour' });
    expect(defaultShiftTaskTime(night, chicago, at('2026-11-11T13:00:00Z')).source).toBe('shift_start');
  });
  it('nowInZone reads the date and clock in the zone', () => {
    expect(nowInZone('America/Chicago', at('2026-11-11T05:59:00Z'))).toEqual({ date: '2026-11-10', time: '23:59' });
    expect(nowInZone('America/Chicago', at('2026-11-11T06:00:00Z'))).toEqual({ date: '2026-11-11', time: '00:00' });
  });
});

describe('shift task editor context', () => {
  const link = (over: Record<string, unknown> = {}) =>
    ({
      root_id: 'root',
      date: '2026-11-10',
      title: 'Afternoons',
      assignee: { id: 'u-lucia', first_name: 'Lucia' },
      status: 'covered',
      window_start: '2026-11-10T14:00:00',
      window_end: '2026-11-10T20:00:00',
      ...over,
    }) as ShiftTaskLink;
  const task = (over: Partial<CalendarEvent> = {}) =>
    ({ event_type: 'task', recurrence_rule: 'weekly', parent_event_id: null, shift: link(), ...over }) as CalendarEvent;

  it('P a covered link reads the window, the coverer and the repeat', () => {
    expect(shiftContextFromLink(task(), 'u-me', 'tasks')).toEqual({
      shiftEventId: 'root',
      scheduledDate: '2026-11-10',
      title: 'Afternoons',
      startTime: '14:00',
      durationMinutes: 360,
      repeating: true,
      coverer: 'other',
      covererName: 'Lucia',
      source: 'tasks',
    });
    expect(shiftContextFromLink(task(), 'u-lucia', 'calendar')?.coverer).toBe('me');
    expect(shiftContextFromLink(task({ recurrence_rule: null }), 'u-me', 'tasks')?.repeating).toBe(false);
  });
  it('P an overnight window gets its duration across midnight', () => {
    const night = task({ shift: link({ window_start: '2026-11-10T20:00:00', window_end: '2026-11-11T06:00:00' }) });
    expect(shiftContextFromLink(night, 'u-me', 'tasks')?.durationMinutes).toBe(600);
  });
  it('P an open link is "open" with no name', () => {
    const open = task({ shift: link({ status: 'open', assignee: null }) });
    expect(shiftContextFromLink(open, 'u-me', 'tasks')).toMatchObject({ coverer: 'open', covererName: null });
  });
  it('N14 no link, "outside", a missing window, or an old backend (no field): nothing locked', () => {
    expect(shiftContextFromLink(task({ shift: null }), 'u-me', 'tasks')).toBeNull();
    expect(shiftContextFromLink({ ...task(), shift: undefined }, 'u-me', 'tasks')).toBeNull();
    expect(shiftContextFromLink(task({ shift: link({ status: 'outside' }) }), 'u-me', 'tasks')).toBeNull();
    expect(shiftContextFromLink(task({ shift: link({ window_start: null }) }), 'u-me', 'tasks')).toBeNull();
    expect(shiftContextFromLink(task({ event_type: 'appointment' }), 'u-me', 'tasks')).toBeNull();
  });
  it('N a non-task is never a shift task', () => {
    expect(shiftContextFromLink(task({ event_type: 'medication' }), 'u-me', 'tasks')).toBeNull();
  });
  it('shiftContextFromShift: the shift row it was opened from', () => {
    const ctx = shiftContextFromShift(
      { id: 'root_2026-11-10', title: 'Afternoons', scheduled_date: '2026-11-10', scheduled_time: '14:00:00', duration_minutes: 360, assigned_to: 'u-me' } as CalendarEvent,
      [{ id: 'u-me', first_name: 'Me' }],
      'u-me',
      'saved_sheet',
      true
    );
    expect(ctx).toMatchObject({ shiftEventId: 'root_2026-11-10', startTime: '14:00', coverer: 'me', covererName: 'Me', source: 'saved_sheet', repeating: true });
    expect(shiftContextFromShift({ id: 'x', title: 't', scheduled_date: '2026-11-10', assigned_to: null } as CalendarEvent, [], 'u-me', 'shift_detail', false).coverer).toBe('open');
  });
});

describe('rowMatchesHighlight', () => {
  const row = (key: string, parent?: string) => ({ key, event: { parent_event_id: parent } as CalendarEvent });
  it('P the physical id, a virtual <root>_<date> occurrence and a child of the root match', () => {
    expect(rowMatchesHighlight(row('t1'), 't1')).toBe(true);
    expect(rowMatchesHighlight(row('t1_2026-11-10'), 't1')).toBe(true);
    expect(rowMatchesHighlight(row('child', 't1'), 't1')).toBe(true);
  });
  it('N another task, and an id that merely starts the same, do not', () => {
    expect(rowMatchesHighlight(row('t2'), 't1')).toBe(false);
    expect(rowMatchesHighlight(row('t10'), 't1')).toBe(false);
    expect(rowMatchesHighlight(row('t10_2026-11-10', 't10'), 't1')).toBe(false);
  });
});
