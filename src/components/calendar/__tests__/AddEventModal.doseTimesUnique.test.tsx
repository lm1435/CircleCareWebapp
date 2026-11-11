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

describe('the dose summary line (circle New York)', () => {
  const summary = () => screen.getByTestId('dose-summary');

  it('1 dose, every day: "1 dose a day · 8:00 AM", announced politely', async () => {
    const user = await setup('America/New_York');
    await user.click(chip(/Morning/));
    expect(summary()).toHaveTextContent(/^1 dose a day · 8:00 AM$/);
    expect(summary().closest('[role="status"]')).not.toBeNull();
  });

  it('2 doses: in time order, with the remove hint', async () => {
    const user = await setup('America/New_York');
    await user.click(chip(/Bedtime/));
    await user.click(chip(/Morning/));
    expect(summary()).toHaveTextContent(/^2 doses a day · 8:00 AM, 9:00 PM · Tap a time again to remove it$/);
  });

  it('custom doses only: no "tap again" hint (a custom chip is changed by a click, removed by its ×)', async () => {
    const user = await setup('America/New_York');
    await other(user, '19:45');
    await other(user, '07:15');
    expect(summary()).toHaveTextContent(/^2 doses a day · 7:15 AM, 7:45 PM$/);
    // The custom chips are in time order too.
    expect(customChips()).toEqual(['7:15 AM Other', '7:45 PM Other']);
  });

  it('0 doses: no line', async () => {
    await setup('America/New_York');
    expect(screen.queryByTestId('dose-summary')).toBeNull();
  });

  it('not daily: "2 doses · …" (no "a day")', async () => {
    const user = await setup('America/New_York');
    await user.click(screen.getByRole('radio', { name: 'Every week' }));
    await user.click(chip(/Morning/));
    await user.click(chip(/Evening/));
    expect(summary()).toHaveTextContent(/^2 doses · 8:00 AM, 6:00 PM · Tap a time again to remove it$/);
  });

  it('When needed: no line', async () => {
    const user = await setup('America/New_York');
    await user.click(chip(/Morning/));
    await user.click(screen.getByRole('radio', { name: 'When needed' }));
    expect(screen.queryByTestId('dose-summary')).toBeNull();
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
