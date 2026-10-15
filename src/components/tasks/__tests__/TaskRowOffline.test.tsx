import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { onlineManager } from '@tanstack/react-query';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { ToastProvider } from '@/components/ui';
import { __resetOfflineWriteForTests } from '@/lib/offlineWrite';

// Pinned so this test needs no QueryClientProvider (same as TaskRowAssignee).
vi.mock('@/hooks/useHourCycle', () => ({
  useHourCycle: () => '12h',
}));

const { TaskRow } = await import('../TaskRow');

// Task Done while offline (owner decision 2026-10-14): never queued, never
// shown as done. The button stays visible and focusable; a press explains.

const TASK = {
  id: 'task-1',
  circle_id: 'circle-1',
  title: 'Refill pill box',
  event_type: 'task',
  scheduled_date: '2026-10-01',
  scheduled_time: '12:00:00',
  status: 'open',
  assigned_to: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
} as CalendarEvent;

beforeEach(() => __resetOfflineWriteForTests());
afterEach(() => onlineManager.setOnline(true));

function renderRow(onComplete = vi.fn()) {
  render(
    <ToastProvider>
      <TaskRow
        task={TASK}
        timezone="America/Denver"
        canEdit
        members={[]}
        onComplete={onComplete}
        onUndo={vi.fn()}
        onEdit={vi.fn()}
        isPendingComplete={false}
      />
    </ToastProvider>
  );
  return onComplete;
}

it('offline: Done is aria-disabled and a press explains instead of completing', async () => {
  const onComplete = renderRow();
  act(() => onlineManager.setOnline(false));

  // Rendered twice by design (inline + stacked; container queries pick one).
  const doneButtons = screen.getAllByRole('button', { name: 'Mark "Refill pill box" complete' });
  expect(doneButtons.length).toBeGreaterThan(0);
  for (const b of doneButtons) expect(b).toHaveAttribute('aria-disabled', 'true');
  const doneButton = doneButtons[0];
  expect(doneButton).toHaveTextContent('Done');

  await userEvent.click(doneButton);
  expect(onComplete).not.toHaveBeenCalled();
  expect(await screen.findByText("You're offline. Connect to mark this.")).toBeInTheDocument();

  act(() => onlineManager.setOnline(true));
  expect(doneButton).not.toHaveAttribute('aria-disabled');
  await userEvent.click(doneButton);
  expect(onComplete).toHaveBeenCalledTimes(1);
});
