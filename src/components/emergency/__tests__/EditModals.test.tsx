import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import '@/i18n';

// Mock the WRITE fn only — keep types/read fn + Zod intact. The mutation hook
// (useUpdateEmergencyInfo) calls this; we assert on its argument (the partial
// PUT body) and resolve it so onSuccess (modal close) fires.
vi.mock('@/api/emergencyInfo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/emergencyInfo')>();
  return { ...actual, updateEmergencyInfo: vi.fn() };
});

import { updateEmergencyInfo, type EmergencyInfo } from '@/api/emergencyInfo';
import { ToastProvider } from '@/components/ui';
import { EditDoctorModal, EditMedicalInfoModal } from '@/components/emergency';

// The write hook's premium gate routes through usePremiumGate (useNavigate);
// stub it so these modals render without a Router.
vi.mock('@/hooks/usePremiumGate', () => ({
  usePremiumGate: () => ({ promptUpgrade: vi.fn() }),
}));

const CIRCLE_ID = 'circle-1';
const mockUpdate = vi.mocked(updateEmergencyInfo);

const baseInfo: EmergencyInfo = {
  id: 'ei-1',
  circle_id: CIRCLE_ID,
  insurance_plans: [],
  primary_doctor_name: null,
  additional_doctors: [
    { name: 'Dr. Patel', specialty: 'Neurology', phone: '555-0102' },
  ],
  allergies: ['Peanuts'],
  medication_allergies: ['Penicillin'],
  medical_conditions: ['Hypertension'],
  blood_type: 'O+',
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
  // Resolve with a saved row so the mutation's onSuccess (onClose) runs.
  mockUpdate.mockResolvedValue(baseInfo);
});

describe('EditDoctorModal — add a doctor', () => {
  it('appends the new doctor to additional_doctors and sends a partial PUT', async () => {
    const onClose = vi.fn();
    render(
      wrap(
        <EditDoctorModal
          circleId={CIRCLE_ID}
          info={baseInfo}
          target={undefined}
          onClose={onClose}
        />
      )
    );

    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Dr. Lee' } });
    fireEvent.change(screen.getByLabelText('Specialty'), { target: { value: 'Oncology' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));

    // Partial body: ONLY additional_doctors, read-modify-write appends to the end.
    const [, body] = mockUpdate.mock.calls[0];
    expect(Object.keys(body)).toEqual(['additional_doctors']);
    expect(body.additional_doctors).toHaveLength(2);
    expect(body.additional_doctors?.[0].name).toBe('Dr. Patel'); // existing preserved
    expect(body.additional_doctors?.[1]).toMatchObject({
      name: 'Dr. Lee',
      specialty: 'Oncology',
    });

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('blocks submit and shows an error when the name is empty', () => {
    const onClose = vi.fn();
    render(
      wrap(
        <EditDoctorModal circleId={CIRCLE_ID} info={baseInfo} target={undefined} onClose={onClose} />
      )
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(screen.getByText("Please enter the doctor's name.")).toBeInTheDocument();
  });

  it('edits the flat primary doctor fields (no array) when target=primary', async () => {
    const onClose = vi.fn();
    render(
      wrap(
        <EditDoctorModal circleId={CIRCLE_ID} info={baseInfo} target="primary" onClose={onClose} />
      )
    );

    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Dr. Chen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const [, body] = mockUpdate.mock.calls[0];
    expect(body).toMatchObject({ primary_doctor_name: 'Dr. Chen' });
    expect(body.additional_doctors).toBeUndefined();
  });
});

describe('EditMedicalInfoModal — comma-split text into arrays', () => {
  it('splits comma-separated text into trimmed string arrays', async () => {
    const onClose = vi.fn();
    render(
      wrap(<EditMedicalInfoModal circleId={CIRCLE_ID} info={baseInfo} onClose={onClose} />)
    );

    fireEvent.change(screen.getByLabelText('Other allergies'), {
      target: { value: 'Peanuts, Latex ,  Shellfish ' },
    });
    fireEvent.change(screen.getByLabelText('Medical conditions'), {
      target: { value: 'Hypertension' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const [, body] = mockUpdate.mock.calls[0];
    expect(body.allergies).toEqual(['Peanuts', 'Latex', 'Shellfish']);
    expect(body.medical_conditions).toEqual(['Hypertension']);
    // Blood type round-trips uppercased; medication allergies preserved.
    expect(body.blood_type).toBe('O+');
    expect(body.medication_allergies).toEqual(['Penicillin']);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('sends empty arrays when the list fields are cleared', async () => {
    render(wrap(<EditMedicalInfoModal circleId={CIRCLE_ID} info={baseInfo} onClose={vi.fn()} />));

    fireEvent.change(screen.getByLabelText('Medication allergies'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Other allergies'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Medical conditions'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const [, body] = mockUpdate.mock.calls[0];
    expect(body.medication_allergies).toEqual([]);
    expect(body.allergies).toEqual([]);
    expect(body.medical_conditions).toEqual([]);
  });
});
