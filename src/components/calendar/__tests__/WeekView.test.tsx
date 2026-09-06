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
