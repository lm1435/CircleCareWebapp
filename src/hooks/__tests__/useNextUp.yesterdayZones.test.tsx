// Re-homed from yesterdayInTimezone.test.ts (which tested getYesterdayInTimezone, exported from the dead
// TodaysMeds with no production caller). The LIVE rule is useNextUp: it asks for the doses of
// addDays(getDateInTimezone(recipientZone), -1), i.e. the RECIPIENT's calendar day before, never the caregiver's
// device-local arithmetic. Literal expectations at pinned instants (not the implementation restated).

import { renderHook } from '@testing-library/react';
import { useNextUp } from '../useNextUp';
import { useMedsForDate, useTodaysMeds } from '../useMedConfirmation';
import { useCalendarEvents } from '../useCalendarEvents';
import { useTasks } from '../useTasks';

vi.mock('../useMedConfirmation', () => ({ useTodaysMeds: vi.fn(), useMedsForDate: vi.fn() }));
vi.mock('../useCalendarEvents', () => ({ useCalendarEvents: vi.fn() }));
vi.mock('../useTasks', () => ({ useTasks: vi.fn() }));

const ok = (data: unknown) => ({ data, isSuccess: true, isError: false, refetch: vi.fn() });

function yesterdayAsked(zone: string): string | undefined {
  vi.mocked(useTodaysMeds).mockReturnValue(ok([]) as never);
  vi.mocked(useMedsForDate).mockReturnValue(ok([]) as never);
  vi.mocked(useCalendarEvents).mockReturnValue(ok([]) as never);
  vi.mocked(useTasks).mockReturnValue(ok({ tasks: [], total: 0 }) as never);
  renderHook(() => useNextUp('c1', zone));
  return vi.mocked(useMedsForDate).mock.calls.at(-1)?.[1];
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe('useNextUp: yesterday is the RECIPIENT\'s day before', () => {
  it('across the offset range', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-06-21T12:00:00Z') });
    const cases: Array<[string, string]> = [
      ['Pacific/Kiritimati', '2026-06-21'], // +14: already 06-22 there
      ['Pacific/Chatham', '2026-06-21'],
      ['Asia/Tokyo', '2026-06-20'],
      ['Asia/Kathmandu', '2026-06-20'],
      ['Etc/UTC', '2026-06-20'],
      ['America/Denver', '2026-06-20'],
      ['America/St_Johns', '2026-06-20'],
      ['Pacific/Midway', '2026-06-20'],
      ['Pacific/Auckland', '2026-06-21'],
      ['America/Los_Angeles', '2026-06-20'],
    ];
    for (const [zone, yesterday] of cases) {
      expect(yesterdayAsked(zone), zone).toBe(yesterday);
    }
  });

  it('NEGATIVE does not overshoot on the caregiver\'s own fall-back day (Denver device -> Bangkok recipient)', () => {
    // 2026-11-01T17:00Z: Denver's fall-back morning (a 25h device day), 2026-11-02 00:00 in Bangkok.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-01T17:00:00Z') });
    expect(yesterdayAsked('Asia/Bangkok')).toBe('2026-11-01');
  });

  it('holds at the recipient\'s own midnight boundary in a +14 zone', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-01T10:30:00Z') });
    expect(yesterdayAsked('Pacific/Kiritimati')).toBe('2026-11-01');
  });

  it('NEGATIVE a zone west of the server is still its own day: Los Angeles just before its midnight', () => {
    // 2026-06-22T06:59Z = 23:59 on 06-21 in LA, while it is already 06-22 in UTC and Auckland (18:59).
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-06-22T06:59:00Z') });
    expect(yesterdayAsked('America/Los_Angeles')).toBe('2026-06-20');
    expect(yesterdayAsked('Pacific/Auckland')).toBe('2026-06-21');
  });
});
