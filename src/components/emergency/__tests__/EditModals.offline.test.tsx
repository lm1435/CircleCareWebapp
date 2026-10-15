import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import '@/i18n';

// Mock the WRITE fn only (same pattern as EditModals.test.tsx).
vi.mock('@/api/emergencyInfo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/emergencyInfo')>();
  return { ...actual, updateEmergencyInfo: vi.fn() };
});

vi.mock('@/hooks/usePremiumGate', () => ({
  usePremiumGate: () => ({ promptUpgrade: vi.fn() }),
}));

import { updateEmergencyInfo, type EmergencyInfo } from '@/api/emergencyInfo';
import { ToastProvider } from '@/components/ui';
import { EditContactModal } from '@/components/emergency';
import { __resetOfflineWriteForTests } from '@/lib/offlineWrite';

// A form already open when the connection drops (owner decision 2026-10-14):
// Save explains ("You're offline. Connect to save this."), sends nothing, and
// the caregiver's input stays exactly as typed; the dialog stays open.

const CIRCLE_ID = 'circle-1';
const mockUpdate = vi.mocked(updateEmergencyInfo);

const baseInfo: EmergencyInfo = {
  id: 'ei-1',
  circle_id: CIRCLE_ID,
  insurance_plans: [],
  primary_doctor_name: null,
  additional_doctors: [],
  allergies: [],
  medication_allergies: [],
  medical_conditions: [],
  blood_type: null,
  emergency_contacts: [],
  advance_directives: null,
  has_dnr: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

function wrap(ui: ReactElement): ReactElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  return <Wrapper>{ui}</Wrapper>;
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetOfflineWriteForTests();
  mockUpdate.mockResolvedValue(baseInfo);
});
afterEach(() => onlineManager.setOnline(true));

it('EditContactModal offline: Save explains, sends nothing, keeps the input; online it saves', async () => {
  const onClose = vi.fn();
  render(wrap(<EditContactModal circleId={CIRCLE_ID} info={baseInfo} onClose={onClose} />));

  fireEvent.change(screen.getByLabelText(/^Name.*required/i), { target: { value: 'Sarah Smith' } });
  fireEvent.change(screen.getByLabelText(/^Relationship.*required/i), {
    target: { value: 'Daughter' },
  });
  fireEvent.change(screen.getByLabelText(/^Phone.*required/i), {
    target: { value: '(303) 555-0101' },
  });

  act(() => onlineManager.setOnline(false));
  const save = screen.getByRole('button', { name: 'Save' });
  expect(save).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(save);

  expect(await screen.findByText("You're offline. Connect to save this.")).toBeInTheDocument();
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByLabelText(/^Name.*required/i)).toHaveValue('Sarah Smith');
  expect(screen.getByLabelText(/^Relationship.*required/i)).toHaveValue('Daughter');

  // Reconnect: nothing replays on its own; the caregiver's own Save sends it once.
  act(() => onlineManager.setOnline(true));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  expect(mockUpdate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
});
