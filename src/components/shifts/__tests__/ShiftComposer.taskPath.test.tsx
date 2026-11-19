import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { createShiftTask } from '@/api/shiftTasks';
import { ToastProvider } from '@/components/ui';
import { Analytics } from '@/lib/analytics';
import { ShiftComposer } from '../ShiftComposer';

// 1.4.3: the saved dialog's "Add a task to this shift" opens the FULL task editor in shift mode (it replaced the
// retired two-field form). The destination after it is unchanged: every way out returns to the saved dialog.

const PINNED_NOW = new Date('2026-11-09T21:00:00Z');
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: PINNED_NOW });
});
afterAll(() => {
  vi.useRealTimers();
});

const SAVED = {
  id: 'new-shift',
  circle_id: 'c',
  event_type: 'shift',
  title: 'Afternoons',
  scheduled_date: '2026-11-10',
  scheduled_time: '14:00:00',
  duration_minutes: 360,
  recurrence_rule: 'weekly',
  assigned_to: 'u-me',
  created_at: '',
  updated_at: '',
} as CalendarEvent;

vi.mock('../ShiftFormModal', () => ({
  ShiftFormModal: ({ onCreated }: { onCreated?: (s: CalendarEvent, next: object) => void }) => (
    <button type="button" onClick={() => onCreated?.(SAVED, {})}>
      create-shift
    </button>
  ),
}));
vi.mock('@/api/shiftTasks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/shiftTasks')>()),
  createShiftTask: vi.fn(),
}));
vi.mock('@/hooks/useProviders', () => ({ useProviders: () => ({ providers: [], isSuccess: true }) }));
vi.mock('@/hooks/useCalendarEvents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useCalendarEvents')>()),
  useCachedCircleEvents: () => [],
}));
vi.mock('@/hooks/useSeriesRoot', () => ({ useSeriesRoot: (_c: string, e: unknown) => ({ root: e ?? null }) }));
vi.mock('@/store/authStore', () => {
  const useAuthStore = (select: (s: { user: { id: string } }) => unknown) => select({ user: { id: 'u-me' } });
  useAuthStore.getState = () => ({ user: { id: 'u-me' } });
  return { useAuthStore };
});
vi.mock('@/hooks/useCircle', () => ({
  useCircle: () => ({
    circle: { recipient_name: 'Rosa', owner_id: 'u-me', is_self_care: false },
    timezone: 'America/Chicago',
    members: [{ id: 'u-me', email: 'me@x.test', first_name: 'Me', is_care_recipient: false }],
    canEdit: true,
    viewOnly: false,
  }),
}));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));

async function toSavedDialog() {
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter>
          <ShiftComposer circleId="c" source="shifts_view" onClose={vi.fn()} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
  await user.click(screen.getByRole('button', { name: 'create-shift' }));
  await screen.findByTestId('shift-saved-add-task');
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createShiftTask).mockResolvedValue({ id: 'new-task' } as CalendarEvent);
  for (const name of ['entryFormOpened', 'entryFormStepCompleted', 'entrySaveTapped', 'shiftTaskAddOpened', 'shiftTaskAdded', 'shiftTaskSaved', 'shiftSavedSheetAction'] as const) {
    vi.spyOn(Analytics, name).mockImplementation(() => {});
  }
});
afterEach(cleanup);

describe('saved dialog -> full task editor (shift mode)', () => {
  it('P "Add a task to this shift" opens the full editor with the saved_sheet source and shift_saved_sheet entry', async () => {
    const user = await toSavedDialog();
    await user.click(screen.getByTestId('shift-saved-add-task'));
    const editor = await screen.findByRole('dialog', { name: 'New task' });
    expect(within(editor).getByTestId('shift-task-chip')).toHaveTextContent('On Afternoons');
    expect(Analytics.entryFormOpened).toHaveBeenCalledWith({ type: 'task', entry: 'shift_saved_sheet' });
    expect(Analytics.shiftTaskAddOpened).toHaveBeenCalledWith(expect.objectContaining({ source: 'saved_sheet', coverer: 'me' }));
    // The shift is "mine": the coverer line says so by name.
    expect(within(editor).getByTestId('shift-task-owner-now')).toHaveTextContent('Right now: Me');
  });

  it('P a save returns to the saved dialog (destination unchanged), ONE POST, with the added toast', async () => {
    const user = await toSavedDialog();
    await user.click(screen.getByTestId('shift-saved-add-task'));
    const editor = await screen.findByRole('dialog', { name: 'New task' });
    await user.type(within(editor).getByRole('textbox', { name: /^Title/ }), 'Give lunch');
    await user.click(within(editor).getByTestId('add-event-save'));
    expect(await screen.findByTestId('shift-saved-add-task')).toBeInTheDocument();
    expect(createShiftTask).toHaveBeenCalledTimes(1);
    expect(createShiftTask).toHaveBeenCalledWith('c', 'new-shift', {
      scheduledDate: '2026-11-10',
      title: 'Give lunch',
      scheduled_time: '14:00',
    });
    expect(screen.queryByTestId('highlight-ring')).toBeNull();
    expect(await screen.findByText('Task added')).toBeInTheDocument();
    expect(Analytics.shiftTaskAdded).toHaveBeenCalledWith({ source: 'saved_sheet', oneOff: false, shiftRepeats: true });
  });

  it('N Cancel and the close x return to the saved dialog and send nothing', async () => {
    const user = await toSavedDialog();
    await user.click(screen.getByTestId('shift-saved-add-task'));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByTestId('shift-saved-add-task')).toBeInTheDocument();
    await user.click(screen.getByTestId('shift-saved-add-task'));
    await user.click(await screen.findByRole('button', { name: 'Close event form' }));
    await waitFor(() => expect(screen.getByTestId('shift-saved-add-task')).toBeInTheDocument());
    expect(createShiftTask).not.toHaveBeenCalled();
  });
});
