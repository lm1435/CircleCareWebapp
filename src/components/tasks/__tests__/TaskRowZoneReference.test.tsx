import { render, screen, within } from '@testing-library/react';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';

// The viewer's 12h/24h clock — pinned so this test needs no QueryClientProvider
// and the rendered digits never depend on the runner's navigator.language.
// (Same pattern as OpenTasksCard.test.tsx.)
vi.mock('@/hooks/useHourCycle', () => ({
  useHourCycle: () => '12h',
}));

const { TaskRow } = await import('../TaskRow');

// ---------------------------------------------------------------------------
// WHICH INSTANT THE ZONE COMPARISON IS JUDGED AT.
//
// A rendered time is labelled with the care recipient's zone only when the
// viewer is somewhere else — but "somewhere else" is not a fixed answer.
// America/Phoenix does not observe DST and America/Denver does, so the two are
// the SAME clock in January and an hour apart in July.
//
// That makes "now" the wrong instant to ask at. A Phoenix caregiver looking at
// a task due in July shares no clock with the Denver recipient ON THE DAY THE
// TASK IS DUE, which is the only day the reader cares about — and asking at
// "now" would, for half the year, show that time unlabelled and an hour off
// with nothing to signal it.
//
// `zoneReferenceInstant(task.scheduled_date)` is what the row has to pass.
//
// NO FAKE TIMERS, deliberately, and this is a trap worth stating: vitest's
// DEFAULT `vi.useFakeTimers()` replaces the global `Intl.DateTimeFormat`, so a
// spy on `Intl.DateTimeFormat.prototype.resolvedOptions` stops applying and
// `getDeviceTimezone()` silently reverts to the real machine zone. (Narrowing
// to `toFake: ['Date']`, as TodaysMeds.test.tsx does, freezes the clock without
// touching Intl — that is the escape hatch if a test needs both.) Instead of
// pinning "today", both rows are rendered together and asserted to DISAGREE:
// exactly one of a July task and a January task may carry the label. A row
// judged at "now" would treat the two identically whatever day the suite runs
// on, so this holds year-round without freezing the clock.
// ---------------------------------------------------------------------------

function pinDeviceTimezone(timeZone: string) {
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    timeZone,
  } as Intl.ResolvedDateTimeFormatOptions);
}

function makeTask(id: string, scheduled_date: string): CalendarEvent {
  return {
    id,
    circle_id: 'circle-1',
    title: `Refill ${id}`,
    event_type: 'task',
    scheduled_date,
    scheduled_time: '14:00:00',
    status: 'open',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as CalendarEvent;
}

function renderRow(task: CalendarEvent) {
  return render(
    <TaskRow
      task={task}
      timezone="America/Denver"
      canEdit
      members={[]}
      onComplete={vi.fn()}
      onUndo={vi.fn()}
      onEdit={vi.fn()}
      isPendingComplete={false}
    />
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TaskRow zone label', () => {
  it('names the recipient’s zone on the JULY row and not the JANUARY one', () => {
    pinDeviceTimezone('America/Phoenix');

    const july = renderRow(makeTask('task-july', '2026-07-15')).container;
    const january = renderRow(makeTask('task-jan', '2026-01-20')).container;

    // Denver is an hour ahead of Phoenix in July, so the reader has to be told
    // whose clock 2:00 PM is on.
    expect(within(july).getByText(/2:00 PM \(Denver\)/)).toBeInTheDocument();

    // In January the two are one clock, and a label answers a question nobody
    // asked. Judged at "now" both rows would read the same way.
    expect(within(january).getByText(/2:00 PM/)).toBeInTheDocument();
    expect(within(january).queryByText(/\(Denver\)/)).not.toBeInTheDocument();
  });

  it('leaves both rows bare for a viewer in the recipient’s own zone', () => {
    // Denver viewer, Denver recipient — one clock all year, so the season the
    // row falls in changes nothing.
    pinDeviceTimezone('America/Denver');

    renderRow(makeTask('task-july', '2026-07-15'));
    renderRow(makeTask('task-jan', '2026-01-20'));

    expect(screen.queryByText(/\(Denver\)/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/2:00 PM/)).toHaveLength(2);
  });
});
