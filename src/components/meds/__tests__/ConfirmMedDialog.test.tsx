import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { ConfirmMedDialog } from '../ConfirmMedDialog';
import type { TodaysMedication } from '@/api/medicationConfirmations';

// Stage 17 — 409 MEDICATION_DISCONTINUED handling: confirming a dose for an
// inactive med shows the specific "reactivate it to log doses" message, not
// the generic retry copy (which would mislead — retrying can never succeed).

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
      circleId="circle-1"
      med={med}
      careRecipientTimezone="America/New_York"
      onClose={vi.fn()}
    />
  );
}

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
      'This medication is inactive — reactivate it to log doses.'
    );
    // NOT the generic retry copy.
    expect(alert).not.toHaveTextContent("Couldn't save. Please try again.");
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
