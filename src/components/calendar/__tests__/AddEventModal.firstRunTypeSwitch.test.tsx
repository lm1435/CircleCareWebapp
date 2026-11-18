import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { Analytics } from '@/lib/analytics';
import { resetLargeTextReports } from '@/lib/largeText';
import { queryClient } from '@/lib/queryClient';
import { searchDrugs } from '@/api/drugs';
import { AddEventModal } from '../AddEventModal';

// First run v2 (1.4.3): the first-item TYPE SWITCH (Medication · Appointment · Task) and the locked
// time defaults: 8:00 AM Morning on the medication tab; 9:00 AM on appointment / task, TOMORROW once
// 9:00 has passed on the RECIPIENT's clock. Positive and negative cases, named.

const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'America/New_York';
});
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const RECIPIENT_TZ = 'America/New_York';
const CIRCLE_ID = 'circle-1';
/** 16:00 in New York on 2026-09-01: 9:00 AM has passed there. */
const AFTERNOON = new Date('2026-09-01T20:00:00Z');
/** 07:00 in New York on 2026-09-01: 9:00 AM is still ahead. */
const MORNING = new Date('2026-09-01T11:00:00Z');
const NOW = AFTERNOON;
const TODAY = '2026-09-01';
const TOMORROW = '2026-09-02';

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

let firstRunSaved: ReturnType<typeof vi.spyOn>;
let switched: ReturnType<typeof vi.spyOn>;


beforeEach(() => {
  vi.clearAllMocks();
  resetLargeTextReports();
  window.localStorage.clear();
  queryClient.clear();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  useCircleResult.circle = { recipient_name: 'Rosa', is_self_care: false };
  mutateCreate.mockResolvedValue({ id: 'ev-1', scheduled_date: '2026-09-02' });
  vi.mocked(searchDrugs).mockResolvedValue([]);
  vi.spyOn(Analytics, 'medNameSuggestionOutcome').mockImplementation(() => {});
  switched = vi.spyOn(Analytics, 'firstRunTypeSwitched').mockImplementation(() => {});
  firstRunSaved = vi.spyOn(Analytics, 'firstRunMedicationSaved').mockImplementation(() => {});
  vi.spyOn(Analytics, 'medicationCreated').mockImplementation(() => {});
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

async function switchTo(name: 'Appointment' | 'Task' | 'Medication') {
  await user().click(screen.getByRole('tab', { name }));
}

describe('first run v2: the type switch', () => {
  it('POSITIVE: opens on Medication with the switch visible (three tabs, no Shift)', () => {
    renderForm({ firstRun: true, firstRunTypeSwitch: true });
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Medication', 'Appointment', 'Task']);
    expect(screen.getByRole('tab', { name: 'Medication' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText("ROSA'S FIRST MED")).toBeInTheDocument();
  });

  it('NEGATIVE: no Shift option in first run', () => {
    renderForm({ firstRun: true, firstRunTypeSwitch: true });
    expect(screen.queryByRole('tab', { name: /Shift/ })).not.toBeInTheDocument();
  });

  it('NEGATIVE: outside first run there is no type switch (one form per type)', () => {
    renderForm();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('POSITIVE: switching reports first_run_type_switched with enums only', async () => {
    renderForm({ firstRun: true, firstRunTypeSwitch: true });
    await switchTo('Appointment');
    expect(switched).toHaveBeenCalledWith('medication', 'appointment', CIRCLE_ID);
    await switchTo('Task');
    expect(switched).toHaveBeenLastCalledWith('appointment', 'task', CIRCLE_ID);
  });

  it('a11y: an arrow-key switch keeps focus on the chosen tab (the form remounts under it)', async () => {
    renderForm({ firstRun: true, firstRunTypeSwitch: true });
    screen.getByRole('tab', { name: 'Medication' }).focus();
    await user().keyboard('{ArrowRight}');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Appointment' })).toHaveAttribute('aria-selected', 'true'));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Appointment' })).toHaveFocus());
  });

  it('POSITIVE: appointment and task keep their own titles (no first-med header)', async () => {
    renderForm({ firstRun: true, firstRunTypeSwitch: true });
    await switchTo('Appointment');
    expect(screen.queryByText("ROSA'S FIRST MED")).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'New appointment' })).toBeInTheDocument();
  });
});

describe('first run v2: time defaults', () => {
  it('POSITIVE: the medication saves at 8:00 AM when the time is not touched', async () => {
    const onFirstRunItemSaved = vi.fn();
    renderForm({ firstRun: true, firstRunTypeSwitch: true, onFirstRunItemSaved });
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Morning/ })).toBeChecked());
    await user().type(screen.getByRole('combobox', { name: /^Medication name/ }), 'Metformin');
    await user().click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalled());
    expect(mutateCreate.mock.calls[0][0]).toMatchObject({ scheduled_time: '08:00' });
    await waitFor(() => expect(onFirstRunItemSaved).toHaveBeenCalled());
    expect(onFirstRunItemSaved.mock.calls[0][0]).toMatchObject({ type: 'medication', recipientTime: '08:00' });
  });

  it('POSITIVE: an appointment opens on "Pick a time" at 9:00 AM TODAY while 9:00 is still ahead', async () => {
    vi.setSystemTime(MORNING);
    renderForm({ firstRun: true, firstRunTypeSwitch: true });
    await switchTo('Appointment');
    expect(await screen.findByRole('radio', { name: 'Pick a time' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('appt-from-tile')).toHaveTextContent('9:00 AM');
    await user().type(document.getElementById('title') as HTMLElement, 'Doctor visit');
    await user().click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalled());
    expect(mutateCreate.mock.calls[0][0]).toMatchObject({
      event_type: 'appointment',
      scheduled_date: TODAY,
      scheduled_time: '09:00',
    });
    expect(firstRunSaved).toHaveBeenCalledWith(
      expect.objectContaining({ firstItemType: 'appointment', timeDefaultKept: true, hasTime: true })
    );
  });

  it('NEGATIVE: once 9:00 AM has passed on the recipient\'s clock, a task opens on 9:00 AM TOMORROW, never a past time', async () => {
    vi.setSystemTime(AFTERNOON);
    renderForm({ firstRun: true, firstRunTypeSwitch: true });
    await switchTo('Task');
    expect(await screen.findByTestId('task-from-tile')).toHaveTextContent('9:00 AM');
    await user().type(document.getElementById('title') as HTMLElement, 'Call pharmacy');
    await user().click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalled());
    expect(mutateCreate.mock.calls[0][0]).toMatchObject({
      event_type: 'task',
      scheduled_date: TOMORROW,
      scheduled_time: '09:00',
    });
  });

  it('NEGATIVE: an appointment switched to "Any time" saves with no time and reports has_time false', async () => {
    const onFirstRunItemSaved = vi.fn();
    renderForm({ firstRun: true, firstRunTypeSwitch: true, onFirstRunItemSaved });
    await switchTo('Appointment');
    await user().click(await screen.findByRole('radio', { name: 'Any time' }));
    await user().type(document.getElementById('title') as HTMLElement, 'Doctor visit');
    await user().click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalled());
    expect(mutateCreate.mock.calls[0][0].scheduled_time ?? null).toBeNull();
    expect(firstRunSaved).toHaveBeenCalledWith(expect.objectContaining({ hasTime: false, timeDefaultKept: false }));
    expect(onFirstRunItemSaved.mock.calls[0][0]).toMatchObject({ type: 'appointment', recipientTime: null });
  });

  it('NEGATIVE: outside first run an appointment still opens on "Any time"', async () => {
    renderForm({ initialType: 'appointment' });
    expect(await screen.findByRole('radio', { name: 'Any time' })).toHaveAttribute('aria-checked', 'true');
  });

  it('NEGATIVE: the item name never reaches the first-run analytics event', async () => {
    renderForm({ firstRun: true, firstRunTypeSwitch: true });
    await user().type(screen.getByRole('combobox', { name: /^Medication name/ }), 'Metformin');
    await user().click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(firstRunSaved).toHaveBeenCalled());
    expect(JSON.stringify(firstRunSaved.mock.calls[0][0])).not.toContain('Metformin');
  });
});
