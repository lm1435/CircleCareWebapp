import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import '@/i18n';

// PK5 (approved-recs-2026-09-30, B10): per-field `if_match` + 409
// EMERGENCY_INFO_CHANGED handling in the four section modals.
vi.mock('@/api/emergencyInfo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/emergencyInfo')>();
  return { ...actual, updateEmergencyInfo: vi.fn(), getEmergencyInfo: vi.fn() };
});
vi.mock('@/hooks/usePremiumGate', () => ({
  usePremiumGate: () => ({ promptUpgrade: vi.fn() }),
}));
const conflictSpy = vi.fn();
vi.mock('@/lib/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/analytics')>();
  return {
    ...actual,
    Analytics: {
      ...actual.Analytics,
      emergencyInfoConflict: (...a: unknown[]) => conflictSpy(...a),
      emergencyInfoUpdated: vi.fn(),
      errorOccurred: vi.fn(),
    },
  };
});

import { getEmergencyInfo, updateEmergencyInfo, type EmergencyInfo } from '@/api/emergencyInfo';
import { ToastProvider } from '@/components/ui';
import { useEmergencyInfo } from '@/hooks/useEmergencyInfo';
import { EditContactModal, EditMedicalInfoModal } from '@/components/emergency';

const CIRCLE_ID = 'circle-1';
const mockUpdate = vi.mocked(updateEmergencyInfo);
const mockGet = vi.mocked(getEmergencyInfo);

const info = (over: Partial<EmergencyInfo> = {}): EmergencyInfo => ({
  id: 'ei-1',
  circle_id: CIRCLE_ID,
  insurance_plans: [],
  additional_doctors: [],
  allergies: ['Zorbfruit'],
  medication_allergies: [],
  medical_conditions: [],
  blood_type: 'O+',
  emergency_contacts: [{ name: 'Ana', relationship: 'Daughter', phone: '5550100' }],
  advance_directives: null,
  has_dnr: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  ...over,
});

const V1 = {
  emergency_contacts: 'c1',
  allergies: 'a1',
  medication_allergies: 'm1',
  medical_conditions: 'd1',
  blood_type: 'b1',
};
const CONFLICT = {
  success: false,
  error: {
    code: 'EMERGENCY_INFO_CHANGED',
    message: 'x',
    details: { fields: ['emergency_contacts'], versions: {} },
  },
};

function Harness({ render: renderModal }: { render: (i: EmergencyInfo) => ReactElement }) {
  const { data } = useEmergencyInfo(CIRCLE_ID);
  return data ? renderModal(data) : null;
}
function mount(renderModal: (i: EmergencyInfo) => ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  return render(
    <Wrapper>
      <Harness render={renderModal} />
    </Wrapper>
  );
}
const nameInput = () => document.getElementById('contact-name') as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PK5 emergency modals: if_match', () => {
  it('contact save sends if_match for exactly the field it writes', async () => {
    mockGet.mockResolvedValue({ ...info(), versions: V1 });
    mockUpdate.mockResolvedValue(info());
    mount((i) => <EditContactModal circleId={CIRCLE_ID} info={i} index={0} onClose={vi.fn()} />);
    await waitFor(() => expect(nameInput()).toBeTruthy());
    fireEvent.change(nameInput(), { target: { value: 'Ana M' } });
    fireEvent.submit(document.getElementById('edit-contact-form')!);
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const body = mockUpdate.mock.calls[0][1];
    expect(body.if_match).toEqual({ emergency_contacts: 'c1' });
    expect(Object.keys(body).sort()).toEqual(['emergency_contacts', 'if_match']);
  });

  it('medical save sends if_match for its four fields', async () => {
    mockGet.mockResolvedValue({ ...info(), versions: V1 });
    mockUpdate.mockResolvedValue(info());
    mount((i) => <EditMedicalInfoModal circleId={CIRCLE_ID} info={i} onClose={vi.fn()} />);
    await screen.findByRole('dialog');
    fireEvent.submit(document.getElementById('edit-medical-form')!);
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate.mock.calls[0][1].if_match).toEqual({
      blood_type: 'b1',
      medication_allergies: 'm1',
      allergies: 'a1',
      medical_conditions: 'd1',
    });
  });

  it('sends NO if_match against a backend without versions', async () => {
    mockGet.mockResolvedValue(info());
    mockUpdate.mockResolvedValue(info());
    mount((i) => <EditContactModal circleId={CIRCLE_ID} info={i} index={0} onClose={vi.fn()} />);
    await waitFor(() => expect(nameInput()).toBeTruthy());
    fireEvent.submit(document.getElementById('edit-contact-form')!);
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect('if_match' in mockUpdate.mock.calls[0][1]).toBe(false);
  });
});

describe('PK5 emergency modals: 409 EMERGENCY_INFO_CHANGED', () => {
  it('toasts, reloads server data into the form, stays open, and re-saves with FRESH versions', async () => {
    mockGet.mockResolvedValueOnce({ ...info(), versions: V1 });
    mockUpdate.mockRejectedValueOnce(CONFLICT);
    const onClose = vi.fn();
    mount((i) => <EditContactModal circleId={CIRCLE_ID} info={i} index={0} onClose={onClose} />);
    await waitFor(() => expect(nameInput().value).toBe('Ana'));

    // Server side moved on: Ana's phone changed by caregiver B.
    mockGet.mockResolvedValue({
      ...info({ emergency_contacts: [{ name: 'Ana', relationship: 'Daughter', phone: '5559999' }] }),
      versions: { ...V1, emergency_contacts: 'c2' },
    });
    fireEvent.change(nameInput(), { target: { value: 'Stale draft' } });
    fireEvent.submit(document.getElementById('edit-contact-form')!);

    // Message (B0 copy), analytics, form reloaded to the server value, modal open.
    expect(await screen.findByText(/Someone else updated this/)).toBeInTheDocument();
    expect(conflictSpy).toHaveBeenCalledWith(1);
    await waitFor(() => expect(nameInput().value).toBe('Ana'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Second save uses the fresh hash and the server's array, not the stale one.
    mockUpdate.mockResolvedValueOnce(info());
    fireEvent.submit(document.getElementById('edit-contact-form')!);
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2));
    const second = mockUpdate.mock.calls[1][1];
    expect(second.if_match).toEqual({ emergency_contacts: 'c2' });
    expect(second.emergency_contacts?.[0].phone).toBe('5559999');
  });

  it('closes when the contact being edited was removed by the other caregiver', async () => {
    mockGet.mockResolvedValueOnce({ ...info(), versions: V1 });
    mockUpdate.mockRejectedValueOnce(CONFLICT);
    const onClose = vi.fn();
    mount((i) => <EditContactModal circleId={CIRCLE_ID} info={i} index={0} onClose={onClose} />);
    await waitFor(() => expect(nameInput().value).toBe('Ana'));
    mockGet.mockResolvedValue({
      ...info({ emergency_contacts: [] }),
      versions: { ...V1, emergency_contacts: 'c2' },
    });
    fireEvent.submit(document.getElementById('edit-contact-form')!);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('medical form reloads server tags after a conflict (no stale resurrect)', async () => {
    mockGet.mockResolvedValueOnce({ ...info(), versions: V1 });
    mockUpdate.mockRejectedValueOnce({
      ...CONFLICT,
      error: { ...CONFLICT.error, details: { fields: ['allergies'], versions: {} } },
    });
    mount((i) => <EditMedicalInfoModal circleId={CIRCLE_ID} info={i} onClose={vi.fn()} />);
    await screen.findByText('Zorbfruit');
    mockGet.mockResolvedValue({
      ...info({ allergies: ['Quuxnut'] }),
      versions: { ...V1, allergies: 'a2' },
    });
    fireEvent.submit(document.getElementById('edit-medical-form')!);
    await screen.findByText('Quuxnut');
    expect(screen.queryByText('Zorbfruit')).toBeNull();
  });
});
