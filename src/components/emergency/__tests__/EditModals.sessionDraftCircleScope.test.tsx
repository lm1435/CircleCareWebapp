import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import '@/i18n';
import type { EmergencyInfo } from '@/api/emergencyInfo';
import { ToastProvider } from '@/components/ui';
import {
  EditContactModal,
  EditDoctorModal,
  EditInsuranceModal,
  EditMedicalInfoModal,
} from '@/components/emergency';
import { onSessionEnded, saveDraftsForForcedSignOut } from '@/lib/sessionDraft';
import { useAuthStore } from '@/store/authStore';

// SECURITY (web audit 2026-10-01): a PK9 draft is emergency-info PHI for ONE
// care recipient. It must only ever be restored into the SAME circle's form.
// The emergency modals keyed their drafts without the circle id
// (`emergency:medical`, `emergency:contact:new`, ...), so a draft typed for
// circle A (Mom) re-filled the same form opened in circle B (Dad) — whose other
// members may not be in circle A — and one Save wrote A's allergies/contacts
// into B's record.

vi.mock('@/api/emergencyInfo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/emergencyInfo')>();
  return { ...actual, updateEmergencyInfo: vi.fn() };
});
vi.mock('@/hooks/usePremiumGate', () => ({
  usePremiumGate: () => ({ promptUpgrade: vi.fn() }),
}));

const info = (circleId: string): EmergencyInfo => ({
  id: `ei-${circleId}`,
  circle_id: circleId,
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
});

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
  sessionStorage.clear();
  useAuthStore.setState({
    user: { id: 'u1', email: 'u1@x.y', first_name: null, last_name: null },
  });
});

function forceSignOut(): void {
  saveDraftsForForcedSignOut('u1');
  onSessionEnded();
}

type Modal = (circleId: string) => ReactElement;

const textModals: Array<[string, Modal, RegExp]> = [
  [
    'EditContactModal (new)',
    (c) => <EditContactModal circleId={c} info={info(c)} onClose={vi.fn()} />,
    /^name/i,
  ],
  [
    'EditDoctorModal (new)',
    (c) => <EditDoctorModal circleId={c} info={info(c)} target={undefined} onClose={vi.fn()} />,
    /^name/i,
  ],
  [
    'EditInsuranceModal (new)',
    (c) => <EditInsuranceModal circleId={c} info={info(c)} onClose={vi.fn()} />,
    /carrier/i,
  ],
];

describe.each(textModals)('%s draft is scoped to its circle', (_name, modal, field) => {
  it('is NOT restored into another circle, and IS restored into the same one', async () => {
    const user = userEvent.setup();
    const first = render(wrap(modal('circle-A')));
    await user.type(screen.getAllByRole('textbox', { name: field })[0], 'Circle A Only');
    forceSignOut();
    first.unmount();

    const other = render(wrap(modal('circle-B')));
    expect(screen.queryByDisplayValue('Circle A Only')).toBeNull();
    other.unmount();

    render(wrap(modal('circle-A')));
    expect(screen.getByDisplayValue('Circle A Only')).toBeInTheDocument();
  });
});

describe('EditMedicalInfoModal draft is scoped to its circle', () => {
  it('a blood type picked for circle A never appears in circle B', async () => {
    const user = userEvent.setup();
    const first = render(
      wrap(<EditMedicalInfoModal circleId="circle-A" info={info('circle-A')} onClose={vi.fn()} />)
    );
    await user.click(screen.getByRole('radio', { name: 'AB-' }));
    expect(screen.getByRole('radio', { name: 'AB-' })).toHaveAttribute('aria-checked', 'true');
    forceSignOut();
    first.unmount();

    const other = render(
      wrap(<EditMedicalInfoModal circleId="circle-B" info={info('circle-B')} onClose={vi.fn()} />)
    );
    expect(screen.getByRole('radio', { name: 'AB-' })).toHaveAttribute('aria-checked', 'false');
    other.unmount();

    render(
      wrap(<EditMedicalInfoModal circleId="circle-A" info={info('circle-A')} onClose={vi.fn()} />)
    );
    expect(screen.getByRole('radio', { name: 'AB-' })).toHaveAttribute('aria-checked', 'true');
  });
});
