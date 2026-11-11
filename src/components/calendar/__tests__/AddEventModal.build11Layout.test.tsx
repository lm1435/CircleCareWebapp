import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { Analytics } from '@/lib/analytics';
import { resetLargeTextReports } from '@/lib/largeText';
import { AddEventModal } from '../AddEventModal';

// BUILD 11 FORM REDESIGN (owner 2026-11-10, docs: scratchpad form-spec-b11.md; mobile parity): the medication,
// appointment and task forms share ONE order, on new AND edit (edit = new, pre-filled):
//   What → When? (Starts | Repeats until, then How often?) → What time? → Who → Reminders → More details.
// This file pins that order per form, that an edit seeds every tile, the "Repeats until" tile's states, the
// zone caption, and the Reminders nudge. The save bodies are pinned by the *PayloadEquality suites.

const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'America/Denver';
});
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const ME_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const ANA_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
const CIRCLE_ID = 'circle-1';
const NOW = new Date('2027-02-10T18:40:00Z');

vi.mock('../DoseQuietHoursNote', () => ({ DoseQuietHoursNote: () => null }));
vi.mock('@/api/drugs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/drugs')>()),
  searchDrugs: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/api/medicationPhoto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/medicationPhoto')>()),
  getMedicationFormDetails: vi.fn().mockResolvedValue({ details: {}, photoUrl: null }),
}));
vi.mock('@/hooks/useProviders', () => ({ useProviders: () => ({ providers: [], isSuccess: true }) }));
const mutateCreate = vi.fn();
const mutateUpdate = vi.fn();
vi.mock('@/hooks/useCalendarEvents', () => ({
  useCreateEvent: () => ({ mutateAsync: mutateCreate, isPending: false }),
  useUpdateEvent: () => ({ mutateAsync: mutateUpdate, isPending: false }),
  useCachedCircleEvents: () => [],
}));
vi.mock('@/hooks/useSeriesRoot', () => ({
  useSeriesRoot: (_c: string, event: unknown) => ({ root: event ?? null }),
}));
vi.mock('@/store/authStore', () => ({
  useAuthStore: (select: (s: { user: { id: string } }) => unknown) => select({ user: { id: ME_ID } }),
}));
const useCircleResult = {
  circle: { recipient_name: 'Rosa', is_self_care: false, owner_id: ME_ID },
  circleSummary: undefined,
  timezone: 'America/Denver',
  members: [
    { id: ME_ID, email: 'luis@example.com', first_name: 'Luis', is_care_recipient: false },
    { id: ANA_ID, email: 'ana@example.com', first_name: 'Ana', is_care_recipient: false },
  ],
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

const scrollIntoView = vi.fn();
let reducedMotion = false;
beforeEach(() => {
  vi.clearAllMocks();
  resetLargeTextReports();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  useCircleResult.timezone = 'America/Denver';
  mutateCreate.mockResolvedValue({ id: 'new' });
  mutateUpdate.mockResolvedValue({ id: 'x' });
  Element.prototype.scrollIntoView = scrollIntoView;
  reducedMotion = false;
  window.matchMedia = ((query: string) => ({
    matches: query.includes('reduce') ? reducedMotion : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  for (const name of [
    'entryFormOpened',
    'entryFormStepCompleted',
    'timeChipSelected',
    'entrySaveTapped',
    'largeTextLayout',
    'remindersSummaryToggled',
  ] as const) {
    vi.spyOn(Analytics, name).mockImplementation(() => {});
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

type Kind = 'medication' | 'appointment' | 'task';
const base = {
  circle_id: CIRCLE_ID,
  created_at: '2027-01-01T00:00:00Z',
  updated_at: '2027-01-01T00:00:00Z',
  notifications_enabled: true,
  reminder_at_due: true,
  reminder_24h: false,
  reminder_1h: false,
  reminder_30m: false,
  reminder_15m: false,
  description: null,
  location: null,
  assigned_to: null,
  duration_minutes: null,
  recurrence_rule: null,
  recurrence_end_date: null,
};
const EDITS: Record<Kind, CalendarEvent> = {
  medication: {
    ...base,
    id: 'med-1',
    event_type: 'medication',
    title: 'Lisinopril',
    medication_name: 'Lisinopril',
    medication_dosage: '10 mg',
    scheduled_date: '2027-02-15',
    scheduled_time: '14:30:00',
    recurrence_rule: 'daily',
    recurrence_end_date: '2027-03-31',
    description: 'With food',
  } as CalendarEvent,
  appointment: {
    ...base,
    id: 'appt-1',
    event_type: 'appointment',
    title: 'Cardiology',
    scheduled_date: '2027-02-15',
    scheduled_time: '09:00:00',
    duration_minutes: 45,
    recurrence_rule: 'weekly',
    recurrence_end_date: '2027-05-01',
    assigned_to: ANA_ID,
    location: 'Clinic B',
  } as CalendarEvent,
  task: {
    ...base,
    id: 'task-1',
    event_type: 'task',
    title: 'Water the plants',
    scheduled_date: '2027-02-15',
    scheduled_time: '15:00:00',
    duration_minutes: 30,
    recurrence_rule: 'daily',
    recurrence_end_date: '2027-04-01',
    assigned_to: ME_ID,
    description: 'Both pots',
  } as CalendarEvent,
};

function renderNew(kind: Kind) {
  return render(<AddEventModal circleId={CIRCLE_ID} initialType={kind} onClose={vi.fn()} />);
}
function renderEdit(kind: Kind) {
  return render(<AddEventModal circleId={CIRCLE_ID} event={EDITS[kind]} onClose={vi.fn()} />);
}
const form = (kind: Kind) => screen.getByTestId(`simple-${kind}-form`);

/** The form's landmarks in DOM order: section headings, the Reminders row, More details. */
function order(kind: Kind): string[] {
  const root = form(kind);
  const marks = root.querySelectorAll<HTMLElement>(
    'h3, [data-testid="reminders-summary-row"], #more-details, button[aria-controls="more-details-panel"], [data-testid="when-date-tiles"], #how-often'
  );
  const out: string[] = [];
  for (const el of Array.from(marks)) {
    if (el.tagName === 'H3') out.push(el.textContent?.replace(/\s*\*$/, '').trim() ?? '');
    else if (el.dataset.testid === 'reminders-summary-row') out.push('Reminders');
    else if (el.dataset.testid === 'when-date-tiles') out.push('[Starts | Repeats until]');
    else if (el.id === 'how-often') out.push('[How often]');
    else out.push('More details');
  }
  // DisclosureRow may expose the toggle and its region: one entry is enough.
  return out.filter((v, i) => v !== 'More details' || out.indexOf('More details') === i);
}

const ORDER: Record<Kind, string[]> = {
  medication: [
    'What is it?',
    'When?',
    '[Starts | Repeats until]',
    '[How often]',
    'What time?',
    'Reminders',
    'More details',
  ],
  appointment: [
    'What is it?',
    'When?',
    '[Starts | Repeats until]',
    '[How often]',
    'What time?',
    "Who's going?",
    'Reminders',
    'More details',
  ],
  task: [
    'What needs doing?',
    'When?',
    '[Starts | Repeats until]',
    '[How often]',
    'What time?',
    "Who's doing it?",
    'Reminders',
    'More details',
  ],
};

describe('one order on all three forms, new and edit', () => {
  for (const kind of ['medication', 'appointment', 'task'] as const) {
    it(`${kind}: new`, async () => {
      renderNew(kind);
      // The appointment / task Reminders row appears once there is a time: pick one so the row is the summary.
      if (kind !== 'medication') {
        await userEvent.setup().click(screen.getByRole('radio', { name: 'Pick a time' }));
        fireEvent.change(screen.getByLabelText('From', { selector: 'input' }), {
          target: { value: '09:00' },
        });
      }
      expect(order(kind)).toEqual(ORDER[kind]);
      expect(screen.getByRole('button', { name: /^More details/ })).toHaveAttribute('aria-expanded', 'false');
    });

    it(`${kind}: edit is the same order, More details still collapsed`, () => {
      renderEdit(kind);
      expect(order(kind)).toEqual(ORDER[kind]);
      // Edit = new: a stored detail / end date no longer opens More details by itself.
      expect(screen.getByRole('button', { name: /^More details/ })).toHaveAttribute('aria-expanded', 'false');
    });
  }

  it('the medication dose is its own full-width line under the name, inside What is it?', () => {
    renderNew('medication');
    const what = screen.getByRole('heading', { name: 'What is it?' }).closest('section') as HTMLElement;
    const name = within(what).getByRole('combobox', { name: /Medication name/ });
    const dose = within(what).getByLabelText('Dosage');
    expect(name.compareDocumentPosition(dose) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Not side by side: no shared row / grid wrapper holds both.
    const shared = dose.closest('.grid, .flex-row');
    expect(shared === null || !shared.contains(name)).toBe(true);
  });
});

describe('an edit seeds every tile', () => {
  it('medication: Starts, Repeats until, the time (a custom chip), the dose', () => {
    renderEdit('medication');
    expect(screen.getByTestId('starts-tile')).toHaveTextContent('Mon, Feb 15');
    expect(screen.getByTestId('repeats-until-tile')).toHaveTextContent('Wed, Mar 31');
    expect(screen.getByLabelText('Starts')).toHaveValue('2027-02-15');
    expect(screen.getByLabelText('Repeats until')).toHaveValue('2027-03-31');
    // An edit holds one dose: the presets are radios, none lit; 2:30 PM is a custom chip (its picker holds it).
    const group = within(document.getElementById('time-chips') as HTMLElement);
    expect(group.getAllByRole('radio').every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true);
    expect(screen.getByTestId('time-chip-custom')).toHaveAccessibleName(/^2:30 PM\s*Other$/);
    expect(screen.getByLabelText('Change 2:30 PM dose time')).toHaveValue('14:30');
    expect(screen.getByLabelText('Dosage')).toHaveValue('10 mg');
    expect(screen.getByRole('radio', { name: 'Every day' })).toBeChecked();
  });

  it('appointment: Starts, Repeats until, Pick a time, From | To, who', () => {
    renderEdit('appointment');
    expect(screen.getByTestId('starts-tile')).toHaveTextContent('Mon, Feb 15');
    expect(screen.getByTestId('repeats-until-tile')).toHaveTextContent('Sat, May 1');
    expect(screen.getByRole('radio', { name: 'Pick a time' })).toBeChecked();
    expect(screen.getByTestId('appt-from-tile')).toHaveTextContent('9:00 AM');
    expect(screen.getByTestId('appt-to-tile')).toHaveTextContent('9:45 AM');
    expect(screen.getByLabelText('From', { selector: 'input' })).toHaveValue('09:00');
    expect(screen.getByLabelText('To', { selector: 'input' })).toHaveValue('09:45');
    const who = screen.getByRole('radiogroup', { name: "Who's going?" });
    expect(within(who).getByRole('radio', { name: 'Ana' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Every week' })).toBeChecked();
  });

  it('task: Starts, Repeats until, Pick a time, From | To, who, details behind More details (no end row there)', async () => {
    const user = userEvent.setup();
    renderEdit('task');
    expect(screen.getByTestId('starts-tile')).toHaveTextContent('Mon, Feb 15');
    expect(screen.getByTestId('repeats-until-tile')).toHaveTextContent('Thu, Apr 1');
    expect(screen.getByRole('radio', { name: 'Pick a time' })).toBeChecked();
    expect(screen.getByTestId('task-from-tile')).toHaveTextContent('3:00 PM');
    expect(screen.getByTestId('task-to-tile')).toHaveTextContent('3:30 PM');
    expect(screen.getByLabelText('From', { selector: 'input' })).toHaveValue('15:00');
    expect(screen.getByLabelText('To', { selector: 'input' })).toHaveValue('15:30');
    const who = screen.getByRole('radiogroup', { name: "Who's doing it?" });
    expect(within(who).getByRole('radio', { name: 'Me' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: /^More details/ }));
    expect(screen.getByLabelText(/^Details/)).toHaveValue('Both pots');
    expect(screen.queryByLabelText(/^End time/)).toBeNull();
  });
});

describe('"Repeats until"', () => {
  it('Never when blank (no ×); a day picked shows "Mar 1 ×"; × clears it to Never (Fix13: clear in the tile)', async () => {
    const user = userEvent.setup();
    renderNew('medication');
    expect(screen.getByTestId('repeats-until-tile')).toHaveTextContent(/Repeats until\s*Never/);
    expect(screen.getByTestId('repeats-until-tile')).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Clear repeat end' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Repeats until'), { target: { value: '2027-03-01' } });
    expect(screen.getByTestId('repeats-until-tile')).toHaveTextContent('Mon, Mar 1');
    const clear = screen.getByRole('button', { name: 'Clear repeat end' });
    // Its own button, beside the tile (not inside it), 44px.
    expect(screen.getByTestId('repeats-until-tile')).not.toContainElement(clear);
    expect(screen.getByTestId('repeats-until-tile-box')).toContainElement(clear);
    expect(clear).toHaveClass('h-11', 'w-11');
    // The picker itself has no separate clear any more.
    await user.click(screen.getByTestId('repeats-until-tile'));
    await screen.findByRole('grid');
    expect(screen.queryByRole('button', { name: 'No end date' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Clear repeat end' }));
    expect(screen.getByTestId('repeats-until-tile')).toHaveTextContent(/Never/);
    expect(screen.getByLabelText('Repeats until')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Clear repeat end' })).toBeNull();
    // Focus goes back to the tile (the × is gone).
    await waitFor(() => expect(screen.getByTestId('repeats-until-tile')).toHaveFocus());
  });

  it('the Starts picker offers no clear (the day is required)', async () => {
    const user = userEvent.setup();
    renderNew('task');
    await user.click(screen.getByTestId('starts-tile'));
    await screen.findByRole('grid');
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'No end date' })).toBeNull();
  });

  for (const kind of ['appointment', 'task'] as const) {
    it(`${kind}: with Once it stays in place, disabled, "Doesn't repeat"; Every day enables it`, async () => {
      const user = userEvent.setup();
      renderNew(kind);
      const tile = screen.getByTestId('repeats-until-tile');
      expect(screen.getByRole('radio', { name: 'Once' })).toBeChecked();
      expect(tile).toBeDisabled();
      expect(tile).toHaveTextContent("Doesn't repeat");
      await user.click(screen.getByRole('radio', { name: 'Every day' }));
      expect(screen.getByTestId('repeats-until-tile')).toBe(tile);
      expect(tile).toBeEnabled();
      expect(tile).toHaveTextContent('Never');
    });
  }

  it('an end before the start errors AT the tile, live, and Save is refused there', async () => {
    const user = userEvent.setup();
    renderNew('appointment');
    await user.type(screen.getByRole('textbox', { name: /^Title/ }), 'Lab');
    await user.click(screen.getByRole('radio', { name: 'Every week' }));
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2027-03-10' } });
    fireEvent.change(screen.getByLabelText('Repeats until'), { target: { value: '2027-03-01' } });
    const tile = screen.getByTestId('repeats-until-tile');
    const error = document.getElementById('recurrence_end_date-error');
    expect(error).toHaveTextContent('The end date must be on or after the first date.');
    expect(tile).toHaveAttribute('aria-invalid', 'true');
    expect(tile).toHaveAttribute('aria-describedby', 'recurrence_end_date-error');
    await user.click(screen.getByTestId('add-event-save'));
    expect(mutateCreate).not.toHaveBeenCalled();
    expect(tile).toHaveFocus();
    // The same day is fine (the server's rule is "on or after").
    fireEvent.change(screen.getByLabelText('Repeats until'), { target: { value: '2027-03-10' } });
    expect(document.getElementById('recurrence_end_date-error')).toBeNull();
  });
});

describe('custom dose chips (Fix13): the chip changes that dose in place; its × removes it; presets toggle', () => {
  it('new: a custom extra dose is changed in place, then removed, and saves as that time', async () => {
    const user = userEvent.setup();
    renderNew('medication');
    await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
    await user.click(screen.getByRole('checkbox', { name: /Morning$/ }));
    // Other… adds a second (custom) time: 2:30 PM.
    fireEvent.change(screen.getByLabelText('Other time', { selector: 'input' }), { target: { value: '14:30' } });
    const chip = screen.getByTestId('time-chip-custom');
    expect(chip).toHaveAccessibleName(/^2:30 PM\s*Other$/);
    // Not a toggle: the chip is the picker (its hidden input), outside the presets' group.
    expect(chip).toHaveAttribute('aria-haspopup', 'dialog');
    expect(document.getElementById('time-chips')).not.toContainElement(chip);
    const remove = screen.getByRole('button', { name: 'Remove 2:30 PM dose' });
    expect(remove).toHaveClass('h-11', 'w-11');
    // Change it in place: 3:00 PM. Still two times; the chip keeps its place (same element).
    fireEvent.change(screen.getByLabelText('Change 2:30 PM dose time'), { target: { value: '15:00' } });
    expect(screen.getByTestId('time-chip-custom')).toBe(chip);
    expect(chip).toHaveAccessibleName(/^3:00 PM\s*Other$/);
    expect(screen.getByRole('checkbox', { name: /Morning$/ })).toBeChecked();
    mutateCreate.mockClear();
    await user.click(screen.getByTestId('add-event-save'));
    await vi.waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(2));
    expect(mutateCreate.mock.calls.map((c) => String((c[0] as { scheduled_time: string }).scheduled_time).slice(0, 5))).toEqual([
      '08:00',
      '15:00',
    ]);
  });

  it('new: × removes only that dose; a preset still toggles', async () => {
    const user = userEvent.setup();
    renderNew('medication');
    await user.click(screen.getByRole('checkbox', { name: /Evening$/ }));
    fireEvent.change(screen.getByLabelText('Other time', { selector: 'input' }), { target: { value: '07:15' } });
    await user.click(screen.getByRole('button', { name: 'Remove 7:15 AM dose' }));
    expect(screen.queryByTestId('time-chip-custom')).toBeNull();
    expect(screen.getByRole('checkbox', { name: /Evening$/ })).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: /Evening$/ }));
    expect(screen.getByRole('checkbox', { name: /Evening$/ })).not.toBeChecked();
  });

  it('new: × on the medication\'s OWN custom time hands over to the next time', async () => {
    const user = userEvent.setup();
    renderNew('medication');
    await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
    fireEvent.change(screen.getByLabelText('Other time', { selector: 'input' }), { target: { value: '07:15' } });
    await user.click(screen.getByRole('checkbox', { name: /Bedtime$/ }));
    await user.click(screen.getByRole('button', { name: 'Remove 7:15 AM dose' }));
    expect(screen.getByRole('checkbox', { name: /Bedtime$/ })).toBeChecked();
    mutateCreate.mockClear();
    await user.click(screen.getByTestId('add-event-save'));
    await vi.waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
    expect(String((mutateCreate.mock.calls[0][0] as { scheduled_time: string }).scheduled_time).slice(0, 5)).toBe('21:00');
  });

  it('edit: the stored custom time changes in place (one dose) and saves', async () => {
    const user = userEvent.setup();
    renderEdit('medication');
    fireEvent.change(screen.getByLabelText('Change 2:30 PM dose time'), { target: { value: '16:45' } });
    expect(screen.getByTestId('time-chip-custom')).toHaveAccessibleName(/^4:45 PM\s*Other$/);
    mutateUpdate.mockClear();
    await user.click(screen.getByTestId('add-event-save'));
    await vi.waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    const { data } = mutateUpdate.mock.calls[0][0] as { data: { scheduled_time: string } };
    expect(String(data.scheduled_time).slice(0, 5)).toBe('16:45');
  });
});

describe('the zone caption: only when the viewer zone differs, the circle time first', () => {
  it('none when the zones agree', async () => {
    const user = userEvent.setup();
    renderNew('medication');
    await user.click(screen.getByRole('checkbox', { name: /Morning$/ }));
    expect(screen.queryByTestId('time-zone-caption')).toBeNull();
  });

  it('medication: one time, then two ("10:00 AM and 8:00 PM")', async () => {
    useCircleResult.timezone = 'America/New_York';
    const user = userEvent.setup();
    renderNew('medication');
    expect(screen.queryByTestId('time-zone-caption')).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: /Midday$/ }));
    expect(screen.getByTestId('time-zone-caption')).toHaveTextContent(
      'New York time · 10:00 AM your time (Denver)'
    );
    await user.click(screen.getByRole('checkbox', { name: /Bedtime$/ }));
    expect(screen.getByTestId('time-zone-caption')).toHaveTextContent(
      'New York time · 10:00 AM and 7:00 PM your time (Denver)'
    );
    // Not the older lines.
    expect(screen.queryByText(/Your time \//)).toBeNull();
    expect(screen.queryByText(/Times are for/)).toBeNull();
  });

  it('appointment: the range ("7:00 – 7:30 AM")', async () => {
    useCircleResult.timezone = 'America/New_York';
    const user = userEvent.setup();
    renderNew('appointment');
    await user.click(screen.getByRole('radio', { name: 'Pick a time' }));
    fireEvent.change(screen.getByLabelText('From', { selector: 'input' }), { target: { value: '09:00' } });
    expect(screen.getByTestId('appt-from-tile')).toHaveTextContent('9:00 AM');
    expect(screen.getByTestId('appt-to-tile')).toHaveTextContent('9:30 AM');
    expect(screen.getByTestId('time-zone-caption')).toHaveTextContent(
      'New York time · 7:00 – 7:30 AM your time (Denver)'
    );
    // Across noon: both ends say their own AM / PM.
    fireEvent.change(screen.getByLabelText('From', { selector: 'input' }), { target: { value: '13:45' } });
    expect(screen.getByTestId('time-zone-caption')).toHaveTextContent(
      'New York time · 11:45 AM – 12:15 PM your time (Denver)'
    );
  });

  it('task: the range (To starts at From + 30), then From alone once To is "No end"', async () => {
    useCircleResult.timezone = 'America/New_York';
    const user = userEvent.setup();
    renderNew('task');
    await user.click(screen.getByRole('radio', { name: 'Pick a time' }));
    fireEvent.change(screen.getByLabelText('From', { selector: 'input' }), { target: { value: '17:00' } });
    expect(screen.getByTestId('time-zone-caption')).toHaveTextContent(
      'New York time · 3:00 – 3:30 PM your time (Denver)'
    );
    fireEvent.change(screen.getByLabelText('To', { selector: 'input' }), { target: { value: '' } });
    expect(screen.getByTestId('time-zone-caption')).toHaveTextContent(
      'New York time · 3:00 PM your time (Denver)'
    );
  });

  it('Spanish wording', async () => {
    useCircleResult.timezone = 'America/New_York';
    const i18n = (await import('@/i18n')).default;
    await i18n.changeLanguage('es');
    try {
      const user = userEvent.setup();
      renderNew('task');
      await user.click(screen.getByRole('radio', { name: 'Elegir hora' }));
      fireEvent.change(screen.getByLabelText('Desde', { selector: 'input' }), { target: { value: '17:00' } });
      fireEvent.change(screen.getByLabelText('Hasta', { selector: 'input' }), { target: { value: '' } });
      expect(screen.getByTestId('task-to-tile')).toHaveTextContent(/Hasta\s*Sin fin/);
      expect(screen.getByTestId('time-zone-caption').textContent).toMatch(
        /^Hora de Nueva York · 3:00\s?p\.\s?m\. tu hora \(Denver\)$/
      );
      expect(screen.getByRole('radio', { name: 'Cualquier hora' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: '¿A qué hora?' })).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});

describe('the task From | To: To is optional ("No end")', () => {
  it('Pick a time shows From | To; To starts at From + 30 (as today); its × clears it to "No end"; Any time clears both', async () => {
    const user = userEvent.setup();
    renderNew('task');
    expect(screen.getByRole('radio', { name: 'Any time' })).toBeChecked();
    expect(screen.queryByTestId('task-from-tile')).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Pick a time' }));
    expect(screen.getByTestId('task-from-tile')).toHaveTextContent(/From\s*Choose a time/);
    // No From yet: To is shown, not offered.
    expect(screen.getByTestId('task-to-tile')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('From', { selector: 'input' }), { target: { value: '15:00' } });
    expect(screen.getByTestId('task-from-tile')).toHaveTextContent('3:00 PM');
    // The default length, as today's form (From + 30).
    expect(screen.getByTestId('task-to-tile')).toHaveTextContent(/To\s*3:30 PM/);
    expect(screen.getByLabelText('To', { selector: 'input' })).toHaveValue('15:30');
    expect(screen.getByRole('button', { name: /^More details/ })).toHaveTextContent('Details');
    fireEvent.change(screen.getByLabelText('To', { selector: 'input' }), { target: { value: '16:15' } });
    expect(screen.getByTestId('task-to-tile')).toHaveTextContent('4:15 PM');
    // Moving From keeps the length.
    fireEvent.change(screen.getByLabelText('From', { selector: 'input' }), { target: { value: '15:30' } });
    expect(screen.getByLabelText('To', { selector: 'input' })).toHaveValue('16:45');
    // The To's own "×" (Fix13: clear in the tile) clears it to "No end"; the picker has no clear of its own.
    await user.click(screen.getByTestId('task-to-tile'));
    await screen.findByRole('listbox', { name: 'Minute' });
    expect(screen.queryByRole('button', { name: 'No end' })).toBeNull();
    await user.keyboard('{Escape}');
    const clear = screen.getByRole('button', { name: 'Clear end time' });
    expect(clear).toHaveClass('h-11', 'w-11');
    await user.click(clear);
    expect(screen.getByTestId('task-to-tile')).toHaveTextContent(/To\s*No end/);
    expect(screen.getByLabelText('To', { selector: 'input' })).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Clear end time' })).toBeNull();
    // There is no end row in More details any more.
    await user.click(screen.getByRole('button', { name: /^More details/ }));
    expect(screen.queryByLabelText(/^End time/)).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Any time' }));
    expect(screen.queryByTestId('task-from-tile')).toBeNull();
  });

  it('the appointment To keeps its default (From + 30) and has NO × (it is required), nor a "No end"', async () => {
    const user = userEvent.setup();
    renderNew('appointment');
    await user.click(screen.getByRole('radio', { name: 'Pick a time' }));
    fireEvent.change(screen.getByLabelText('From', { selector: 'input' }), { target: { value: '09:00' } });
    expect(screen.getByLabelText('To', { selector: 'input' })).toHaveValue('09:30');
    expect(screen.queryByRole('button', { name: 'Clear end time' })).toBeNull();
    expect(screen.queryByTestId('appt-to-tile-box')).toBeNull();
    await user.click(screen.getByTestId('appt-to-tile'));
    await screen.findByRole('listbox', { name: 'Minute' });
    expect(screen.queryByRole('button', { name: 'No end' })).toBeNull();
  });
});

describe('a far-zone appointment (viewer Denver, circle Auckland): the tiles are the circle\'s day and clock', () => {
  it('create: the typed circle day / times are what is saved', async () => {
    useCircleResult.timezone = 'Pacific/Auckland';
    const user = userEvent.setup();
    renderNew('appointment');
    await user.type(screen.getByRole('textbox', { name: /^Title/ }), 'Cardiology');
    // Auckland's today on NOW (2027-02-10T18:40Z) is 2027-02-11.
    expect(screen.getByLabelText('Starts')).toHaveValue('2027-02-11');
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2027-02-20' } });
    await user.click(screen.getByRole('radio', { name: 'Every week' }));
    fireEvent.change(screen.getByLabelText('Repeats until'), { target: { value: '2027-03-20' } });
    await user.click(screen.getByRole('radio', { name: 'Pick a time' }));
    // 09:00 Auckland is 13:00 the day BEFORE in Denver: the tiles still read the circle's day and clock.
    fireEvent.change(screen.getByLabelText('From', { selector: 'input' }), { target: { value: '09:00' } });
    fireEvent.change(screen.getByLabelText('To', { selector: 'input' }), { target: { value: '10:30' } });
    expect(screen.getByTestId('starts-tile')).toHaveTextContent('Sat, Feb 20');
    expect(screen.getByTestId('repeats-until-tile')).toHaveTextContent('Sat, Mar 20');
    expect(screen.getByTestId('time-zone-caption')).toHaveTextContent(
      'Auckland time · 1:00 – 2:30 PM your time (Denver)'
    );
    await user.click(screen.getByTestId('add-event-save'));
    const body = JSON.parse(JSON.stringify(mutateCreate.mock.calls[0][0])) as Record<string, unknown>;
    expect({
      scheduled_date: body.scheduled_date,
      scheduled_time: String(body.scheduled_time).slice(0, 5),
      duration_minutes: body.duration_minutes,
      recurrence_rule: body.recurrence_rule,
      recurrence_end_date: body.recurrence_end_date,
    }).toEqual({
      scheduled_date: '2027-02-20',
      scheduled_time: '09:00',
      duration_minutes: 90,
      recurrence_rule: 'weekly',
      recurrence_end_date: '2027-03-20',
    });
  });

  it('edit: the stored circle-local values seed the tiles and an untouched save moves nothing', async () => {
    useCircleResult.timezone = 'Pacific/Auckland';
    const user = userEvent.setup();
    renderEdit('appointment');
    expect(screen.getByTestId('starts-tile')).toHaveTextContent('Mon, Feb 15');
    expect(screen.getByTestId('repeats-until-tile')).toHaveTextContent('Sat, May 1');
    expect(screen.getByLabelText('From', { selector: 'input' })).toHaveValue('09:00');
    expect(screen.getByLabelText('To', { selector: 'input' })).toHaveValue('09:45');
    await user.click(screen.getByTestId('add-event-save'));
    const { data } = JSON.parse(JSON.stringify(mutateUpdate.mock.calls[0][0])) as {
      data: Record<string, unknown>;
    };
    expect({
      scheduled_date: data.scheduled_date,
      scheduled_time: String(data.scheduled_time).slice(0, 5),
      duration_minutes: data.duration_minutes,
      recurrence_end_date: data.recurrence_end_date,
    }).toEqual({
      scheduled_date: '2027-02-15',
      scheduled_time: '09:00',
      duration_minutes: 45,
      recurrence_end_date: '2027-05-01',
    });
  });
});

describe('the Reminders row: expand / collapse and the nudge', () => {
  it('expanding scrolls the first control into view with block "nearest" (smooth); collapsing does not', async () => {
    const user = userEvent.setup();
    renderNew('medication');
    await user.click(screen.getByRole('checkbox', { name: /Evening$/ }));
    scrollIntoView.mockClear();
    const row = screen.getByTestId('reminders-summary-row');
    await user.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('switch', { name: /Enable notifications/ })).toBeVisible();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(document.getElementById('notifications_enabled'));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
    expect(row).toHaveFocus();
    await user.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('Reduce Motion: the same nudge, instant', async () => {
    reducedMotion = true;
    const user = userEvent.setup();
    renderNew('task');
    await user.click(screen.getByRole('radio', { name: 'Pick a time' }));
    fireEvent.change(screen.getByLabelText('From', { selector: 'input' }), { target: { value: '15:00' } });
    scrollIntoView.mockClear();
    await user.click(screen.getByTestId('reminders-summary-row'));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' });
  });
});
