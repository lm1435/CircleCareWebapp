// The add form's analytics contract (same events as mobile's AddEventScreen):
// entry_save_tapped on every attempt, entry_validation_blocked INSTEAD of
// entry_save_failed for a validation block / past-time cancel, entry_save_failed
// only for a real API failure, medication_created on a persisted create, and
// medication_form_abandoned once when the medication form is closed unsaved.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { Analytics } from '@/lib/analytics';
import { AddEventModal } from '../AddEventModal';

const RECIPIENT_TZ = 'America/New_York';
const CIRCLE_ID = 'circle-1';

const mutateCreate = vi.fn();
const mutateUpdate = vi.fn();

vi.mock('../DoseQuietHoursNote', () => ({ DoseQuietHoursNote: () => null }));
vi.mock('@/api/drugs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/drugs')>();
  return { ...actual, searchDrugs: vi.fn().mockResolvedValue([]) };
});
vi.mock('@/hooks/useProviders', () => ({
  useProviders: () => ({ providers: [], isSuccess: true }),
}));
vi.mock('@/hooks/useCalendarEvents', () => ({
  useCreateEvent: () => ({ mutateAsync: mutateCreate, isPending: false }),
  useUpdateEvent: () => ({ mutateAsync: mutateUpdate, isPending: false }),
  useCachedCircleEvents: () => [],
}));
vi.mock('@/hooks/useSeriesRoot', () => ({
  useSeriesRoot: (_c: string, event: CalendarEvent | null | undefined) => ({ root: event ?? null }),
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
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast: vi.fn() }) };
});

const onClose = vi.fn();
const onSaved = vi.fn();

let tapped: ReturnType<typeof vi.spyOn>;
let blocked: ReturnType<typeof vi.spyOn>;
let failed: ReturnType<typeof vi.spyOn>;
let created: ReturnType<typeof vi.spyOn>;
let abandoned: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  // as_needed echoed back: the old-backend guard undoes a create that lacks it.
  mutateCreate.mockResolvedValue({ id: 'new', as_needed: true });
  tapped = vi.spyOn(Analytics, 'entrySaveTapped').mockImplementation(() => {});
  blocked = vi.spyOn(Analytics, 'entryValidationBlocked').mockImplementation(() => {});
  failed = vi.spyOn(Analytics, 'entrySaveFailed').mockImplementation(() => {});
  created = vi.spyOn(Analytics, 'medicationCreated').mockImplementation(() => {});
  abandoned = vi.spyOn(Analytics, 'medicationFormAbandoned').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

function renderMed(props: Partial<React.ComponentProps<typeof AddEventModal>> = {}) {
  return render(
    <AddEventModal
      circleId={CIRCLE_ID}
      initialType="medication" layout="full"
      onClose={onClose}
      onSaved={onSaved}
      {...props}
    />
  );
}

describe('save events', () => {
  it('a valid create fires tapped (is_editing false) then medication_created, nothing else', async () => {
    const user = userEvent.setup();
    renderMed();
    await user.type(screen.getByLabelText(/^Medication name/), 'Metformin');
    await user.selectOptions(screen.getByLabelText('Repeat'), 'as_needed');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
    expect(tapped).toHaveBeenCalledWith(CIRCLE_ID, 'medication', 'form', false);
    // as-needed has no recurrence
    expect(created).toHaveBeenCalledWith(CIRCLE_ID, false, 'form', false);
    expect(blocked).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
    expect(abandoned).not.toHaveBeenCalled();
  });

  it('a recurring create reports has_recurrence true', async () => {
    const user = userEvent.setup();
    renderMed();
    await user.type(screen.getByLabelText(/^Medication name/), 'Metformin');
    await user.selectOptions(screen.getByLabelText('Repeat'), 'daily');
    const date = screen.getByLabelText(/^Date/) as HTMLInputElement;
    await user.clear(date);
    await user.type(date, '2099-01-01');
    const time = screen.getByLabelText(/^Time/) as HTMLInputElement;
    await user.clear(time);
    await user.type(time, '08:00');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(created).toHaveBeenCalledWith(CIRCLE_ID, true, 'form', false));
  });

  it('a blank name is a validation block, NOT a save failure', () => {
    renderMed();
    fireEvent.submit(document.getElementById('add-event-form') as HTMLFormElement);

    expect(tapped).toHaveBeenCalledWith(CIRCLE_ID, 'medication', 'form', false);
    expect(blocked).toHaveBeenCalledWith('missing_name', 'medication');
    expect(failed).not.toHaveBeenCalled();
    expect(mutateCreate).not.toHaveBeenCalled();
  });

  it('a missing medication time is missing_time', async () => {
    const user = userEvent.setup();
    renderMed();
    await user.type(screen.getByLabelText(/^Medication name/), 'Metformin');
    await user.clear(screen.getByLabelText(/^Time/));
    fireEvent.submit(document.getElementById('add-event-form') as HTMLFormElement);
    expect(blocked).toHaveBeenCalledWith('missing_time', 'medication');
    expect(failed).not.toHaveBeenCalled();
  });

  it('a missing appointment end time is missing_end_time', async () => {
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" layout="full" onClose={onClose} />);
    await user.type(screen.getByLabelText(/^Title( \* \(required\))?$/), 'Checkup');
    const time = screen.getByLabelText(/^Time/) as HTMLInputElement;
    await user.clear(time);
    await user.type(time, '08:00');
    const end = screen.getByLabelText(/^End time/) as HTMLInputElement;
    await user.clear(end);
    fireEvent.submit(document.getElementById('add-event-form') as HTMLFormElement);
    expect(blocked).toHaveBeenCalledWith('missing_end_time', 'appointment');
    expect(failed).not.toHaveBeenCalled();
  });

  it('a rejected create is a real failure: api_error + the closed-set code', async () => {
    mutateCreate.mockRejectedValue({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Metformin is secret' },
    });
    const user = userEvent.setup();
    renderMed();
    await user.type(screen.getByLabelText(/^Medication name/), 'Metformin');
    await user.selectOptions(screen.getByLabelText('Repeat'), 'as_needed');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(failed).toHaveBeenCalledTimes(1));
    expect(failed).toHaveBeenCalledWith(CIRCLE_ID, 'medication', 'api_error', {
      errorCode: 'FORBIDDEN',
    });
    expect(created).not.toHaveBeenCalled();
    expect(blocked).not.toHaveBeenCalled();
  });

  it('editing reports is_editing true and never medication_created', async () => {
    mutateUpdate.mockResolvedValue({});
    const user = userEvent.setup();
    render(
      <AddEventModal
        circleId={CIRCLE_ID}
        onClose={onClose}
        event={
          {
            id: 'ev-1',
            circle_id: CIRCLE_ID,
            event_type: 'medication',
            title: 'Metformin',
            medication_name: 'Metformin',
            scheduled_date: '2099-01-01',
            scheduled_time: '12:00:00',
            created_at: '2026-06-01T00:00:00Z',
            updated_at: '2026-06-01T00:00:00Z',
          } as CalendarEvent
        }
      />
    );
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mutateUpdate).toHaveBeenCalled());
    expect(tapped).toHaveBeenCalledWith(CIRCLE_ID, 'medication', 'form', true);
    expect(created).not.toHaveBeenCalled();
  });
});

describe('past time on create (inline note, no prompt)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-15T18:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function fill(user: ReturnType<typeof userEvent.setup>, time: string) {
    await user.type(screen.getByLabelText(/^Medication name/), 'Metformin');
    const dateInput = screen.getByLabelText(/^Date/) as HTMLInputElement;
    await user.clear(dateInput);
    await user.type(dateInput, '2026-06-15');
    const timeInput = screen.getByLabelText(/^Time/) as HTMLInputElement;
    await user.clear(timeInput);
    await user.type(timeInput, time);
    await user.click(screen.getByRole('button', { name: 'Create' }));
  }

  it('one tap saves: medication_created with starts_next_dose true, no past_time_cancelled', async () => {
    const user = userEvent.setup();
    renderMed();
    await fill(user, '10:00'); // 12:00 New York, already past
    await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
    expect(created.mock.calls[0][3]).toBe(true);
    expect(tapped).toHaveBeenCalledTimes(1);
    expect(blocked).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
  });

  it('a future time reports starts_next_dose false', async () => {
    const user = userEvent.setup();
    renderMed();
    await fill(user, '20:00'); // 22:00 New York, upcoming
    await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
    expect(created.mock.calls[0][3]).toBe(false);
  });
});

describe('medication_form_abandoned', () => {
  it('fires once on Cancel with the last changed field, name and entry', async () => {
    const user = userEvent.setup();
    renderMed();
    await user.type(screen.getByLabelText(/^Medication name/), 'Metformin');
    await user.type(screen.getByLabelText(/^Dosage/), '500 mg');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(abandoned).toHaveBeenCalledTimes(1);
    expect(abandoned).toHaveBeenCalledWith({
      lastField: 'dosage',
      hasName: true,
      hasSchedule: expect.any(Boolean),
      entry: 'form',
      entrySource: 'other',
      secondsOpen: expect.any(Number),
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reports last_field 'none' when nothing was touched", async () => {
    const user = userEvent.setup();
    renderMed();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(abandoned).toHaveBeenCalledWith(
      expect.objectContaining({ lastField: 'none', hasName: false })
    );
  });

  it('does not fire after a successful save', async () => {
    const user = userEvent.setup();
    renderMed();
    await user.type(screen.getByLabelText(/^Medication name/), 'Metformin');
    await user.selectOptions(screen.getByLabelText('Repeat'), 'as_needed');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(abandoned).not.toHaveBeenCalled();
  });

  it('does not fire for an appointment', async () => {
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" layout="full" onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(abandoned).not.toHaveBeenCalled();
  });
});
