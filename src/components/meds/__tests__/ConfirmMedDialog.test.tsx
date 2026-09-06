import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { ConfirmMedDialog } from '../ConfirmMedDialog';
import type { TodaysMedication } from '@/api/medicationConfirmations';

// 409 MEDICATION_DISCONTINUED handling.
//
// The backend now ACCEPTS a confirm for a dose that was genuinely due (before
// the stop instant, outside any pause window) and 409s only the rest — so this
// dialog does not refuse an inactive medication's dose on its own (see the
// submit test below). The 409 path still has to exist: a stale client view can
// aim at a dose that was never due, and that must read as a specific state
// conflict, not a generic "try again" the user could retry forever.

type MutateOptions = {
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
};
const mutate = vi.fn<(vars: unknown, opts: MutateOptions) => void>();

vi.mock('@/hooks/useMedConfirmation', () => ({
  useConfirmMedication: () => ({ mutate, isPending: false }),
}));

// The viewer's 12h/24h clock. The real hook reads the shared currentUser React
// Query — pin it so this dialog test needs no QueryClientProvider and the
// scheduled-time line is deterministic.
const mockUseHourCycle = vi.fn();
vi.mock('@/hooks/useHourCycle', () => ({
  useHourCycle: () => mockUseHourCycle(),
}));

const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

const med: TodaysMedication = {
  id: 'med-1',
  title: 'Metformin',
  medication_name: 'Metformin',
  medication_dosage: '500 mg',
  scheduled_date: '2026-07-29',
  scheduled_time: '08:00:00',
  confirmation: null,
} as TodaysMedication;

function envelope(code: string) {
  return { success: false, error: { code, message: 'x' } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseHourCycle.mockReturnValue('12h');
});

function renderDialog() {
  return render(
    <ConfirmMedDialog
      source="care_profile"
      circleId="circle-1"
      med={med}
      careRecipientTimezone="America/New_York"
      onClose={vi.fn()}
    />
  );
}

describe('ConfirmMedDialog — not-due guard (defense in depth)', () => {
  // Both web surfaces already hide Confirm/Skip until the dose is inside its
  // early-confirm window, and mobile re-checks the same predicate at the
  // mutation rather than trusting the rendered affordance. This dialog is web's
  // single mutation entry point, so the check lives here. It is NOT redundant:
  // the backend does not enforce "not yet due" today, so without this a dialog
  // left open across midnight — or any future caller that skips the gate —
  // writes a dose that was never due into the clinician-facing adherence
  // record.
  const farFutureMed = {
    ...med,
    scheduled_date: '2099-01-01',
    scheduled_time: '08:00:00',
  } as TodaysMedication;

  it('refuses to POST a dose that is not due yet, and says why', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmMedDialog
      source="care_profile"
        circleId="circle-1"
        med={farFutureMed}
        careRecipientTimezone="America/New_York"
        onClose={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/isn't due yet/i);
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe('ConfirmMedDialog — 409 MEDICATION_DISCONTINUED', () => {
  it('shows the specific inactive-med message on MEDICATION_DISCONTINUED', async () => {
    mutate.mockImplementation((_vars, opts) => {
      opts.onError?.(envelope('MEDICATION_DISCONTINUED'));
    });
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(
      "This dose wasn't due before the medication was stopped, so it can't be logged. " +
        'Reactivate the medication to log doses again.'
    );
    // NOT the generic retry copy.
    expect(alert).not.toHaveTextContent("Couldn't save. Please try again.");
  });

  // THE REVERSAL: a dose of an inactive medication is submitted like any other.
  // Calendar surfaces (this dialog's callers — TodaysMeds and the calendar
  // detail modal) fetch WITHOUT `includeDiscontinued`, so a dose they can show
  // is one the backend already found due. Gating the submit on
  // `discontinued_at` is what made a real-but-unlogged dose permanently
  // unloggable, and permanently "missed" in the adherence report.
  it('submits a dose of an INACTIVE medication — the dialog does not gate on discontinued_at', async () => {
    // `clearAllMocks` clears calls, not implementations — pin the happy path so
    // the previous test's rejecting implementation cannot leak in.
    mutate.mockImplementation((_vars, opts) => opts.onSuccess?.());
    const user = userEvent.setup();
    render(
      <ConfirmMedDialog
      source="care_profile"
        circleId="circle-1"
        med={{ ...med, discontinued_at: '2026-07-29T18:00:00Z' }}
        careRecipientTimezone="America/New_York"
        onClose={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({
      event_id: 'med-1',
      status: 'taken',
      scheduled_time: '08:00:00',
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the generic message for other failures', async () => {
    mutate.mockImplementation((_vars, opts) => {
      opts.onError?.(envelope('SERVER_ERROR'));
    });
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't save. Please try again.");
  });
});

describe('ConfirmMedDialog — status options', () => {
  // The two hand-rolled `role="radio"` buttons (with their own roving-tabindex
  // arrow handling and their own selected/unselected class pair) are now the
  // shared `RadioGroup`: real `<input type="radio">` elements, so keyboard
  // support and the selection language both come from one place instead of
  // being re-implemented per dialog. `accent-ink` is that language.
  it('renders the two statuses as a real radio group, taken preselected', async () => {
    const user = userEvent.setup();
    renderDialog();

    const takenOption = screen.getByRole('radio', { name: 'Taken' });
    const skippedOption = screen.getByRole('radio', { name: 'Skipped' });

    expect(takenOption).toHaveAttribute('type', 'radio');
    expect(takenOption.className).toContain('accent-ink');
    // initialStatus defaults to 'taken'.
    expect(takenOption).toBeChecked();
    expect(skippedOption).not.toBeChecked();

    await user.click(skippedOption);

    expect(skippedOption).toBeChecked();
    expect(takenOption).not.toBeChecked();
  });

  // The dialog owns no focus trap, backdrop, scroll lock or footer layout of
  // its own any more — it is a `Modal` (spec §4.5). A dialog role with the
  // shared close control is the observable half of that.
  it('is rendered by the shared Modal shell', () => {
    renderDialog();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});

describe('which DAY this confirmation is for', () => {
  /**
   * "Needs Attention" routes YESTERDAY's unanswered doses through this same
   * dialog, so without a day the two rows of a daily medication open dialogs
   * that read identically — and picking the wrong one files adherence against
   * the wrong calendar day.
   */
  function renderFor(scheduledDate: string) {
    return render(
      <ConfirmMedDialog
        source="care_profile"
        circleId="circle-1"
        med={{ ...med, scheduled_date: scheduledDate } as TodaysMedication}
        careRecipientTimezone="America/New_York"
        onClose={vi.fn()}
      />
    );
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('names the day when the dose is YESTERDAY in the recipient frame', () => {
    // 2026-07-29T16:00Z = 12:00 in New York, so NY "today" is 2026-07-29.
    vi.setSystemTime(new Date('2026-07-29T16:00:00.000Z'));
    renderFor('2026-07-28');
    expect(screen.getByText(/Yesterday/)).toBeInTheDocument();
  });

  it('stays quiet for an ordinary same-day dose', () => {
    vi.setSystemTime(new Date('2026-07-29T16:00:00.000Z'));
    renderFor('2026-07-29');
    expect(screen.queryByText(/Yesterday/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Today/)).not.toBeInTheDocument();
  });

  it('falls back to a date for anything older', () => {
    vi.setSystemTime(new Date('2026-07-29T16:00:00.000Z'));
    renderFor('2026-07-20');
    expect(screen.getByText(/Jul 20/)).toBeInTheDocument();
  });

  it('resolves the day in the RECIPIENT frame, not the viewer one', () => {
    // 2026-07-30T03:00Z is still 2026-07-29 (23:00) in New York. A dose dated
    // 2026-07-29 is therefore TODAY for the recipient and must stay unlabelled,
    // even though the UTC/viewer calendar has already rolled over.
    vi.setSystemTime(new Date('2026-07-30T03:00:00.000Z'));
    renderFor('2026-07-29');
    expect(screen.queryByText(/Yesterday/)).not.toBeInTheDocument();
  });
});
