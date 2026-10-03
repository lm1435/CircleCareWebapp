import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { CareSummaryShareDialog } from '@/components/emergency/CareSummaryShareDialog';

// docs/plans/notes-first-class.md, Slice 4, task 30 — the share sheet that
// replaces the plain privacy confirm. `useEventNotesRange`/`useCareNotes` are
// mocked directly (their own contracts are covered by
// src/hooks/__tests__/useEventNotesRange.test.tsx and useCareNotes' own
// suite) so this file asserts the DIALOG's wiring: defaults, the live count
// line's three states, switch-disable-on-error, and the exact payload handed
// to `onShare`.

const mockUseEventNotesRange = vi.fn();
const mockUseCareNotes = vi.fn();

vi.mock('@/hooks/useEventNotes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useEventNotes')>();
  return { ...actual, useEventNotesRange: (...args: unknown[]) => mockUseEventNotesRange(...args) };
});
vi.mock('@/hooks/useCareNotes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useCareNotes')>();
  return { ...actual, useCareNotes: (...args: unknown[]) => mockUseCareNotes(...args) };
});

const TZ = 'America/New_York';

function pending() {
  return { data: undefined, isLoading: true, isError: false };
}

function loaded<T>(data: T) {
  return { data, isLoading: false, isError: false };
}

function errored() {
  return { data: undefined, isLoading: false, isError: true };
}

function renderDialog(
  overrides: Partial<React.ComponentProps<typeof CareSummaryShareDialog>> = {}
) {
  const onShare = vi.fn();
  const onCancel = vi.fn();
  render(
    <CareSummaryShareDialog
      circleId="circle-1"
      careRecipientTimezone={TZ}
      isSharing={false}
      onShare={onShare}
      onCancel={onCancel}
      {...overrides}
    />
  );
  return { onShare, onCancel };
}

// Pin "today" so the last-30-days-to-today window is deterministic.
// 2026-06-01T15:00:00Z = 11:00 AM EDT (America/New_York), same calendar day.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-06-01T15:00:00Z'));
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  mockUseEventNotesRange.mockReset();
  mockUseCareNotes.mockReset();
  mockUseEventNotesRange.mockReturnValue(loaded([]));
  mockUseCareNotes.mockReturnValue(loaded({ notes: [], today: '2026-06-01', timezone: TZ }));
});

describe('CareSummaryShareDialog', () => {
  it('defaults: visit notes ON, daily care notes OFF', () => {
    renderDialog();

    expect(screen.getByRole('switch', { name: 'Include visit notes' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.getByRole('switch', { name: 'Include daily care notes' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
  });

  it('shows the privacy sentence, verbatim, as two paragraphs', () => {
    renderDialog();

    expect(
      screen.getByText(
        'This summary contains sensitive health information including medications, allergies, and insurance details. Only share with people you trust.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "By sharing, you confirm you have permission to share this person's health information."
      )
    ).toBeInTheDocument();
  });

  it('shows "Counting notes…" while either count query is loading', () => {
    mockUseEventNotesRange.mockReturnValue(pending());
    renderDialog();

    expect(screen.getByText('Counting notes…')).toBeInTheDocument();
  });

  it('shows "Counting notes…" while the recipient timezone has not resolved (no window yet)', () => {
    renderDialog({ careRecipientTimezone: null });

    expect(screen.getByText('Counting notes…')).toBeInTheDocument();
  });

  it('shows the resolved counts once both queries load', () => {
    mockUseEventNotesRange.mockReturnValue(
      loaded([
        {
          id: 'n1',
          body: 'x',
          created_at: '2026-06-01T00:00:00Z',
          author: { first_name: 'Sam', last_name: null },
          event: { id: 'e1', title: 'Visit', scheduled_date: '2026-06-01', event_type: 'appointment' },
        },
      ])
    );
    mockUseCareNotes.mockReturnValue(loaded({ notes: [], today: '2026-06-01', timezone: TZ }));
    renderDialog();

    expect(screen.getByText('Includes 1 visit notes and 0 daily care notes')).toBeInTheDocument();
  });

  it('shows the error copy and disables both switches when a count query fails', () => {
    mockUseCareNotes.mockReturnValue(errored());
    renderDialog();

    expect(
      screen.getByText("Couldn't load notes. The summary will be shared without them.")
    ).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Include visit notes' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Include daily care notes' })).toBeDisabled();
  });

  it('Share still works when the count query errored', async () => {
    mockUseCareNotes.mockReturnValue(errored());
    const user = userEvent.setup();
    const { onShare } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(onShare).toHaveBeenCalledTimes(1);
  });

  it('queries the same last-30-days-to-today window for both note kinds, appointments only for visit notes', () => {
    renderDialog();

    expect(mockUseEventNotesRange).toHaveBeenCalledWith('circle-1', {
      from: '2026-05-02',
      to: '2026-06-01',
      event_type: 'appointment',
    });
    expect(mockUseCareNotes).toHaveBeenCalledWith('circle-1', {
      from: '2026-05-02',
      to: '2026-06-01',
    });
  });

  it('Share hands onShare exactly the current switch states (defaults)', async () => {
    const user = userEvent.setup();
    const { onShare } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Share' }));

    expect(onShare).toHaveBeenCalledWith({ includeVisitNotes: true, includeCareNotes: false });
  });

  it('toggling a switch changes the Share payload', async () => {
    const user = userEvent.setup();
    const { onShare } = renderDialog();

    await user.click(screen.getByRole('switch', { name: 'Include visit notes' }));
    await user.click(screen.getByRole('switch', { name: 'Include daily care notes' }));
    await user.click(screen.getByRole('button', { name: 'Share' }));

    expect(onShare).toHaveBeenCalledWith({ includeVisitNotes: false, includeCareNotes: true });
  });

  it('Cancel calls onCancel and never onShare', async () => {
    const user = userEvent.setup();
    const { onShare, onCancel } = renderDialog();

    // The Modal's own close (×) falls back to the SAME "Cancel" accessible
    // name, so scope to the footer row (EmergencyInfoPage test idiom).
    const dialog = screen.getByRole('dialog');
    const footer = dialog.querySelector('[data-modal-footer]') as HTMLElement;
    await user.click(within(footer).getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onShare).not.toHaveBeenCalled();
  });

  it('shows the busy label while isSharing is true', () => {
    renderDialog({ isSharing: true });
    expect(screen.getByRole('button', { name: 'Generating...' })).toBeInTheDocument();
  });
});
