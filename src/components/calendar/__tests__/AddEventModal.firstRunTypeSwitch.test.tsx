import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { Analytics } from '@/lib/analytics';
import { resetLargeTextReports } from '@/lib/largeText';
import { queryClient } from '@/lib/queryClient';
import { searchDrugs } from '@/api/drugs';
import { AddEventModal } from '../AddEventModal';

// First run v2 (1.4.3): the first-item TYPE SWITCH (Medication · Appointment · Task) and its times.
// Owner 2026-11-22: NO new item opens with a time selected (medication since 2026-11-21; the appointment /
// task 9:00 AM default is gone). The user always picks the time. Positive and negative cases, named.

const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'America/New_York';
});
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const RECIPIENT_TZ = 'America/New_York';
const CIRCLE_ID = 'circle-1';
/** 16:00 in New York on 2026-09-01 (the old 9:00 default had passed: it used to roll to TOMORROW). */
const AFTERNOON = new Date('2026-09-01T20:00:00Z');
/** 07:00 in New York on 2026-09-01. */
const MORNING = new Date('2026-09-01T11:00:00Z');
const NOW = AFTERNOON;
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

describe('first run v2: time defaults', { timeout: 20_000 }, () => {
  it('POSITIVE (owner 2026-11-21: no preselected time on a new medication): the medication opens with NO chip lit and saves at 8:00 AM once the person picks Morning', async () => {
    const onFirstRunItemSaved = vi.fn();
    renderForm({ firstRun: true, firstRunTypeSwitch: true, onFirstRunItemSaved });
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Morning/ })).toBeInTheDocument());
    for (const chip of screen.getAllByRole('checkbox')) expect(chip).not.toBeChecked();
    await user().type(screen.getByRole('combobox', { name: /^Medication name/ }), 'Metformin');
    await user().click(screen.getByRole('checkbox', { name: /Morning/ }));
    await user().click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalled(), { timeout: 5000 });
    expect(mutateCreate).toHaveBeenCalledTimes(1);
    expect(mutateCreate.mock.calls[0][0]).toMatchObject({ scheduled_time: '08:00' });
    await waitFor(() => expect(onFirstRunItemSaved).toHaveBeenCalled());
    expect(onFirstRunItemSaved.mock.calls[0][0]).toMatchObject({ type: 'medication', recipientTime: '08:00' });
    // No default exists on a medication, so it is never "kept".
    expect(firstRunSaved).toHaveBeenCalledWith(expect.objectContaining({ firstItemType: 'medication', timeDefaultKept: false, hasTime: true }));
  });

  it('NEGATIVE (owner 2026-11-21): a medication with no time picked saves nothing and says a time is needed', async () => {
    renderForm({ firstRun: true, firstRunTypeSwitch: true });
    await user().type(screen.getByRole('combobox', { name: /^Medication name/ }), 'Metformin');
    await user().click(screen.getByTestId('add-event-save'));
    expect(await screen.findByText('Medications need a scheduled time.')).toBeInTheDocument();
    expect(mutateCreate).not.toHaveBeenCalled();
    expect(firstRunSaved).not.toHaveBeenCalled();
  });

  /** The From / At tile's hidden native time input (recipient clock), as the picker sheet fills it. */
  function pickTime(value: string): void {
    fireEvent.change(document.getElementById('scheduled_time') as HTMLInputElement, { target: { value } });
  }

  it('NEGATIVE (owner 2026-11-22): the type switch never seeds a time: medication -> appointment -> task -> medication, nothing is ever picked', async () => {
    vi.setSystemTime(MORNING);
    renderForm({ firstRun: true, firstRunTypeSwitch: true });
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Morning/ })).not.toBeChecked());
    await switchTo('Appointment');
    expect(await screen.findByTestId('appt-from-tile')).toHaveTextContent('Choose a time');
    expect(document.getElementById('scheduled_time')).toHaveValue('');
    // A time picked on the appointment tab is NOT carried to the task tab (each tab is a fresh form).
    pickTime('10:30');
    expect(screen.getByTestId('appt-from-tile')).toHaveTextContent('10:30 AM');
    await switchTo('Task');
    expect(await screen.findByTestId('task-from-tile')).toHaveTextContent('Choose a time');
    expect(document.getElementById('scheduled_time')).toHaveValue('');
    await switchTo('Medication');
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Morning/ })).toBeInTheDocument());
    for (const chip of screen.getAllByRole('checkbox')) expect(chip).not.toBeChecked();
    expect(screen.getByLabelText('Other time', { selector: 'input' })).toHaveValue('');
    expect(mutateCreate).not.toHaveBeenCalled();
  });

  for (const kind of ['Appointment', 'Task'] as const) {
    const prefix = kind === 'Appointment' ? 'appt' : 'task';
    for (const [when, now] of [['morning', MORNING], ['afternoon', AFTERNOON]] as const) {
      it(`POSITIVE (owner 2026-11-22): a first-run ${kind.toLowerCase()} opens on "Pick a time" with NO time and TODAY (recipient zone), ${when}`, async () => {
        vi.setSystemTime(now);
        renderForm({ firstRun: true, firstRunTypeSwitch: true });
        await switchTo(kind);
        expect(await screen.findByRole('radio', { name: 'Pick a time' })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByTestId(`${prefix}-from-tile`)).toHaveTextContent('Choose a time');
        expect(screen.getByTestId(`${prefix}-from-tile`)).not.toHaveTextContent('9:00');
        expect(document.getElementById('scheduled_time')).toHaveValue('');
        // The day is the form's normal default: the recipient's today (never rolled to tomorrow).
        expect(document.getElementById('scheduled_date')).toHaveValue(TODAY);
      });
    }

    it(`POSITIVE: a first-run ${kind.toLowerCase()} with ONE picked time saves exactly ONE item at that time, today`, async () => {
      vi.setSystemTime(AFTERNOON);
      const onFirstRunItemSaved = vi.fn();
      renderForm({ firstRun: true, firstRunTypeSwitch: true, onFirstRunItemSaved });
      await switchTo(kind);
      await screen.findByTestId(`${prefix}-from-tile`);
      await user().type(document.getElementById('title') as HTMLElement, 'Call pharmacy');
      pickTime('17:30');
      await user().click(screen.getByTestId('add-event-save'));
      await waitFor(() => expect(mutateCreate).toHaveBeenCalled(), { timeout: 5000 });
      await waitFor(() => expect(firstRunSaved).toHaveBeenCalled());
      expect(mutateCreate).toHaveBeenCalledTimes(1);
      expect(mutateCreate.mock.calls[0][0]).toMatchObject({
        event_type: kind.toLowerCase(),
        scheduled_date: TODAY,
        scheduled_time: '17:30',
      });
      // No default exists any more: never "kept"; the shape stays stable (mobile parity).
      expect(firstRunSaved).toHaveBeenCalledWith(
        expect.objectContaining({ firstItemType: kind.toLowerCase(), timeDefaultKept: false, hasTime: true })
      );
      expect(onFirstRunItemSaved.mock.calls[0][0]).toMatchObject({ type: kind.toLowerCase(), recipientTime: '17:30' });
    });

    it(`NEGATIVE: a first-run ${kind.toLowerCase()} saved with "Pick a time" and no time creates nothing and shows the time error`, async () => {
      renderForm({ firstRun: true, firstRunTypeSwitch: true });
      await switchTo(kind);
      await screen.findByTestId(`${prefix}-from-tile`);
      await user().type(document.getElementById('title') as HTMLElement, 'Call pharmacy');
      await user().click(screen.getByTestId('add-event-save'));
      // Neutral copy (owner 2026-11-22), never the medication sentence.
      expect(await screen.findByText('Pick a time.')).toBeInTheDocument();
      expect(screen.queryByText('Medications need a scheduled time.')).toBeNull();
      // Enter in the title submits the form directly: the payload check refuses it too.
      fireEvent.submit(document.getElementById('add-event-form') as HTMLFormElement);
      await new Promise((r) => setTimeout(r, 50));
      expect(mutateCreate).not.toHaveBeenCalled();
      expect(firstRunSaved).not.toHaveBeenCalled();
    });
  }

  it('NEGATIVE: an appointment switched to "Any time" saves with no time and reports has_time false', async () => {
    const onFirstRunItemSaved = vi.fn();
    renderForm({ firstRun: true, firstRunTypeSwitch: true, onFirstRunItemSaved });
    await switchTo('Appointment');
    await user().click(await screen.findByRole('radio', { name: 'Any time' }));
    await user().type(document.getElementById('title') as HTMLElement, 'Doctor visit');
    await user().click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalled(), { timeout: 5000 });
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
    await user().click(screen.getByRole('checkbox', { name: /Morning/ }));
    await user().click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(firstRunSaved).toHaveBeenCalled());
    expect(JSON.stringify(firstRunSaved.mock.calls[0][0])).not.toContain('Metformin');
  });
});

describe('first run v2: leaving the first-item form', () => {
  it('a11y POSITIVE: the dialog opens on the name field, not on the x', async () => {
    renderForm({ firstRun: true, firstRunTypeSwitch: true });
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /^Medication name/ })).toHaveFocus()
    );
  });

  it('NEGATIVE: Escape on a form with a typed name asks "Discard changes?" and does NOT close', async () => {
    const { onClose } = renderForm({ firstRun: true, firstRunTypeSwitch: true });
    await user().type(screen.getByRole('combobox', { name: /^Medication name/ }), 'Metformin');
    fireEvent.keyDown(screen.getByRole('combobox', { name: /^Medication name/ }), { key: 'Escape' });
    // A first Escape may only close the suggestion list; a second reaches the dialog.
    if (!screen.queryByRole('alertdialog') && !screen.queryByText('Discard changes?')) {
      fireEvent.keyDown(screen.getByRole('combobox', { name: /^Medication name/ }), { key: 'Escape' });
    }
    expect(await screen.findByText('Discard changes?')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    // The dialog's x shares the Keep editing name; the footer button is the last one.
    const keep = screen.getAllByRole('button', { name: 'Keep editing' });
    await user().click(keep[keep.length - 1]);
    expect(screen.queryByText('Discard changes?')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox', { name: /^Medication name/ })).toHaveValue('Metformin');
  });

  it('POSITIVE: the x on a dirty form, then Discard, closes (as a skip)', async () => {
    const { onClose } = renderForm({ firstRun: true, firstRunTypeSwitch: true });
    await user().type(screen.getByLabelText(/^Dosage/), '500 mg');
    await user().click(screen.getByRole('button', { name: 'Close event form' }));
    expect(await screen.findByText('Discard changes?')).toBeInTheDocument();
    await user().click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('POSITIVE: a clean form closes at once on the x (no confirm), even after switching type', async () => {
    const { onClose } = renderForm({ firstRun: true, firstRunTypeSwitch: true });
    await switchTo('Appointment');
    await user().click(screen.getByRole('button', { name: 'Close event form' }));
    expect(screen.queryByText('Discard changes?')).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('NEGATIVE: outside first run the x never asks (unchanged behaviour)', async () => {
    const { onClose } = renderForm();
    await user().type(screen.getByRole('combobox', { name: /^Medication name/ }), 'Metformin');
    await user().click(screen.getByRole('button', { name: 'Close event form' }));
    expect(screen.queryByText('Discard changes?')).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('POSITIVE: "Skip for now" is an explicit choice and closes without a confirm', async () => {
    const { onClose } = renderForm({ firstRun: true, firstRunTypeSwitch: true });
    await user().type(screen.getByRole('combobox', { name: /^Medication name/ }), 'Metformin');
    await user().click(screen.getByTestId('first-run-skip'));
    expect(screen.queryByText('Discard changes?')).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
