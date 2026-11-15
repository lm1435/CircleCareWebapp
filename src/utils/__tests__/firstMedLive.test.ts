import { describe, expect, it } from 'vitest';
import { resolveFirstMedCard } from '@/utils/firstMedLive';
import type { FirstMedLiveRoot } from '@/api/calendarEvents';

// 2026-09-01 is a Tuesday (recipient zone date the card resolves against).
const TODAY = '2026-09-01';
const live = (over: Partial<FirstMedLiveRoot> = {}): FirstMedLiveRoot => ({
  id: 'ev-1',
  circle_id: 'c1',
  event_type: 'medication',
  parent_event_id: null,
  title: 'Lisinopril',
  medication_name: 'Lisinopril',
  medication_dosage: '10mg',
  scheduled_date: '2026-09-02',
  scheduled_time: '08:00:00',
  recurrence_rule: 'weekly',
  recurrence_days: [1, 3, 5],
  discontinued_at: null,
  as_needed: false,
  ...over,
});
const resolve = (root: FirstMedLiveRoot | null | undefined, marked = false) =>
  resolveFirstMedCard({
    note: { eventId: 'ev-1', marked, startDate: '2026-09-02' },
    live: root,
    circleId: 'c1',
    today: TODAY,
    isPastToday: () => true,
  });

describe('resolveFirstMedCard weekday set', () => {
  it('N: hides Mark it when today (Tuesday) is not one of Mon/Wed/Fri', () => {
    expect(resolve(live()).kind).toBe('hidden');
  });
  it('P: offers Mark it when today is one of the chosen weekdays', () => {
    expect(resolve(live({ recurrence_days: [2, 3] })).kind).toBe('rolled');
  });
  it('P: daily, no days and an empty set are unaffected', () => {
    expect(resolve(live({ recurrence_rule: 'daily' })).kind).toBe('rolled');
    expect(resolve(live({ recurrence_days: null })).kind).toBe('rolled');
    expect(resolve(live({ recurrence_days: [] })).kind).toBe('rolled');
  });
  it('P: an already marked card still shows its Taken row on a non-scheduled day', () => {
    expect(resolve(live({ scheduled_date: TODAY }), true).kind).toBe('marked');
  });
  it('N: not loaded / failed hides', () => {
    expect(resolve(undefined).kind).toBe('hidden');
  });
});
