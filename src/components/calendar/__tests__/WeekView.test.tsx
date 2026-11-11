import { fireEvent, render, screen, within } from '@testing-library/react';
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

describe('WeekView tabular figures', () => {
  it('the grid uses tabular figures for its times (audit 2026-11-07 #18)', () => {
    renderWeek();
    expect(screen.getByRole('grid')).toHaveClass('tabular-nums');
  });
});

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
    // Same-type items at one minute collapse into one chip now, so five lanes need five different
    // minutes that overlap (each med lasts 60 minutes here).
    const meds = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({
      ...makeTimedMed(id, `08:0${i + 1}`),
      duration_minutes: 60,
    }));
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

// Owner 2026-11-10 (iPhone Safari): the timed grid was a `max-h-[70vh]
// overflow-auto` box inside the scrolling page — a double vertical scroll.
// Below lg the grid now lays out at full height and the PAGE is the only
// vertical scroll; the head pins to the page under the 60px app header. jsdom
// has no layout, so this pins the class contract and the scroll arithmetic;
// the real geometry is proved by e2e/flows/calendar-initial-scroll.spec.ts.
describe('WeekView: one vertical scroll (the page) below lg', () => {
  const eightAm = new Map([
    [
      '2026-03-16',
      [{ ...makeAllDayTask('m1', 'Med', '2026-03-16'), event_type: 'medication' as const, scheduled_time: '08:00' }],
    ],
  ]);

  function renderWeek() {
    return render(
      <WeekView
        days={DAYS}
        eventsByDay={eightAm}
        careRecipientTimezone="America/Chicago"
        todayStr={TODAY}
        onEventClick={vi.fn()}
      />
    );
  }

  /** Stub `matchMedia` so the lg (64rem) query answers `wide`. */
  function viewportIsWide(wide: boolean): void {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === '(min-width: 64rem)' ? wide : false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('the grid has no unprefixed fixed height or vertical scroller; both are lg-only', () => {
    const { container } = renderWeek();
    const scroller = container.querySelector('[data-testid="week-scroller"]') as HTMLElement;
    const classes = scroller.className.split(/\s+/);
    // Base (phone) classes: horizontal pan only.
    expect(classes).toContain('overflow-x-auto');
    for (const banned of ['overflow-auto', 'overflow-y-auto', 'overflow-y-scroll', 'overflow-scroll']) {
      expect(classes).not.toContain(banned);
    }
    expect(classes.filter((c) => /^(max-h|h)-/.test(c))).toEqual([]);
    expect(scroller.getAttribute('style') ?? '').not.toMatch(/height/);
    // Desktop keeps its capped scroller.
    expect(classes).toEqual(expect.arrayContaining(['lg:max-h-[70vh]', 'lg:overflow-y-auto']));
  });

  it('the head pins to the PAGE: sticky under the app header, outside the grid scroller, in an overflow-clip card', () => {
    const { container } = renderWeek();
    const scroller = container.querySelector('[data-testid="week-scroller"]') as HTMLElement;
    const head = container.querySelector('[data-testid="week-pinned-head"]') as HTMLElement;
    expect(head.className.split(/\s+/)).toEqual(expect.arrayContaining(['sticky', 'top-[60px]']));
    expect(scroller.contains(head)).toBe(false);
    // `overflow-hidden` on ANY ancestor up to the card would make that the
    // sticky head's scroll container and pin it to the card instead.
    const grid = screen.getByRole('grid');
    for (let el: HTMLElement | null = head.parentElement; el && el !== grid.parentElement; el = el.parentElement) {
      expect(el.className).not.toMatch(/(^|\s)overflow-(hidden|auto|scroll)(\s|$)/);
    }
    expect(grid.className).toMatch(/(^|\s)overflow-clip(\s|$)/);
  });

  it('phone: the opening scroll moves the PAGE (window.scrollTo), never the grid box', () => {
    viewportIsWide(false);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const realStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) =>
      (el as HTMLElement).dataset?.testid === 'week-pinned-head'
        ? ({ top: '60px' } as CSSStyleDeclaration)
        : realStyle(el)
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const id = this.dataset.testid;
      if (id === 'week-pinned-head') return { top: 200, height: 100 } as DOMRect;
      if (id === 'week-scroller') return { top: 300, height: 1920 } as DOMRect;
      return { top: 0, height: 0 } as DOMRect;
    });
    const { container } = renderWeek();
    const scroller = container.querySelector('[data-testid="week-scroller"]') as HTMLElement;
    // grid's page offset 300 + lead-in (8 - 1) * 80 - stuck head bottom (60 + 100).
    expect(scrollTo).toHaveBeenCalledWith({ top: 300 + 7 * 80 - 160, behavior: 'instant' });
    expect(scroller.scrollTop).toBe(0);
  });

  it('lg+: the opening scroll stays inside the grid box and leaves the page alone', () => {
    viewportIsWide(true);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const { container } = renderWeek();
    const scroller = container.querySelector('[data-testid="week-scroller"]') as HTMLElement;
    expect(scroller.scrollTop).toBe(7 * 80);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('panning the grid sideways pans the head with it (and back)', () => {
    const { container } = renderWeek();
    const scroller = container.querySelector('[data-testid="week-scroller"]') as HTMLElement;
    const headScroller = container.querySelector('[data-testid="week-head-scroller"]') as HTMLElement;
    scroller.scrollLeft = 240;
    fireEvent.scroll(scroller);
    expect(headScroller.scrollLeft).toBe(240);
    headScroller.scrollLeft = 480;
    fireEvent.scroll(headScroller);
    expect(scroller.scrollLeft).toBe(480);
  });
});


// Owner 2026-11-07: timed items of one type at one minute collapse into ONE chip ("5 meds", "2 tasks")
// that opens a list, instead of five unreadable ~24px lanes.
describe('WeekView same-slot chips', () => {
  const DAY = '2026-03-16';
  function timed(id: string, type: CalendarEvent['event_type'], time: string, title = `Item ${id}`): CalendarEvent {
    return {
      ...makeAllDayTask(id, title, DAY),
      event_type: type,
      scheduled_time: time,
      ...(type === 'medication' ? { medication_name: title } : {}),
    } as CalendarEvent;
  }
  function renderDay(events: CalendarEvent[], onEventClick = vi.fn()) {
    const utils = render(
      <WeekView
        days={DAYS}
        eventsByDay={new Map([[DAY, events]])}
        careRecipientTimezone="America/Chicago"
        todayStr={TODAY}
        onEventClick={onEventClick}
      />
    );
    return { onEventClick, ...utils };
  }

  it('five meds at 8:00 collapse into ONE "5 meds" chip, no per-med chips, no lane floor', () => {
    const meds = ['Aspirin', 'Lisinopril', 'Metformin', 'Vitamin D', 'Zinc'].map((n, i) =>
      timed(`m${i}`, 'medication', '08:00', n)
    );
    const { container } = renderDay(meds);
    expect(screen.getByRole('button', { name: /5 meds/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aspirin/ })).not.toBeInTheDocument();
    expect((container.querySelector('[data-day-column-floor]') as HTMLElement).dataset.dayColumnFloor).toBe('0');
  });

  it('two tasks at one minute read "2 tasks"; a lone item keeps its own chip', () => {
    renderDay([timed('t1', 'task', '09:00'), timed('t2', 'task', '09:00'), timed('t3', 'task', '11:00', 'Solo errand')]);
    expect(screen.getByRole('button', { name: /2 tasks/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Solo errand/ })).toBeInTheDocument();
  });

  it('different types at the same minute stay separate chips', () => {
    renderDay([timed('m1', 'medication', '08:00', 'Aspirin'), timed('a1', 'appointment', '08:00', 'Dr Lee')]);
    expect(screen.getByRole('button', { name: /Aspirin/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Dr Lee/ })).toBeInTheDocument();
  });

  it('the chip opens a list of its items; picking one closes the list and opens that item', async () => {
    const user = userEvent.setup();
    const meds = ['Aspirin', 'Lisinopril', 'Metformin'].map((n, i) => timed(`m${i}`, 'medication', '08:00', n));
    const { onEventClick } = renderDay(meds);
    await user.click(screen.getByRole('button', { name: /3 meds/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/8:00 AM/)).toBeInTheDocument();
    expect(within(dialog).getAllByRole('button', { name: /Aspirin|Lisinopril|Metformin/ })).toHaveLength(3);
    // Each list item carries the accessible name its grid chip would have had.
    await user.click(within(dialog).getByRole('button', { name: /^Lisinopril, Medication/ }));
    expect(onEventClick).toHaveBeenCalledWith(meds[1]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
