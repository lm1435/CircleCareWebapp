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
  it('open + one-off: summaryOpenOnce and addNextHintOnce', () => {
    renderSaved(shift({}));
    expect(screen.getByRole('heading', { name: '"Morning" saved' })).toBeInTheDocument();
    expect(screen.getByText(`8:00 AM – 2:00 PM (${CITY}) · Open for anyone to take.`)).toBeInTheDocument();
    expect(screen.getByText('Starts at 2:00 PM')).toBeInTheDocument();
  });

  it('open + repeating: summaryOpen with "every day" and addNextHint', () => {
    renderSaved(shift({ recurrence_rule: 'daily' }));
    expect(screen.getByText(`8:00 AM – 2:00 PM (${CITY}), every day. Open for anyone to take.`)).toBeInTheDocument();
    expect(screen.getByText('Starts at 2:00 PM · every day')).toBeInTheDocument();
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
      expect(screen.getByText(`8:00 AM – 2:00 PM (${CITY}), ${words}. Open for anyone to take.`)).toBeInTheDocument();
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

describe('ShiftSavedDialog: add a task (docs/plans/shift-tasks.md)', () => {
  it('offers "Add a task to this shift" as an outline; Done stays the ONE primary; no check icon', async () => {
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
    const addTask = screen.getByRole('button', { name: 'Add a task to this shift' });
    expect(addTask.className).toContain('border-primary-outline');
    expect(addTask.className).not.toContain('bg-primary-fill');
    expect(screen.getByRole('button', { name: /Add the next shift/ }).className).not.toContain('bg-primary-fill');
    const done = screen.getByRole('button', { name: 'Done' });
    expect(done.className).toContain('bg-primary-fill');
    expect(dialog.querySelectorAll('button.bg-primary-fill, button[class*="bg-primary-fill "]')).toHaveLength(1);
    expect(done.querySelector('svg')).toBeNull();
    expect(addTask.querySelector('svg')).toBeNull();

    await user.click(addTask);
    expect(onAddTask).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith({ action: 'add_task' });
    await user.click(screen.getByRole('button', { name: /Add the next shift/ }));
    expect(onAddNext).toHaveBeenCalledTimes(1);
    await user.click(done);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith({ action: 'done' });
  });
});
