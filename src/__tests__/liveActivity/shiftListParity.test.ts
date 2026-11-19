import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '@/api/calendarEvents';
import { buildShiftList } from '@/components/shifts/shiftTasks';

// Live Activity spec section 7.6 (W1). Web has no Live Activity; this proves web's shift list agrees with
// the server's "next item" logic on the shared fixtures (copied byte for byte from
// backend/src/__tests__/fixtures/shiftList/). Appointments are never counted. A legacy 'missed' dose is
// neither open nor done: it stays in the total, and the next item is the first OPEN row.

const FIXTURES = path.join(__dirname, '../fixtures/shiftList');
const BACKEND_FIXTURES = path.resolve(__dirname, '../../../../backend/src/__tests__/fixtures/shiftList');

interface Fixture {
  shift: Partial<CalendarEvent>;
  covererId: string | null;
  events: Partial<CalendarEvent>[];
  expected: { total: number; done: number; nextKey: string | null };
}

const load = (file: string): Fixture => JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf8'));

/** The same three numbers the server computes: total, done, and the first row that is open. */
function webResult(fx: Fixture) {
  const shift = { event_type: 'shift', ...fx.shift, assigned_to: fx.covererId } as CalendarEvent;
  const list = buildShiftList(shift, fx.events as CalendarEvent[]);
  const open = list.rows.find((r) => r.key === list.primaryKey);
  return { list, got: { total: list.total, done: list.done, nextKey: open?.key ?? null } };
}

const files = fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.json')).sort();

describe('shared shiftList fixtures (web)', () => {
  it('there are fixtures', () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it.each(files)('P-W-1 %s: web buildShiftList gives the backend expected {total, done, nextKey}', (file) => {
    const fx = load(file);
    expect(webResult(fx).got).toEqual(fx.expected);
  });

  const hasBackend = fs.existsSync(BACKEND_FIXTURES);
  (hasBackend ? it.each(files) : it.skip.each(files))('P-W-2 %s is byte-identical to the backend fixture', (file) => {
    expect(fs.readFileSync(path.join(FIXTURES, file)).equals(fs.readFileSync(path.join(BACKEND_FIXTURES, file)))).toBe(true);
  });
});

describe('shift list negatives (web)', () => {
  const shift = {
    id: 's-occ',
    event_type: 'shift',
    parent_event_id: 's-root',
    title: 'Day',
    scheduled_date: '2026-11-12',
    scheduled_time: '08:00:00',
    duration_minutes: 480,
    assigned_to: 'cg-1',
  } as CalendarEvent;
  const base = { scheduled_date: '2026-11-12', assigned_to: null, completed_at: null };

  it('N-W-1 an appointment in the window is never counted (not total, not done, not next)', () => {
    const appt = { ...base, id: 'a1000', event_type: 'appointment', title: 'Doctor', scheduled_time: '10:00:00' };
    const med = { ...base, id: 'm1100', event_type: 'medication', title: 'Pill', scheduled_time: '11:00:00', confirmation: null };
    const list = buildShiftList(shift, [appt, med] as unknown as CalendarEvent[]);
    expect(list.total).toBe(1);
    expect(list.rows.map((r) => r.key)).toEqual(['m1100']);
    expect(list.primaryKey).toBe('m1100');
    expect(list.also.map((e) => e.id)).toEqual(['a1000']);
    // a completed appointment must not raise done either
    const doneAppt = { ...appt, completed_at: '2026-11-12T15:00:00Z' };
    expect(buildShiftList(shift, [doneAppt] as unknown as CalendarEvent[])).toMatchObject({ total: 0, done: 0 });
  });

  it('N-W-2 a missed dose is neither open nor done (kept in total)', () => {
    const missed = { ...base, id: 'm1000', event_type: 'medication', title: 'Pill', scheduled_time: '10:00:00', confirmation: { status: 'missed' } };
    const open = { ...base, id: 'm1100', event_type: 'medication', title: 'Pill', scheduled_time: '11:00:00', confirmation: null };
    const list = buildShiftList(shift, [missed, open] as unknown as CalendarEvent[]);
    expect(list.total).toBe(2);
    expect(list.done).toBe(0);
    const row = list.rows.find((r) => r.key === 'm1000')!;
    expect(row.done).toBe(false);
    expect(row.missed).toBe(true);
    expect(webResult({ shift, covererId: 'cg-1', events: [missed, open], expected: { total: 2, done: 0, nextKey: 'm1100' } } as unknown as Fixture).got.nextKey).toBe('m1100');
  });

  it('N-W-3 a skipped dose is handled (done), unlike missed', () => {
    const skipped = { ...base, id: 'm0900', event_type: 'medication', title: 'Pill', scheduled_time: '09:00:00', confirmation: { status: 'skipped' } };
    const list = buildShiftList(shift, [skipped] as unknown as CalendarEvent[]);
    expect(list).toMatchObject({ total: 1, done: 1 });
  });
});
