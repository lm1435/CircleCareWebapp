import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import '@/i18n';
import type {
  AdditionalDoctor,
  EmergencyContact,
  EmergencyInfo,
  InsurancePlan,
} from '@/api/emergencyInfo';
import { ToastProvider } from '@/components/ui';
import {
  EditContactModal,
  EditDoctorModal,
  EditInsuranceModal,
} from '@/components/emergency';
import { onSessionEnded, saveDraftsForForcedSignOut } from '@/lib/sessionDraft';
import { useAuthStore } from '@/store/authStore';

// Security re-check 2026-10-01 (I-3). Emergency contacts, doctors and plans have
// no id, and their PK9 drafts were keyed by ARRAY INDEX. A forced sign-out
// mid-edit of the entry at slot 1, then another member deleting the entry before
// it, left a DIFFERENT entry in slot 1 — and the user's draft filled that other
// entry's editor on sign-in (the `if_match` base is read fresh at mount, so the
// stale-edit check cannot catch it). The draft must follow the ENTRY, wherever
// it sits in the list now.

vi.mock('@/api/emergencyInfo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/emergencyInfo')>();
  return { ...actual, updateEmergencyInfo: vi.fn() };
});
vi.mock('@/hooks/usePremiumGate', () => ({
  usePremiumGate: () => ({ promptUpgrade: vi.fn() }),
}));

const CIRCLE = 'circle-A';

const info = (over: Partial<EmergencyInfo>): EmergencyInfo => ({
  id: `ei-${CIRCLE}`,
  circle_id: CIRCLE,
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
  ...over,
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

const ALICE: EmergencyContact = { name: 'Alice', relationship: 'Sister', phone: '5550001', country_code: '+1' };
const BOB: EmergencyContact = { name: 'Bob', relationship: 'Son', phone: '5550002', country_code: '+1' };
const CAROL: EmergencyContact = { name: 'Carol', relationship: 'Neighbor', phone: '5550003', country_code: '+1' };

const DR_ALICE: AdditionalDoctor = { name: 'Dr. Alice', specialty: 'Cardiology', phone: '5550001', country_code: '+1' };
const DR_BOB: AdditionalDoctor = { name: 'Dr. Bob', specialty: 'Neurology', phone: '5550002', country_code: '+1' };
const DR_CAROL: AdditionalDoctor = { name: 'Dr. Carol', specialty: 'Podiatry', phone: '5550003', country_code: '+1' };

const ALPHA: InsurancePlan = { carrier: 'Alpha Health', policy_number: 'A-100', phone: '5550001', country_code: '+1' };
const BETA: InsurancePlan = { carrier: 'Beta Care', policy_number: 'B-200', phone: '5550002', country_code: '+1' };
const GAMMA: InsurancePlan = { carrier: 'Gamma Plan', policy_number: 'G-300', phone: '5550003', country_code: '+1' };

interface Case {
  label: string;
  /** Field the user edits, and what the entry in slot 1 is called before the edit. */
  field: RegExp;
  before: [string, string, string];
  /** The modal for a list and an index (undefined = add a new entry). */
  modal: (list: 'full' | 'afterDelete' | 'twins' | 'one', index: number | undefined) => ReactElement;
  /** Same entry shape, used for the "identical twins" case. */
  twinName: string;
}

const cases: Case[] = [
  {
    label: 'EditContactModal',
    field: /^name/i,
    before: ['Alice', 'Bob', 'Carol'],
    twinName: 'Twin',
    modal: (list, index) => {
      const TWIN: EmergencyContact = { name: 'Twin', relationship: 'Friend', phone: '5550009', country_code: '+1' };
      const lists = {
        full: [ALICE, BOB, CAROL],
        afterDelete: [BOB, CAROL],
        twins: [TWIN, TWIN],
        one: [BOB],
      };
      return (
        <EditContactModal
          circleId={CIRCLE}
          info={info({ emergency_contacts: lists[list] })}
          index={index}
          onClose={vi.fn()}
        />
      );
    },
  },
  {
    label: 'EditDoctorModal',
    field: /^name/i,
    before: ['Dr. Alice', 'Dr. Bob', 'Dr. Carol'],
    twinName: 'Dr. Twin',
    modal: (list, index) => {
      const TWIN: AdditionalDoctor = { name: 'Dr. Twin', specialty: 'GP', phone: '5550009', country_code: '+1' };
      const lists = {
        full: [DR_ALICE, DR_BOB, DR_CAROL],
        afterDelete: [DR_BOB, DR_CAROL],
        twins: [TWIN, TWIN],
        one: [DR_BOB],
      };
      return (
        <EditDoctorModal
          circleId={CIRCLE}
          info={info({ additional_doctors: lists[list] })}
          target={index}
          onClose={vi.fn()}
        />
      );
    },
  },
  {
    label: 'EditInsuranceModal',
    field: /carrier/i,
    before: ['Alpha Health', 'Beta Care', 'Gamma Plan'],
    twinName: 'Twin Plan',
    modal: (list, index) => {
      const TWIN: InsurancePlan = { carrier: 'Twin Plan', policy_number: 'T-1', phone: '5550009', country_code: '+1' };
      const lists = {
        full: [ALPHA, BETA, GAMMA],
        afterDelete: [BETA, GAMMA],
        twins: [TWIN, TWIN],
        one: [BETA],
      };
      return (
        <EditInsuranceModal
          circleId={CIRCLE}
          info={info({ insurance_plans: lists[list] })}
          index={index}
          onClose={vi.fn()}
        />
      );
    },
  },
];

const DRAFT = 'Draft Dana';

describe.each(cases)('$label draft is keyed by the entry, not its list index', (c) => {
  /** Edit the entry in slot 1 of the full list, get force-signed-out, unmount. */
  async function draftOnSlotOneThenForcedSignOut(): Promise<void> {
    const user = userEvent.setup();
    const first = render(wrap(c.modal('full', 1)));
    const field = screen.getAllByRole('textbox', { name: c.field })[0];
    expect(field).toHaveValue(c.before[1]);
    await user.clear(field);
    await user.type(field, DRAFT);
    forceSignOut();
    first.unmount();
  }

  it('does NOT fill the entry that took its slot after an earlier entry is deleted', async () => {
    await draftOnSlotOneThenForcedSignOut();

    // Another member deleted the first entry: slot 1 now holds the third one.
    render(wrap(c.modal('afterDelete', 1)));
    expect(screen.getAllByRole('textbox', { name: c.field })[0]).toHaveValue(c.before[2]);
    expect(screen.queryByDisplayValue(DRAFT)).toBeNull();
  });

  it('IS restored into the entry it was typed on, at the slot it moved to', async () => {
    await draftOnSlotOneThenForcedSignOut();

    render(wrap(c.modal('afterDelete', 1))).unmount();
    render(wrap(c.modal('afterDelete', 0)));
    expect(screen.getAllByRole('textbox', { name: c.field })[0]).toHaveValue(DRAFT);
  });

  it('an unshifted list still restores into the same entry', async () => {
    await draftOnSlotOneThenForcedSignOut();

    render(wrap(c.modal('full', 1)));
    expect(screen.getAllByRole('textbox', { name: c.field })[0]).toHaveValue(DRAFT);
  });

  it('a NEW-entry draft still restores into a new entry, whatever the list became', async () => {
    const user = userEvent.setup();
    const first = render(wrap(c.modal('full', undefined)));
    await user.type(screen.getAllByRole('textbox', { name: c.field })[0], DRAFT);
    forceSignOut();
    first.unmount();

    render(wrap(c.modal('one', undefined)));
    expect(screen.getAllByRole('textbox', { name: c.field })[0]).toHaveValue(DRAFT);
  });

  it('two entries that look identical are told apart by order', async () => {
    const user = userEvent.setup();
    const first = render(wrap(c.modal('twins', 1)));
    const field = screen.getAllByRole('textbox', { name: c.field })[0];
    expect(field).toHaveValue(c.twinName);
    await user.clear(field);
    await user.type(field, DRAFT);
    forceSignOut();
    first.unmount();

    render(wrap(c.modal('twins', 0))).unmount();
    expect(screen.queryByDisplayValue(DRAFT)).toBeNull();
    render(wrap(c.modal('twins', 1)));
    expect(screen.getAllByRole('textbox', { name: c.field })[0]).toHaveValue(DRAFT);
  });
});

describe('EditDoctorModal: the PRIMARY doctor keeps its own draft slot', () => {
  it('an additional doctor never takes the primary doctor\'s draft', async () => {
    const user = userEvent.setup();
    const withPrimary = info({ primary_doctor_name: 'Dr. Prime', additional_doctors: [DR_ALICE] });
    const first = render(
      wrap(<EditDoctorModal circleId={CIRCLE} info={withPrimary} target="primary" onClose={vi.fn()} />)
    );
    const field = screen.getAllByRole('textbox', { name: /^name/i })[0];
    await user.clear(field);
    await user.type(field, DRAFT);
    forceSignOut();
    first.unmount();

    render(
      wrap(<EditDoctorModal circleId={CIRCLE} info={withPrimary} target={0} onClose={vi.fn()} />)
    ).unmount();
    render(
      wrap(<EditDoctorModal circleId={CIRCLE} info={withPrimary} target="primary" onClose={vi.fn()} />)
    );
    expect(screen.getAllByRole('textbox', { name: /^name/i })[0]).toHaveValue(DRAFT);
  });
});
