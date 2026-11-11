import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { Analytics } from '@/lib/analytics';
import { resetLargeTextReports } from '@/lib/largeText';
import { AddEventModal } from '../AddEventModal';

// More details on the WEB medication form now carries what mobile's does (owner 2026-11-08, parity): the
// photo, Track refills (pills remaining / per dose / alert days, the computed lines, the shared-bottle
// note) and Prescriber / Pharmacy / Pharmacy phone / Rx number. The request keys are mobile's.

const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'America/Denver';
});
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const CIRCLE_ID = 'circle-1';
const mutateCreate = vi.fn();
const mutateUpdate = vi.fn();
const getDetails = vi.fn();
const uploadPhoto = vi.fn();
const deletePhoto = vi.fn();
const patchEvent = vi.fn();
vi.mock('../DoseQuietHoursNote', () => ({ DoseQuietHoursNote: () => null }));
vi.mock('@/api/drugs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/drugs')>()),
  searchDrugs: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/api/medicationPhoto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/medicationPhoto')>()),
  getMedicationFormDetails: (...args: unknown[]) => getDetails(...args),
  uploadMedicationPhoto: (...args: unknown[]) => uploadPhoto(...args),
  deleteMedicationPhoto: (...args: unknown[]) => deletePhoto(...args),
}));
vi.mock('@/api/calendarEvents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/calendarEvents')>()),
  updateEvent: (...args: unknown[]) => patchEvent(...args),
}));
vi.mock('@/hooks/useProviders', () => ({ useProviders: () => ({ providers: [], isSuccess: true }) }));
vi.mock('@/hooks/useCalendarEvents', () => ({
  useCreateEvent: () => ({ mutateAsync: mutateCreate, isPending: false }),
  useUpdateEvent: () => ({ mutateAsync: mutateUpdate, isPending: false }),
  useCachedCircleEvents: () => [],
}));
vi.mock('@/hooks/useSeriesRoot', () => ({
  useSeriesRoot: (_c: string, event: unknown) => ({ root: event ?? null }),
}));
const useCircleResult = {
  circle: undefined,
  circleSummary: undefined,
  timezone: 'America/New_York',
  members: [],
  canEdit: true,
  accessLevel: 'full' as const,
  viewOnly: false,
  readOnly: false,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};
vi.mock('@/hooks/useCircle', () => ({ useCircle: () => useCircleResult }));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));
const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui')>()),
  useToast: () => ({ showToast }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  resetLargeTextReports();
  mutateCreate.mockResolvedValue({ id: 'new-med' });
  mutateUpdate.mockResolvedValue({ id: 'med-1' });
  uploadPhoto.mockResolvedValue({ storagePath: 'medication-photos/circle-1/new-med/1.png' });
  patchEvent.mockResolvedValue({ id: 'new-med' });
  deletePhoto.mockResolvedValue(undefined);
  for (const name of [
    'entryFormOpened',
    'entryFormStepCompleted',
    'timeChipSelected',
    'entrySaveTapped',
    'largeTextLayout',
    'medicationCreated',
    'medNameSuggestionOutcome',
    'asNeededMedicationCreated',
    'medicationFormAbandoned',
  ] as const) {
    vi.spyOn(Analytics, name).mockImplementation(() => {});
  }
  URL.createObjectURL = vi.fn(() => 'blob:preview-1');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.restoreAllMocks();
});

type User = ReturnType<typeof userEvent.setup>;
// Build 11: time-first chips, checkboxes on a new medication (multi-select: a further chip is an extra dose).
const chip = (name: RegExp) =>
  within(screen.getByRole('group', { name: 'Common dose times' })).getByRole('checkbox', { name });

function renderNew() {
  return render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);
}
async function openMore(user: User) {
  const toggle = screen.getByRole('button', { name: /^More details/ });
  if (toggle.getAttribute('aria-expanded') !== 'true') await user.click(toggle);
}
async function nameAndTime(user: User) {
  await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
  await user.click(chip(/Evening/));
}
const save = (user: User) => user.click(screen.getByTestId('add-event-save'));
function png(bytes = 1024, name = 'pill.png', type = 'image/png'): File {
  return new File([new Uint8Array(bytes)], name, { type });
}
const photoInput = () => screen.getByLabelText('Medication photo') as HTMLInputElement;

const MED: CalendarEvent = {
  id: 'med-1',
  circle_id: CIRCLE_ID,
  event_type: 'medication',
  title: 'Metformin',
  medication_name: 'Metformin',
  medication_dosage: '500 mg',
  scheduled_date: '2099-01-05',
  scheduled_time: '08:00:00',
  recurrence_rule: 'daily',
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
  notifications_enabled: true,
  reminder_at_due: true,
  reminder_24h: false,
  reminder_1h: false,
  reminder_30m: false,
  reminder_15m: false,
} as CalendarEvent;
const STORED = {
  track_refills: true,
  quantity_in_bottle: 60,
  pills_per_day: 2,
  pills_per_dose: 1,
  alert_days_before: 5,
  prescriber_name: 'Dr. Lee',
  pharmacy_name: 'Main St Pharmacy',
  pharmacy_phone: '555-0100',
  rx_number: 'RX-1',
  refill_group_id: null,
  medication_photo_url: 'stored',
};
function renderEdit(event: CalendarEvent = MED) {
  return render(<AddEventModal circleId={CIRCLE_ID} event={event} onClose={vi.fn()} />);
}

describe('new medication: refills + prescription details', () => {
  it('saves mobile’s keys on the primary; the extra dose carries no refill state of its own', async () => {
    const user = userEvent.setup();
    renderNew();
    await nameAndTime(user);
    // A second chosen time is the extra dose ("+ Another dose" before build 11).
    await user.click(chip(/Morning/));
    await openMore(user);
    await user.click(screen.getByRole('checkbox', { name: /Track refills/ }));
    await user.type(screen.getByLabelText('Pills remaining'), '60');
    await user.type(screen.getByLabelText('Pills per dose'), '1');
    // The computed lines (create): 1 x 2 dose times, and the days of supply.
    expect(screen.getByTestId('pills-per-day-derived')).toHaveTextContent('1 × 2 dose times = 2 per day');
    expect(screen.getByTestId('refill-estimate')).toHaveTextContent('~30 days supply. Alert when 7 days left.');
    await user.type(screen.getByLabelText('Prescriber'), 'Dr. Lee');
    await user.type(screen.getByLabelText('Pharmacy'), 'Main St');
    await user.type(screen.getByLabelText('Pharmacy phone'), '555-0100');
    await user.type(screen.getByLabelText('Rx number'), 'RX-1');
    await save(user);
    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(2));
    const primary = mutateCreate.mock.calls[0][0];
    expect(primary).toMatchObject({
      track_refills: true,
      quantity_in_bottle: 60,
      quantity_remaining: 60,
      pills_per_day: 2,
      pills_per_dose: 1,
      alert_days_before: 7,
      prescriber_name: 'Dr. Lee',
      pharmacy_name: 'Main St',
      pharmacy_phone: '555-0100',
      rx_number: 'RX-1',
    });
    const sibling = JSON.parse(JSON.stringify(mutateCreate.mock.calls[1][0]));
    expect(sibling.track_refills).toBe(false);
    for (const key of ['quantity_in_bottle', 'quantity_remaining', 'pills_per_day', 'pills_per_dose', 'alert_days_before']) {
      expect(sibling).not.toHaveProperty(key);
    }
    expect(sibling.refill_group_id).toBe('new-med');
    expect(sibling.prescriber_name).toBe('Dr. Lee');
  });

  it('untouched More details adds no key to the create body', async () => {
    const user = userEvent.setup();
    renderNew();
    await nameAndTime(user);
    await save(user);
    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
    const body = mutateCreate.mock.calls[0][0];
    for (const key of ['track_refills', 'quantity_in_bottle', 'pills_per_dose', 'prescriber_name', 'medication_photo_url']) {
      expect(body).not.toHaveProperty(key);
    }
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it('alert days over 90 is refused inline, More details stays open and nothing saves', async () => {
    const user = userEvent.setup();
    renderNew();
    await nameAndTime(user);
    await openMore(user);
    await user.click(screen.getByRole('checkbox', { name: /Track refills/ }));
    const alertDays = screen.getByLabelText(/Alert days before empty/);
    await user.clear(alertDays);
    await user.type(alertDays, '95');
    await save(user);
    expect(await screen.findByText('Enter a number from 1 to 90.')).toBeInTheDocument();
    expect(mutateCreate).not.toHaveBeenCalled();
    await waitFor(() => expect(alertDays).toHaveFocus());
  });

  it('alert days 0 is refused inline with the same message (1 to 90, like mobile)', async () => {
    const user = userEvent.setup();
    renderNew();
    await nameAndTime(user);
    await openMore(user);
    await user.click(screen.getByRole('checkbox', { name: /Track refills/ }));
    const alertDays = screen.getByLabelText(/Alert days before empty/);
    await user.clear(alertDays);
    await user.type(alertDays, '0');
    await save(user);
    expect(await screen.findByText('Enter a number from 1 to 90.')).toBeInTheDocument();
    expect(mutateCreate).not.toHaveBeenCalled();
  });

  it('counts take digits only (mobile number pad)', async () => {
    const user = userEvent.setup();
    renderNew();
    await openMore(user);
    await user.click(screen.getByRole('checkbox', { name: /Track refills/ }));
    await user.type(screen.getByLabelText('Pills remaining'), '3a0');
    expect(screen.getByLabelText('Pills remaining')).toHaveValue('30');
  });

  it('as needed: no refill section (refills are off in v1), the prescription fields stay', async () => {
    const user = userEvent.setup();
    renderNew();
    await user.click(screen.getByRole('radio', { name: 'When needed' }));
    await openMore(user);
    expect(screen.queryByRole('checkbox', { name: /Track refills/ })).toBeNull();
    expect(screen.getByLabelText('Prescriber')).toBeInTheDocument();
    expect(screen.getByLabelText('Medication photo')).toBeInTheDocument();
  });
});

describe('new medication: photo', () => {
  it('a picked photo previews with alt text, then uploads onto the PRIMARY row and PATCHes its path', async () => {
    const user = userEvent.setup();
    renderNew();
    await nameAndTime(user);
    await openMore(user);
    expect(screen.getByRole('button', { name: 'Add a photo' })).toBeInTheDocument();
    const file = png();
    await user.upload(photoInput(), file);
    expect(await screen.findByAltText('Photo of the medication')).toHaveAttribute('src', 'blob:preview-1');
    expect(screen.getByRole('button', { name: 'Change photo' })).toBeInTheDocument();
    await save(user);
    await waitFor(() => expect(patchEvent).toHaveBeenCalledTimes(1));
    expect(uploadPhoto).toHaveBeenCalledWith(CIRCLE_ID, 'new-med', file);
    expect(patchEvent).toHaveBeenCalledWith(CIRCLE_ID, 'new-med', {
      medication_photo_url: 'medication-photos/circle-1/new-med/1.png',
    });
    expect(showToast).toHaveBeenCalledWith('Medication added', 'success');
  });

  it('an upload failure keeps the medication and says so instead of the success toast', async () => {
    uploadPhoto.mockRejectedValueOnce(new Error('400'));
    const user = userEvent.setup();
    renderNew();
    await nameAndTime(user);
    await openMore(user);
    await user.upload(photoInput(), png());
    await save(user);
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        'Event saved but photo upload failed. You can try adding the photo later.',
        'error'
      )
    );
    expect(patchEvent).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalledWith('Medication added', 'success');
  });

  it('refuses a type the bucket does not take, inline', async () => {
    const user = userEvent.setup();
    renderNew();
    await openMore(user);
    fireEvent.change(photoInput(), { target: { files: [png(10, 'pill.gif', 'image/gif')] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a JPEG, PNG or WebP image.');
    expect(photoInput()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByAltText('Photo of the medication')).toBeNull();
  });

  it('refuses a photo over the 2 MB bucket limit, inline', async () => {
    const user = userEvent.setup();
    renderNew();
    await openMore(user);
    fireEvent.change(photoInput(), { target: { files: [png(2 * 1024 * 1024 + 1)] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('This photo is too large. Choose one under 2 MB.');
  });

  it('Remove photo on a new pick clears it; nothing uploads', async () => {
    const user = userEvent.setup();
    renderNew();
    await nameAndTime(user);
    await openMore(user);
    await user.upload(photoInput(), png());
    await user.click(await screen.findByRole('button', { name: 'Remove photo' }));
    expect(screen.queryByAltText('Photo of the medication')).toBeNull();
    await save(user);
    await waitFor(() => expect(mutateCreate).toHaveBeenCalled());
    expect(uploadPhoto).not.toHaveBeenCalled();
  });
});

describe('edit medication', () => {
  it('hydrates from the single-event GET (More details stays collapsed on edit), shows the stored photo and echoes mobile’s keys', async () => {
    getDetails.mockResolvedValue({ details: STORED, photoUrl: 'https://signed.example/photo.png' });
    const user = userEvent.setup();
    renderEdit();
    expect(await screen.findByAltText('Photo of the medication')).toHaveAttribute(
      'src',
      'https://signed.example/photo.png'
    );
    expect(getDetails).toHaveBeenCalledWith(CIRCLE_ID, 'med-1');
    // Build 11 (owner 2026-11-10): More details is collapsed by default on edit too, stored details or not.
    expect(screen.getByRole('button', { name: /^More details/ })).toHaveAttribute('aria-expanded', 'false');
    await openMore(user);
    expect(screen.getByRole('checkbox', { name: /Track refills/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Pills remaining')).toHaveValue('60');
    expect(screen.getByLabelText('Prescriber')).toHaveValue('Dr. Lee');
    // Edit: the stored day figure is the rate (the form cannot see the other dose times).
    expect(screen.getByTestId('refill-estimate')).toHaveTextContent('~30 days supply. Alert when 5 days left.');
    expect(screen.queryByTestId('pills-per-day-derived')).toBeNull();
    await save(user);
    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    const body = mutateUpdate.mock.calls[0][0].data;
    expect(body).toMatchObject({
      track_refills: true,
      quantity_in_bottle: 60,
      pills_per_dose: 1,
      alert_days_before: 5,
      prescriber_name: 'Dr. Lee',
      pharmacy_name: 'Main St Pharmacy',
      pharmacy_phone: '555-0100',
      rx_number: 'RX-1',
    });
    // Untouched bottle: the live count is NOT re-seeded (that refilled it on every save).
    expect(body).not.toHaveProperty('quantity_remaining');
    expect(body).not.toHaveProperty('medication_photo_url');
    expect(uploadPhoto).not.toHaveBeenCalled();
    expect(deletePhoto).not.toHaveBeenCalled();
  });

  it('Remove photo on a stored photo deletes it after the save', async () => {
    getDetails.mockResolvedValue({ details: STORED, photoUrl: 'https://signed.example/photo.png' });
    const user = userEvent.setup();
    renderEdit();
    await screen.findByAltText('Photo of the medication');
    await openMore(user); // collapsed by default on edit (build 11)
    await user.click(await screen.findByRole('button', { name: 'Remove photo' }));
    expect(screen.queryByAltText('Photo of the medication')).toBeNull();
    await save(user);
    await waitFor(() => expect(deletePhoto).toHaveBeenCalledWith(CIRCLE_ID, 'med-1'));
  });

  it('emptying a stored prescription field sends null for it (clears it); the others are echoed', async () => {
    getDetails.mockResolvedValue({ details: STORED, photoUrl: null });
    const user = userEvent.setup();
    renderEdit();
    const pharmacy = await screen.findByLabelText('Pharmacy');
    await user.clear(pharmacy);
    await user.clear(screen.getByLabelText('Rx number'));
    await save(user);
    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    const body = mutateUpdate.mock.calls[0][0].data;
    expect(body).toMatchObject({
      prescriber_name: 'Dr. Lee',
      pharmacy_name: null,
      pharmacy_phone: '555-0100',
      rx_number: null,
    });
  });

  it('a replaced photo uploads to the edited row', async () => {
    getDetails.mockResolvedValue({ details: STORED, photoUrl: 'https://signed.example/photo.png' });
    const user = userEvent.setup();
    renderEdit();
    await screen.findByAltText('Photo of the medication');
    const file = png();
    await user.upload(photoInput(), file);
    await save(user);
    await waitFor(() => expect(uploadPhoto).toHaveBeenCalledWith(CIRCLE_ID, 'med-1', file));
    expect(deletePhoto).not.toHaveBeenCalled();
  });

  it('a dose that shares a bottle shows the note and sends no refill key', async () => {
    getDetails.mockResolvedValue({
      details: { ...STORED, track_refills: false, refill_group_id: 'owner-1', medication_photo_url: null },
      photoUrl: null,
    });
    const user = userEvent.setup();
    renderEdit();
    expect(await screen.findByTestId('refills-managed-on-owner')).toHaveTextContent(
      'Refills for this medication are tracked on its main dose. Open that dose to update the bottle.'
    );
    expect(screen.queryByRole('checkbox', { name: /Track refills/ })).toBeNull();
    await save(user);
    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    const body = mutateUpdate.mock.calls[0][0].data;
    for (const key of ['track_refills', 'quantity_in_bottle', 'pills_per_dose', 'alert_days_before']) {
      expect(body).not.toHaveProperty(key);
    }
  });

  it('when the details read fails: the fields stay hidden and the save sends none of their keys', async () => {
    getDetails.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    renderEdit();
    await waitFor(() => expect(getDetails).toHaveBeenCalled());
    await openMore(user);
    expect(screen.queryByLabelText('Prescriber')).toBeNull();
    await save(user);
    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    const body = mutateUpdate.mock.calls[0][0].data;
    for (const key of ['track_refills', 'quantity_in_bottle', 'prescriber_name', 'pharmacy_name']) {
      expect(body).not.toHaveProperty(key);
    }
  });
});
