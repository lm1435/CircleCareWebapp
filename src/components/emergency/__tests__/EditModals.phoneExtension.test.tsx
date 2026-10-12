import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import '@/i18n';

vi.mock('@/api/emergencyInfo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/emergencyInfo')>();
  return { ...actual, updateEmergencyInfo: vi.fn() };
});
vi.mock('@/hooks/usePremiumGate', () => ({
  usePremiumGate: () => ({ promptUpgrade: vi.fn() }),
}));

import { updateEmergencyInfo, type EmergencyInfo } from '@/api/emergencyInfo';
import { ToastProvider } from '@/components/ui';
import { EditDoctorModal, EditInsuranceModal } from '@/components/emergency';
import { DoctorCard } from '@/components/emergency/DoctorCard';
import { InsuranceCard } from '@/components/emergency/InsuranceCard';
import { extensionToSave, sanitizeExtension } from '@/lib/phone';

// ────────────────────────────────────────────────────────────────────────────
// The optional phone EXTENSION on doctors (primary + additional) and insurance
// plans (1.2.3). Contract: `phone_extension` (additional_doctors[] /
// insurance_plans[] items) and `primary_doctor_phone_extension` — digits (1-10)
// or null, and the key is ALWAYS sent on a doctor / plan save. Mobile twin:
// mobile/src/__tests__ (PhoneExtensionField + the emergency screens).
// ────────────────────────────────────────────────────────────────────────────

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

const save = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
};
const type = (el: HTMLElement, value: string): void => {
  fireEvent.change(el, { target: { value } });
};
const ext = (): HTMLInputElement => screen.getByLabelText('Extension') as HTMLInputElement;
const phone = (): HTMLElement => screen.getByLabelText('Phone');
const nameInput = (): HTMLElement => screen.getByLabelText(/^(Name|Carrier).*required/i);
/** The body of the one PUT. */
const sent = (): Record<string, unknown> => mockUpdate.mock.calls[0][1] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdate.mockResolvedValue(baseInfo);
});

describe('lib/phone extension helpers', () => {
  it('sanitizeExtension keeps digits only, max 10', () => {
    expect(sanitizeExtension('ext. 12-3 4')).toBe('1234');
    expect(sanitizeExtension('123456789012')).toBe('1234567890');
    expect(sanitizeExtension('abc')).toBe('');
  });
  it('extensionToSave is null for empty digits or an empty phone', () => {
    expect(extensionToSave('42', '(555) 123-4567')).toBe('42');
    expect(extensionToSave('', '(555) 123-4567')).toBeNull();
    expect(extensionToSave('42', '')).toBeNull();
    expect(extensionToSave('42', '   ')).toBeNull();
  });
});

describe('EditDoctorModal — additional doctor', () => {
  const open = (info: EmergencyInfo, target: 'primary' | number | undefined): void => {
    render(wrap(<EditDoctorModal circleId={CIRCLE_ID} info={info} target={target} onClose={vi.fn()} />));
  };

  it('shows a labelled, described, numeric Extension field under Phone', () => {
    open(baseInfo, undefined);
    const field = ext();
    expect(field).toHaveAttribute('inputmode', 'numeric');
    const hint = document.getElementById(field.getAttribute('aria-describedby') ?? '');
    expect(hint).toHaveTextContent('Enter a phone number first');
    // Directly after the phone field in document order.
    expect(phone().compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is disabled until a phone number is typed, then offers "Optional"', () => {
    open(baseInfo, undefined);
    expect(ext()).toBeDisabled();
    type(phone(), '5551234567');
    expect(ext()).toBeEnabled();
    expect(document.getElementById(ext().getAttribute('aria-describedby') ?? '')).toHaveTextContent(
      'Optional'
    );
  });

  it('add: strips non-digits and caps at 10, and sends the digits', async () => {
    open(baseInfo, undefined);
    type(nameInput(), 'Dr. Lee');
    type(phone(), '5551234567');
    type(ext(), 'x 12-34a56789012');
    expect(ext().value).toBe('1234567890');
    save();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const doctors = sent().additional_doctors as Array<Record<string, unknown>>;
    expect(doctors[0].phone_extension).toBe('1234567890');
  });

  it('add: no extension typed still SENDS the key as null', async () => {
    open(baseInfo, undefined);
    type(nameInput(), 'Dr. Lee');
    type(phone(), '5551234567');
    save();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const doctor = (sent().additional_doctors as Array<Record<string, unknown>>)[0];
    expect('phone_extension' in doctor).toBe(true);
    expect(doctor.phone_extension).toBeNull();
  });

  it('edit: seeds the stored extension; clearing it sends null', async () => {
    const info = {
      ...baseInfo,
      additional_doctors: [{ name: 'Dr. Patel', phone: '(555) 123-4567', country_code: '+1', phone_extension: '204' }],
    };
    open(info, 0);
    expect(ext().value).toBe('204');
    type(ext(), '');
    save();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const doctor = (sent().additional_doctors as Array<Record<string, unknown>>)[0];
    expect(doctor.phone_extension).toBeNull();
  });

  it('an extension with the phone cleared saves null and does not block Save', async () => {
    const info = {
      ...baseInfo,
      additional_doctors: [{ name: 'Dr. Patel', phone: '(555) 123-4567', country_code: '+1', phone_extension: '204' }],
    };
    open(info, 0);
    type(phone(), '');
    expect(ext()).toBeDisabled();
    expect(ext().value).toBe('');
    save();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const doctor = (sent().additional_doctors as Array<Record<string, unknown>>)[0];
    expect(doctor.phone).toBeNull();
    expect(doctor.phone_extension).toBeNull();
    expect(screen.queryByText('Enter a valid phone number')).not.toBeInTheDocument();
  });

  it('an OLD backend response (key absent) opens with an empty field and saves null', async () => {
    const info = {
      ...baseInfo,
      additional_doctors: [{ name: 'Dr. Patel', phone: '(555) 123-4567', country_code: '+1' }],
    };
    open(info, 0);
    expect(ext().value).toBe('');
    expect(ext()).toBeEnabled();
    save();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect((sent().additional_doctors as Array<Record<string, unknown>>)[0].phone_extension).toBeNull();
  });

  it('an invalid phone still blocks Save (no PUT), extension or not', () => {
    open(baseInfo, undefined);
    type(nameInput(), 'Dr. Lee');
    type(phone(), '5121548191566');
    type(ext(), '12');
    save();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(phone()).toHaveAttribute('aria-invalid', 'true');
    expect(phone()).toHaveFocus();
  });
});

describe('EditDoctorModal — primary doctor', () => {
  const info: EmergencyInfo = {
    ...baseInfo,
    primary_doctor_name: 'Dr. Ruiz',
    primary_doctor_phone: '(555) 123-4567',
    primary_doctor_country_code: '+1',
    primary_doctor_phone_extension: '88',
  };

  it('seeds and saves primary_doctor_phone_extension; the key is always sent', async () => {
    render(wrap(<EditDoctorModal circleId={CIRCLE_ID} info={info} target="primary" onClose={vi.fn()} />));
    expect(ext().value).toBe('88');
    type(ext(), '9012');
    save();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(sent().primary_doctor_phone_extension).toBe('9012');
  });

  it('cleared (or no phone) sends null, not an omitted key', async () => {
    render(wrap(<EditDoctorModal circleId={CIRCLE_ID} info={info} target="primary" onClose={vi.fn()} />));
    type(ext(), '');
    save();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect('primary_doctor_phone_extension' in sent()).toBe(true);
    expect(sent().primary_doctor_phone_extension).toBeNull();
  });
});

describe('EditInsuranceModal', () => {
  const withPlan: EmergencyInfo = {
    ...baseInfo,
    insurance_plans: [
      { carrier: 'Aetna', phone: '(555) 123-4567', country_code: '+1', phone_extension: '300' },
      { carrier: 'Cigna', phone: '(555) 987-6543', country_code: '+1' },
    ],
  };

  it('add: sends digits; stripped as typed', async () => {
    render(wrap(<EditInsuranceModal circleId={CIRCLE_ID} info={baseInfo} onClose={vi.fn()} />));
    type(nameInput(), 'Aetna');
    type(phone(), '5551234567');
    type(ext(), '1a2b3');
    expect(ext().value).toBe('123');
    save();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const plans = sent().insurance_plans as Array<Record<string, unknown>>;
    expect(plans[0].phone_extension).toBe('123');
  });

  it('add without extension or phone sends the key as null', async () => {
    render(wrap(<EditInsuranceModal circleId={CIRCLE_ID} info={baseInfo} onClose={vi.fn()} />));
    type(nameInput(), 'Aetna');
    expect(ext()).toBeDisabled();
    save();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const plan = (sent().insurance_plans as Array<Record<string, unknown>>)[0];
    expect('phone_extension' in plan).toBe(true);
    expect(plan.phone_extension).toBeNull();
  });

  it('edit: seeds the stored extension, changes it, and leaves the other plan untouched', async () => {
    render(wrap(<EditInsuranceModal circleId={CIRCLE_ID} info={withPlan} index={0} onClose={vi.fn()} />));
    expect(ext().value).toBe('300');
    type(ext(), '301');
    save();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const plans = sent().insurance_plans as Array<Record<string, unknown>>;
    const aetna = plans.find((p) => p.carrier === 'Aetna');
    const cigna = plans.find((p) => p.carrier === 'Cigna');
    expect(aetna?.phone_extension).toBe('301');
    // Not touched by this edit: the key is not invented for it.
    expect('phone_extension' in (cigna ?? {})).toBe(false);
  });

  it('an invalid phone still blocks Save', () => {
    render(wrap(<EditInsuranceModal circleId={CIRCLE_ID} info={baseInfo} onClose={vi.fn()} />));
    type(nameInput(), 'Aetna');
    type(phone(), '5121548191566');
    save();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(phone()).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('display', () => {
  it('DoctorCard shows "<phone> ext. <digits>", the tel: link keeps the main number only, and the accessible name reads "extension"', () => {
    const { container } = render(
      wrap(<DoctorCard name="Dr. Chen" phone="(555) 123-4567" countryCode="+1" extension="204" />)
    );
    const link = screen.getByRole('link', { name: 'Call Dr. Chen' });
    expect(link).toHaveAttribute('href', 'tel:+15551234567');
    expect(link).toHaveTextContent('+1 (555) 123-4567');
    expect(link).not.toHaveTextContent('204');
    expect(screen.getByText('ext. 204')).toBeInTheDocument();
    expect(screen.getByText('extension 204')).toHaveClass('sr-only');
    expect(container.textContent).toContain('+1 (555) 123-4567');
  });

  it('InsuranceCard shows the extension; absent key shows the number alone', () => {
    const { rerender } = render(
      wrap(
        <InsuranceCard plan={{ carrier: 'Aetna', phone: '(555) 123-4567', country_code: '+1', phone_extension: '7' }} />
      )
    );
    expect(screen.getByText('ext. 7')).toBeInTheDocument();
    rerender(
      wrap(<InsuranceCard plan={{ carrier: 'Aetna', phone: '(555) 123-4567', country_code: '+1' }} />)
    );
    expect(screen.queryByText(/ext\./)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Call Aetna' })).toBeInTheDocument();
  });
});
