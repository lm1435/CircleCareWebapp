import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { Analytics } from '@/lib/analytics';
import { resetLargeTextReports } from '@/lib/largeText';
import { AddEventModal } from '../AddEventModal';

// WEB PARITY for mobile's AddEventDoseTimesUnique: a NEW medication's "What time?" holds each time ONCE, says
// "9:00 AM is already a dose time." when a custom pick (or a custom chip changed in place) lands on a time it
// already has, never saves one circle clock twice, shows ONE past-time note naming the times, and states what will
// be saved under the chips ("2 doses a day · 8:00 AM, 9:00 PM · Tap a time again to remove it").
// The owner's iOS 1.4.1 (14) screenshot: Bedtime on, then "Other…" 9:00 AM twice. Times compare on the CIRCLE's
// clock. The viewer is the process zone (no pin here): run under TZ=America/Denver and TZ=Pacific/Auckland too.

const CIRCLE_ID = 'circle-1';
const VIEWER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

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
  timezone: 'America/New_York',
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

let dupSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  resetLargeTextReports();
  mutateCreate.mockResolvedValue({ id: 'new' });
  for (const name of [
    'entryFormOpened',
    'entryFormStepCompleted',
    'timeChipSelected',
    'entrySaveTapped',
    'medicationCreated',
    'largeTextLayout',
    'firstRunMedicationSaved',
  ] as const) {
    vi.spyOn(Analytics, name).mockImplementation(() => {});
  }
  dupSpy = vi.spyOn(Analytics, 'doseTimeDuplicateBlocked').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const timeChips = () => screen.getByRole('group', { name: 'Common dose times' });
const chip = (name: RegExp) => within(timeChips()).getByRole('checkbox', { name });
const otherTile = () => screen.getByTestId('time-chip-other');
const otherInput = () => screen.getByLabelText('Other time', { selector: 'input' });
const customChips = () => screen.queryAllByTestId('time-chip-custom').map((c) => c.textContent);

async function setup(zone: string, now?: string) {
  if (now) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(now));
  }
  useCircleResult.timezone = zone;
  const user = userEvent.setup();
  render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);
  await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
  return user;
}
/** "Other…": a new dose (or the first time), picked on the circle's clock. */
async function other(user: ReturnType<typeof userEvent.setup>, hhmm: string) {
  await user.click(otherTile());
  fireEvent.change(otherInput(), { target: { value: hhmm } });
  await user.keyboard('{Escape}');
}
async function savedTimes(user: ReturnType<typeof userEvent.setup>) {
  mutateCreate.mockClear();
  await user.click(screen.getByTestId('add-event-save'));
  await waitFor(() => expect(mutateCreate).toHaveBeenCalled());
  return mutateCreate.mock.calls.map((c) => String(c[0].scheduled_time).slice(0, 5)).sort();
}

describe.each([VIEWER_TZ, VIEWER_TZ === 'Asia/Tokyo' ? 'America/Denver' : 'Asia/Tokyo'])(
  `viewer ${VIEWER_TZ}, circle %s: dose times are unique`,
  (zone) => {
    it('the screenshot: Bedtime, then "Other…" 9:00 AM twice keeps ONE 9:00 AM dose and says so', async () => {
      const user = await setup(zone);
      await user.click(chip(/Bedtime/));
      await other(user, '09:00');
      expect(customChips()).toEqual(['9:00 AM Other']);
      expect(screen.queryByTestId('dose-time-duplicate-note')).toBeNull();
      await other(user, '09:00');
      expect(customChips()).toEqual(['9:00 AM Other']);
      const note = screen.getByTestId('dose-time-duplicate-note');
      expect(note).toHaveTextContent('9:00 AM is already a dose time.');
      expect(note.closest('[role="status"]')).not.toBeNull();
      expect(dupSpy).toHaveBeenCalledWith({ source: 'other' });
      expect(await savedTimes(user)).toEqual(['09:00', '21:00']);
    });

    it('a custom time equal to a PRESET dose (Morning on, "Other…" 8:00 AM) adds nothing', async () => {
      const user = await setup(zone);
      await user.click(chip(/Morning/));
      await other(user, '08:00');
      expect(customChips()).toEqual([]);
      expect(screen.getByTestId('dose-time-duplicate-note')).toHaveTextContent('8:00 AM is already a dose time.');
      expect(await savedTimes(user)).toEqual(['08:00']);
    });

    it('a custom 8:00 AM IS the Morning chip: tapping Morning then removes it, never a second 8:00', async () => {
      const user = await setup(zone);
      await user.click(chip(/Bedtime/));
      await other(user, '08:00');
      expect(chip(/Morning/)).toBeChecked();
      await user.click(chip(/Morning/));
      expect(chip(/Morning/)).not.toBeChecked();
      expect(await savedTimes(user)).toEqual(['21:00']);
    });

    it('editing a custom EXTRA in place onto another dose keeps its own time and says so', async () => {
      const user = await setup(zone);
      await user.click(chip(/Morning/));
      await other(user, '14:00');
      fireEvent.change(screen.getByLabelText('Change 2:00 PM dose time', { selector: 'input' }), {
        target: { value: '08:00' },
      });
      expect(customChips()).toEqual(['2:00 PM Other']);
      expect(screen.getByTestId('dose-time-duplicate-note')).toHaveTextContent('8:00 AM is already a dose time.');
      expect(dupSpy).toHaveBeenCalledWith({ source: 'custom_chip' });
      expect(await savedTimes(user)).toEqual(['08:00', '14:00']);
    });

    it('editing the custom FIRST dose in place onto an extra keeps its own time and says so', async () => {
      const user = await setup(zone);
      await other(user, '07:00');
      await user.click(chip(/Morning/));
      fireEvent.change(screen.getByLabelText('Change 7:00 AM dose time', { selector: 'input' }), {
        target: { value: '08:00' },
      });
      expect(customChips()).toEqual(['7:00 AM Other']);
      expect(screen.getByTestId('dose-time-duplicate-note')).toHaveTextContent('8:00 AM is already a dose time.');
      expect(await savedTimes(user)).toEqual(['07:00', '08:00']);
    });

    it('the note clears on the next dose change; the 4-dose cap still holds', async () => {
      const user = await setup(zone);
      await user.click(chip(/Morning/));
      await other(user, '08:00');
      expect(screen.getByTestId('dose-time-duplicate-note')).toBeInTheDocument();
      await user.click(chip(/Midday/));
      expect(screen.queryByTestId('dose-time-duplicate-note')).toBeNull();
      await user.click(chip(/Midday/)); // back to the doses it was said about: it stays retired
      expect(screen.queryByTestId('dose-time-duplicate-note')).toBeNull();
      await user.click(chip(/Midday/));
      await user.click(chip(/Evening/));
      await other(user, '23:00');
      expect(otherTile()).toBeDisabled();
      expect(chip(/Bedtime/)).toBeDisabled();
      expect(await savedTimes(user)).toEqual(['08:00', '12:00', '18:00', '23:00']);
    });
  }
);

describe('the dose summary and its note (design B, circle New York)', () => {
  const summary = () => screen.getByTestId('dose-summary');
  const note = () => screen.queryByTestId('dose-summary-note');
  /** The polite live region: what a screen reader is told on a change. */
  const statusOf = (el: HTMLElement) => el.closest('[role="status"]');

  it('1 dose, every day: the summary, then the note inviting a second, both announced', async () => {
    const user = await setup('America/New_York');
    await user.click(chip(/Morning/));
    expect(summary()).toHaveTextContent(/^1 dose a day · 8:00 AM$/);
    expect(note()).toHaveTextContent(/^Taken more than once a day\? Tap another time\.$/);
    expect(statusOf(summary())).not.toBeNull();
    expect(statusOf(note()!)).toBe(statusOf(summary()));
  });

  it('1 dose, not daily: the non-daily wording and its own note', async () => {
    const user = await setup('America/New_York');
    await user.click(screen.getByRole('radio', { name: 'Every week' }));
    await user.click(chip(/Bedtime/));
    expect(summary()).toHaveTextContent(/^1 dose · 9:00 PM$/);
    expect(note()).toHaveTextContent(/^Taken more than once\? Tap another time\.$/);
  });

  it('2 doses with a preset: in time order; the note says how to remove one and is never announced', async () => {
    const user = await setup('America/New_York');
    await user.click(chip(/Bedtime/));
    await user.click(chip(/Morning/));
    expect(summary()).toHaveTextContent(/^2 doses a day · 8:00 AM, 9:00 PM$/);
    expect(note()).toHaveTextContent(/^Tap a time again to remove it\.$/);
    expect(statusOf(note()!)).toBeNull();
  });

  it('custom doses only: no note (a custom chip is changed by a click, removed by its ×)', async () => {
    const user = await setup('America/New_York');
    await other(user, '19:45');
    await other(user, '07:15');
    expect(summary()).toHaveTextContent(/^2 doses a day · 7:15 AM, 7:45 PM$/);
    expect(note()).toBeNull();
    // The custom chips are in time order too.
    expect(customChips()).toEqual(['7:15 AM Other', '7:45 PM Other']);
  });

  it('4 doses (the limit): no note', async () => {
    const user = await setup('America/New_York');
    for (const name of [/Morning/, /Midday/, /Evening/, /Bedtime/]) await user.click(chip(name));
    expect(summary()).toHaveTextContent(/^4 doses a day · 8:00 AM, 12:00 PM, 6:00 PM, 9:00 PM$/);
    expect(note()).toBeNull();
  });

  it('0 doses: no summary and no note (the hint carries it)', async () => {
    await setup('America/New_York');
    expect(screen.queryByTestId('dose-summary')).toBeNull();
    expect(note()).toBeNull();
  });

  it('not daily, 2 doses: "2 doses · …" (no "a day")', async () => {
    const user = await setup('America/New_York');
    await user.click(screen.getByRole('radio', { name: 'Every week' }));
    await user.click(chip(/Morning/));
    await user.click(chip(/Evening/));
    expect(summary()).toHaveTextContent(/^2 doses · 8:00 AM, 6:00 PM$/);
    expect(note()).toHaveTextContent(/^Tap a time again to remove it\.$/);
  });

  it('When needed: no summary', async () => {
    const user = await setup('America/New_York');
    await user.click(chip(/Morning/));
    await user.click(screen.getByRole('radio', { name: 'When needed' }));
    expect(screen.queryByTestId('dose-summary')).toBeNull();
    expect(note()).toBeNull();
  });
});

describe('ONE past-time note naming the times (circle New York, 12:30 there)', () => {
  const NOON_NY = '2026-06-15T16:30:00Z';

  it('two past doses and a future one: one note, the past times in order', async () => {
    const user = await setup('America/New_York', NOON_NY);
    await user.click(chip(/Evening/)); // 6:00 PM: still ahead
    await other(user, '09:00');
    await user.click(chip(/Morning/));
    expect(screen.getAllByTestId(/^dose-past-time-note/)).toHaveLength(1);
    expect(screen.getByTestId('dose-past-time-note')).toHaveTextContent(
      'Starts with the next dose. 8:00 AM and 9:00 AM have already passed today.'
    );
  });

  it('one past dose: names it', async () => {
    const user = await setup('America/New_York', NOON_NY);
    await user.click(chip(/Evening/));
    await other(user, '09:00');
    expect(screen.getByTestId('dose-past-time-note')).toHaveTextContent(
      'Starts with the next dose. 9:00 AM has already passed today.'
    );
  });

  it('no past dose: no note', async () => {
    const user = await setup('America/New_York', NOON_NY);
    await user.click(chip(/Evening/));
    expect(screen.queryAllByTestId(/^dose-past-time-note/)).toHaveLength(0);
  });
});

describe('the hint under "What time?" and the add / added marks (design B)', () => {
  const marks = () => within(timeChips()).getAllByTestId('time-chip-mark');
  const markOf = (name: RegExp) => within(chip(name)).getByTestId('time-chip-mark');

  it('a new scheduled medication shows the hint, as plain text right after the heading', async () => {
    const user = await setup('America/New_York');
    const hint = screen.getByTestId('dose-times-hint');
    expect(hint).toHaveTextContent("Tap every time it's taken.");
    expect(hint).not.toHaveAttribute('aria-hidden');
    const heading = screen.getByRole('heading', { name: /What time\?/ });
    expect(heading.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(hint.compareDocumentPosition(timeChips()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(chip(/Morning/));
    expect(screen.getByTestId('dose-times-hint')).toHaveTextContent("Tap every time it's taken.");
  });

  it("a11y: the hint (a <p> with an id) joins the chips group's aria-describedby", async () => {
    await setup('America/New_York');
    const hint = screen.getByTestId('dose-times-hint');
    expect(hint.id).toBe('time-chips-hint');
    expect(timeChips().getAttribute('aria-describedby')?.split(' ')).toContain('time-chips-hint');
    expect(timeChips()).toHaveAccessibleDescription(/Tap every time it's taken\./);
  });

  it('each preset carries a mark: "+" (muted) until chosen, a check once chosen, in the same 12px slot', async () => {
    const user = await setup('America/New_York');
    expect(marks()).toHaveLength(4);
    for (const m of marks()) expect(m).toHaveAttribute('data-mark', 'add');
    const before = markOf(/Bedtime/);
    expect(before).toHaveClass('text-ink-3');
    expect(before.firstElementChild).toHaveStyle({ width: '12px', height: '12px' });
    await user.click(chip(/Bedtime/));
    const after = markOf(/Bedtime/);
    expect(after).toHaveAttribute('data-mark', 'added');
    expect(after).toHaveClass('text-cream');
    expect(after.firstElementChild).toHaveStyle({ width: '12px', height: '12px' }); // the reserved slot
    expect(markOf(/Morning/)).toHaveAttribute('data-mark', 'add');
  });

  it('marks are aria-hidden (the checkbox state says it), chips stay checkboxes; none on custom chips or "Other…"', async () => {
    const user = await setup('America/New_York');
    await user.click(chip(/Morning/));
    await other(user, '14:00');
    for (const m of marks()) expect(m).toHaveAttribute('aria-hidden', 'true');
    expect(chip(/Morning/)).toBeChecked();
    expect(chip(/Morning/)).toHaveAccessibleName(/^8:00 AM\s*Morning$/);
    expect(within(screen.getByTestId('time-chip-custom-box')).queryByTestId('time-chip-mark')).toBeNull();
    expect(within(otherTile()).queryByTestId('time-chip-mark')).toBeNull();
  });

  it('When needed: no hint', async () => {
    const user = await setup('America/New_York');
    await user.click(screen.getByRole('radio', { name: 'When needed' }));
    expect(screen.queryByTestId('dose-times-hint')).toBeNull();
  });
});

describe('copy (EN and ES, mobile parity)', () => {
  it('the hint, the notes and the summary keys', async () => {
    const en = (await import('@/i18n/en/calendar.json')).default.addEvent.simple;
    const es = (await import('@/i18n/es/calendar.json')).default.addEvent.simple;
    expect(en.doseTimesHint).toBe("Tap every time it's taken.");
    expect(es.doseTimesHint).toBe('Toca cada hora en que se toma.');
    expect(en.doseSummaryAddDaily).toBe('Taken more than once a day? Tap another time.');
    expect(es.doseSummaryAddDaily).toBe('¿Se toma más de una vez al día? Toca otra hora.');
    expect(en.doseSummaryAdd).toBe('Taken more than once? Tap another time.');
    expect(es.doseSummaryAdd).toBe('¿Se toma más de una vez? Toca otra hora.');
    expect(en.doseSummaryRemoveHint).toBe('Tap a time again to remove it.');
    expect(es.doseSummaryRemoveHint).toBe('Toca una hora otra vez para quitarla.');
    expect(en.doseSummaryDaily_one).toBe('{{count}} dose a day · {{times}}');
    expect(es.doseSummaryDaily_one).toBe('{{count}} dosis al día · {{times}}');
  });
});
