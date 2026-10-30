import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/i18n';
import { NextUp, NEXT_UP_VISIBLE } from '../NextUp';
import { ToastProvider } from '@/components/ui/Toast';
import { useMedicationUndo } from '@/components/meds/useMedicationUndo';
import { useTaskCompletion } from '@/hooks/useTaskCompletion';
import { Analytics } from '@/lib/analytics';
import type { NextUpItem } from '../nextUpItems';
import { getDateInTimezone } from '@/utils/timezone';

vi.mock('@/components/meds/useMedicationUndo', () => ({ useMedicationUndo: vi.fn() }));
vi.mock('@/hooks/useTaskCompletion', () => ({ useTaskCompletion: vi.fn() }));

const TZ = 'America/Denver';
const TODAY = getDateInTimezone(TZ);

const confirm = vi.fn();
const undo = vi.fn();
const handleComplete = vi.fn();
let medPending: Record<string, 'taken' | 'skipped'> = {};
let taskPending = new Set<string>();

const dose = (id: string, over: Partial<NextUpItem> = {}): NextUpItem => ({
  key: `medication:${id}`,
  type: 'medication',
  id,
  title: `Med ${id}`,
  detail: '10mg',
  // Midnight of the recipient's today: always already due, whatever time the suite runs.
  time: '00:00:00',
  date: TODAY,
  late: true,
  lateHours: null,
  med: { id, event_type: 'medication', title: `Med ${id}`, scheduled_date: TODAY, scheduled_time: '00:00:00' } as NextUpItem['med'],
  ...over,
});

const task = (id: string): NextUpItem => ({
  key: `task:${id}`,
  type: 'task',
  id,
  title: `Task ${id}`,
  detail: null,
  time: null,
  date: TODAY,
  late: false,
  lateHours: null,
  event: { id, event_type: 'task', title: `Task ${id}`, scheduled_date: TODAY } as NextUpItem['event'],
});

const appt = (id: string): NextUpItem => ({
  key: `appointment:${id}`,
  type: 'appointment',
  id,
  title: `Dr ${id}`,
  detail: 'Valley Clinic',
  time: '23:30:00',
  date: TODAY,
  late: false,
  lateHours: null,
  event: { id, event_type: 'appointment', title: `Dr ${id}`, scheduled_date: TODAY } as NextUpItem['event'],
});

function renderNextUp(over: Partial<React.ComponentProps<typeof NextUp>> = {}): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
    <MemoryRouter>
      <ToastProvider>
        <NextUp
          circleId="c1"
          timezone={TZ}
          recipientName="Mom"
          isSelfCare={false}
          canEdit
          items={[]}
          loading={false}
          error={false}
          onRetry={vi.fn()}
          stacked={false}
          {...over}
        />
      </ToastProvider>
    </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('NextUp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    medPending = {};
    taskPending = new Set();
    vi.mocked(useMedicationUndo).mockImplementation(
      () =>
        ({ pending: medPending, confirm, undo, hold: vi.fn() }) as unknown as ReturnType<typeof useMedicationUndo>
    );
    vi.mocked(useTaskCompletion).mockImplementation(
      () =>
        ({
          pendingIds: taskPending,
          handleComplete,
          handleUndo: vi.fn(),
          handleHoldUndo: vi.fn(),
          flushPending: vi.fn(),
        }) as unknown as ReturnType<typeof useTaskCompletion>
    );
    vi.spyOn(Analytics, 'nextUpAction').mockImplementation(() => {});
    vi.spyOn(Analytics, 'todayAllItemsOpened').mockImplementation(() => {});
  });

  it('shows the first 3 rows, then "All of today · N items"', () => {
    const items = [dose('1'), dose('2'), dose('3'), dose('4'), dose('5'), dose('6')];
    renderNextUp({ items });
    expect(NEXT_UP_VISIBLE).toBe(3);
    expect(screen.getAllByTestId('next-up-row')).toHaveLength(3);
    expect(screen.getByRole('link', { name: /All of today · 6 items/ })).toHaveAttribute(
      'href',
      '/circles/c1/calendar'
    );
    expect(screen.queryByText('Med 4')).not.toBeInTheDocument();
  });

  it('singular: "All of today · 1 item"', () => {
    renderNextUp({ items: [dose('1')] });
    expect(screen.getByRole('link', { name: /All of today · 1 item$/ })).toBeInTheDocument();
  });

  it('Taken for a due dose, with a name the screen reader can tell apart', async () => {
    const user = userEvent.setup();
    renderNextUp({ items: [dose('1'), dose('2')] });
    await user.click(screen.getByRole('button', { name: /^Taken, Med 2, 12:00/ }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0].id).toBe('2');
    expect(confirm.mock.calls[0][1]).toBe('taken');
    expect(Analytics.nextUpAction).toHaveBeenCalledWith({
      action: 'taken',
      item_type: 'medication',
      position: 2,
    });
  });

  // Mobile twin: NextUpCardActionNames.test.tsx (iOS a11y crawl lpmqn1: two buttons named
  // "Tomado, Lisinopril" for yesterday's and today's dose of one med).
  it("names yesterday's and today's dose of one med (and a med's two times) apart", () => {
    const shift = (days: number): string =>
      new Date(Date.parse(`${TODAY}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
    const yesterday = shift(-1);
    const sameMed = { title: 'Lisinopril' };
    renderNextUp({
      items: [
        dose('y', { ...sameMed, date: yesterday, time: '08:00:00', med: { ...dose('y').med!, scheduled_date: yesterday, scheduled_time: '08:00:00' } }),
        dose('a', { ...sameMed }),
        dose('b', { ...sameMed, time: '00:01:00', med: { ...dose('b').med!, scheduled_time: '00:01:00' } }),
      ],
    });
    const names = screen.getAllByRole('button', { name: /^Taken, Lisinopril/ }).map((b) => b.getAttribute('aria-label'));
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(3);
    expect(names[0]).toMatch(/^Taken, Lisinopril, Yesterday, 8:00/);
    expect(names[1]).toMatch(/^Taken, Lisinopril, 12:00/);
  });

  it('Done says "N days overdue" for an older open task', () => {
    const older = new Date(Date.parse(`${TODAY}T12:00:00Z`) - 3 * 86_400_000).toISOString().slice(0, 10);
    const t = task('old');
    renderNextUp({ items: [{ ...t, date: older, late: true, event: { ...t.event!, scheduled_date: older } }] });
    expect(screen.getByRole('button', { name: 'Done, Task old, 3 days overdue' })).toBeInTheDocument();
  });

  it('Done for a task', async () => {
    const user = userEvent.setup();
    renderNextUp({ items: [task('t1')] });
    await user.click(screen.getByRole('button', { name: 'Done, Task t1, Any time' }));
    expect(handleComplete).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }));
    expect(Analytics.nextUpAction).toHaveBeenCalledWith({
      action: 'done',
      item_type: 'task',
      position: 1,
    });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('an appointment has no action button, only the row link', async () => {
    const user = userEvent.setup();
    renderNextUp({ items: [appt('a1')] });
    const row = screen.getByTestId('next-up-row');
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
    await user.click(within(row).getByRole('link', { name: /Dr a1/ }));
    expect(Analytics.nextUpAction).toHaveBeenCalledWith({
      action: 'open',
      item_type: 'appointment',
      position: 1,
    });
  });

  it('opening a row goes to the page for its type', () => {
    renderNextUp({ items: [dose('1'), appt('a1'), task('t1')] });
    const hrefs = within(screen.getAllByTestId('next-up-row')[0]).getByRole('link');
    expect(hrefs).toHaveAttribute('href', '/circles/c1/meds');
    expect(within(screen.getAllByTestId('next-up-row')[1]).getByRole('link')).toHaveAttribute('href', '/circles/c1/calendar');
    expect(within(screen.getAllByTestId('next-up-row')[2]).getByRole('link')).toHaveAttribute('href', '/circles/c1/tasks');
  });

  it('a dose that is not due yet has no Taken button', () => {
    const later = dose('1', {
      time: '23:59:00',
      late: false,
      med: { id: '1', event_type: 'medication', title: 'x', scheduled_date: '2999-01-01', scheduled_time: '23:59:00' } as NextUpItem['med'],
    });
    renderNextUp({ items: [later] });
    expect(screen.queryByRole('button', { name: /Taken/ })).not.toBeInTheDocument();
  });

  it('a view-only viewer sees the list with no actions', () => {
    renderNextUp({ items: [dose('1'), task('t1')], canEdit: false });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('LATE is said in text, with hours when known', () => {
    renderNextUp({ items: [dose('1', { lateHours: 2 }), dose('2', { lateHours: null })] });
    const rows = screen.getAllByTestId('next-up-row');
    expect(rows[0]).toHaveTextContent('10mg · 2 hours late');
    expect(rows[1]).toHaveTextContent('10mg · Late');
  });

  it('1 hour late is singular', () => {
    renderNextUp({ items: [dose('1', { lateHours: 1 })] });
    expect(screen.getByTestId('next-up-row')).toHaveTextContent('1 hour late');
  });

  it('an on-time dose says nothing about lateness', () => {
    renderNextUp({ items: [dose('1', { late: false })] });
    expect(screen.getByTestId('next-up-row')).not.toHaveTextContent(/late/i);
  });

  it('inside the undo window the button becomes an Undo badge', async () => {
    const user = userEvent.setup();
    medPending = { '1': 'taken' };
    renderNextUp({ items: [dose('1')] });
    expect(screen.queryByRole('button', { name: /Taken, Med 1/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo Med 1' }));
    expect(undo).toHaveBeenCalledWith('1');
  });

  it('a pending task completion also shows Undo', () => {
    taskPending = new Set(['t1']);
    renderNextUp({ items: [task('t1')] });
    expect(screen.getByRole('button', { name: 'Undo Task t1' })).toBeInTheDocument();
  });

  it('calls onTakenPressed when Taken is pressed (the first-dose hint reads it)', async () => {
    const user = userEvent.setup();
    const onTakenPressed = vi.fn();
    renderNextUp({ items: [dose('1')], onTakenPressed });
    await user.click(screen.getByRole('button', { name: /^Taken, Med 1, 12:00/ }));
    expect(onTakenPressed).toHaveBeenCalledTimes(1);
  });

  it('draws the hint under the named row only', () => {
    renderNextUp({
      items: [dose('1'), dose('2')],
      hint: <div data-testid="the-hint" />,
      hintAfterKey: 'medication:1',
    });
    const rows = screen.getAllByTestId('next-up-row');
    expect(within(rows[0]).getByTestId('the-hint')).toBeInTheDocument();
    expect(within(rows[1]).queryByTestId('the-hint')).not.toBeInTheDocument();
  });

  it('pressing "All of today" fires today_all_items_opened', async () => {
    const user = userEvent.setup();
    renderNextUp({ items: [dose('1')] });
    await user.click(screen.getByRole('link', { name: /All of today/ }));
    expect(Analytics.todayAllItemsOpened).toHaveBeenCalledTimes(1);
  });

  describe('states', () => {
    it('empty: names the person', () => {
      renderNextUp();
      expect(screen.getByText('Nothing else scheduled for Mom today.')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /All of today/ })).not.toBeInTheDocument();
    });

    it('empty, self-care: no name', () => {
      renderNextUp({ isSelfCare: true });
      expect(screen.getByText('Nothing else scheduled for you today.')).toBeInTheDocument();
    });

    it('loading: a busy skeleton, never the empty copy', () => {
      renderNextUp({ loading: true });
      expect(screen.getByText('Next up').closest('section')).toHaveAttribute('aria-busy', 'true');
      expect(screen.queryByText(/Nothing else scheduled/)).not.toBeInTheDocument();
    });

    it('error with nothing to show: a message and a working Retry (never "nothing scheduled")', async () => {
      const user = userEvent.setup();
      const onRetry = vi.fn();
      renderNextUp({ error: true, onRetry });
      expect(screen.getByText("Couldn't load today's list")).toBeInTheDocument();
      expect(screen.queryByText(/Nothing else scheduled/)).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Retry' }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('error with rows already loaded: keeps the rows', () => {
      renderNextUp({ error: true, items: [dose('1')] });
      expect(screen.getByTestId('next-up-row')).toBeInTheDocument();
    });
  });

  describe('large text', () => {
    it('stacks: time line, name, full-width Taken', () => {
      renderNextUp({ items: [dose('1')], stacked: true });
      const row = screen.getByTestId('next-up-row');
      expect(row.firstElementChild).toHaveClass('flex-col');
      expect(screen.getByRole('button', { name: /^Taken, Med 1, 12:00/ })).toHaveClass('w-full');
    });

    it('is a single line otherwise', () => {
      renderNextUp({ items: [dose('1')] });
      const row = screen.getByTestId('next-up-row');
      expect(row.firstElementChild).not.toHaveClass('flex-col');
      expect(screen.getByRole('button', { name: /^Taken, Med 1, 12:00/ })).not.toHaveClass('w-full');
    });
  });

  describe('already recorded by someone else (PK29)', () => {
    type UndoOpts = {
      onError: (error: unknown, status: 'taken' | 'skipped', med: NonNullable<NextUpItem['med']>) => void;
    };
    const conflict = (status: 'taken' | 'skipped') => ({
      error: {
        code: 'DOSE_ALREADY_RECORDED',
        details: {
          status,
          recorded_by_name: 'Ana',
          recorded_at: '2026-06-12T15:02:00Z',
          timezone: TZ,
        },
      },
    });
    const capture = (): UndoOpts => {
      const call = vi.mocked(useMedicationUndo).mock.calls.at(-1);
      return call![0] as unknown as UndoOpts;
    };

    it('a DIFFERENT answer: the calm notice carries "Change answer", which opens the confirm dialog naming Ana', async () => {
      const user = userEvent.setup();
      const item = dose('1');
      renderNextUp({ items: [item] });
      act(() => capture().onError(conflict('skipped'), 'taken', item.med!));
      expect(await screen.findByText(/Already skipped by Ana at/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Change answer' }));
      expect(await screen.findByRole('dialog', { name: "Change Ana's answer?" })).toBeInTheDocument();
    });

    it('the SAME answer: the notice stands alone (nothing to change)', async () => {
      const item = dose('1');
      renderNextUp({ items: [item] });
      act(() => capture().onError(conflict('taken'), 'taken', item.med!));
      expect(await screen.findByText(/Already marked taken by Ana at/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Change answer' })).not.toBeInTheDocument();
    });
  });
});
