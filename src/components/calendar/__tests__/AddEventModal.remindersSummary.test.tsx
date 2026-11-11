import { act, render, screen, waitFor, within } from '@testing-library/react';
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

let summaryOpened: ReturnType<typeof vi.spyOn>;
const scrollIntoView = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  resetLargeTextReports();
  Element.prototype.scrollIntoView = scrollIntoView;
  summaryOpened = vi.spyOn(Analytics, 'remindersSummaryOpened').mockImplementation(() => {});
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
const timeChips = () => screen.getByRole('radiogroup', { name: 'Common dose times' });

async function newMedicationWithTime() {
  const user = userEvent.setup();
  renderNew('medication');
  // A new medication's time comes from a chip; reminders always apply to a medication.
  await user.click(within(timeChips()).getByRole('radio', { name: /Morning/ }));
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
    expect(row().nextElementSibling).toContainElement(moreToggle());
  });

  it('updates live: unticking "At the scheduled time" reads "Follow-ups only · nothing at the scheduled time"', async () => {
    const user = await newMedicationWithTime();
    await user.click(moreToggle());
    await user.click(screen.getByRole('checkbox', { name: /^At the scheduled time/ }));
    expect(value()).toHaveTextContent('Follow-ups only · nothing at the scheduled time');
    await user.click(screen.getByRole('switch', { name: /Enable notifications/ }));
    expect(value()).toHaveTextContent(/^off$/);
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

  it('an edited appointment shows its saved reminders (earliest first)', () => {
    render(<AddEventModal circleId={CIRCLE_ID} event={event({})} onClose={vi.fn()} />);
    expect(value()).toHaveTextContent('1 hour before, at the scheduled time');
  });

  it('an as-needed medication shows NO row', async () => {
    const user = userEvent.setup();
    renderNew('medication');
    await user.click(screen.getByRole('radio', { name: 'When needed' }));
    expect(screen.queryByTestId('reminders-summary-row')).toBeNull();
  });
});

describe('Reminders summary row: tap', () => {
  it('with More details closed: opens it, scrolls to the Reminders card and focuses its switch', async () => {
    const user = await newMedicationWithTime();
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'false');
    await user.click(row());
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'true');
    const fieldset = screen.getByTestId('reminders-fieldset');
    expect(fieldset).toBeVisible();
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(fieldset);
    expect(screen.getByRole('switch', { name: /Enable notifications/ })).toHaveFocus();
    expect(summaryOpened).toHaveBeenCalledTimes(1);
    expect(summaryOpened).toHaveBeenCalledWith('medication', 'set', false);
  });

  it('with More details already open: keeps it open and just scrolls', async () => {
    const user = await newMedicationWithTime();
    await user.click(moreToggle());
    await user.click(row());
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(screen.getByTestId('reminders-fieldset'));
    // A second tap never closes it either.
    await user.click(row());
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(summaryOpened).toHaveBeenNthCalledWith(1, 'medication', 'set', true);
  });

  it('reports the summary state it showed (follow_ups_only)', async () => {
    const user = await newMedicationWithTime();
    await user.click(moreToggle());
    await user.click(screen.getByRole('checkbox', { name: /^At the scheduled time/ }));
    await user.click(row());
    expect(summaryOpened).toHaveBeenCalledWith('medication', 'follow_ups_only', true);
  });
});

describe('Reminders summary row: no time yet (task / appointment)', () => {
  for (const kind of ['task', 'appointment'] as const) {
    it(`${kind}: muted "Pick a time" row, no Change, tap focuses the Time choice; a time switches it to the summary`, async () => {
      const user = userEvent.setup();
      renderNew(kind);
      expect(row()).toHaveAttribute('data-variant', 'pickTime');
      expect(value()).toHaveTextContent('Pick a time to get reminders');
      expect(row()).toHaveAccessibleName(
        'Reminders: pick a time to get reminders. Goes to the time choice.'
      );
      expect(within(row()).queryByTestId('reminders-summary-change')).toBeNull();

      await user.click(row());
      const tile = screen.getByTestId(kind === 'task' ? 'task-time-tile' : 'appt-time-tile');
      await waitFor(() => expect(tile).toHaveFocus());
      expect(scrollIntoView.mock.contexts.at(-1)).toBe(tile);
      // It goes to the time choice, NOT More details, and is not the summary tap.
      expect(moreToggle()).toHaveAttribute('aria-expanded', 'false');
      expect(summaryOpened).not.toHaveBeenCalled();

      await user.click(tile);
      await user.type(document.getElementById('scheduled_time') as HTMLInputElement, '10:00');
      await waitFor(() => expect(row()).toHaveAttribute('data-variant', 'summary'));
      expect(value()).toHaveTextContent('At the scheduled time');
      await user.click(row());
      expect(summaryOpened).toHaveBeenCalledWith(kind, 'set', false);
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
