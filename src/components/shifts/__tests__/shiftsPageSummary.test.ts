/**
 * Owner-approved header redesign (2026-11-07): the Shifts view carries a summary line under the page
 * title, computed from the shifts already loaded for the visible range. Copy is shared with mobile.
 * Pinned instant, recipient zone America/Chicago (the process runs in America/Denver).
 */
import i18n from '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { shiftsPageSummary } from '../shiftUtils';

const TZ = 'America/Chicago';
// 2026-06-12 10:30 in Chicago.
const NOW = new Date('2026-06-12T15:30:00Z');
const t = i18n.getFixedT('en');

function shift(over: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 's',
    circle_id: 'c',
    event_type: 'shift',
    title: 'Shift',
    scheduled_date: '2026-06-12',
    scheduled_time: '20:00:00',
    duration_minutes: 60,
    assigned_to: null,
    created_at: '',
    updated_at: '',
    ...over,
  } as CalendarEvent;
}
const open = shift({ id: 'o' });
const covered = shift({ id: 'c', assigned_to: 'u-ana' });
const any = () => true;

function summary(
  shifts: CalendarEvent[],
  view: 'day' | 'week' | 'month',
  isToday = true
): string {
  return shiftsPageSummary(t, shifts, { view, isToday, inRange: any, timezone: TZ, now: NOW });
}

describe('shiftsPageSummary', () => {
  it('Day with none: today vs another day', () => {
    expect(summary([], 'day', true)).toBe('No shifts today.');
    expect(summary([], 'day', false)).toBe('No shifts on this day.');
  });
  it('Week and Month with none', () => {
    expect(summary([], 'week')).toBe('No shifts this week.');
    expect(summary([], 'month')).toBe('No shifts this month.');
  });
  it('all covered, singular and plural', () => {
    expect(summary([covered], 'day')).toBe('1 shift · all covered');
    expect(summary([covered, shift({ id: 'c2', assigned_to: 'u' })], 'week')).toBe('2 shifts · all covered');
    expect(summary([covered, covered, covered], 'month')).toBe('3 shifts · all covered');
  });
  it('some open', () => {
    expect(summary([open], 'day')).toBe('1 shift · 1 open');
    expect(summary([open, covered], 'week')).toBe('2 shifts · 1 open');
    expect(summary([open, shift({ id: 'o2' }), covered], 'month')).toBe('3 shifts · 2 open');
  });
  it('ended unfilled only: counted in the total, not "open", not "all covered"', () => {
    const ended = shift({ id: 'e', scheduled_time: '08:00:00' });
    expect(summary([ended], 'day')).toBe('1 shift');
    expect(summary([ended, ended], 'week')).toBe('2 shifts');
  });
  it('ended unfilled + filled: still just the count', () => {
    const ended = shift({ id: 'e', scheduled_time: '08:00:00' });
    expect(summary([ended, covered], 'day')).toBe('2 shifts');
  });
  it('future unfilled: open', () => {
    expect(summary([open], 'month')).toBe('1 shift · 1 open');
  });
  it('a mix of ended unfilled, future unfilled and filled: only the future unfilled are open', () => {
    const ended = shift({ id: 'e', scheduled_time: '08:00:00' });
    expect(summary([ended, open, covered], 'day')).toBe('3 shifts · 1 open');
  });
  it('only counts dates inside the visible range', () => {
    const other = shift({ id: 'x', scheduled_date: '2026-07-01' });
    const text = shiftsPageSummary(t, [covered, other], {
      view: 'week',
      isToday: true,
      inRange: (d) => d === '2026-06-12',
      timezone: TZ,
      now: NOW,
    });
    expect(text).toBe('1 shift · all covered');
  });
});
