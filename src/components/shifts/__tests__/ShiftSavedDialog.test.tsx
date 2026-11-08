import { render, screen } from '@testing-library/react';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { useCircle } from '@/hooks/useCircle';
import { useAuthStore } from '@/store/authStore';
import { ShiftSavedDialog } from '../ShiftSavedDialog';
import { cityOf, recipientZoneOtherThanViewer } from '@/test/viewerZone';

vi.mock('@/hooks/useCircle', () => ({ useCircle: vi.fn() }));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));

const members = [
  { id: 'u-me', first_name: 'Me', last_name: 'X', email: 'm@x.test', role: 'owner', is_care_recipient: false },
  { id: 'u-ana', first_name: 'Ana', last_name: 'R', email: 'a@x.test', role: 'member', is_care_recipient: false },
];

// The recipient must be a different clock from the viewer for the "(City)"
// suffix to appear; Chicago unless the process IS Chicago (see viewerZone.ts).
const RECIPIENT_TZ = recipientZoneOtherThanViewer(
  'America/Chicago',
  'America/Denver',
  new Date('2026-10-20T13:00:00Z')
);
const CITY = cityOf(RECIPIENT_TZ);

function shift(over: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 's',
    circle_id: 'c',
    event_type: 'shift',
    title: 'Morning',
    scheduled_date: '2026-10-20',
    scheduled_time: '08:00:00',
    duration_minutes: 360,
    recurrence_rule: null,
    recurrence_days: null,
    reminder_lead_minutes: null,
    assigned_to: null,
    created_at: '',
    updated_at: '',
    ...over,
  } as CalendarEvent;
}

function renderSaved(s: CalendarEvent) {
  render(<ShiftSavedDialog circleId="c" shift={s} onAddNext={vi.fn()} onAddTask={vi.fn()} onDone={vi.fn()} />);
}

beforeEach(() => {
  vi.mocked(useCircle).mockReturnValue({
    timezone: RECIPIENT_TZ,
    members,
  } as unknown as ReturnType<typeof useCircle>);
  useAuthStore.setState({ user: { id: 'u-me', first_name: 'Me', last_name: 'X' } } as never);
});

describe('ShiftSavedDialog templates (mobile parity)', () => {
  it('open + one-off: the summary is just the shift (no "Open for anyone to take." repeat); the hint describes add-next', () => {
    renderSaved(shift({}));
    expect(screen.getByRole('heading', { name: '"Morning" saved' })).toBeInTheDocument();
    expect(screen.getByTestId('shift-saved-summary')).toHaveTextContent(new RegExp(`^8:00 AM – 2:00 PM \\(${CITY}\\)$`));
    expect(screen.queryByText(/Open for anyone to take/)).not.toBeInTheDocument();
    // "Starts at 2:00 PM" is the button's description (no visual second line).
    expect(screen.getByRole('button', { name: 'Add the next shift' })).toHaveAccessibleDescription('Starts at 2:00 PM');
  });

  it('open + repeating: "<range>, every day." and the add-another hint', () => {
    renderSaved(shift({ recurrence_rule: 'daily' }));
    expect(screen.getByText(`8:00 AM – 2:00 PM (${CITY}), every day.`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add another shift' })).toHaveAccessibleDescription(
      'Starts at 2:00 PM · every day'
    );
  });

  it('names monthly, yearly, every other day and days on / off instead of "every week"', () => {
    const cases: Array<[string, string]> = [
      ['monthly', 'every month'],
      ['yearly', 'every year'],
      ['every_other_day', 'every other day'],
      ['cycle:14:7', '14 days on, 7 days off'],
    ];
    for (const [rule, words] of cases) {
      const { unmount } = render(
        <ShiftSavedDialog circleId="c" shift={shift({ recurrence_rule: rule })} onAddNext={vi.fn()} onAddTask={vi.fn()} onDone={vi.fn()} />
      );
      expect(screen.getByText(`8:00 AM – 2:00 PM (${CITY}), ${words}.`)).toBeInTheDocument();
      expect(screen.queryByText(/every week/)).not.toBeInTheDocument();
      unmount();
    }
  });

  it('assigned to someone: "{who} is on it."; to the viewer: "You\'re on it." (never "You is on it")', () => {
    const { unmount } = render(
      <ShiftSavedDialog
        circleId="c"
        shift={shift({ assigned_to: 'u-ana', recurrence_rule: 'weekly', recurrence_days: [1, 3] })}
        onAddNext={vi.fn()}
        onAddTask={vi.fn()}
        onDone={vi.fn()}
      />
    );
    expect(screen.getByText(/Ana is on it\.$/)).toBeInTheDocument();
    unmount();
    renderSaved(shift({ assigned_to: 'u-me' }));
    expect(screen.getByText(`8:00 AM – 2:00 PM (${CITY}) · You're on it.`)).toBeInTheDocument();
    expect(screen.queryByText(/You is on it/)).not.toBeInTheDocument();
  });
});

describe('ShiftSavedDialog: ONE filled button (approved mock 2026-11-08)', () => {
  const filled = (el: HTMLElement) => el.className.includes('bg-primary-fill');
  const order = () =>
    Array.from(screen.getByRole('dialog').querySelectorAll('[data-testid^="shift-saved-"]'))
      .map((el) => el.getAttribute('data-testid'))
      .filter((id) => id !== 'shift-saved-summary');

  it('one-off: "Add the next shift" filled, "Add a task to this shift" secondary, Done a neutral text button', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const { Analytics } = await import('@/lib/analytics');
    const spy = vi.spyOn(Analytics, 'shiftSavedSheetAction');
    const onAddTask = vi.fn();
    const onDone = vi.fn();
    const onAddNext = vi.fn();
    const user = userEvent.setup();
    render(
      <ShiftSavedDialog circleId="c" shift={shift({})} onAddNext={onAddNext} onAddTask={onAddTask} onDone={onDone} />
    );
    const dialog = screen.getByRole('dialog');
    expect(order()).toEqual(['shift-saved-add-next', 'shift-saved-add-task', 'shift-saved-done']);
    const next = screen.getByRole('button', { name: 'Add the next shift' });
    const addTask = screen.getByRole('button', { name: 'Add a task to this shift' });
    const done = screen.getByRole('button', { name: 'Done' });
    expect(filled(next)).toBe(true);
    expect(addTask.className).toContain('border-line-strong');
    expect(filled(addTask)).toBe(false);
    expect(done.className).toContain('text-ink-2');
    expect(done.className).not.toContain('text-moss');
    expect(filled(done)).toBe(false);
    expect(dialog.querySelectorAll('button[class*="bg-primary-fill"]')).toHaveLength(1);
    expect(done.querySelector('svg')).toBeNull();
    expect(addTask.querySelector('svg')).toBeNull();

    await user.click(addTask);
    expect(onAddTask).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith({ action: 'add_task', repeating: false });
    await user.click(next);
    expect(onAddNext).toHaveBeenCalledTimes(1);
    await user.click(done);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith({ action: 'done', repeating: false });
  });

  it('repeating: "Add a task to this shift" filled first, then "Add another shift" secondary, then Done', () => {
    renderSaved(shift({ recurrence_rule: 'daily' }));
    expect(order()).toEqual(['shift-saved-add-task', 'shift-saved-add-next', 'shift-saved-done']);
    expect(filled(screen.getByRole('button', { name: 'Add a task to this shift' }))).toBe(true);
    expect(filled(screen.getByRole('button', { name: 'Add another shift' }))).toBe(false);
    expect(screen.getByRole('dialog').querySelectorAll('button[class*="bg-primary-fill"]')).toHaveLength(1);
  });
});
