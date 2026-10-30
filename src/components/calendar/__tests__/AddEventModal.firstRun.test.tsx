import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { Analytics } from '@/lib/analytics';
import { resetLargeTextReports } from '@/lib/largeText';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { readFirstMedNote } from '@/lib/firstMedNote';
import { searchDrugs } from '@/api/drugs';
import { AddEventModal } from '../AddEventModal';

// Onboarding 1.3.1: the simple medication form in FIRST-RUN MODE (heading, hint, Skip for now,
// what it hands back on save), the med_name_suggestion_outcome event, and the Today "Mark it"
// note the add-menu path writes. The form's payload/validation have their own suites.

const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'America/New_York';
});
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const RECIPIENT_TZ = 'America/New_York';
const CIRCLE_ID = 'circle-1';
/** 16:00 in New York on 2026-09-01: the Morning chip (8:00 AM) is already past. */
const NOW = new Date('2026-09-01T20:00:00Z');
const TODAY = '2026-09-01';

const mutateCreate = vi.fn();
vi.mock('../DoseQuietHoursNote', () => ({ DoseQuietHoursNote: () => null }));
vi.mock('@/api/drugs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/drugs')>();
  return { ...actual, searchDrugs: vi.fn().mockResolvedValue([]) };
});
vi.mock('@/hooks/useProviders', () => ({ useProviders: () => ({ providers: [], isSuccess: true }) }));
vi.mock('@/hooks/useCalendarEvents', () => ({
  useCreateEvent: () => ({ mutateAsync: mutateCreate, isPending: false }),
  useUpdateEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCachedCircleEvents: () => [],
}));
vi.mock('@/hooks/useSeriesRoot', () => ({
  useSeriesRoot: (_c: string, event: unknown) => ({ root: event ?? null }),
}));
const useCircleResult = {
  circle: { recipient_name: 'Rosa', is_self_care: false } as
    | { recipient_name?: string; is_self_care?: boolean }
    | undefined,
  circleSummary: undefined,
  timezone: RECIPIENT_TZ,
  members: [] as never[],
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
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast: vi.fn() }) };
});

let outcome: ReturnType<typeof vi.spyOn>;
let firstRunSaved: ReturnType<typeof vi.spyOn>;
let created: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  resetLargeTextReports();
  window.localStorage.clear();
  queryClient.clear();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  useCircleResult.circle = { recipient_name: 'Rosa', is_self_care: false };
  mutateCreate.mockResolvedValue({ id: 'ev-1', scheduled_date: '2026-09-02' });
  vi.mocked(searchDrugs).mockResolvedValue([]);
  outcome = vi.spyOn(Analytics, 'medNameSuggestionOutcome').mockImplementation(() => {});
  firstRunSaved = vi.spyOn(Analytics, 'firstRunMedicationSaved').mockImplementation(() => {});
  created = vi.spyOn(Analytics, 'medicationCreated').mockImplementation(() => {});
  vi.spyOn(Analytics, 'entryFormOpened').mockImplementation(() => {});
  vi.spyOn(Analytics, 'entryFormStepCompleted').mockImplementation(() => {});
  vi.spyOn(Analytics, 'timeChipSelected').mockImplementation(() => {});
  vi.spyOn(Analytics, 'entrySaveTapped').mockImplementation(() => {});
  vi.spyOn(Analytics, 'largeTextLayout').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function renderForm(props: Partial<React.ComponentProps<typeof AddEventModal>> = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <AddEventModal
      circleId={CIRCLE_ID}
      initialType="medication"
      onClose={onClose}
      onSaved={onSaved}
      {...props}
    />
  );
  return { onClose, onSaved };
}

const user = () => userEvent.setup();

async function fillAndSave(u: ReturnType<typeof userEvent.setup>, name = 'Metformin') {
  await u.type(screen.getByRole('combobox', { name: /^Medication name/ }), name);
  await u.click(screen.getByRole('radio', { name: /Morning/ }));
  await u.click(screen.getByTestId('add-event-save'));
}

describe('first-run mode', () => {
  it('is headed by the first-med eyebrow, the big question and the hint; Skip for now replaces Cancel', () => {
    renderForm({ firstRun: true });
    expect(screen.getByText("ROSA'S FIRST MED")).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What does Rosa take?' })).toBeInTheDocument();
    expect(
      screen.getByText('Just the name, the big word on the bottle. Dose is optional.')
    ).toBeInTheDocument();
    expect(screen.getByTestId('first-run-skip')).toHaveTextContent('Skip for now');
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    // It IS the real simple form: the same Save, chips and How often.
    expect(screen.getByTestId('add-event-save')).toHaveTextContent('Add medication');
    expect(screen.getByRole('radiogroup', { name: 'Common dose times' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How often?' })).toBeInTheDocument();
  });

  it('self-care: "YOUR FIRST MED" / "What do you take?"', () => {
    useCircleResult.circle = { recipient_name: 'Rosa', is_self_care: true };
    renderForm({ firstRun: true });
    expect(screen.getByText('YOUR FIRST MED')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What do you take?' })).toBeInTheDocument();
  });

  it('outside first-run mode there is no first-med heading and the footer says Cancel', () => {
    renderForm();
    expect(screen.queryByTestId('first-run-form-heading')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByText('Skip for now')).toBeNull();
  });

  it('Skip for now closes without saving', async () => {
    const { onClose, onSaved } = renderForm({ firstRun: true });
    await user().click(screen.getByTestId('first-run-skip'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    expect(mutateCreate).not.toHaveBeenCalled();
  });

  it('save hands back what saved (root id, rolled start, wire doses) and fires the first-run events', async () => {
    const { onClose, onSaved } = renderForm({ firstRun: true });
    const u = user();
    await u.type(screen.getByLabelText(/^Dosage/), '500mg');
    await fillAndSave(u);

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSaved.mock.calls[0][0]).toMatchObject({
      eventId: 'ev-1',
      name: 'Metformin',
      dosage: '500mg',
      timezone: RECIPIENT_TZ,
      recurrenceRule: 'daily',
      startsNextDose: true,
      startDate: '2026-09-02',
      today: TODAY,
      doses: [{ scheduledDate: TODAY, scheduledTime: '08:00' }],
    });
    // Enums, a boolean and a count only: never the name.
    expect(firstRunSaved).toHaveBeenCalledWith({
      circleId: CIRCLE_ID,
      preset: 'morning',
      recurrence: 'daily',
      dosageFilled: true,
      doseCount: 1,
    });
    expect(created).toHaveBeenCalledWith(CIRCLE_ID, true, 'wizard', true);
  });

  it('a typed time reports preset other', async () => {
    renderForm({ firstRun: true });
    const u = user();
    await u.type(screen.getByRole('combobox', { name: /^Medication name/ }), 'Metformin');
    await u.click(screen.getByRole('button', { name: 'Other time' }));
    await u.type(screen.getByLabelText(/^Time/), '09:30');
    await u.click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(firstRunSaved).toHaveBeenCalled());
    expect(firstRunSaved.mock.calls[0][0]).toMatchObject({ preset: 'other' });
  });

  it('the first-run event does NOT fire outside first-run mode', async () => {
    const { onSaved } = renderForm();
    await fillAndSave(user());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(firstRunSaved).not.toHaveBeenCalled();
    expect(created).toHaveBeenCalledWith(CIRCLE_ID, true, 'form', true);
  });
});

describe('med_name_suggestion_outcome', () => {
  it('typed: a name typed with no suggestion', async () => {
    renderForm();
    await fillAndSave(user());
    await waitFor(() => expect(outcome).toHaveBeenCalledTimes(1));
    expect(outcome).toHaveBeenCalledWith('typed');
  });

  it('suggestion: a picked drug', async () => {
    vi.mocked(searchDrugs).mockResolvedValue([
      { rxcui: '6809', name: 'Metformin', strength: null, dosageForm: null },
    ]);
    renderForm();
    const u = user();
    await u.type(screen.getByRole('combobox', { name: /^Medication name/ }), 'Met');
    await u.click(await screen.findByRole('option', { name: 'Metformin' }));
    await u.click(screen.getByRole('radio', { name: /Morning/ }));
    await u.click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(outcome).toHaveBeenCalledWith('suggestion'));
  });

  it('as_typed: the "Use as typed" row was chosen', async () => {
    renderForm();
    const u = user();
    await u.type(screen.getByRole('combobox', { name: /^Medication name/ }), 'Doliprane');
    await u.click(await screen.findByTestId('drug-use-as-typed'));
    await u.click(screen.getByRole('radio', { name: /Morning/ }));
    await u.click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(outcome).toHaveBeenCalledWith('as_typed'));
    expect(mutateCreate.mock.calls[0][0]).not.toHaveProperty('rxcui');
  });

  it('editing the name after choosing the row reads as typed again', async () => {
    renderForm();
    const u = user();
    const input = screen.getByRole('combobox', { name: /^Medication name/ });
    await u.type(input, 'Doliprane');
    await u.click(await screen.findByTestId('drug-use-as-typed'));
    await u.type(input, 'X');
    await u.click(screen.getByRole('radio', { name: /Morning/ }));
    await u.click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(outcome).toHaveBeenCalledWith('typed'));
  });

  it('is not fired for an appointment', async () => {
    renderForm({ initialType: 'appointment' });
    expect(outcome).not.toHaveBeenCalled();
  });
});

function cachePresence(medication: boolean): void {
  queryClient.setQueryData(
    queryKeys.calendarEventsPresence(CIRCLE_ID, { start_date: '2026-08-02', end_date: '2027-02-28' }),
    { medication, appointment: false, task: false }
  );
}

describe("Today's Mark it note (add-menu path)", () => {
  it('is written for a FIRST med whose start rolled', async () => {
    cachePresence(false);
    const { onSaved } = renderForm({ entry: 'add_menu' });
    await fillAndSave(user());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(readFirstMedNote(CIRCLE_ID, TODAY)).toEqual({
      eventId: 'ev-1',
      name: 'Metformin',
      dosage: '',
      time: '08:00:00',
      day: TODAY,
      startDate: '2026-09-02',
      marked: false,
    });
  });

  it('is NOT written when the circle already had a medication', async () => {
    cachePresence(true);
    const { onSaved } = renderForm();
    await fillAndSave(user());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(readFirstMedNote(CIRCLE_ID, TODAY)).toBeNull();
  });

  it('is NOT written when whether a medication exists is unknown (cold cache)', async () => {
    const { onSaved } = renderForm();
    await fillAndSave(user());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(readFirstMedNote(CIRCLE_ID, TODAY)).toBeNull();
  });

  it('is NOT written when the start did not roll (server kept today)', async () => {
    cachePresence(false);
    mutateCreate.mockResolvedValue({ id: 'ev-1', scheduled_date: TODAY });
    const { onSaved } = renderForm();
    await fillAndSave(user());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(readFirstMedNote(CIRCLE_ID, TODAY)).toBeNull();
  });

  it('is NOT written in first-run mode (the payoff owns Mark it there)', async () => {
    cachePresence(false);
    const { onSaved } = renderForm({ firstRun: true });
    await fillAndSave(user());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(readFirstMedNote(CIRCLE_ID, TODAY)).toBeNull();
  });
});
