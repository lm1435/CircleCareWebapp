import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/i18n';
import { FirstMedMarkIt } from '../FirstMedMarkIt';
import { readFirstMedNote, writeFirstMedNote, type FirstMedNote } from '@/lib/firstMedNote';
import type { FirstMedLiveRoot } from '@/api/calendarEvents';
import { useAuthStore } from '@/store/authStore';

/**
 * Today's "Tomorrow" row for a first med whose start rolled, with the "Already given today?
 * Mark it" line (boards ObTodayLine / ObTodayMarked; spec section 1). The hook that talks to
 * the server has its own suite (useMarkFirstDose.test.tsx); here: when the row shows, what
 * the tap sends, and the Taken state afterwards.
 */
const markHook = vi.hoisted(() => ({
  mark: vi.fn(),
  pending: false,
  done: false,
  refused: false,
}));
vi.mock('@/hooks/useMarkFirstDose', () => ({ useMarkFirstDose: () => markHook }));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));

const analytics = vi.hoisted(() => ({ markItShown: vi.fn(), markItTapped: vi.fn() }));

// "Has this time passed today in the recipient zone?" pinned to a 4:00 PM recipient clock, so no case depends on when
// the suite runs (the real rule compares the zone's wall clock; this keeps the same string comparison).
const clock = vi.hoisted(() => ({ now: '16:00:00' }));
vi.mock('@/utils/timezone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/timezone')>()),
  isEventPastDue: (_date: string, time: string | null) => !!time && time.slice(0, 8) <= clock.now,
}));

// The card's live root read (hooks/useFirstMedRoot -> GET /events/:id). Real React Query, mocked wire.
const api = vi.hoisted(() => ({ getFirstMedRoot: vi.fn() }));
vi.mock('@/api/calendarEvents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/calendarEvents')>()),
  getFirstMedRoot: api.getFirstMedRoot,
}));
vi.mock('@/lib/analytics', () => ({ Analytics: analytics, default: analytics }));

// Viewer and recipient pinned to UTC so the clock reads bare ("8:00 AM"), whatever the runner zone.
const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'UTC';
});
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const CIRCLE_ID = 'circle-1';
const TODAY = '2026-09-01';
const NOTE: FirstMedNote = {
  eventId: 'ev-1',
  name: 'Lisinopril',
  dosage: '10mg',
  time: '08:00:00',
  day: TODAY,
  startDate: '2026-09-02',
  marked: false,
};

/** The series root as the server has it NOW (GET /events/:id), defaulting to the note's own values. */
const liveRoot = (over: Partial<FirstMedLiveRoot> = {}): FirstMedLiveRoot => ({
  id: 'ev-1',
  circle_id: CIRCLE_ID,
  event_type: 'medication',
  parent_event_id: null,
  title: 'Lisinopril',
  medication_name: 'Lisinopril',
  medication_dosage: '10mg',
  scheduled_date: '2026-09-02',
  scheduled_time: '08:00:00',
  recurrence_rule: 'daily',
  discontinued_at: null,
  as_needed: false,
  ...over,
});

let queryClient: QueryClient;
function row(over: Partial<React.ComponentProps<typeof FirstMedMarkIt>> = {}) {
  return (
    <QueryClientProvider client={queryClient}>
      <FirstMedMarkIt
        circleId={CIRCLE_ID}
        timezone="UTC"
        today={TODAY}
        canEdit
        stacked={false}
        {...over}
      />
    </QueryClientProvider>
  );
}
function renderRow(over: Partial<React.ComponentProps<typeof FirstMedMarkIt>> = {}) {
  return render(row(over));
}
/** Let the live read settle. */
const settle = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0));
});

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  markHook.pending = false;
  markHook.done = false;
  markHook.refused = false;
  markHook.mark.mockResolvedValue(true);
  clock.now = '16:00:00';
  api.getFirstMedRoot.mockReset();
  api.getFirstMedRoot.mockResolvedValue(liveRoot());
  queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
});
afterEach(() => {
  queryClient.clear();
});

describe('FirstMedMarkIt', () => {
  it('renders nothing without a note', () => {
    const { container } = renderRow();
    expect(container).toBeEmptyDOMElement();
    expect(analytics.markItShown).not.toHaveBeenCalled();
  });

  it('shows the Tomorrow row with the Mark it line and reports mark_it_shown today', async () => {
    writeFirstMedNote(CIRCLE_ID, NOTE);
    renderRow();
    const card = await screen.findByTestId('first-med-mark-it');
    // 1.4.2: time on the left like every other dose row, the day as a phrase under the name.
    expect(screen.getByTestId('mark-it-next-label')).toHaveTextContent(/^8:00\sAM$/);
    expect(within(card).getByText('Lisinopril')).toBeInTheDocument();
    expect(screen.getByTestId('mark-it-next-sub')).toHaveTextContent('10mg · Starts tomorrow');
    // NEGATIVE: no bare day word in the left column (a bare "Mañana" read as the Morning chip in Spanish).
    expect(within(card).queryByText('Tomorrow')).toBeNull();
    expect(screen.getByTestId('mark-it-line')).toHaveTextContent('Already given today? Mark it');
    expect(analytics.markItShown).toHaveBeenCalledTimes(1);
    expect(analytics.markItShown).toHaveBeenCalledWith('today');
  });

  it('is not shown to a viewer who cannot edit (view-only)', async () => {
    writeFirstMedNote(CIRCLE_ID, NOTE);
    const { container } = renderRow({ canEdit: false });
    await settle();
    expect(container).toBeEmptyDOMElement();
    expect(analytics.markItShown).not.toHaveBeenCalled();
    expect(api.getFirstMedRoot).not.toHaveBeenCalled();
  });

  it('is gone once the recipient day has passed (the note expires)', async () => {
    writeFirstMedNote(CIRCLE_ID, NOTE);
    const { container } = renderRow({ today: '2026-09-02' });
    await settle();
    expect(container).toBeEmptyDOMElement();
  });

  it('Mark it sends the note root id and first dose time, then shows the Taken state', async () => {
    const user = userEvent.setup();
    writeFirstMedNote(CIRCLE_ID, NOTE);
    renderRow();
    await user.click(await screen.findByTestId('mark-it-button'));

    expect(markHook.mark).toHaveBeenCalledWith({ eventId: 'ev-1', time: '08:00:00', today: TODAY });
    await waitFor(() => expect(screen.queryByTestId('mark-it-button')).not.toBeInTheDocument());
    const card = screen.getByTestId('first-med-mark-it');
    expect(within(card).getByText('Today')).toBeInTheDocument();
    expect(within(card).getByText('10mg · Taken by you')).toBeInTheDocument();
    expect(within(screen.getByTestId('mark-it-taken-row')).getByText('Taken')).toBeInTheDocument();
    // a11y: the always-mounted polite region now says Taken, and focus moved from the
    // removed button to the Taken row (never <body>).
    expect(screen.getByTestId('mark-it-announcer')).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('mark-it-announcer')).toHaveTextContent('Taken');
    expect(screen.getByTestId('mark-it-taken-row')).toHaveFocus();
    // ...and the Tomorrow row stays.
    expect(screen.getByTestId('mark-it-next-sub')).toHaveTextContent('Starts tomorrow');
    // Remembered, so a reload still shows Taken rather than offering the line again.
    expect(readFirstMedNote(CIRCLE_ID, TODAY)?.marked).toBe(true);
  });

  it('N: hides the card on a non-scheduled weekday (Mon/Wed/Fri series on a Tuesday)', async () => {
    writeFirstMedNote(CIRCLE_ID, NOTE);
    api.getFirstMedRoot.mockResolvedValue(
      liveRoot({ recurrence_rule: 'weekly', recurrence_days: [1, 3, 5] }) // 2026-09-01 is a Tuesday
    );
    const { container } = renderRow();
    await settle();
    expect(container).toBeEmptyDOMElement();
    expect(analytics.markItShown).not.toHaveBeenCalled();
  });

  it('P: shows the card when today is one of the series weekdays', async () => {
    writeFirstMedNote(CIRCLE_ID, NOTE);
    api.getFirstMedRoot.mockResolvedValue(
      liveRoot({ recurrence_rule: 'weekly', recurrence_days: [2, 4] })
    );
    renderRow();
    expect(await screen.findByTestId('mark-it-line')).toBeInTheDocument();
  });

  it('N: hides the line once the server refused it (409 NOT_FIRST_DAY)', async () => {
    writeFirstMedNote(CIRCLE_ID, NOTE);
    markHook.refused = true;
    const { container } = renderRow();
    await settle();
    expect(container).toBeEmptyDOMElement();
  });

  it('N: a cached root does not survive a failed refetch (the card hides)', async () => {
    writeFirstMedNote(CIRCLE_ID, NOTE);
    const { unmount } = renderRow();
    expect(await screen.findByTestId('mark-it-line')).toBeInTheDocument();
    unmount();
    api.getFirstMedRoot.mockRejectedValue({ error: { code: 'INTERNAL_ERROR' } });
    await queryClient.invalidateQueries({ queryKey: ['calendarEvents', CIRCLE_ID] });
    renderRow();
    await settle();
    await waitFor(() => expect(screen.queryByTestId('mark-it-line')).not.toBeInTheDocument(), {
      timeout: 4000,
    });
  }, 8000);

  it('a failed mark leaves the line in place and does not remember anything', async () => {
    const user = userEvent.setup();
    markHook.mark.mockResolvedValue(false);
    writeFirstMedNote(CIRCLE_ID, NOTE);
    renderRow();
    await user.click(await screen.findByTestId('mark-it-button'));

    expect(screen.getByTestId('mark-it-button')).toBeInTheDocument();
    expect(readFirstMedNote(CIRCLE_ID, TODAY)?.marked).toBe(false);
    expect(screen.queryByText('Taken by you')).not.toBeInTheDocument();
  });

  it('a note already marked shows the Taken state and does not offer the line again', async () => {
    writeFirstMedNote(CIRCLE_ID, { ...NOTE, marked: true });
    // The server moved the start back to today when it recorded the Taken.
    api.getFirstMedRoot.mockResolvedValue(liveRoot({ scheduled_date: TODAY }));
    renderRow();
    await screen.findByTestId('mark-it-taken-row');
    expect(screen.queryByTestId('mark-it-line')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('mark-it-taken-row')).getByText('Taken')).toBeInTheDocument();
    // Already marked on load: nothing is announced and focus is not moved.
    expect(screen.getByTestId('mark-it-announcer')).toHaveTextContent('');
    expect(screen.getByTestId('mark-it-taken-row')).not.toHaveFocus();
    expect(analytics.markItShown).not.toHaveBeenCalled();
  });

  it('marks the button aria-disabled (focus kept, not natively disabled) while the request is in flight', async () => {
    markHook.pending = true;
    writeFirstMedNote(CIRCLE_ID, NOTE);
    renderRow();
    const button = await screen.findByTestId('mark-it-button');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    // Natively disabled would drop keyboard focus to <body> mid-request.
    expect(button).not.toBeDisabled();
  });
});

/**
 * prod 1.4.1, 2026-11-14 (owner): the card was a SNAPSHOT of the save. Ibuprofen saved at 8:29 AM (rolled
 * to tomorrow), then edited to 8:29 PM today: Next up said "8:29 PM, 2 minutes late" while the card still
 * said "Tomorrow · 8:29 AM · Already taken today? Mark it". Every value now comes from the live root.
 * Mobile twin: FirstMedNoteCardAndTodayPaywall.test.tsx, same P/N numbering.
 */
describe('FirstMedMarkIt follows the LIVE medication, never the save snapshot', () => {
  // ---------------------------------------------------------------- POSITIVE
  it('P1 fresh rolled first med: the live time and "Starts tomorrow", with Mark it', async () => {
    writeFirstMedNote(CIRCLE_ID, NOTE);
    renderRow();
    await screen.findByTestId('mark-it-button');
    expect(api.getFirstMedRoot).toHaveBeenCalledWith(CIRCLE_ID, 'ev-1');
    expect(screen.getByTestId('mark-it-next-label')).toHaveTextContent(/^8:00\sAM$/);
    expect(screen.getByTestId('mark-it-next-sub')).toHaveTextContent('10mg · Starts tomorrow');
  });

  it('P2 edited to a later time TODAY (the owner case): no "Starts tomorrow", no Mark it; Next up owns the dose', async () => {
    writeFirstMedNote(CIRCLE_ID, { ...NOTE, time: '08:29:00' });
    api.getFirstMedRoot.mockResolvedValue(liveRoot({ scheduled_date: TODAY, scheduled_time: '20:29:00' }));
    const { container } = renderRow();
    await waitFor(() => expect(api.getFirstMedRoot).toHaveBeenCalledTimes(1));
    await settle();
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/Starts tomorrow/)).toBeNull();
    expect(analytics.markItShown).not.toHaveBeenCalled();
  });

  it('P3 edited to another time still past today (start stays rolled): the NEW time', async () => {
    writeFirstMedNote(CIRCLE_ID, NOTE);
    api.getFirstMedRoot.mockResolvedValue(liveRoot({ scheduled_time: '07:15:00' }));
    renderRow();
    await screen.findByTestId('mark-it-button');
    expect(screen.getByTestId('mark-it-next-label')).toHaveTextContent(/^7:15\sAM$/);
    expect(screen.getByTestId('first-med-mark-it')).not.toHaveTextContent('8:00');
  });

  it('P4 edited name and dose: the card shows the new name and dose', async () => {
    writeFirstMedNote(CIRCLE_ID, NOTE);
    api.getFirstMedRoot.mockResolvedValue(
      liveRoot({ title: 'Losartan', medication_name: 'Losartan', medication_dosage: '25mg' })
    );
    renderRow();
    await screen.findByTestId('mark-it-button');
    const card = screen.getByTestId('first-med-mark-it');
    expect(within(card).getByText('Losartan')).toBeInTheDocument();
    expect(screen.getByTestId('mark-it-next-sub')).toHaveTextContent('25mg · Starts tomorrow');
    expect(card).not.toHaveTextContent('Lisinopril');
    expect(card).not.toHaveTextContent('10mg');
  });

  it('P5 Mark it targets the live root and its live time', async () => {
    const user = userEvent.setup();
    writeFirstMedNote(CIRCLE_ID, NOTE);
    api.getFirstMedRoot.mockResolvedValue(liveRoot({ scheduled_time: '06:45:00' }));
    renderRow();
    await user.click(await screen.findByTestId('mark-it-button'));
    expect(markHook.mark).toHaveBeenCalledTimes(1);
    expect(markHook.mark).toHaveBeenCalledWith({ eventId: 'ev-1', time: '06:45:00', today: TODAY });
  });

  it('P6 an edit lands while Today is open: the card follows it (calendar invalidation refetches)', async () => {
    writeFirstMedNote(CIRCLE_ID, NOTE);
    renderRow();
    await screen.findByTestId('mark-it-button');
    api.getFirstMedRoot.mockResolvedValue(liveRoot({ scheduled_date: TODAY, scheduled_time: '20:29:00' }));
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['calendarEvents', CIRCLE_ID] });
    });
    await waitFor(() => expect(screen.queryByTestId('first-med-mark-it')).toBeNull());
  });

  it('P7 a weekly start a week out names its date, never "Starts tomorrow"', async () => {
    writeFirstMedNote(CIRCLE_ID, { ...NOTE, startDate: '2026-09-08' });
    api.getFirstMedRoot.mockResolvedValue(liveRoot({ scheduled_date: '2026-09-08', recurrence_rule: 'weekly' }));
    renderRow();
    await screen.findByTestId('mark-it-button');
    const sub = screen.getByTestId('mark-it-next-sub');
    expect(sub).not.toHaveTextContent('Starts tomorrow');
    expect(sub).toHaveTextContent('10mg · Tue, Sep 8');
  });

  it('P8 marked, then the server moved the start to today: Taken row stays; a repeating med keeps its next dose', async () => {
    writeFirstMedNote(CIRCLE_ID, { ...NOTE, marked: true });
    api.getFirstMedRoot.mockResolvedValue(liveRoot({ scheduled_date: TODAY }));
    renderRow();
    await screen.findByTestId('mark-it-taken-row');
    expect(screen.queryByTestId('mark-it-button')).toBeNull();
    expect(screen.getByTestId('mark-it-next-sub')).toHaveTextContent('10mg · Starts tomorrow');
  });

  // ---------------------------------------------------------------- NEGATIVE
  it('N1 deleted medication (404): no card, no Mark it', async () => {
    writeFirstMedNote(CIRCLE_ID, NOTE);
    api.getFirstMedRoot.mockRejectedValue({ success: false, error: { code: 'NOT_FOUND', message: 'Event not found' } });
    const { container } = renderRow();
    await waitFor(() => expect(api.getFirstMedRoot).toHaveBeenCalled());
    await settle();
    expect(container).toBeEmptyDOMElement();
    expect(analytics.markItShown).not.toHaveBeenCalled();
    // A 404 is an answer, not a failure: never retried.
    expect(api.getFirstMedRoot).toHaveBeenCalledTimes(1);
  });

  it('N2 discontinued / paused medication: no card', async () => {
    writeFirstMedNote(CIRCLE_ID, NOTE);
    api.getFirstMedRoot.mockResolvedValue(liveRoot({ discontinued_at: '2026-09-01T15:00:00Z' }));
    const { container } = renderRow();
    await waitFor(() => expect(api.getFirstMedRoot).toHaveBeenCalled());
    await settle();
    expect(container).toBeEmptyDOMElement();
  });

  it('N3 changed to as-needed: no card', async () => {
    writeFirstMedNote(CIRCLE_ID, NOTE);
    api.getFirstMedRoot.mockResolvedValue(liveRoot({ as_needed: true, scheduled_time: null }));
    const { container } = renderRow();
    await waitFor(() => expect(api.getFirstMedRoot).toHaveBeenCalled());
    await settle();
    expect(container).toBeEmptyDOMElement();
  });

  it("N4 another circle's note never shows here (and is never fetched)", async () => {
    writeFirstMedNote('circle-2', NOTE);
    const { container } = renderRow();
    await settle();
    expect(container).toBeEmptyDOMElement();
    expect(api.getFirstMedRoot).not.toHaveBeenCalled();
  });

  it("N4b another signed-in user's note on this browser never shows (and is never fetched)", async () => {
    const before = useAuthStore.getState().user;
    useAuthStore.setState({ user: { ...(before ?? {}), id: 'user-a' } as never });
    writeFirstMedNote(CIRCLE_ID, NOTE);
    useAuthStore.setState({ user: { ...(before ?? {}), id: 'user-b' } as never });
    try {
      const { container } = renderRow();
      await settle();
      expect(container).toBeEmptyDOMElement();
      expect(api.getFirstMedRoot).not.toHaveBeenCalled();
    } finally {
      useAuthStore.setState({ user: before });
    }
  });

  it("N5 a root that answers for another circle is not this circle's card", async () => {
    writeFirstMedNote(CIRCLE_ID, NOTE);
    api.getFirstMedRoot.mockResolvedValue(liveRoot({ circle_id: 'circle-2' }));
    const { container } = renderRow();
    await waitFor(() => expect(api.getFirstMedRoot).toHaveBeenCalled());
    await settle();
    expect(container).toBeEmptyDOMElement();
  });

  it('N6 an edit never makes Mark it confirm a dose at the OLD time', async () => {
    const user = userEvent.setup();
    writeFirstMedNote(CIRCLE_ID, { ...NOTE, time: '08:29:00' });
    api.getFirstMedRoot.mockResolvedValue(liveRoot({ scheduled_time: '07:00:00' }));
    renderRow();
    await user.click(await screen.findByTestId('mark-it-button'));
    const sent = markHook.mark.mock.calls.map((c) => c[0].time);
    expect(sent).toEqual(['07:00:00']);
    expect(sent).not.toContain('08:29:00');
  });

  it('N7 nothing from the snapshot is drawn while the live read is still in flight', async () => {
    writeFirstMedNote(CIRCLE_ID, NOTE);
    api.getFirstMedRoot.mockReturnValue(new Promise(() => {}));
    const { container } = renderRow();
    await waitFor(() => expect(api.getFirstMedRoot).toHaveBeenCalled());
    await settle();
    expect(container).toBeEmptyDOMElement();
  });

  it('N8 a failed live read (offline, 5xx): no card rather than an unverified one', async () => {
    writeFirstMedNote(CIRCLE_ID, NOTE);
    api.getFirstMedRoot.mockRejectedValue({ success: false, error: { code: 'SERVER_ERROR' } });
    queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retryDelay: 0 } } });
    const { container } = renderRow();
    await waitFor(() => expect(api.getFirstMedRoot).toHaveBeenCalledTimes(2)); // one retry, then settled
    await settle();
    expect(container).toBeEmptyDOMElement();
  });

  it('N9 no fetch storm: re-renders and the Taken re-read never re-request the root', async () => {
    const user = userEvent.setup();
    writeFirstMedNote(CIRCLE_ID, NOTE);
    const utils = renderRow();
    await screen.findByTestId('mark-it-button');
    for (let i = 0; i < 6; i += 1) {
      utils.rerender(row({ stacked: i % 2 === 0 }));
      await settle();
    }
    // A successful mark re-reads the NOTE (same event id): still one root read (the mutation's own
    // invalidation is what refreshes it in the app, and the hook is mocked here).
    await user.click(screen.getByTestId('mark-it-button'));
    await screen.findByTestId('mark-it-taken-row');
    await settle();
    expect(api.getFirstMedRoot).toHaveBeenCalledTimes(1);
  });

  it('N12 still rolled, but the live time today has not come yet: no Mark it (the server would refuse a dose still ahead)', async () => {
    clock.now = '07:00:00';
    writeFirstMedNote(CIRCLE_ID, NOTE);
    const { container } = renderRow();
    await waitFor(() => expect(api.getFirstMedRoot).toHaveBeenCalled());
    await settle();
    expect(container).toBeEmptyDOMElement();
    expect(analytics.markItShown).not.toHaveBeenCalled();
  });

  it('N11 marked one-off: the Taken row only, no next dose that does not exist', async () => {
    writeFirstMedNote(CIRCLE_ID, { ...NOTE, marked: true });
    api.getFirstMedRoot.mockResolvedValue(liveRoot({ scheduled_date: TODAY, recurrence_rule: null }));
    renderRow();
    await screen.findByTestId('mark-it-taken-row');
    expect(screen.queryByTestId('mark-it-next-sub')).toBeNull();
    expect(screen.queryByTestId('mark-it-next-label')).toBeNull();
  });
});
