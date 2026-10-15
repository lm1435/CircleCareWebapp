import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import '@/i18n';

// Mock the WRITE fn only (same as EditModals.test.tsx): "no network call" is
// asserted on it.
vi.mock('@/api/emergencyInfo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/emergencyInfo')>();
  return { ...actual, updateEmergencyInfo: vi.fn() };
});
vi.mock('@/hooks/usePremiumGate', () => ({
  usePremiumGate: () => ({ promptUpgrade: vi.fn() }),
}));

import { updateEmergencyInfo, type EmergencyInfo } from '@/api/emergencyInfo';
import { ToastProvider } from '@/components/ui';
import { EditContactModal, EditDoctorModal, EditInsuranceModal } from '@/components/emergency';

// ────────────────────────────────────────────────────────────────────────────
// THE PHONE SAVE GATE (owner decision, found on iOS build 31): a number that
// fails the field's own check — "Enter a valid phone number" — used to be
// saved anyway. Save is now refused on every emergency form: no PUT, the error
// visible and wired to the input, focus on the number. Mobile twin:
// mobile/src/__tests__/screens/EmergencyPhoneSaveGate.test.tsx (same cases).
// ────────────────────────────────────────────────────────────────────────────

const CIRCLE_ID = 'circle-1';
const mockUpdate = vi.mocked(updateEmergencyInfo);
const ERROR = 'Enter a valid phone number';
const TOO_LONG = '5121548191566';

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

/** Records that already hold an invalid number (they exist in production). */
const storedInvalid: EmergencyInfo = {
  ...baseInfo,
  primary_doctor_name: 'Dr. Ruiz',
  primary_doctor_phone: '512154819156',
  primary_doctor_country_code: '+1',
  additional_doctors: [{ name: 'Dr. Patel', phone: '555-0102', country_code: '+1' }],
  emergency_contacts: [
    { name: 'Ana', relationship: 'Daughter', phone: '555-0100', country_code: '+1', is_primary: true },
  ],
  insurance_plans: [{ carrier: 'Aetna', phone: '555-0199', country_code: '+1' }],
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

const save = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
};
const type = (el: HTMLElement, value: string): void => {
  fireEvent.change(el, { target: { value } });
};
const nameInput = (): HTMLElement => screen.getByLabelText(/^Name.*required/i);

/** The refused-save contract, identical on all three forms. */
function expectRefused(input: HTMLElement): void {
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(screen.getByText(ERROR)).toBeInTheDocument();
  expect(input).toHaveAttribute('aria-invalid', 'true');
  const describedBy = input.getAttribute('aria-describedby') ?? '';
  expect(document.getElementById(describedBy)).toHaveTextContent(ERROR);
  expect(input).toHaveFocus();
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdate.mockResolvedValue(baseInfo);
});

const DOCTOR_FORMS: ReadonlyArray<readonly [string, 'primary' | number | undefined, EmergencyInfo]> = [
  ['add', undefined, baseInfo],
  ['edit (additional)', 0, { ...baseInfo, additional_doctors: [{ name: 'Dr. Patel' }] }],
  ['edit (primary)', 'primary', { ...baseInfo, primary_doctor_name: 'Dr. Ruiz' }],
];

describe.each(DOCTOR_FORMS)('EditDoctorModal — %s — phone save gate', (_mode, target, info) => {
  const open = (onClose = vi.fn()): HTMLElement => {
    render(wrap(<EditDoctorModal circleId={CIRCLE_ID} info={info} target={target} onClose={onClose} />));
    return screen.getByLabelText('Phone');
  };

  it('a too-long number blocks Save: no PUT, error shown + associated, phone focused, modal still open', () => {
    const onClose = vi.fn();
    const phone = open(onClose);
    type(nameInput(), 'Dr. Lee');
    type(phone, TOO_LONG);
    // Straight to Save — no blur, so the inline error was not even armed yet.
    save();
    expectRefused(phone);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('correcting the number then saves it', async () => {
    const phone = open();
    type(nameInput(), 'Dr. Lee');
    type(phone, TOO_LONG);
    save();
    expect(mockUpdate).not.toHaveBeenCalled();
    type(phone, '5121548191');
    save();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(mockUpdate.mock.calls[0][1])).toContain('(512) 154-8191');
  });

  it('an EMPTY phone still saves (optional)', async () => {
    open();
    type(nameInput(), 'Dr. Lee');
    save();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
  });
});

describe('EditDoctorModal — a record whose STORED number is already invalid', () => {
  it.each([
    ['additional', 0],
    ['primary', 'primary'],
  ] as const)('%s: opens with the error showing; a rename alone is refused; fixing the number saves', async (_n, target) => {
    render(wrap(<EditDoctorModal circleId={CIRCLE_ID} info={storedInvalid} target={target} onClose={vi.fn()} />));
    const phone = screen.getByLabelText('Phone');
    // Opens normally, and says so before the user meets the refusal.
    expect(screen.getByText(ERROR)).toBeInTheDocument();
    expect(phone).toHaveAttribute('aria-invalid', 'true');

    type(nameInput(), 'Dr. Renamed');
    save();
    expectRefused(phone);

    type(phone, '3035550102');
    save();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(mockUpdate.mock.calls[0][1])).toContain('(303) 555-0102');
  });

  it('clearing the number saves too (the field is optional)', async () => {
    render(wrap(<EditDoctorModal circleId={CIRCLE_ID} info={storedInvalid} target={0} onClose={vi.fn()} />));
    const phone = screen.getByLabelText('Phone');
    save();
    expectRefused(phone);
    type(phone, '');
    save();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate.mock.calls[0][1].additional_doctors?.[0]).toMatchObject({
      name: 'Dr. Patel',
      phone: null,
      country_code: null,
    });
  });
});

describe.each([
  ['add', undefined],
  ['edit', 0],
] as const)('EditInsuranceModal — %s — phone save gate', (_mode, index) => {
  const info: EmergencyInfo =
    index === undefined ? baseInfo : { ...baseInfo, insurance_plans: [{ carrier: 'Aetna' }] };
  const open = (): HTMLElement => {
    render(wrap(<EditInsuranceModal circleId={CIRCLE_ID} info={info} index={index} onClose={vi.fn()} />));
    type(screen.getByLabelText(/^Carrier.*required/i), 'Aetna');
    return screen.getByLabelText('Phone');
  };

  it('a too-long number blocks Save', () => {
    const phone = open();
    type(phone, TOO_LONG);
    save();
    expectRefused(phone);
  });

  it('a valid number saves', async () => {
    const phone = open();
    type(phone, '8005551234');
    save();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate.mock.calls[0][1].insurance_plans?.[0]).toMatchObject({ phone: '(800) 555-1234' });
  });

  it('an EMPTY phone still saves (optional)', async () => {
    open();
    save();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
  });
});

describe('EditInsuranceModal — a plan whose STORED number is already invalid', () => {
  it('is refused until the number is corrected or cleared', async () => {
    render(wrap(<EditInsuranceModal circleId={CIRCLE_ID} info={storedInvalid} index={0} onClose={vi.fn()} />));
    const phone = screen.getByLabelText('Phone');
    expect(screen.getByText(ERROR)).toBeInTheDocument();
    type(screen.getByLabelText(/^Carrier.*required/i), 'Aetna PPO');
    save();
    expectRefused(phone);
    type(phone, '');
    save();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const plan = mockUpdate.mock.calls[0][1].insurance_plans?.[0];
    expect(plan?.carrier).toBe('Aetna PPO');
    expect(plan?.phone).toBeUndefined();
  });
});

describe.each([
  ['add', undefined],
  ['edit', 0],
] as const)('EditContactModal — %s — phone save gate', (_mode, index) => {
  const info: EmergencyInfo =
    index === undefined
      ? baseInfo
      : {
          ...baseInfo,
          emergency_contacts: [
            { name: 'Ana', relationship: 'Daughter', phone: '(303) 555-0100', country_code: '+1', is_primary: true },
          ],
        };
  const open = (): HTMLElement => {
    render(wrap(<EditContactModal circleId={CIRCLE_ID} info={info} index={index} onClose={vi.fn()} />));
    type(nameInput(), 'Luis');
    type(screen.getByLabelText(/^Relationship.*required/i), 'Son');
    return screen.getByLabelText(/^Phone.*required/i);
  };

  it('a too-long number blocks Save', () => {
    const phone = open();
    type(phone, TOO_LONG);
    save();
    expectRefused(phone);
  });

  it('a valid number saves', async () => {
    const phone = open();
    type(phone, '3035551234');
    save();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate.mock.calls[0][1].emergency_contacts?.[0]).toMatchObject({
      name: 'Luis',
      phone: '(303) 555-1234',
    });
  });

  it('an EMPTY phone is still the required-field refusal, not the format one (unchanged)', () => {
    const phone = open();
    type(phone, '');
    // Past the native `required` check, straight to the form's own handler.
    fireEvent.submit(document.getElementById('edit-contact-form') as HTMLFormElement);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(screen.queryByText(ERROR)).toBeNull();
    expect(screen.getAllByText('Name, relationship, and phone are required.').length).toBeGreaterThan(0);
    // Focus lands on the empty field, so its error is scrolled into the
    // dialog body's view (Save is in the pinned footer).
    expect(document.activeElement).toBe(phone);
  });

  it('an EMPTY name moves focus to the name field, the first empty required field', () => {
    open();
    const name = document.getElementById('contact-name') as HTMLInputElement;
    fireEvent.change(name, { target: { value: '' } });
    fireEvent.submit(document.getElementById('edit-contact-form') as HTMLFormElement);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(name);
  });
});

// The contact phone is REQUIRED, so a caregiver cannot clear a bad stored
// number — and may not know the right one. Locking them out of renaming the
// contact would be worse than the bad number: untouched, it is left alone.
describe('EditContactModal — a contact whose STORED number is already invalid (required field)', () => {
  const open = (): HTMLElement => {
    render(wrap(<EditContactModal circleId={CIRCLE_ID} info={storedInvalid} index={0} onClose={vi.fn()} />));
    return screen.getByLabelText(/^Phone.*required/i);
  };

  it('a rename alone still saves, the number untouched', async () => {
    open();
    expect(screen.queryByText(ERROR)).toBeNull();
    type(nameInput(), 'Ana Maria');
    save();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const saved = mockUpdate.mock.calls[0][1].emergency_contacts?.[0];
    expect(saved?.name).toBe('Ana Maria');
    // Same digits, never "fixed" or dropped (the web re-formats a stored +1
    // number on open — `initialPhoneValue`, unchanged by this work).
    expect(saved?.phone?.replace(/\D/g, '')).toBe('5550100');
  });

  it('changing the number to another invalid one is refused', () => {
    const phone = open();
    type(phone, '55501');
    save();
    expectRefused(phone);
  });
});
