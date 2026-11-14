// The "As needed" Repeat option on the medication form (docs/plans/prn-medications.md):
// no date / time / presets / end date / reminders; one optional plain reason;
// LOCKED after create; the server pins the schedule so none is sent.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import i18n from '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { Analytics } from '@/lib/analytics';
import { AddEventModal } from '../AddEventModal';

const RECIPIENT_TZ = 'America/New_York';
const CIRCLE_ID = 'circle-1';

const mutateCreate = vi.fn();
const mutateUpdate = vi.fn();
const deleteEventRequest = vi.fn();

// The quiet-hours note reads the current user over React Query; these suites have no
// QueryClient and are not about it (see DoseQuietHoursNote.test.tsx).
vi.mock('../DoseQuietHoursNote', () => ({ DoseQuietHoursNote: () => null }));
vi.mock('@/api/drugs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/drugs')>();
  return { ...actual, searchDrugs: vi.fn().mockResolvedValue([]) };
});
vi.mock('@/api/calendarEvents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/calendarEvents')>();
  return { ...actual, deleteEvent: (...a: unknown[]) => deleteEventRequest(...a) };
});
// The appointment form's Doctor row reads the circle's doctors over React Query; this
// suite mounts no QueryClient and is not about it (AddEventModal.doctor.test.tsx).
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
const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

const onClose = vi.fn();

function renderCreate() {
  return render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={onClose} />);
}

function prnEvent(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'prn-1',
    circle_id: CIRCLE_ID,
    event_type: 'medication',
    title: 'Ibuprofen',
    medication_name: 'Ibuprofen',
    medication_dosage: '200 mg',
    scheduled_date: '2026-06-01',
    scheduled_time: null,
    recurrence_rule: null,
    as_needed: true,
    as_needed_reason: 'pain',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...over,
  } as CalendarEvent;
}

async function chooseAsNeeded(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('radio', { name: 'When needed' }));
}

const REPEAT_HINT = 'No set times. Everyone in the circle is notified when someone logs a dose.';
const saveButton = () => screen.getByTestId('add-event-save');
const howOften = () => screen.getByRole('radiogroup', { name: 'How often?' });

beforeEach(() => {
  vi.clearAllMocks();
  mutateCreate.mockResolvedValue({ id: 'new', as_needed: true });
});
afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('creating: Repeat -> As needed', () => {
  it('offers "When needed" on a NEW medication, last of the How often? tiles (never inside Custom)', async () => {
    const user = userEvent.setup();
    renderCreate();
    const labels = within(howOften())
      .getAllByRole('radio')
      .map((r) => r.textContent);
    expect(labels).toEqual(['Every day', 'Every week', 'When needed']);
    await user.click(screen.getByTestId('repeat-custom'));
    expect(within(screen.getByTestId('repeat-custom-panel')).queryByRole('radio', { name: 'When needed' })).toBeNull();
  });

  it('once chosen, When needed is lit and the reason field is described by the hint (EN)', async () => {
    const user = userEvent.setup();
    renderCreate();
    expect(within(howOften()).getByRole('radio', { name: 'Every day' })).toBeChecked();
    expect(screen.queryByText(REPEAT_HINT)).toBeNull();
    await chooseAsNeeded(user);
    expect(within(howOften()).getByRole('radio', { name: 'When needed' })).toBeChecked();
    expect(screen.getByLabelText(/What is it for\?/)).toHaveAccessibleDescription(REPEAT_HINT);
    expect(screen.getByText(REPEAT_HINT)).toBeVisible();
  });

  it.each(['medication', 'appointment', 'task'] as const)(
    'the %s form has a VISIBLE "How often?" question with its tiles',
    (initialType) => {
      render(<AddEventModal circleId={CIRCLE_ID} initialType={initialType} onClose={onClose} />);
      const group = screen.getByRole('radiogroup', { name: 'How often?' });
      expect(group).toBeVisible();
      expect(within(group).getAllByRole('radio').length).toBeGreaterThanOrEqual(2);
      expect(screen.getByTestId(initialType === 'task' ? 'task-repeat-custom' : 'repeat-custom')).toBeVisible();
    }
  );

  it('does not offer "When needed" for an appointment or task', async () => {
    for (const initialType of ['appointment', 'task'] as const) {
      const view = render(<AddEventModal circleId={CIRCLE_ID} initialType={initialType} onClose={onClose} />);
      expect(within(howOften()).queryByRole('radio', { name: 'When needed' })).toBeNull();
      view.unmount();
    }
  });

  it('hides date, time, presets, end date and reminders; shows the reason and the "no reminders" note', async () => {
    const user = userEvent.setup();
    renderCreate();
    expect(screen.getByLabelText(/^Starts/)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Common dose times' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Repeats until/)).toBeInTheDocument();
    expect(screen.getByTestId('reminders-summary-row')).toBeInTheDocument();

    await chooseAsNeeded(user);

    expect(screen.queryByLabelText(/^Starts/)).toBeNull();
    expect(screen.queryByLabelText(/^Repeats until/)).toBeNull();
    expect(screen.queryByRole('group', { name: 'Common dose times' })).toBeNull();
    expect(screen.queryByLabelText('Other time', { selector: 'input' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'What time?' })).toBeNull();
    expect(screen.queryByTestId('reminders-summary-row')).toBeNull();
    expect(screen.queryByLabelText(/End date/i)).toBeNull();
    expect(screen.queryByText(/^Reminders$/)).toBeNull();
    expect(screen.getByTestId('as-needed-no-reminders')).toHaveTextContent(
      "No reminders. As-needed medications don't have a schedule."
    );
    expect(screen.getByLabelText(/What is it for\?/)).toBeInTheDocument();
    // No limit fields, ever.
    expect(screen.queryByLabelText(/minimum|maximum|interval/i)).toBeNull();
  });

  it('saves as_needed:true + the trimmed reason, and NONE of the schedule', async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.type(screen.getByLabelText(/Medication name/i), 'Ibuprofen');
    await user.type(screen.getByLabelText(/Dosage/i), '200 mg');
    await chooseAsNeeded(user);
    await user.type(screen.getByLabelText(/What is it for\?/), '  pain  ');
    fireEvent.click(saveButton());

    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
    const data = mutateCreate.mock.calls[0][0];
    expect(data.as_needed).toBe(true);
    expect(data.as_needed_reason).toBe('pain');
    expect(data.event_type).toBe('medication');
    expect(data.medication_name).toBe('Ibuprofen');
    for (const k of [
      'scheduled_time',
      'recurrence_rule',
      'recurrence_days',
      'recurrence_end_date',
      'duration_minutes',
      'reminder_at_due',
      'reminder_24h',
      'reminder_1h',
      'reminder_30m',
      'reminder_15m',
    ]) {
      expect(k in data, k).toBe(false);
    }
    // "Added on" is the recipient's today (the server also pins it).
    expect(data.scheduled_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('an empty reason is simply omitted', async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.type(screen.getByLabelText(/Medication name/i), 'Ibuprofen');
    await chooseAsNeeded(user);
    fireEvent.click(saveButton());
    await waitFor(() => expect(mutateCreate).toHaveBeenCalled());
    expect('as_needed_reason' in mutateCreate.mock.calls[0][0]).toBe(false);
  });

  it('the reason field is capped at 100 characters', async () => {
    const user = userEvent.setup();
    renderCreate();
    await chooseAsNeeded(user);
    expect(screen.getByLabelText(/What is it for\?/)).toHaveAttribute('maxlength', '100');
  });

  it('a medication needs no time once it is as needed (no "time required" error)', async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.type(screen.getByLabelText(/Medication name/i), 'Ibuprofen');
    await chooseAsNeeded(user);
    fireEvent.click(saveButton());
    await waitFor(() => expect(mutateCreate).toHaveBeenCalled());
    expect(screen.queryByText(/time/i, { selector: '[role="alert"], .text-terracotta' })).toBeNull();
  });

  it('OLD-BACKEND GUARD: a create that comes back without as_needed is deleted and explained', async () => {
    mutateCreate.mockResolvedValue({ id: 'ghost', as_needed: undefined });
    deleteEventRequest.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderCreate();
    await user.type(screen.getByLabelText(/Medication name/i), 'Ibuprofen');
    await chooseAsNeeded(user);
    fireEvent.click(saveButton());

    await waitFor(() => expect(deleteEventRequest).toHaveBeenCalledWith(CIRCLE_ID, 'ghost'));
    expect(showToast).toHaveBeenCalledWith(
      "Couldn't add an as-needed medication yet — please update the app and try again.",
      'error'
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ANALYTICS: a successful as-needed create reports source "form" + has_reason (no name, no reason text)', async () => {
    const created = vi.spyOn(Analytics, 'asNeededMedicationCreated').mockImplementation(() => {});
    const user = userEvent.setup();
    renderCreate();
    await user.type(screen.getByLabelText(/Medication name/i), 'Ibuprofen');
    await chooseAsNeeded(user);
    await user.type(screen.getByLabelText(/What is it for\?/), 'pain');
    fireEvent.click(saveButton());
    await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
    expect(created).toHaveBeenCalledWith({ source: 'form', has_reason: true });
    created.mockRestore();
  });

  it('ANALYTICS: no reason -> has_reason false', async () => {
    const created = vi.spyOn(Analytics, 'asNeededMedicationCreated').mockImplementation(() => {});
    const user = userEvent.setup();
    renderCreate();
    await user.type(screen.getByLabelText(/Medication name/i), 'Ibuprofen');
    await chooseAsNeeded(user);
    fireEvent.click(saveButton());
    await waitFor(() => expect(created).toHaveBeenCalledWith({ source: 'form', has_reason: false }));
    created.mockRestore();
  });

  it('ANALYTICS: the old-backend guard failure reports NOTHING', async () => {
    const created = vi.spyOn(Analytics, 'asNeededMedicationCreated').mockImplementation(() => {});
    mutateCreate.mockResolvedValue({ id: 'ghost', as_needed: undefined });
    deleteEventRequest.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderCreate();
    await user.type(screen.getByLabelText(/Medication name/i), 'Ibuprofen');
    await chooseAsNeeded(user);
    fireEvent.click(saveButton());
    await waitFor(() => expect(deleteEventRequest).toHaveBeenCalled());
    expect(created).not.toHaveBeenCalled();
    created.mockRestore();
  });

  it('a normal create does not delete anything', async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.type(screen.getByLabelText(/Medication name/i), 'Ibuprofen');
    await chooseAsNeeded(user);
    fireEvent.click(saveButton());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(deleteEventRequest).not.toHaveBeenCalled();
  });

  it('Spanish: "Según se necesite" and the Spanish helper copy', async () => {
    await i18n.changeLanguage('es');
    const user = userEvent.setup();
    renderCreate();
    await user.click(screen.getByRole('radio', { name: 'Cuando se necesite' }));
    expect(screen.getByTestId('as-needed-no-reminders')).toHaveTextContent(
      'Sin recordatorios. Los medicamentos según se necesite no tienen horario.'
    );
    expect(screen.getByLabelText(/¿Para qué es\?/)).toBeInTheDocument();
    expect(screen.getByLabelText(/¿Para qué es\?/)).toHaveAccessibleDescription(
      'Sin horarios fijos. Todo el círculo recibe un aviso cuando alguien registra una dosis.'
    );
  });
});

describe('editing: LOCKED after create', () => {
  it('a PRN medication shows How often? READ-ONLY (When needed lit, all disabled), reason editable, schedule fields absent', () => {
    render(<AddEventModal circleId={CIRCLE_ID} event={prnEvent()} onClose={onClose} />);
    expect(screen.queryByLabelText('Repeat', { selector: 'select' })).toBeNull();
    const needed = screen.getByRole('radio', { name: 'When needed' });
    expect(needed).toHaveAttribute('aria-checked', 'true');
    expect(needed).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Every day' })).toBeDisabled();
    expect(screen.getByTestId('repeat-custom')).toBeDisabled();
    expect(screen.getByTestId('as-needed-locked-how-often')).toHaveTextContent(
      "As needed · can't be changed. To put this medication on a schedule, discontinue it and add it again."
    );
    expect(screen.getByLabelText(/What is it for\?/)).toHaveValue('pain');
    expect(screen.queryByLabelText(/^Time/)).toBeNull();
    expect(screen.queryByLabelText(/^Date/)).toBeNull();
  });

  it('saving a PRN edit PATCHes the reason only: no as_needed flip, no schedule, null clears', async () => {
    mutateUpdate.mockResolvedValue({});
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} event={prnEvent()} onClose={onClose} />);
    await user.clear(screen.getByLabelText(/What is it for\?/));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    const { eventId, data } = mutateUpdate.mock.calls[0][0];
    expect(eventId).toBe('prn-1');
    expect(data.as_needed_reason).toBeNull();
    expect('as_needed' in data).toBe(false);
    for (const k of ['scheduled_time', 'recurrence_rule', 'recurrence_end_date', 'recurrence_days']) {
      expect(k in data, k).toBe(false);
    }
  });

  it('a SCHEDULED medication never lists "As needed" when edited', () => {
    render(
      <AddEventModal
        circleId={CIRCLE_ID}
        event={{
          ...prnEvent(),
          as_needed: false,
          as_needed_reason: null,
          scheduled_time: '08:00:00',
          recurrence_rule: 'daily',
        }}
        onClose={onClose}
      />
    );
    expect(screen.queryByRole('radio', { name: 'When needed' })).toBeNull();
    expect(screen.queryByLabelText('Repeat', { selector: 'select' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Every day' })).toHaveAttribute('aria-checked', 'true');
  });
});
