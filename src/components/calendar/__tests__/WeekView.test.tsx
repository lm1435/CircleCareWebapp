import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { WeekView } from '../WeekView';

function makeAllDayTask(id: string, title: string, scheduled_date: string): CalendarEvent {
  return {
    id,
    circle_id: 'circle-1',
    event_type: 'task',
    title,
    scheduled_date,
    scheduled_time: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

// The viewer's 12h/24h clock — pinned so the test needs no QueryClientProvider
// and time labels never depend on the runner's navigator.language.
const mockUseHourCycle = vi.fn();
vi.mock('@/hooks/useHourCycle', () => ({
  useHourCycle: () => mockUseHourCycle(),
}));

beforeEach(() => {
  mockUseHourCycle.mockReturnValue('12h');
});

// A fixed Sun-first week. 2026-03-15 is a known Sunday.
const DAYS = [
  '2026-03-15',
  '2026-03-16',
  '2026-03-17',
  '2026-03-18',
  '2026-03-19',
  '2026-03-20',
  '2026-03-21',
];
const TODAY = '2026-03-17'; // Tuesday

function renderWeek() {
  render(
    <WeekView
      days={DAYS}
      eventsByDay={new Map()}
      careRecipientTimezone="America/Chicago"
      todayStr={TODAY}
      onEventClick={vi.fn()}
    />
  );
}

describe('WeekView', () => {
  it('today\'s column header is aria-current="date" (WCAG 1.3.1)', () => {
    renderWeek();
    const current = screen.getAllByRole('columnheader').filter((h) => h.getAttribute('aria-current') === 'date');
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute('aria-label')).toMatch(/^Tuesday, March 17/);
  });

  // The today marker is ink — interactive state (decision 2026-09-04) — the
  // same treatment as MonthView's `bg-ink text-cream` today cell, so "today"
  // reads identically across both calendar views.
  it('marks today with bg-ink, and leaves other days unmarked', () => {
    renderWeek();

    const todayHeader = screen.getByRole('columnheader', { name: /^Tuesday, March 17/ });
    const todayMarker = within(todayHeader).getByText('Tue').parentElement;
    expect(todayMarker?.className).toContain('bg-ink');
    expect(todayMarker?.className).not.toContain('bg-coral-deep');

    const otherHeader = screen.getByRole('columnheader', { name: /^Monday, March 16/ });
    const otherMarker = within(otherHeader).getByText('Mon').parentElement;
    expect(otherMarker?.className).not.toContain('bg-coral-deep');
    expect(otherMarker?.className).not.toContain('bg-ink');
  });

  // Mobile parity (review 2026-09-05): mobile's WeekTimelineView
  // currentTimeLine/currentTimeDot use CC.terracotta, not ink — and it
  // renders only in today's column.
  it('renders the current-time indicator in terracotta, only in today\'s column', () => {
    renderWeek();

    const indicators = screen.getAllByTestId('current-time-indicator');
    expect(indicators).toHaveLength(1);
    expect(indicators[0].className).toContain('bg-terracotta');
    expect(indicators[0].className).not.toContain('bg-coral');
    expect(indicators[0].className).not.toContain('bg-ink');
    expect(indicators[0].closest('[data-date]')).toHaveAttribute('data-date', TODAY);
  });

  // The day-of-week label used to hand-roll the `.mono` utility (uppercase
  // mono tracking); it now renders as a plain sentence-case sans label. It
  // still carries `capitalize`: Spanish `Intl` weekday shorts come back
  // lowercase ("lun", "mié"), and en is unaffected by the transform.
  it('renders the day-of-week header without the mono/uppercase treatment, but capitalized', () => {
    renderWeek();

    const label = screen.getByText('Tue');
    expect(label.className).not.toContain('mono');
    expect(label.className).not.toContain('uppercase');
    expect(label.className).toContain('capitalize');
  });

  // Mobile parity (review 2026-09-05): mobile's WeekTimelineView.tsx:40 caps
  // the shared all-day row at MAX_ALL_DAY_VISIBLE (2) per day — otherwise a
  // day with many all-day items grows the row tall enough to push the whole
  // hour grid below the fold, at every width.
  describe('all-day overflow cap', () => {
    const SAT = '2026-03-21';

    // Both the all-day row's per-day cell AND the timed grid's per-day cell
    // carry `role="gridcell" data-date={day}` — only the timed cell has an
    // aria-label, so `data-date` is the only reliable selector for the
    // all-day one. It renders first in DOM order (the pinned head sits above
    // the timed grid), hence `[0]`.
    function allDayCellFor(dateStr: string): HTMLElement {
      const matches = screen
        .getAllByRole('gridcell')
        .filter((el) => el.getAttribute('data-date') === dateStr);
      return matches[0];
    }

    function renderWeekWithManyAllDay() {
      const eventsByDay = new Map<string, CalendarEvent[]>([
        [
          SAT,
          [
            makeAllDayTask('t1', 'Organize pill box', SAT),
            makeAllDayTask('t2', 'Call insurance', SAT),
            makeAllDayTask('t3', 'Pick up prescription', SAT),
            makeAllDayTask('t4', 'Water the plants', SAT),
            makeAllDayTask('t5', 'Grocery run', SAT),
          ],
        ],
      ]);
      render(
        <WeekView
          days={DAYS}
          eventsByDay={eventsByDay}
          careRecipientTimezone="America/Chicago"
          todayStr={TODAY}
          onEventClick={vi.fn()}
        />
      );
    }

    it('shows only the first 2 all-day chips per day, plus a "+N" overflow control', () => {
      renderWeekWithManyAllDay();

      const satCell = allDayCellFor(SAT);
      expect(within(satCell).getByRole('button', { name: /^Organize pill box/ })).toBeInTheDocument();
      expect(within(satCell).getByRole('button', { name: /^Call insurance/ })).toBeInTheDocument();
      expect(
        within(satCell).queryByRole('button', { name: /^Pick up prescription/ })
      ).not.toBeInTheDocument();

      const overflow = within(satCell).getByRole('button', { name: /3 more all-day events? on/i });
      expect(overflow).toHaveAttribute('aria-expanded', 'false');
      expect(overflow).toHaveTextContent('+3');
      // Review 2026-09-05 — `.mono` was deleted from globals.css; this control
      // must use the file's own inline mono-scale utilities instead of the
      // now-dead class.
      expect(overflow.className.split(/\s+/)).not.toContain('mono');
    });

    it('expands that day\'s column inline on click, and can collapse back', async () => {
      const user = userEvent.setup();
      renderWeekWithManyAllDay();

      const satCell = allDayCellFor(SAT);
      await user.click(within(satCell).getByRole('button', { name: /3 more all-day events? on/i }));

      // All 5 now render, and the overflow control flips to a collapse toggle.
      expect(within(satCell).getByRole('button', { name: /^Pick up prescription/ })).toBeInTheDocument();
      expect(within(satCell).getByRole('button', { name: /^Water the plants/ })).toBeInTheDocument();
      expect(within(satCell).getByRole('button', { name: /^Grocery run/ })).toBeInTheDocument();
      // Per-day accessible name (review 2026-09-05) — two expanded days must
      // not share one "Show fewer" name.
      const collapse = within(satCell).getByRole('button', { name: /Show fewer all-day events? on/i });
      expect(collapse).toHaveAttribute('aria-expanded', 'true');
      expect(collapse).toHaveTextContent('Show fewer');
      expect(collapse.className.split(/\s+/)).not.toContain('mono');

      await user.click(collapse);
      expect(
        within(satCell).queryByRole('button', { name: /^Pick up prescription/ })
      ).not.toBeInTheDocument();
      expect(
        within(satCell).getByRole('button', { name: /3 more all-day events? on/i })
      ).toBeInTheDocument();
    });

    it('does not cap or expand an UNRELATED day\'s column', () => {
      renderWeekWithManyAllDay();

      // Monday has no all-day events at all in this fixture — no overflow
      // control should appear there.
      const monCell = allDayCellFor('2026-03-16');
      expect(monCell.querySelector('button')).toBeNull();
    });
  });
});

// a11y audit 2026-09-29 (WCAG 2.5.8 target size): five simultaneous doses in a
// phone-width day column were ~21px-wide chips. The day column is floored at
// LANE_MIN_PX per lane of the week's busiest slot.
describe('WeekView lane width floor', () => {
  function makeTimedMed(id: string, time: string): CalendarEvent {
    return { ...makeAllDayTask(id, `Med ${id}`, '2026-03-16'), event_type: 'medication', scheduled_time: time };
  }

  it('floors the day column at LANE_MIN_PX per overlapping lane', async () => {
    const { LANE_MIN_PX } = await import('../WeekView');
    const meds = ['a', 'b', 'c', 'd', 'e'].map((id) => makeTimedMed(id, '08:00'));
    const { container } = render(
      <WeekView
        days={DAYS}
        eventsByDay={new Map([['2026-03-16', meds]])}
        careRecipientTimezone="America/Chicago"
        todayStr={TODAY}
        onEventClick={vi.fn()}
      />
    );
    const rowgroup = container.querySelector('[data-day-column-floor]') as HTMLElement;
    expect(rowgroup.dataset.dayColumnFloor).toBe(String(5 * LANE_MIN_PX));
    expect(rowgroup.style.getPropertyValue('--dc-floor')).toBe(`${5 * LANE_MIN_PX}px`);
    // Every breakpoint's column width honours the floor.
    expect(rowgroup.className).toContain('[--dc:max(var(--dc-floor),');
    expect(rowgroup.className).toContain('lg:[--dc:minmax(var(--dc-floor),1fr)]');
    // 5 lanes x 25px keeps lane centres >= 24px apart.
    expect((5 * LANE_MIN_PX) / 5).toBeGreaterThanOrEqual(24);
  });

  it('adds no floor when nothing overlaps', () => {
    const { container } = render(
      <WeekView
        days={DAYS}
        eventsByDay={new Map([['2026-03-16', [makeTimedMed('a', '08:00'), makeTimedMed('b', '12:00')]]])}
        careRecipientTimezone="America/Chicago"
        todayStr={TODAY}
        onEventClick={vi.fn()}
      />
    );
    expect((container.querySelector('[data-day-column-floor]') as HTMLElement).dataset.dayColumnFloor).toBe('0');
  });
});

// Opening scroll (2026-10-02). The pinned head (day headers + all-day row) is
// `sticky top-0` inside the SAME scroller as the hour grid, so the head height
// cancels out of the scroll arithmetic: scrollTop is the lead-in hour's own
// offset, nothing added for the head. The old code added the timed grid's
// `offsetTop` (= the head's height), which hid that many pixels of the lead-in
// under the head. jsdom has no layout, so this only pins the ARITHMETIC against
// a head height we feed it; that the chips really clear the head is proved in a
// browser by e2e/flows/calendar-initial-scroll.spec.ts.
describe('WeekView opening scroll offset', () => {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop');

  afterEach(() => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'offsetTop', original);
  });

  /** Every element reports `px` as its offsetTop - i.e. the pinned head is `px` tall. */
  function headIsTall(px: number): void {
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', { configurable: true, get: () => px });
  }

  function openScrollTop(times: string[]): number {
    const eventsByDay = new Map([
      ['2026-03-16', times.map((t, i) => ({ ...makeAllDayTask(`m${i}`, `Med ${i}`, '2026-03-16'), event_type: 'medication' as const, scheduled_time: t }))],
    ]);
    const { container } = render(
      <WeekView
        days={DAYS}
        eventsByDay={eventsByDay}
        careRecipientTimezone="America/Chicago"
        todayStr={TODAY}
        onEventClick={vi.fn()}
      />
    );
    return (container.querySelector('[data-testid="week-scroller"]') as HTMLElement).scrollTop;
  }

  it.each([0, 57, 111, 207])('opens one hour above the earliest event no matter how tall the head is (%ipx)', (headPx) => {
    headIsTall(headPx);
    // 08:00 -> (8 - 1) * 80. The head's height is not part of it.
    expect(openScrollTop(['08:00', '09:30'])).toBe(7 * 80);
  });

  it('has nothing to scroll to when the earliest event is within the first hour', () => {
    headIsTall(111);
    expect(openScrollTop(['00:30'])).toBe(0);
  });
});
