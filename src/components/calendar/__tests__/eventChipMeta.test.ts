import type { CalendarEvent } from '@/api/calendarEvents';
import { eventAssigneeName, eventNoteCount } from '../eventChipMeta';

function ev(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'e1',
    circle_id: 'c1',
    event_type: 'task',
    title: 'T',
    scheduled_date: '2026-03-16',
    scheduled_time: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('eventAssigneeName (mobile TimelineEventBlock rule)', () => {
  it('joins first and last name', () => {
    expect(
      eventAssigneeName(ev({ assigned_to_user: { id: 'u', email: 'a@x.co', first_name: 'Ana', last_name: 'López' } }))
    ).toBe('Ana López');
  });
  it('first name alone', () => {
    expect(eventAssigneeName(ev({ assigned_to_user: { id: 'u', first_name: 'Ana', last_name: null } }))).toBe('Ana');
  });
  it('falls back to the email', () => {
    expect(
      eventAssigneeName(ev({ assigned_to_user: { id: 'u', email: 'a@x.co', first_name: '', last_name: null } }))
    ).toBe('a@x.co');
  });
  it('null when unassigned or nothing to print', () => {
    expect(eventAssigneeName(ev({ assigned_to_user: null }))).toBeNull();
    expect(eventAssigneeName(ev({}))).toBeNull();
    expect(eventAssigneeName(ev({ assigned_to_user: { id: 'u', first_name: null, last_name: null } }))).toBeNull();
  });
});

describe('eventNoteCount', () => {
  it('reads note_count, 0 when absent or not positive', () => {
    expect(eventNoteCount(ev({ note_count: 4 }))).toBe(4);
    expect(eventNoteCount(ev({}))).toBe(0);
    expect(eventNoteCount(ev({ note_count: 0 }))).toBe(0);
  });
});
