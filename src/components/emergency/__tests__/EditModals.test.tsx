import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import {
  EditContactModal,
  EditDirectivesModal,
  EditDoctorModal,
  EditInsuranceModal,
  EditMedicalInfoModal,
} from '@/components/emergency';

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

// Regression: these saves are read-modify-write over `info`. With `info` null,
// the mobile equivalents PUT a one-element array over the saved list and wrote
// empty allergies / a reset DNR flag. Nothing may render or submit without it.
describe('emergency modals — null info guard', () => {
  // Each modal is listed with its own required props (EditDoctorModal needs a
  // `target`), so the guard is exercised through the real public signature.
  const renderers = {
    EditContactModal: (info: EmergencyInfo | null) => (
      <EditContactModal circleId={CIRCLE_ID} info={info} onClose={vi.fn()} />
    ),
    EditDoctorModal: (info: EmergencyInfo | null) => (
      <EditDoctorModal circleId={CIRCLE_ID} info={info} target={0} onClose={vi.fn()} />
    ),
    EditInsuranceModal: (info: EmergencyInfo | null) => (
      <EditInsuranceModal circleId={CIRCLE_ID} info={info} onClose={vi.fn()} />
    ),
    EditMedicalInfoModal: (info: EmergencyInfo | null) => (
      <EditMedicalInfoModal circleId={CIRCLE_ID} info={info} onClose={vi.fn()} />
    ),
    EditDirectivesModal: (info: EmergencyInfo | null) => (
      <EditDirectivesModal circleId={CIRCLE_ID} info={info} onClose={vi.fn()} />
    ),
  };
  const names = Object.keys(renderers) as (keyof typeof renderers)[];

  // Asserted on the dialog rather than the container: `wrap` mounts a
  // ToastProvider, whose live region is always in the container.
  it.each(names)('%s renders no dialog when info has not loaded', (name) => {
    render(wrap(renderers[name](null)));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it.each(names)('%s renders its dialog once info is present', (name) => {
    render(wrap(renderers[name](baseInfo)));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

// Modal footer convention (M4): required fields must go through TextField's
// `required` prop (which renders the shared RequiredMarker: a visible
// aria-hidden asterisk plus an sr-only "(required)") rather than baking
// `${label} *` into the label string by hand — the hand-rolled version never
// announced "required" to a screen reader at all, only the asterisk glyph.
// Querying by an accessible name that INCLUDES "required" only succeeds when
// the marker actually rendered through the component, not a literal string.
describe('required-field labels render via the shared RequiredMarker', () => {
  it('EditContactModal: Name, Relationship and Phone announce as required', () => {
    render(
      wrap(<EditContactModal circleId={CIRCLE_ID} info={baseInfo} index={undefined} onClose={vi.fn()} />)
    );

    expect(screen.getByLabelText(/^Name.*\(required\)/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Relationship.*\(required\)/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Phone.*\(required\)/)).toBeInTheDocument();
  });

  it('EditDoctorModal: Name announces as required, Specialty does not', () => {
    render(
      wrap(<EditDoctorModal circleId={CIRCLE_ID} info={baseInfo} target={undefined} onClose={vi.fn()} />)
    );

    expect(screen.getByLabelText(/^Name.*\(required\)/)).toBeInTheDocument();
    // Specialty is optional — no RequiredMarker, and the label carries no
    // stray literal asterisk either.
    expect(screen.getByLabelText('Specialty')).toBeInTheDocument();
  });

  it('EditInsuranceModal: Carrier announces as required', () => {
    render(
      wrap(<EditInsuranceModal circleId={CIRCLE_ID} info={baseInfo} index={undefined} onClose={vi.fn()} />)
    );

    expect(screen.getByLabelText(/^Carrier.*\(required\)/)).toBeInTheDocument();
  });
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

    fireEvent.change(screen.getByLabelText(/^Name.*required/i), { target: { value: 'Dr. Lee' } });
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

  // Name now carries the real HTML `required` attribute (via TextField's
  // `required` prop, M4), so an empty submit is blocked by the browser's own
  // validation before the component's `onSubmit` ever runs — same contract as
  // CreateCircleModal's "blocks submit ... " test. The component's own
  // `nameRequired` message is still reachable, but only for the case HTML
  // `required` cannot catch: whitespace-only input (see the test below).
  it('blocks submit natively when the name is empty', () => {
    const onClose = vi.fn();
    render(
      wrap(
        <EditDoctorModal circleId={CIRCLE_ID} info={baseInfo} target={undefined} onClose={onClose} />
      )
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockUpdate).not.toHaveBeenCalled();
    const nameInput = screen.getByLabelText(/^Name.*\(required\)/) as HTMLInputElement;
    expect(nameInput.validity.valid).toBe(false);
  });

  it('shows the custom error for a whitespace-only name, which HTML `required` cannot catch', () => {
    const onClose = vi.fn();
    render(
      wrap(
        <EditDoctorModal circleId={CIRCLE_ID} info={baseInfo} target={undefined} onClose={onClose} />
      )
    );

    fireEvent.change(screen.getByLabelText(/^Name.*\(required\)/), { target: { value: '   ' } });
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

    fireEvent.change(screen.getByLabelText(/^Name.*required/i), { target: { value: 'Dr. Chen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const [, body] = mockUpdate.mock.calls[0];
    expect(body).toMatchObject({ primary_doctor_name: 'Dr. Chen' });
    expect(body.additional_doctors).toBeUndefined();
  });
});

describe('EditContactModal — relationship quick-fill chips vs manual entry', () => {
  const renderAddContact = (onClose = vi.fn()): void => {
    render(
      wrap(
        <EditContactModal circleId={CIRCLE_ID} info={baseInfo} index={undefined} onClose={onClose} />
      )
    );
  };

  const fillNameAndPhone = (): void => {
    fireEvent.change(screen.getByLabelText(/^Name.*required/i), { target: { value: 'Sarah Smith' } });
    fireEvent.change(screen.getByLabelText(/^Phone.*required/i), { target: { value: '555-0101' } });
  };

  it('clicking a chip fills the relationship field and the saved payload contains it', async () => {
    const onClose = vi.fn();
    renderAddContact(onClose);
    fillNameAndPhone();

    fireEvent.click(screen.getByRole('radio', { name: 'Daughter' }));

    // Chip FILLS the field — the text input stays the source of truth.
    expect(screen.getByLabelText(/^Relationship.*required/i)).toHaveValue('Daughter');
    expect(screen.getByRole('radio', { name: 'Daughter' })).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const [, body] = mockUpdate.mock.calls[0];
    expect(Object.keys(body)).toEqual(['emergency_contacts']);
    expect(body.emergency_contacts?.[0]).toMatchObject({
      name: 'Sarah Smith',
      relationship: 'Daughter',
      phone: '555-0101',
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('typing a custom relationship leaves every chip unpressed and saves the typed value', async () => {
    renderAddContact();
    fillNameAndPhone();

    fireEvent.change(screen.getByLabelText(/^Relationship.*required/i), { target: { value: 'Niece' } });

    const group = screen.getByRole('radiogroup', { name: 'Common relationships' });
    for (const chip of within(group).getAllByRole('radio')) {
      expect(chip).not.toBeChecked();
    }

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate.mock.calls[0][1].emergency_contacts?.[0]).toMatchObject({
      relationship: 'Niece',
    });
  });

  it("typing a chip's label in a different case marks that chip pressed", () => {
    renderAddContact();

    fireEvent.change(screen.getByLabelText(/^Relationship.*required/i), { target: { value: 'dAUGHTER' } });

    expect(screen.getByRole('radio', { name: 'Daughter' })).toBeChecked();
    // Only the matching chip lights up.
    expect(screen.getByRole('radio', { name: 'Son' })).not.toBeChecked();
  });

  // WA7: relationship is a REQUIRED field and this is a quick-fill chip row
  // (the text field stays the source of truth) — ChipSelect's own docstring
  // says allowDeselect should be false here. Before the fix, ChipSelect
  // defaulted to allowDeselect=true, so re-tapping the selected chip silently
  // blanked a required field the user had just filled.
  it('re-tapping the selected chip does NOT clear the field (allowDeselect=false)', async () => {
    renderAddContact();
    fillNameAndPhone();

    fireEvent.click(screen.getByRole('radio', { name: 'Friend' }));
    expect(screen.getByLabelText(/^Relationship.*required/i)).toHaveValue('Friend');

    fireEvent.click(screen.getByRole('radio', { name: 'Friend' }));
    expect(screen.getByLabelText(/^Relationship.*required/i)).toHaveValue('Friend');
    expect(screen.getByRole('radio', { name: 'Friend' })).toBeChecked();

    // The field is still populated, so save proceeds normally.
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate.mock.calls[0][1].emergency_contacts?.[0]).toMatchObject({
      relationship: 'Friend',
    });
  });
});

describe('EditDoctorModal — specialty quick-fill chips vs manual entry', () => {
  const renderAddDoctor = (onClose = vi.fn()): void => {
    render(
      wrap(
        <EditDoctorModal circleId={CIRCLE_ID} info={baseInfo} target={undefined} onClose={onClose} />
      )
    );
  };

  it('clicking a chip fills the specialty field and the saved payload contains it', async () => {
    const onClose = vi.fn();
    renderAddDoctor(onClose);
    fireEvent.change(screen.getByLabelText(/^Name.*required/i), { target: { value: 'Dr. Lee' } });

    fireEvent.click(screen.getByRole('radio', { name: 'Cardiologist' }));

    // Chip FILLS the field — the text input stays the source of truth.
    expect(screen.getByLabelText('Specialty')).toHaveValue('Cardiologist');
    expect(screen.getByRole('radio', { name: 'Cardiologist' })).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const [, body] = mockUpdate.mock.calls[0];
    expect(body.additional_doctors?.[1]).toMatchObject({
      name: 'Dr. Lee',
      specialty: 'Cardiologist',
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('typing a custom specialty leaves every chip unpressed and saves the typed value', async () => {
    renderAddDoctor();
    fireEvent.change(screen.getByLabelText(/^Name.*required/i), { target: { value: 'Dr. Lee' } });

    fireEvent.change(screen.getByLabelText('Specialty'), {
      target: { value: 'Sports Medicine' },
    });

    const group = screen.getByRole('radiogroup', { name: 'Common specialties' });
    for (const chip of within(group).getAllByRole('radio')) {
      expect(chip).not.toBeChecked();
    }

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate.mock.calls[0][1].additional_doctors?.[1]).toMatchObject({
      specialty: 'Sports Medicine',
    });
  });

  it("typing a chip's label in a different case marks that chip pressed", () => {
    renderAddDoctor();

    fireEvent.change(screen.getByLabelText('Specialty'), { target: { value: 'CARDIOLOGIST' } });

    expect(screen.getByRole('radio', { name: 'Cardiologist' })).toBeChecked();
    // Only the matching chip lights up.
    expect(screen.getByRole('radio', { name: 'Dentist' })).not.toBeChecked();
  });

  // WA7: this is a quick-fill chip row (text field stays the source of
  // truth) — ChipSelect's own docstring says allowDeselect should be false
  // here, same as the contact-relationship row, regardless of specialty being
  // an optional field.
  it('re-tapping the selected chip does NOT clear the field (allowDeselect=false)', async () => {
    renderAddDoctor();
    fireEvent.change(screen.getByLabelText(/^Name.*required/i), { target: { value: 'Dr. Lee' } });

    fireEvent.click(screen.getByRole('radio', { name: 'Oncologist' }));
    expect(screen.getByLabelText('Specialty')).toHaveValue('Oncologist');

    fireEvent.click(screen.getByRole('radio', { name: 'Oncologist' }));
    expect(screen.getByLabelText('Specialty')).toHaveValue('Oncologist');
    expect(screen.getByRole('radio', { name: 'Oncologist' })).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const [, body] = mockUpdate.mock.calls[0];
    expect(body.additional_doctors?.[1].name).toBe('Dr. Lee');
    expect(body.additional_doctors?.[1].specialty).toBe('Oncologist');
  });
});

describe('EditMedicalInfoModal — tag arrays via TagInput', () => {
  it('seeds pills from the fetched arrays', () => {
    render(wrap(<EditMedicalInfoModal circleId={CIRCLE_ID} info={baseInfo} onClose={vi.fn()} />));

    expect(screen.getByRole('button', { name: 'Remove Penicillin' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Peanuts' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Hypertension' })).toBeInTheDocument();
    // Already-selected values are excluded from their suggestion groups.
    expect(screen.queryByRole('button', { name: 'Penicillin' })).not.toBeInTheDocument();
  });

  it('sends the arrays directly (no join/split) with suggestion + custom adds', async () => {
    const onClose = vi.fn();
    render(
      wrap(<EditMedicalInfoModal circleId={CIRCLE_ID} info={baseInfo} onClose={onClose} />)
    );

    // Add a curated suggestion to Other allergies.
    fireEvent.click(screen.getByRole('button', { name: 'Latex' }));
    // Add a custom (comma-stripped) condition via Enter in the input.
    const conditionsInput = screen.getByLabelText(/^Medical conditions/, { selector: 'input' });
    fireEvent.change(conditionsInput, { target: { value: 'Chronic migraines, aura' } });
    fireEvent.keyDown(conditionsInput, { key: 'Enter' });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const [, body] = mockUpdate.mock.calls[0];
    expect(body.allergies).toEqual(['Peanuts', 'Latex']);
    expect(body.medical_conditions).toEqual(['Hypertension', 'Chronic migraines aura']);
    // Blood type chip (seeded 'O+') stays selected; medication allergies preserved.
    expect(body.blood_type).toBe('O+');
    expect(body.medication_allergies).toEqual(['Penicillin']);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('blood type chips: selecting a new type and deselecting send value then null', async () => {
    render(wrap(<EditMedicalInfoModal circleId={CIRCLE_ID} info={baseInfo} onClose={vi.fn()} />));

    // Seeded 'O+' is checked; switch to AB-.
    expect(screen.getByRole('radio', { name: 'O+' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'AB-' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate.mock.calls[0][1].blood_type).toBe('AB-');

    // Deselect: clicking the now-selected chip clears it → null persists the clear.
    fireEvent.click(screen.getByRole('radio', { name: 'AB-' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2));
    expect(mockUpdate.mock.calls[1][1].blood_type).toBeNull();
  });

  it('sends empty arrays when every pill is removed', async () => {
    render(wrap(<EditMedicalInfoModal circleId={CIRCLE_ID} info={baseInfo} onClose={vi.fn()} />));

    fireEvent.click(screen.getByRole('button', { name: 'Remove Penicillin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Peanuts' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Hypertension' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const [, body] = mockUpdate.mock.calls[0];
    expect(body.medication_allergies).toEqual([]);
    expect(body.allergies).toEqual([]);
    expect(body.medical_conditions).toEqual([]);
  });
});
