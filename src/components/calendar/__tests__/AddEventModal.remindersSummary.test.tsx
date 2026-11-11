import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { Analytics } from '@/lib/analytics';
import { resetLargeTextReports } from '@/lib/largeText';
import { AddEventModal } from '../AddEventModal';

// The simple forms' "Reminders" summary row (owner 2026-11-10, mobile parity). Reminders are the
// setting people misread: a customer saw every box unchecked on a medication and believed it was
// silent while the 15 / 30 / 60 minute follow-ups (driven by notifications_enabled alone) still
// fired. So the row sits OUTSIDE the folded More details, always visible, says what WILL happen,
// and one tap lands on the Reminders card.

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

vi.mock('../DoseQuietHoursNote', () => ({ DoseQuietHoursNote: () => null }));
vi.mock('@/api/drugs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/drugs')>();
  return { ...actual, searchDrugs: vi.fn().mockResolvedValue([]) };
});
vi.mock('@/hooks/useProviders', () => ({
  useProviders: () => ({ providers: [], isSuccess: true }),
}));
vi.mock('@/hooks/useCalendarEvents', () => ({
  useCreateEvent: () => ({ mutateAsync: vi.fn().mockResolvedValue({ id: 'new' }), isPending: false }),
  useUpdateEvent: () => ({ mutateAsync: vi.fn().mockResolvedValue({ id: 'x' }), isPending: false }),
  useCachedCircleEvents: () => [],
}));
vi.mock('@/hooks/useSeriesRoot', () => ({
  useSeriesRoot: (_c: string, event: unknown) => ({ root: event ?? null }),
}));
vi.mock('@/store/authStore', () => ({
  useAuthStore: (select: (s: { user: { id: string } | null }) => unknown) =>
    select({ user: { id: ME_ID } }),
}));
const useCircleResult = {
  circle: { recipient_name: 'Rosa', is_self_care: false, owner_id: ME_ID },
  circleSummary: undefined,
  timezone: 'America/Denver',
  members: [
    { id: ANA_ID, email: 'ana@example.com', first_name: 'Ana', is_care_recipient: false },
    { id: ME_ID, email: 'luis@example.com', first_name: 'Luis', is_care_recipient: false },
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

let summaryToggled: ReturnType<typeof vi.spyOn>;
const scrollIntoView = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  resetLargeTextReports();
  Element.prototype.scrollIntoView = scrollIntoView;
  summaryToggled = vi.spyOn(Analytics, 'remindersSummaryToggled').mockImplementation(() => {});
  vi.spyOn(Analytics, 'entryFormOpened').mockImplementation(() => {});
  vi.spyOn(Analytics, 'entryFormStepCompleted').mockImplementation(() => {});
  vi.spyOn(Analytics, 'timeChipSelected').mockImplementation(() => {});
  vi.spyOn(Analytics, 'largeTextLayout').mockImplementation(() => {});
  vi.spyOn(Analytics, 'medicationFormAbandoned').mockImplementation(() => {});
  vi.spyOn(Analytics, 'appointmentFormAbandoned').mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (i18n.language !== 'en') await i18n.changeLanguage('en');
});

const renderNew = (initialType: 'medication' | 'appointment' | 'task') =>
  render(<AddEventModal circleId={CIRCLE_ID} initialType={initialType} onClose={vi.fn()} />);

const row = () => screen.getByTestId('reminders-summary-row');
const value = () => screen.getByTestId('reminders-summary-value');
const moreToggle = () => screen.getByRole('button', { name: /^More details/ });
const morePanel = () => document.getElementById('more-details-panel') as HTMLElement;
const remindersPanel = () => screen.getByTestId('reminders-summary-panel');
const fieldset = () => screen.getByTestId('reminders-fieldset');
// A NEW medication's time chips are multi-select checkboxes (build 11, owner 2026-11-10).
const timeChips = () => screen.getByRole('group', { name: 'Common dose times' });

async function newMedicationWithTime() {
  const user = userEvent.setup();
  renderNew('medication');
  // A new medication's time comes from a chip; reminders always apply to a medication.
  await user.click(within(timeChips()).getByRole('checkbox', { name: /Morning/ }));
  return user;
}

function event(over: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'evt-1',
    circle_id: CIRCLE_ID,
    title: 'Checkup',
    event_type: 'appointment',
    scheduled_date: '2027-02-15',
    scheduled_time: '10:00',
    created_at: '2027-01-01T00:00:00Z',
    updated_at: '2027-01-01T00:00:00Z',
    notifications_enabled: true,
    reminder_at_due: true,
    reminder_24h: false,
    reminder_1h: true,
    reminder_30m: false,
    reminder_15m: false,
    description: null,
    location: null,
    assigned_to: null,
    duration_minutes: 60,
    recurrence_rule: null,
    recurrence_end_date: null,
    completed_at: null,
    ...over,
  } as CalendarEvent;
}

describe('Reminders summary row: placement and live text', () => {
  it('a new medication shows the row OUTSIDE More details, with More details closed AND open', async () => {
    const user = await newMedicationWithTime();
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(row()).toBeVisible();
    expect(morePanel()).not.toContainElement(row());
    expect(value()).toHaveTextContent('At the scheduled time · follow-ups on');
    expect(row()).toHaveAccessibleName('Reminders: At the scheduled time · follow-ups on');
    expect(row()).toHaveAccessibleDescription('Shows the reminder settings.');
    expect(within(row()).getByTestId('reminders-summary-change')).toHaveTextContent('Change');

    await user.click(moreToggle());
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(row()).toBeVisible();
  });

  it('sits directly above More details (the next sibling is the disclosure)', async () => {
    await newMedicationWithTime();
    expect(screen.getByTestId('reminders-summary').nextElementSibling).toContainElement(moreToggle());
  });

  it('renders the Spanish copy', async () => {
    await newMedicationWithTime();
    await act(async () => {
      await i18n.changeLanguage('es');
    });
    expect(value()).toHaveTextContent('A la hora programada · seguimientos activados');
    expect(row()).toHaveAccessibleName(
      'Recordatorios: A la hora programada · seguimientos activados'
    );
  });

  it('an edited appointment shows its saved reminders (earliest first), collapsed', () => {
    render(<AddEventModal circleId={CIRCLE_ID} event={event({})} onClose={vi.fn()} />);
    expect(value()).toHaveTextContent('1 hour before, at the scheduled time');
    expect(row()).toHaveAttribute('aria-expanded', 'false');
    expect(fieldset()).not.toBeVisible();
  });

  it('an as-needed medication shows NO row (its no-reminders note stays in More details)', async () => {
    const user = userEvent.setup();
    renderNew('medication');
    await user.click(screen.getByRole('radio', { name: 'When needed' }));
    expect(screen.queryByTestId('reminders-summary-row')).toBeNull();
    expect(screen.queryByTestId('reminders-fieldset')).toBeNull();
    expect(morePanel()).toContainElement(screen.getByTestId('as-needed-no-reminders'));
  });
});

describe('Reminders summary row: accordion', () => {
  it('collapsed by default; the button controls a mounted panel', async () => {
    await newMedicationWithTime();
    expect(row()).toHaveAttribute('aria-expanded', 'false');
    expect(row()).toHaveAttribute('aria-controls', remindersPanel().id);
    expect(document.getElementById(row().getAttribute('aria-controls') as string)).toBe(remindersPanel());
    expect(remindersPanel()).not.toBeVisible();
    expect(remindersPanel()).toContainElement(fieldset());
  });

  it('tap expands the card inline under the row (More details untouched, the nudge, focus stays); tap again folds it', async () => {
    const user = await newMedicationWithTime();
    scrollIntoView.mockClear();
    await user.click(row());
    expect(row()).toHaveAttribute('aria-expanded', 'true');
    expect(fieldset()).toBeVisible();
    const master = screen.getByRole('switch', { name: /Enable notifications/ });
    expect(master).toBeVisible();
    // Directly under the row, not in More details, which stays as it was.
    expect(row().nextElementSibling).toBe(remindersPanel());
    expect(morePanel()).not.toContainElement(fieldset());
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'false');
    // THE NUDGE (build 11): the card's first control is brought into view by the hidden amount only
    // (`block: 'nearest'` scrolls nothing when it already shows); the row keeps focus.
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById('notifications_enabled'));
    expect(scrollIntoView.mock.contexts[0]).toBe(master);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
    expect(row()).toHaveFocus();
    // Expanded: a chevron-up instead of "Change".
    expect(within(row()).queryByTestId('reminders-summary-change')).toBeNull();
    expect(within(row()).getByTestId('reminders-summary-collapse')).toBeInTheDocument();
    expect(summaryToggled).toHaveBeenLastCalledWith('medication', 'set', 'expand');

    await user.click(row());
    expect(row()).toHaveAttribute('aria-expanded', 'false');
    expect(fieldset()).not.toBeVisible();
    expect(within(row()).getByTestId('reminders-summary-change')).toBeInTheDocument();
    expect(summaryToggled).toHaveBeenLastCalledWith('medication', 'set', 'collapse');
    expect(summaryToggled).toHaveBeenCalledTimes(2);
    // Folding never scrolls.
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('the nudge is instant under Reduce Motion (behavior auto), still block nearest', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      const user = await newMedicationWithTime();
      scrollIntoView.mockClear();
      await user.click(row());
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' });
      expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById('notifications_enabled'));
    } finally {
      window.matchMedia = original;
    }
  });

  it('opening More details does not expand the card, and the card stays named "Reminders"', async () => {
    const user = await newMedicationWithTime();
    await user.click(moreToggle());
    expect(fieldset()).not.toBeVisible();
    await user.click(row());
    // The legend is visually hidden (the row says "Reminders") but still names the group.
    expect(screen.getByRole('group', { name: 'Reminders' })).toBe(fieldset());
  });

  it('updates live while expanded, and reports the state it showed', async () => {
    const user = await newMedicationWithTime();
    await user.click(row());
    await user.click(screen.getByRole('checkbox', { name: /^At the scheduled time/ }));
    expect(value()).toHaveTextContent('Follow-ups only · nothing at the scheduled time');
    await user.click(screen.getByRole('switch', { name: /Enable notifications/ }));
    expect(value()).toHaveTextContent(/^off$/);
    await user.click(row());
    expect(summaryToggled).toHaveBeenLastCalledWith('medication', 'off', 'collapse');
  });

  for (const kind of ['task', 'appointment'] as const) {
    it(`${kind}: More details holds no Reminders card; the row's accordion does`, async () => {
      const user = userEvent.setup();
      render(
        <AddEventModal
          circleId={CIRCLE_ID}
          event={event({ event_type: kind, duration_minutes: kind === 'task' ? null : 60 })}
          onClose={vi.fn()}
        />
      );
      if (moreToggle().getAttribute('aria-expanded') !== 'true') await user.click(moreToggle());
      expect(morePanel()).not.toContainElement(fieldset());
      expect(within(morePanel()).queryByRole('switch', { name: /Enable notifications/ })).toBeNull();
      await user.click(row());
      expect(fieldset()).toBeVisible();
      expect(summaryToggled).toHaveBeenLastCalledWith(kind, 'set', 'expand');
    });
  }
});

describe('Reminders summary row: no time yet (task / appointment)', () => {
  for (const kind of ['task', 'appointment'] as const) {
    it(`${kind}: muted "Pick a time" row, no Change, tap focuses the "Pick a time" choice; a time switches it to the summary`, async () => {
      const user = userEvent.setup();
      renderNew(kind);
      expect(row()).toHaveAttribute('data-variant', 'pickTime');
      expect(value()).toHaveTextContent('Pick a time to get reminders');
      expect(row()).toHaveAccessibleName(
        'Reminders: pick a time to get reminders. Goes to the time choice.'
      );
      expect(within(row()).queryByTestId('reminders-summary-change')).toBeNull();

      await user.click(row());
      // What time?'s first choice, "Pick a time" (build 11).
      const pick = within(screen.getByRole('radiogroup', { name: 'What time?' })).getByRole('radio', {
        name: 'Pick a time',
      });
      await waitFor(() => expect(pick).toHaveFocus());
      expect(scrollIntoView.mock.contexts.at(-1)).toBe(pick);
      expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'center', behavior: 'smooth' });
      // It goes to the time choice, NOT More details; it expands nothing and is not the summary tap.
      expect(moreToggle()).toHaveAttribute('aria-expanded', 'false');
      expect(row()).not.toHaveAttribute('aria-expanded');
      expect(summaryToggled).not.toHaveBeenCalled();

      await user.click(pick);
      fireEvent.change(document.getElementById('scheduled_time') as HTMLInputElement, { target: { value: '10:00' } });
      await waitFor(() => expect(row()).toHaveAttribute('data-variant', 'summary'));
      expect(value()).toHaveTextContent('At the scheduled time');
      await user.click(row());
      expect(summaryToggled).toHaveBeenCalledWith(kind, 'set', 'expand');
    });
  }

  it('Spanish pick-time copy', async () => {
    await i18n.changeLanguage('es');
    renderNew('task');
    expect(value()).toHaveTextContent('Elige una hora para recibir recordatorios');
  });
});

describe('appointment More details without a time (item 8)', () => {
  it('has no stray element (divider / empty block) between Location and Details', () => {
    render(
      <AddEventModal
        circleId={CIRCLE_ID}
        event={event({ scheduled_time: null, duration_minutes: null, location: 'Clinic' })}
        onClose={vi.fn()}
      />
    );
    const panelBody = morePanel().firstElementChild as HTMLElement;
    const children = Array.from(panelBody.children);
    const locIdx = children.findIndex((el) => el.querySelector('#location'));
    const detIdx = children.findIndex((el) => el.querySelector('#description'));
    expect(locIdx).toBeGreaterThan(-1);
    expect(detIdx).toBe(locIdx + 1);
    expect(panelBody.querySelector('hr')).toBeNull();
  });
});
