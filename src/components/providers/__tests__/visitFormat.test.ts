import { describe, expect, it } from 'vitest';
import type { ProviderVisit } from '@/api/providers';
import {
  groupVisitsByYear,
  noteAuthorName,
  visitCalendarPath,
  visitEventId,
} from '../visitFormat';

function v(over: Partial<ProviderVisit>): ProviderVisit {
  return {
    id: 'e1',
    series_id: null,
    parent_event_id: null,
    title: 'T',
    location: null,
    scheduled_date: '2026-10-02',
    scheduled_time: null,
    duration_minutes: null,
    recurrence_rule: null,
    completed_at: null,
    is_virtual: false,
    is_upcoming: false,
    note_count: 0,
    notes: [],
    ...over,
  };
}

describe('opening a visit (contract: physical -> its id, virtual -> series root + date)', () => {
  it('a physical visit opens by its own id, even inside a series', () => {
    expect(visitEventId(v({ id: 'child', series_id: 'root' }))).toBe('child');
  });

  it('a virtual visit opens by the series root', () => {
    expect(visitEventId(v({ id: 'root_2026-11-19', series_id: 'root', is_virtual: true }))).toBe('root');
  });

  it('builds the calendar deep link, with the notes panel on request', () => {
    const virtual = v({
      id: 'root_2026-11-19',
      series_id: 'root',
      is_virtual: true,
      scheduled_date: '2026-11-19',
    });
    expect(visitCalendarPath('c1', virtual)).toBe('/circles/c1/calendar?date=2026-11-19&eventId=root');
    expect(visitCalendarPath('c1', virtual, 'notes')).toBe(
      '/circles/c1/calendar?date=2026-11-19&eventId=root&panel=notes'
    );
  });
});

describe('groupVisitsByYear', () => {
  it('keeps the given (newest-first) order and starts a group when the year changes', () => {
    const groups = groupVisitsByYear([
      v({ id: 'a', scheduled_date: '2026-10-02' }),
      v({ id: 'b', scheduled_date: '2026-01-02' }),
      v({ id: 'c', scheduled_date: '2025-12-31' }),
      v({ id: 'd', scheduled_date: '2024-05-05' }),
    ]);
    expect(groups.map((g) => [g.year, g.visits.map((x) => x.id)])).toEqual([
      ['2026', ['a', 'b']],
      ['2025', ['c']],
      ['2024', ['d']],
    ]);
  });

  it('is empty for no visits', () => {
    expect(groupVisitsByYear([])).toEqual([]);
  });
});

describe('noteAuthorName', () => {
  it('joins first and last, and is empty (not "null") for a nameless author', () => {
    expect(noteAuthorName({ first_name: 'Ana', last_name: 'Lee' })).toBe('Ana Lee');
    expect(noteAuthorName({ first_name: 'Ana', last_name: null })).toBe('Ana');
    expect(noteAuthorName({ first_name: null, last_name: null })).toBe('');
    expect(noteAuthorName(null)).toBe('');
  });
});
