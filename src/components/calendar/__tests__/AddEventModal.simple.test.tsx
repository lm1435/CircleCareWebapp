import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { Analytics } from '@/lib/analytics';
import { resetLargeTextReports } from '@/lib/largeText';
import { AddEventModal } from '../AddEventModal';

// The simple "New medication" / "New appointment" forms (docs/plans/simple-ui-1-3-1.md; build 11 order,
// owner 2026-11-10): What is it? / When? (Starts | Repeats until, then the How often? grid) / What time? /
// Who's going? / Reminders / More details. Same state and same payload builder as the full form. The payload
// tests below run the SAME answers through both layouts and require identical API bodies.

const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'America/Denver';
});
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const RECIPIENT_TZ = 'America/New_York';
// Real UUIDs: the shared Zod schema rejects other assignee ids.
const ANA_ID = '3f1c2a4e-5b6d-4c7e-8f90-a1b2c3d4e5f6';
const LUIS_ID = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';
const CIRCLE_ID = 'circle-1';

const mutateCreate = vi.fn();
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
  useUpdateEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCachedCircleEvents: () => [],
}));
vi.mock('@/hooks/useSeriesRoot', () => ({
  useSeriesRoot: (_c: string, event: unknown) => ({ root: event ?? null }),
}));
const useCircleResult = {
  circle: undefined as { recipient_name?: string; is_self_care?: boolean } | undefined,
  circleSummary: undefined,
  timezone: RECIPIENT_TZ,
  members: [
    { id: ANA_ID, email: 'ana@example.com', first_name: 'Ana', is_care_recipient: false },
    { id: LUIS_ID, email: 'luis@example.com', first_name: 'Luis', is_care_recipient: false },
  ] as Array<{
    id: string;
    email: string;
    first_name: string | null;
    is_care_recipient: boolean;
  }>,
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
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

let opened: ReturnType<typeof vi.spyOn>;
let stepDone: ReturnType<typeof vi.spyOn>;
let chipSpy: ReturnType<typeof vi.spyOn>;
let medAbandoned: ReturnType<typeof vi.spyOn>;
let apptAbandoned: ReturnType<typeof vi.spyOn>;
let largeText: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  resetLargeTextReports();
  document.documentElement.style.fontSize = '';
  mutateCreate.mockResolvedValue({ id: 'new' });
  opened = vi.spyOn(Analytics, 'entryFormOpened').mockImplementation(() => {});
  stepDone = vi.spyOn(Analytics, 'entryFormStepCompleted').mockImplementation(() => {});
  chipSpy = vi.spyOn(Analytics, 'timeChipSelected').mockImplementation(() => {});
  medAbandoned = vi.spyOn(Analytics, 'medicationFormAbandoned').mockImplementation(() => {});
  apptAbandoned = vi.spyOn(Analytics, 'appointmentFormAbandoned').mockImplementation(() => {});
  largeText = vi.spyOn(Analytics, 'largeTextLayout').mockImplementation(() => {});
  vi.spyOn(Analytics, 'entrySaveTapped').mockImplementation(() => {});
  vi.spyOn(Analytics, 'medicationCreated').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function renderMed(props: Partial<React.ComponentProps<typeof AddEventModal>> = {}) {
  return render(
    <AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} {...props} />
  );
}
function renderAppt(props: Partial<React.ComponentProps<typeof AddEventModal>> = {}) {
  return render(
    <AddEventModal circleId={CIRCLE_ID} initialType="appointment" onClose={vi.fn()} {...props} />
  );
}

// Build 11: TIME-FIRST chips ("8:00 AM" over "Morning"), checkboxes on a new medication (multi-select: each
// further chip is an extra dose, saved as its own row as "+ Another dose" did).
const timeChips = () => screen.getByRole('group', { name: 'Common dose times' });
const title = () => screen.getByLabelText(/^Title( \*)?( \(required\))?$/);
const chip = (name: RegExp) => within(timeChips()).getByRole('checkbox', { name });
/** "Other…": the time picker itself, over the hidden input named "Other time". */
const otherTile = () => screen.getByTestId('time-chip-other');
const otherInput = () => screen.getByLabelText('Other time', { selector: 'input' });

describe('new medication: structure', () => {
  it('shows What is it? / When? / What time?, a collapsed More details and "Add medication"', () => {
    renderMed();
    expect(screen.getByRole('dialog', { name: 'New medication' })).toBeInTheDocument();
    // Build 11: How often? is the grid inside When? (no heading of its own); What time? follows.
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'What is it?',
      'When? *',
      'What time?',
    ]);
    expect(screen.getByRole('radiogroup', { name: 'How often?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /More details/ })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(screen.getByTestId('add-event-save')).toHaveTextContent('Add medication');
    expect(screen.queryByRole('button', { name: 'Create' })).toBeNull();
  });

  it('has the four TIME-FIRST chips (time over day part, tabular numerals), then Other…; no + Another dose tile', async () => {
    const user = userEvent.setup();
    renderMed();
    expect(within(timeChips()).getAllByRole('checkbox')).toHaveLength(4);
    expect(chip(/^8:00 AM\s*Morning$/)).toBeInTheDocument();
    expect(chip(/^12:00 PM\s*Midday$/)).toBeInTheDocument();
    expect(chip(/^6:00 PM\s*Evening$/)).toBeInTheDocument();
    expect(chip(/^9:00 PM\s*Bedtime$/)).toBeInTheDocument();
    const morning = chip(/Morning/);
    expect(morning.firstElementChild).toHaveTextContent('8:00 AM');
    expect(morning.firstElementChild).toHaveClass('tabular-nums');
    expect(morning.lastElementChild).toHaveTextContent('Morning');
    expect(screen.getByRole('button', { name: 'Other…' })).toBe(otherTile());
    expect(screen.queryByTestId('add-another-dose')).toBeNull();
    // Multi-select: a second chip is a second time, both filled; "+ Another dose" never appears.
    await user.click(chip(/Morning/));
    await user.click(chip(/Evening/));
    expect(chip(/Morning/)).toBeChecked();
    expect(chip(/Evening/)).toBeChecked();
    expect(screen.queryByTestId('add-another-dose')).toBeNull();
  });

  it('How often? is the task / shift grid: Every day (default) / Every week / When needed, then Custom…', async () => {
    const user = userEvent.setup();
    renderMed();
    const group = screen.getByRole('radiogroup', { name: 'How often?' });
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual([
      'Every day',
      'Every week',
      'When needed',
    ]);
    expect(within(group).getByRole('radio', { name: 'Every day' })).toBeChecked();
    const custom = screen.getByTestId('repeat-custom');
    expect(custom).toHaveTextContent('Custom…');
    expect(custom).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('repeat-custom-panel')).toBeNull();
    await user.click(custom);
    const panel = within(screen.getByTestId('repeat-custom-panel'));
    // "Once" (a one-off dose) first, then the shared rarer repeats.
    expect(panel.getAllByRole('radio').map((r) => r.textContent)).toEqual([
      'Once',
      'Every other day',
      'Days on / off',
      'Some days',
      'Monthly',
      'Yearly',
    ]);
    await user.click(panel.getByRole('radio', { name: 'Some days' }));
    // The day chips open inline under the grid (no sheet), the start weekday picked.
    expect(screen.getByRole('group', { name: 'Repeat on' })).toBeInTheDocument();
    // While a custom repeat is the answer, Custom… is lit and its options stay open.
    expect(screen.getByTestId('repeat-custom')).toHaveAttribute('aria-expanded', 'true');
  });

  it('When? opens on Starts | Repeats until, then How often?; What time? (chips + Other… in one row) comes after', async () => {
    renderMed();
    const when = screen.getByRole('heading', { name: /^When\?/ }).closest('section') as HTMLElement;
    const tiles = within(when).getByTestId('when-date-tiles');
    expect(within(tiles).getByTestId('starts-tile')).toHaveTextContent(/^Starts/);
    expect(within(tiles).getByTestId('repeats-until-tile')).toHaveTextContent(/^Repeats until\s*Never$/);
    expect(within(when).getByLabelText(/^Starts/)).toHaveAttribute('id', 'scheduled_date');
    const often = within(when).getByRole('radiogroup', { name: 'How often?' });
    expect(tiles.compareDocumentPosition(often) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(when).not.toContainElement(timeChips());
    expect(often.compareDocumentPosition(timeChips()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const row = screen.getByTestId('time-chip-row');
    expect(row).toContainElement(otherTile());
  });

  it('has NO Medication / Appointment / Task type switch', () => {
    renderMed();
    expect(screen.queryByLabelText('Type')).toBeNull();
  });

  it('More details holds the photo, refills, prescription details and instructions (no end date, no start date, no Repeat select; Reminders is the row above)', async () => {
    const user = userEvent.setup();
    renderMed();
    const toggle = screen.getByRole('button', { name: /More details/ });
    // Mobile's addEvent.moreDetailsHint, word for word.
    expect(toggle).toHaveTextContent('Refills, pharmacy, prescriber, instructions');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Instructions')).toBeVisible();
    // The repeat end is the "Repeats until" tile in When? now (build 11), never inside More details.
    const panel = document.getElementById('more-details-panel') as HTMLElement;
    expect(panel).not.toContainElement(screen.getByLabelText(/^Repeats until/));
    expect(screen.queryByLabelText(/^End date/)).toBeNull();
    // The Reminders card is the summary row's accordion now, never inside More details.
    expect(document.getElementById('more-details-panel')).not.toContainElement(
      screen.getByTestId('reminders-fieldset')
    );
    // Mobile's order: photo, Track refills, Prescriber, Pharmacy, Pharmacy phone, Rx number, Instructions.
    const order = [
      screen.getByLabelText('Medication photo'),
      screen.getByRole('checkbox', { name: /Track refills/ }),
      screen.getByLabelText('Prescriber'),
      screen.getByLabelText('Pharmacy'),
      screen.getByLabelText('Pharmacy phone'),
      screen.getByLabelText('Rx number'),
      screen.getByLabelText('Instructions'),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.queryByLabelText(/^Start date/)).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Repeat', hidden: true })).toBeNull();
  });

  it('Other… is the time picker: a non-chip time becomes its own chip ("7:15 AM / Other") and lights no preset', async () => {
    const user = userEvent.setup();
    renderMed();
    expect(screen.queryByTestId('time-chip-custom')).toBeNull();
    await user.click(otherTile());
    expect(otherTile()).toHaveAttribute('aria-expanded', 'true');
    fireEvent.change(otherInput(), { target: { value: '07:15' } });
    for (const box of within(timeChips()).getAllByRole('checkbox')) expect(box).not.toBeChecked();
    // Fix13: the custom chip is not a toggle: a lit box (outside the preset group) holding its own time picker and
    // a "×" that removes the dose.
    const custom = screen.getByTestId('time-chip-custom');
    expect(timeChips()).not.toContainElement(custom);
    expect(custom).toHaveAccessibleName(/^7:15 AM\s*Other$/);
    expect(custom).toHaveAttribute('aria-haspopup', 'dialog');
    const box = screen.getByTestId('time-chip-custom-box');
    expect(box).toHaveClass('rounded-2xl', 'border', 'bg-ink', 'text-cream', 'border-ink');
    expect(custom).toHaveClass('min-h-[48px]');
    expect(within(box).getByRole('button', { name: 'Remove 7:15 AM dose' })).toBeInTheDocument();
    // The same time-first lines as a preset chip.
    expect(Array.from(custom.querySelectorAll('span')).map((sp) => sp.textContent)).toEqual(['7:15 AM', 'Other']);
    // The picker is the RECIPIENT's clock, like the chips (owner 1.4.0): the viewer time that IS 12:00 in
    // New York (10:00 Denver) does NOT light Midday...
    fireEvent.change(otherInput(), { target: { value: '10:00' } });
    expect(chip(/Midday/)).not.toBeChecked();
    // ...and the chip's own time does (it IS that chip, not a second "Other" one).
    fireEvent.change(otherInput(), { target: { value: '12:00' } });
    expect(chip(/Midday/)).toBeChecked();
    expect(screen.queryByTestId('time-chip-custom')).toBeNull();
    expect(otherInput()).toHaveValue('12:00');
  });

  it('Fix13: tapping a custom dose changes ITS time in place (its own picker); a preset still toggles', async () => {
    mutateCreate.mockResolvedValue({ id: 'p' });
    const user = userEvent.setup();
    renderMed();
    await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
    await user.click(chip(/Morning/));
    fireEvent.change(otherInput(), { target: { value: '14:30' } }); // an extra, custom dose
    expect(screen.getByTestId('time-chip-custom')).toHaveAccessibleName(/^2:30 PM\s*Other$/);
    // The chip body is the picker for THAT dose: it opens on its time and a pick moves it, in place.
    await user.click(screen.getByTestId('time-chip-custom'));
    expect(screen.getByTestId('time-chip-custom')).toHaveAttribute('aria-expanded', 'true');
    fireEvent.change(screen.getByLabelText('Change 2:30 PM dose time', { selector: 'input' }), {
      target: { value: '15:00' },
    });
    expect(screen.getAllByTestId('time-chip-custom')).toHaveLength(1);
    expect(screen.getByTestId('time-chip-custom')).toHaveAccessibleName(/^3:00 PM\s*Other$/);
    expect(chip(/Morning/)).toBeChecked();
    await user.click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(2));
    expect(mutateCreate.mock.calls.map((c) => (c[0] as { scheduled_time: string }).scheduled_time)).toEqual([
      '08:00',
      '15:00',
    ]);
  });

  it('Fix13: a custom dose\'s "×" removes it (an extra goes; the primary hands over to the next time)', async () => {
    mutateCreate.mockResolvedValue({ id: 'p' });
    const user = userEvent.setup();
    renderMed();
    await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
    // A custom primary (7:15) plus Evening as an extra.
    fireEvent.change(otherInput(), { target: { value: '07:15' } });
    await user.click(chip(/Evening/));
    const remove = screen.getByRole('button', { name: 'Remove 7:15 AM dose' });
    expect(remove).toHaveClass('h-11', 'w-11');
    await user.click(remove);
    expect(screen.queryByTestId('time-chip-custom')).toBeNull();
    expect(chip(/Evening/)).toBeChecked();
    // An extra custom dose: × drops just that one.
    fireEvent.change(otherInput(), { target: { value: '22:45' } });
    expect(screen.getByTestId('time-chip-custom')).toHaveAccessibleName(/^10:45 PM\s*Other$/);
    await user.click(screen.getByRole('button', { name: 'Remove 10:45 PM dose' }));
    expect(screen.queryByTestId('time-chip-custom')).toBeNull();
    await user.click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
    expect(mutateCreate.mock.calls[0][0]).toMatchObject({ scheduled_time: '18:00' });
  });

  it('un-choosing the first time moves the next one up (it becomes the saved time)', async () => {
    mutateCreate.mockResolvedValue({ id: 'p' });
    const user = userEvent.setup();
    renderMed();
    await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
    await user.click(chip(/Morning/));
    await user.click(chip(/Evening/));
    await user.click(chip(/Morning/)); // the primary goes: Evening is now the only time
    expect(chip(/Morning/)).not.toBeChecked();
    expect(chip(/Evening/)).toBeChecked();
    await user.click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
    expect(mutateCreate.mock.calls[0][0]).toMatchObject({ scheduled_time: '18:00' });
  });

  it('tapping the selected chip again clears the time', async () => {
    const user = userEvent.setup();
    renderMed();
    await user.click(chip(/Morning/));
    expect(chip(/Morning/)).toBeChecked();
    await user.click(chip(/Morning/));
    expect(chip(/Morning/)).not.toBeChecked();
  });

  it('keeps the 1.3.1 inline past-time note under the time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-15T18:00:00Z')); // 12:00 Denver / 14:00 New York
    const user = userEvent.setup();
    renderMed();
    expect(screen.queryByTestId('dose-past-time-note')).toBeNull();
    await user.click(chip(/Morning/)); // 8:00 New York (the recipient's clock): already passed today
    expect(screen.getByTestId('dose-past-time-note')).toHaveTextContent(
      'Starts with the next dose. This time has already passed today.'
    );
    await user.click(chip(/Morning/)); // un-chosen: no time, no note
    await user.click(chip(/Evening/)); // 18:00 New York: still ahead
    expect(screen.queryByTestId('dose-past-time-note')).toBeNull();
  });

  it('Save with no time: shows the time message, focuses the first chip, saves nothing', async () => {
    const user = userEvent.setup();
    renderMed();
    await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
    await user.click(screen.getByTestId('add-event-save'));
    expect(await screen.findByText('Medications need a scheduled time.')).toBeInTheDocument();
    expect(mutateCreate).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(chip(/Morning/));
  });
});

describe('new medication: a missing answer is shown where it is', () => {
  it('a cleared "Starts" date shows the message and takes focus; More details stays closed', async () => {
    const user = userEvent.setup();
    renderMed();
    await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
    await user.click(chip(/Morning/));
    fireEvent.change(screen.getByLabelText(/^Starts/), { target: { value: '' } });
    await user.click(screen.getByTestId('add-event-save'));
    expect(await screen.findByText('Please choose a date.')).toBeInTheDocument();
    // The message is AT the Starts tile, which takes focus (its hidden input is out of the tab order).
    const tile = screen.getByTestId('starts-tile');
    await waitFor(() => expect(tile).toHaveFocus());
    expect(tile).toHaveAttribute('aria-invalid', 'true');
    expect(tile).toHaveAttribute('aria-describedby', 'scheduled_date-error');
    expect(document.getElementById('scheduled_date-error')).toHaveTextContent('Please choose a date.');
    expect(screen.getByRole('button', { name: /More details/ })).toHaveAttribute('aria-expanded', 'false');
    expect(mutateCreate).not.toHaveBeenCalled();
  });
});

describe('new medication: Repeats until (build 11)', () => {
  it('reads Never when blank; a picked day names it; its in-tile "×" clears it back to Never (Fix13)', async () => {
    const user = userEvent.setup();
    renderMed();
    const tile = screen.getByTestId('repeats-until-tile');
    expect(tile).toHaveTextContent(/Never/);
    expect(tile).toBeEnabled();
    expect(screen.queryByTestId('repeats-until-tile-clear')).toBeNull();
    fireEvent.change(screen.getByLabelText(/^Repeats until/), { target: { value: '2027-03-31' } });
    expect(screen.getByTestId('repeats-until-tile')).toHaveTextContent(/Wed, Mar 31/);
    // The picker has no separate "No end date" button any more.
    await user.click(screen.getByTestId('repeats-until-tile'));
    await screen.findByRole('grid');
    expect(screen.queryByRole('button', { name: 'No end date' })).toBeNull();
    // A second tap on the tile closes its picker.
    await user.click(screen.getByTestId('repeats-until-tile'));
    expect(screen.queryByRole('grid')).toBeNull();
    const clear = screen.getByRole('button', { name: 'Clear repeat end' });
    expect(clear).toHaveClass('h-11', 'w-11');
    await user.click(clear);
    expect(screen.getByTestId('repeats-until-tile')).toHaveTextContent(/Never/);
    expect(screen.getByLabelText(/^Repeats until/)).toHaveValue('');
    expect(screen.queryByTestId('repeats-until-tile-clear')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('repeats-until-tile')).toHaveFocus());
  });

  it('Once keeps the tile in place, disabled, reading "Doesn\'t repeat"', async () => {
    const user = userEvent.setup();
    renderMed();
    await user.click(screen.getByTestId('repeat-custom'));
    await user.click(screen.getByRole('radio', { name: 'Once' }));
    const tile = screen.getByTestId('repeats-until-tile');
    expect(tile).toBeDisabled();
    expect(tile).toHaveTextContent(/Doesn't repeat/);
  });

  it('an end before the start errors AT the tile, live, and Save refuses it (focus on the tile)', async () => {
    const user = userEvent.setup();
    renderMed();
    await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
    await user.click(chip(/Evening/));
    fireEvent.change(screen.getByLabelText(/^Starts/), { target: { value: '2027-03-10' } });
    fireEvent.change(screen.getByLabelText(/^Repeats until/), { target: { value: '2027-03-01' } });
    const tile = screen.getByTestId('repeats-until-tile');
    const message = 'The end date must be on or after the first date.';
    expect(document.getElementById('recurrence_end_date-error')).toHaveTextContent(message);
    expect(tile).toHaveAttribute('aria-invalid', 'true');
    await user.click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(tile).toHaveFocus());
    expect(mutateCreate).not.toHaveBeenCalled();
    // A day on or after the start clears it and saves.
    fireEvent.change(screen.getByLabelText(/^Repeats until/), { target: { value: '2027-03-10' } });
    expect(document.getElementById('recurrence_end_date-error')).toBeNull();
    await user.click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
    expect(mutateCreate.mock.calls[0][0]).toMatchObject({ recurrence_end_date: '2027-03-10' });
  });
});

describe('new medication: API payload is IDENTICAL to the full form for the same answers', () => {
  async function savedPayload(
    run: (user: ReturnType<typeof userEvent.setup>) => Promise<void>,
    props: { layout?: 'full'; saveLabel: string }
  ): Promise<Record<string, unknown>> {
    mutateCreate.mockClear();
    const user = userEvent.setup();
    const view = renderMed(props.layout ? { layout: props.layout } : {});
    await run(user);
    await user.click(screen.getByRole('button', { name: props.saveLabel }));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
    const payload = mutateCreate.mock.calls[0][0] as Record<string, unknown>;
    view.unmount();
    return payload;
  }

  const nameAndDose = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
    await user.type(screen.getByLabelText('Dosage'), '500 mg');
  };

  it('Evening chip + Every day == Time 16:00 (Denver) + Repeat Daily', async () => {
    const simple = await savedPayload(
      async (user) => {
        await nameAndDose(user);
        await user.click(chip(/Evening/));
      },
      { saveLabel: 'Add medication' }
    );
    const full = await savedPayload(
      async (user) => {
        await nameAndDose(user);
        // The full form's field is the viewer's clock: 4:00 PM Denver is 6:00 PM in New York.
        const time = screen.getByLabelText(/^Time/);
        await user.clear(time);
        await user.type(time, '16:00');
        await user.selectOptions(screen.getByLabelText('Repeat'), 'daily');
      },
      { layout: 'full', saveLabel: 'Create' }
    );
    expect(simple).toEqual(full);
    // Spot-check the load-bearing fields (guards against two equally wrong bodies).
    expect(simple).toMatchObject({
      event_type: 'medication',
      title: 'Metformin',
      medication_name: 'Metformin',
      medication_dosage: '500 mg',
      scheduled_time: '18:00', // the chip is the recipient's clock: 6:00 PM in New York
      recurrence_rule: 'daily',
      notifications_enabled: true,
      reminder_at_due: true,
    });
  });

  it('Some days (Mon/Wed picked) == Repeat "Days of the week" with the same days', async () => {
    const pickDays = async (user: ReturnType<typeof userEvent.setup>) => {
      const group = await screen.findByRole('group', { name: 'Repeat on' });
      const first = within(group).getAllByRole('checkbox');
      // Select a deterministic set: Wed (3) on top of the pre-selected start day.
      const wed = first.find((c) => /Wed/i.test(c.getAttribute('aria-label') ?? c.textContent ?? ''));
      if (wed && wed.getAttribute('aria-checked') !== 'true' && !(wed as HTMLInputElement).checked) {
        await user.click(wed);
      }
    };
    const simple = await savedPayload(
      async (user) => {
        await nameAndDose(user);
        await user.click(chip(/Morning/));
        await user.click(screen.getByTestId('repeat-custom'));
        await user.click(screen.getByRole('radio', { name: 'Some days' }));
        await pickDays(user);
      },
      { saveLabel: 'Add medication' }
    );
    const full = await savedPayload(
      async (user) => {
        await nameAndDose(user);
        const time = screen.getByLabelText(/^Time/);
        await user.clear(time);
        await user.type(time, '06:00'); // Morning: 8:00 New York = 6:00 Denver
        await user.selectOptions(screen.getByLabelText('Repeat'), 'days_of_week');
        await pickDays(user);
      },
      { layout: 'full', saveLabel: 'Create' }
    );
    expect(simple).toEqual(full);
    expect(simple).toMatchObject({ recurrence_rule: expect.stringMatching(/^(weekly|daily)$/) });
  });

  it('When needed == Repeat "As needed": no time, no repeat, as_needed true', async () => {
    const simple = await savedPayload(
      async (user) => {
        await nameAndDose(user);
        await user.click(screen.getByRole('radio', { name: 'When needed' }));
      },
      { saveLabel: 'Add medication' }
    );
    const full = await savedPayload(
      async (user) => {
        await nameAndDose(user);
        await user.selectOptions(screen.getByLabelText('Repeat'), 'as_needed');
      },
      { layout: 'full', saveLabel: 'Create' }
    );
    expect(simple).toEqual(full);
    expect(simple).toMatchObject({ as_needed: true });
    expect(simple).not.toHaveProperty('scheduled_time');
    expect(simple).not.toHaveProperty('recurrence_rule');
  });

  it('a field changed in More details (instructions, reminders off) reaches the payload', async () => {
    const user = userEvent.setup();
    renderMed();
    await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
    await user.click(chip(/Bedtime/));
    await user.click(screen.getByRole('button', { name: /More details/ }));
    await user.type(screen.getByLabelText('Instructions'), 'With food');
    await user.click(screen.getByTestId('reminders-summary-row'));
    await user.click(screen.getByRole('switch', { name: 'Enable notifications' }));
    await user.click(screen.getByRole('button', { name: 'Add medication' }));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
    expect(mutateCreate.mock.calls[0][0]).toMatchObject({
      description: 'With food',
      notifications_enabled: false,
      scheduled_time: '21:00',
    });
  });
});

// Build 11: "+ Another dose" is gone; choosing a further chip IS another dose (multi-select). Same rows, same order.
describe('new medication: more than one time (mobile AddEventScreen / first-run wizard parity)', () => {
  const fillName = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
    await user.type(screen.getByLabelText('Dosage'), '500 mg');
  };

  it('saves the primary first, then ONE sibling row per extra time with refill_group_id = primary id', async () => {
    mutateCreate.mockResolvedValueOnce({ id: 'primary-1' }).mockResolvedValue({ id: 'sibling' });
    const user = userEvent.setup();
    renderMed();
    await fillName(user);
    await user.click(chip(/Morning/)); // 8:00 New York (the recipient's clock)
    await user.click(chip(/Midday/)); // a second time
    await user.click(chip(/Evening/)); // a third
    await user.click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(3));

    const [primary, second, third] = mutateCreate.mock.calls.map((c) => c[0]);
    expect(primary).toMatchObject({
      event_type: 'medication',
      medication_name: 'Metformin',
      scheduled_time: '08:00',
      recurrence_rule: 'daily',
    });
    expect(primary.refill_group_id).toBeUndefined();
    // Mobile's siblingDosePayload(data, {...}): the primary's body with its own clock/date,
    // no bottle of its own, and a pointer at the primary.
    const expectSibling = (row: Record<string, unknown>, time: string) =>
      expect(row).toEqual({
        ...primary,
        track_refills: false,
        quantity_in_bottle: undefined,
        quantity_remaining: undefined,
        pills_per_day: undefined,
        alert_days_before: undefined,
        scheduled_time: time,
        scheduled_date: primary.scheduled_date,
        recurrence_end_date: primary.recurrence_end_date,
        refill_group_id: 'primary-1',
      });
    expectSibling(second, '12:00'); // Midday, on the recipient's clock like the chips
    expectSibling(third, '18:00'); // Evening 6:00 PM New York
  });

  it('the request sequence equals the first-run wizard / mobile helper for the same answers', async () => {
    const { buildSiblingDoseRequests } = await import('@/utils/firstRunMedication');
    mutateCreate.mockResolvedValueOnce({ id: 'p' }).mockResolvedValue({ id: 's' });
    const user = userEvent.setup();
    renderMed();
    await fillName(user);
    await user.click(chip(/Morning/));
    await user.click(chip(/Midday/));
    await user.click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(2));
    const [primary, sibling] = mutateCreate.mock.calls.map((c) => c[0]);
    const todayStr = (primary.scheduled_date as string) ?? '';
    const expected = buildSiblingDoseRequests({
      primary,
      additionalTimes: ['10:00'], // the wizard's viewer-frame field: Midday 12:00 New York = 10:00 Denver
      timezone: RECIPIENT_TZ,
      // BC-1: the viewer-frame extra is placed on the primary's circle day (the primary: Morning 8:00 New York = 6:00 Denver).
      viewer: { todayStr, primaryTime: '06:00' },
      refillGroupId: 'p',
    })[0];
    expect(sibling.scheduled_time).toBe(expected.scheduled_time);
    expect(sibling.refill_group_id).toBe('p');
    expect(sibling.track_refills).toBe(false);
  });

  it('a time can be un-chosen, four times is the limit (the rest shown, not offered), un-choosing frees a slot', async () => {
    const user = userEvent.setup();
    renderMed();
    await user.click(otherTile());
    fireEvent.change(otherInput(), { target: { value: '07:15' } }); // the first time: a custom one
    await user.click(chip(/Morning/));
    await user.click(chip(/Midday/));
    await user.click(chip(/Evening/));
    expect(screen.getByTestId('extra-dose-3')).toBeInTheDocument();
    // Four times chosen: Bedtime and Other… are shown, not offered.
    expect(chip(/Bedtime/)).toBeDisabled();
    expect(otherTile()).toBeDisabled();
    await user.click(chip(/Bedtime/));
    expect(chip(/Bedtime/)).not.toBeChecked();
    await user.click(chip(/Evening/)); // un-choose an extra
    expect(screen.queryByTestId('extra-dose-3')).toBeNull();
    expect(chip(/Bedtime/)).toBeEnabled();
    expect(otherTile()).toBeEnabled();
    // The primary (the custom 7:15) is untouched.
    expect(screen.getByTestId('time-chip-custom')).toHaveAccessibleName(/^7:15 AM\s*Other$/);
    expect(screen.getByLabelText('Change 7:15 AM dose time', { selector: 'input' })).toHaveValue('07:15');
  });

  it('each extra dose gets its own inline past-time note', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-15T18:00:00Z')); // 12:00 Denver / 14:00 New York
    const user = userEvent.setup();
    renderMed();
    await user.click(chip(/Bedtime/)); // 9 PM New York: still ahead
    await user.click(chip(/Morning/)); // a second time: 8:00 New York, already passed today
    expect(screen.getByTestId('dose-past-time-note-1')).toHaveTextContent(
      'Starts with the next dose. This time has already passed today.'
    );
    // The primary (9 PM) is still ahead, so ITS note stays hidden.
    expect(screen.queryByTestId('dose-past-time-note')).toBeNull();
    // Swap the second time for one still ahead (7 PM New York, through Other…): its note goes.
    await user.click(chip(/Morning/));
    await user.click(otherTile());
    fireEvent.change(otherInput(), { target: { value: '19:00' } });
    expect(screen.getByTestId('extra-dose-1')).toBeInTheDocument();
    expect(screen.queryByTestId('dose-past-time-note-1')).toBeNull();
  });

  it('When needed removes the extra doses (no schedule to attach them to)', async () => {
    const user = userEvent.setup();
    renderMed();
    await user.click(chip(/Morning/));
    await user.click(chip(/Midday/));
    await user.click(screen.getByRole('radio', { name: 'When needed' }));
    await fillName(user);
    await user.click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
  });

  it('a failed extra dose is reported as a partial save, not a success', async () => {
    const failed = vi.spyOn(Analytics, 'entrySaveFailed').mockImplementation(() => {});
    mutateCreate.mockResolvedValueOnce({ id: 'p' }).mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    renderMed();
    await fillName(user);
    await user.click(chip(/Morning/));
    await user.click(chip(/Midday/));
    await user.click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(failed).toHaveBeenCalledWith('circle-1', 'medication', 'additional_dose_create_failed'));
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('12:00'), 'error');
  });
});

describe('new medication: analytics', () => {
  it('entry_form_opened fires once with the type and how it was opened', () => {
    const { rerender } = renderMed({ entry: 'add_menu' });
    rerender(
      <AddEventModal
        circleId={CIRCLE_ID}
        initialType="medication"
        entry="add_menu"
        onClose={vi.fn()}
      />
    );
    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened).toHaveBeenCalledWith({ type: 'medication', entry: 'add_menu' });
  });

  it.each(['add_menu', 'next_step', 'quick_access', 'empty_state'] as const)(
    'entry_form_opened carries entry=%s through to the event',
    (entry) => {
      renderMed({ entry });
      expect(opened).toHaveBeenCalledWith({ type: 'medication', entry });
    }
  );

  it('the appointment form reports the same entry on open and on abandon', async () => {
    const user = userEvent.setup();
    const apptSpy = vi.spyOn(Analytics, 'appointmentFormAbandoned');
    const view = renderAppt({ entry: 'add_menu' });
    expect(opened).toHaveBeenCalledWith({ type: 'appointment', entry: 'add_menu' });
    await user.click(screen.getByRole('button', { name: /^Close/ }));
    expect(apptSpy).toHaveBeenCalledWith(expect.objectContaining({ entrySource: 'add_menu' }));
    view.unmount();
  });

  it('entry defaults to "other"', () => {
    renderMed();
    expect(opened).toHaveBeenCalledWith({ type: 'medication', entry: 'other' });
  });

  it('each chip fires time_chip_selected with ITS id; Other… fires "other"; untap does not', async () => {
    const user = userEvent.setup();
    renderMed();
    // Each chip as THE time (chosen, then un-chosen, so the next one is the time again).
    for (const name of [/Morning/, /Midday/, /Evening/, /Bedtime/]) {
      await user.click(chip(name));
      await user.click(chip(name));
    }
    await user.click(otherTile());
    expect((chipSpy.mock.calls as Array<[{ chip: string }]>).map((c) => c[0].chip)).toEqual([
      'morning',
      'midday',
      'evening',
      'bedtime',
      'other',
    ]);
    chipSpy.mockClear();
    await user.click(otherTile()); // close the picker
    await user.click(chip(/Bedtime/));
    chipSpy.mockClear();
    await user.click(chip(/Bedtime/)); // selected -> untap
    expect(chipSpy).not.toHaveBeenCalled();
  });

  it('what / when / how_often complete once each, in the order the user does them', async () => {
    const user = userEvent.setup();
    renderMed();
    expect(stepDone).not.toHaveBeenCalled();
    await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
    await user.tab(); // leave the field: "What is it?" is answered
    expect(stepDone).toHaveBeenCalledWith({ type: 'medication', step: 'what' });
    await user.click(chip(/Morning/));
    await user.click(chip(/Midday/));
    await user.click(screen.getByRole('radio', { name: 'Every week' }));
    await user.click(screen.getByRole('radio', { name: 'Every day' }));
    expect((stepDone.mock.calls as Array<[{ step: string }]>).map((c) => c[0].step)).toEqual(['what', 'when', 'how_often']);
    expect((stepDone.mock.calls as Array<[{ type: string }]>).every((c) => c[0].type === 'medication')).toBe(true);
  });

  it('closing unsaved fires medication_form_abandoned with the entry; saving does not', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { unmount } = renderMed({ entry: 'next_step', onClose });
    await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(medAbandoned).toHaveBeenCalledTimes(1);
    expect(medAbandoned.mock.calls[0][0]).toMatchObject({
      entrySource: 'next_step',
      hasName: true,
      hasSchedule: false,
    });
    unmount();

    medAbandoned.mockClear();
    renderMed({ entry: 'next_step', onClose });
    await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
    await user.click(chip(/Morning/));
    await user.click(screen.getByRole('button', { name: 'Add medication' }));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalled());
    expect(medAbandoned).not.toHaveBeenCalled();
  });

  it('large_text_layout: active=false at normal size, true at a large root font, once', () => {
    const { unmount } = renderMed();
    expect(largeText).toHaveBeenCalledTimes(1);
    expect(largeText).toHaveBeenCalledWith('med_form', false);
    unmount();

    resetLargeTextReports();
    largeText.mockClear();
    document.documentElement.style.fontSize = '32px';
    renderMed();
    expect(largeText).toHaveBeenCalledWith('med_form', true);
  });

  it('large text keeps the time chips in the same content-sized wrapping row (never a one-column list)', () => {
    document.documentElement.style.fontSize = '32px';
    renderMed();
    expect(timeChips()).toHaveClass('contents');
    expect(screen.getByTestId('time-chip-row')).toHaveClass('flex', 'flex-wrap');
    expect(screen.getByTestId('simple-medication-form')).toHaveAttribute('data-large-text', 'true');
  });
});

describe('new appointment', () => {
  it("is built like the task form: What is it? / When? / What time? / Who's going? / More details", () => {
    renderAppt();
    expect(screen.getByRole('dialog', { name: 'New appointment' })).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['What is it?', 'When? *', 'What time?', "Who's going?"]);
    // When? = Starts | Repeats until (Once: disabled, "Doesn't repeat"), then the How often? grid.
    const when = screen.getByRole('heading', { name: /^When\?/ }).closest('section') as HTMLElement;
    expect(within(when).getByTestId('starts-tile')).toHaveTextContent(/^Starts/);
    const until = within(when).getByTestId('repeats-until-tile');
    expect(until).toBeDisabled();
    expect(until).toHaveTextContent(/^Repeats until\s*Doesn't repeat$/);
    const often = within(when).getByRole('radiogroup', { name: 'How often?' });
    expect(within(often).getAllByRole('radio').map((r) => r.textContent)).toEqual([
      'Once',
      'Every day',
      'Every week',
    ]);
    expect(within(often).getByRole('radio', { name: 'Once' })).toBeChecked();
    expect(screen.getByTestId('repeat-custom')).toHaveTextContent('Custom…');
    // What time? = Pick a time | Any time (Any time lit: no time yet); no time tiles until Pick a time.
    const what = screen.getByRole('radiogroup', { name: 'What time?' });
    expect(within(what).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Pick a time', 'Any time']);
    expect(screen.getByRole('radio', { name: 'Any time' })).toBeChecked();
    expect(screen.queryByTestId('appt-from-to')).toBeNull();
    // One More details (no Doctor / Place / Notes / Repeat rows), collapsed, naming what is inside.
    for (const id of ['row-doctor', 'row-place', 'row-notes', 'row-repeat']) {
      expect(document.getElementById(id)).toBeNull();
    }
    const more = screen.getByRole('button', { name: /^More details/ });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(more).toHaveTextContent('Doctor, location, details');
    expect(screen.getByTestId('add-event-save')).toHaveTextContent('Add appointment');
    expect(screen.queryByLabelText('Type')).toBeNull();
  });

  // Build 11 (owner 2026-11-10, mobile parity): with Pick a time, From | To value tiles (each the time picker),
  // on the CIRCLE's clock; To starts at From + 30 minutes and keeps the length when From moves; no length chips;
  // the zone caption only when the zones differ. More details keeps Doctor, Location and Details.
  const fromInput = () => screen.getByLabelText('From', { selector: 'input' });
  const toInput = () => screen.getByLabelText('To', { selector: 'input' });
  it('Fix13: the appointment To is required: no "×" on it (the task\'s is optional and has one)', async () => {
    const user = userEvent.setup();
    renderAppt();
    await user.click(screen.getByRole('radio', { name: 'Pick a time' }));
    fireEvent.change(screen.getByLabelText('From', { selector: 'input' }), { target: { value: '09:00' } });
    // It has its value (From + 30), shown with the chevron and no clear.
    expect(screen.getByLabelText('To', { selector: 'input' })).toHaveValue('09:30');
    expect(screen.getByTestId('appt-to-tile')).toHaveTextContent(/To\s*\d/);
    expect(screen.queryByRole('button', { name: 'Clear end time' })).toBeNull();
    expect(screen.queryByTestId('appt-to-tile-clear')).toBeNull();
    expect(screen.queryByTestId('appt-to-tile-box')).toBeNull();
  });

  it('Pick a time shows From | To (no length chips) and the zone caption; Any time hides them all', async () => {
    const user = userEvent.setup();
    renderAppt();
    await user.click(screen.getByRole('radio', { name: 'Pick a time' }));
    expect(screen.getByTestId('appt-from-tile')).toHaveTextContent(/^From\s*Choose a time$/);
    expect(screen.getByTestId('appt-to-tile')).toHaveTextContent(/^To\s*Choose a time$/);
    expect(screen.getByTestId('appt-to-tile')).toBeDisabled(); // nothing to end before a start
    fireEvent.change(fromInput(), { target: { value: '11:00' } }); // 11:00 New York (the circle's clock)
    expect(screen.getByTestId('appt-from-tile')).toHaveTextContent(/^From\s*11:00 AM$/);
    expect(screen.getByTestId('appt-to-tile')).toHaveTextContent(/^To\s*11:30 AM$/);
    expect(screen.queryByRole('radio', { name: '30 min' })).toBeNull();
    // Not folded: visible with More details closed.
    expect(screen.getByRole('button', { name: /^More details/ })).toHaveAttribute('aria-expanded', 'false');
    // Viewer Denver, circle New York: the circle's time first, then the viewer's range.
    expect(screen.getByTestId('time-zone-caption')).toHaveTextContent(
      'New York time · 9:00 – 9:30 AM your time (Denver)'
    );
    expect(screen.queryByTestId('appt-duration-caption')).toBeNull();
    await user.click(screen.getByRole('button', { name: /^More details/ }));
    const panel = document.getElementById('more-details-panel') as HTMLElement;
    expect(within(panel).queryByRole('radio', { name: '1 hr' })).toBeNull();
    expect(panel.querySelector('#endTime')).toBeNull();
    expect(within(panel).getByLabelText(/^Location/)).toBeVisible();
    expect(within(panel).getByLabelText(/^Details/)).toBeVisible();
    expect(within(panel).getByRole('combobox', { name: 'Doctor' })).toBeVisible();
    await user.click(screen.getByRole('radio', { name: 'Any time' }));
    expect(screen.queryByTestId('appt-from-to')).toBeNull();
    expect(screen.queryByTestId('time-zone-caption')).toBeNull();
    expect(document.getElementById('endTime')).toBeNull();
  });

  it('To keeps the length when From moves; an end at or before From is the next day', async () => {
    const user = userEvent.setup();
    renderAppt();
    await user.click(screen.getByRole('radio', { name: 'Pick a time' }));
    fireEvent.change(fromInput(), { target: { value: '09:00' } });
    fireEvent.change(toInput(), { target: { value: '11:00' } });
    expect(screen.getByTestId('appt-to-tile')).toHaveTextContent(/11:00 AM$/);
    fireEvent.change(fromInput(), { target: { value: '13:00' } }); // two hours kept
    expect(toInput()).toHaveValue('15:00');
    expect(screen.getByTestId('appt-to-tile')).toHaveTextContent(/3:00 PM$/);
    // An end at or before the start is the next day (the save's PK21 rule): the tile says so.
    fireEvent.change(toInput(), { target: { value: '08:00' } });
    expect(screen.getByTestId('appt-to-tile')).toHaveTextContent(/8:00 AM next day$/);
  });

  it('the zone caption is not shown when the viewer and the recipient share a zone', async () => {
    const saved = useCircleResult.timezone;
    useCircleResult.timezone = 'America/Denver';
    try {
      const user = userEvent.setup();
      renderAppt();
      await user.click(screen.getByRole('radio', { name: 'Pick a time' }));
      fireEvent.change(fromInput(), { target: { value: '09:00' } });
      expect(screen.getByTestId('appt-from-tile')).toHaveTextContent(/9:00 AM$/);
      expect(screen.queryByTestId('time-zone-caption')).toBeNull();
    } finally {
      useCircleResult.timezone = saved;
    }
  });

  it('a missing end errors AT the To tile (focused, invalid), not in More details', async () => {
    const user = userEvent.setup();
    renderAppt();
    await user.type(title(), 'Checkup');
    await user.click(screen.getByRole('radio', { name: 'Pick a time' }));
    fireEvent.change(fromInput(), { target: { value: '09:00' } });
    fireEvent.change(toInput(), { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: 'Add appointment' }));
    const tile = screen.getByTestId('appt-to-tile');
    expect(await screen.findByText('Please add an end time.')).toBeVisible();
    await waitFor(() => expect(tile).toHaveFocus());
    expect(tile).toHaveAttribute('aria-invalid', 'true');
    expect(tile).toHaveAttribute('aria-describedby', 'endTime-error');
    expect(screen.getByRole('button', { name: /^More details/ })).toHaveAttribute('aria-expanded', 'false');
    expect(mutateCreate).not.toHaveBeenCalled();
  });

  it("Who's going? offers Anyone first, then every member", () => {
    renderAppt();
    const group = screen.getByRole('radiogroup', { name: "Who's going?" });
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual([
      'Anyone',
      'Ana',
      'Luis',
    ]);
    expect(within(group).getByRole('radio', { name: 'Anyone' })).toBeChecked();
  });

  it('quick title chips (at most 3) fill the title and go once it has one', async () => {
    const user = userEvent.setup();
    renderAppt();
    const chips = screen.getByRole('radiogroup', { name: 'Title suggestions' });
    expect(within(chips).getAllByRole('radio')).toHaveLength(3);
    await user.click(screen.getByRole('radio', { name: 'Doctor visit' }));
    expect(title()).toHaveValue('Doctor visit');
    expect(screen.queryByRole('radiogroup', { name: 'Title suggestions' })).toBeNull();
  });

  it('saves the same body as the full form: title, date, time, end, assignee, place', async () => {
    const run = async (full: boolean) => {
      mutateCreate.mockClear();
      const user = userEvent.setup();
      const view = renderAppt(full ? { layout: 'full' } : {});
      await user.type(title(), 'Cardiology follow-up');
      if (full) {
        const date = screen.getByLabelText(/^Date/);
        await user.clear(date);
        await user.type(date, '2026-10-29');
        const time = screen.getByLabelText(/^Time/, { selector: 'input' });
        await user.clear(time);
        await user.type(time, '14:30');
      } else {
        // Build 11: the Starts tile and the From tile, From on the circle's clock (16:30 New York = 14:30 Denver).
        fireEvent.change(screen.getByLabelText(/^Starts/), { target: { value: '2026-10-29' } });
        await user.click(screen.getByRole('radio', { name: 'Pick a time' }));
        fireEvent.change(screen.getByLabelText('From', { selector: 'input' }), { target: { value: '16:30' } });
      }
      if (full) {
        await user.selectOptions(screen.getByLabelText('Assigned to'), LUIS_ID);
        await user.type(screen.getByLabelText('Location'), 'Clinic');
        await user.click(screen.getByRole('button', { name: 'Create' }));
      } else {
        await user.click(screen.getByRole('radio', { name: 'Luis' }));
        await user.click(screen.getByRole('button', { name: /^More details/ }));
        await user.type(screen.getByLabelText('Location'), 'Clinic');
        await user.click(screen.getByRole('button', { name: 'Add appointment' }));
      }
      await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
      const payload = mutateCreate.mock.calls[0][0];
      view.unmount();
      return payload;
    };
    const simple = await run(false);
    const full = await run(true);
    expect(simple).toEqual(full);
    expect(simple).toMatchObject({
      event_type: 'appointment',
      title: 'Cardiology follow-up',
      scheduled_date: '2026-10-29',
      scheduled_time: '16:30',
      assigned_to: LUIS_ID,
      location: 'Clinic',
    });
  });

  it('analytics: opened, steps who/when/what once, abandon with the LAST field touched', async () => {
    const user = userEvent.setup();
    renderAppt({ entry: 'quick_access' });
    expect(opened).toHaveBeenCalledWith({ type: 'appointment', entry: 'quick_access' });

    await user.type(title(), 'Visit');
    await user.tab();
    await user.click(screen.getByRole('radio', { name: 'Ana' }));
    await user.click(screen.getByRole('radio', { name: 'Luis' }));
    expect((stepDone.mock.calls as Array<[unknown]>).map((c) => c[0])).toEqual([
      { type: 'appointment', step: 'what' },
      { type: 'appointment', step: 'who' },
    ]);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(apptAbandoned).toHaveBeenCalledTimes(1);
    expect(apptAbandoned.mock.calls[0][0].lastField).toBe('who');
    expect(medAbandoned).not.toHaveBeenCalled();
  });

  it('abandon reports "none" when nothing was touched, and never fires after a save', async () => {
    const user = userEvent.setup();
    const { unmount } = renderAppt();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(apptAbandoned).toHaveBeenCalledWith(expect.objectContaining({ lastField: 'none' }));
    unmount();

    apptAbandoned.mockClear();
    renderAppt();
    await user.type(title(), 'Visit');
    await user.click(screen.getByRole('button', { name: 'Add appointment' }));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalled());
    expect(apptAbandoned).not.toHaveBeenCalled();
  });

  it('large_text_layout reports the appointment screen', () => {
    renderAppt();
    expect(largeText).toHaveBeenCalledWith('appt_form', false);
  });
});

describe('where the full form still applies', () => {
  it('a type-less open keeps the type switch and the full fields', () => {
    render(<AddEventModal circleId={CIRCLE_ID} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Type')).toBeInTheDocument();
    expect(screen.getByTestId('add-event-save')).toHaveTextContent('Create');
    expect(screen.queryByTestId('simple-medication-form')).toBeNull();
  });

  it('a task opened for tasks has no type switch and gets the simple task form (owner 1.4.0)', () => {
    render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
    expect(screen.queryByLabelText('Type')).toBeNull();
    expect(title()).toBeInTheDocument();
    expect(screen.getByTestId('simple-task-form')).toBeInTheDocument();
    expect(screen.getByTestId('add-event-save')).toHaveTextContent('Add task');
  });

  it('layout="full" still forces the full task form', () => {
    render(<AddEventModal circleId={CIRCLE_ID} initialType="task" layout="full" onClose={vi.fn()} />);
    expect(screen.queryByTestId('simple-task-form')).toBeNull();
    expect(screen.getByTestId('add-event-save')).toHaveTextContent('Create');
  });
});
