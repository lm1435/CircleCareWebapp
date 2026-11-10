import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Mock } from 'vitest';

// VERIFY BEFORE ALERT for task completion (2026-11-10, mobile parity).
//
// Production, 1.4.0 iOS, 2026-11-09: a task's Done whose RESPONSE was lost (a
// client timeout) raised the failure alert immediately, with no re-read of
// whether the completion had landed. Doses got this protection in 1.3.0
// (lib/confirmVerify.ts `verifyConfirmLanded`); completion now goes through the
// same rule: an AMBIGUOUS rejection re-reads the occurrence's day before
// anything is reported. REAL useTaskCompletion + REAL useCompleteEvent; only
// the HTTP client (mocked globally in src/test/setup.ts) is stubbed.

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('@/components/ui', () => ({ useToast: () => ({ showToast }) }));
vi.mock('@/hooks/usePremiumGate', () => ({
  usePremiumGate: () => ({ promptUpgrade: vi.fn(), promptLapsed: vi.fn() }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}|${JSON.stringify(opts)}` : key,
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    taskCompleted: vi.fn(),
    taskUndone: vi.fn(),
    appointmentCompleted: vi.fn(),
    errorOccurred: vi.fn(),
    taskCompleteRecovered: vi.fn(),
    shiftTaskCompleted: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api';
import { Analytics } from '@/lib/analytics';
import { useTaskCompletion, UNDO_DELAY_MS } from '@/hooks/useTaskCompletion';
import type { CalendarEvent } from '@/api/calendarEvents';

const get = apiClient.get as unknown as Mock;
const post = apiClient.post as unknown as Mock;

const CIRCLE_ID = 'circle-1';
const DAY = '2026-03-16';
const EVENTS_URL = `/circles/${CIRCLE_ID}/events`;

const TASK: CalendarEvent = {
  id: 'task-1',
  circle_id: CIRCLE_ID,
  event_type: 'task',
  title: 'Water plants',
  scheduled_date: DAY,
  scheduled_time: null,
  completed_at: null,
  assigned_to: null,
  created_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-01T00:00:00Z',
};

/** A later day of a repeating task: virtual, addressed by root + date. */
const ROOT_ID = 'series-root';
const VIRTUAL: CalendarEvent = {
  ...TASK,
  id: `${ROOT_ID}_${DAY}`,
  parent_event_id: ROOT_ID,
  is_virtual: true,
} as CalendarEvent;

function axiosTimeout(): Error {
  return Object.assign(new Error('timeout of 15000ms exceeded'), {
    code: 'ECONNABORTED',
    isAxiosError: true,
  });
}

const VIEW_ONLY = {
  success: false,
  error: { code: 'VIEW_ONLY', message: 'View-only access' },
};

function eventsEnvelope(events: CalendarEvent[]) {
  return { success: true, data: { events } };
}

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return wrapper;
}

/** Tap Done and let the 5s undo window elapse, so the POST goes out. */
async function completeAndCommit(task: CalendarEvent) {
  const { result } = renderHook(() => useTaskCompletion(CIRCLE_ID), { wrapper: makeWrapper() });
  vi.useFakeTimers();
  act(() => result.current.handleComplete(task));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(UNDO_DELAY_MS);
  });
  vi.useRealTimers();
  return result;
}

const eventReads = () => get.mock.calls.filter(([url]) => url === EVENTS_URL);

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  showToast.mockReset();
  vi.mocked(Analytics.errorOccurred).mockReset();
  vi.mocked(Analytics.taskCompleteRecovered).mockReset();
  vi.mocked(Analytics.taskCompleted).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('task completion — verify before alert', () => {
  it('timeout, but the completion LANDED: no error toast, task_complete_recovered, counted as completed', async () => {
    post.mockRejectedValue(axiosTimeout());
    get.mockResolvedValue(
      eventsEnvelope([{ ...TASK, completed_at: '2026-03-16T12:00:00Z' }])
    );

    const result = await completeAndCommit(TASK);

    await waitFor(() => expect(Analytics.taskCompleteRecovered).toHaveBeenCalledWith('task', 'timeout'));
    expect(Analytics.taskCompleted).toHaveBeenCalledWith(CIRCLE_ID);
    expect(showToast).not.toHaveBeenCalled();
    expect(Analytics.errorOccurred).not.toHaveBeenCalled();
    // The day that was re-read is the occurrence's own.
    expect(eventReads()[0][1]).toEqual({
      params: { start_date: DAY, end_date: DAY, event_type: 'task' },
    });
    await waitFor(() => expect(result.current.pendingIds.has(TASK.id)).toBe(false));
  });

  it('timeout, and the completion did NOT land: the existing failure toast, with outcome not_recorded', async () => {
    post.mockRejectedValue(axiosTimeout());
    get.mockResolvedValue(eventsEnvelope([TASK]));

    await completeAndCommit(TASK);

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('errors.saveFailed', 'error'));
    expect(Analytics.errorOccurred).toHaveBeenCalledWith(
      'tasks',
      'tasks_update_failed',
      expect.objectContaining({ outcome: 'not_recorded', code: 'timeout' })
    );
    expect(Analytics.taskCompleteRecovered).not.toHaveBeenCalled();
  });

  it('a definite 4xx refusal (VIEW_ONLY) is reported at once, with NO re-read', async () => {
    post.mockRejectedValue(VIEW_ONLY);

    await completeAndCommit(TASK);

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('errors.permissionDenied', 'error'));
    expect(eventReads()).toHaveLength(0);
    const context = vi.mocked(Analytics.errorOccurred).mock.calls[0][2] as Record<string, unknown>;
    expect(context.outcome).toBeUndefined();
  });

  it('the re-read fails too (twice): the "couldn\'t check" copy, never a claimed failure', async () => {
    post.mockRejectedValue(axiosTimeout());
    get.mockImplementation((url: string) =>
      url === EVENTS_URL ? Promise.reject(axiosTimeout()) : Promise.resolve(eventsEnvelope([]))
    );

    await completeAndCommit(TASK);

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        `meds:dialog.errorUnverified|${JSON.stringify({ medication: 'Water plants' })}`,
        'error'
      )
    );
    // One read, one retry.
    expect(eventReads()).toHaveLength(2);
    expect(Analytics.errorOccurred).toHaveBeenCalledWith(
      'tasks',
      'tasks_update_failed',
      expect.objectContaining({ outcome: 'unverified' })
    );
  });

  it('a recurring occurrence is checked on ITS row, never the series root', async () => {
    post.mockRejectedValue(axiosTimeout());
    // The root (its own start date) is completed; the tapped day's materialized
    // child is not. Matching the root would wrongly call this recovered.
    get.mockResolvedValue(
      eventsEnvelope([
        {
          ...TASK,
          id: ROOT_ID,
          scheduled_date: '2026-03-15',
          completed_at: '2026-03-15T09:00:00Z',
          recurrence_rule: 'daily',
        } as CalendarEvent,
        { ...TASK, id: 'child-16', parent_event_id: ROOT_ID, completed_at: null } as CalendarEvent,
      ])
    );

    await completeAndCommit(VIRTUAL);

    // Posted to the root + date…
    expect(post).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/events/${ROOT_ID}/complete`, {
      scheduled_date: DAY,
    });
    // …but verified against the occurrence: not completed -> the failure toast.
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('errors.saveFailed', 'error'));
    expect(Analytics.taskCompleteRecovered).not.toHaveBeenCalled();
  });

  it('a recurring occurrence materialized by the completion counts as landed', async () => {
    post.mockRejectedValue(axiosTimeout());
    get.mockResolvedValue(
      eventsEnvelope([
        {
          ...TASK,
          id: 'child-16',
          parent_event_id: ROOT_ID,
          completed_at: '2026-03-16T12:00:00Z',
        } as CalendarEvent,
      ])
    );

    await completeAndCommit(VIRTUAL);

    await waitFor(() => expect(Analytics.taskCompleteRecovered).toHaveBeenCalledWith('task', 'timeout'));
    expect(showToast).not.toHaveBeenCalled();
  });

  it('waits for the page to be visible before re-reading', async () => {
    post.mockRejectedValue(axiosTimeout());
    get.mockResolvedValue(eventsEnvelope([{ ...TASK, completed_at: '2026-03-16T12:00:00Z' }]));
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      const { result } = renderHook(() => useTaskCompletion(CIRCLE_ID), {
        wrapper: makeWrapper(),
      });
      vi.useFakeTimers();
      act(() => result.current.handleComplete(TASK));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(UNDO_DELAY_MS);
      });
      vi.useRealTimers();
      await waitFor(() => expect(post).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 20));
      expect(eventReads()).toHaveLength(0);

      visibility.mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      await waitFor(() => expect(Analytics.taskCompleteRecovered).toHaveBeenCalled());
      expect(eventReads()).toHaveLength(1);
    } finally {
      visibility.mockRestore();
    }
  });
});
