import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { Provider } from '@/api/providers';
import { Analytics } from '@/lib/analytics';
import { AddEventModal } from '../AddEventModal';

// The appointment form's optional Doctor row (docs/plans/notes-by-doctor.md, flow 3):
// the picker, location prefill, the stored-link echo on edit, a removed doctor,
// the series note, "Add a doctor", and the provider_linked / provider_unlinked
// analytics.

const RECIPIENT_TZ = 'America/New_York';
const CIRCLE_ID = 'circle-1';

const mutateCreate = vi.fn();
const mutateUpdate = vi.fn();
vi.mock('@/hooks/useCalendarEvents', () => ({
  useCreateEvent: () => ({ mutateAsync: mutateCreate, isPending: false }),
  useUpdateEvent: () => ({ mutateAsync: mutateUpdate, isPending: false }),
  useCachedCircleEvents: () => [],
}));
vi.mock('../DoseQuietHoursNote', () => ({ DoseQuietHoursNote: () => null }));
vi.mock('@/api/drugs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/drugs')>()),
  searchDrugs: vi.fn().mockResolvedValue([]),
}));
// STABLE identity per event, like the real hook's (the form's hydration effects
// key on the root object; a fresh object every render re-hydrates forever).
const derivedRoots = new WeakMap<CalendarEvent, { root: CalendarEvent }>();
vi.mock('@/hooks/useSeriesRoot', () => ({
  useSeriesRoot: (_c: string, event: CalendarEvent | null | undefined) => {
    if (!event) return { root: null };
    if (!event.parent_event_id) return { root: event };
    let derived = derivedRoots.get(event);
    if (!derived) {
      derived = { root: { ...event, id: event.parent_event_id, parent_event_id: null } };
      derivedRoots.set(event, derived);
    }
    return derived;
  },
}));
vi.mock('@/hooks/useCircle', () => ({
  useCircle: () => ({
    circle: undefined,
    circleSummary: undefined,
    timezone: RECIPIENT_TZ,
    members: [],
    canEdit: true,
    accessLevel: 'full',
    viewOnly: false,
    readOnly: false,
  }),
}));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));
const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui')>()),
  useToast: () => ({ showToast }),
}));
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    providerLinked: vi.fn(),
    providerUnlinked: vi.fn(),
    asNeededMedicationCreated: vi.fn(),
    errorOccurred: vi.fn(),
    entrySaveTapped: vi.fn(),
    entrySaveFailed: vi.fn(),
    entryValidationBlocked: vi.fn(),
    medicationCreated: vi.fn(),
    medicationFormAbandoned: vi.fn(),
    appointmentFormAbandoned: vi.fn(),
    entryFormOpened: vi.fn(),
    entryFormStepCompleted: vi.fn(),
    timeChipSelected: vi.fn(),
    largeTextLayout: vi.fn(),
  },
}));

// The doctors the picker reads. Controllable per test.
let providersMock: Provider[] = [];
vi.mock('@/hooks/useProviders', () => ({
  useProviders: () => ({ providers: providersMock, isSuccess: true }),
}));

// "Add a doctor" opens the Medical Info add-doctor dialog; its own suite proves
// the save. Here it is a stand-in that reports a saved doctor.
let savedFromDialog: Provider | null = null;
vi.mock('@/components/emergency/EditDoctorModal', () => ({
  EditDoctorModal: (props: { onSaved?: (p: Provider) => void; onClose: () => void }) => (
    <div role="dialog" aria-label="add-doctor-stub">
      <button
        onClick={() => {
          if (savedFromDialog) props.onSaved?.(savedFromDialog);
          props.onClose();
        }}
      >
        save-stub
      </button>
    </div>
  ),
}));
vi.mock('@/hooks/useEmergencyInfo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useEmergencyInfo')>()),
  useEmergencyInfo: () => ({ data: null }),
}));

function doctor(over: Partial<Provider> & { id: string; name: string }): Provider {
  return {
    specialty: null,
    phone: null,
    country_code: null,
    phone_extension: null,
    address: null,
    is_primary: false,
    sort_order: 1,
    archived_at: null,
    created_at: '',
    updated_at: '',
    ...over,
  };
}

const KIM_ID = '22222222-2222-4222-8222-222222222222';
const GONE_ID = '33333333-3333-4333-8333-333333333333';
const PATEL = doctor({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Dr. Patel',
  specialty: 'Cardiology',
  is_primary: true,
  sort_order: 0,
  address: '1200 Heart Center Dr\nSuite 300',
});
const KIM = doctor({ id: '22222222-2222-4222-8222-222222222222', name: 'Dr. Kim', specialty: 'Family medicine' });
const GONE = doctor({ id: '33333333-3333-4333-8333-333333333333', name: 'Dr. Gone', archived_at: '2026-10-01T00:00:00Z' });

function appt(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'ev-1',
    circle_id: CIRCLE_ID,
    event_type: 'appointment',
    title: 'Checkup',
    scheduled_date: '2026-06-15',
    scheduled_time: '14:00:00',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...over,
  };
}

const doctorSelect = () => screen.getByLabelText('Doctor') as HTMLSelectElement;
const locationInput = () => screen.getByLabelText(/^Location/) as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  providersMock = [PATEL, KIM, GONE];
  savedFromDialog = null;
  mutateCreate.mockResolvedValue(appt());
  mutateUpdate.mockResolvedValue(appt());
});

describe('Doctor field: the picker', () => {
  it('lists None first, then the ACTIVE doctors (primary first, specialty shown); a removed doctor is not offered', () => {
    render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" layout="full" onClose={vi.fn()} />);
    const labels = Array.from(doctorSelect().options).map((o) => o.textContent);
    expect(labels).toEqual(['None', 'Dr. Patel · Cardiology · Primary', 'Dr. Kim · Family medicine']);
    expect(doctorSelect().value).toBe('');
  });

  it('is an appointment-only field: medications and tasks have no Doctor row', () => {
    const { rerender } = render(
      <AddEventModal circleId={CIRCLE_ID} initialType="medication" layout="full" onClose={vi.fn()} />
    );
    expect(screen.queryByLabelText('Doctor')).toBeNull();
    rerender(<AddEventModal circleId={CIRCLE_ID} initialType="task" layout="full" onClose={vi.fn()} />);
    expect(screen.queryByLabelText('Doctor')).toBeNull();
  });

  it('sits before Location, and is reachable by keyboard with a visible label', async () => {
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" layout="full" onClose={vi.fn()} />);
    const order = screen
      .getAllByRole('combobox')
      .map((el) => el.id)
      .filter((id) => id === 'provider_id');
    expect(order).toEqual(['provider_id']);
    expect(doctorSelect().compareDocumentPosition(locationInput()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    doctorSelect().focus();
    expect(doctorSelect()).toHaveFocus();
    await user.keyboard('{ArrowDown}');
  });
});

describe('Doctor field: location prefill', () => {
  it('fills an EMPTY location from the doctor address (one line) and says where it came from', async () => {
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" layout="full" onClose={vi.fn()} />);
    await user.selectOptions(doctorSelect(), '11111111-1111-4111-8111-111111111111');
    expect(locationInput()).toHaveValue('1200 Heart Center Dr, Suite 300');
    expect(screen.getByText("Filled in from Dr. Patel's address")).toBeInTheDocument();
    expect(locationInput()).toHaveAccessibleDescription("Filled in from Dr. Patel's address");
  });

  it('typing in the location drops the hint and keeps what was typed', async () => {
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" layout="full" onClose={vi.fn()} />);
    await user.selectOptions(doctorSelect(), '11111111-1111-4111-8111-111111111111');
    await user.type(locationInput(), ' (north entrance)');
    expect(locationInput()).toHaveValue('1200 Heart Center Dr, Suite 300 (north entrance)');
    expect(screen.queryByText(/Filled in from/)).toBeNull();
  });

  it('never overwrites a location the user already typed', async () => {
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" layout="full" onClose={vi.fn()} />);
    await user.type(locationInput(), 'Home visit');
    await user.selectOptions(doctorSelect(), '11111111-1111-4111-8111-111111111111');
    expect(locationInput()).toHaveValue('Home visit');
    expect(screen.queryByText(/Filled in from/)).toBeNull();
  });

  it('a doctor without an address, and None, leave the location alone', async () => {
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" layout="full" onClose={vi.fn()} />);
    await user.selectOptions(doctorSelect(), '22222222-2222-4222-8222-222222222222');
    expect(locationInput()).toHaveValue('');
    await user.selectOptions(doctorSelect(), '');
    expect(locationInput()).toHaveValue('');
    expect(screen.queryByText(/Filled in from/)).toBeNull();
  });

  it('skips an address longer than the field instead of cutting it mid-word', async () => {
    providersMock = [doctor({ id: '55555555-5555-4555-8555-555555555555', name: 'Dr. Long', address: 'x'.repeat(251) })];
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" layout="full" onClose={vi.fn()} />);
    await user.selectOptions(doctorSelect(), '55555555-5555-4555-8555-555555555555');
    expect(locationInput()).toHaveValue('');
  });

  it('a doctor preselected by the caller (Visits page) is picked and fills the location', async () => {
    render(
      <AddEventModal
        circleId={CIRCLE_ID}
        initialType="appointment" layout="full"
        initialProviderId="11111111-1111-4111-8111-111111111111"
        onClose={vi.fn()}
      />
    );
    expect(doctorSelect().value).toBe('11111111-1111-4111-8111-111111111111');
    await waitFor(() =>
      expect(locationInput()).toHaveValue('1200 Heart Center Dr, Suite 300')
    );
    expect(screen.getByText("Filled in from Dr. Patel's address")).toBeInTheDocument();
  });
});

describe('Doctor field: saving a NEW appointment', () => {
  async function fillAndSave(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/^Title( \* \(required\))?$/), 'Follow-up');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
    return mutateCreate.mock.calls[0][0] as Record<string, unknown>;
  }

  it('sends the picked doctor and counts provider_linked{source:add}', async () => {
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" layout="full" onClose={vi.fn()} />);
    await user.selectOptions(doctorSelect(), '22222222-2222-4222-8222-222222222222');
    const body = await fillAndSave(user);
    expect(body.provider_id).toBe('22222222-2222-4222-8222-222222222222');
    await waitFor(() => expect(Analytics.providerLinked).toHaveBeenCalledWith({ source: 'add' }));
    expect(Analytics.providerLinked).toHaveBeenCalledTimes(1);
    expect(Analytics.providerUnlinked).not.toHaveBeenCalled();
  });

  it('with None, names no doctor at all and fires nothing', async () => {
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" layout="full" onClose={vi.fn()} />);
    const body = await fillAndSave(user);
    expect('provider_id' in body).toBe(false);
    expect(Analytics.providerLinked).not.toHaveBeenCalled();
  });

  it('a failed save fires no analytics', async () => {
    mutateCreate.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" layout="full" onClose={vi.fn()} />);
    await user.selectOptions(doctorSelect(), '22222222-2222-4222-8222-222222222222');
    await user.type(screen.getByLabelText(/^Title( \* \(required\))?$/), 'Follow-up');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalled());
    expect(Analytics.providerLinked).not.toHaveBeenCalled();
  });
});

describe('Doctor field: editing', () => {
  async function save(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    return mutateUpdate.mock.calls[0][0] as { eventId: string; data: Record<string, unknown> };
  }

  it('echoes the stored doctor: the select shows it and an untouched save sends the same id', async () => {
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} event={appt({ provider_id: '22222222-2222-4222-8222-222222222222' })} onClose={vi.fn()} />);
    expect(doctorSelect().value).toBe('22222222-2222-4222-8222-222222222222');
    const { data } = await save(user);
    expect(data.provider_id).toBe('22222222-2222-4222-8222-222222222222');
    // Unchanged: neither linked nor unlinked.
    expect(Analytics.providerLinked).not.toHaveBeenCalled();
    expect(Analytics.providerUnlinked).not.toHaveBeenCalled();
  });

  it('an appointment with no doctor saves provider_id null (None), with no analytics', async () => {
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} event={appt()} onClose={vi.fn()} />);
    expect(doctorSelect().value).toBe('');
    const { data } = await save(user);
    expect(data.provider_id).toBeNull();
    expect(Analytics.providerLinked).not.toHaveBeenCalled();
    expect(Analytics.providerUnlinked).not.toHaveBeenCalled();
  });

  it('choosing another doctor sends it and counts provider_linked{source:edit}', async () => {
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} event={appt({ provider_id: '22222222-2222-4222-8222-222222222222' })} onClose={vi.fn()} />);
    await user.selectOptions(doctorSelect(), '11111111-1111-4111-8111-111111111111');
    const { data } = await save(user);
    expect(data.provider_id).toBe('11111111-1111-4111-8111-111111111111');
    expect(Analytics.providerLinked).toHaveBeenCalledWith({ source: 'edit' });
    expect(Analytics.providerUnlinked).not.toHaveBeenCalled();
  });

  it('None clears the link (null) and counts provider_unlinked', async () => {
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} event={appt({ provider_id: '22222222-2222-4222-8222-222222222222' })} onClose={vi.fn()} />);
    await user.selectOptions(doctorSelect(), '');
    const { data } = await save(user);
    expect(data.provider_id).toBeNull();
    expect(Analytics.providerUnlinked).toHaveBeenCalledTimes(1);
    expect(Analytics.providerLinked).not.toHaveBeenCalled();
  });

  it('adding a doctor to a previously unlinked appointment counts provider_linked{source:edit}', async () => {
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} event={appt()} onClose={vi.fn()} />);
    await user.selectOptions(doctorSelect(), '11111111-1111-4111-8111-111111111111');
    await save(user);
    expect(Analytics.providerLinked).toHaveBeenCalledWith({ source: 'edit' });
  });

  it('does not touch location when editing an appointment that already has one', async () => {
    const user = userEvent.setup();
    render(
      <AddEventModal circleId={CIRCLE_ID} event={appt({ location: 'Clinic B' })} onClose={vi.fn()} />
    );
    await user.selectOptions(doctorSelect(), '11111111-1111-4111-8111-111111111111');
    expect(locationInput()).toHaveValue('Clinic B');
  });

  it('a medication edit never sends provider_id', async () => {
    const user = userEvent.setup();
    render(
      <AddEventModal
        circleId={CIRCLE_ID}
        event={appt({ event_type: 'medication', title: 'Metformin', medication_name: 'Metformin' })}
        onClose={vi.fn()}
      />
    );
    const { data } = await save(user);
    expect('provider_id' in data).toBe(false);
  });
});

describe('Doctor field: a removed doctor', () => {
  it('is shown as "(removed)", kept on an untouched save, and can be changed', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <AddEventModal circleId={CIRCLE_ID} event={appt({ provider_id: '33333333-3333-4333-8333-333333333333' })} onClose={vi.fn()} />
    );
    expect(doctorSelect().value).toBe('33333333-3333-4333-8333-333333333333');
    expect(doctorSelect().selectedOptions[0].textContent).toBe('Dr. Gone (removed)');
    // Offered alongside the active doctors only as the CURRENT value.
    expect(Array.from(doctorSelect().options).map((o) => o.textContent)).toEqual([
      'None',
      'Dr. Patel · Cardiology · Primary',
      'Dr. Kim · Family medicine',
      'Dr. Gone (removed)',
    ]);

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    expect(mutateUpdate.mock.calls[0][0].data.provider_id).toBe('33333333-3333-4333-8333-333333333333');
    expect(Analytics.providerLinked).not.toHaveBeenCalled();
    unmount();

    // Changing it away works - and the removed doctor stays OFFERED while another one is
    // chosen, so the user can switch back before saving.
    vi.clearAllMocks();
    mutateUpdate.mockResolvedValue(appt());
    render(<AddEventModal circleId={CIRCLE_ID} event={appt({ provider_id: GONE_ID })} onClose={vi.fn()} />);
    await user.selectOptions(doctorSelect(), KIM_ID);
    expect(Array.from(doctorSelect().options).map((o) => o.textContent)).toContain('Dr. Gone (removed)');
    await user.selectOptions(doctorSelect(), GONE_ID);
    expect(doctorSelect().value).toBe(GONE_ID);
    await user.selectOptions(doctorSelect(), KIM_ID);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    expect(mutateUpdate.mock.calls[0][0].data.provider_id).toBe(KIM_ID);
    expect(Analytics.providerLinked).toHaveBeenCalledWith({ source: 'edit' });
  });

  it('a stored id the list cannot name yet still round-trips (shown as "Linked doctor")', async () => {
    providersMock = [];
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} event={appt({ provider_id: '66666666-6666-4666-8666-666666666666' })} onClose={vi.fn()} />);
    expect(doctorSelect().selectedOptions[0].textContent).toBe('Linked doctor');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    expect(mutateUpdate.mock.calls[0][0].data.provider_id).toBe('66666666-6666-4666-8666-666666666666');
  });
});

describe('Doctor field: series', () => {
  it('says "Applies to the whole series" when editing an occurrence or a recurring root', () => {
    const { unmount } = render(
      <AddEventModal
        circleId={CIRCLE_ID}
        event={appt({ parent_event_id: 'root-1', provider_id: '22222222-2222-4222-8222-222222222222' })}
        onClose={vi.fn()}
      />
    );
    expect(doctorSelect()).toHaveAccessibleDescription(/Applies to the whole series/);
    unmount();
    render(
      <AddEventModal
        circleId={CIRCLE_ID}
        event={appt({ recurrence_rule: 'weekly' })}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('Applies to the whole series')).toBeInTheDocument();
  });

  it('says nothing for a one-off appointment or a new one', () => {
    const { unmount } = render(<AddEventModal circleId={CIRCLE_ID} event={appt()} onClose={vi.fn()} />);
    expect(screen.queryByText('Applies to the whole series')).toBeNull();
    unmount();
    render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" layout="full" onClose={vi.fn()} />);
    expect(screen.queryByText('Applies to the whole series')).toBeNull();
  });
});

describe('Doctor field: Add a doctor', () => {
  it('opens the add-doctor dialog and comes back to the form: the new doctor is listed but NOT selected, and the location is untouched', async () => {
    savedFromDialog = doctor({ id: '44444444-4444-4444-8444-444444444444', name: 'Dr. New', address: '9 Elm St' });
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" layout="full" onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Add a doctor' }));
    expect(screen.getByRole('dialog', { name: 'add-doctor-stub' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'save-stub' }));
    // Back on the appointment form, nothing chosen for the user.
    expect(screen.queryByRole('dialog', { name: 'add-doctor-stub' })).toBeNull();
    expect(doctorSelect().value).toBe('');
    expect(locationInput()).toHaveValue('');
    // The doctor is offered straight away (before the list refetch lands).
    expect(Array.from(doctorSelect().options).map((o) => o.textContent)).toContain('Dr. New');
    // ...and picking it works like any other.
    await user.selectOptions(doctorSelect(), '44444444-4444-4444-8444-444444444444');
    expect(locationInput()).toHaveValue('9 Elm St');
  });

  it('cancelling the dialog changes nothing', async () => {
    savedFromDialog = null;
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" layout="full" onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Add a doctor' }));
    await user.click(screen.getByRole('button', { name: 'save-stub' }));
    expect(doctorSelect().value).toBe('');
  });
});
