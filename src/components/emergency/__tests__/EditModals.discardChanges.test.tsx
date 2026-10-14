import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactElement, type ReactNode } from 'react';
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom';
import '@/i18n';

// "Discard changes?" on the Emergency/Health edit modals (owner-approved
// 2026-10-14). Every modal goes through the shared useDiscardChangesGuard; these
// prove each modal feeds it the right `dirty`, routes ALL its close gestures
// through it, and bypasses it on a successful save.

vi.mock('@/api/emergencyInfo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/emergencyInfo')>();
  return { ...actual, updateEmergencyInfo: vi.fn() };
});
vi.mock('@/hooks/usePremiumGate', () => ({
  usePremiumGate: () => ({ promptUpgrade: vi.fn() }),
}));

import { updateEmergencyInfo, type EmergencyInfo } from '@/api/emergencyInfo';
import { ToastProvider } from '@/components/ui';
import {
  EditContactModal,
  EditDoctorModal,
  EditInsuranceModal,
  EditMedicalInfoModal,
} from '@/components/emergency';
import { onSessionEnded, saveDraftsForForcedSignOut } from '@/lib/sessionDraft';
import { useAuthStore } from '@/store/authStore';

const CIRCLE_ID = 'circle-1';
const mockUpdate = vi.mocked(updateEmergencyInfo);

// Every entry carries a phone in a NON-canonical display form, so "an untouched
// form is not dirty" also covers the phone normalization done at mount.
const baseInfo: EmergencyInfo = {
  id: 'ei-1',
  circle_id: CIRCLE_ID,
  insurance_plans: [{ carrier: 'Aetna', phone: '(303) 555-0199', is_primary: true }],
  primary_doctor_name: null,
  additional_doctors: [{ name: 'Dr. Patel', specialty: 'Neurology', phone: '(303) 555-0102' }],
  allergies: ['Peanuts'],
  medication_allergies: ['Penicillin'],
  medical_conditions: ['Hypertension'],
  blood_type: 'O+',
  emergency_contacts: [
    { name: 'Ana', relationship: 'Daughter', phone: '303.555.0123', is_primary: true },
  ],
  advance_directives: null,
  has_dnr: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

function Providers({ children }: { children: ReactNode }): ReactElement {
  const [queryClient] = useState(
    () =>
      new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  );
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

type Case = {
  name: string;
  render: (onClose: () => void) => ReactElement;
  /** Make one real edit; returns the field whose text must survive "Keep editing". */
  edit: () => Promise<HTMLElement>;
  /** What that field holds after the edit. */
  editedValue: string;
};

const cases: Case[] = [
  {
    name: 'EditDoctorModal',
    render: (onClose) => (
      <EditDoctorModal circleId={CIRCLE_ID} info={baseInfo} target={0} onClose={onClose} />
    ),
    edit: async () => {
      const field = document.getElementById('doctor-name') as HTMLInputElement;
      await userEvent.type(field, ' Jr');
      return field;
    },
    editedValue: 'Dr. Patel Jr',
  },
  {
    name: 'EditContactModal',
    render: (onClose) => (
      <EditContactModal circleId={CIRCLE_ID} info={baseInfo} index={0} onClose={onClose} />
    ),
    edit: async () => {
      const field = document.getElementById('contact-name') as HTMLInputElement;
      await userEvent.type(field, 'lia');
      return field;
    },
    editedValue: 'Analia',
  },
  {
    name: 'EditInsuranceModal',
    render: (onClose) => (
      <EditInsuranceModal circleId={CIRCLE_ID} info={baseInfo} index={0} onClose={onClose} />
    ),
    edit: async () => {
      const field = document.getElementById('insurance-policy') as HTMLInputElement;
      await userEvent.type(field, 'P-123');
      return field;
    },
    editedValue: 'P-123',
  },
  {
    name: 'EditMedicalInfoModal',
    render: (onClose) => (
      <EditMedicalInfoModal circleId={CIRCLE_ID} info={baseInfo} onClose={onClose} />
    ),
    edit: async () => {
      await userEvent.click(screen.getByRole('radio', { name: 'A+' }));
      return screen.getByRole('radio', { name: 'A+' });
    },
    editedValue: 'A+',
  },
];

function formDialog(): HTMLElement {
  // The form's dialog is the first; the prompt (a sibling) comes after it.
  return screen.getAllByRole('dialog')[0];
}

function queryPrompt(): HTMLElement | null {
  return screen.queryByRole('dialog', { name: 'Discard changes?' });
}

function expectEdited(field: HTMLElement, value: string): void {
  if (field.getAttribute('role') === 'radio') {
    expect(field).toHaveAttribute('aria-checked', 'true');
  } else {
    expect(field).toHaveValue(value);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mockUpdate.mockResolvedValue(baseInfo);
});

describe.each(cases)('$name — discard changes prompt', ({ render: ui, edit, editedValue }) => {
  it('untouched: Cancel, × and Escape close at once with no prompt', async () => {
    const onClose = vi.fn();
    render(<Providers>{ui(onClose)}</Providers>);

    await userEvent.click(within(formDialog()).getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(within(formDialog()).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(formDialog(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(queryPrompt()).toBeNull();
  });

  it('dirty: Cancel prompts; Keep editing keeps the form and the edit', async () => {
    const onClose = vi.fn();
    render(<Providers>{ui(onClose)}</Providers>);
    const field = await edit();

    await userEvent.click(within(formDialog()).getByRole('button', { name: 'Cancel' }));
    const prompt = queryPrompt();
    expect(prompt).not.toBeNull();
    expect(within(prompt!).getByText("What you typed here won't be saved.")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(within(prompt!).getByRole('button', { name: 'Keep editing' }));
    expect(queryPrompt()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expectEdited(field, editedValue);
  });

  it('dirty: Escape on the prompt is "Keep editing" and does not close the form', async () => {
    const onClose = vi.fn();
    render(<Providers>{ui(onClose)}</Providers>);
    await edit();

    // Escape on the FORM asks; Escape on the PROMPT backs out of the question.
    fireEvent.keyDown(formDialog(), { key: 'Escape' });
    const prompt = queryPrompt();
    expect(prompt).not.toBeNull();
    // The prompt owns focus (its × button), so the keyboard is on it.
    expect(prompt!.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(prompt!, { key: 'Escape' });

    expect(queryPrompt()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('dirty: × prompts, and Discard closes', async () => {
    const onClose = vi.fn();
    render(<Providers>{ui(onClose)}</Providers>);
    await edit();

    await userEvent.click(within(formDialog()).getByRole('button', { name: 'Close' }));
    const prompt = queryPrompt();
    expect(prompt).not.toBeNull();
    // Two distinct names on the prompt's dismiss controls (WCAG 2.4.6).
    expect(within(prompt!).getByRole('button', { name: 'Close' })).toBeInTheDocument();
    await userEvent.click(within(prompt!).getByRole('button', { name: 'Discard' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('dirty: a successful Save closes without the prompt', async () => {
    const onClose = vi.fn();
    render(<Providers>{ui(onClose)}</Providers>);
    await edit();

    await userEvent.click(within(formDialog()).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(queryPrompt()).toBeNull();
  });

  it('beforeunload is armed only while dirty, and disarmed by a successful save', async () => {
    const onClose = vi.fn();
    render(<Providers>{ui(onClose)}</Providers>);
    const fire = (): boolean => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };

    expect(fire()).toBe(false);
    await edit();
    expect(fire()).toBe(true);

    await userEvent.click(within(formDialog()).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // `onClose` is a spy here, so the form is STILL mounted — and still differs
    // from its baseline. The save alone must have disarmed it.
    expect(fire()).toBe(false);
  });
});

// PK9: a draft restored after a forced sign-out is unsaved work the user has
// not seen saved anywhere — it counts as dirty even though nobody typed in THIS
// mount.
describe('restored session draft', () => {
  it('a restored draft that differs from the record is dirty', async () => {
    useAuthStore.setState({
      user: { id: 'u1', email: 'u1@x.y', first_name: null, last_name: null },
    });
    const first = render(<Providers>{cases[0].render(vi.fn())}</Providers>);
    await cases[0].edit();
    saveDraftsForForcedSignOut('u1');
    onSessionEnded();
    first.unmount();

    const onClose = vi.fn();
    render(<Providers>{cases[0].render(onClose)}</Providers>);
    await waitFor(() =>
      expect(document.getElementById('doctor-name')).toHaveValue('Dr. Patel Jr')
    );
    await userEvent.click(within(formDialog()).getByRole('button', { name: 'Cancel' }));
    expect(queryPrompt()).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    useAuthStore.setState({ user: null });
  });
});

// The in-app half: a sidebar link (or back/forward) while the form is dirty.
describe('emergency edit modal — router navigation blocker', () => {
  function Page(): ReactElement {
    const [open, setOpen] = useState(true);
    return (
      <div>
        <Link to="/circles/c/meds">Medications</Link>
        {open && (
          <EditDoctorModal
            circleId={CIRCLE_ID}
            info={baseInfo}
            target={0}
            onClose={() => setOpen(false)}
          />
        )}
      </div>
    );
  }

  function renderRouter(): ReturnType<typeof createMemoryRouter> {
    const router = createMemoryRouter(
      [
        { path: '/circles/c/emergency', element: <Page /> },
        { path: '/circles/c/meds', element: <p>Meds page</p> },
      ],
      { initialEntries: ['/circles/c/emergency'] }
    );
    render(
      <Providers>
        <RouterProvider router={router} />
      </Providers>
    );
    return router;
  }

  it('untouched: navigation goes straight through', async () => {
    const router = renderRouter();
    await router.navigate('/circles/c/meds');
    expect(router.state.location.pathname).toBe('/circles/c/meds');
    expect(await screen.findByText('Meds page')).toBeInTheDocument();
  });

  it('dirty: navigation prompts; Keep editing stays, Discard proceeds', async () => {
    const router = renderRouter();
    await cases[0].edit();

    // The link sits behind the modal for a pointer; the router is what a
    // sidebar click or the browser's back button drives.
    fireEvent.click(screen.getByRole('link', { name: 'Medications' }));
    const prompt = await screen.findByRole('dialog', { name: 'Discard changes?' });
    expect(router.state.location.pathname).toBe('/circles/c/emergency');

    await userEvent.click(within(prompt).getByRole('button', { name: 'Keep editing' }));
    expect(queryPrompt()).toBeNull();
    expect(router.state.location.pathname).toBe('/circles/c/emergency');
    expect(document.getElementById('doctor-name')).toHaveValue('Dr. Patel Jr');

    fireEvent.click(screen.getByRole('link', { name: 'Medications' }));
    const again = await screen.findByRole('dialog', { name: 'Discard changes?' });
    await userEvent.click(within(again).getByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/circles/c/meds'));
    expect(await screen.findByText('Meds page')).toBeInTheDocument();
  });

  it('after a successful save, navigation is not blocked', async () => {
    const router = renderRouter();
    await cases[0].edit();
    await userEvent.click(within(formDialog()).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await router.navigate('/circles/c/meds');
    expect(router.state.location.pathname).toBe('/circles/c/meds');
    expect(queryPrompt()).toBeNull();
  });
});
