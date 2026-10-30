import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { FirstMedMarkIt } from '../FirstMedMarkIt';
import { readFirstMedNote, writeFirstMedNote, type FirstMedNote } from '@/lib/firstMedNote';

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
}));
vi.mock('@/hooks/useMarkFirstDose', () => ({ useMarkFirstDose: () => markHook }));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));

const analytics = vi.hoisted(() => ({ markItShown: vi.fn(), markItTapped: vi.fn() }));
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

function renderRow(over: Partial<React.ComponentProps<typeof FirstMedMarkIt>> = {}) {
  return render(
    <FirstMedMarkIt
      circleId={CIRCLE_ID}
      timezone="UTC"
      today={TODAY}
      canEdit
      stacked={false}
      {...over}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  markHook.pending = false;
  markHook.done = false;
  markHook.mark.mockResolvedValue(true);
});

describe('FirstMedMarkIt', () => {
  it('renders nothing without a note', () => {
    const { container } = renderRow();
    expect(container).toBeEmptyDOMElement();
    expect(analytics.markItShown).not.toHaveBeenCalled();
  });

  it('shows the Tomorrow row with the Mark it line and reports mark_it_shown today', () => {
    writeFirstMedNote(CIRCLE_ID, NOTE);
    renderRow();
    const card = screen.getByTestId('first-med-mark-it');
    expect(within(card).getByText('Tomorrow')).toBeInTheDocument();
    expect(within(card).getByText('Lisinopril')).toBeInTheDocument();
    expect(within(card).getByText('10mg · 8:00 AM')).toBeInTheDocument();
    expect(screen.getByTestId('mark-it-line')).toHaveTextContent('Already given today? Mark it');
    expect(analytics.markItShown).toHaveBeenCalledTimes(1);
    expect(analytics.markItShown).toHaveBeenCalledWith('today');
  });

  it('is not shown to a viewer who cannot edit (view-only)', () => {
    writeFirstMedNote(CIRCLE_ID, NOTE);
    const { container } = renderRow({ canEdit: false });
    expect(container).toBeEmptyDOMElement();
    expect(analytics.markItShown).not.toHaveBeenCalled();
  });

  it('is gone once the recipient day has passed (the note expires)', () => {
    writeFirstMedNote(CIRCLE_ID, NOTE);
    const { container } = renderRow({ today: '2026-09-02' });
    expect(container).toBeEmptyDOMElement();
  });

  it('Mark it sends the note root id and first dose time, then shows the Taken state', async () => {
    const user = userEvent.setup();
    writeFirstMedNote(CIRCLE_ID, NOTE);
    renderRow();
    await user.click(screen.getByTestId('mark-it-button'));

    expect(markHook.mark).toHaveBeenCalledWith({ eventId: 'ev-1', time: '08:00:00' });
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
    expect(within(card).getByText('Tomorrow')).toBeInTheDocument();
    // Remembered, so a reload still shows Taken rather than offering the line again.
    expect(readFirstMedNote(CIRCLE_ID, TODAY)?.marked).toBe(true);
  });

  it('a failed mark leaves the line in place and does not remember anything', async () => {
    const user = userEvent.setup();
    markHook.mark.mockResolvedValue(false);
    writeFirstMedNote(CIRCLE_ID, NOTE);
    renderRow();
    await user.click(screen.getByTestId('mark-it-button'));

    expect(screen.getByTestId('mark-it-button')).toBeInTheDocument();
    expect(readFirstMedNote(CIRCLE_ID, TODAY)?.marked).toBe(false);
    expect(screen.queryByText('Taken by you')).not.toBeInTheDocument();
  });

  it('a note already marked shows the Taken state and does not offer the line again', () => {
    writeFirstMedNote(CIRCLE_ID, { ...NOTE, marked: true });
    renderRow();
    expect(screen.queryByTestId('mark-it-line')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('mark-it-taken-row')).getByText('Taken')).toBeInTheDocument();
    // Already marked on load: nothing is announced and focus is not moved.
    expect(screen.getByTestId('mark-it-announcer')).toHaveTextContent('');
    expect(screen.getByTestId('mark-it-taken-row')).not.toHaveFocus();
    expect(analytics.markItShown).not.toHaveBeenCalled();
  });

  it('marks the button aria-disabled (focus kept, not natively disabled) while the request is in flight', () => {
    markHook.pending = true;
    writeFirstMedNote(CIRCLE_ID, NOTE);
    renderRow();
    const button = screen.getByTestId('mark-it-button');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    // Natively disabled would drop keyboard focus to <body> mid-request.
    expect(button).not.toBeDisabled();
  });
});
